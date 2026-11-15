import { describe, it, expect } from "vitest";
import { runInterpretation } from "../../src/server/interpret/engine.js";
import { SCHEMA_VERSION, observed, type Fingerprint } from "../../src/shared/schema/types.js";

const CHROME_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

function fp(overrides: Partial<Fingerprint>): Fingerprint {
  return {
    schemaVersion: SCHEMA_VERSION,
    fingerprintId: "t",
    generatedAt: new Date().toISOString(),
    request: { method: "GET", httpVersion: "2.0", target: "/", scheme: "https", receivedAt: new Date().toISOString() },
    server: { network: [], tls: [], http: [], http2: [], clientHints: [] },
    client: null,
    derived: [],
    interpretation: { assessments: [] },
    ...overrides,
  };
}

const chromeDerived = [
  { id: "derived.ua_browser_family_guess", derivedFrom: [], value: "Chrome", method: "t", status: "computed" as const },
  { id: "derived.ua_automation_tokens", derivedFrom: [], value: [], method: "t", status: "computed" as const },
];

describe("transport consistency rules", () => {
  it("flags a Chrome UA whose ClientHello has no GREASE as a high-confidence conflict", () => {
    const f = fp({
      derived: chromeDerived,
      server: {
        network: [],
        http: [observed("http.headers.user_agent", "http", "server", "http_header", CHROME_UA)],
        http2: [],
        clientHints: [],
        tls: [
          observed("tls.clienthello.cipher_suites", "tls", "server", "self_observed_clienthello", [0x1301]),
          observed("tls.clienthello.grease", "tls", "server", "self_observed_clienthello", { ciphers: [], extensions: [], groups: [], versions: [] }, false),
          observed("tls.clienthello.supported_versions", "tls", "server", "self_observed_clienthello", [0x0304, 0x0303], ["TLS 1.3", "TLS 1.2"]),
          observed("tls.clienthello.alpn_offered", "tls", "server", "self_observed_clienthello", ["h2", "http/1.1"]),
        ],
      },
    });
    const a = runInterpretation(f);
    const grease = a.find((x) => x.id === "transport.chromium_ua_without_grease");
    expect(grease?.confidence).toBe("high");
    expect(grease?.conflicting).toBe(true);
    expect(a.find((x) => x.id === "transport.browser_ua_without_tls13")).toBeUndefined();
    expect(a.find((x) => x.id === "transport.browser_ua_without_h2_alpn")).toBeUndefined();
  });

  it("stays quiet when a Chrome UA comes with Chrome-like TLS and h2 settings", () => {
    const f = fp({
      derived: chromeDerived,
      server: {
        network: [],
        http: [observed("http.headers.user_agent", "http", "server", "http_header", CHROME_UA)],
        clientHints: [],
        tls: [
          observed("tls.clienthello.cipher_suites", "tls", "server", "self_observed_clienthello", [0x1301]),
          observed("tls.clienthello.grease", "tls", "server", "self_observed_clienthello", { ciphers: ["0x0a0a"], extensions: [], groups: [], versions: [] }, true),
          observed("tls.clienthello.supported_versions", "tls", "server", "self_observed_clienthello", [0x0304], ["TLS 1.3"]),
          observed("tls.clienthello.alpn_offered", "tls", "server", "self_observed_clienthello", ["h2", "http/1.1"]),
        ],
        http2: [
          observed("http2.settings", "http2", "server", "x", { headerTableSize: 65536, enablePush: false, initialWindowSize: 6291456, maxHeaderListSize: 262144, maxConcurrentStreams: 1000 }),
          observed("http2.pseudo_header_order", "http2", "server", "x", [":method", ":authority", ":scheme", ":path"], "m,a,s,p"),
        ],
      },
    });
    const a = runInterpretation(f);
    expect(a.filter((x) => x.conflicting).map((x) => x.id)).toEqual([]);
    expect(a.find((x) => x.id === "transport.h2_settings_match_chromium")).toBeDefined();
  });

  it("flags Chrome UA with non-Chrome h2 SETTINGS and pseudo-header order", () => {
    const f = fp({
      derived: chromeDerived,
      server: {
        network: [],
        http: [observed("http.headers.user_agent", "http", "server", "http_header", CHROME_UA)],
        clientHints: [],
        tls: [],
        http2: [
          observed("http2.settings", "http2", "server", "x", { headerTableSize: 4096, enablePush: true, initialWindowSize: 65535, maxHeaderListSize: 4294967295 }),
          observed("http2.pseudo_header_order", "http2", "server", "x", [":method", ":path", ":authority", ":scheme"], "m,p,a,s"),
        ],
      },
    });
    const ids = runInterpretation(f).map((x) => x.id);
    expect(ids).toContain("transport.h2_settings_mismatch_chromium");
    expect(ids).toContain("transport.h2_pseudo_header_order_mismatch_chromium");
  });
});

describe("agent rules", () => {
  it("produces a medium-confidence, cited assessment for a documented AI fetcher token", () => {
    const f = fp({
      derived: [
        {
          id: "derived.client_signature",
          derivedFrom: [],
          method: "t",
          status: "computed",
          value: { name: "Claude-User", vendor: "Anthropic", category: "ai_user_fetcher", matchedText: "Claude-User", docs: "https://example.test/docs" },
        },
      ],
    });
    const a = runInterpretation(f).find((x) => x.id === "agent.ai_user_fetcher");
    expect(a?.confidence).toBe("medium");
    expect(a?.category).toBe("automation");
    expect(a?.references?.[0]?.url).toBe("https://example.test/docs");
  });

  it("flags a missing User-Agent", () => {
    const f = fp({ derived: [{ id: "derived.client_signature", derivedFrom: [], method: "t", status: "computed", value: { category: "no_user_agent" } }] });
    expect(runInterpretation(f).find((x) => x.id === "agent.no_user_agent")).toBeDefined();
  });

  it("flags a library token combined with browser-side signals as a conflict", () => {
    const f = fp({
      derived: [{ id: "derived.client_signature", derivedFrom: [], method: "t", status: "computed", value: { name: "requests", vendor: "Python", category: "http_library", matchedText: "python-requests/2.32", docs: null } }],
      client: { status: "submitted", navigator: [], screen: [], hardware: [], graphics: [], audio: [], fonts: [], media: [], storage: [], apis: [], automation: [] },
    });
    expect(runInterpretation(f).find((x) => x.id === "agent.non_browser_token_with_browser_signals")?.conflicting).toBe(true);
  });
});
