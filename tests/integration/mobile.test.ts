import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { chromium, type Browser } from "playwright";
import { createApp } from "../../src/server/app.js";

/**
 * Phone-width layout check: no page may scroll sideways at common phone widths, with every
 * signal category expanded (the widest content). Guards the stacked-card table layout in
 * public/styles.css. Uses plain HTTP; TLS is irrelevant to layout.
 */

let server: http.Server;
let base: string;
let browser: Browser;

beforeAll(async () => {
  server = http.createServer(createApp());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  browser = await chromium.launch();
}, 60000);

afterAll(async () => {
  await browser?.close();
  await new Promise<void>((resolve) => server?.close(() => resolve()));
});

describe.each([320, 390])("phone layout at %ipx wide", (width) => {
  it.each(["/", "/docs.html", "/behavior"])("%s does not scroll sideways", async (route) => {
    const context = await browser.newContext({ viewport: { width, height: 800 }, isMobile: true, deviceScaleFactor: 2 });
    const page = await context.newPage();
    await page.goto(base + route, { waitUntil: "networkidle" });
    if (route === "/") await page.waitForSelector("#results:not([hidden])", { timeout: 15000 });
    await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
    const { client, scroll } = await page.evaluate(() => ({
      client: document.documentElement.clientWidth,
      scroll: document.documentElement.scrollWidth,
    }));
    await context.close();
    expect(client).toBe(width);
    expect(scroll).toBeLessThanOrEqual(client);
  }, 30000);
});
