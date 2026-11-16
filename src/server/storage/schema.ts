import type { Fingerprint } from "../../shared/schema/types.js";
import type { FingerprintKind } from "./postgres.js";
import type { VisitFields } from "./dedupe.js";

/**
 * Two tables, so an identical fingerprint is stored once however often it is seen:
 *  - fingerprint_docs: one row per distinct fingerprint (see dedupe.ts for what "distinct" means).
 *    `doc` is the complete record of the FIRST visit that produced it, so it still contains that
 *    visit's own per-request values (its Host header, IP, ports, timestamps). Per-visit values
 *    for every visit live in `visits`.
 *  - visits: one small row per request (about 150 bytes): when, kind, IP, reverse-DNS name,
 *    Host header and path, pointing at its fingerprint.
 * suppressed_fingerprints counts visits that were NOT recorded because of a rate limit, per hour,
 * IP and tier (fast / medium / slow / size), so a flood stays visible without filling the database.
 */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS fingerprint_docs (
  hash       text        PRIMARY KEY,
  first_seen timestamptz NOT NULL,
  ja4        text,
  doc        jsonb       NOT NULL
);
CREATE INDEX IF NOT EXISTS fingerprint_docs_ja4_idx ON fingerprint_docs (ja4);
CREATE TABLE IF NOT EXISTS visits (
  id          uuid        PRIMARY KEY,
  seen_at     timestamptz NOT NULL,
  kind        text        NOT NULL,
  client_ip   inet,
  hostname    text,
  host        text,
  target      text,
  fingerprint text        NOT NULL REFERENCES fingerprint_docs (hash)
);
CREATE INDEX IF NOT EXISTS visits_seen_at_idx ON visits (seen_at DESC);
CREATE INDEX IF NOT EXISTS visits_client_ip_idx ON visits (client_ip);
CREATE INDEX IF NOT EXISTS visits_fingerprint_idx ON visits (fingerprint);
CREATE TABLE IF NOT EXISTS suppressed_fingerprints (
  hour timestamptz NOT NULL,
  ip   inet        NOT NULL,
  tier text        NOT NULL,
  n    integer     NOT NULL,
  PRIMARY KEY (hour, ip, tier)
);`;

/** Stores the fingerprint document if it is new, and always the visit. One statement, so no visit is ever left without its document. */
export const INSERT_VISIT = `
WITH d AS (
  INSERT INTO fingerprint_docs (hash, first_seen, ja4, doc) VALUES ($1, $2::timestamptz, $3, $4::jsonb) ON CONFLICT (hash) DO NOTHING
)
INSERT INTO visits (id, seen_at, kind, client_ip, hostname, host, target, fingerprint)
VALUES ($5, $2::timestamptz, $6, $7::inet, $8, $9, $10, $1) ON CONFLICT (id) DO NOTHING`;

export function visitParams(fp: unknown | Fingerprint, v: VisitFields, id: string, seenAt: string, kind: FingerprintKind | string, ip: string | null): unknown[] {
  return [v.hash, seenAt, v.ja4, JSON.stringify(fp), id, kind, ip, v.hostname, v.host, v.target];
}
