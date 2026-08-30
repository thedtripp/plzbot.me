Back in episode one, I gave you a number: eighty-three point six percent of browsers, in a 2010
study, turned out to be uniquely identifiable from nothing but ordinary settings a website can
already see. This episode is about where most of that number actually comes from. Not headers.
Not TLS. JavaScript, once it's allowed to run, asking your machine to draw something, play
something, and measure the tiny, invisible ways it does either one just slightly differently than
everyone else's machine.

Start with canvas fingerprinting, because it's the oldest and the most direct. A page draws
ordinary text, or a simple shape, onto a `<canvas>` element that's never actually shown on
screen -- then reads back the resulting pixels as raw data. Nothing about that sounds
identifying. It's just rendering. But rendering isn't one universal process -- it runs through
your specific GPU, your specific driver, your operating system's specific font rasterizer, with
its own specific anti-aliasing behavior, and every one of those layers can nudge a handful of
pixels by a barely-perceptible amount. Two machines drawing the identical text can come back with
measurably different pixel data, consistently, every time, on that same machine.

Here's the part that should surprise you. In 2016, Steven Englehardt and Arvind Narayanan at
Princeton ran the largest study of its kind at the time -- one million sites, crawled and
measured directly, not surveyed or estimated. Canvas fingerprinting showed up on 1.6 percent of
sites overall. Among just the top 1,000 most-visited sites on the entire web? 5.1 percent. More
than three times as common, not less, on the sites you'd assume have the most reputation to
protect. The same research also caught real, deployed audio fingerprinting in active use, using a
technique we'll get to in a second -- this isn't a hypothetical.

WebGL adds a second, even more direct window, when a browser allows it. There's an extension
called `WEBGL_debug_renderer_info`, and it does exactly what it sounds like: it hands back the
actual, literal name of your graphics hardware -- not a category, the specific vendor and
renderer string. It exists for legitimate debugging. It's also, obviously, extremely identifying,
which is precisely why some browsers have started clamping down on it -- Firefox disables it
outright once you turn on its strict anti-fingerprinting mode. Another small move in the same
arms race you've heard about since episode two.

Audio fingerprinting is the strangest one to explain, because nothing actually gets played out
loud. It uses something called an `OfflineAudioContext`, which processes audio as fast as
possible into a memory buffer instead of sending it to your speakers. Feed that into an
oscillator -- something that generates a simple, repeating waveform purely through math -- and
then run the result through a dynamics compressor, the same kind of audio processing that evens
out volume on a podcast. On paper, every machine should produce identical output; it's just math.
In practice, floating-point audio processing isn't implemented bit-for-bit identically across
every combination of audio hardware and software stack, and those tiny differences, hashed
together, become one more number that's consistent on your machine and different from most
others' -- generated without you hearing a single sound.

Fonts round this out in a quieter way. Browsers deliberately don't expose a list of what's
installed on your system -- that would be a huge, direct fingerprinting surface, and browser
vendors know it. So font detection works around the restriction sideways: render a string of text
using a candidate font name, measure exactly how wide and tall it comes out, and compare that
against the same string rendered in a generic fallback. If the measurements differ, that font is
genuinely installed and being used; if they match the fallback exactly, it probably isn't. Repeat
that check across a long list of common font names, and you get an inferred list of what's on the
machine -- not because anything told you directly, but because you asked a hundred small,
individually harmless-looking questions.

Notice what all four of these have in common, because it's the reason this episode matters more
than it might first seem to. Every signal in episodes four through seven -- headers, TLS,
HTTP/2 -- is something a client's software chose to send. Rewrite the software, and you rewrite
the signal. Canvas output, GPU strings, audio processing artifacts, font metrics: none of that is
a string anyone typed. It's the observable side effect of real hardware and drivers actually doing
real work. You can't just edit a variable to change what your GPU driver does to an anti-aliased
letter. That's what makes this whole category harder to fake convincingly than anything we've
covered so far -- and also exactly why, when a script tries to automate a browser without
carefully faking all of this too, it tends to get caught here, not in its headers.

Which is exactly where we're headed next: what happens when something is trying to look like an
ordinary browser, and what specifically gives an automated one away.
