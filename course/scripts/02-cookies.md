In June of 1994, an engineer named Lou Montulli was trying to solve a boring problem. Netscape's
client, MCI, wanted something nobody had really built yet: a shopping cart. Add an item, browse
to another page, and have the cart remember what you'd added. Simple, today. Back then, it was
almost impossible -- because HTTP, the protocol the entire web runs on, has no memory. Every
request arrives as if it's the first one. The server that answered your last click has no idea
you exist.

Montulli's fix was small and strange. The server would hand the browser a little piece of text.
The browser would hold onto it, and send it back, automatically, on every future request to that
site. He'd heard a phrase in a college operating-systems class -- "magic cookie," a packet of
data a program receives and hands back unchanged -- and liked the sound of it. He called his
invention a cookie. By October of that year, Netscape shipped it. And just like that, the
stateless web learned how to remember you.

That's still, mechanically, exactly what a cookie is. A `Set-Cookie` response header. A name, a
value, some rules about when to send it back and to whom. RFC 6265 is the document that finally
wrote down, years later, all the scoping rules that make this safe by default -- a cookie set by
one site doesn't get sent to another, unless something more is done to make it cross-site.

And that "something more" is exactly how cookies became a tracking mechanism nobody asked for.
Embed one small resource from a third-party domain -- an ad, an analytics pixel, a "like" button
-- on a thousand different websites, and that third party's server can set one cookie that gets
sent back to it from all thousand of them. You never told it who you are. But it can tell that
the browser reading article one on Monday is the same browser reading article two on Tuesday,
because it's the same cookie, echoed back automatically, invisibly, every single time.

This is the part that took the industry by surprise. In February of 2020, Chrome quietly changed
one default. Cookies that don't explicitly declare a `SameSite` attribute used to be sent on
every request, cross-site included, by default. Chrome 80 flipped that: no explicit setting now
means `Lax` -- roughly, only sent when you're actually navigating to that site directly, not when
some other page is quietly loading it in the background. One browser update, and a huge portion
of the web's existing third-party cookies simply stopped working the way their authors assumed
they would. Explicit `SameSite=None` -- which also requires marking the cookie `Secure` -- became
the only way to opt back in to the old behavior. Sites had to ask for cross-site tracking. It
stopped being the default.

Combine that with what you already know from episode one -- Safari blocking third-party cookies
outright since 2020, Firefox doing the same by default since 2019 -- and you can see the shape of
a six-year arms race. Browsers keep closing doors. And trackers keep looking for ones that were
left open.

Here's the cleverest -- and most unsettling -- example. In 2010, a researcher named Samy Kamkar
published a tool called evercookie, entirely to make a point: an identifier doesn't have to live
in just one place. Kamkar's evercookie stored the same ID redundantly, in over a dozen different
browser storage mechanisms at once -- not just cookies, but things like local storage, an
`ETag` cache header, even the browser's own HSTS security state, which can be quietly toggled on
or off per-domain to encode individual bits. Clear your cookies, and evercookie notices they're
gone, checks the other dozen hiding places, and simply writes the same identifier back into the
one you cleared. Kamkar wasn't building a tracking company. He was demonstrating, publicly and on
GitHub, exactly how far "clear your cookies" actually gets you against someone determined enough.
Not very far, it turns out, unless the browser itself refuses to offer those hiding places in the
first place -- which is a real part of why browsers have spent years locking down exactly the
mechanisms evercookie abused.

So: cookies were invented to solve a shopping cart. They became the backbone of cross-site
tracking almost by accident, through nothing more exotic than "share one cookie across many
sites." And for two decades, the entire privacy fight has been fought on cookies' own turf --
what gets sent, to whom, by default, and how many other hiding places an identifier can respawn
from once the obvious one gets cleared.

Fingerprinting isn't a move in that same fight. It's a different fight entirely. A cookie, however
well hidden, is still something placed on your machine and read back later -- an object that
exists, that a sufficiently thorough privacy tool can eventually find and delete, evercookie's
dozen hiding places included. A fingerprint isn't placed anywhere. There's no file to find, no
storage to clear. It's assembled, fresh, from characteristics your connection and your browser
were always going to reveal just by functioning -- the same way your request's TLS handshake
reveals its cipher list before a single cookie could ever be read.

That's the shift this course is really about. Not a better cookie. Something that was never a
cookie at all. Next: the very first thing a server sees, before a single header is even parsed --
your IP address, and why it's a real signal that's also a surprisingly weak one.
