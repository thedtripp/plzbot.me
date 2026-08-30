Picture two requests. Same server, one second apart, same page. To a plain server log, they look
almost identical: same URL, same method, a normal-looking browser listed in the User Agent
header. But one request is a person, sitting in a browser tab, about to buy a concert ticket.
The other is a script, run ten thousand times a minute, trying to grab every ticket before
anyone else gets a chance.

How does the server tell them apart? Not by asking who's who. Neither one has logged in. Neither
one has agreed to anything. And more and more often, neither one is carrying a cookie the server
planted earlier.

That's the question this whole series is built around: how do you recognize a client -- a
browser, a script, anything that speaks HTTP -- using only what it can't help revealing?

For twenty-five years, the honest answer was: you didn't, not really. You planted a cookie. The
first time a browser visited, the server handed it a small piece of text and said, carry this,
and show it to me again next time. The browser complied, automatically, on every request to that
site. RFC 6265 formalizes exactly how that handshake works -- and if you've ever wondered why a
cookie set by one site never shows up on another, that's the same document defining the scoping
rules that make it safe.

Cookies were never secret, and they were never meant to identify you against your will. They
worked because the browser was a willing participant. Which is exactly why they've spent the
last several years quietly losing that role. Safari stopped waiting around first: as of version
13.1, in March of 2020, it blocks third-party cookies by default, for everyone, no settings
required. Firefox followed a similar path, rolling out what it calls Enhanced Tracking Protection
to all users by default starting in 2019. Two of the three major browser engines simply stopped
carrying the cookies that cross-site tracking depended on.

Here's the part almost nobody expects. Chrome -- the browser roughly three out of every four
people browsing the desktop web are using right now -- spent six years building an entire
replacement system for exactly this problem. It was called Privacy Sandbox: a suite of new, more
private ways for ads to work without third-party cookies at all. In October of 2025, Google
retired it. Ten APIs, gone. Third-party cookies stayed in Chrome -- blocking became something you
opt into, not something that happens to you by default. The cookie apocalypse a lot of people
were bracing for didn't happen. Not the way anyone expected.

So if cookies aren't actually disappearing, why does any of this still matter?

Because cookies were never that good at answering the questions people actually need answered. A
cookie tells you this is the same browser that visited before -- but only if the browser kept it,
only if nobody cleared it, and only if something's sending one in the first place, which curl and
Python's requests library never do by default. Fingerprinting isn't a replacement for cookies.
It's an answer to a completely different question: not have I seen this exact visitor before, but
what, right now, in this one request, can I actually tell about what's on the other end?

And it turns out you can tell a lot. Back in 2010, a researcher named Peter Eckersley, working
with the Electronic Frontier Foundation, built a site called Panopticlick and asked volunteers'
browsers a batch of ordinary, non-secret questions: screen resolution, installed fonts, time
zone, a handful of settings any website can already see. Four hundred seventy thousand browsers
later, eighty-three point six percent of them turned out to have a completely unique combination.
Among the browsers that also had Flash or Java installed, common at the time, it was ninety-four
point two percent. Nobody asked those browsers to identify themselves. They just answered a few
mundane questions, honestly, the way browsers are built to. And that was enough.

That's what this course is about: not cookies, and not some single silver-bullet signal, but the
whole quiet stack of things a browser or an HTTP client reveals just by making a request. The
order its headers arrive in. The exact cipher list its TLS library offers before a single byte of
your actual traffic goes anywhere. Whether the JavaScript environment reports what a
script-driven browser is required to report. None of these were built to identify you
specifically. Put enough of them side by side, though, and a server can tell curl from Chrome --
and, harder, tell a real Chrome from a script wearing Chrome's name tag.

We'll go signal by signal: cookies and what took over part of their old job, the network and IP
layer, HTTP headers, the newer Client Hints system that's deliberately replacing raw User-Agent
sniffing, the TLS handshake itself, HTTP/2's own fingerprint, and everything a browser's
JavaScript can see about the machine running it. Then we'll get to the harder, more honest part:
what happens when those signals disagree with each other, how identifiable all of this really
makes you, and where the evidence runs out and speculation would have to begin.

This is episode one. Not a story about cookies dying. A story about what was always sitting
underneath them, waiting to be looked at directly.
