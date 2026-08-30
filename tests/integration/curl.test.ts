import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import http2 from "node:http2";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/server/app.js";
import { FrontProxy } from "../../src/server/tls-capture/frontProxy.js";

const execFileAsync = promisify(execFile);

/**
 * Shells out to the *actual* `curl` binary (spec §13 explicitly names curl as a client class to
 * test against) rather than only simulating curl-like behavior with Node's https module — see
 * tests/integration/server.test.ts for that broader HTTP-client-shaped coverage. Skipped
 * automatically if curl isn't on PATH, so this suite doesn't fail in an environment without it.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const cert = fs.readFileSync(path.join(repoRoot, "certs", "dev-cert.pem"));
const key = fs.readFileSync(path.join(repoRoot, "certs", "dev-key.pem"));

let curlAvailable = true;
try {
  await execFileAsync("curl", ["--version"]);
} catch {
  curlAvailable = false;
}

let internalServer: http2.Http2SecureServer;
let frontProxy: FrontProxy;
let publicPort: number;

beforeAll(async () => {
  if (!curlAvailable) return;
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
});

afterAll(async () => {
  if (!curlAvailable) return;
  await frontProxy.close();
  await new Promise<void>((resolve) => internalServer.close(() => resolve()));
});

describe.skipIf(!curlAvailable)("real curl binary", () => {
  it("gets a server-only fingerprint over HTTP/1.1", async () => {
    const { stdout } = await execFileAsync("curl", [
      "-sk",
      "--http1.1",
      `https://127.0.0.1:${publicPort}/api/v1/fingerprint`,
    ]);
    const fp = JSON.parse(stdout);
    expect(fp.client).toBeNull();
    expect(fp.request.httpVersion).toBe("1.1");
    const ua = fp.server.http.find((o: any) => o.id === "http.headers.user_agent");
    expect(ua.raw).toMatch(/^curl\//);
    const tokens = fp.derived.find((d: any) => d.id === "derived.ua_automation_tokens");
    expect(tokens.value).toContain("curl");
  });

  it("negotiates HTTP/2 with --http2 and produces a real JA3", async () => {
    const { stdout } = await execFileAsync("curl", [
      "-sk",
      "--http2",
      `https://127.0.0.1:${publicPort}/api/v1/fingerprint`,
    ]);
    const fp = JSON.parse(stdout);
    expect(fp.request.httpVersion).toBe("2.0");
    const ja3 = fp.derived.find((d: any) => d.id === "derived.ja3_hash");
    expect(ja3.status).toBe("computed");
    expect(ja3.value).toMatch(/^[0-9a-f]{32}$/);
  });
});
