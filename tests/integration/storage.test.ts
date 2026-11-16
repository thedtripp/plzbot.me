import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import pg from "pg";
import { createApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/runtime/config.js";
import { createStore, type FingerprintStore } from "../../src/server/storage/postgres.js";

/**
 * Needs a throwaway Postgres (it TRUNCATES `fingerprints`). Skipped unless set:
 *   docker run -d --rm -e POSTGRES_PASSWORD=test -e POSTGRES_DB=plzbot_test -p 54329:5432 postgres:16-alpine
 *   PLZBOT_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:54329/plzbot_test npm test
 */
const DB_URL = process.env.PLZBOT_TEST_DATABASE_URL;

function request(port: number, method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path, method, headers: { ...(body ? { "content-type": "application/json" } : {}), ...headers } }, (res) => {
      res.resume();
      res.on("end", resolve);
    });
    req.on("error", reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

describe.skipIf(!DB_URL)("fingerprint storage (Postgres)", () => {
  let db: pg.Pool;
  let store: FingerprintStore;
  let server: http.Server;
  let port: number;

  beforeAll(async () => {
    const config = loadConfig({ PLZBOT_MODE: "http", PLZBOT_DATABASE_URL: DB_URL });
    store = createStore(config, () => {})!;
    db = new pg.Pool({ connectionString: DB_URL, max: 2 });
    // The store creates its table in the background at startup; wait for it, then start clean.
    for (let i = 0; i < 60; i++) {
      if ((await db.query("SELECT to_regclass('fingerprints') AS t")).rows[0].t) break;
      await new Promise((r) => setTimeout(r, 50));
    }
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

  it("saves page views, API calls and browser submissions, but not static files", async () => {
    await request(port, "GET", "/", undefined, { "user-agent": "GPTBot/1.2" });
    await request(port, "GET", "/api/v1/fingerprint", undefined, { "user-agent": "curl/8.7.1" });
    await request(port, "POST", "/api/v1/fingerprint/client", { navigator: [{ id: "browser.navigator.language", category: "browser.navigator", source: "client", collectionMethod: "t", status: "observed", raw: "en-US", normalized: "en-US", observedAt: new Date().toISOString() }] });
    await request(port, "GET", "/styles.css");

    const deadline = Date.now() + 5000;
    let rows: any[] = [];
    while (rows.length < 3 && Date.now() < deadline) {
      rows = (await db.query("SELECT * FROM fingerprints")).rows;
      await new Promise((r) => setTimeout(r, 50));
    }
    expect(rows.map((r) => r.kind).sort()).toEqual(["api_get", "client_submit", "page_view"]);
    expect(rows.every((r) => r.client_ip === "127.0.0.1")).toBe(true);
    const browser = rows.find((r) => r.kind === "client_submit");
    expect(browser.doc.client.navigator).toHaveLength(1);
    expect(browser.doc.server.http.length).toBeGreaterThan(0);
  });
});

describe("storage without a database", () => {
  it("createStore returns null", () => {
    expect(createStore(loadConfig({ PLZBOT_MODE: "http" }), () => {})).toBeNull();
  });
});
