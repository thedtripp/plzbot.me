import type { Observation } from "../../shared/schema/types.js";
import { observed, unsupported } from "../../shared/schema/types.js";

/**
 * Classic font-detection technique: measure text width/height rendered in a candidate font
 * stacked with generic fallbacks, and compare against the same text rendered in only the
 * generic fallback fonts. If the measurement differs, the candidate font is installed (the
 * browser used it instead of falling back). No dependency, no network font list — a small
 * curated candidate list, documented as such (this is not exhaustive font enumeration, which
 * modern browsers deliberately don't expose without permission).
 */
const CANDIDATE_FONTS = [
  "Arial",
  "Arial Black",
  "Calibri",
  "Cambria",
  "Comic Sans MS",
  "Consolas",
  "Courier New",
  "Georgia",
  "Helvetica",
  "Impact",
  "Lucida Console",
  "Palatino Linotype",
  "Segoe UI",
  "Tahoma",
  "Times New Roman",
  "Trebuchet MS",
  "Verdana",
  "Menlo",
  "Monaco",
  "San Francisco",
  "Noto Sans",
  "Roboto",
];

const BASE_FONTS = ["monospace", "sans-serif", "serif"];
const TEST_STRING = "mmmmmmmmmmlli";
const TEST_SIZE = "72px";

export function collectFonts(): Observation[] {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return [unsupported("browser.fonts.detected", "browser.fonts", "client", "canvas_measuretext_probe")];
  }

  const baseSizes = new Map<string, { width: number; height: number }>();
  for (const base of BASE_FONTS) {
    ctx.font = `${TEST_SIZE} ${base}`;
    const metrics = ctx.measureText(TEST_STRING);
    baseSizes.set(base, {
      width: metrics.width,
      height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent,
    });
  }

  const detected: string[] = [];
  for (const candidate of CANDIDATE_FONTS) {
    let matchesAnyBase = false;
    for (const base of BASE_FONTS) {
      ctx.font = `${TEST_SIZE} '${candidate}', ${base}`;
      const metrics = ctx.measureText(TEST_STRING);
      const size = { width: metrics.width, height: metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent };
      const baseline = baseSizes.get(base)!;
      if (size.width !== baseline.width || size.height !== baseline.height) {
        matchesAnyBase = true;
        break;
      }
    }
    if (matchesAnyBase) detected.push(candidate);
  }

  return [
    observed("browser.fonts.detected", "browser.fonts", "client", "canvas_measuretext_probe", detected, {
      count: detected.length,
      candidatesChecked: CANDIDATE_FONTS.length,
    }),
  ];
}
