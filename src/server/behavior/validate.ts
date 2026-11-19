import {
  BEHAVIOR_EVENT_TYPES,
  KEY_CLASSES,
  MAX_FIELD_ID_LENGTH,
  MAX_TRACE_EVENTS,
  type BehaviorEvent,
  type BehaviorTrace,
} from "../../shared/behavior.js";

const TYPES = new Set<string>(BEHAVIOR_EVENT_TYPES);
const KEYCLASSES = new Set<string>(KEY_CLASSES);
const MAX_T = 60 * 60 * 1000; // an hour is more than any real session of this page
const num = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? v : undefined;

/** Rebuilds a trace from untrusted JSON, keeping only known fields with sane values. Throws on a malformed trace. */
export function parseTrace(body: unknown): BehaviorTrace {
  const root = (body as { trace?: unknown } | null)?.trace as Record<string, unknown> | undefined;
  if (!root || typeof root !== "object" || !Array.isArray(root.events)) throw new Error("body.trace.events must be an array");
  if (root.events.length > MAX_TRACE_EVENTS) throw new Error(`at most ${MAX_TRACE_EVENTS} events`);

  const events: BehaviorEvent[] = [];
  for (const raw of root.events as Record<string, unknown>[]) {
    if (!raw || typeof raw !== "object") throw new Error("each event must be an object");
    const t = num(raw.t, 0, MAX_T);
    if (t === undefined || typeof raw.k !== "string" || !TYPES.has(raw.k)) throw new Error("event needs a numeric t and a known k");
    const e: BehaviorEvent = { t, k: raw.k as BehaviorEvent["k"], tr: raw.tr === 1 ? 1 : 0 };
    if (typeof raw.f === "string" && /^[A-Za-z0-9_-]+$/.test(raw.f)) e.f = raw.f.slice(0, MAX_FIELD_ID_LENGTH);
    const x = num(raw.x, -100000, 100000);
    const y = num(raw.y, -100000, 100000);
    if (x !== undefined) e.x = x;
    if (y !== undefined) e.y = y;
    const b = num(raw.b, 0, 10);
    if (b !== undefined) e.b = b;
    if (raw.rp === 1) e.rp = 1;
    if (typeof raw.kc === "string" && KEYCLASSES.has(raw.kc)) e.kc = raw.kc as BehaviorEvent["kc"];
    const h = num(raw.h, -1, MAX_T);
    if (h !== undefined) e.h = h;
    if (typeof raw.it === "string" && /^[A-Za-z]{1,40}$/.test(raw.it)) e.it = raw.it;
    const d = num(raw.d, -1e7, 1e7);
    if (d !== undefined) e.d = d;
    events.push(e);
  }
  events.sort((a, b) => a.t - b.t);

  const vp = (root.viewport ?? {}) as Record<string, unknown>;
  return {
    events,
    dropped: num(root.dropped, 0, 1e9) ?? 0,
    danglingKeydowns: num(root.danglingKeydowns, 0, 1000) ?? 0,
    viewport: { w: num(vp.w, 0, 100000) ?? 0, h: num(vp.h, 0, 100000) ?? 0 },
  };
}
