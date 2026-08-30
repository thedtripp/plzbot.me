import type { Observation } from "../../shared/schema/types.js";
import { observed, unsupported } from "../../shared/schema/types.js";

const VIDEO_CODECS: Record<string, string> = {
  h264: 'video/mp4; codecs="avc1.42E01E"',
  hevc: 'video/mp4; codecs="hvc1"',
  vp8: 'video/webm; codecs="vp8"',
  vp9: 'video/webm; codecs="vp9"',
  av1: 'video/mp4; codecs="av01.0.05M.08"',
  ogg_theora: 'video/ogg; codecs="theora"',
};

const AUDIO_CODECS: Record<string, string> = {
  aac: 'audio/mp4; codecs="mp4a.40.2"',
  mp3: "audio/mpeg",
  opus: 'audio/webm; codecs="opus"',
  vorbis: 'audio/ogg; codecs="vorbis"',
  flac: "audio/flac",
  wav: "audio/wav",
};

export function collectMedia(): Observation[] {
  const out: Observation[] = [];

  const video = document.createElement("video");
  const canPlayVideo = typeof video.canPlayType === "function";
  if (!canPlayVideo) {
    out.push(unsupported("browser.media.video_codec_support", "browser.media", "client", "video_canplaytype"));
  } else {
    const support: Record<string, string> = {};
    for (const [name, mime] of Object.entries(VIDEO_CODECS)) {
      support[name] = video.canPlayType(mime);
    }
    out.push(observed("browser.media.video_codec_support", "browser.media", "client", "video_canplaytype", support));
  }

  const audio = document.createElement("audio");
  const canPlayAudio = typeof audio.canPlayType === "function";
  if (!canPlayAudio) {
    out.push(unsupported("browser.media.audio_codec_support", "browser.media", "client", "audio_canplaytype"));
  } else {
    const support: Record<string, string> = {};
    for (const [name, mime] of Object.entries(AUDIO_CODECS)) {
      support[name] = audio.canPlayType(mime);
    }
    out.push(observed("browser.media.audio_codec_support", "browser.media", "client", "audio_canplaytype", support));
  }

  out.push(
    observed(
      "browser.media.prefers_color_scheme",
      "browser.media",
      "client",
      "matchmedia",
      window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
    ),
  );
  out.push(
    observed(
      "browser.media.prefers_reduced_motion",
      "browser.media",
      "client",
      "matchmedia",
      Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches),
    ),
  );
  out.push(
    observed(
      "browser.media.forced_colors",
      "browser.media",
      "client",
      "matchmedia",
      Boolean(window.matchMedia?.("(forced-colors: active)").matches),
    ),
  );

  return out;
}
