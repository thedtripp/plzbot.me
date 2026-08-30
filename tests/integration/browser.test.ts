import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http2 from "node:http2";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server/app.js";
import { FrontProxy } from "../../src/server/tls-capture/frontProxy.js";

/**
 * Drives a *real* browser engine (Chromium via Playwright) against the actual running app --
 * front proxy, TLS termination, static file serving, and the built browser collector bundle --
 * to validate the automatic collection flow end-to-end (spec §6) and the automation-detection
 * signals (navigator.webdriver etc.) against a genuinely automated browser, per spec §13's
 * explicit call to test against Playwright/headless Chromium. Requires `npm run build:client`
 * to have produced public/collector.js (done automatically by `npm test`, see package.json).
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const cert = fs.readFileSync(path.join(repoRoot, "certs", "dev-cert.pem"));
const key = fs.readFileSync(path.join(repoRoot, "certs", "dev-key.pem"));

let internalServer: http2.Http2SecureServer;
let frontProxy: FrontProxy;
let publicPort: number;
let browser: Browser;

beforeAll(async () => {
  if (!fs.existsSync(path.join(repoRoot, "public", "collector.js"))) {
    throw new Error("public/collector.js is missing -- run `npm run build:client` first.");
  }

  const app = createApp();
  internalServer = http2.createSecureServer({ cert, key, allowHTTP1: true, ALPNProtocols: ["h2", "http/1.1"] });
  internalServer.on("request", app);
  await new Promise<void>((resolve) => internalServer.listen(0, "127.0.0.1", resolve));
  const internalAddr = internalServer.address();
  if (!internalAddr || typeof internalAddr === "string") throw new Error("bad internal address");

  publicPort = await new Promise<number>((resolve) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() => resolve(typeof addr === "object" && addr ? addr.port : 0));
    });
  });

  frontProxy = new FrontProxy({
    publicPort,
    publicHost: "127.0.0.1",
    internalHost: "127.0.0.1",
    internalPort: internalAddr.port,
    internalTlsServer: internalServer,
  });
  await frontProxy.listen();

  browser = await chromium.launch();
}, 60000);

afterAll(async () => {
  await browser?.close();
  await frontProxy.close();
  await new Promise<void>((resolve) => internalServer.close(() => resolve()));
});

describe("automatic collection in a real (automated) browser", () => {
  it("collects and combines a full fingerprint with no user interaction", async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`https://127.0.0.1:${publicPort}/`, { waitUntil: "load" });

    const fp = await page.waitForFunction(() => (window as any).__plzbotFingerprint, null, { timeout: 15000 }).then(() =>
      page.evaluate(() => (window as any).__plzbotFingerprint),
    );

    expect(fp.schemaVersion).toBe("1.0.0");
    expect(fp.client.status).toBe("submitted");
    for (const group of ["navigator", "screen", "hardware", "graphics", "audio", "fonts", "media", "storage", "apis", "automation"]) {
      expect(fp.client[group].length).toBeGreaterThan(0);
    }

    await context.close();
  }, 20000);

  it("reports navigator.webdriver = true and triggers a high-confidence automation assessment", async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`https://127.0.0.1:${publicPort}/`, { waitUntil: "load" });
    const fp = await page.waitForFunction(() => (window as any).__plzbotFingerprint, null, { timeout: 15000 }).then(() =>
      page.evaluate(() => (window as any).__plzbotFingerprint),
    );

    const webdriverObs = fp.client.automation.find((o: any) => o.id === "browser.automation.navigator_webdriver");
    expect(webdriverObs.status).toBe("observed");
    expect(webdriverObs.raw).toBe(true);

    const assessment = fp.interpretation.assessments.find((a: any) => a.id === "automation.navigator_webdriver");
    expect(assessment).toBeDefined();
    expect(assessment.confidence).toBe("high");
    expect(assessment.evidence.observationIds).toContain("browser.automation.navigator_webdriver");

    await context.close();
  }, 20000);

  it("produces a real, non-empty canvas and WebGL fingerprint", async () => {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`https://127.0.0.1:${publicPort}/`, { waitUntil: "load" });
    const fp = await page.waitForFunction(() => (window as any).__plzbotFingerprint, null, { timeout: 15000 }).then(() =>
      page.evaluate(() => (window as any).__plzbotFingerprint),
    );

    const canvas = fp.client.graphics.find((o: any) => o.id === "browser.graphics.canvas_hash");
    expect(canvas.status).toBe("observed");
    expect(typeof canvas.raw).toBe("string");
    expect(canvas.raw.length).toBeGreaterThan(0);

    const webgl = fp.client.graphics.find((o: any) => o.id === "browser.graphics.webgl_renderer");
    expect(webgl.status).toBe("observed");
    expect(typeof webgl.raw).toBe("string");

    await context.close();
  }, 20000);
});
