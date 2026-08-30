# Episode 2 — verification log

| Claim | Primary source | Corroborating source |
|---|---|---|
| Lou Montulli invented the HTTP cookie at Netscape in June 1994, working on an e-commerce/shopping-cart problem for client MCI; Netscape shipped cookie support in Mosaic Netscape 0.9beta, October 13, 1994 | [Lou Montulli's own blog — "The reasoning behind Web Cookies" (2013)](http://montulli.blogspot.com/2013/05/the-reasoning-behind-web-cookies.html) — the inventor's first-person account | [History of Information — "Louis Montulli II Invents the HTTP Cookie"](https://www.historyofinformation.com/detail.php?id=2102), independently dated/detailed entry |
| The name "cookie" comes from "magic cookie" (a packet of data a program receives and returns unchanged), a term Montulli knew from a college operating-systems course | Same Montulli blog post above | [History of Information](https://www.historyofinformation.com/detail.php?id=2102) |
| Cookie scoping/security rules (same-origin default, `Set-Cookie` mechanics) | [RFC 6265, HTTP State Management Mechanism](https://www.rfc-editor.org/rfc/rfc6265.html) | Reused from Episode 1's verification |
| Third-party cookies enable cross-site tracking because one third-party resource embedded on many sites can set/read the same cookie across all of them | General, well-established web mechanism; consistent with RFC 6265's own description of cookie scoping and with [MDN's cookie documentation](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies) | — |
| Chrome 80 (Feb 2020) changed the default `SameSite` value from `None` to `Lax` for cookies that don't declare it; `SameSite=None` now requires the `Secure` attribute | [web.dev — "SameSite cookies explained"](https://web.dev/articles/samesite-cookies-explained) (Google's own developer publication) | [Adobe Experience League — Chrome SameSite labelling changes](https://experienceleague.adobe.com/en/docs/id-service/using/reference/chrome-samesite-labelling) |
| Safari blocks third-party cookies by default since Safari 13.1 (March 2020); Firefox's Enhanced Tracking Protection is on by default since 2019 | Reused from Episode 1 (WebKit blog, Mozilla blog) | — |
| Samy Kamkar published "evercookie" in 2010, storing a redundant identifier across a dozen-plus browser storage mechanisms (including cookies, local storage, an ETag, and HSTS state) so that clearing any one of them doesn't remove the identifier | [samyk/evercookie on GitHub](https://github.com/samyk/evercookie) — the author's own project/README, primary source | [Wikipedia — "Evercookie"](https://en.wikipedia.org/wiki/Evercookie) |

## Flagged, not used

- A claim connecting evercookie to a 2013 Snowden/NSA leak (that the NSA used evercookie-style
  techniques to track Tor users) appeared in secondary sources but was not verified against a
  primary document (e.g. the original leaked slide deck or a first-tier outlet's direct
  reporting) within this research pass. Left out of the script rather than stated as fact.
- No specific number is given for "how many sites" or "how much of the web" broke when Chrome 80
  shipped the SameSite default change — sources describe the change qualitatively (a large,
  disruptive shift for sites relying on implicit cross-site cookies) but no single reliable
  quantitative figure was found that cleared the two-source bar.
