Here's a simple way to think about identifiability, before any of the math: how many yes-or-no
questions would you need to ask a crowd to narrow it down to exactly one person? Ask "are you
taller than average," and you cut the crowd roughly in half. Ask "do you have brown eyes," and
you cut what's left again. Each additional question that splits the remaining group roughly in
half is worth what researchers call one bit of information. Ask enough good questions, and even a
crowd of a million people eventually narrows down to one.

A browser fingerprint works exactly the same way, except the questions aren't spoken -- they're
things like "what does your canvas rendering hash to" or "which exact cipher list does your TLS
library offer." Go back to Eckersley's 2010 study from episode one: eighty-three point six percent
of four hundred seventy thousand browsers turned out unique. That's what asking enough of these
questions, of enough real people, actually produced. The EFF still runs a version of that same
research today, under the name Cover Your Tracks -- and it reports results in exactly the "bits"
framing I just described: how many bits of identifying information your particular combination of
signals carries, phrased as roughly one-in-however-many other browsers share your exact
combination.

Here's the part worth sitting with, because it's counterintuitive at first: not every signal is
worth the same number of bits. Whether your browser sends `Accept-Language: en-US` splits a huge
population into a handful of large groups -- millions of people share that exact value, so it's
barely worth a fraction of a bit on its own. A canvas rendering hash, by contrast, depends on a
specific combination of GPU, driver version, operating system, and font rasterizer all interacting
at once -- and the number of people sharing your exact combination of all of that can be
astonishingly small. That's exactly why episode eight -- canvas, WebGL, audio, fonts -- carries
more of the actual identifying weight in a full fingerprint than headers or even the TLS layer
usually do on their own. High-entropy isn't a vague quality. It's a direct measure of how few
other people, out of everyone who could possibly visit, would land on the exact same value you
did.

Now, an honest admission, and it's the same one this project makes plainly in its own
documentation: this course's own companion app deliberately does not compute a number like that
for any individual fingerprint it produces. Not because the idea is wrong -- Cover Your Tracks
does exactly this, credibly, and has for over a decade. It's because doing it honestly requires
something this particular tool doesn't have: a real population of previously-collected
fingerprints to compare a new one against. Say "your fingerprint is one in eight hundred thousand"
without an actual dataset of eight hundred thousand real fingerprints behind that number, and
you're not measuring anything -- you're making the number up and dressing it in the language of
research. A stateless tool that never stores anything, by design, from episode two onward, simply
has nothing to compare against. So instead of a fabricated score, what you get is a named list:
which of the commonly-cited high-entropy categories -- canvas, WebGL, audio, fonts, JA3, JA4, the
high-entropy Client Hints -- actually showed up in this particular fingerprint, citing the general
research finding about that category, not a number invented for the occasion.

That's a real trade-off, not a hedge dressed up as one. A computed score would look more
impressive. It would also be quietly fake, in a course that has spent eleven episodes insisting on
the difference between evidence and a verdict. Naming the ingredients honestly, without
manufacturing a number nobody actually measured, is the more defensible choice -- even though it's
the less flashy one.

So: identifiability isn't a single property a fingerprint either has or doesn't. It's additive.
Common signals contribute almost nothing on their own. Rare ones, especially the kind that come
from real hardware behaving in real, physically distinct ways rather than a string someone typed,
can do most of the work by themselves. And reporting on any of it honestly means being just as
clear about what you can't responsibly claim as what you can.

Which brings us, finally, to the idea this entire course has actually been building toward from
the very first episode: not one more signal, but the design decision that ties every signal in
this series together -- why raw observations, computed values, and interpretations are kept
strictly separate, and why nothing you've heard across these eleven episodes ever collapses into
a single word like "bot." That's next, and it's the last one.
