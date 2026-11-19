import { startRecorder } from "./recorder.js";

interface Evidence { id: string; title: string; statement: string; direction: "automated" | "human"; weight: number; confidence: string; features: string[] }
interface RecaptchaResult { status: string; score?: number; reasons?: string[]; invalidReason?: string; httpStatus?: number; google?: unknown }
interface Result { recaptcha?: RecaptchaResult; verdict: string; automatedWeight: number; humanWeight: number; evidence: Evidence[]; features: Record<string, number | boolean | null> }

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

// Optional Google reCAPTCHA score. Loads Google's script only if the server has it configured.
interface GrecaptchaEnterprise { ready(cb: () => void): void; execute(key: string, opts: { action: string }): Promise<string> }
let recaptchaSetup: { siteKey: string; action: string } | null = null;
const recaptchaLoaded: Promise<void> = fetch("/api/v1/recaptcha")
  .then((r) => (r.ok ? r.json() : { enabled: false }))
  .then((c: { enabled: boolean; siteKey?: string; action?: string }) => {
    if (!c.enabled || !c.siteKey || !c.action) return;
    recaptchaSetup = { siteKey: c.siteKey, action: c.action };
    $("recaptcha-terms").hidden = false;
    return new Promise<void>((resolve) => {
      const s = document.createElement("script");
      s.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(c.siteKey!)}`;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => resolve(); // blocked (ad blocker, offline): carry on without a score
      document.head.append(s);
    });
  })
  .catch(() => {});

/** A fresh token at submit time (they expire after two minutes), or null if Google's script is off, blocked or slow. */
async function recaptchaToken(): Promise<string | null> {
  await recaptchaLoaded;
  const g = (window as unknown as { grecaptcha?: { enterprise?: GrecaptchaEnterprise } }).grecaptcha?.enterprise;
  if (!recaptchaSetup || !g) return null;
  const setup = recaptchaSetup;
  const run = new Promise<string | null>((resolve) => {
    try { g.ready(() => g.execute(setup.siteKey, { action: setup.action }).then(resolve, () => resolve(null))); } catch { resolve(null); }
  });
  return Promise.race([run, new Promise<null>((r) => setTimeout(() => r(null), 5000))]);
}

const RECAPTCHA_NOTES: Record<string, string> = {
  no_token: "No token was produced (the script was blocked or did not run), so Google was not asked.",
  invalid: "Google rejected the token (expired, reused or from a different site).",
  action_mismatch: "The token was minted for a different action than this page's, so it was ignored.",
  capped: "This site's monthly allowance of Google assessments is used up, so Google was not asked.",
  rate_limited: "Too many requests from your address, so Google was not asked.",
  error: "Google could not be reached or answered unexpectedly.",
};

function renderRecaptcha(r: RecaptchaResult | undefined): void {
  const block = $("recaptcha-block");
  if (!r) { block.hidden = true; return; }
  block.hidden = false;
  const box = $("recaptcha");
  $("recaptcha-raw").textContent = r.google === undefined ? "Google was not asked, or did not answer." : JSON.stringify(r.google, null, 1);
  if (r.status !== "ok" || typeof r.score !== "number") {
    const detail = [r.invalidReason && `reason: ${r.invalidReason}`, r.httpStatus && `HTTP ${r.httpStatus}`].filter(Boolean).join(", ");
    box.replaceChildren(el("p", (RECAPTCHA_NOTES[r.status] ?? "No score.") + (detail ? ` (${detail})` : ""), "lead"));
    return;
  }
  const leaning = r.score >= 0.7 ? "human" : r.score <= 0.3 ? "automated" : "neutral";
  box.replaceChildren(
    el("span", `Score ${r.score.toFixed(1)} of 1.0`, `verdict-badge ${leaning}`),
    el("p", "Google's score runs from 0.0 (very likely automated) to 1.0 (very likely a person). Without a Google Cloud billing account it only returns 0.1, 0.3, 0.7 or 0.9.", "lead"),
    el("p", r.reasons?.length ? `Reasons Google gave: ${r.reasons.join(", ")}` : "Google gave no reason codes.", "live"),
  );
}
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
  renderRecaptcha(r.recaptcha);
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
    const token = await recaptchaToken();
    const res = await fetch("/api/v1/behavior", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trace, recaptchaToken: token }) });
    if (!res.ok) throw new Error(`server answered ${res.status}`);
    const result = (await res.json()) as Result;
    (window as unknown as Record<string, unknown>).__plzbotBehavior = result;
    recorder.stop(); // the verdict covers what was recorded up to Submit; don't keep counting while the result is read
    clearInterval(tick);
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
