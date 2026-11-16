import pg from "pg";
import type { Fingerprint } from "../../shared/schema/types.js";
import type { RuntimeConfig } from "../runtime/config.js";
import { BatchQueue, RateLimiter, type BatchQueueStats } from "./batchQueue.js";
import { toRow, type FingerprintKind, type FingerprintRow } from "./fingerprintRow.js";
import { MIGRATIONS } from "./migrations.js";

export interface StoreStats extends BatchQueueStats {
  rateLimited: number;
  retentionDays: number;
}

export interface FingerprintStore {
  /** Fire-and-forget: never throws, never blocks the request. */
  save(fp: Fingerprint, kind: FingerprintKind): void;
  stats(): StoreStats;
  close(): Promise<void>;
}

const COLUMNS = [
  "id", "seen_at", "kind", "client_ip", "peer_ip", "asn", "http_version", "target", "user_agent",
  "ja3_hash", "ja4", "h2_fingerprint", "ua_family", "agent_name", "agent_category",
  "assessment_ids", "has_client", "schema_version", "doc",
] as const;
const CASTS: Partial<Record<(typeof COLUMNS)[number], string>> = {
  client_ip: "::inet",
  peer_ip: "::inet",
  seen_at: "::timestamptz",
  doc: "::jsonb",
};
const MIGRATION_LOCK_KEY = 727_274_001;

function rowParams(r: FingerprintRow): unknown[] {
  return COLUMNS.map((c) => (c === "doc" ? JSON.stringify(r.doc) : r[c]));
}

export class PostgresFingerprintStore implements FingerprintStore {
  private readonly pool: pg.Pool;
  private readonly queue: BatchQueue<FingerprintRow>;
  private readonly limiter: RateLimiter;
  private sweepTimer: NodeJS.Timeout | null = null;
  private migrated: Promise<void> | null = null;
  private rateLimited = 0;

  constructor(
    private readonly config: Pick<RuntimeConfig, "databaseUrl" | "storeRetentionDays" | "storeRatePerIpPerMin" | "storeMaxQueue">,
    private readonly log: (msg: string) => void = () => {},
    pool?: pg.Pool,
  ) {
    this.pool =
      pool ??
      new pg.Pool({
        connectionString: config.databaseUrl ?? undefined,
        max: 4,
        connectionTimeoutMillis: 5000,
        idleTimeoutMillis: 30_000,
      });
    // An idle client erroring (server restart, network blip) must not crash the process.
    this.pool.on("error", (err) => this.log(`[store] idle connection error: ${err.message}`));
    this.limiter = new RateLimiter(config.storeRatePerIpPerMin);
    this.queue = new BatchQueue<FingerprintRow>({
      sink: (batch) => this.insert(batch),
      maxQueue: config.storeMaxQueue,
      log,
    });
  }

  /** Connect, apply migrations, start the retention sweep. Throws if the database is unreachable. */
  async init(): Promise<void> {
    await this.ensureMigrated();
    if (this.config.storeRetentionDays > 0) {
      void this.sweep();
      this.sweepTimer = setInterval(() => void this.sweep(), 60 * 60 * 1000);
      this.sweepTimer.unref();
    }
  }

  private ensureMigrated(): Promise<void> {
    // Only cache success: if the DB was down at startup we retry on the next write.
    this.migrated ??= this.migrate().catch((err) => {
      this.migrated = null;
      throw err;
    });
    return this.migrated;
  }

  private async migrate(): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_KEY]);
      await client.query(
        "CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())",
      );
      const { rows } = await client.query<{ version: number }>("SELECT version FROM schema_migrations");
      const applied = new Set(rows.map((r) => r.version));
      for (const m of MIGRATIONS) {
        if (applied.has(m.version)) continue;
        await client.query("BEGIN");
        try {
          await client.query(m.sql);
          await client.query("INSERT INTO schema_migrations (version) VALUES ($1)", [m.version]);
          await client.query("COMMIT");
          this.log(`[store] applied migration ${m.version}`);
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_KEY]).catch(() => {});
      client.release();
    }
  }

  private async insert(batch: FingerprintRow[]): Promise<void> {
    await this.ensureMigrated();
    const params: unknown[] = [];
    const tuples = batch.map((row, i) => {
      params.push(...rowParams(row));
      const base = i * COLUMNS.length;
      return `(${COLUMNS.map((c, j) => `$${base + j + 1}${CASTS[c] ?? ""}`).join(", ")})`;
    });
    // ON CONFLICT makes a retried batch idempotent.
    await this.pool.query(
      `INSERT INTO fingerprints (${COLUMNS.join(", ")}) VALUES ${tuples.join(", ")} ON CONFLICT (id) DO NOTHING`,
      params,
    );
  }

  save(fp: Fingerprint, kind: FingerprintKind): void {
    try {
      const row = toRow(fp, kind);
      if (!this.limiter.allow(row.client_ip ?? "unknown")) {
        this.rateLimited++;
        return;
      }
      this.queue.push(row);
    } catch (err) {
      this.log(`[store] could not prepare record: ${(err as Error).message}`);
    }
  }

  /** Delete rows older than the retention window, in bounded chunks. */
  async sweep(): Promise<number> {
    const days = this.config.storeRetentionDays;
    if (days <= 0) return 0;
    let total = 0;
    try {
      await this.ensureMigrated();
      for (;;) {
        const res = await this.pool.query(
          `DELETE FROM fingerprints WHERE id IN (
             SELECT id FROM fingerprints WHERE seen_at < now() - make_interval(days => $1) LIMIT 5000)`,
          [days],
        );
        total += res.rowCount ?? 0;
        if ((res.rowCount ?? 0) < 5000) break;
      }
      if (total > 0) this.log(`[store] retention sweep removed ${total} record(s) older than ${days} days`);
    } catch (err) {
      this.log(`[store] retention sweep failed: ${(err as Error).message}`);
    }
    return total;
  }

  stats(): StoreStats {
    return { ...this.queue.stats(), rateLimited: this.rateLimited, retentionDays: this.config.storeRetentionDays };
  }

  async close(): Promise<void> {
    if (this.sweepTimer) clearInterval(this.sweepTimer);
    await this.queue.close();
    await this.pool.end().catch(() => {});
  }
}

/**
 * Build the store from config. Returns null when no database is configured. With
 * PLZBOT_REQUIRE_STORE=1 an unreachable database is fatal at startup; otherwise the server
 * starts anyway, logs loudly, and the queue keeps retrying so no data is lost to a brief outage.
 */
export async function createStore(config: RuntimeConfig, log: (msg: string) => void): Promise<FingerprintStore | null> {
  if (!config.databaseUrl) return null;
  const store = new PostgresFingerprintStore(config, log);
  try {
    await store.init();
    log(`[store] fingerprint storage enabled (retention ${config.storeRetentionDays || "forever"} days)`);
  } catch (err) {
    if (config.requireStore) {
      await store.close();
      throw new Error(`PLZBOT_REQUIRE_STORE is set and the database is unreachable: ${(err as Error).message}`);
    }
    log(`[store] database unreachable at startup (${(err as Error).message}); will keep retrying, records are queued in memory`);
  }
  return store;
}
