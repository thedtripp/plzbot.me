import type { Observation } from "../../shared/schema/types.js";
import { observed, unsupported, observationError } from "../../shared/schema/types.js";
import { djb2Hash } from "../util.js";

/**
 * Canvas fingerprinting: render fixed text/shapes and hash the resulting pixel data. Different
 * GPUs, drivers, OSes, and font-rendering stacks produce measurably different pixels for
 * identical drawing instructions, which is what makes this a fingerprinting vector at all —
 * see references in the signal catalog. We hash the output (djb2Hash, non-cryptographic, purely
 * for compactness — see src/client/util.ts) rather than shipping the full data URL, and we
 * additionally report the data URL's length as a coarse, non-identifying-by-itself observation.
 */
function canvasFingerprint(): { hash: string; dataUrlLength: number } | null {
  const canvas = document.createElement("canvas");
  canvas.width = 220;
  canvas.height = 30;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.textBaseline = "top";
  ctx.font = "14px 'Arial'";
  ctx.fillStyle = "#f60";
  ctx.fillRect(125, 1, 62, 20);
  ctx.fillStyle = "#069";
  ctx.fillText("plzbot fingerprint \u{1F916} 0123", 2, 15);
  ctx.fillStyle = "rgba(102, 204, 0, 0.7)";
  ctx.fillText("plzbot fingerprint \u{1F916} 0123", 4, 17);

  const dataUrl = canvas.toDataURL();
  return { hash: djb2Hash(dataUrl), dataUrlLength: dataUrl.length };
}

function webglInfo(kind: "webgl" | "webgl2"): Record<string, unknown> | null {
  const canvas = document.createElement("canvas");
  const gl = canvas.getContext(kind) as WebGLRenderingContext | null;
  if (!gl) return null;

  const debugInfo = gl.getExtension("WEBGL_debug_renderer_info");
  const vendor = debugInfo ? gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : gl.getParameter(gl.VENDOR);
  const renderer = debugInfo ? gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);

  return {
    vendor,
    renderer,
    unmasked: Boolean(debugInfo),
    version: gl.getParameter(gl.VERSION),
    shadingLanguageVersion: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    extensions: gl.getSupportedExtensions() ?? [],
  };
}

export function collectGraphics(): Observation[] {
  const out: Observation[] = [];

  try {
    const fp = canvasFingerprint();
    if (fp) {
      out.push(observed("browser.graphics.canvas_hash", "browser.graphics", "client", "canvas_2d_render", fp.hash));
      out.push(observed("browser.graphics.canvas_data_url_length", "browser.graphics", "client", "canvas_2d_render", fp.dataUrlLength));
    } else {
      out.push(unsupported("browser.graphics.canvas_hash", "browser.graphics", "client", "canvas_2d_render"));
      out.push(unsupported("browser.graphics.canvas_data_url_length", "browser.graphics", "client", "canvas_2d_render"));
    }
  } catch (err) {
    out.push(observationError("browser.graphics.canvas_hash", "browser.graphics", "client", "canvas_2d_render", err));
    out.push(observationError("browser.graphics.canvas_data_url_length", "browser.graphics", "client", "canvas_2d_render", err));
  }

  for (const kind of ["webgl", "webgl2"] as const) {
    const idPrefix = kind === "webgl" ? "browser.graphics.webgl" : "browser.graphics.webgl2";
    try {
      const info = webglInfo(kind);
      if (!info) {
        out.push(unsupported(`${idPrefix}_renderer`, "browser.graphics", "client", `${kind}_context`));
        continue;
      }
      out.push(observed(`${idPrefix}_renderer`, "browser.graphics", "client", `${kind}_context`, info.renderer, info));
      out.push(observed(`${idPrefix}_vendor`, "browser.graphics", "client", `${kind}_context`, info.vendor));
      out.push(observed(`${idPrefix}_extension_count`, "browser.graphics", "client", `${kind}_context`, (info.extensions as string[]).length));
    } catch (err) {
      out.push(observationError(`${idPrefix}_renderer`, "browser.graphics", "client", `${kind}_context`, err));
    }
  }

  return out;
}
