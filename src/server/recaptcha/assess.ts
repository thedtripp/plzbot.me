import { StorageLimiter, limiterKey } from "../storage/rateLimit.js";

/**
 * Optional Google reCAPTCHA Enterprise score, kept deliberately separate from the behavior verdict:
 * it is a second opinion from a third party, shown beside our own evidence and never fed into it.
 *
 * Everything here is defensive about cost and secrets. Each assessment counts against Google's free
 * monthly allowance, so calls are capped per month and per visitor, and the API key is only ever put in
 * the request URL (never logged, never returned to the browser).
 */
export interface RecaptchaConfig {
  projectId: string;
  siteKey: string;
  /** Secret. Restrict it to the reCAPTCHA Enterprise API in Google Cloud. */
  apiKey: string;
  /** Max Google assessments per calendar month (UTC) before we stop calling. 0 = no cap. */
  monthlyCap: number;
}

export const RECAPTCHA_ACTION = "behavior_submit";

export type RecaptchaStatus =
  | "ok" // Google scored the token
  | "no_token" // the page sent none (script blocked, or a client that never ran it)
  | "invalid" // Google rejected the token (expired, reused, wrong key, ...)
  | "action_mismatch" // valid token, but minted for a different action
  | "capped" // our monthly budget is spent; Google was not called
  | "rate_limited" // this visitor asked too often; Google was not called
  | "error"; // Google unreachable or answered unexpectedly

export interface RecaptchaResult {
  status: RecaptchaStatus;
  /** 0.0 (likely automated) to 1.0 (likely human). Without a billing account Google only returns 0.1, 0.3, 0.7 or 0.9. */
  score?: number;
  /** Google reason codes such as AUTOMATION. Only returned for projects with billing enabled. */
  reasons?: string[];
  invalidReason?: string;
}

export interface AssessInput {
  token: unknown;
  clientIp: string | null;
  userAgent: string | undefined;
}

const MAX_TOKEN_LENGTH = 4096;
const TIMEOUT_MS = 4000;

export class RecaptchaAssessor {
  private month = "";
  private used = 0;
  private readonly visitors = new StorageLimiter([
    { name: "minute", windowMs: 60_000, max: 5 },
    { name: "day", windowMs: 86_400_000, max: 40 },
  ]);

  constructor(
    private readonly config: RecaptchaConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {}

  /** Public, non-secret settings the page needs to load Google's script. */
  clientConfig(): { siteKey: string; action: string } {
    return { siteKey: this.config.siteKey, action: RECAPTCHA_ACTION };
  }

  /** How many assessments this process has sent to Google this month (resets on restart). */
  usage(): { month: string; used: number; cap: number } {
    this.rollMonth();
    return { month: this.month, used: this.used, cap: this.config.monthlyCap };
  }

  private rollMonth(): void {
    const m = new Date(this.now()).toISOString().slice(0, 7);
    if (m !== this.month) {
      this.month = m;
      this.used = 0;
    }
  }

  async assess(input: AssessInput): Promise<RecaptchaResult> {
    const token = typeof input.token === "string" ? input.token : "";
    if (!token || token.length > MAX_TOKEN_LENGTH) return { status: "no_token" };

    if (this.visitors.check(limiterKey(input.clientIp), this.now())) return { status: "rate_limited" };
    this.rollMonth();
    if (this.config.monthlyCap > 0 && this.used >= this.config.monthlyCap) return { status: "capped" };
    this.used++; // count before the call: a timeout may still have been billed

    const url =
      `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/assessments` +
      `?key=${encodeURIComponent(this.config.apiKey)}`;
    const event: Record<string, string> = { token, siteKey: this.config.siteKey, expectedAction: RECAPTCHA_ACTION };
    if (input.userAgent) event.userAgent = input.userAgent.slice(0, 512);
    if (input.clientIp) event.userIpAddress = input.clientIp;

    let body: unknown;
    try {
      const res = await this.fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) return { status: "error" };
      body = await res.json();
    } catch {
      return { status: "error" }; // never include the error: its message can contain the request URL, and so the key
    }

    const r = body as {
      tokenProperties?: { valid?: unknown; invalidReason?: unknown; action?: unknown };
      riskAnalysis?: { score?: unknown; reasons?: unknown };
    };
    const tp = r.tokenProperties;
    if (!tp || tp.valid !== true) {
      return { status: "invalid", invalidReason: typeof tp?.invalidReason === "string" ? tp.invalidReason.slice(0, 60) : undefined };
    }
    if (tp.action !== RECAPTCHA_ACTION) return { status: "action_mismatch" };
    const score = r.riskAnalysis?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) return { status: "error" };
    const reasons = Array.isArray(r.riskAnalysis?.reasons)
      ? (r.riskAnalysis!.reasons as unknown[]).filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 60)).slice(0, 10)
      : [];
    return { status: "ok", score, reasons };
  }
}
