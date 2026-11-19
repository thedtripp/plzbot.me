import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http2 from "node:http2";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type Page } from "playwright";
import { createApp } from "../../src/server/app.js";
import { FrontProxy } from "../../src/server/tls-capture/frontProxy.js";

/**
 * Drives the real /behavior page in Chromium the way automation drives forms, and checks that the recorder +
 * server analysis flag it. Needs public/behavior.js (built by `npm test`'s pretest step).
 */
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cert = fs.readFileSync(path.join(repoRoot, "certs", "dev-cert.pem"));
const key = fs.readFileSync(path.join(repoRoot, "certs", "dev-key.pem"));
const PHRASE = "the quick brown fox jumps over the lazy dog";

let internalServer: http2.Http2SecureServer;
let frontProxy: FrontProxy;
let publicPort: number;
let browser: Browser;

beforeAll(async () => {
  if (!fs.existsSync(path.join(repoRoot, "public", "behavior.js"))) throw new Error("public/behavior.js is missing -- run `npm run build:client` first.");
  const app = createApp();
  internalServer = http2.createSecureServer({ cert, key, allowHTTP1: true, ALPNProtocols: ["h2", "http/1.1"] });
  internalServer.on("request", app);
  await new Promise<void>((resolve) => internalServer.listen(0, "127.0.0.1", resolve));
  const addr = internalServer.address();
  if (!addr || typeof addr === "string") throw new Error("bad internal address");
  publicPort = await new Promise<number>((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const a = srv.address();
      srv.close(() => resolve(typeof a === "object" && a ? a.port : 0));
    });
  });
  frontProxy = new FrontProxy({ publicPort, publicHost: "127.0.0.1", internalHost: "127.0.0.1", internalPort: addr.port, internalTlsServer: internalServer });
  await frontProxy.listen();
  browser = await chromium.launch();
}, 60000);

afterAll(async () => {
  await browser?.close();
  await frontProxy.close();
  await new Promise<void>((resolve) => internalServer.close(() => resolve()));
});

async function open(): Promise<{ page: Page; close: () => Promise<void> }> {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await context.newPage();
  await page.goto(`https://127.0.0.1:${publicPort}/behavior`, { waitUntil: "load" });
  return { page, close: () => context.close() };
}

const submit = async (page: Page) => {
  await page.click("#submit");
  await page.waitForFunction(() => (window as any).__plzbotBehavior, null, { timeout: 10000 });
  return page.evaluate(() => (window as any).__plzbotBehavior);
};
const ids = (r: any): string[] => r.evidence.map((e: any) => e.id);

describe("behavior page in a real automated browser", () => {
  it("serves the page at /behavior", async () => {
    const { page, close } = await open();
    expect(await page.title()).toContain("behavior");
    await close();
  }, 20000);

  it("submitting without interacting is 'not enough interaction'", async () => {
    const { page, close } = await open();
    const r = await submit(page);
    expect(r.verdict).toBe("not_enough_interaction");
    await close();
  }, 20000);

  it("flags page.fill / selectOption / check / scrollTo as automated", async () => {
    const { page, close } = await open();
    await page.fill("#phrase", PHRASE);
    await page.selectOption("#topic", "agent");
    await page.evaluate(() => { const t = document.getElementById("terms")!; t.scrollTop = t.scrollHeight; });
    await page.check("#agree");
    const r = await submit(page);
    expect(r.verdict).toBe("likely_automated");
    expect(ids(r)).toEqual(expect.arrayContaining(["behavior.programmatic_input", "behavior.scroll_without_input"]));
    await close();
  }, 20000);

  it("flags zero-delay keyboard.type and teleporting clicks", async () => {
    const { page, close } = await open();
    await page.click("#phrase");
    await page.keyboard.type(PHRASE, { delay: 0 });
    await page.click("#agree");
    const r = await submit(page);
    expect(ids(r)).toEqual(expect.arrayContaining(["behavior.teleporting_cursor", "behavior.superhuman_typing"]));
    expect(r.verdict).toBe("likely_automated");
    await close();
  }, 20000);

  it("flags script-dispatched events as untrusted", async () => {
    const { page, close } = await open();
    await page.evaluate(() => {
      const input = document.getElementById("phrase")!;
      for (const ch of "hello") input.dispatchEvent(new KeyboardEvent("keydown", { key: ch, bubbles: true }));
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    const r = await submit(page);
    expect(ids(r)).toContain("behavior.untrusted_events");
    await close();
  }, 20000);

  it("never sends what was typed, nor which keys", async () => {
    const { page, close } = await open();
    let body = "";
    page.on("request", (req) => { if (req.url().endsWith("/api/v1/behavior")) body = req.postData() ?? ""; });
    await page.click("#phrase");
    await page.keyboard.type("secret-value-xyz", { delay: 20 });
    await submit(page);
    expect(body.length).toBeGreaterThan(100);
    expect(body).not.toContain("secret");
    expect(body).not.toContain("xyz");
    expect(body).not.toMatch(/"key"|"code"|"value"/);
    await close();
  }, 20000);

  it("rejects a malformed trace with 400", async () => {
    const { page, close } = await open();
    const status = await page.evaluate(() => fetch("/api/v1/behavior", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ trace: { events: [{ t: "x" }] } }) }).then((r) => r.status));
    expect(status).toBe(400);
    await close();
  }, 20000);
});
