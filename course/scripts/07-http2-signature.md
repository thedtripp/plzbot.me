Right after a browser and server agree to speak HTTP/2 -- literally the first frame each side
sends -- is something called a SETTINGS frame. It's not a request. It's not data. It's closer to
a handshake within the handshake: a small list of numbers, six of them defined by the spec,
telling the other side how this connection is going to behave. How big a header-compression table
should the peer maintain -- SETTINGS_HEADER_TABLE_SIZE, starting at 4,096 bytes by default. How
many requests can run at once, in parallel, over this one connection --
SETTINGS_MAX_CONCURRENT_STREAMS. How large a single frame is allowed to be. Whether server push
is even allowed. None of this is secret. It's the opening move of every single HTTP/2 connection,
sent automatically, by code, before either side has asked for a single web page.

And exactly like the header order back in episode four, none of this was designed to identify
anything. It's configuration. But configuration written by code, not typed by a person, tends to
be remarkably consistent within one piece of software and remarkably different across pieces of
software -- Chrome picks numbers Chrome always picks; a particular HTTP library picks whatever
its author hard-coded. Bundle those six settings together, in the order the frame lists them, and
you get one more fingerprint, sitting one layer above TLS and one layer below the actual request.

HTTP/2 has a second signature buried in it too, and it's a subtler one. HTTP/1.1 sent a plain
text request line -- `GET /page HTTP/1.1` -- but HTTP/2 doesn't have a request line at all. It
replaces that job with four special headers, called pseudo-headers because they start with a
colon: `:method`, `:scheme`, `:authority`, `:path`. Every request carries all four. And I went and
checked, directly against the current spec, RFC 9113: it defines what each one means, in detail
-- and says nothing at all about what order they have to arrive in. That silence is deliberate,
the same kind of deliberate silence header order enjoyed back in episode four. Different
implementations pick their own order and stick to it, and because it's baked into networking code
rather than chosen per-request, it's stable enough to be one more piece of evidence.

Here's the honest part, and it's the kind of honest this whole course tries to be. This
particular signal -- pseudo-header order -- is one this project doesn't actually report. Not
because it isn't real. Because of a second engineering wall I hit building the very same server
these episodes keep referencing.

Node's HTTP/2 support comes in two flavors. There's a low-level "core" API that hands you raw
frames and streams directly -- which would show you pseudo-header order, if you wanted it. And
there's a "compatibility API," built specifically so ordinary request/response code -- the kind
written for HTTP/1.1 for two decades -- keeps working unmodified over HTTP/2. That compatibility
layer is genuinely convenient. It's also where I initially tried mounting a full web framework,
and where the server crashed, reliably, on every single HTTP/2 request, with an error buried deep
in Node's internals about reading a property of something undefined. Stripping the framework down
to nothing, one piece at a time, eventually isolated it to the framework itself being fundamentally
incompatible with that compatibility layer -- not a bug in my code, a bug in the combination. The
fix was to drop the framework entirely and hand-write a small router directly against Node's raw
request and response objects.

That fix solved the crash. It didn't solve pseudo-header order, because the same compatibility
API that caused the crash also does something else, on every request, whether you want it to or
not: it takes the four pseudo-headers and folds them into an ordinary flat object alongside the
regular headers, the same shape application code has always expected from HTTP/1.1 -- and an
ordinary object doesn't remember what order its properties arrived in. By the time your code sees
the request at all, the order is already gone. Getting it back would mean abandoning the
compatibility layer entirely and rebuilding directly on Node's raw stream API -- a real, known
option, just not one this project has taken.

That's worth sitting with for a second, because it's the whole point of being evidence-based
rather than just impressive-sounding: a real signal, well documented, genuinely used by some
production systems for exactly this kind of detection -- and this particular implementation
simply doesn't have access to it, for a concrete, inspectable reason, not a hand-wave. The
SETTINGS values, though, survive that same compatibility layer intact and get reported honestly.

Between JA3, JA4, and now HTTP/2's SETTINGS, that's three independent layers stacked underneath
the actual HTTP request -- TLS library, then HTTP/2 negotiation, then, finally, the request
itself. Next, we climb all the way up, into the one layer that isn't passive at all: what a
browser's own JavaScript reveals about the machine it's running on, the moment a page actually
loads.
