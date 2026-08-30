Somewhere in a real Chrome request, sitting right next to the actual browser brand, you'll find
this: `"Not A;Brand";v="99"`. Not a typo. Not corrupted data. Chrome put that there on purpose,
and if you look at a different Chrome request five minutes later, you might see `"Not_A Brand"`
instead, or `" Not A;Brand"` with a leading space, or the fake name in a completely different
position in the list. Chrome is, quite deliberately, lying to you a little, every single time,
in a slightly different way.

This is the mechanism the last episode was building toward. If the User-Agent string had become
this messy, this loaded with historical junk, and this trivial to fake -- why keep depending on
it for anything real? Browser vendors eventually agreed: don't. Build something new instead,
opt-in, structured, and explicit about what it's revealing and why. That's User-Agent Client
Hints, and it works nothing like the header it's replacing.

Here's the shape of it. A handful of basics -- browser brand, whether the device is mobile, the
platform -- get sent automatically, on every request, as low-entropy hints. Nothing more
specific than that goes out by default. If a server wants finer detail -- the exact browser
version, the platform version, the device model, the CPU architecture -- it has to ask, explicitly,
by sending an `Accept-CH` header back in a response. Only then, on a subsequent request, will the
browser include that higher-entropy information. Which means a server's very first response to a
brand-new connection legitimately hasn't asked for anything yet, and won't see it reflected back
-- that's not a bug in whatever's reading the request, that's the protocol working as intended.

Now, back to that fake brand. It has a name: GREASE. It's borrowed directly from the same idea
you'll hear about again in the very next episode, when we get to the TLS handshake -- inserting
deliberately bogus values into a protocol specifically so nobody can get away with writing code
that only handles the values that exist today. If Chrome only ever sent real brand names in a
fixed order, sooner or later some server somewhere would write a parser that expects exactly
that shape, breaks the moment a new browser or a new Chromium fork shows up with a brand nobody
anticipated, and then blames the new browser for being "unsupported." Sprinkle in a fake,
randomly-formatted entry on every single request, and that lazy parser breaks immediately, during
normal Chrome traffic, in development, long before it ever ships. The randomness isn't
decoration. It's the whole enforcement mechanism.

There's a second motive sitting right alongside the anti-ossification one, and it's the one that
matters most for this course: Client Hints were built, in part, explicitly as a response to
fingerprinting. The old User-Agent string was a broadcast -- full version numbers, exact platform
details, all of it, on every single request, to every single site, whether that site had any
legitimate reason to know or not. High-entropy Client Hints flip that by design: a server has to
ask, on purpose, for the more identifying details, and that ask is itself visible and auditable,
rather than every site silently receiving maximum detail as a side effect of just existing.
Alongside this, Chrome has been separately freezing and reducing the old User-Agent string
itself -- unifying platform details, capping version reporting -- specifically to shrink how much
passive fingerprinting the old free-text header enables by default, now that Client Hints exist
as the deliberate, opt-in alternative.

Does this actually stop fingerprinting? No -- and it was never trying to. It changes the shape of
the problem, not the existence of it. A server can still ask for every high-entropy hint on offer
and get a very identifying answer back; Client Hints don't hide information; they make requesting
it explicit and, in principle, auditable, rather than ambient. And the low-entropy hints that
still arrive automatically on every request -- brand, mobile-or-not, platform -- are themselves a
signal, one more data point to cross-check against everything else: does the browser brand in
Sec-CH-UA actually agree with the browser family a User-Agent string claims? Does the platform
hint match what the User-Agent says the operating system is? When they don't agree, that
disagreement is often more informative than either signal alone -- which is exactly the kind of
cross-signal check this course comes back to again and again.

One structural detail worth remembering, because you'll see its cousin in a much higher-stakes
form next episode: Client Hints are still just headers. Client-supplied, in the end, however
deliberately they're gathered. The layer we're heading to next isn't like that at all -- it
happens before a single header exists, in the cryptographic handshake that has to succeed before
your browser can even ask to speak HTTP. That's the TLS ClientHello, and it's next.
