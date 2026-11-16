/**
 * Ordered, append-only schema migrations. Never edit an applied migration; add a new one.
 *
 * Design (see docs/STORAGE.md): a handful of indexed columns for the things people filter and
 * group by, plus the complete fingerprint as jsonb so no signal is ever lost and new
 * collectors never need a migration. `interpretation` (prose assessments) is NOT stored in
 * `doc` because it is recomputable and changes whenever the rules change; only the assessment
 * ids are kept, in `assessment_ids`, so "which rules fired" stays queryable.
 */
export const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  {
    version: 1,
    sql: `
CREATE TABLE fingerprints (
  id              uuid        PRIMARY KEY,           -- fingerprintId from the document
  seen_at         timestamptz NOT NULL,              -- when the request was received
  kind            text        NOT NULL,              -- page_view | api_get | client_submit
  client_ip       inet,                              -- resolved client address (trusted-proxy aware), raw
  peer_ip         inet,                              -- the actual TCP peer (differs from client_ip behind a proxy)
  asn             integer,                           -- from the offline ip2asn table, when configured
  http_version    text        NOT NULL,
  target          text        NOT NULL,              -- request path + query
  user_agent      text,
  ja3_hash        text,
  ja4             text,
  h2_fingerprint  text,                              -- partial Akamai-style HTTP/2 fingerprint
  ua_family       text,                              -- derived browser family guess from the UA
  agent_name      text,                              -- matched self-identified agent/library, if any
  agent_category  text,
  assessment_ids  text[]      NOT NULL DEFAULT '{}', -- ids of the interpretation rules that fired
  has_client      boolean     NOT NULL,              -- browser collector data present
  schema_version  text        NOT NULL,
  doc             jsonb       NOT NULL               -- full fingerprint minus interpretation
);
CREATE INDEX fingerprints_seen_at_idx   ON fingerprints (seen_at DESC);
CREATE INDEX fingerprints_client_ip_idx ON fingerprints (client_ip, seen_at DESC);
CREATE INDEX fingerprints_ja4_idx       ON fingerprints (ja4) WHERE ja4 IS NOT NULL;
CREATE INDEX fingerprints_ja3_idx       ON fingerprints (ja3_hash) WHERE ja3_hash IS NOT NULL;
CREATE INDEX fingerprints_agent_idx     ON fingerprints (agent_category, agent_name) WHERE agent_name IS NOT NULL;
CREATE INDEX fingerprints_assess_idx    ON fingerprints USING gin (assessment_ids);
`,
  },
];
