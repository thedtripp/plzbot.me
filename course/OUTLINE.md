# Course outline

An audio-first course teaching how client fingerprinting works, structured as a narrative arc
(each episode assumes the last) rather than the reference-doc ordering used in `public/docs.html`.
Every script is written and fact-checked using the process in `README.md`, following the SUCCESS
framework from Chip & Dan Heath's *Made to Stick* (Simple, Unexpected, Concrete, Credible,
Emotional, Stories) for structure and delivery.

All 12 episodes are scripted, fact-checked, and generated as audio (~64 minutes total runtime).

| # | Episode | Core question | Runtime |
|---|---|---|---|
| 1 | Why fingerprinting exists | If cookies aren't disappearing after all, why does this still matter? | 5.4 min |
| 2 | Cookies: the original tracker, and its decline | How stateful tracking actually works, and why it stopped being sufficient alone | 5.6 min |
| 3 | Network & IP: what's visible before one header arrives | Why IP is a real but weak signal, and why forwarded-IP headers can't be trusted blindly | 5.0 min |
| 4 | What headers give away | UA, header order, Accept-* | 5.1 min |
| 5 | Client Hints: the deliberate replacement | Opt-in structured hints vs. free-text UA sniffing | 5.0 min |
| 6 | The TLS handshake tells on you | JA3/JA4 fingerprint the library, before any HTTP | 7.1 min |
| 7 | HTTP/2's own signature | SETTINGS + pseudo-header order as a second layer | 5.5 min |
| 8 | What JavaScript can see | Canvas, WebGL, AudioContext, fonts | 5.3 min |
| 9 | Catching automation | `navigator.webdriver`, headless tells | 4.7 min |
| 10 | When signals disagree | Cross-signal consistency (ties to the project's own `probe-output` run) | 4.5 min |
| 11 | How identifiable is "identifiable"? | Entropy, uniqueness research | 4.7 min |
| 12 | Evidence, not verdicts | Why this system separates raw/normalized/derived/interpretation instead of a score; closes with limits/ethics | 6.0 min |

Each episode has a companion `NN-slug.sources.md` file in `scripts/` logging every factual claim
against a primary source plus an independent corroborating one (or a first-party citation to this
project's own already-reviewed code/docs, where the claim is about plzbot.me itself). Any claim
that didn't clear the two-source bar during research is listed under that episode's "Flagged, not
used" section rather than included.

Voice: `af_heart` (Kokoro-82M), chosen 2026-08-29 after an A/B listen against `am_michael` and
`bf_emma`. See `README.md` for the local, free generation pipeline.
