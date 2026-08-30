I want to tell you about the hardest bug in this entire project, because the reason it happened
is also the entire reason this episode's signal is worth caring about.

Before a browser sends a single HTTP byte -- before it can even ask "GET this page" -- it has to
complete a TLS handshake. The very first message in that handshake is called a ClientHello, and
per RFC 8446, the specification for TLS 1.3, it lists, openly and in plain sight, every cipher
suite the client is willing to use, every extension it supports, in the exact order its TLS
library decided to list them. None of that is encrypted yet. It can't be -- encryption hasn't
been negotiated. Anyone watching the wire, or running the server on the other end, sees the whole
thing.

In 2017, three engineers at Salesforce -- John Althouse, Jeff Atkinson, and Josh Atkins --
noticed something simple about that list: different TLS libraries produce different lists.
Reliably. Curl's list looks like curl's list. A browser's looks like a browser's. So they built
JA3: take five specific fields from the ClientHello -- version, ciphers, extensions, elliptic
curves, and curve point formats -- string them together in order, and run the whole thing through
MD5. Out comes a clean thirty-two character fingerprint of the TLS library itself, computed
before a single cookie, a single header, a single line of your actual HTTP request even exists.

Now here's where I have to admit something. Node, the JavaScript runtime this entire project runs
on, doesn't give you access to any of that. Its TLS module parses the ClientHello internally,
using OpenSSL, and throws the raw bytes away. There's no hook, no callback, no "let me see it
before you touch it." If you want JA3 or JA4 out of a Node server, you have to go get those bytes
yourself.

So I tried the obvious thing. Accept the raw connection myself, peek at the first chunk of bytes
with a one-time listener, put them back exactly where I found them using `socket.unshift()`, and
then hand that same socket off to the real TLS server to do the actual handshake. It sounds like
it should work. It reliably didn't. Curl would just hang, and eventually time out with a "socket
hang up." It took real digging to understand why: Node's `TLSSocket` doesn't read its underlying
connection the normal way, through ordinary stream events. It reaches down and re-parents the raw
socket's low-level handle directly, to drive OpenSSL's state machine itself -- and that only works
on a handle nothing has touched yet. The moment my one-time peek touched it, even just to look,
the handle was in the wrong state, and the handshake silently stalled forever. I confirmed this
wasn't imagined by testing the exact same peek-and-hand-off trick against a plain, non-TLS HTTP
server -- worked perfectly there, every time. The failure was specific to how `TLSSocket` steals
its handle.

The fix that actually works is almost embarrassingly straightforward once you see it: don't touch
the real connection at all. Run a tiny proxy in front of it. The proxy accepts the real client
connection, peeks the ClientHello bytes to compute JA3 and JA4 -- since at that point nothing has
handed the socket to a `TLSSocket` yet, peeking is completely safe -- and then opens a brand new,
separate connection to the real TLS server, on the loopback interface, piping bytes through in
both directions. That inner server gets a socket that's never been touched by anything, exactly
the untouched handle `TLSSocket` needs, and the handshake completes normally. The only remaining
puzzle was reconnecting that inner loopback connection back to the original client it belonged to
-- solved by choosing the proxy's own outbound port number deliberately, instead of letting the
operating system assign one, so it can be looked up later with no guessing involved.

I'm telling you all of that not to brag about a bug fix. I'm telling you because it's a perfect,
concrete demonstration of exactly why JA3 and JA4 are hard signals to fake. They don't live in
application code, the layer where a script sets a header or forges a User-Agent. They live one
level down, inside whatever TLS library actually built the socket -- OpenSSL, BoringSSL,
whatever's compiled in. Spoofing them convincingly doesn't mean editing a string. It means
running an entirely different TLS stack, configured byte-for-byte like the one you're pretending
to be. When I actually ran curl and Python's `requests` library against the same server earlier
in this project, with identical headers, they produced two completely different JA3 hashes --
because under the hood, curl links against a different TLS library than Python's `requests`
does, and neither one matches what a real browser's engine produces either.

JA4, the newer of the two, is where Althouse -- now working under his own company, FoxIO -- went
after JA3's rough edges. It's built to be partly human-readable on sight: the first section packs
version, whether SNI was present, cipher count, extension count, and the negotiated protocol
straight into about ten characters you can read directly, before the two hashed sections even
start. You can tell, at a glance, "TLS 1.3, SNI present, HTTP/2" without hashing anything.

And remember that fake brand entry from the Client Hints episode -- `"Not A;Brand"`? Here's where
that trick actually comes from. RFC 8701 reserves sixteen specific values, all following the
pattern zero-X-A-X-A in hex, specifically for TLS implementations to sprinkle into their
ClientHello at random -- fake cipher suites, fake extensions, fake groups. Any correctly built
server just ignores them and moves on. A lazily built one, that assumed it had already seen every
possible value TLS would ever use, breaks. It's the exact same anti-ossification trick, one
protocol layer down, years before Client Hints borrowed the idea.

One honest limitation, and it's a real one: this only works at all if the server terminating TLS
is the one computing JA3 and JA4. Sit behind a CDN or a load balancer that terminates TLS for
you, and your application code never sees a ClientHello -- there's nothing left to peek at. Some
infrastructure providers pass a computed fingerprint along in a header of their own; most don't.
And JA4 itself, being newer, is more its published specification's best-effort reproduction than
something independently checked against a large, real-world traffic corpus.

Still: TLS gets you a fingerprint of the software making the connection, before that software has
said a single word about who it claims to be. Next, one layer back up the stack -- what HTTP/2
itself, independently of TLS, gives away.
