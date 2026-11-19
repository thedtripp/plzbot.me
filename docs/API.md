# API reference — v1

Base path: `/api/v1`. The frontend (`public/`) consumes this API like any other client — no
fingerprinting logic is embedded in the presentation layer (spec §5).

## Schema version

Every response includes `schemaVersion` (currently `"1.0.0"`, exported as `SCHEMA_VERSION` from
`src/shared/schema/types.ts`). Saved fingerprints keep the `schemaVersion` they were created
with, so version bumps need to stay meaningful to API consumers and to anyone querying stored data: increment the minor
version for additive, backward-compatible changes (new observation ids, new signal categories)
and the major version for anything that changes the meaning or shape of an existing field. See
`docs/SCHEMA.md` for the full schema design.

## Endpoints

### `GET /api/v1/fingerprint`

Returns a fingerprint built entirely from server-observable signals for the current request:
network, TLS, HTTP, HTTP/2, and Client Hints. Works for every client, including ones that never
run JavaScript (curl, Python `requests`, …). `client` is always `null` on this endpoint, since
nothing has been submitted.

**Request:** no body.

**Response:** `200 application/json`, a full `Fingerprint` document (see `docs/SCHEMA.md`).

### `POST /api/v1/fingerprint/client`

Submits browser-collected observations and returns the combined fingerprint. The server also
(re-)collects its own server-observable signals fresh from *this* request — see
`docs/ARCHITECTURE.md`, "No session/cookie correlation is used," for why that's sufficient
rather than trying to stitch this request together with an earlier page load.

**Request:** `application/json` body, an object with zero or more of these keys, each an array
of `Observation` objects (see `docs/SCHEMA.md`): `navigator`, `screen`, `hardware`, `graphics`,
`audio`, `fonts`, `media`, `storage`, `apis`, `automation`. An empty object (or omitting the
body) is valid and produces the same result as `GET /api/v1/fingerprint` — `client` will be
`null` in the response, not an error. This is what the bundled browser collector
(`public/collector.js`, built from `src/client/`) sends automatically on page load.

**Response:** `200 application/json`, a full `Fingerprint` document with `client.status ===
"submitted"` and the arrays you sent echoed back inside it (merged alongside the server-observed
half and the interpretation layer's output, which is recomputed against the combined document).

**Errors:**
- `400` if the body is present but isn't a JSON object (e.g. a JSON array or a bare string).
- `400` if the body isn't valid JSON at all.
- `500` (with `{"error": "...", "detail": "..."}`) if an unexpected server error occurs.
Malformed input never crashes the process — see `src/server/http/router.ts`'s per-route error
handling.

### `GET /api/v1/recaptcha`

Returns `{ "enabled": false }`, or `{ "enabled": true, "siteKey": "...", "action": "behavior_submit" }` when the
deployment has Google reCAPTCHA Enterprise configured. The site key is public. The behavior page loads Google's
script only when this says enabled.

### `POST /api/v1/behavior`

Analyzes an interaction trace recorded by the behavior page (`public/behavior.html`, recorder in
`src/client/behavior/`) and returns a hedged human/automated verdict. Nothing is stored yet.
The body may also carry `recaptchaToken` (a token from Google's script). When reCAPTCHA is enabled the response then
includes `recaptcha: { status, score?, reasons?, invalidReason? }`, a separate third-party opinion that never changes the
verdict. `status` is `ok`, `no_token`, `invalid`, `action_mismatch`, `capped`, `rate_limited` or `error`.

**Request:** `{"trace": {"events": [...], "dropped": 0, "danglingKeydowns": 0, "viewport": {"w": 1280, "h": 800}}}`.
Each event is `{t, k, tr, f?, x?, y?, b?, kc?, h?, it?, d?}` (see `src/shared/behavior.ts`): `t` ms since
start, `k` event type, `tr` 1 if `isTrusted`, `f` field id, `kc` key *class* (never the key), `h` key hold
time, `it` `inputType`, `d` scroll position. At most 5,000 events; unknown fields are dropped.

**Response:** `200` with `{verdict, automatedWeight, humanWeight, evidence[], features}`. `verdict` is one of
`likely_automated | likely_human | inconclusive | not_enough_interaction`; each `evidence` item cites the
`features` ids (documented in `GET /api/v1/signals`) it was computed from. `400` for a malformed trace.

### `GET /api/v1/signals`

Returns the static educational signal catalog (`src/server/interpret/catalog.ts`): a map from
observation/derived-attribute id to `{ title, description, whyItMatters, caveats?, references? }`.
Not every id that can appear in a fingerprint has a catalog entry yet (see `docs/SCHEMA.md`,
"Extensibility rules") — the frontend renders whatever is available and doesn't treat a missing
entry as an error.

### `GET /api/v1`

Returns a small self-description of the available endpoints, for discoverability.

## Availability semantics

Every individual signal in a fingerprint carries its own `status`
(`observed` / `unsupported` / `unavailable` / `not_applicable` / `error`) rather than the API
call failing when some signal can't be collected. The only things that produce an HTTP-level
error are malformed requests (see above) — a client that's missing every browser signal (curl),
every TLS signal (deployed behind a TLS-terminating proxy, hypothetically), or every HTTP/2
signal (an HTTP/1.1 client) still gets a `200` with a complete, honestly-partial `Fingerprint`
document. See `docs/SCHEMA.md` for why this project treats "collected nothing here" as data, not
failure.

## CORS

No CORS headers are sent, so only same-origin requests (this app's own frontend) can read
responses from a browser context; a script on another origin cannot fetch this API cross-origin
from a user's browser. Non-browser clients (curl, `requests`, server-to-server calls) are
unaffected by CORS, since it's a browser-enforced mechanism. This is a deliberate default for an
educational fingerprinting tool: enabling cross-origin reads would make it trivially embeddable
by third-party pages to fingerprint *their* visitors through this service, which is a materially
different (and more sensitive) use case than someone visiting this app directly to see their own
fingerprint. Revisit deliberately if a future use case needs it — don't flip it on as a quick fix
for a CORS error.

## Security considerations

- **No cookies; fingerprints are saved when a database is configured.** Every response is computed
  fresh from the current request. If `PLZBOT_DATABASE_URL` is set, the same fingerprint, including
  the raw client IP, is also saved indefinitely. See "Stored fingerprints" in `docs/ARCHITECTURE.md`.
- **Reflected data is the requester's own.** Raw headers, TLS handshake fields, etc. returned by
  this API describe the request that asked for them — this is not a service that returns
  information about other users or other requests.
- **Cookie header handling.** Only cookie *names*, never values, are echoed back (see
  `src/server/collectors/http.ts`) — there's no fingerprinting value in echoing a session token
  back to its own owner, so it's simply not done.
- **Untrusted proxy headers.** `X-Forwarded-For`, `Forwarded`, and `X-Real-IP` are parsed and
  shown but never used to override the directly-observed TCP peer address — see
  `src/server/collectors/network.ts` and `docs/ARCHITECTURE.md`.
- **Request body size limit.** `POST /api/v1/fingerprint/client` rejects bodies over 512KB (see
  `readJsonBody` in `src/server/http/router.ts`) to bound memory use from a malformed or
  adversarial client; the real payload the bundled collector sends is a few KB.
