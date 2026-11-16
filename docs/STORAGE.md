# Storing fingerprints

Set `PLZBOT_DATABASE_URL` (or `DATABASE_URL`) to a Postgres connection string and the server saves
every fingerprint it builds. Unset, nothing is stored. Migrations run automatically at startup.

## What gets recorded

| `kind` | Trigger | Contains |
|---|---|---|
| `page_view` | `GET /` or `/index.html` | Server-observed half only. The only record a crawler or AI agent leaves if it never runs JavaScript. |
| `api_get` | `GET /api/v1/fingerprint` | Server-observed half (curl, scripts, agents asking for their own footprint). |
| `client_submit` | `POST /api/v1/fingerprint/client` | Server half plus the browser collector's signals. |

A visit by a normal browser therefore produces two rows: a `page_view` and a `client_submit`.
Static assets, `/healthz`, `/api/v1/signals` and 404s are not recorded.

## Schema (`fingerprints`)

Indexed columns for what people filter and group by, plus the whole document as `jsonb`, so no
signal is ever lost and a new collector needs no migration.

| Column | Notes |
|---|---|
| `id`, `seen_at`, `kind` | `id` is the document's `fingerprintId`. |
| `client_ip`, `peer_ip` | Raw addresses (`inet`). `client_ip` honors the trusted-proxy config; `peer_ip` is the TCP peer. |
| `asn` | Only when `PLZBOT_IP2ASN_PATH` is configured. |
| `http_version`, `target`, `user_agent` | |
| `ja3_hash`, `ja4`, `h2_fingerprint` | Null in `PLZBOT_MODE=http` (TLS terminated upstream). |
| `ua_family`, `agent_name`, `agent_category` | From the derived attributes and the agent signature table. |
| `assessment_ids` | Ids of the interpretation rules that fired (GIN-indexed). |
| `has_client`, `schema_version` | |
| `doc` | Full fingerprint **without** `interpretation`. The prose is recomputable from the stored observations and changes whenever the rules do. |

Size: about 7 KB per server-only record and about 25 KB per browser record, after Postgres
compresses the jsonb. 1M browser visits is roughly 25 to 50 GB with indexes, so check your plan.

## Operational behavior

- **The request path never waits on the database.** Records go into a bounded in-memory queue and
  are written in batches. If Postgres is down, the queue retries with backoff; if it fills
  (`PLZBOT_STORE_MAX_QUEUE`), the *oldest* records are dropped and counted. A hard crash can lose
  whatever is still queued (under a second of traffic when the database is healthy).
- **Visible health.** `GET /healthz` reports `queued`, `written`, `dropped`, `failedBatches`,
  `lastError`, `rateLimited`. Alert on `dropped > 0` or a growing `queued`.
- **Abuse guard.** At most `PLZBOT_STORE_RATE_PER_IP_PER_MIN` records per client IP per minute.
  Client-submitted JSON is capped at 512 KB per request.
- **Retention.** Rows older than `PLZBOT_STORE_RETENTION_DAYS` (default 90) are deleted hourly.
- **Shutdown.** SIGINT/SIGTERM flush the queue before exit.
- **Secrets.** The connection string is never logged or returned by any endpoint. Cookie values
  and `Authorization` values are never collected (names / presence only).

## Backups

The bundled `postgres` service keeps data in the `pgdata` volume. Back it up:

```sh
docker compose exec -T postgres pg_dump -U plzbot plzbot | gzip > plzbot-$(date +%F).sql.gz
```

## Example queries

```sql
-- What do GPTBot / ClaudeBot / etc. look like at the TLS layer?
SELECT agent_name, ja4, count(*) FROM fingerprints
WHERE agent_category LIKE 'ai_%' GROUP BY 1, 2 ORDER BY 3 DESC;

-- Self-declared Chrome whose rules fired a transport inconsistency
SELECT seen_at, client_ip, ja4, user_agent FROM fingerprints
WHERE ua_family = 'Chrome' AND assessment_ids && ARRAY['transport.browser_ua_without_h2_alpn'];

-- Any signal, straight from the document
SELECT doc->'derived' FROM fingerprints WHERE id = '...';
SELECT count(*) FROM fingerprints
WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(doc->'client'->'automation') o
              WHERE o->>'id' = 'browser.automation.navigator_webdriver' AND o->'raw' = 'true');
```

## Testing

`tests/integration/storage.test.ts` needs a throwaway Postgres (it truncates `fingerprints`):

```sh
docker run -d --rm --name plz-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=plzbot_test -p 54329:5432 postgres:16-alpine
PLZBOT_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:54329/plzbot_test npm test
```

Without `PLZBOT_TEST_DATABASE_URL` those tests are skipped.
