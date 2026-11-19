import { describe, it, expect } from "vitest";
import type { BehaviorEvent, BehaviorTrace } from "../../src/shared/behavior.js";
import { computeFeatures } from "../../src/server/behavior/features.js";
import { assess } from "../../src/server/behavior/rules.js";
import { parseTrace } from "../../src/server/behavior/validate.js";

const trace = (events: BehaviorEvent[], extra: Partial<BehaviorTrace> = {}): BehaviorTrace => ({
  events: events.sort((a, b) => a.t - b.t), dropped: 0, danglingKeydowns: 0, viewport: { w: 1280, h: 800 }, ...extra,
});
const ev = (t: number, k: BehaviorEvent["k"], more: Partial<BehaviorEvent> = {}): BehaviorEvent => ({ t, k, tr: 1, ...more });
const run = (events: BehaviorEvent[]) => assess(computeFeatures(trace(events)));
const ids = (a: ReturnType<typeof assess>) => a.evidence.map((e) => e.id);

/** A person-like session: curved, variable mouse path; irregular typing with a typo; gradual scroll; real clicks. */
function humanEvents(): BehaviorEvent[] {
  const out: BehaviorEvent[] = [];
  let t = 100;
  for (let i = 0; i < 40; i++) {
    t += 14 + (i % 5) * 4 + (i > 30 ? 20 : 0);
    out.push(ev(t, "mousemove", { x: 100 + i * 9 + Math.round(30 * Math.sin(i / 3)), y: 400 - i * 5 + Math.round(40 * Math.cos(i / 2.5)), f: "page" }));
  }
  t += 200;
  out.push(ev(t, "mousedown", { x: 400, y: 200, f: "phrase" }), ev(t + 90, "mouseup", { f: "phrase" }), ev(t + 92, "click", { f: "phrase" }));
  t += 500;
  const gaps = [120, 85, 160, 70, 140, 210, 95, 130, 180, 75, 110, 150];
  gaps.forEach((g, i) => {
    t += g;
    out.push(ev(t, "keydown", { kc: i === 6 ? "backspace" : "char", f: "phrase" }), ev(t + 60 + (i % 4) * 12, "keyup", { kc: "char", h: 60 + (i % 4) * 12, f: "phrase" }), ev(t + 2, "input", { it: "insertText", f: "phrase" }));
  });
  t += 600;
  out.push(ev(t, "wheel", { f: "terms" }));
  for (let i = 0; i < 8; i++) out.push(ev(t + 8 + i * 25, "scroll", { d: i * 14, f: "terms" }));
  t += 1200;
  for (let i = 0; i < 12; i++) out.push(ev(t + i * 16, "mousemove", { x: 420 + i * 7, y: 260 + i * 25 + Math.round(12 * Math.sin(i)), f: "page" }));
  t += 300;
  out.push(ev(t, "mousedown", { x: 500, y: 600, f: "agree" }), ev(t + 70, "mouseup"), ev(t + 72, "click", { f: "agree" }), ev(t + 74, "input", { f: "agree" }), ev(t + 75, "change", { f: "agree" }));
  return out;
}

describe("behavior assessment", () => {
  it("calls a person-like session likely_human, citing the evidence", () => {
    const a = run(humanEvents());
    expect(a.verdict).toBe("likely_human");
    expect(ids(a)).toEqual(expect.arrayContaining(["behavior.human_typing_rhythm", "behavior.human_mouse_path"]));
    expect(a.evidence.filter((e) => e.direction === "automated")).toEqual([]);
  });

  it("calls a Playwright-fill style session likely_automated (no keys, one mouse move per click, instant scroll)", () => {
    const a = run([
      ev(10, "focusin", { f: "phrase" }), ev(11, "input", { it: "insertText", f: "phrase" }), ev(11, "change", { f: "phrase" }),
      ev(15, "input", { f: "topic" }), ev(15, "change", { f: "topic" }),
      ev(20, "scroll", { d: 0, f: "terms" }), ev(22, "scroll", { d: 400, f: "terms" }),
      ev(30, "mousemove", { x: 300, y: 300 }), ev(31, "mousedown", { x: 300, y: 300, f: "agree" }), ev(32, "mouseup"), ev(33, "click", { f: "agree" }), ev(33, "input", { f: "agree" }), ev(33, "change", { f: "agree" }),
      ev(60, "mousemove", { x: 600, y: 700 }), ev(61, "mousedown", { x: 600, y: 700, f: "submit" }), ev(62, "mouseup"), ev(63, "click", { f: "submit" }),
    ]);
    expect(a.verdict).toBe("likely_automated");
    expect(ids(a)).toEqual(expect.arrayContaining(["behavior.programmatic_input", "behavior.teleporting_cursor", "behavior.scroll_without_input", "behavior.instant_scroll"]));
  });

  it("flags superhuman typing and instant key release", () => {
    const evs: BehaviorEvent[] = [];
    for (let i = 0; i < 12; i++) evs.push(ev(100 + i * 2, "keydown", { kc: "char", f: "phrase" }), ev(100 + i * 2 + 0.5, "keyup", { kc: "char", h: 0.5, f: "phrase" }), ev(100 + i * 2 + 0.1, "input", { it: "insertText", f: "phrase" }));
    const a = run(evs);
    expect(ids(a)).toEqual(expect.arrayContaining(["behavior.superhuman_typing", "behavior.instant_key_release"]));
    expect(a.verdict).toBe("likely_automated");
  });

  it("flags pasted text and untrusted events", () => {
    const a = run([
      { ...ev(10, "keydown", { kc: "char", f: "phrase" }), tr: 0 }, ev(11, "paste", { f: "phrase" }), ev(12, "input", { it: "insertFromPaste", f: "phrase" }), ev(13, "click", { f: "submit" }),
    ]);
    expect(ids(a)).toEqual(expect.arrayContaining(["behavior.paste_used", "behavior.untrusted_events"]));
    expect(computeFeatures(trace([ev(1, "paste"), ev(2, "input", { it: "insertFromPaste" })]))["behavior.keys.paste_count"]).toBe(1);
  });

  it("does not call a touch tap a teleporting cursor, nor touch scrolling 'without input'", () => {
    const f = computeFeatures(trace([
      ev(10, "touchstart", { f: "page" }), ev(40, "mousedown", { x: 5, y: 5 }), ev(41, "mouseup"), ev(42, "click"),
      ev(500, "scroll", { d: 10 }), ev(900, "scroll", { d: 300 }),
    ]));
    expect(f["behavior.mouse.teleport_clicks"]).toBe(0);
    expect(f["behavior.scroll.without_input"]).toBe(0);
  });

  it("needs enough interaction before judging", () => {
    expect(run([]).verdict).toBe("not_enough_interaction");
    expect(run([ev(5, "click", { f: "submit" })]).verdict).toBe("not_enough_interaction");
  });

  it("keeps a broken feature value from crashing the verdict", () => {
    expect(assess({}).verdict).toBe("not_enough_interaction");
  });
});

describe("parseTrace", () => {
  it("keeps known fields only and sorts events", () => {
    const t = parseTrace({ trace: { events: [{ t: 5, k: "click", tr: 1, f: "a b", evil: "x", key: "a" }, { t: 1, k: "keydown", tr: 1, kc: "char" }], viewport: { w: 10, h: 20 } } });
    expect(t.events.map((e) => e.t)).toEqual([1, 5]);
    expect(t.events[1]).toEqual({ t: 5, k: "click", tr: 1 }); // invalid field id dropped, unknown keys dropped
    expect(t.viewport).toEqual({ w: 10, h: 20 });
  });
  it("rejects malformed input", () => {
    expect(() => parseTrace(null)).toThrow();
    expect(() => parseTrace({ trace: { events: [{ t: "1", k: "click" }] } })).toThrow();
    expect(() => parseTrace({ trace: { events: [{ t: 1, k: "nope" }] } })).toThrow();
    expect(() => parseTrace({ trace: { events: new Array(5001).fill({ t: 1, k: "click" }) } })).toThrow(/at most/);
  });
});
