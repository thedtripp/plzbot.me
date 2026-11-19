import { describe, it, expect } from "vitest";
import { RecaptchaAssessor, RECAPTCHA_ACTION } from "../../src/server/recaptcha/assess.js";
import { parseRecaptcha, loadConfig } from "../../src/server/runtime/config.js";

const cfg = { projectId: "proj-1", siteKey: "site-key-1", apiKey: "SECRET-API-KEY", monthlyCap: 0, exemptIps: [] };
const good = { tokenProperties: { valid: true, action: RECAPTCHA_ACTION, hostname: "plzbot.test" }, riskAnalysis: { score: 0.9, reasons: ["AUTOMATION"], extendedVerdictReasons: ["X"] }, futureField: { a: 1 } };
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
    expect(r).toEqual({ status: "ok", score: 0.9, reasons: ["AUTOMATION"], google: good });
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
    const badBody = { tokenProperties: { valid: false, invalidReason: "EXPIRED" } };
    expect(await new RecaptchaAssessor(cfg, reply(badBody) as unknown as typeof fetch).assess(input())).toEqual({ status: "invalid", invalidReason: "EXPIRED", google: badBody });
    const otherBody = { tokenProperties: { valid: true, action: "login" }, riskAnalysis: { score: 0.9 } };
    expect(await new RecaptchaAssessor(cfg, reply(otherBody) as unknown as typeof fetch).assess(input())).toEqual({ status: "action_mismatch", google: otherBody });
  });

  it("passes Google's error answer through, scrubbed of our key, and survives odd answers and thrown errors", async () => {
    const denied = { error: { code: 403, status: "PERMISSION_DENIED", message: "key SECRET-API-KEY is not allowed" } };
    const r403 = await new RecaptchaAssessor(cfg, reply(denied, 403) as unknown as typeof fetch).assess(input());
    expect(r403).toMatchObject({ status: "error", httpStatus: 403, google: { error: { code: 403, status: "PERMISSION_DENIED", message: "key [redacted] is not allowed" } } });
    expect(JSON.stringify(r403)).not.toContain("SECRET");
    const html = await new RecaptchaAssessor(cfg, (async () => new Response("<html>bad gateway SECRET-API-KEY</html>", { status: 502 })) as unknown as typeof fetch).assess(input());
    expect(html).toEqual({ status: "error", httpStatus: 502, google: "<html>bad gateway [redacted]</html>" });
    const noScore = await new RecaptchaAssessor(cfg, reply({ tokenProperties: { valid: true, action: RECAPTCHA_ACTION } }) as unknown as typeof fetch).assess(input());
    expect(noScore.status).toBe("error");
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
    now = Date.parse("2026-12-01T00:00:01Z");
    expect((await a.assess(input({ clientIp: "203.0.113.4" }))).status).toBe("ok");
    expect(calls).toBe(3);
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

describe("owner exemption", () => {
  it("lifts the per-visitor limits for listed addresses (IPv6 by /64) but not the monthly cap, and still limits everyone else", async () => {
    let calls = 0;
    const fetchFn = (async () => (calls++, new Response(JSON.stringify(good)))) as unknown as typeof fetch;
    const a = new RecaptchaAssessor({ ...cfg, exemptIps: ["203.0.113.7", "2001:db8:1:2::1"] }, fetchFn);
    for (let i = 0; i < 8; i++) expect((await a.assess(input({ clientIp: "203.0.113.7" }))).status).toBe("ok");
    for (let i = 0; i < 8; i++) expect((await a.assess(input({ clientIp: "2001:db8:1:2:aaaa::9" }))).status).toBe("ok"); // same /64
    const statuses: string[] = [];
    for (let i = 0; i < 6; i++) statuses.push((await a.assess(input({ clientIp: "198.51.100.9" }))).status);
    expect(statuses).toEqual(["ok", "ok", "ok", "ok", "ok", "rate_limited"]);
    const capped = new RecaptchaAssessor({ ...cfg, monthlyCap: 2, exemptIps: ["203.0.113.7"] }, fetchFn);
    const out = [];
    for (let i = 0; i < 3; i++) out.push((await capped.assess(input({ clientIp: "203.0.113.7" }))).status);
    expect(out).toEqual(["ok", "ok", "capped"]);
  });
});

describe("reCAPTCHA config", () => {
  it("is off when nothing is set, on when all three are, and an error when only some are", () => {
    expect(parseRecaptcha({})).toBeNull();
    expect(loadConfig({}).recaptcha).toBeNull();
    expect(parseRecaptcha({ PLZBOT_RECAPTCHA_PROJECT_ID: "p", PLZBOT_RECAPTCHA_SITE_KEY: "s", PLZBOT_RECAPTCHA_API_KEY: "k" })).toEqual({ projectId: "p", siteKey: "s", apiKey: "k", monthlyCap: 8000, exemptIps: [] });
    expect(parseRecaptcha({ PLZBOT_RECAPTCHA_PROJECT_ID: "p", PLZBOT_RECAPTCHA_SITE_KEY: "s", PLZBOT_RECAPTCHA_API_KEY: "k", PLZBOT_RECAPTCHA_EXEMPT_IPS: " 203.0.113.7 , 2001:db8::1 ," })?.exemptIps).toEqual(["203.0.113.7", "2001:db8::1"]);
    expect(parseRecaptcha({ PLZBOT_RECAPTCHA_PROJECT_ID: "p", PLZBOT_RECAPTCHA_SITE_KEY: "s", PLZBOT_RECAPTCHA_API_KEY: "k", PLZBOT_RECAPTCHA_MONTHLY_CAP: "0" })?.monthlyCap).toBe(0);
    expect(() => parseRecaptcha({ PLZBOT_RECAPTCHA_SITE_KEY: "s" })).toThrow(/all of/);
  });
});
