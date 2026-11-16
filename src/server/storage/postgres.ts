import net from "node:net";
import pg from "pg";
import type { Fingerprint } from "../../shared/schema/types.js";
import type { RuntimeConfig } from "../runtime/config.js";

/** page_view = HTML request, api_get = GET /api/v1/fingerprint, client_submit = browser POST. */
export type FingerprintKind = "page_view" | "api_get" | "client_submit";

export interface FingerprintStore {
  /** Fire-and-forget: never throws and never blocks the request. */
  save(fp: Fingerprint, kind: FingerprintKind): void;
  close(): Promise<void>;
}

// The whole fingerprint goes in `doc`; the other columns are just the things worth indexing.
// Everything else is queryable through jsonb, e.g. doc->'request'->>'httpVersion'.
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
CREATE INDEX IF NOT EXISTS fingerprints_ja4_idx ON fingerprints (ja4);`;

const MAX_PENDING = 1000; // if the database is down, stop queueing instead of growing memory forever

function clientIp(fp: Fingerprint): string | null {
  const obs = fp.server.network.find((o) => o.id === "network.client_ip" && o.status === "observed")
    ?? fp.server.network.find((o) => o.id === "network.remote_ip" && o.status === "observed");
  let ip = typeof obs?.raw === "string" ? obs.raw.replace(/%.*$/, "").replace(/^::ffff:(?=\d+\.)/i, "") : "";
  return net.isIP(ip) ? ip : null;
}

export function createStore(config: RuntimeConfig, log: (msg: string) => void): FingerprintStore | null {
  if (!config.databaseUrl) return null;
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 4, connectionTimeoutMillis: 5000 });
  pool.on("error", (err) => log(`[store] ${err.message}`));

  let schemaReady: Promise<unknown> | null = null;
  const ensureSchema = () =>
    (schemaReady ??= pool.query(SCHEMA).catch((err) => {
      schemaReady = null; // retry on the next save
      throw err;
    }));

  // Verify the connection and create the table at startup; a failure is logged, and saves retry.
  ensureSchema().then(
    () => log("[store] fingerprint storage enabled"),
    (err) => log(`[store] database unreachable (${err.message}); will retry on next save`),
  );

  return {
    save(fp, kind) {
      if (pool.waitingCount > MAX_PENDING) return;
      ensureSchema()
        .then(() =>
          pool.query(
            "INSERT INTO fingerprints (id, seen_at, kind, client_ip, ja4, doc) VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (id) DO NOTHING",
            [
              fp.fingerprintId,
              fp.request.receivedAt,
              kind,
              clientIp(fp),
              fp.derived.find((d) => d.id === "derived.ja4")?.value ?? null,
              JSON.stringify(fp),
            ],
          ),
        )
        .catch((err) => log(`[store] could not save fingerprint ${fp.fingerprintId}: ${err.message}`));
    },
    close: () => pool.end().catch(() => {}),
  };
}
