import { describe, it, expect } from "vitest";
import { describeVisit, fingerprintHash } from "../../src/server/storage/dedupe.js";
import { observed, unavailable, SCHEMA_VERSION, type Fingerprint } from "../../src/shared/schema/types.js";

/** A realistic server-only fingerprint; each test changes one thing and checks whether the hash moves. */
function fp(over: (f: Fingerprint) => void = () => {}): Fingerprint {
  const f: Fingerprint = {
    schemaVersion: SCHEMA_VERSION,
    fingerprintId: "11111111-1111-4111-8111-111111111111",
    generatedAt: "2026-11-16T00:00:00.000Z",
    request: { method: "GET", httpVersion: "1.1", target: "/", scheme: "https", receivedAt: "2026-11-16T00:00:00.000Z" },
    server: {
      network: [
        observed("network.client_ip", "network", "server", "tcp_peer", "195.178.110.199"),
        observed("network.remote_ip", "network", "server", "tcp_socket", "195.178.110.199"),
        observed("network.remote_port", "network", "server", "tcp_socket", 40001),
        observed("network.client_ip_class", "network", "server", "rfc6890", { scope: "public" }, "public"),
        unavailable("network.reverse_dns", "network", "server", "dns_ptr_lookup"),
      ],
      tls: [
        observed("tls.negotiated_protocol", "tls", "server", "x", "TLSv1.3"),
        observed("tls.negotiated_cipher", "tls", "server", "x", "TLS_AES_128_GCM_SHA256"),
        observed("tls.alpn_negotiated", "tls", "server", "x", "http/1.1"),
        observed("tls.clienthello.sni", "tls", "server", "x", "plzbot.me.ddtripp.com"),
        observed("tls.clienthello.raw_hex", "tls", "server", "x", "16030100aa" + "ab".repeat(32)),
        observed("tls.clienthello.extensions", "tls", "server", "x", [0, 11, 10]),
      ],
      http: [
        observed("http.headers.user_agent", "http", "server", "x", "Mozilla/5.0 Chrome/131"),
        observed("http.headers.accept", "http", "server", "x", "*/*"),
        observed("http.headers.host", "http", "server", "x", "plzbot.me.ddtripp.com"),
        observed("http.header_order", "http", "server", "x", ["host", "user-agent", "accept"], "host,user-agent,accept"),
        observed("http.target", "http", "server", "x", "/"),
        unavailable("http.headers.referer", "http", "server", "x"),
      ],
      http2: [observed("http2.stream_id", "http2", "server", "x", 1), observed("http2.settings", "http2", "server", "x", { initialWindowSize: 6291456 })],
      clientHints: [],
    },
    client: null,
    derived: [{ id: "derived.ja4", derivedFrom: [], value: "t13d1715h1_5b57614c22b0_5c2c66f702b0", method: "m", status: "computed" }],
    interpretation: { assessments: [] },
  };
  over(f);
  return f;
}

const set = (f: Fingerprint, group: keyof Fingerprint["server"], id: string, value: unknown) => {
  const o = f.server[group].find((x) => x.id === id);
  if (o) o.raw = o.normalized = value;
};

describe("fingerprintHash: things that change per request do NOT change the fingerprint", () => {
  const base = fingerprintHash(fp());
  const same = (name: string, change: (f: Fingerprint) => void) => it(name, () => expect(fingerprintHash(fp(change))).toBe(base));

  same("fingerprint id, timestamps and request path", (f) => {
    f.fingerprintId = "22222222-2222-4222-8222-222222222222";
    f.generatedAt = "2030-01-01T00:00:00.000Z";
    f.request.receivedAt = "2030-01-01T00:00:00.000Z";
    f.request.target = "/index.html";
    set(f, "http", "http.target", "/index.html");
  });
  same("the visitor-chosen Host header (the scanner's invented names)", (f) => set(f, "http", "http.headers.host", "backup.sslip.io"));
  same("the client IP, port and reverse-DNS name", (f) => {
    set(f, "network", "network.client_ip", "203.0.113.9");
    set(f, "network", "network.remote_port", 55555);
    f.server.network = f.server.network.filter((o) => o.id !== "network.reverse_dns");
  });
  same("the HTTP/2 stream number", (f) => set(f, "http2", "http2.stream_id", 9));
  same("SNI and the random raw ClientHello bytes, and extension order", (f) => {
    set(f, "tls", "tls.clienthello.sni", "34-41-83-57.sslip.io");
    set(f, "tls", "tls.clienthello.raw_hex", "16030100aa" + "cd".repeat(32));
    set(f, "tls", "tls.clienthello.extensions", [10, 0, 11]);
  });
  same("key order inside stored values (jsonb reorders keys)", (f) => {
    f.server.http2[1]!.raw = f.server.http2[1]!.normalized = { initialWindowSize: 6291456 };
  });
});

describe("fingerprintHash: things that identify the client DO change the fingerprint", () => {
  const base = fingerprintHash(fp());
  const differs = (name: string, change: (f: Fingerprint) => void) => it(name, () => expect(fingerprintHash(fp(change))).not.toBe(base));

  differs("user agent", (f) => set(f, "http", "http.headers.user_agent", "curl/8.7.1"));
  differs("Accept header", (f) => set(f, "http", "http.headers.accept", "text/html"));
  differs("header order", (f) => set(f, "http", "http.header_order", "user-agent,host,accept"));
  differs("TLS fingerprint (JA4)", (f) => (f.derived[0]!.value = "t13d1516h2_8daaf6152771_b186095e22b6"));
  differs("negotiated cipher", (f) => set(f, "tls", "tls.negotiated_cipher", "TLS_CHACHA20_POLY1305_SHA256"));
  differs("HTTP version", (f) => (f.request.httpVersion = "2.0"));
  differs("HTTP/2 settings", (f) => set(f, "http2", "http2.settings", { initialWindowSize: 65535 }));
  differs("an observation that is present vs missing", (f) => {
    f.server.http = f.server.http.filter((o) => o.id !== "http.headers.accept");
  });
  differs("IP class (a private address is not the same as a public one)", (f) => set(f, "network", "network.client_ip_class", "private"));
  differs("any browser-collected signal", (f) => {
    f.client = { status: "submitted", navigator: [observed("browser.navigator.language", "browser.navigator", "client", "x", "en-US")], screen: [], hardware: [], graphics: [], audio: [], fonts: [], media: [], storage: [], apis: [], automation: [] };
  });
  it("two browser submissions that differ in one signal differ", () => {
    const make = (lang: string) =>
      fp((f) => {
        f.client = { status: "submitted", navigator: [observed("browser.navigator.language", "browser.navigator", "client", "x", lang)], screen: [], hardware: [], graphics: [], audio: [], fonts: [], media: [], storage: [], apis: [], automation: [] };
      });
    expect(fingerprintHash(make("en-US"))).not.toBe(fingerprintHash(make("fr-FR")));
    expect(fingerprintHash(make("en-US"))).toBe(fingerprintHash(make("en-US")));
  });
});

describe("describeVisit", () => {
  it("keeps the per-visit details the fingerprint ignores", () => {
    const f = fp((x) => {
      set(x, "http", "http.headers.host", "admin.sslip.io");
      x.server.network = x.server.network.filter((o) => o.id !== "network.reverse_dns");
      x.server.network.push(observed("network.reverse_dns", "network", "server", "dns", null, ["scan-7.example.net"]));
      x.request.target = "/?probe=1";
    });
    expect(describeVisit(f)).toMatchObject({ ip: "195.178.110.199", hostname: "scan-7.example.net", host: "admin.sslip.io", target: "/?probe=1", ja4: "t13d1715h1_5b57614c22b0_5c2c66f702b0" });
    expect(describeVisit(f).hash).toBe(fingerprintHash(f));
  });
  it("tolerates missing pieces", () => {
    const f = fp((x) => {
      x.server.network = [];
      x.server.http = [];
      x.derived = [];
    });
    expect(describeVisit(f)).toMatchObject({ ip: null, hostname: null, host: null, ja4: null });
  });
});
