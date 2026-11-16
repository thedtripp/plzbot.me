# Architecture — plzbot.me fingerprinting engine

## Repository state at start

Empty directory, no existing stack. This document records the stack chosen and why, so the
decision doesn't need to be re-litigated later.

## Stack decisions

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node.js (>=20, developed on 25) | Needed for raw TCP/TLS socket access (JA3/JA4), native HTTP/2, and to share TypeScript types between server and browser collector. |
| Language | TypeScript, strict mode | Canonical schema is the spine of this project; a shared `.ts` types module imported by both the server and the client bundle keeps them from drifting apart. |
| HTTP layer | Node `http2` compat API (`createSecureServer({ allowHTTP1: true })`) wrapping Express 4 | Express gives routing/middleware ergonomics; the http2 compat server gives real ALPN negotiation and HTTP/2 framing for browsers and curl `--http2`, while still serving HTTP/1.1 clients (most `curl`, `requests`) over the same port. |
| TLS ClientHello capture | Hand-rolled raw-socket interceptor (`src/server/tls-capture/`) | Node's `tls` module terminates and parses the handshake internally and does not expose the raw ClientHello bytes through any public API. JA3/JA4 require the *raw, unparsed* cipher/extension list in wire order, so we peek the first TLS record off the raw `net.Socket` before Node's TLS engine consumes it, parse it ourselves, then hand the (rewound) socket to the real TLS server. See `docs/TLS_CAPTURE.md`. |
| Client bundle | esbuild, no framework, plain TS → single IIFE script | The collector must run automatically on load with no dependencies that could themselves become a fingerprinting confound (e.g. a framework's own feature probing). Kept dependency-free by design. |
| Tests | Vitest + Supertest | Vitest runs native TS/ESM without a separate build step; Supertest drives the Express app in-process for HTTP-level assertions. Non-Node clients (curl, Python `requests`) are exercised via real subprocess calls against a running server in integration tests, not mocked. |
| Persistence | Optional Postgres (`pg`) | Off unless `PLZBOT_DATABASE_URL` is set. Stores each `Fingerprint` document unchanged as jsonb; see "Stored fingerprints" below. |

## Signal availability by environment

This matters because the spec requires never claiming to observe something we can't.

| Signal group | Available in local dev (this repo, self-signed TLS, direct connection) | Notes |
|---|---|---|
| HTTP method/target/version/headers | Yes | Directly from the request. |
| Header order | Yes (HTTP/1.1 and HTTP/2) | Node's `rawHeaders` preserves wire order for HTTP/1.1 and, verified empirically, HEADERS-frame order (pseudo-headers included) for HTTP/2 via the compat API. Reported as `http.header_order` plus `http2.pseudo_header_order`. |
| Client Hints (`Sec-CH-UA*`) | Yes, when the client (e.g. Chromium) sends them | We also proactively request additional high-entropy hints via `Accept-CH` / `Critical-CH` response headers, but the *first* request of a session will not yet reflect a hint the server just asked for — that's inherent to the Client Hints protocol, not a bug. |
| TCP/IP source address | Yes (loopback in dev) | `req.socket.remoteAddress`. |
| `X-Forwarded-For` / proxy headers | Structurally supported, untrusted by default | No reverse proxy sits in front of this app in dev, so these headers are parsed and reported but explicitly flagged as "untrusted, client-suppliable" unless a deployment enables a trusted-proxy allowlist (config hook provided, unset by default). |
| ASN / Geo IP | ASN: optional, offline (`PLZBOT_IP2ASN_PATH`, public-domain iptoasn.com table, no outbound calls). Geo: not available | Reported as `not_configured` when the table is absent. Reverse DNS (`network.reverse_dns`) is looked up for public client IPs with a 1.5 s bound. |
| TLS version/cipher/ALPN (post-handshake, negotiated) | Yes | Node's `tls.TLSSocket.getProtocol()`, `getCipher()`, `alpnProtocol`. |
| TLS ClientHello raw order (JA3/JA4) | Yes, self-collected | See TLS_CAPTURE.md. Only available because this app terminates TLS itself; if deployed behind a TLS-terminating load balancer/CDN, this becomes `unavailable` locally and must come from infrastructure (e.g. a header the LB injects) — the schema's `collection_method` field distinguishes `self_observed_clienthello` from `infrastructure_supplied` for exactly this reason. |
| HTTP/2 SETTINGS frame values | Yes | Node exposes negotiated settings via the http2 session (`session.remoteSettings`). |
| HTTP/2 pseudo-header order, PRIORITY, WINDOW_UPDATE | Pseudo-header order: yes. Stream weight: yes. SETTINGS frame *order*, WINDOW_UPDATE increments, stream dependency: no | Node exposes settings values and stream weight but not frame order or WINDOW_UPDATE, so the Akamai-style fingerprint (`http2.fingerprint_partial`) writes those components as `?` rather than guessing. |
| JavaScript/browser signals | Yes, once the page's collector runs | Everything under `client.*` in the schema. Not applicable to non-browser clients (curl, `requests`) — represented as `client: { status: "not_submitted" }`, not as an error. |

## Deployment modes

`src/server/runtime/config.ts` reads everything from the environment. `PLZBOT_MODE=tls`
(default) is the architecture described in this document: raw-socket front proxy, self-terminated
TLS, full ClientHello capture. `PLZBOT_MODE=http` starts a plain `http.createServer` instead,
for platforms that terminate TLS upstream: the TLS category is reported per-signal as
`unavailable` with `collectionMethod: "tls_terminated_upstream"`, and the client address comes
from `X-Forwarded-For` / a platform header **only** when `PLZBOT_TRUST_PROXY` /
`PLZBOT_CLIENT_IP_HEADER` say to (`network.client_ip` carries its provenance in
`collectionMethod`; `network.remote_ip` is always the real TCP peer). TLS mode can also run a
plain-HTTP helper (`PLZBOT_HTTP_PORT`) that serves ACME HTTP-01 challenges from a webroot and
redirects everything else to https, and it hot-reloads renewed certificate files. See
`deploy/README.md`.

## Request flow

```
TCP connection
     |
     v
net.Server 'connection'  --(peek first bytes)-->  raw ClientHello capture (JA3/JA4)
     |                                                     |
     v                                                     v
 socket rewound & handed to               TLS fingerprint observations
 http2.createSecureServer (allowHTTP1)
     |
     v
Express app
     |
     +--> server-side collectors run synchronously on every request
     |      (network, http, http2, tls, client-hints)
     |
     +--> GET /            -> serves page + <script src="/collector.js">
     +--> GET /api/v1/fingerprint          -> server-only fingerprint (works for curl, requests, etc.)
     +--> POST /api/v1/fingerprint/client  -> browser submits its collected observations,
                                               server merges with the server-side fingerprint
                                               for *that same underlying connection/session*
                                               and returns the unified document
```

**No session/cookie correlation is used.** An earlier draft of this design planned a short-lived
session cookie to stitch the initial page-load's server observations to the browser collector's
later POST. That turned out to be unnecessary complexity: server-observed signals (network,
HTTP, TLS, HTTP/2) are available on *every* request, not just the first, so
`POST /api/v1/fingerprint/client` simply runs the same server-side collectors again, fresh,
against that POST request itself, and merges the result with the client-submitted observations
in the body. Both requests come from the same browser moments apart, so the server-observed
half is effectively identical either way — collecting it twice is cheap and avoids stateful
correlation, cookies, and TTL bookkeeping entirely. The request path stays stateless: nothing
is carried between requests, and saving a fingerprint (below) is a side effect that never
affects the response.

## Module layout

```
src/
  shared/schema/          canonical types (Observation, DerivedAttribute, Assessment, Fingerprint)
                           imported by BOTH server and client bundle — the one place the schema
                           is defined.
  server/
    tls-capture/           raw ClientHello peek + JA3/JA4
    collectors/            network.ts, http.ts, http2.ts, tls.ts, clientHints.ts
                           each: (req, connectionMeta) -> Observation[]
    normalize/              raw -> normalized value helpers, kept separate from collectors
    derive/                 derived attributes computed from observation sets
    interpret/              signal catalog + rule engine -> Assessment[]
      catalog.ts            static per-signal educational metadata (id -> title/description/why/refs)
      rules/                 automation.ts, consistency.ts, identifiability.ts
    api/v1/                 route handlers
    app.ts / index.ts       Express wiring, http2 server bootstrap
  client/
    collectors/             one file per signal group, browser-side
    index.ts                 orchestrator, runs on DOMContentLoaded, POSTs to the API
public/                      static HTML/CSS shell (Phase 5); serves the built collector.js
docs/
  ARCHITECTURE.md            this file
  SCHEMA.md                  canonical schema documentation
  TLS_CAPTURE.md              JA3/JA4 raw-socket technique, tested against curl/openssl
  API.md                      endpoint reference (written alongside the API in Phase 2)
tests/
  server/                     unit tests per collector/normalizer/derive/rule
  integration/                 real HTTP requests (supertest + live server) incl. non-browser clients
```

## Security & privacy defaults (applies from Phase 2 onward)

- No session state and no cookies. Fingerprints are saved only when `PLZBOT_DATABASE_URL` is set;
  without it nothing is written anywhere (see "Stored fingerprints" below). When storage is on,
  it includes raw client IPs and nothing is ever deleted, which the public privacy line states.
- `X-Forwarded-For` and similar proxy headers are parsed and *shown*, but labeled untrusted
  unless the deployment explicitly configures a trusted proxy count/allowlist (unset by default,
  so in dev these headers — if present — are shown as "client-suppliable, unverified").
- No outbound calls to third-party IP-intelligence/geo services in the MVP; the schema reserves
  the field but the collection method is reported as `not_configured` rather than silently
  omitted, per the "never make it look like a signal was never tested" requirement.
- No credentials, auth secrets, or unrelated PII are ever collected.

## Stored fingerprints

Code: `src/server/storage/postgres.ts`. Enabled by `PLZBOT_DATABASE_URL` (or `DATABASE_URL`).

- **What is saved:** every fingerprint the server builds, tagged with a `kind`: `page_view`
  (a request for `/` or `/index.html`, so crawlers and agents that never run JavaScript still
  leave a record), `api_get` (`GET /api/v1/fingerprint`) and `client_submit` (the browser's
  `POST /api/v1/fingerprint/client`). Static files and `/healthz` are not saved.
- **Table `fingerprints`:** `id` (the document's `fingerprintId`), `seen_at`, `kind`, `client_ip`
  (`inet`, raw), `ja4`, and `doc`, the full fingerprint as jsonb including `interpretation`.
  Anything else is queryable through the jsonb, for example `doc->'request'->>'httpVersion'`.
  The table is created automatically at startup (`CREATE TABLE IF NOT EXISTS`).
- **Writes never block a request.** Each insert is fire-and-forget; a failed insert is logged and
  that record is lost. There is no queue, retry or retention: records are kept forever, and a
  full or unreachable database fails silently apart from the log line. Adding observability for
  this is planned.
- **Rate limits on saving** (`src/server/storage/rateLimit.ts`). Visitors always get their normal
  response; only the saving is limited. Per visitor (an IPv4 address, or an IPv6 /64), at most 10
  records per minute (*fast*), 30 per hour (*medium*) and 100 per day (*slow*) are saved, and a
  record must be under all three. Past a limit it is counted, not stored, in the table
  `suppressed_fingerprints` (per hour, IP and tier), which the admin page shows. A fifth tier,
  *size*, stops saving full records while the `fingerprints` table is over 800 MB (checked every
  5 minutes), so a flood from many addresses cannot fill a small free database. Limits are kept in
  memory per process and reset on restart. Settings: `PLZBOT_STORE_LIMIT_PER_MINUTE`, `_PER_HOUR`,
  `_PER_DAY` (0 disables a tier) and `PLZBOT_STORE_MAX_TABLE_MB`.
- **Size:** about 8 KB for a server-only record as stored (compressed jsonb), plus indexes; a full
  browser record is larger because it adds the browser signals.
- **Secrets:** the connection string lives only in the environment (`.env` on the VM, which is
  gitignored). It is never logged or returned by an endpoint.
- **Tests:** `tests/integration/storage.test.ts` runs only when `PLZBOT_TEST_DATABASE_URL` points at
  a throwaway Postgres (it truncates the table).
