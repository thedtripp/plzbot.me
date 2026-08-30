# Course outline

An audio-first course teaching how client fingerprinting works, structured as a narrative arc
(each episode assumes the last) rather than the reference-doc ordering used in `public/docs.html`.
Every script is written and fact-checked using the process in `README.md`, following the SUCCESS
framework from Chip & Dan Heath's *Made to Stick* (Simple, Unexpected, Concrete, Credible,
Emotional, Stories) for structure and delivery.

| # | Episode | Core question | Status |
|---|---|---|---|
| 1 | Why fingerprinting exists | If cookies aren't disappearing after all, why does this still matter? | Scripted + sourced (`scripts/01-why-fingerprinting-exists.md`) |
| 2 | Cookies: the original tracker, and its decline | How stateful tracking actually works, and why it stopped being sufficient alone | Not started |
| 3 | Network & IP: what's visible before one header arrives | Why IP is a real but weak signal, and why forwarded-IP headers can't be trusted blindly | Not started |
| 4 | What headers give away | UA, header order, Accept-* | Not started |
| 5 | Client Hints: the deliberate replacement | Opt-in structured hints vs. free-text UA sniffing | Not started |
| 6 | The TLS handshake tells on you | JA3/JA4 fingerprint the library, before any HTTP | Not started |
| 7 | HTTP/2's own signature | SETTINGS + pseudo-header order as a second layer | Not started |
| 8 | What JavaScript can see | Canvas, WebGL, AudioContext, fonts, storage | Not started |
| 9 | Catching automation | `navigator.webdriver`, headless tells | Not started |
| 10 | When signals disagree | Cross-signal consistency (ties to the project's own `probe-output` run) | Not started |
| 11 | How identifiable is "identifiable"? | Entropy, uniqueness research | Not started |
| 12 | Evidence, not verdicts | Why this system separates raw/normalized/derived/interpretation instead of a score; closes with limits/ethics | Not started |

Voice: `af_heart` (Kokoro-82M), chosen 2026-08-29 after an A/B listen against `am_michael` and
`bf_emma`. See `README.md` for the local, free generation pipeline.
