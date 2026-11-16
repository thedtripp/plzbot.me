import { describe, it, expect } from "vitest";
import { normalizeIp, toRow } from "../../src/server/storage/fingerprintRow.js";
import { observed, SCHEMA_VERSION, type Fingerprint } from "../../src/shared/schema/types.js";

function fp(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    schemaVersion: SCHEMA_VERSION,
    fingerprintId: "11111111-1111-4111-8111-111111111111",
    generatedAt: "2026-11-16T00:00:00.000Z",
    request: { method: "GET", httpVersion: "2.0", target: "/api/v1/fingerprint", scheme: "https", receivedAt: "2026-11-16T00:00:00.000Z" },
    server: {
      network: [
        observed("network.client_ip", "network", "server", "tcp_peer", "::ffff:203.0.113.9"),
        observed("network.remote_ip", "network", "server", "tcp_socket", "::ffff:203.0.113.9"),
        observed("network.asn", "network", "server", "offline_ip2asn_table", { asn: 64500, description: "X" }, "AS64500 X"),
      ],
      tls: [],
      http: [observed("http.headers.user_agent", "http", "server", "request_header", "GPTBot/1.2")],
      http2: [observed("http2.fingerprint_partial", "http2", "server", "x", "raw-fp", "1:65536|?|1:?:?:256|m,a,s,p")],
      clientHints: [],
    },
    client: null,
    derived: [
      { id: "derived.ja3_hash", derivedFrom: [], value: "abc", method: "m", status: "computed" },
      { id: "derived.ja4", derivedFrom: [], value: null, method: "m", status: "unavailable" },
      { id: "derived.client_signature", derivedFrom: [], value: { name: "GPTBot", category: "ai_crawler" }, method: "m", status: "computed" },
    ],
    interpretation: {
      assessments: [{ id: "agent.ai_crawler", category: "automation", title: "t", statement: "s", confidence: "medium", evidence: { observationIds: [], derivedIds: [] } }],
    },
    ...overrides,
  };
}

describe("normalizeIp", () => {
  it("unwraps v4-mapped addresses and strips zone ids", () => {
    expect(normalizeIp("::ffff:203.0.113.9")).toBe("203.0.113.9");
    expect(normalizeIp("fe80::1%en0")).toBe("fe80::1");
    expect(normalizeIp("2001:db8::1")).toBe("2001:db8::1");
  });
  it("rejects anything that is not an IP", () => {
    expect(normalizeIp("not-an-ip")).toBeNull();
    expect(normalizeIp("1.2.3.4; DROP TABLE")).toBeNull();
    expect(normalizeIp(undefined)).toBeNull();
  });
});

describe("toRow", () => {
  it("extracts the queryable columns", () => {
    const row = toRow(fp(), "api_get");
    expect(row).toMatchObject({
      id: "11111111-1111-4111-8111-111111111111",
      kind: "api_get",
      client_ip: "203.0.113.9",
      peer_ip: "203.0.113.9",
      asn: 64500,
      http_version: "2.0",
      user_agent: "GPTBot/1.2",
      ja3_hash: "abc",
      ja4: null,
      h2_fingerprint: "1:65536|?|1:?:?:256|m,a,s,p",
      agent_name: "GPTBot",
      agent_category: "ai_crawler",
      assessment_ids: ["agent.ai_crawler"],
      has_client: false,
    });
  });

  it("keeps the full document but drops the recomputable interpretation prose", () => {
    const row = toRow(fp(), "page_view");
    expect(row.doc).not.toHaveProperty("interpretation");
    expect(row.doc.server.network).toHaveLength(3);
    expect(JSON.stringify(row.doc)).not.toContain("statement");
  });

  it("falls back to the TCP peer when there is no resolved client ip, and tolerates missing signals", () => {
    const bare = fp({ derived: [] });
    bare.server.network = [observed("network.remote_ip", "network", "server", "tcp_socket", "198.51.100.4")];
    bare.server.http = [];
    bare.server.http2 = [];
    const row = toRow(bare, "page_view");
    expect(row.client_ip).toBe("198.51.100.4");
    expect(row.asn).toBeNull();
    expect(row.user_agent).toBeNull();
    expect(row.ja4).toBeNull();
  });
});
