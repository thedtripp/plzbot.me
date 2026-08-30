# API reference — v1

Base path: `/api/v1`. The frontend (`public/`) consumes this API like any other client — no
fingerprinting logic is embedded in the presentation layer (spec §5).

## Schema version

Every response includes `schemaVersion` (currently `"1.0.0"`, exported as `SCHEMA_VERSION` from
`src/shared/schema/types.ts`). This project has no persistence and no cross-version data to
migrate, so version bumps only need to stay meaningful to API consumers: increment the minor
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

- **No persistence, no cookies.** Every response is computed fresh from the current request; see
  `docs/ARCHITECTURE.md` security/privacy defaults.
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
