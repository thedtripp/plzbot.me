Take a single request and change exactly one thing about it: the User-Agent header, swapped from
"curl" to a string that claims to be Chrome on Windows. Does the request now look like Chrome?

I actually ran this. Curl, hitting a real server, with its User-Agent header rewritten to an
ordinary Chrome string. The server's first read was a clean, high-confidence flag: this claims to
be a Chromium browser, but it never sent the headers a real Chromium browser sends alongside that
claim. No `Sec-CH-UA`. No `Sec-Fetch-Site`, `Sec-Fetch-Mode`, any of it. Real Chrome has sent
those automatically, unasked, since 2020. Curl, even wearing Chrome's name tag, still didn't know
to send them -- because nobody told curl's code to. Only its declared identity changed. Everything
underneath it, the actual shape of the request, stayed pure curl.

That gap is what this episode is about. RFC 9110 -- the current core HTTP specification, elevated
all the way to Internet Standard status in 2022 -- defines what headers mean. It does not define,
and deliberately doesn't care about, what order they arrive in. Header order carries zero
semantic meaning under the spec. A server is supposed to interpret `Accept-Language: en-US` and
`User-Agent: curl/8.7.1` identically no matter which one showed up first on the wire.

Which is exactly why order turns out to be such a useful signal in practice. Nobody standardized
it, so nobody had to agree on it -- every browser, every scripting language's HTTP library, every
version of curl just emits headers in whatever order its own internal code happens to build them
in. A user never chooses this. It's baked into the networking stack, not typed at a keyboard. And
because it's baked in that deeply, it tends to be remarkably stable and remarkably
implementation-specific: Chrome's header order looks like Chrome's header order, curl's looks
like curl's, and Python's `requests` library looks like neither, version after version, request
after request.

The User-Agent header itself deserves its own honest history, because it's simultaneously the
most famous fingerprinting signal and one of the least reliable on its own. It started as a
simple idea -- a string identifying the software making the request -- and decayed, over two and
a half decades of browsers each wanting to be compatible with sites checking for other browsers,
into some of the strangest text on the internet. Chrome's real User-Agent string -- I pulled one
directly from a request I captured earlier -- reads, in part, "AppleWebKit/537.36 (KHTML, like
Gecko) Chrome/120.0.0.0." Chrome doesn't use Gecko. It never has; it runs on Blink, a completely
different rendering engine. That phrase is a fossil, kept only because enough of the web, years
ago, checked for the literal substring "like Gecko" before treating a browser as modern. And
nearly every modern desktop browser's string still starts with the word "Mozilla," a name from a
browser most of today's users have never used, for the exact same reason. The User-Agent header
is, structurally, whatever a browser vendor decided to type into it, fossils and all -- which
means it is also, structurally, whatever anyone else decides to type into a request that isn't a
browser at all. Free text. Trivially copied. On its own, it proves nothing.

That's the trap worth naming clearly: treating any single header as a verdict. A matching
User-Agent string proves only that someone typed a matching User-Agent string. What curl couldn't
fake, in that experiment I described, wasn't the one header it changed on purpose -- it was
everything it didn't think to change, because faking a whole ecosystem of interlocking, largely
undocumented behavioral quirks is a much bigger job than editing one line of code.

That's also the throughline for the rest of this course, not just this episode: no signal proves
anything by itself. Evidence accumulates. A single mismatched header is a data point. A whole
constellation of mismatched headers, alongside a TLS handshake and a JavaScript environment that
also don't line up with the claimed identity, is something closer to a conclusion -- and even
then, stated as a weighted assessment, not a verdict, because a sufficiently motivated client can
in principle fix every one of those things too, one at a time.

The web actually noticed this same fragility from the other direction. If User-Agent strings are
this messy, this spoofable, and this loaded with meaningless historical junk -- why keep relying
on them for anything real, like serving the right stylesheet to the right device? That question
is exactly what produced the mechanism we're covering next: a structured, deliberate, opt-in
replacement for parts of the User-Agent string, built by browser vendors specifically in response
to how much passive fingerprinting the old free-text string enabled. It's called Client Hints,
and it's next.
