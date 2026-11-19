import {
  MAX_FIELD_ID_LENGTH,
  MAX_TRACE_EVENTS,
  type BehaviorEvent,
  type BehaviorEventType,
  type BehaviorTrace,
  type KeyClass,
} from "../../shared/behavior.js";

export interface Recorder {
  snapshot(): BehaviorTrace;
  /** Live per-type event counts, for the page's counter panel. */
  counts(): Record<string, number>;
  stop(): void;
}

const MOUSEMOVE_MIN_GAP_MS = 8;

function keyClass(key: string): KeyClass {
  if (key.length === 1) return "char";
  if (key === "Backspace" || key === "Delete") return "backspace";
  if (key === "Enter") return "enter";
  if (key === "Tab") return "tab";
  if (key === "Shift" || key === "Control" || key === "Alt" || key === "Meta") return "modifier";
  return "other";
}

/** `redirectLabel`: a press on a <label>'s text activates its control, so attribute pointer events to the control. */
function fieldOf(target: EventTarget | null, redirectLabel = false): string | undefined {
  if (!(target instanceof Element)) return target === document ? "page" : undefined;
  const control = redirectLabel ? (target.closest("label") as HTMLLabelElement | null)?.control : null;
  const el = control ?? target;
  const id = el.id;
  const name = id && /^[A-Za-z0-9_-]+$/.test(id) ? id : el.tagName.toLowerCase();
  return name.slice(0, MAX_FIELD_ID_LENGTH);
}

/**
 * Records interaction timing and geometry for the whole document. Passive capture-phase listeners, so it never
 * interferes with the page. Key identities and field values are read only to classify them locally and are
 * never stored (see src/shared/behavior.ts).
 */
export function startRecorder(doc: Document = document): Recorder {
  const events: BehaviorEvent[] = [];
  const counts: Record<string, number> = {};
  const down = new Map<string, number>(); // key code -> keydown time; the code itself is never sent
  let dropped = 0;
  let lastMove = -Infinity;

  const POINTER = new Set<BehaviorEventType>(["mousedown", "mouseup", "click", "touchstart"]);
  const push = (e: Event, k: BehaviorEventType, extra: Partial<BehaviorEvent> = {}) => {
    counts[k] = (counts[k] ?? 0) + 1;
    if (events.length >= MAX_TRACE_EVENTS) {
      dropped++;
      return;
    }
    const f = fieldOf(e.target, POINTER.has(k));
    events.push({ t: Math.round(e.timeStamp * 10) / 10, k, tr: e.isTrusted ? 1 : 0, ...(f ? { f } : {}), ...extra });
  };

  const handlers: [string, (e: Event) => void][] = [
    [
      "mousemove",
      (e) => {
        const m = e as MouseEvent;
        if (m.timeStamp - lastMove < MOUSEMOVE_MIN_GAP_MS) return;
        lastMove = m.timeStamp;
        push(e, "mousemove", { x: Math.round(m.clientX), y: Math.round(m.clientY) });
      },
    ],
    ["mousedown", (e) => push(e, "mousedown", { x: Math.round((e as MouseEvent).clientX), y: Math.round((e as MouseEvent).clientY), b: (e as MouseEvent).button })],
    ["mouseup", (e) => push(e, "mouseup", { b: (e as MouseEvent).button })],
    ["click", (e) => push(e, "click", { x: Math.round((e as MouseEvent).clientX), y: Math.round((e as MouseEvent).clientY) })],
    [
      "keydown",
      (e) => {
        const ke = e as KeyboardEvent;
        if (ke.repeat) return;
        down.set(ke.code, ke.timeStamp);
        push(e, "keydown", { kc: keyClass(ke.key) });
      },
    ],
    [
      "keyup",
      (e) => {
        const ke = e as KeyboardEvent;
        const start = down.get(ke.code);
        down.delete(ke.code);
        push(e, "keyup", { kc: keyClass(ke.key), h: start === undefined ? -1 : Math.round((ke.timeStamp - start) * 10) / 10 });
      },
    ],
    ["input", (e) => push(e, "input", { it: (e as InputEvent).inputType })],
    ["change", (e) => push(e, "change")],
    ["paste", (e) => push(e, "paste")],
    ["wheel", (e) => push(e, "wheel")],
    ["scroll", (e) => push(e, "scroll", { d: Math.round(e.target instanceof Element ? e.target.scrollTop : window.scrollY) })],
    ["touchstart", (e) => push(e, "touchstart")],
    ["focusin", (e) => push(e, "focusin")],
  ];

  const opts = { capture: true, passive: true } as const;
  for (const [type, fn] of handlers) doc.addEventListener(type, fn, opts);

  return {
    snapshot: () => ({
      events: events.slice(),
      dropped,
      danglingKeydowns: down.size,
      viewport: { w: window.innerWidth, h: window.innerHeight },
    }),
    counts: () => ({ ...counts }),
    stop: () => {
      for (const [type, fn] of handlers) doc.removeEventListener(type, fn, opts);
    },
  };
}
