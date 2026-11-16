import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import pg from "pg";
import { createApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/runtime/config.js";
import { createStore, PostgresFingerprintStore, type FingerprintStore } from "../../src/server/storage/postgres.js";

/**
 * Needs a real Postgres: set PLZBOT_TEST_DATABASE_URL (it runs migrations and TRUNCATES the
 * `fingerprints` table, so point it at a throwaway database). Skipped otherwise.
 *   docker run -d --rm -e POSTGRES_PASSWORD=test -e POSTGRES_DB=plzbot_test -p 54329:5432 postgres:16-alpine
 *   PLZBOT_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:54329/plzbot_test npm test
 */
const DB_URL = process.env.PLZBOT_TEST_DATABASE_URL;

function request(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function waitForRows(db: pg.Pool, n: number, timeoutMs = 5000): Promise<any[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await db.query("SELECT * FROM fingerprints ORDER BY seen_at");
    if (rows.length >= n || Date.now() > deadline) return rows;
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe.skipIf(!DB_URL)("fingerprint storage (Postgres)", () => {
  let db: pg.Pool;
  let store: FingerprintStore;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const config = loadConfig({ PLZBOT_MODE: "http", PLZBOT_DATABASE_URL: DB_URL, PLZBOT_REQUIRE_STORE: "1", PLZBOT_STORE_RATE_PER_IP_PER_MIN: "0" });
    store = (await createStore(config, () => {}))!;
    db = new pg.Pool({ connectionString: DB_URL, max: 2 });
    await db.query("TRUNCATE fingerprints");
    server = http.createServer(createApp(config, store));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    port = (server.address() as any).port;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    await store.close();
    await db.end();
  });

  it("stores page views, API calls and browser submissions with the right kind", async () => {
    await request(port, "GET", "/", undefined, { "user-agent": "GPTBot/1.2 (+https://openai.com/gptbot)" });
    await request(port, "GET", "/api/v1/fingerprint", undefined, { "user-agent": "curl/8.7.1" });
    await request(port, "POST", "/api/v1/fingerprint/client", {
      navigator: [{ id: "browser.navigator.language", category: "browser.navigator", source: "client", collectionMethod: "t", status: "observed", raw: "en-US", normalized: "en-US", observedAt: new Date().toISOString() }],
    });
    // static assets and health checks are not fingerprints
    await request(port, "GET", "/styles.css");
    await request(port, "GET", "/healthz");

    const rows = await waitForRows(db, 3);
    expect(rows.map((r) => r.kind).sort()).toEqual(["api_get", "client_submit", "page_view"]);
    expect(rows).toHaveLength(3);

    const bot = rows.find((r) => r.kind === "page_view");
    expect(bot.agent_name).toBe("GPTBot");
    expect(bot.agent_category).toMatch(/ai/);
    expect(bot.client_ip).toBe("127.0.0.1");
    expect(bot.has_client).toBe(false);
    expect(bot.assessment_ids.length).toBeGreaterThan(0);

    const browser = rows.find((r) => r.kind === "client_submit");
    expect(browser.has_client).toBe(true);
    expect(browser.doc.client.navigator).toHaveLength(1);
    expect(browser.doc).not.toHaveProperty("interpretation");
    expect(browser.doc.server.network.length).toBeGreaterThan(3);
  });

  it("is queryable by jsonb path and by assessment id", async () => {
    const byAssessment = await db.query("SELECT count(*)::int AS n FROM fingerprints WHERE assessment_ids @> ARRAY['automation.non_browser_ua']");
    expect(byAssessment.rows[0].n).toBeGreaterThan(0);
    const byDoc = await db.query("SELECT count(*)::int AS n FROM fingerprints WHERE doc->'request'->>'method' = 'GET'");
    expect(byDoc.rows[0].n).toBeGreaterThan(0);
  });

  it("reports storage counters on /healthz without leaking the connection string", async () => {
    const { text } = await request(port, "GET", "/healthz");
    const body = JSON.parse(text);
    expect(body.storage.enabled).toBe(true);
    expect(body.storage.written).toBeGreaterThanOrEqual(3);
    expect(text).not.toContain("postgres://");
  });

  it("applies migrations idempotently on a second start", async () => {
    const again = await createStore(loadConfig({ PLZBOT_MODE: "http", PLZBOT_DATABASE_URL: DB_URL, PLZBOT_REQUIRE_STORE: "1" }), () => {});
    await again!.close();
    const { rows } = await db.query("SELECT version FROM schema_migrations");
    expect(rows.map((r) => r.version)).toEqual([1]);
  });

  it("retention sweep deletes only rows older than the window", async () => {
    await db.query("UPDATE fingerprints SET seen_at = now() - interval '200 days' WHERE kind = 'page_view'");
    const sweeper = new PostgresFingerprintStore(loadConfig({ PLZBOT_MODE: "http", PLZBOT_DATABASE_URL: DB_URL, PLZBOT_STORE_RETENTION_DAYS: "90" }));
    expect(await sweeper.sweep()).toBe(1);
    await sweeper.close();
    const { rows } = await db.query("SELECT kind FROM fingerprints");
    expect(rows.map((r) => r.kind)).not.toContain("page_view");
    expect(rows.length).toBe(2);
  });
});

describe("storage when no database is configured", () => {
  it("createStore returns null and the app still serves", async () => {
    const config = loadConfig({ PLZBOT_MODE: "http" });
    expect(await createStore(config, () => {})).toBeNull();
    const server = http.createServer(createApp(config, null));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const { status, text } = await request((server.address() as any).port, "GET", "/healthz");
    server.close();
    expect(status).toBe(200);
    expect(JSON.parse(text).storage).toEqual({ enabled: false });
  });
});
