# Course: how client fingerprinting works

An audio-first course teaching the concepts plzbot.me demonstrates — cookies, network/IP,
HTTP headers, Client Hints, TLS/JA3/JA4, HTTP/2, browser/JS signals, automation detection,
cross-signal consistency, identifiability, and the evidence-not-verdict design philosophy
behind this project's schema.

Every factual claim is checked against a primary source (RFC/spec text) plus one independent
corroborating source (MDN, an academic paper, or a vendor spec) before it goes in a script.
Anything that can't be corroborated twice gets flagged rather than stated as fact.

## Episode scripts

Plain-text/markdown scripts live in `scripts/`, one file per episode, numbered in the order
they're meant to be listened to (the course assumes each episode builds on the last — it isn't
meant to be consumed out of order). See the outline discussion in project memory / conversation
history for the current episode list and source plan; scripts get added here as they're drafted
and verified.

## Audio generation

Narration is generated locally with [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M)
(Apache 2.0, ~327MB, runs on CPU faster than real time) via the
[`kokoro-onnx`](https://github.com/thewh1teagle/kokoro-onnx) runtime — no API key, no account,
no per-character cost, and no data leaves this machine.

Voice: **`af_heart`**, chosen after an A/B listen against `am_michael` and `bf_emma`.

### One-time setup

```sh
# System dependency — the kokoro-onnx package's bundled espeak-ng loader ships a broken
# path baked in from its build CI, so use Homebrew's espeak-ng instead:
brew install espeak-ng

# Python env (isolated from the rest of this repo, which is Node/TS)
cd course
python3 -m venv tools/.venv
tools/.venv/bin/pip install kokoro-onnx soundfile

# Model files (~337MB, gitignored — not vendored in this repo)
gh release download model-files-v1.1 --repo thewh1teagle/kokoro-onnx \
  -p "kokoro-v1.0.onnx" -p "voices-v1.0.bin" -D models
```

### Generating an episode

```sh
cd course
export PHONEMIZER_ESPEAK_LIBRARY=/opt/homebrew/lib/libespeak-ng.dylib
export PHONEMIZER_ESPEAK_PATH=/opt/homebrew/bin/espeak-ng
export ESPEAK_DATA_PATH=/opt/homebrew/Cellar/espeak-ng/1.52.0/share/espeak-ng-data

tools/.venv/bin/python3 tools/generate.py scripts/01-why-fingerprinting-exists.md
```

Output lands in `audio/` (gitignored — generated audio isn't committed; only scripts and
tooling are). Re-run any time a script changes.
