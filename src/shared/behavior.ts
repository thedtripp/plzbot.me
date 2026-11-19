/**
 * Wire format of a behavior trace, shared by the browser recorder and the server.
 * Deliberately lossy about content: it records *when* and *where* things happened and which class of key was
 * pressed, never which key (`event.key`/`code`) and never what was typed or selected.
 */
export const BEHAVIOR_EVENT_TYPES = [
  "mousemove",
  "mousedown",
  "mouseup",
  "click",
  "keydown",
  "keyup",
  "input",
  "change",
  "paste",
  "wheel",
  "scroll",
  "touchstart",
  "focusin",
] as const;
export type BehaviorEventType = (typeof BEHAVIOR_EVENT_TYPES)[number];

export const KEY_CLASSES = ["char", "backspace", "enter", "tab", "modifier", "other"] as const;
export type KeyClass = (typeof KEY_CLASSES)[number];

export interface BehaviorEvent {
  /** Milliseconds since the recorder started (high-resolution, 0.1 ms). */
  t: number;
  k: BehaviorEventType;
  /** 1 if the browser says the event came from real input (`isTrusted`), 0 if a script dispatched it. */
  tr: 0 | 1;
  /** Form-field id (or the tag name) the event happened on. */
  f?: string;
  x?: number;
  y?: number;
  /** Mouse button. */
  b?: number;
  /** Key class (keydown/keyup only). */
  kc?: KeyClass;
  /** Key hold time in ms, computed in the browser (keyup only); -1 when no matching keydown was seen. */
  h?: number;
  /** `InputEvent.inputType` (input events only), e.g. "insertText", "insertFromPaste". */
  it?: string;
  /** Scroll position (scroll events only). */
  d?: number;
}

export interface BehaviorTrace {
  events: BehaviorEvent[];
  /** Events not recorded because the cap was reached. */
  dropped: number;
  /** keydowns that never got a keyup by the time the trace was sent. */
  danglingKeydowns: number;
  viewport: { w: number; h: number };
}

export const MAX_TRACE_EVENTS = 5000;
export const MAX_FIELD_ID_LENGTH = 40;
