import { StorageLimiter, limiterKey } from "../storage/rateLimit.js";

/**
 * Optional Google reCAPTCHA Enterprise score, kept deliberately separate from the behavior verdict:
 * it is a second opinion from a third party, shown beside our own evidence and never fed into it.
 *
 * Calls are capped per month and per visitor because each one counts against Google's free allowance. Whatever
 * Google answers is passed through untouched (minus our own API key, which only ever lives in the request URL).
 */
export interface RecaptchaConfig {
  projectId: string;
  siteKey: string;
  /** Secret. Restrict it to the reCAPTCHA Enterprise API in Google Cloud. */
  apiKey: string;
  /** Max Google assessments per calendar month (UTC) before we stop calling. 0 = no cap. */
  monthlyCap: number;
  /** Addresses exempt from the per-visitor limits (the owner's). IPv6 addresses match by their /64. The monthly cap still applies. */
  exemptIps: string[];
}

export const RECAPTCHA_ACTION = "behavior_submit";

export type RecaptchaStatus =
  | "ok" // Google scored the token
  | "no_token" // the page sent none (script blocked, or a client that never ran it)
  | "invalid" // Google rejected the token (expired, reused, wrong key, ...)
  | "action_mismatch" // valid token, but minted for a different action
  | "capped" // our monthly budget is spent; Google was not called
  | "rate_limited" // this visitor asked too often; Google was not called
  | "error"; // Google unreachable or answered with an error

export interface RecaptchaResult {
  status: RecaptchaStatus;
  /** 0.0 (likely automated) to 1.0 (likely human). Without a billing account Google only returns 0.1, 0.3, 0.7 or 0.9. */
  score?: number;
  /** Google reason codes such as AUTOMATION. Only returned for projects with billing enabled. */
  reasons?: string[];
  /** Why Google called the token invalid (e.g. EXPIRED, DUPLICATE). */
  invalidReason?: string;
  /** HTTP status when Google answered with an error. */
  httpStatus?: number;
  /** Google's complete answer, whatever fields it contains, so nothing it tells us is dropped. */
  google?: unknown;
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
  private readonly exempt: Set<string>;
  private readonly visitors = new StorageLimiter([
    { name: "minute", windowMs: 60_000, max: 5 },
    { name: "day", windowMs: 86_400_000, max: 40 },
  ]);

  constructor(
    private readonly config: RecaptchaConfig,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly now: () => number = Date.now,
  ) {
    this.exempt = new Set(config.exemptIps.map(limiterKey));
  }

  /** Public, non-secret settings the page needs to load Google's script. */
  clientConfig(): { siteKey: string; action: string } {
    return { siteKey: this.config.siteKey, action: RECAPTCHA_ACTION };
  }

  private rollMonth(): void {
    const m = new Date(this.now()).toISOString().slice(0, 7);
    if (m !== this.month) {
      this.month = m;
      this.used = 0;
    }
  }

  /** Google's answer as JSON-safe data, with our API key removed in case an error message ever echoes it. */
  private scrub(raw: string): unknown {
    const clean = raw.split(this.config.apiKey).join("[redacted]");
    try {
      return JSON.parse(clean);
    } catch {
      return clean.slice(0, 2000);
    }
  }

  async assess(input: AssessInput): Promise<RecaptchaResult> {
    const token = typeof input.token === "string" ? input.token : "";
    if (!token || token.length > MAX_TOKEN_LENGTH) return { status: "no_token" };

    const key = limiterKey(input.clientIp);
    if (!this.exempt.has(key) && this.visitors.check(key, this.now())) return { status: "rate_limited" };
    this.rollMonth();
    if (this.config.monthlyCap > 0 && this.used >= this.config.monthlyCap) return { status: "capped" };
    this.used++; // count before the call: a timeout may still have been billed

    const url =
      `https://recaptchaenterprise.googleapis.com/v1/projects/${encodeURIComponent(this.config.projectId)}/assessments` +
      `?key=${encodeURIComponent(this.config.apiKey)}`;
    const event: Record<string, string> = { token, siteKey: this.config.siteKey, expectedAction: RECAPTCHA_ACTION };
    if (input.userAgent) event.userAgent = input.userAgent.slice(0, 512);
    if (input.clientIp) event.userIpAddress = input.clientIp;

    let res: Response;
    let text: string;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ event }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      text = await res.text();
    } catch {
      return { status: "error" }; // never include the error: its message can contain the request URL, and so the key
    }

    const google = this.scrub(text);
    if (!res.ok) return { status: "error", httpStatus: res.status, google };

    // Read only what we need to classify; everything else rides along untouched in `google`.
    const r = google as {
      tokenProperties?: { valid?: unknown; invalidReason?: unknown; action?: unknown };
      riskAnalysis?: { score?: unknown; reasons?: unknown };
    } | null;
    const tp = r?.tokenProperties;
    if (!tp || tp.valid !== true) {
      return { status: "invalid", invalidReason: typeof tp?.invalidReason === "string" ? tp.invalidReason : undefined, google };
    }
    if (tp.action !== RECAPTCHA_ACTION) return { status: "action_mismatch", google };
    const score = r?.riskAnalysis?.score;
    if (typeof score !== "number" || !Number.isFinite(score)) return { status: "error", google };
    const reasons = Array.isArray(r?.riskAnalysis?.reasons) ? (r!.riskAnalysis!.reasons as unknown[]).filter((x): x is string => typeof x === "string") : [];
    return { status: "ok", score, reasons, google };
  }
}
