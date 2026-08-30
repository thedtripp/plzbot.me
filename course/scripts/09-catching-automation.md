Here's a genuinely clever trick, published by a researcher named Antoine Vastel -- who has spent
enough of his career on exactly this problem that he's now VP of Research at a bot-detection
company, with a PhD built around browser fingerprinting. Ask a page two separate, completely
ordinary questions: what does `Notification.permission` currently say, and what does
`navigator.permissions.query` say about that same notifications permission? On an ordinary
browser, those two answers always agree -- they're two different ways of asking about the exact
same underlying permission state. On headless Chrome, for a stretch of its history, they didn't.
One would say "denied." The other would say "prompt." Nobody wrote a header that says "I am
headless." Two independent APIs, both truthfully reporting their own little corner of the
browser's internal state, just happened to disagree with each other -- because whatever handled
permissions in headless mode wasn't quite wired up the same way as the version that talks to an
actual human.

That's the shape of almost everything in this episode: no single flag that says "bot." Little
inconsistencies, in places nobody thought to keep in sync.

The strongest signal we have isn't a trick at all, though -- it's a deliberate, on-the-record
design decision. The WebDriver specification, a W3C standard since 2018, defines
`navigator.webdriver` as a read-only property every conforming browser must expose: true when
the browser is under automation control, false otherwise. This isn't a workaround or a clever
side-channel. Browser vendors built this on purpose, specifically so that automated traffic could
identify itself if it wanted to be honest about it. Which means, when you see `navigator.webdriver`
report true, you're not reading a guess -- you're reading the browser engine's own, spec-mandated
admission, coming from underneath any code a script author wrote, not from anything they typed
into a header.

Compare that to the weakest, oldest signal in this whole category: the User-Agent string, again.
"HeadlessChrome." "Puppeteer." "Selenium." "PhantomJS." Automation tools have historically left
recognizable tokens sitting right in plain text, and checking for them catches a meaningful amount
of low-effort automation for free. It also proves almost nothing on its own -- User-Agent is free
text, exactly like episode four, and swapping "HeadlessChrome" for an ordinary Chrome string costs
one line of code. If you remember the curl experiment from episode four -- the one where I
rewrote curl's User-Agent to claim Chrome, and it still got caught, missing every header a real
Chromium sends alongside that claim -- you already understand why this category matters more in
combination than alone. A convincing fake User-Agent, missing the Client Hints and Fetch Metadata
headers a real browser sends automatically, is its own kind of tell, structurally identical to
what caught curl.

`navigator.webdriver`, missing headers, permission-API mismatches, leftover global variables some
automation frameworks forget to clean up, empty plugin or language lists that a real browser
almost never has -- none of these individually proves automation. Together, weighted by how hard
each one actually is to fake, they build a case. And this is a real, ongoing fight, not a solved
problem written up once and left alone. Vastel's own published research moved through three
public rounds -- version one, then a second round of techniques after Chrome quietly patched the
first, then a third. Chromium's own engineers have shipped intentional fixes specifically aimed at
closing gaps like the one that started this episode, publicly discussed as exactly that: closing
a known detection gap. Detection techniques get published, automation tooling adapts, browser
vendors patch the underlying inconsistency, and new gaps get found. Nobody wins this permanently.
That's not a flaw in the approach -- it's an honest description of what building on inherent
signals, rather than a cookie you fully control, actually looks like over time.

What ties every single one of these signals together, and what makes the whole approach hold up
even as any individual check gets patched, is that none of them are trusted alone. It's the
pattern across several independent signals -- User-Agent, `navigator.webdriver`, expected headers,
permission states -- agreeing or disagreeing with each other that actually carries weight. Which
is exactly the idea we generalize next: not just "is this automated," but the much broader
question of what it means when any two signals, anywhere in a fingerprint, simply don't agree.
