import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import pg from "pg";
import { createApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/runtime/config.js";
import { createStore, type FingerprintStore } from "../../src/server/storage/postgres.js";

/** Needs a throwaway Postgres (it TRUNCATES tables); skipped unless PLZBOT_TEST_DATABASE_URL is set. */
const DB_URL = process.env.PLZBOT_TEST_DATABASE_URL;
const PASSWORD = "correct-horse-battery";

function get(port: number, path: string, headers: Record<string, string> = {}): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: "127.0.0.1", port, path, headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode ?? 0, text: Buffer.concat(chunks).toString("utf8") }));
    }).on("error", reject);
  });
}

async function startApp(env: Record<string, string>) {
  const config = loadConfig({ PLZBOT_MODE: "http", PLZBOT_DATABASE_URL: DB_URL, PLZBOT_ADMIN_PASSWORD: PASSWORD, ...env });
  const store = createStore(config, () => {})!;
  await store.query("SELECT 1");
  await store.query("TRUNCATE visits, fingerprint_docs, suppressed_fingerprints");
  const server = http.createServer(createApp(config, store));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, store, port: (server.address() as any).port as number };
}

const count = async (db: pg.Pool, table: string) => Number((await db.query(`SELECT count(*) AS n FROM ${table}`)).rows[0].n);
const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

describe.skipIf(!DB_URL)("rate limits on saving (Postgres)", () => {
  let db: pg.Pool;
  beforeAll(() => {
    db = new pg.Pool({ connectionString: DB_URL, max: 2 });
  });
  afterAll(() => db.end());

  it("saves up to the fast limit, counts the rest, and still answers every request", async () => {
    const app = await startApp({ PLZBOT_STORE_LIMIT_PER_MINUTE: "3" });
    const statuses: number[] = [];
    for (let i = 0; i < 8; i++) statuses.push((await get(app.port, "/api/v1/fingerprint")).status);
    expect(statuses.every((s) => s === 200)).toBe(true); // visitors are never refused
    await settle();
    await app.store.flushSuppressed();
    expect(await count(db, "visits")).toBe(3);
    const rows = (await db.query("SELECT host(ip) AS ip, tier, n FROM suppressed_fingerprints")).rows;
    expect(rows).toEqual([{ ip: "127.0.0.1", tier: "fast", n: 5 }]);

    const overview = JSON.parse((await get(app.port, "/api/v1/admin/overview?days=1", { authorization: "Basic " + Buffer.from(`a:${PASSWORD}`).toString("base64") })).text);
    expect(overview.notSaved.byTier).toEqual([{ tier: "fast", n: 5 }]);
    expect(overview.notSaved.topIps[0]).toMatchObject({ ip: "127.0.0.1", n: 5, tiers: "fast" });

    await new Promise<void>((r) => app.server.close(() => r()));
    await app.store.close();
  });

  it("pauses saving, and counts instead, once the table is over the size cap", async () => {
    const app = await startApp({ PLZBOT_STORE_MAX_TABLE_MB: "1", PLZBOT_STORE_LIMIT_PER_MINUTE: "0", PLZBOT_STORE_LIMIT_PER_HOUR: "0", PLZBOT_STORE_LIMIT_PER_DAY: "0" });
    // Push the table past 1 MB with filler rows, then wait for the size check to notice.
    await db.query(
      `INSERT INTO fingerprint_docs (hash, first_seen, ja4, doc)
       SELECT md5(g::text), now(), NULL, jsonb_build_object('pad', (SELECT string_agg(md5(random()::text || g::text || i::text), '') FROM generate_series(1, 3000) i))
       FROM generate_series(1, 60) g`,
    );
    const before = await count(db, "visits");
    expect(Number((await db.query("SELECT pg_total_relation_size('fingerprint_docs') AS b")).rows[0].b)).toBeGreaterThan(1024 * 1024);
    // The size check runs at startup and every 5 minutes, so start a fresh store to notice the big table.
    await new Promise<void>((r) => app.server.close(() => r()));
    await app.store.close();

    const paused = await startAppKeepingRows({ PLZBOT_STORE_MAX_TABLE_MB: "1" });
    await settle(600); // startup size check
    for (let i = 0; i < 4; i++) await get(paused.port, "/api/v1/fingerprint");
    await settle();
    await paused.store.flushSuppressed();
    expect(await count(db, "visits")).toBe(before); // nothing new saved
    const rows = (await db.query("SELECT tier, sum(n)::int AS n FROM suppressed_fingerprints GROUP BY tier")).rows;
    expect(rows).toEqual([{ tier: "size", n: 4 }]);
    await new Promise<void>((r) => paused.server.close(() => r()));
    await paused.store.close();
  });
});

/** Like startApp, but keeps the existing rows (the size-cap test needs the table to stay big). */
async function startAppKeepingRows(env: Record<string, string>) {
  const config = loadConfig({ PLZBOT_MODE: "http", PLZBOT_DATABASE_URL: DB_URL, PLZBOT_ADMIN_PASSWORD: PASSWORD, ...env });
  const store = createStore(config, () => {})!;
  await store.query("TRUNCATE suppressed_fingerprints");
  const server = http.createServer(createApp(config, store));
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { server, store, port: (server.address() as any).port as number };
}
