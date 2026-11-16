import net from "node:net";
import pg from "pg";
import type { Fingerprint } from "../../shared/schema/types.js";
import type { RuntimeConfig } from "../runtime/config.js";
import { StorageLimiter, limiterKey } from "./rateLimit.js";

/** page_view = HTML request, api_get = GET /api/v1/fingerprint, client_submit = browser POST. */
export type FingerprintKind = "page_view" | "api_get" | "client_submit";

export interface FingerprintStore {
  /** Fire-and-forget: never throws and never blocks the request. */
  save(fp: Fingerprint, kind: FingerprintKind): void;
  /** Read-only helper for the analysis page. Waits for the table to exist. */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  /** Write the in-memory counts of rate-limited records to the database now. */
  flushSuppressed(): Promise<void>;
  close(): Promise<void>;
}

// The whole fingerprint goes in `doc`; the other columns are just the things worth indexing.
// Everything else is queryable through jsonb, e.g. doc->'request'->>'httpVersion'.
// `suppressed_fingerprints` counts records that were NOT saved because of a rate limit, per hour,
// IP and tier (fast / medium / slow / size), so a flood stays visible without filling the database.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS fingerprints (
  id        uuid        PRIMARY KEY,
  seen_at   timestamptz NOT NULL,
  kind      text        NOT NULL,
  client_ip inet,
  ja4       text,
  doc       jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS fingerprints_seen_at_idx ON fingerprints (seen_at DESC);
CREATE INDEX IF NOT EXISTS fingerprints_client_ip_idx ON fingerprints (client_ip);
CREATE INDEX IF NOT EXISTS fingerprints_ja4_idx ON fingerprints (ja4);
CREATE TABLE IF NOT EXISTS suppressed_fingerprints (
  hour timestamptz NOT NULL,
  ip   inet        NOT NULL,
  tier text        NOT NULL,
  n    integer     NOT NULL,
  PRIMARY KEY (hour, ip, tier)
);`;

const MAX_PENDING = 1000; // if the database is down, stop queueing instead of growing memory forever
const FLUSH_EVERY_MS = 60_000;
const SIZE_CHECK_EVERY_MS = 5 * 60_000;

function clientIp(fp: Fingerprint): string | null {
  const obs = fp.server.network.find((o) => o.id === "network.client_ip" && o.status === "observed")
    ?? fp.server.network.find((o) => o.id === "network.remote_ip" && o.status === "observed");
  let ip = typeof obs?.raw === "string" ? obs.raw.replace(/%.*$/, "").replace(/^::ffff:(?=\d+\.)/i, "") : "";
  return net.isIP(ip) ? ip : null;
}

export function createStore(config: RuntimeConfig, log: (msg: string) => void): FingerprintStore | null {
  if (!config.databaseUrl) return null;
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4, connectionTimeoutMillis: 5000, statement_timeout: 15_000 });
  pool.on("error", (err) => log(`[store] ${err.message}`));

  const limiter = new StorageLimiter([
    { name: "fast", windowMs: 60_000, max: config.storeLimitPerMinute },
    { name: "medium", windowMs: 3_600_000, max: config.storeLimitPerHour },
    { name: "slow", windowMs: 86_400_000, max: config.storeLimitPerDay },
  ]);

  let schemaReady: Promise<unknown> | null = null;
  const ensureSchema = () =>
    (schemaReady ??= pool.query(SCHEMA).catch((err) => {
      schemaReady = null; // retry on the next save
      throw err;
    }));

  // Counts of records not saved, keyed by hour|ip|tier; flushed to the database every minute.
  let suppressed = new Map<string, { hour: string; ip: string; tier: string; n: number }>();
  const countSuppressed = (ip: string | null, tier: string) => {
    const hour = new Date(Math.floor(Date.now() / 3_600_000) * 3_600_000).toISOString();
    const addr = ip ?? "0.0.0.0"; // inet cannot be NULL in the key; 0.0.0.0 = no usable address
    const key = `${hour}|${addr}|${tier}`;
    const row = suppressed.get(key);
    if (row) row.n++;
    else suppressed.set(key, { hour, ip: addr, tier, n: 1 });
  };

  const flushSuppressed = async () => {
    if (suppressed.size === 0) return;
    const batch = suppressed;
    suppressed = new Map();
    try {
      await ensureSchema();
      for (const r of batch.values()) {
        await pool.query(
          `INSERT INTO suppressed_fingerprints (hour, ip, tier, n) VALUES ($1, $2, $3, $4)
           ON CONFLICT (hour, ip, tier) DO UPDATE SET n = suppressed_fingerprints.n + EXCLUDED.n`,
          [r.hour, r.ip, r.tier, r.n],
        );
      }
    } catch (err) {
      log(`[store] could not record rate-limited counts: ${(err as Error).message}`);
      for (const [k, r] of batch) {
        const again = suppressed.get(k);
        if (again) again.n += r.n;
        else suppressed.set(k, r);
      }
    }
  };

  // Overall size guard: past the cap, stop saving full records (they are counted as tier "size").
  let overCap = false;
  const checkSize = async () => {
    if (config.storeMaxTableMb <= 0) return;
    try {
      await ensureSchema();
      const { rows } = await pool.query<{ bytes: string }>("SELECT pg_total_relation_size('fingerprints')::bigint AS bytes");
      const over = Number(rows[0]?.bytes ?? 0) > config.storeMaxTableMb * 1024 * 1024;
      if (over !== overCap) log(over ? `[store] fingerprints table passed ${config.storeMaxTableMb} MB: saving paused, counting only` : "[store] table size back under the cap: saving resumed");
      overCap = over;
    } catch (err) {
      log(`[store] size check failed: ${(err as Error).message}`);
    }
  };

  // Verify the connection and create the tables at startup; a failure is logged, and saves retry.
  ensureSchema().then(
    () => {
      log("[store] fingerprint storage enabled");
      void checkSize();
    },
    (err) => log(`[store] database unreachable (${err.message}); will retry on next save`),
  );
  const timers = [setInterval(() => void flushSuppressed(), FLUSH_EVERY_MS), setInterval(() => void checkSize(), SIZE_CHECK_EVERY_MS)];
  timers.forEach((t) => t.unref());

  return {
    save(fp, kind) {
      const ip = clientIp(fp);
      const denied = overCap ? "size" : limiter.check(limiterKey(ip));
      if (denied) {
        countSuppressed(ip, denied);
        return;
      }
      if (pool.waitingCount > MAX_PENDING) return;
      ensureSchema()
        .then(() =>
          pool.query(
            "INSERT INTO fingerprints (id, seen_at, kind, client_ip, ja4, doc) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
            [
              fp.fingerprintId,
              fp.request.receivedAt,
              kind,
              ip,
              fp.derived.find((d) => d.id === "derived.ja4")?.value ?? null,
              JSON.stringify(fp),
            ],
          ),
        )
        .catch((err) => log(`[store] could not save fingerprint ${fp.fingerprintId}: ${err.message}`));
    },
    async query(sql, params = []) {
      await ensureSchema();
      return (await pool.query(sql, params)).rows;
    },
    flushSuppressed,
    async close() {
      timers.forEach((t) => clearInterval(t));
      await flushSuppressed();
      await pool.end().catch(() => {});
    },
  };
}
