import { startRecorder } from "./recorder.js";

interface Evidence { id: string; title: string; statement: string; direction: "automated" | "human"; weight: number; confidence: string; features: string[] }
interface Result { verdict: string; automatedWeight: number; humanWeight: number; evidence: Evidence[]; features: Record<string, number | boolean | null> }

const VERDICTS: Record<string, { label: string; tone: string; note: string }> = {
  likely_automated: { label: "Likely automated", tone: "automated", note: "The interaction shows patterns typical of scripted or agent-driven input." },
  likely_human: { label: "Likely human", tone: "human", note: "The interaction looks like hands on a keyboard and mouse. A careful bot could imitate this." },
  inconclusive: { label: "Inconclusive", tone: "neutral", note: "Signals point both ways or are too weak to call." },
  not_enough_interaction: { label: "Not enough interaction", tone: "neutral", note: "Fill in the form (type, choose, scroll the notice, tick the box) before submitting." },
};

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;
function el<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, cls?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  return e;
}

const recorder = startRecorder();
const live = $("live");
const tick = setInterval(() => {
  const c = recorder.counts();
  const total = Object.values(c).reduce((s, v) => s + v, 0);
  live.textContent = `Recording: ${total} events — ${c.mousemove ?? 0} mouse moves, ${(c.keydown ?? 0)} key presses, ${c.scroll ?? 0} scrolls, ${c.click ?? 0} clicks`;
}, 250);

function render(r: Result, trace: unknown): void {
  const v = VERDICTS[r.verdict] ?? VERDICTS.inconclusive!;
  const verdict = $("verdict");
  verdict.replaceChildren(el("span", v.label, `verdict-badge ${v.tone}`), el("p", v.note, "lead"));
  $("weights").textContent = `Evidence weight — automated: ${r.automatedWeight}, human: ${r.humanWeight}. Called automated at 3+ (and ahead of human); human at 3+ with at most 1 automated.`;

  const list = $("evidence");
  list.replaceChildren();
  if (!r.evidence.length) list.append(el("p", "No evidence either way was found.", "lead"));
  for (const e of r.evidence) {
    const item = el("div", undefined, "evidence-item");
    const h = el("h3", e.title);
    h.append(" ", el("span", `${e.direction} · weight ${e.weight} · ${e.confidence}`, `badge confidence-${e.confidence}`));
    item.append(h, el("p", e.statement), el("p", `Based on: ${e.features.join(", ")}`, "live"));
    list.append(item);
  }

  const table = el("table", undefined, "feature-table");
  for (const [id, value] of Object.entries(r.features)) {
    const row = el("tr");
    row.append(el("td", id), el("td", value === null ? "— (not enough data)" : String(value)));
    table.append(row);
  }
  $("features").replaceChildren(table);
  $("raw-json").textContent = JSON.stringify(trace, null, 1);
  $("result").hidden = false;
  $("result").scrollIntoView({ behavior: "smooth" });
}

$<HTMLFormElement>("checkin").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const trace = recorder.snapshot();
  const button = $<HTMLButtonElement>("submit");
  button.disabled = true;
  try {
    const res = await fetch("/api/v1/behavior", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trace }) });
    if (!res.ok) throw new Error(`server answered ${res.status}`);
    const result = (await res.json()) as Result;
    (window as unknown as Record<string, unknown>).__plzbotBehavior = result;
    render(result, trace);
  } catch (err) {
    $("verdict").replaceChildren(el("p", `Could not analyze the trace: ${(err as Error).message}`, "lead"));
    $("result").hidden = false;
  } finally {
    button.disabled = false;
  }
});

$("raw-toggle").addEventListener("click", () => {
  const pre = $("raw-json");
  const show = pre.style.display === "none";
  pre.style.display = show ? "block" : "none";
  $("raw-toggle").textContent = show ? "Hide raw JSON" : "Show raw JSON";
});

$("again").addEventListener("click", () => {
  recorder.stop();
  clearInterval(tick);
  location.reload();
});
