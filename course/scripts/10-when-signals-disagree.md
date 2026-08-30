Let's go back, one more time, to that curl request pretending to be Chrome. By now you know why
it got caught -- missing headers a real Chromium browser sends automatically. But notice what
actually happened underneath that catch: nobody checked one signal and declared a verdict. Two
independent things were compared -- what the User-Agent claimed, and what the rest of the request
actually did -- and they didn't agree. That disagreement, not either signal alone, is the
evidence. This episode is about making that idea explicit, and following it all the way through.

Here's the general shape. Certain pairs of signals, in an honest browser, should always move
together, because they both ultimately describe the same underlying fact from two different
angles. The browser family implied by a User-Agent string and the brand list in Sec-CH-UA are
both, ultimately, describing which browser you're running -- one the old way, one the new way.
When they agree, that's mildly reassuring and not very interesting. When they don't, something is
inconsistent -- either a script setting one and not the other, an extension quietly rewriting
headers, or a browser configuration nobody anticipated. The check doesn't get to know which. It
just gets to say: these two things, which should usually match, don't.

Now for the part that actually separates careful engineering from something that just looks
sophisticated: not every mismatch deserves the same amount of suspicion, and pretending otherwise
would make the whole system less honest, not more useful. Take that exact User-Agent-versus-
Sec-CH-UA-brand check. You already know, from episode five, that Sec-CH-UA deliberately includes
a randomized, GREASE-style fake brand entry on every single request, specifically so lazy parsers
break. A naive mismatch check, blind to that fact, would flag ordinary, honest Chrome traffic as
suspicious constantly, just because it's reading the fake entry as if it were real. The actual
check has to know about GREASE and account for it -- which is exactly why, when this particular
mismatch does show up as a real conflict, it only gets flagged as medium confidence, not high.
It's informative. It is not proof.

Compare that to `navigator.platform` versus the OS a User-Agent implies. That property is
deprecated -- browsers have been actively encouraged to stop relying on it for years -- and
increasingly frozen or deliberately inconsistent by design in modern browsers, the same broader
trend you heard about in episode five. A mismatch there gets weighted even lower: low confidence,
worth surfacing, not worth much on its own. And `Accept-Language` versus the browser's own
`navigator.languages` list disagreeing? That one gets logged honestly as often perfectly innocent
-- plenty of real people run a browser configured in one language while their operating system,
or their Accept-Language header, is set to another. Flagging every one of those as suspicious
would just be wrong, so it isn't.

Notice the pattern across all three: match, mismatch, and exactly how much a given mismatch
should matter, are three separate decisions, not one. A system that only reports "match" or
"conflict" without weighing which conflicts are damning and which are just noise isn't actually
more evidence-based than a single blunt signal -- it's just as blunt, with more steps. The honest
version has to know, for every single pairing, both how these two signals normally relate to each
other, and how easily either one can legitimately vary for reasons that have nothing to do with
deception.

One more pairing worth naming, because it's the most direct: does a User-Agent string that reads
like a phone actually agree with Sec-CH-UA-Mobile, the specific header built to answer exactly
that one question, mobile or not? When those two disagree, there's very little room for an
innocent explanation the way there is with language settings -- which is why that particular
mismatch sits at medium confidence rather than low, even though, like everything in this course,
it's still evidence, not a verdict.

Stack all of these up -- automation checks, consistency checks, TLS, headers, JavaScript signals
-- and you get something that starts to look less like a single fingerprint and more like a case
file. Which raises the question this whole course has been circling since episode one, and that
we finally answer directly next: given all of that, just how identifiable does a particular
combination of signals actually make you?
