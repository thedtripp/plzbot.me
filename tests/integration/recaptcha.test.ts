import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http2 from "node:http2";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server/app.js";
import { RecaptchaAssessor } from "../../src/server/recaptcha/assess.js";
import { FrontProxy } from "../../src/server/tls-capture/frontProxy.js";

/** The behavior page with Google reCAPTCHA off and on. Google is never contacted: its script is stubbed in the browser
 * and the server's call to Google goes to a fake fetch. */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cert = fs.readFileSync(path.join(repoRoot, "certs", "dev-cert.pem"));
const key = fs.readFileSync(path.join(repoRoot, "certs", "dev-key.pem"));
const PHRASE = "the quick brown fox jumps over the lazy dog";

interface Site { port: number; close: () => Promise<void> }
async function startSite(app: ReturnType<typeof createApp>): Promise<Site> {
  const internal = http2.createSecureServer({ cert, key, allowHTTP1: true, ALPNProtocols: ["h2", "http/1.1"] });
  internal.on("request", app);
  await new Promise<void>((r) => internal.listen(0, "127.0.0.1", r));
  const addr = internal.address();
  if (!addr || typeof addr === "string") throw new Error("bad internal address");
  const port = await new Promise<number>((resolve) => {
    const s = net.createServer();
    s.listen(0, "127.0.0.1", () => { const a = s.address(); s.close(() => resolve(typeof a === "object" && a ? a.port : 0)); });
  });
  const proxy = new FrontProxy({ publicPort: port, publicHost: "127.0.0.1", internalHost: "127.0.0.1", internalPort: addr.port, internalTlsServer: internal });
  await proxy.listen();
  return { port, close: async () => { await proxy.close(); await new Promise<void>((r) => internal.close(() => r())); } };
}

const sent: any[] = [];
let off: Site, on: Site, browser: Browser;

beforeAll(async () => {
  if (!fs.existsSync(path.join(repoRoot, "public", "behavior.js"))) throw new Error("public/behavior.js is missing -- run `npm run build:client` first.");
  off = await startSite(createApp());
  const fakeGoogle = (async (_url: string, init: RequestInit) => {
    sent.push(JSON.parse(String(init.body)));
    return new Response(JSON.stringify({ tokenProperties: { valid: true, action: "behavior_submit" }, riskAnalysis: { score: 0.3, reasons: ["AUTOMATION"] }, someNewGoogleField: "kept" }));
  }) as unknown as typeof fetch;
  const assessor = new RecaptchaAssessor({ projectId: "p", siteKey: "test-site-key", apiKey: "test-api-key", monthlyCap: 0, exemptIps: [] }, fakeGoogle);
  on = await startSite(createApp(undefined, null, assessor));
  browser = await chromium.launch();
}, 60000);

afterAll(async () => {
  await browser?.close();
  await off?.close();
  await on?.close();
});

const GOOGLE_STUB = `window.grecaptcha = { enterprise: { ready: (cb) => cb(), execute: async (k, o) => "stub-token:" + k + ":" + o.action } };`;

async function fillAndSubmit(page: Page) {
  await page.fill("#phrase", PHRASE);
  await page.selectOption("#topic", "agent");
  await page.evaluate(() => { const t = document.getElementById("terms")!; t.scrollTop = t.scrollHeight; });
  await page.check("#agree");
  await page.click("#submit");
  await page.waitForFunction(() => (window as any).__plzbotBehavior, null, { timeout: 10000 });
  return page.evaluate(() => (window as any).__plzbotBehavior);
}

describe("reCAPTCHA on the behavior page", () => {
  it("is off by default: Google is never contacted and no score is shown", async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const google: string[] = [];
    page.on("request", (r) => { if (/google\.com|gstatic\.com/.test(r.url())) google.push(r.url()); });
    await page.goto(`https://127.0.0.1:${off.port}/behavior`, { waitUntil: "load" });
    expect(await page.evaluate(() => fetch("/api/v1/recaptcha").then((r) => r.json()))).toEqual({ enabled: false });
    const r = await fillAndSubmit(page);
    expect(r.recaptcha).toBeUndefined();
    expect(await page.locator("#recaptcha-block").isHidden()).toBe(true);
    expect(await page.locator("#recaptcha-terms").isHidden()).toBe(true);
    expect(google).toEqual([]);
    await context.close();
  }, 30000);

  it("when on, loads Google's script, sends its token, shows the score and leaves the verdict alone", async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.route("https://www.google.com/recaptcha/enterprise.js*", (route) => route.fulfill({ contentType: "text/javascript", body: GOOGLE_STUB }));
    const page = await context.newPage();
    await page.goto(`https://127.0.0.1:${on.port}/behavior`, { waitUntil: "load" });
    expect(await page.evaluate(() => fetch("/api/v1/recaptcha").then((r) => r.json()))).toEqual({ enabled: true, siteKey: "test-site-key", action: "behavior_submit" });
    sent.length = 0;
    const r = await fillAndSubmit(page);

    expect(sent).toHaveLength(1);
    expect(sent[0].event).toMatchObject({ token: "stub-token:test-site-key:behavior_submit", siteKey: "test-site-key", expectedAction: "behavior_submit" });
    expect(r.recaptcha).toMatchObject({ status: "ok", score: 0.3, reasons: ["AUTOMATION"], google: { someNewGoogleField: "kept" } });
    expect(r.verdict).toBe("likely_automated"); // Playwright's fill/select/check: decided by the behavior rules alone
    expect(JSON.stringify(r)).not.toContain("test-api-key");
    expect(await page.locator("#recaptcha-block").isVisible()).toBe(true);
    expect(await page.locator("#recaptcha").innerText()).toContain("0.3");
    expect(await page.locator("#recaptcha-raw").textContent()).toContain("someNewGoogleField"); // everything Google returned is shown
    expect(await page.locator("#recaptcha-terms").isVisible()).toBe(true);
    await context.close();
  }, 30000);

  it("still gives a verdict when Google's script is blocked, and does not ask Google", async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.route("https://www.google.com/recaptcha/**", (route) => route.abort());
    const page = await context.newPage();
    await page.goto(`https://127.0.0.1:${on.port}/behavior`, { waitUntil: "load" });
    sent.length = 0;
    const r = await fillAndSubmit(page);
    expect(sent).toHaveLength(0);
    expect(r.recaptcha).toEqual({ status: "no_token" });
    expect(r.verdict).toBe("likely_automated");
    expect(await page.locator("#recaptcha").innerText()).toContain("blocked");
    await context.close();
  }, 30000);
});
