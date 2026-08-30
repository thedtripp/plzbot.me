# Episode 4 — verification log

| Claim | Primary source | Corroborating source |
|---|---|---|
| A curl request with its User-Agent rewritten to a Chrome string still gets flagged, specifically because it's missing `Sec-CH-UA`/`Sec-Fetch-*` headers real Chromium sends automatically | First-party: this project's own probe run (`probe-output/2026-08-30T00-42-05-880Z/curl_spoofed_Chrome_UA_.json`), generated and inspected earlier in this course's own development — real captured data, not a hypothetical | Consistent with this project's `src/server/interpret/rules/automation.ts` consistency rule, already reviewed/shipped code |
| RFC 9110 ("HTTP Semantics") reached Internet Standard status (STD 97) in June 2022, obsoleting most of RFC 7230/7231/7232/7233/7235 etc.; header field order carries no semantic meaning under the spec | [RFC 9110, RFC Editor](https://www.rfc-editor.org/rfc/rfc9110.html) (IETF, primary) | [IETF datatracker entry for RFC 9110](https://datatracker.ietf.org/doc/html/rfc9110) — independent index confirming STD 97 status/date |
| Header order is unstandardized and therefore implementation-specific/stable per client software, making it a practical fingerprinting signal despite carrying no semantic meaning | Consistent with this project's own `public/docs.html` ("HTTP fingerprinting" section) and `src/server/collectors/http.ts`, already-reviewed reasoning from this project's original build | — |
| Chrome's real User-Agent string contains the literal substring "like Gecko" despite Chrome using the Blink rendering engine, not Gecko; this is a historical compatibility fossil | First-party: this project's own probe run (`probe-output/.../curl_spoofed_Chrome_UA_.json` and `Playwright_Chromium_headless_.json`) shows the exact real string `"...AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"` | [MDN — "Browser detection using the user agent"](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Browser_detection_using_the_user_agent), which explicitly documents this exact phenomenon ("WebKit browsers add a `like Gecko` string...") using the same real-world example string |
| Nearly all modern desktop browser UA strings begin with "Mozilla/5.0" for historical compatibility reasons, and this pattern of accumulated spoofed/legacy tokens is well documented | [MDN — "Browser detection using the user agent"](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Browser_detection_using_the_user_agent) | Directly observable in this project's own captured UA strings (Chrome, HeadlessChrome, and Firefox samples in `probe-output/`) |
| Firefox's User-Agent contains `Gecko/20100101` (accurately — Firefox does use Gecko), *not* the phrase "like Gecko" | First-party: this project's own probe run (`probe-output/.../curl_spoofed_Firefox_UA_.json`) — real string `"Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0"` | — |

## Correction made during drafting

An earlier draft of this script incorrectly attributed the "like Gecko" fossil string to Firefox
(which actually uses Gecko and would have no need to fake it). Caught by cross-checking against
this project's own already-captured, real UA strings in `probe-output/` before finalizing —
exactly the kind of error the two-source verification process is meant to catch. Corrected to
Chrome/WebKit, the browsers that actually carry the fossil phrase, and confirmed independently
against MDN's own documentation of the same phenomenon.
