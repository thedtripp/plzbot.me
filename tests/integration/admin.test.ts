import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/runtime/config.js";
import pg from "pg";
import { createStore, type FingerprintStore } from "../../src/server/storage/postgres.js";
import { resetStoreTables } from "../helpers/db.js";

const PASSWORD = "correct-horse-battery";
const basic = (pw: string) => ({ authorization: "Basic " + Buffer.from(`admin:${pw}`).toString("base64") });

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; text: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, text: Buffer.concat(chunks).toString("utf8") }));
    }).on("error", reject);
  });
}

function listen(handler: http.RequestListener): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(handler);
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, port: (server.address() as any).port })));
}

describe("admin config", () => {
  it("rejects a short admin password", () => {
    expect(() => loadConfig({ PLZBOT_MODE: "http", PLZBOT_ADMIN_PASSWORD: "short" })).toThrow(/at least 12/);
    expect(loadConfig({ PLZBOT_MODE: "http" }).adminPassword).toBeNull();
  });
});

describe("admin disabled (no PLZBOT_ADMIN_PASSWORD)", () => {
  let s: { server: http.Server; port: number };
  beforeAll(async () => (s = await listen(createApp(loadConfig({ PLZBOT_MODE: "http" })))));
  afterAll(() => new Promise<void>((r) => s.server.close(() => r())));

  it("does not reveal that the page or API exist", async () => {
    for (const p of ["/admin", "/admin.html", "/api/v1/admin/overview", "/api/v1/admin/fingerprints"]) {
      const r = await get(s.port, p, basic(PASSWORD));
      expect(r.status, p).toBe(404);
      expect(r.text).not.toContain("Fingerprint analysis");
    }
  });
});

describe("admin enabled, no database", () => {
  let s: { server: http.Server; port: number };
  beforeAll(async () => (s = await listen(createApp(loadConfig({ PLZBOT_MODE: "http", PLZBOT_ADMIN_PASSWORD: PASSWORD })))));
  afterAll(() => new Promise<void>((r) => s.server.close(() => r())));

  it("requires the password for the page, the static path and the API", async () => {
    for (const p of ["/admin", "/admin.html", "/api/v1/admin/overview"]) {
      const none = await get(s.port, p);
      expect(none.status, p).toBe(401);
      expect(none.headers["www-authenticate"]).toMatch(/^Basic/);
      expect(none.text).not.toContain("Fingerprint analysis");
      expect((await get(s.port, p, basic("wrong-password-123"))).status, p).toBe(401);
    }
  });

  it("serves the page with a strict CSP, a per-response nonce and no caching", async () => {
    const a = await get(s.port, "/admin", basic(PASSWORD));
    const b = await get(s.port, "/admin.html", basic(PASSWORD));
    expect(a.status).toBe(200);
    expect(a.text).toContain("Fingerprint analysis");
    expect(a.text).not.toContain("__NONCE__");
    const nonce = /script-src 'nonce-([^']+)'/.exec(String(a.headers["content-security-policy"]))?.[1];
    expect(nonce).toBeTruthy();
    expect(a.text).toContain(`<script nonce="${nonce}">`);
    expect(String(a.headers["content-security-policy"])).toContain("default-src 'none'");
    expect(a.headers["cache-control"]).toBe("no-store");
    expect(a.headers["x-robots-tag"]).toContain("noindex");
    expect(/script-src 'nonce-([^']+)'/.exec(String(b.headers["content-security-policy"]))?.[1]).not.toBe(nonce);
    expect(a.text).not.toMatch(/\sstyle="/); // inline style attributes would be blocked by the CSP
  });

  it("answers 503 for data endpoints when storage is not configured", async () => {
    expect((await get(s.port, "/api/v1/admin/overview", basic(PASSWORD))).status).toBe(503);
  });
});

const DB_URL = process.env.PLZBOT_TEST_DATABASE_URL;
describe.skipIf(!DB_URL)("admin data endpoints (Postgres)", () => {
  let s: { server: http.Server; port: number };
  let store: FingerprintStore;
  let db: pg.Pool;
  const auth = basic(PASSWORD);

  beforeAll(async () => {
    const config = loadConfig({ PLZBOT_MODE: "http", PLZBOT_ADMIN_PASSWORD: PASSWORD, PLZBOT_DATABASE_URL: DB_URL });
    store = createStore(config, () => {})!;
    db = new pg.Pool({ connectionString: DB_URL, max: 2 });
    await resetStoreTables(db);
    s = await listen(createApp(config, store));
    await get(s.port, "/", { "user-agent": "GPTBot/1.2 100%_real" });
    await get(s.port, "/api/v1/fingerprint", { "user-agent": "curl/8.7.1" });
    await get(s.port, "/api/v1/fingerprint", { "user-agent": "<script>alert(1)</script>" });
    for (let i = 0; i < 100 && (await store.query("SELECT 1 FROM visits")).length < 3; i++) await new Promise((r) => setTimeout(r, 50));
  });
  afterAll(async () => {
    await new Promise<void>((r) => s.server.close(() => r()));
    await store.close();
    await db.end();
  });

  it("overview reports totals, daily counts by kind, agents and rules", async () => {
    const r = await get(s.port, "/api/v1/admin/overview?days=7", auth);
    expect(r.status).toBe(200);
    const body = JSON.parse(r.text);
    expect(body.totals).toMatchObject({ total: 3, all_time: 3, ips: 1 });
    expect(Number(body.totals.table_bytes)).toBeGreaterThan(0);
    expect(body.daily.reduce((n: number, d: any) => n + d.n, 0)).toBe(3);
    expect(body.daily.map((d: any) => d.kind).sort()).toEqual(["api_get", "page_view"]);
    expect(body.topAgents.map((a: any) => a.agent)).toContain("GPTBot");
    expect(body.topIps[0]).toMatchObject({ ip: "127.0.0.1", n: 3 });
    expect(body.rules.length).toBeGreaterThan(0);
  });

  it("lists with filters, escapes LIKE wildcards, paginates and validates input", async () => {
    const list = async (qs: string) => JSON.parse((await get(s.port, "/api/v1/admin/fingerprints?" + qs, auth)).text);
    expect((await list("")).rows).toHaveLength(3);
    expect((await list("kind=page_view")).rows).toHaveLength(1);
    expect((await list("kind=page_view")).rows[0].target).toBe("/");
    expect((await list("target=" + encodeURIComponent("/api/v1/fingerprint"))).rows).toHaveLength(2); // exact match
    expect((await list("target=" + encodeURIComponent("/api/v1"))).rows).toHaveLength(0); // not a prefix match
    expect((await list("agent=GPTBot")).rows[0].kind).toBe("page_view");
    expect((await list("q=" + encodeURIComponent("100%_real"))).rows).toHaveLength(1);
    expect((await list("q=" + encodeURIComponent("%"))).rows).toHaveLength(1); // only the UA that contains a literal %
    const page = await list("limit=2");
    expect(page.rows).toHaveLength(2);
    expect(page.hasMore).toBe(true);
    expect((await get(s.port, "/api/v1/admin/fingerprints?ip=not-an-ip", auth)).status).toBe(400);
    // attacker-controlled UA comes back as a plain JSON string, never interpreted
    expect((await list("q=alert")).rows[0].ua).toBe("<script>alert(1)</script>");
  });

  it("returns one stored document by id", async () => {
    const row = JSON.parse((await get(s.port, "/api/v1/admin/fingerprints?kind=api_get&limit=1", auth)).text).rows[0];
    const r = await get(s.port, "/api/v1/admin/fingerprint?id=" + row.id, auth);
    expect(r.status).toBe(200);
    expect(JSON.parse(r.text).doc.fingerprintId).toBe(row.id);
    expect((await get(s.port, "/api/v1/admin/fingerprint?id=nope", auth)).status).toBe(400);
    expect((await get(s.port, "/api/v1/admin/fingerprint?id=00000000-0000-4000-8000-000000000000", auth)).status).toBe(404);
  });

  it("shows the reverse-DNS hostname, filters on it, and treats LIKE wildcards literally", async () => {
    const reverseDns = { id: "network.reverse_dns", category: "network", source: "server", status: "observed", raw: null, normalized: ["scan-17.example-isp.net"] };
    const doc = {
      fingerprintId: "11111111-1111-4111-8111-111111111111",
      request: { method: "GET", httpVersion: "1.1", target: "/", scheme: "https", receivedAt: new Date().toISOString() },
      server: { network: [reverseDns], tls: [], http: [], http2: [], clientHints: [] },
      client: null,
      derived: [],
      interpretation: { assessments: [] },
    };
    await store.query("INSERT INTO fingerprint_docs (hash, first_seen, ja4, doc) VALUES ('hash-for-hostname-test', now(), NULL, $1)", [JSON.stringify(doc)]);
    await store.query(
      `INSERT INTO visits (id, seen_at, kind, client_ip, hostname, host, target, fingerprint)
       VALUES ($1, now(), 'page_view', '203.0.113.7', 'scan-17.example-isp.net', 'admin.example.org', '/', 'hash-for-hostname-test')`,
      [doc.fingerprintId],
    );
    const list = async (qs: string) => JSON.parse((await get(s.port, "/api/v1/admin/fingerprints?" + qs, auth)).text);
    const hit = await list("host=" + encodeURIComponent("example-isp"));
    expect(hit.rows).toHaveLength(1);
    expect(hit.rows[0]).toMatchObject({ ip: "203.0.113.7", hostname: "scan-17.example-isp.net", host: "admin.example.org" });
    expect((await list("host=" + encodeURIComponent("%"))).rows).toHaveLength(0);
    expect((await list("")).rows.filter((r: any) => r.hostname === null).length).toBeGreaterThan(0); // loopback visits have none
    const overview = JSON.parse((await get(s.port, "/api/v1/admin/overview?days=7", auth)).text);
    expect(overview.topIps.find((r: any) => r.ip === "203.0.113.7").hostname).toBe("scan-17.example-isp.net");
  });
});

// Last on purpose: ten failures lock this client IP out for the rest of the window (module-level state).
describe("admin brute-force lockout", () => {
  let s: { server: http.Server; port: number };
  beforeAll(async () => (s = await listen(createApp(loadConfig({ PLZBOT_MODE: "http", PLZBOT_ADMIN_PASSWORD: PASSWORD })))));
  afterAll(() => new Promise<void>((r) => s.server.close(() => r())));

  it("locks out an IP after repeated failures, even for the right password", async () => {
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await get(s.port, "/api/v1/admin/overview", basic("nope-nope-nope-1"))).status;
    expect(last).toBe(429);
    expect((await get(s.port, "/admin", basic(PASSWORD))).status).toBe(429);
  });
});
