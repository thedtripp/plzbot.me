Before a server reads a single header. Before the TLS handshake even finishes. Before your
browser has said one word about who it claims to be -- the operating system already knows one
thing about whoever's connecting: an IP address. It's the oldest signal there is, and it arrives
for free, as a side effect of the TCP connection itself, not because anyone chose to send it.

You'd think that settles it. It doesn't, and the reason why is worth sitting with, because it
shapes how every other signal in this course should be read too.

Start with what an IP address actually tells you. Not a person. Not even reliably a single
device. In a household with five people and a Wi-Fi router, all five show up to the outside
world with the very same address -- the router is doing translation underneath, quietly
swapping many private addresses for the one public one it was assigned. Most home connections
work this way. And mobile carriers take it much further. Under something called carrier-grade
NAT, an ISP hands out addresses from a reserved block -- 100.64.0.0/10, set aside for exactly
this by RFC 6598 -- and shares one real public IP address across not five people, but potentially
hundreds or thousands of subscribers at once, using different port ranges to keep their traffic
apart internally. Two completely unrelated phones on the same carrier, in the same city, can
easily share an IP address a server has no way to tell apart from the outside.

So an IP address is a real signal -- but a weak, noisy one, more like a neighborhood than an
address. That framing matters for everything else too: no single signal in this course is meant
to stand alone. Each one narrows things down a little. None of them, by itself, gets you all the
way to "this specific device."

Now, the part that makes IP addresses genuinely tricky to work with: a server usually isn't
looking at raw TCP directly. Most real deployments sit behind a reverse proxy, a load balancer,
a CDN -- something that terminates the actual connection and forwards the request onward. From
the origin server's point of view, every single request would appear to come from that one
proxy's IP, which is useless. So proxies started stamping the original client's address into a
header before forwarding: `X-Forwarded-For`. It's not part of any core HTTP specification --
it's a convention multiple vendors converged on independently, which is exactly why it's slightly
different everywhere you look. The IETF eventually tried to standardize the idea properly:
RFC 7239 defines a single `Forwarded` header meant to replace `X-Forwarded-For` and its cousins,
with a real syntax and even built-in guidance for a proxy operator who wants to anonymize the
client address on purpose.

Here's the catch, and it's the one thing worth remembering from this entire episode: none of
these forwarded-for headers are trustworthy by default. They're just headers. Any client, talking
directly to your server with no proxy in between at all, can set `X-Forwarded-For` to whatever it
wants -- claim to be arriving from a different continent, spoof a well-known corporate IP, chain
together five fake hops. A server only gets to trust a forwarded-address header if it knows,
specifically, which upstream proxy is allowed to set it, and strips or overwrites anything a
client tried to set on its own first. Skip that step, and you've built a system where an attacker
gets to simply state their own IP address and be believed.

Which is why the honest engineering answer looks almost boring: observe the real, TCP-level
address the connection actually arrived from -- the one the operating system reports, that
nothing upstream can lie about -- and treat every forwarded-for header as informational at best,
never authoritative, unless there's an explicit, configured reason to trust the specific proxy
sending it. Report both. Trust only one.

One honest gap, while we're being honest: none of this -- not the raw IP, not any forwarded
header -- tells you a physical location or an organization on its own. That requires a separate
lookup against a commercial or open geolocation database, matching the address against
known ranges. It's a real, common technique, and a reasonable one. It's also not something every
system does, and a course about evidence should say plainly when a signal simply isn't being
collected, rather than leaving a gap that looks like an oversight.

So: an address that arrives for free, means less than it looks like it means, and can be
outright lied about the moment a proxy enters the picture. That's the network layer. Next,
we climb one level up the stack, to the layer people usually think of first when they hear
"fingerprinting" at all: what your HTTP headers -- and the order you send them in -- give away
about the software making the request.
