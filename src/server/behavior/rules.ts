import type { Confidence } from "../../shared/schema/types.js";
import type { BehaviorFeatures } from "./features.js";

export type BehaviorVerdict = "likely_automated" | "likely_human" | "inconclusive" | "not_enough_interaction";

export interface BehaviorEvidence {
  id: string;
  title: string;
  statement: string;
  /** Which way this evidence points. */
  direction: "automated" | "human";
  /** How much it counts toward the verdict (1 = hint, 3 = strong). */
  weight: number;
  confidence: Confidence;
  /** Feature ids (see SIGNAL_CATALOG) this evidence is computed from. */
  features: string[];
}

export interface BehaviorAssessment {
  verdict: BehaviorVerdict;
  automatedWeight: number;
  humanWeight: number;
  evidence: BehaviorEvidence[];
}

const MIN_INTERACTIONS = 3;
const AUTOMATED_AT = 3;
const HUMAN_AT = 3;

type Rule = (f: BehaviorFeatures) => BehaviorEvidence | null;
const n = (f: BehaviorFeatures, id: string): number | null => (typeof f[id] === "number" ? (f[id] as number) : null);

// All thresholds are first guesses informed by published agent studies (FP-Agent, arXiv 2605.01247) and vendor
// write-ups; none is calibrated against this site's own traffic yet. Each rule says what it saw, and why it can be wrong.
const RULES: Rule[] = [
  (f) => {
    const c = n(f, "behavior.events.untrusted");
    return c
      ? {
          id: "behavior.untrusted_events", title: "Script-dispatched input events", direction: "automated", weight: 4, confidence: "high",
          statement: `${c} input event(s) had isTrusted=false, meaning page script or a test driver created them rather than the browser reporting real input.`,
          features: ["behavior.events.untrusted"],
        }
      : null;
  },
  (f) => {
    const c = n(f, "behavior.keys.programmatic_inputs");
    return c
      ? {
          id: "behavior.programmatic_input", title: "Fields filled without typing or clicking", direction: "automated", weight: 3, confidence: "high",
          statement: `${c} field change(s) happened with no key press or click on that field just before — the signature of a value being set directly (e.g. Playwright fill, a DOM write).`,
          features: ["behavior.keys.programmatic_inputs"],
        }
      : null;
  },
  (f) => {
    const t = n(f, "behavior.mouse.teleport_clicks");
    const c = n(f, "behavior.mouse.clicks");
    return t && c && c >= 2 && t / c >= 0.5
      ? {
          id: "behavior.teleporting_cursor", title: "Cursor jumps straight to the click", direction: "automated", weight: 3, confidence: "medium",
          statement: `${t} of ${c} clicks had at most one mouse movement in the 400 ms before them. People move the pointer along a path; many agents move it once and click.`,
          features: ["behavior.mouse.teleport_clicks", "behavior.mouse.clicks"],
        }
      : null;
  },
  (f) => {
    const p = n(f, "behavior.keys.paste_count");
    return p
      ? {
          id: "behavior.paste_used", title: "Text was pasted", direction: "automated", weight: 2, confidence: "medium",
          statement: `${p} paste event(s). Pasting was the single strongest agent signal in published research, but people paste too, so on its own it only adds weight.`,
          features: ["behavior.keys.paste_count"],
        }
      : null;
  },
  (f) => {
    const gap = n(f, "behavior.keys.interkey_median_ms");
    const chars = n(f, "behavior.keys.chars") ?? 0;
    return gap !== null && gap < 15 && chars >= 8
      ? {
          id: "behavior.superhuman_typing", title: "Keys arrive faster than a person can type", direction: "automated", weight: 3, confidence: "high",
          statement: `Median gap between keystrokes was ${gap} ms across ${chars} keys. Fast human typists sit around 60–150 ms.`,
          features: ["behavior.keys.interkey_median_ms", "behavior.keys.chars"],
        }
      : null;
  },
  (f) => {
    const sd = n(f, "behavior.keys.interkey_stdev_ms");
    const gap = n(f, "behavior.keys.interkey_median_ms");
    const chars = n(f, "behavior.keys.chars") ?? 0;
    return sd !== null && gap !== null && gap >= 15 && sd < 3 && chars >= 8
      ? {
          id: "behavior.metronomic_typing", title: "Keystroke spacing is almost perfectly even", direction: "automated", weight: 2, confidence: "medium",
          statement: `Spacing between keys varied by only ${sd} ms. Human rhythm varies with finger travel and letter pairs; a fixed per-key delay does not.`,
          features: ["behavior.keys.interkey_stdev_ms"],
        }
      : null;
  },
  (f) => {
    const h = n(f, "behavior.keys.hold_median_ms");
    return h !== null && h < 8
      ? {
          id: "behavior.instant_key_release", title: "Keys released almost instantly", direction: "automated", weight: 2, confidence: "medium",
          statement: `Median key hold time was ${h} ms. Physical key presses are held for tens of milliseconds at least.`,
          features: ["behavior.keys.hold_median_ms"],
        }
      : null;
  },
  (f) => {
    const s = n(f, "behavior.scroll.without_input");
    return s
      ? {
          id: "behavior.scroll_without_input", title: "Page scrolled with no wheel, touch or key input", direction: "automated", weight: 2, confidence: "medium",
          statement: `${s} scroll event(s) had no wheel, touch, key or scrollbar-drag input just before — typical of scrollTo()/scrollIntoView or a DevTools-protocol scroll.`,
          features: ["behavior.scroll.without_input"],
        }
      : null;
  },
  (f) => {
    const j = n(f, "behavior.scroll.instant_jumps");
    return j
      ? {
          id: "behavior.instant_scroll", title: "Scroll position jumped in one frame", direction: "automated", weight: 2, confidence: "medium",
          statement: `${j} scroll(s) moved 200+ px within 20 ms. Wheel and touch scrolling is gradual.`,
          features: ["behavior.scroll.instant_jumps"],
        }
      : null;
  },
  (f) => {
    const g = n(f, "behavior.timing.action_gap_median_ms");
    const a = n(f, "behavior.timing.actions") ?? 0;
    return g !== null && g < 80 && a >= 4
      ? {
          id: "behavior.machine_pace", title: "Actions follow each other at machine pace", direction: "automated", weight: 2, confidence: "medium",
          statement: `Median time between ${a} deliberate actions was ${g} ms. Automation frameworks chain steps within tens of milliseconds; people take much longer.`,
          features: ["behavior.timing.action_gap_median_ms", "behavior.timing.actions"],
        }
      : null;
  },
  (f) => {
    const s = n(f, "behavior.mouse.straightness");
    const v = n(f, "behavior.mouse.velocity_cv");
    return s !== null && s >= 0.99 && (v === null || v < 0.15)
      ? {
          id: "behavior.ruler_straight_mouse", title: "Mouse paths are perfectly straight", direction: "automated", weight: 1, confidence: "low",
          statement: `Average path straightness was ${s} (1 = ruler line), at near-constant speed. Human paths bend and speed up and slow down.`,
          features: ["behavior.mouse.straightness", "behavior.mouse.velocity_cv"],
        }
      : null;
  },
  // ----- human-leaning evidence: each is imitable by a determined bot, so none is "high" confidence -----
  (f) => {
    const gap = n(f, "behavior.keys.interkey_median_ms");
    const sd = n(f, "behavior.keys.interkey_stdev_ms");
    const hold = n(f, "behavior.keys.hold_median_ms");
    const chars = n(f, "behavior.keys.chars") ?? 0;
    return gap !== null && sd !== null && hold !== null && chars >= 8 && gap >= 40 && gap <= 500 && sd >= 25 && hold >= 25 && hold <= 300
      ? {
          id: "behavior.human_typing_rhythm", title: "Typing rhythm looks human", direction: "human", weight: 3, confidence: "medium",
          statement: `Keys came a median ${gap} ms apart (±${sd} ms) and were held ${hold} ms, with natural variation.`,
          features: ["behavior.keys.interkey_median_ms", "behavior.keys.interkey_stdev_ms", "behavior.keys.hold_median_ms"],
        }
      : null;
  },
  (f) => {
    const r = n(f, "behavior.mouse.curvature_angle_range_deg");
    const v = n(f, "behavior.mouse.velocity_cv");
    const moves = n(f, "behavior.mouse.moves") ?? 0;
    return r !== null && v !== null && moves >= 20 && r >= 60 && v >= 0.4
      ? {
          id: "behavior.human_mouse_path", title: "Mouse movement is curved and varies in speed", direction: "human", weight: 3, confidence: "medium",
          statement: `${moves} movement samples with a ${r}° spread of turning angles and speed variation of ${v}. Hand movement has corrections and acceleration.`,
          features: ["behavior.mouse.curvature_angle_range_deg", "behavior.mouse.velocity_cv", "behavior.mouse.moves"],
        }
      : null;
  },
  (f) => {
    const c = n(f, "behavior.keys.corrections");
    return c
      ? {
          id: "behavior.corrections", title: "Typing included corrections", direction: "human", weight: 1, confidence: "low",
          statement: `${c} Backspace/Delete press(es). People make and fix typos; most agents type each character once.`,
          features: ["behavior.keys.corrections"],
        }
      : null;
  },
  (f) => {
    const g = n(f, "behavior.scroll.gradual_bursts");
    const w = n(f, "behavior.scroll.without_input");
    return g && !w
      ? {
          id: "behavior.gradual_scroll", title: "Scrolling was gradual and input-driven", direction: "human", weight: 1, confidence: "low",
          statement: `${g} scroll(s) unfolded over 100+ ms across 5+ events, each following real wheel, touch or key input.`,
          features: ["behavior.scroll.gradual_bursts", "behavior.scroll.without_input"],
        }
      : null;
  },
];

export function assess(features: BehaviorFeatures): BehaviorAssessment {
  const evidence: BehaviorEvidence[] = [];
  for (const rule of RULES) {
    try {
      const e = rule(features);
      if (e) evidence.push(e);
    } catch {
      // a broken rule must not take down the whole verdict
    }
  }
  const sumFor = (d: BehaviorEvidence["direction"]) => evidence.filter((e) => e.direction === d).reduce((s, e) => s + e.weight, 0);
  const automatedWeight = sumFor("automated");
  const humanWeight = sumFor("human");

  let verdict: BehaviorVerdict;
  if ((n(features, "behavior.events.interactions") ?? 0) < MIN_INTERACTIONS) verdict = "not_enough_interaction";
  else if (automatedWeight >= AUTOMATED_AT && automatedWeight > humanWeight) verdict = "likely_automated";
  else if (humanWeight >= HUMAN_AT && automatedWeight <= 1) verdict = "likely_human";
  else verdict = "inconclusive";
  return { verdict, automatedWeight, humanWeight, evidence };
}
