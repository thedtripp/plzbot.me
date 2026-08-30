# Episode 12 — verification log

This closing episode is a synthesis of this project's own schema design (`docs/SCHEMA.md`) and
already-reviewed documentation (`public/docs.html`), not new external research — the entire point
of the episode is explaining *this project's own* design decisions and the reasoning already
recorded for them, so the "sources" here are internal, first-party design docs rather than
external citations.

| Claim | Primary source |
|---|---|
| Four-stage pipeline (raw observation → normalized value → derived attribute → interpretation/assessment), kept as distinct object shapes rather than fields on one object | `docs/SCHEMA.md`, "The observation pipeline" and "Key decisions" |
| `status` is a closed enum (`observed`/`unsupported`/`unavailable`/`not_applicable`/`error`), not a boolean, because each state has distinct educational value and collapsing them would silently omit information | `docs/SCHEMA.md`, `Observation` section |
| `raw` is always preserved even when normalized alongside it; `normalized` is kept separate and nullable so provenance is always checkable | `docs/SCHEMA.md`, `Observation` "Key decisions" |
| A `DerivedAttribute` (e.g. a JA3 hash) is explicitly labeled as computed, not observed, because "this is what our algorithm computed" is a weaker, more contestable claim than "this is what the client sent" | `docs/SCHEMA.md`, `DerivedAttribute` section |
| `Assessment.confidence` is a five-level qualitative scale (high/medium/low/informational), deliberately not a numeric score, because a number would imply a statistical calibration the underlying pattern-matching rules don't actually have | `docs/SCHEMA.md`, `Assessment` section: "confidence has no numeric score: the spec explicitly warns against false certainty... versus implying a calibrated probability we have no statistical basis for" |
| `client` is `null` (not an empty object) until a browser submission arrives — the absence of a browser is a first-class valid state, not an error state | `docs/SCHEMA.md`, `Fingerprint` "Key decisions": "the absence of a browser is a first-class, valid state, not an error state" |
| `fingerprintId` is explicitly documented as ephemeral (random per-request), not a stable cross-request device identifier | `docs/SCHEMA.md`, `Fingerprint` "Key decisions" |
| No signal in this system constitutes cryptographic proof; even JA3/JA4 could in principle be replicated by a custom TLS stack | Reused from `public/docs.html`, "Spoofability and limitations" section, already-reviewed |
| Behavioral fingerprinting (mouse/keystroke/scroll biometrics) is deliberately out of scope — not because it doesn't work, but because it requires sustained interaction a single-page tool can't honestly provide, and raises separate privacy questions this project didn't try to resolve | Reused from `public/docs.html`, "Behavioral fingerprinting (not implemented)" section, already-reviewed |

No claims in this episode required a "flagged, not used" exclusion.
