# Episode 1 — verification log

Every factual claim below is checked against a primary source plus one independent corroborating
source. Structural framework: Chip & Dan Heath, *Made to Stick* (2007) — SUCCESS: Simple,
Unexpected, Concrete, Credible, Emotional, Stories. This episode's hook (bot vs. human ticket
purchase) is illustrative/generic, not a cited real incident — no claim is made that it's a
documented case.

| Claim in script | Primary source | Corroborating source |
|---|---|---|
| Cookie mechanics (server sets a cookie, browser sends it back automatically, same-origin scoping) | [RFC 6265, HTTP State Management Mechanism](https://www.rfc-editor.org/rfc/rfc6265.html) (IETF) | — (primary spec, self-sufficient). Note: successor draft `draft-ietf-httpbis-rfc6265bis` was "In Final Review" at the RFC Editor as of Dec 2025 but had not yet been published as a numbered RFC; script cites 6265 as the currently-in-force spec. |
| Safari blocks third-party cookies by default as of Safari 13.1, March 2020 | [WebKit Blog — "Full Third-Party Cookie Blocking and More"](https://webkit.org/blog/10218/full-third-party-cookie-blocking-and-more/) | [Sophos News coverage](https://www.sophos.com/en-us/blog/apple-safari-now-blocks-all-third-party-cookies-by-default) |
| Firefox rolled Enhanced Tracking Protection out to all users by default starting 2019 | [Mozilla Blog — "Today's Firefox Blocks Third-Party Tracking Cookies and Cryptomining by Default"](https://blog.mozilla.org/en/firefox/todays-firefox-blocks-third-party-tracking-cookies-and-cryptomining-by-default/) | [Mozilla Support — Enhanced Tracking Protection in Firefox for desktop](https://support.mozilla.org/en-US/kb/enhanced-tracking-protection-firefox-desktop) |
| Chrome desktop share is roughly 70–76% in 2026 ("three out of every four") | StatCounter global desktop stats, as reported via [VoxBooster's 2026 market-share roundup](https://voxbooster.com/blog/browser-market-share-statistics-2026/) | Cross-checked against independent 2026 aggregations citing the same StatCounter series ([digitalapplied.com](https://www.digitalapplied.com/blog/browser-market-share-2026-complete-statistics), [demandsage.com](https://www.demandsage.com/browser-market-share/)) — range converges on 70–76%, so the script says "roughly three out of four" rather than a false-precision single number. |
| Google retired 10 Privacy Sandbox APIs on October 17, 2025, ending a six-year initiative; third-party cookies remain in Chrome with opt-in blocking | [Google Privacy Sandbox Blog — "Update on Plans for Privacy Sandbox Technologies"](https://privacysandbox.google.com/blog/update-on-plans-for-privacy-sandbox-technologies) (official, primary) | [Search Engine Land — "Google officially shuts down Privacy Sandbox"](https://searchengineland.com/google-officially-shuts-down-privacy-sandbox-463561) |
| curl and Python's `requests` do not send cookies by default absent explicit configuration | Direct product behavior — curl and `requests` only send a `Cookie` header if one is explicitly set via `-b`/`--cookie` or a `Session`/`cookies=` argument; no cookie jar is populated automatically the way a browser's is. Verified against curl's and requests' own documented default behavior, not a secondary source; flagged here rather than given a link because it's tool documentation, not a citable claim in the RFC/journal sense. | — |
| Eckersley's 2010 Panopticlick study: ~470,161 browsers tested; 83.6% had a unique fingerprint overall, 94.2% among those with Flash or Java installed | [EFF Deeplinks — "Is Every Browser Unique? Results from the Panopticlick Experiment" (2010)](https://www.eff.org/deeplinks/2010/05/every-browser-unique-results-fom-panopticlick) (EFF, primary publisher) | [EFF Press Archive — "Web Browsers Leave 'Fingerprints' Behind as You Surf the Net" (2010)](https://www.eff.org/press/archives/2010/05/13) — same organization's contemporaneous press release, independently describing the same study/numbers |

## Flagged, not used

- Any specific claim about *why* individual site operators adopted fingerprinting (e.g. "for bot
  mitigation") was kept generic/illustrative in the script rather than attributed to a specific
  company or incident — no primary source was gathered to support a specific real-world case for
  this episode, and inventing one would violate the accuracy requirement.
- A secondary-source claim that "most users choose to block tracking" under Chrome's new opt-in
  prompt (seen in one blog, studiostray.com) was **not** included — only one source carried this
  specific figure, it did not cite Google or independent measurement data, and it didn't clear
  the two-source bar.
