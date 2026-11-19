import type { BehaviorEvent, BehaviorTrace } from "../../shared/behavior.js";

export type FeatureValue = number | boolean | null;
/** Flat map keyed by signal id (see SIGNAL_CATALOG); null = not enough data to compute. */
export type BehaviorFeatures = Record<string, FeatureValue>;

const sum = (a: number[]) => a.reduce((s, v) => s + v, 0);
const mean = (a: number[]) => (a.length ? sum(a) / a.length : null);
function stdev(a: number[]): number | null {
  const m = mean(a);
  return m === null || a.length < 2 ? null : Math.sqrt(sum(a.map((v) => (v - m) ** 2)) / a.length);
}
function median(a: number[]): number | null {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}
const round = (v: number | null, places = 1): number | null => (v === null ? null : Math.round(v * 10 ** places) / 10 ** places);

// Heuristic windows (first guesses; tune once stored traces exist).
const IDLE_SPLIT_MS = 250; // a pause this long ends one pointer movement
const TELEPORT_WINDOW_MS = 400;
const TYPED_INPUT_WINDOW_MS = 1000;
const POINTER_INPUT_WINDOW_MS = 10_000;
const SCROLL_INPUT_WINDOW_MS = 300;
const SCROLL_BURST_GAP_MS = 150;
const INSTANT_JUMP_PX = 200;
const INSTANT_JUMP_MS = 20;

/** Splits mouse positions into movements (a mousedown or a pause ends one). */
function movements(events: BehaviorEvent[]): { t: number; x: number; y: number }[][] {
  const out: { t: number; x: number; y: number }[][] = [];
  let cur: { t: number; x: number; y: number }[] = [];
  let last = -Infinity;
  const flush = () => {
    if (cur.length) out.push(cur);
    cur = [];
  };
  for (const e of events) {
    if (e.k === "mousedown") flush();
    if (e.k !== "mousemove" || e.x === undefined || e.y === undefined) continue;
    if (e.t - last > IDLE_SPLIT_MS) flush();
    cur.push({ t: e.t, x: e.x, y: e.y });
    last = e.t;
  }
  flush();
  return out;
}

function mouseFeatures(events: BehaviorEvent[], f: BehaviorFeatures): void {
  const moves = events.filter((e) => e.k === "mousemove");
  const downs = events.filter((e) => e.k === "mousedown");
  const touches = events.filter((e) => e.k === "touchstart");
  // A tap on a touch screen produces a mousedown with no mousemove; that is not a teleporting cursor.
  const pointerDowns = downs.filter((d) => !touches.some((t) => d.t - t.t >= 0 && d.t - t.t < 500));
  // Moves that led to this press: those in the window before it, but not ones that belong to the previous press.
  const teleports = pointerDowns.filter((d) => {
    const prev = downs.filter((o) => o.t < d.t).at(-1)?.t ?? -Infinity;
    return moves.filter((m) => m.t >= Math.max(d.t - TELEPORT_WINDOW_MS, prev) && m.t < d.t).length <= 1;
  }).length;

  const angles: number[] = [];
  const speeds: number[] = [];
  const straights: number[] = [];
  for (const seg of movements(events)) {
    let path = 0;
    for (let i = 1; i < seg.length; i++) {
      const dx = seg[i]!.x - seg[i - 1]!.x;
      const dy = seg[i]!.y - seg[i - 1]!.y;
      const dt = seg[i]!.t - seg[i - 1]!.t;
      path += Math.hypot(dx, dy);
      if (dt > 0 && (dx || dy)) speeds.push(Math.hypot(dx, dy) / dt);
      if (i >= 2) {
        const px = seg[i - 1]!.x - seg[i - 2]!.x;
        const py = seg[i - 1]!.y - seg[i - 2]!.y;
        if ((px || py) && (dx || dy)) angles.push((Math.atan2(px * dy - py * dx, px * dx + py * dy) * 180) / Math.PI);
      }
    }
    const chord = seg.length > 1 ? Math.hypot(seg.at(-1)!.x - seg[0]!.x, seg.at(-1)!.y - seg[0]!.y) : 0;
    if (seg.length >= 5 && path > 50) straights.push(chord / path);
  }
  const speedMean = mean(speeds);
  f["behavior.mouse.moves"] = moves.length;
  f["behavior.mouse.clicks"] = pointerDowns.length;
  f["behavior.mouse.teleport_clicks"] = teleports;
  f["behavior.mouse.curvature_angle_range_deg"] = angles.length >= 5 ? round(Math.max(...angles) - Math.min(...angles)) : null;
  f["behavior.mouse.straightness"] = round(mean(straights), 3);
  f["behavior.mouse.velocity_cv"] = speeds.length >= 10 && speedMean ? round(stdev(speeds)! / speedMean, 3) : null;
}

function keyFeatures(events: BehaviorEvent[], f: BehaviorFeatures, trace: BehaviorTrace): void {
  const keydowns = events.filter((e) => e.k === "keydown");
  const chars = keydowns.filter((e) => e.kc === "char");
  const holds = events.filter((e) => e.k === "keyup" && e.h !== undefined && e.h >= 0).map((e) => e.h!);
  const gaps: number[] = [];
  for (let i = 1; i < chars.length; i++) {
    const dt = chars[i]!.t - chars[i - 1]!.t;
    if (dt < 2000 && chars[i]!.f === chars[i - 1]!.f) gaps.push(dt);
  }
  const pastes = Math.max(
    events.filter((e) => e.k === "paste").length,
    events.filter((e) => e.k === "input" && (e.it === "insertFromPaste" || e.it === "insertFromDrop")).length,
  );
  // Fields changed without the input that normally causes it: typed text with no keydown in that field just
  // before, or a select/checkbox change with no mousedown/keydown/touch in that field. (Paste is counted separately.)
  let programmatic = 0;
  events.forEach((e, i) => {
    if ((e.k !== "input" && e.k !== "change") || e.it === "insertFromPaste" || e.it === "insertFromDrop") return;
    const typed = e.it !== undefined && /^(insert|delete)/.test(e.it);
    const since = typed ? TYPED_INPUT_WINDOW_MS : POINTER_INPUT_WINDOW_MS;
    const causes = typed ? ["keydown"] : ["keydown", "mousedown", "touchstart"];
    // A `change` that follows its own `input` is the same user action; only check the first of the pair.
    const prev = events[i - 1];
    if (e.k === "change" && prev?.k === "input" && prev.f === e.f && e.t - prev.t < 50) return;
    const hasCause = events.slice(0, i).some((c) => causes.includes(c.k) && (c.f === e.f || (typed && c.f === undefined)) && e.t - c.t <= since);
    if (!hasCause) programmatic++;
  });

  f["behavior.keys.chars"] = chars.length;
  f["behavior.keys.paste_count"] = pastes;
  f["behavior.keys.hold_median_ms"] = chars.length >= 3 ? round(median(holds)) : null;
  f["behavior.keys.interkey_median_ms"] = gaps.length >= 3 ? round(median(gaps)) : null;
  f["behavior.keys.interkey_stdev_ms"] = gaps.length >= 3 ? round(stdev(gaps)) : null;
  f["behavior.keys.corrections"] = keydowns.filter((e) => e.kc === "backspace").length;
  f["behavior.keys.programmatic_inputs"] = programmatic;
  f["behavior.keys.dangling_keydowns"] = trace.danglingKeydowns;
  f["behavior.keys.dangling_keyups"] = events.filter((e) => e.k === "keyup" && e.h === -1).length;
}

function scrollFeatures(events: BehaviorEvent[], f: BehaviorFeatures): void {
  const scrolls = events.filter((e) => e.k === "scroll" && e.d !== undefined);
  const touchy = events.some((e) => e.k === "touchstart"); // touch scrolling coasts on after the finger lifts

  // Moments the visitor was providing scroll-capable input: wheel ticks, touches, keys, button presses, and
  // pointer movement while a button is held (dragging a scrollbar).
  const inputTimes: number[] = [];
  const held: [number, number][] = [];
  let pressedAt: number | null = null;
  for (const e of events) {
    if (e.k === "mousedown") pressedAt = e.t;
    if (e.k === "mouseup" && pressedAt !== null) (held.push([pressedAt, e.t]), (pressedAt = null));
    if (["wheel", "touchstart", "keydown", "mousedown"].includes(e.k) || (e.k === "mousemove" && pressedAt !== null)) inputTimes.push(e.t);
  }
  if (pressedAt !== null) held.push([pressedAt, Infinity]);

  const bursts: BehaviorEvent[][] = [];
  for (const e of scrolls) {
    const cur = bursts.at(-1);
    if (cur && cur.at(-1)!.f === e.f && e.t - cur.at(-1)!.t <= SCROLL_BURST_GAP_MS) cur.push(e);
    else bursts.push([e]);
  }
  // A whole burst counts as input-driven if input came just before it started or at any point while it ran: browsers
  // keep animating a wheel scroll (and inertia keeps it going) well after the last wheel event.
  const driven = (b: BehaviorEvent[]) => {
    const start = b[0]!.t;
    const end = b.at(-1)!.t;
    return (
      touchy ||
      inputTimes.some((t) => t >= start - SCROLL_INPUT_WINDOW_MS && t <= end) ||
      held.some(([from, to]) => from <= end && to >= start)
    );
  };
  const dist = (b: BehaviorEvent[]) => Math.abs(b.at(-1)!.d! - b[0]!.d!);
  const dur = (b: BehaviorEvent[]) => b.at(-1)!.t - b[0]!.t;
  f["behavior.scroll.events"] = scrolls.length;
  f["behavior.scroll.without_input"] = bursts.filter((b) => !driven(b)).reduce((s, b) => s + b.length, 0);
  f["behavior.scroll.instant_jumps"] = bursts.filter((b) => dist(b) >= INSTANT_JUMP_PX && dur(b) <= INSTANT_JUMP_MS).length;
  f["behavior.scroll.gradual_bursts"] = bursts.filter((b) => b.length >= 5 && dur(b) >= 100).length;
  f["behavior.scroll.distance_stdev"] = bursts.length >= 2 ? round(stdev(bursts.map(dist))) : null;
}

export function computeFeatures(trace: BehaviorTrace): BehaviorFeatures {
  const events = trace.events;
  const f: BehaviorFeatures = {};
  const isInteraction = (e: BehaviorEvent) => ["click", "keydown", "input", "change", "paste", "scroll"].includes(e.k);
  const inputish = events.filter((e) => ["mousedown", "mouseup", "click", "keydown", "keyup", "input", "change", "paste"].includes(e.k));

  f["behavior.events.total"] = events.length;
  f["behavior.events.interactions"] = events.filter(isInteraction).length;
  f["behavior.events.untrusted"] = inputish.filter((e) => e.tr === 0).length;
  f["behavior.events.duration_ms"] = events.length ? round(events.at(-1)!.t - events[0]!.t) : 0;

  mouseFeatures(events, f);
  keyFeatures(events, f, trace);
  scrollFeatures(events, f);

  // Pace of deliberate actions: clicks, pastes and changes (the first key of each field counts as one action).
  const seenFields = new Set<string>();
  const actionTimes = events
    .filter((e) => {
      if (e.k === "click" || e.k === "paste" || e.k === "change") return true;
      if (e.k === "keydown" && e.f && !seenFields.has(e.f)) return seenFields.add(e.f), true;
      return false;
    })
    .map((e) => e.t);
  const gaps = actionTimes.slice(1).map((t, i) => t - actionTimes[i]!);
  f["behavior.timing.actions"] = actionTimes.length;
  f["behavior.timing.action_gap_median_ms"] = gaps.length >= 3 ? round(median(gaps)) : null;
  return f;
}
