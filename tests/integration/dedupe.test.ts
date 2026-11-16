import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import pg from "pg";
import { createApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/runtime/config.js";
import { createStore } from "../../src/server/storage/postgres.js";
import { resetStoreTables } from "../helpers/db.js";

/** Needs a throwaway Postgres (it drops and recreates the storage tables); skipped unless PLZBOT_TEST_DATABASE_URL is set. */
const DB_URL = process.env.PLZBOT_TEST_DATABASE_URL;
const PASSWORD = "correct-horse-battery";
const auth = { authorization: "Basic " + Buffer.from(`a:${PASSWORD}`).toString("base64") };

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject);
  });
}

const NO_LIMITS = { PLZBOT_STORE_LIMIT_PER_MINUTE: "0", PLZBOT_STORE_LIMIT_PER_HOUR: "0", PLZBOT_STORE_LIMIT_PER_DAY: "0" };
const cfg = (extra: Record<string, string> = {}) =>
  loadConfig({ PLZBOT_MODE: "http", PLZBOT_DATABASE_URL: DB_URL, PLZBOT_ADMIN_PASSWORD: PASSWORD, ...NO_LIMITS, ...extra });

async function listen(handler: http.RequestListener) {
  const server = http.createServer(handler);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, port: (server.address() as any).port as number };
}
const n = async (db: pg.Pool, table: string) => Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
const until = async (check: () => Promise<boolean>) => {
  for (let i = 0; i < 100 && !(await check()); i++) await new Promise((r) => setTimeout(r, 50));
};

describe.skipIf(!DB_URL)("identical fingerprints are stored once; every visit is kept", () => {
  let db: pg.Pool;
  beforeAll(() => {
    db = new pg.Pool({ connectionString: DB_URL, max: 2 });
  });
  afterAll(() => db.end());

  it("stores one fingerprint for 6 visits that differ only by Host, and keeps each Host on its visit", async () => {
    const config = cfg();
    const store = createStore(config, () => {})!;
    await resetStoreTables(db);
    const app = await listen(createApp(config, store));
    const ua = { "user-agent": "scanner-test/1.0" };
    for (const host of ["admin.example.org", "api.example.org", "backup.example.org", "ci.example.org", "cdn.example.org", "app.example.org"]) {
      await get(app.port, "/", { ...ua, host });
    }
    await get(app.port, "/", { "user-agent": "a-different-client/2.0" });
    await until(async () => (await n(db, "visits")) >= 7);

    expect(await n(db, "visits")).toBe(7);
    expect(await n(db, "fingerprint_docs")).toBe(2); // the scanner's six visits share one; the other client has its own
    const hosts = (await db.query("SELECT host FROM visits WHERE host LIKE '%.example.org' ORDER BY host")).rows.map((r) => r.host);
    expect(hosts).toEqual(["admin.example.org", "api.example.org", "app.example.org", "backup.example.org", "cdn.example.org", "ci.example.org"]);

    const overview = JSON.parse(await get(app.port, "/api/v1/admin/overview?days=1", auth));
    expect(overview.totals).toMatchObject({ total: 7, fingerprints: 2, all_time: 7, distinct_all_time: 2 });
    const list = JSON.parse(await get(app.port, "/api/v1/admin/fingerprints?q=scanner-test", auth));
    expect(list.rows).toHaveLength(6);
    const detail = JSON.parse(await get(app.port, "/api/v1/admin/fingerprint?id=" + list.rows[0].id, auth));
    expect(detail.visits_with_this_fingerprint).toBe(6);
    expect(detail.host).toMatch(/\.example\.org$/);

    await new Promise<void>((r) => app.server.close(() => r()));
    await store.close();
  });

  it("moves existing one-document-per-visit records into the new layout without losing any", async () => {
    // Build the OLD layout by hand, filled with real fingerprint documents.
    const probe = await listen(createApp(cfg({ PLZBOT_DATABASE_URL: "" }), null));
    const docs = [
      JSON.parse(await get(probe.port, "/api/v1/fingerprint", { "user-agent": "legacy-client-a/1.0", host: "one.example.org" })),
      JSON.parse(await get(probe.port, "/api/v1/fingerprint", { "user-agent": "legacy-client-b/1.0" })),
    ];
    await new Promise<void>((r) => probe.server.close(() => r()));
    await db.query("DROP TABLE IF EXISTS visits, fingerprint_docs, suppressed_fingerprints, fingerprints, fingerprints_legacy CASCADE");
    await db.query("CREATE TABLE fingerprints (id uuid PRIMARY KEY, seen_at timestamptz NOT NULL, kind text NOT NULL, client_ip inet, ja4 text, doc jsonb NOT NULL)");
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const doc = { ...docs[i < 3 ? 0 : 1] }; // 3 visits of client A, 2 of client B
      doc.fingerprintId = `00000000-0000-4000-8000-00000000000${i}`;
      ids.push(doc.fingerprintId);
      await db.query("INSERT INTO fingerprints (id, seen_at, kind, client_ip, ja4, doc) VALUES ($1, now() - ($2 || ' minutes')::interval, 'page_view', '198.51.100.7', NULL, $3)", [doc.fingerprintId, String(i), JSON.stringify(doc)]);
    }

    const store = createStore(cfg(), () => {})!;
    await store.query("SELECT 1"); // waits for the schema and the migration
    expect(await n(db, "visits")).toBe(5);
    expect(await n(db, "fingerprint_docs")).toBe(2);
    expect((await db.query("SELECT id FROM visits ORDER BY id")).rows.map((r) => r.id)).toEqual(ids);
    const first = (await db.query("SELECT host, host(client_ip) AS ip FROM visits WHERE id = $1", [ids[0]])).rows[0];
    expect(first).toMatchObject({ host: "one.example.org", ip: "198.51.100.7" });

    // The old table is kept, renamed, with every row; nothing was deleted.
    expect((await db.query("SELECT to_regclass('public.fingerprints') AS t")).rows[0].t).toBeNull();
    expect(await n(db, "fingerprints_legacy")).toBe(5);

    // A second start is a no-op.
    await store.close();
    const again = createStore(cfg(), () => {})!;
    await again.query("SELECT 1");
    expect(await n(db, "visits")).toBe(5);
    await again.close();
  });
});
