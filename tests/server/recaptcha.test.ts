import { describe, it, expect } from "vitest";
import { RecaptchaAssessor, RECAPTCHA_ACTION } from "../../src/server/recaptcha/assess.js";
import { parseRecaptcha, loadConfig } from "../../src/server/runtime/config.js";

const cfg = { projectId: "proj-1", siteKey: "site-key-1", apiKey: "SECRET-API-KEY", monthlyCap: 0 };
const good = { tokenProperties: { valid: true, action: RECAPTCHA_ACTION }, riskAnalysis: { score: 0.9, reasons: ["AUTOMATION"] } };
const reply = (body: unknown, status = 200) => async () => new Response(JSON.stringify(body), { status });
const input = (over: Partial<{ token: unknown; clientIp: string | null }> = {}) => ({ token: "tok", clientIp: "203.0.113.7", userAgent: "UA/1", ...over });

describe("RecaptchaAssessor", () => {
  it("scores a valid token and sends Google what it needs, with the key only in the URL", async () => {
    const calls: { url: string; body: any }[] = [];
    const a = new RecaptchaAssessor(cfg, (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify(good));
    }) as unknown as typeof fetch);
    const r = await a.assess(input());
    expect(r).toEqual({ status: "ok", score: 0.9, reasons: ["AUTOMATION"] });
    expect(calls[0]!.url).toBe("https://recaptchaenterprise.googleapis.com/v1/projects/proj-1/assessments?key=SECRET-API-KEY");
    expect(calls[0]!.body).toEqual({ event: { token: "tok", siteKey: "site-key-1", expectedAction: RECAPTCHA_ACTION, userAgent: "UA/1", userIpAddress: "203.0.113.7" } });
    expect(JSON.stringify(r)).not.toContain("SECRET-API-KEY");
  });

  it("does not call Google without a usable token", async () => {
    let calls = 0;
    const a = new RecaptchaAssessor(cfg, (async () => (calls++, new Response("{}"))) as unknown as typeof fetch);
    for (const token of [undefined, "", 42, "x".repeat(5000)]) expect(await a.assess(input({ token }))).toEqual({ status: "no_token" });
    expect(calls).toBe(0);
  });

  it("reports rejected tokens and action mismatches instead of a score", async () => {
    const bad = new RecaptchaAssessor(cfg, reply({ tokenProperties: { valid: false, invalidReason: "EXPIRED" } }) as unknown as typeof fetch);
    expect(await bad.assess(input())).toEqual({ status: "invalid", invalidReason: "EXPIRED" });
    const other = new RecaptchaAssessor(cfg, reply({ tokenProperties: { valid: true, action: "login" }, riskAnalysis: { score: 0.9 } }) as unknown as typeof fetch);
    expect(await other.assess(input())).toEqual({ status: "action_mismatch" });
  });

  it("turns Google errors, odd answers and thrown errors into 'error' without leaking the key", async () => {
    expect(await new RecaptchaAssessor(cfg, reply({}, 500) as unknown as typeof fetch).assess(input())).toEqual({ status: "error" });
    expect(await new RecaptchaAssessor(cfg, reply({ tokenProperties: { valid: true, action: RECAPTCHA_ACTION } }) as unknown as typeof fetch).assess(input())).toEqual({ status: "error" });
    const boom = new RecaptchaAssessor(cfg, (async (url: string) => { throw new Error(`fetch failed for ${url}`); }) as unknown as typeof fetch);
    const r = await boom.assess(input());
    expect(r).toEqual({ status: "error" });
    expect(JSON.stringify(r)).not.toContain("SECRET");
  });

  it("stops calling Google at the monthly cap and starts again next month", async () => {
    let calls = 0;
    let now = Date.parse("2026-11-20T12:00:00Z");
    const a = new RecaptchaAssessor({ ...cfg, monthlyCap: 2 }, (async () => (calls++, new Response(JSON.stringify(good)))) as unknown as typeof fetch, () => now);
    // distinct visitors so the per-visitor limit does not interfere
    expect((await a.assess(input({ clientIp: "203.0.113.1" }))).status).toBe("ok");
    expect((await a.assess(input({ clientIp: "203.0.113.2" }))).status).toBe("ok");
    expect((await a.assess(input({ clientIp: "203.0.113.3" }))).status).toBe("capped");
    expect(calls).toBe(2);
    expect(a.usage()).toEqual({ month: "2026-11", used: 2, cap: 2 });
    now = Date.parse("2026-12-01T00:00:01Z");
    expect((await a.assess(input({ clientIp: "203.0.113.4" }))).status).toBe("ok");
    expect(a.usage()).toMatchObject({ month: "2026-12", used: 1 });
  });

  it("limits how often one visitor can trigger a Google call", async () => {
    let calls = 0;
    const a = new RecaptchaAssessor(cfg, (async () => (calls++, new Response(JSON.stringify(good)))) as unknown as typeof fetch);
    const statuses: string[] = [];
    for (let i = 0; i < 7; i++) statuses.push((await a.assess(input())).status);
    expect(statuses).toEqual(["ok", "ok", "ok", "ok", "ok", "rate_limited", "rate_limited"]);
    expect(calls).toBe(5);
    expect((await a.assess(input({ clientIp: "198.51.100.9" }))).status).toBe("ok"); // another visitor is unaffected
  });
});

describe("reCAPTCHA config", () => {
  it("is off when nothing is set, on when all three are, and an error when only some are", () => {
    expect(parseRecaptcha({})).toBeNull();
    expect(loadConfig({}).recaptcha).toBeNull();
    expect(parseRecaptcha({ PLZBOT_RECAPTCHA_PROJECT_ID: "p", PLZBOT_RECAPTCHA_SITE_KEY: "s", PLZBOT_RECAPTCHA_API_KEY: "k" })).toEqual({ projectId: "p", siteKey: "s", apiKey: "k", monthlyCap: 8000 });
    expect(parseRecaptcha({ PLZBOT_RECAPTCHA_PROJECT_ID: "p", PLZBOT_RECAPTCHA_SITE_KEY: "s", PLZBOT_RECAPTCHA_API_KEY: "k", PLZBOT_RECAPTCHA_MONTHLY_CAP: "0" })?.monthlyCap).toBe(0);
    expect(() => parseRecaptcha({ PLZBOT_RECAPTCHA_SITE_KEY: "s" })).toThrow(/all of/);
  });
});
