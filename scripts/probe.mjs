#!/usr/bin/env node
// Fires a batch of different HTTP clients at a running plzbot.me server and prints a
// side-by-side comparison of the resulting fingerprints -- for exploring how server-side
// signals (TLS/JA3/JA4, headers) and the interpretation layer differ across client types.
//
// Requires the server to already be running (`npm run dev`). Does not start one itself, since
// the point is to probe whatever instance you're already poking at.
//
// Usage: node scripts/probe.mjs [--save] [--url https://127.0.0.1:8443]
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import https from "node:https";

const execFileAsync = promisify(execFile);

const args = process.argv.slice(2);
const save = args.includes("--save");
const urlArgIdx = args.indexOf("--url");
const baseUrl = urlArgIdx !== -1 ? args[urlArgIdx + 1] : process.env.PLZBOT_URL || "https://127.0.0.1:8443";

const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const FIREFOX_UA = "Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0";

async function curlProbe(name, extraArgs, headers = []) {
  const headerArgs = headers.flatMap((h) => ["-H", h]);
  const { stdout } = await execFileAsync("curl", [
    "-sk",
    ...extraArgs,
    ...headerArgs,
    `${baseUrl}/api/v1/fingerprint`,
  ]);
  return { name, fingerprint: JSON.parse(stdout) };
}

async function pythonRequestsProbe(name, headers = {}) {
  const script = `
import json, requests, urllib3, sys
urllib3.disable_warnings()
r = requests.get(${JSON.stringify(baseUrl)} + "/api/v1/fingerprint", headers=${JSON.stringify(headers)}, verify=False)
print(r.text)
`;
  const { stdout } = await execFileAsync("python3", ["-c", script]);
  return { name, fingerprint: JSON.parse(stdout) };
}

async function playwrightProbe(name) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/`, { waitUntil: "load" });
    const fingerprint = await page
      .waitForFunction(() => window.__plzbotFingerprint, null, { timeout: 15000 })
      .then(() => page.evaluate(() => window.__plzbotFingerprint));
    await context.close();
    return { name, fingerprint };
  } finally {
    await browser.close();
  }
}

const PROBES = [
  { name: "curl (default)", run: () => curlProbe("curl (default)", []) },
  { name: "curl --http1.1", run: () => curlProbe("curl --http1.1", ["--http1.1"]) },
  { name: "curl --http2", run: () => curlProbe("curl --http2", ["--http2"]) },
  {
    name: "curl (spoofed Chrome UA)",
    run: () => curlProbe("curl (spoofed Chrome UA)", ["--http1.1"], [`User-Agent: ${CHROME_UA}`]),
  },
  {
    name: "curl (spoofed Firefox UA)",
    run: () => curlProbe("curl (spoofed Firefox UA)", ["--http1.1"], [`User-Agent: ${FIREFOX_UA}`]),
  },
  { name: "python requests (default)", run: () => pythonRequestsProbe("python requests (default)") },
  {
    name: "python requests (spoofed Chrome UA)",
    run: () => pythonRequestsProbe("python requests (spoofed Chrome UA)", { "User-Agent": CHROME_UA }),
  },
  { name: "Playwright Chromium (headless)", run: () => playwrightProbe("Playwright Chromium (headless)") },
];

function summarize({ name, fingerprint: fp }) {
  const derived = (id) => fp.derived?.find((d) => d.id === id)?.value ?? null;
  const assessments = fp.interpretation?.assessments ?? [];
  const topAssessment = assessments[0];
  return {
    name,
    httpVersion: fp.request?.httpVersion ?? "?",
    clientType: fp.client ? "browser" : "server-only",
    ja3Hash: derived("derived.ja3_hash"),
    ja4: derived("derived.ja4"),
    browserFamilyGuess: derived("derived.ua_browser_family_guess"),
    topAssessment: topAssessment ? `${topAssessment.id} (${topAssessment.confidence})` : "-",
    assessmentCount: assessments.length,
  };
}

async function checkServerUp() {
  return new Promise((resolve) => {
    const req = https.get(`${baseUrl}/api/v1`, { rejectUnauthorized: false, timeout: 3000 }, (res) => {
      res.resume();
      resolve(true);
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  const up = await checkServerUp();
  if (!up) {
    console.error(`No server responding at ${baseUrl}. Start it first with \`npm run dev\`.`);
    process.exit(1);
  }

  console.log(`Probing ${baseUrl} with ${PROBES.length} client types...\n`);

  const results = [];
  const outDir = save
    ? path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "probe-output", new Date().toISOString().replace(/[:.]/g, "-"))
    : null;
  if (outDir) mkdirSync(outDir, { recursive: true });

  for (const probe of PROBES) {
    process.stdout.write(`  ${probe.name} ... `);
    try {
      const result = await probe.run();
      results.push({ ok: true, ...summarize(result) });
      console.log("ok");
      if (outDir) {
        writeFileSync(
          path.join(outDir, `${probe.name.replace(/[^a-z0-9]+/gi, "_")}.json`),
          JSON.stringify(result.fingerprint, null, 2),
        );
      }
    } catch (err) {
      results.push({ ok: false, name: probe.name, error: err.message.split("\n")[0] });
      console.log(`failed (${err.message.split("\n")[0]})`);
    }
  }

  console.log();
  console.table(
    results.map((r) =>
      r.ok
        ? {
            client: r.name,
            http: r.httpVersion,
            type: r.clientType,
            ja3_hash: r.ja3Hash ? r.ja3Hash.slice(0, 12) + "…" : "-",
            ja4: r.ja4 ?? "-",
            ua_family_guess: r.browserFamilyGuess ?? "-",
            top_assessment: r.topAssessment,
            assessments: r.assessmentCount,
          }
        : { client: r.name, http: "ERROR", type: r.error },
    ),
  );

  if (outDir) console.log(`\nFull fingerprint JSON for each probe saved to ${outDir}/`);
}

main();
