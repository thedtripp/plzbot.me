# plzbot.me

An educational client fingerprinting engine — demonstrates what a server and a browser can
observe about *any* HTTP client (real browsers, headless/automated browsers, curl, Python
`requests`, …), combined into one versioned, evidence-based fingerprint. Not a bot/not-bot
classifier — see `docs/SCHEMA.md` and `public/docs.html` for the design philosophy.

## Quickstart

```sh
npm install
npm run certs   # one-time: generates a local self-signed TLS cert into certs/
npm run dev     # starts the server on https://127.0.0.1:8443
```

Then open `https://127.0.0.1:8443/` in a browser (you'll need to click through the self-signed
certificate warning — this is a local dev cert, see `docs/ARCHITECTURE.md`), or:

```sh
curl -sk https://127.0.0.1:8443/api/v1/fingerprint | python3 -m json.tool
```

`npm run dev` uses `tsx watch`, so server-side changes reload automatically. Browser-side changes
(`src/client/`) need a rebuild: `npm run build:client` (also runs automatically before `npm test`).

## Testing

```sh
npm test
```

Runs unit tests (ClientHello/JA3/JA4 parsing, derive/interpret logic) and integration tests that
spin up the real server and exercise it with real clients: Node's `https`/`http2` modules, the
actual `curl` binary (skipped if not on `PATH`), and a real headless Chromium instance via
Playwright (downloaded automatically on `npm install`).

## Documentation

- `docs/ARCHITECTURE.md` — stack decisions, request flow, signal availability by environment.
- `docs/SCHEMA.md` — the canonical fingerprint schema and its design rationale.
- `docs/TLS_CAPTURE.md` — how raw TLS ClientHello bytes are captured for JA3/JA4 (and why the
  obvious approach doesn't work).
- `docs/API.md` — endpoint reference, error handling, CORS, security considerations.
- `public/docs.html` — the in-app educational write-up (served at `/docs.html`), covering HTTP,
  TLS, HTTP/2, and browser fingerprinting concepts for a general audience.

## Project status

Implements the full MVP scope: server-side collection (network/HTTP/HTTP/2/TLS/Client Hints),
browser-side collection (navigator/screen/hardware/canvas/WebGL/audio/fonts/media/storage/
APIs/automation indicators), the combined API, an evidence-based interpretation layer
(automation indicators, cross-signal consistency, identifiability notes), and a frontend that
presents raw/normalized/derived/interpreted data separately with explanations.

Deliberately out of scope for this MVP (see the spec this was built against): persistent
storage, population-level rarity/uniqueness scoring, and behavioral (mouse/keystroke/scroll)
fingerprinting — the schema and architecture were designed to accommodate all three later
without a redesign; see `docs/SCHEMA.md` "Extensibility rules."
