# Episode 10 — verification log

This episode is almost entirely a synthesis of this project's own already-reviewed, shipped
interpretation code rather than new external claims — it explains *why* the code is written the
way it is, which is a first-party engineering fact, not something requiring an external citation.

| Claim | Primary source |
|---|---|
| The curl-spoofed-as-Chrome example (missing headers catching a UA spoof) | Reused from Episode 4's own first-party probe data, already sourced there |
| UA-vs-Sec-CH-UA-brand mismatch is flagged at only medium confidence, specifically because Sec-CH-UA's GREASE fake-brand entry can cause an apparent mismatch that isn't real deception | `src/server/interpret/rules/consistency.ts`, `checkUaVsClientHintsBrand` — the code's own comment/statement text explicitly cites this reasoning, and links to the WICG GREASE section as a reference |
| `navigator.platform` is deprecated and increasingly frozen/spoofed-by-design, so a mismatch against it is weighted low confidence | `src/server/interpret/rules/consistency.ts`, `checkUaVsJsPlatform` — statement text and its own MDN reference (`developer.mozilla.org/.../Navigator/platform`) |
| Accept-Language vs. `navigator.languages` mismatches are common and often innocent (browser language vs. OS/header settings can legitimately differ), so this check is weighted low confidence | `src/server/interpret/rules/consistency.ts`, `checkAcceptLanguageVsJsLanguages` |
| A User-Agent's mobile/non-mobile claim disagreeing with `Sec-CH-UA-Mobile` is weighted medium confidence, since that header exists specifically to answer the mobile-or-not question directly | `src/server/interpret/rules/consistency.ts`, `checkMobileUaVsClientHintsMobile` |
| Different consistency checks are deliberately assigned different confidence levels rather than a uniform "match/conflict" flag, because each pairing has a different legitimate-mismatch rate | Direct reading of `src/server/interpret/rules/consistency.ts` in full — every rule function assigns its own `confidence` value individually, reflecting this project's own design intent (also documented in `public/docs.html`'s "Cross-signal consistency analysis" section) |

No external "flagged, not used" exclusions — this episode makes no new external factual claims
beyond what's already sourced in earlier episodes.
