#!/usr/bin/env python3
"""
Generates a narrated audio file for one course episode using Kokoro-82M, running
entirely locally (no API key, no account, no per-character cost).

Usage:
    tools/generate.py scripts/01-why-fingerprinting-exists.md
    tools/generate.py scripts/01-why-fingerprinting-exists.md --voice am_michael

Requires (see ../README.md for full setup):
  - course/models/kokoro-v1.0.onnx and voices-v1.0.bin (gitignored, not vendored in git)
  - espeak-ng installed via Homebrew, with these env vars set:
      PHONEMIZER_ESPEAK_LIBRARY, PHONEMIZER_ESPEAK_PATH, ESPEAK_DATA_PATH
"""
import argparse
from pathlib import Path

from kokoro_onnx import Kokoro
import soundfile as sf

COURSE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_VOICE = "af_heart"  # chosen after an A/B listen against am_michael and bf_emma


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("script", type=Path, help="Path to a plain-text/markdown episode script")
    parser.add_argument("--voice", default=DEFAULT_VOICE)
    parser.add_argument("--speed", type=float, default=1.0)
    parser.add_argument("-o", "--out", type=Path, default=None, help="Output .wav path (defaults to course/audio/<script-stem>.wav)")
    args = parser.parse_args()

    text = args.script.read_text().strip()
    if not text:
        raise SystemExit(f"{args.script} is empty")

    out_path = args.out or (COURSE_DIR / "audio" / f"{args.script.stem}.wav")
    out_path.parent.mkdir(parents=True, exist_ok=True)

    kokoro = Kokoro(
        str(COURSE_DIR / "models" / "kokoro-v1.0.onnx"),
        str(COURSE_DIR / "models" / "voices-v1.0.bin"),
    )
    samples, sample_rate = kokoro.create(text, voice=args.voice, speed=args.speed, lang="en-us")
    sf.write(str(out_path), samples, sample_rate)
    print(f"wrote {out_path} ({len(samples) / sample_rate:.1f}s, voice={args.voice})")


if __name__ == "__main__":
    main()
