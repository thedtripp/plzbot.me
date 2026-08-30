import { describe, it, expect, beforeAll, afterAll } from "vitest";
import https from "node:https";
import http2 from "node:http2";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createApp } from "../../src/server/app.js";
import { FrontProxy } from "../../src/server/tls-capture/frontProxy.js";

/**
 * These tests exercise the real, running server end-to-end -- the same front proxy, the same
 * TLS-terminating internal server, the same app -- rather than mocking Node's request/response
 * objects, because the whole point of the front-proxy design (docs/TLS_CAPTURE.md) is a
 * real-socket-level technique that unit tests calling handler functions directly can't validate.
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..");
const cert = fs.readFileSync(path.join(repoRoot, "certs", "dev-cert.pem"));
const key = fs.readFileSync(path.join(repoRoot, "certs", "dev-key.pem"));

let internalServer: http2.Http2SecureServer;
let frontProxy: FrontProxy;
let publicPort: number;

beforeAll(async () => {
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
  await frontProxy.close();
  await new Promise<void>((resolve) => internalServer.close(() => resolve()));
});

function httpsGetJson(pathname: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const req = https.request(
      { host: "127.0.0.1", port: publicPort, path: pathname, method: "GET", headers, rejectUnauthorized: false },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

function httpsPostJson(pathname: string, payload: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(payload);
    const req = https.request(
      {
        host: "127.0.0.1",
        port: publicPort,
        path: pathname,
        method: "POST",
        headers: { "content-type": "application/json", "content-length": Buffer.byteLength(data) },
        rejectUnauthorized: false,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          resolve({ status: res.statusCode ?? 0, body: text ? JSON.parse(text) : null });
        });
      },
    );
    req.on("error", reject);
    req.end(data);
  });
}

function http2GetJson(pathname: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const client = http2.connect(`https://127.0.0.1:${publicPort}`, { rejectUnauthorized: false });
    client.on("error", reject);
    const req = client.request({ ":path": pathname, ...headers });
    let status = 0;
    req.on("response", (h) => {
      status = Number(h[":status"]);
    });
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      client.close();
      const text = Buffer.concat(chunks).toString("utf8");
      resolve({ status, body: text ? JSON.parse(text) : null });
    });
    req.on("error", reject);
    req.end();
  });
}

describe("GET /api/v1/fingerprint over HTTP/1.1 (curl-like client)", () => {
  it("returns a server-only fingerprint with client: null", async () => {
    const { status, body } = await httpsGetJson("/api/v1/fingerprint", { "user-agent": "curl/8.4.0" });
    expect(status).toBe(200);
    expect(body.schemaVersion).toBe("1.0.0");
    expect(body.client).toBeNull();
    expect(body.request.httpVersion).toBe("1.1");

    const ua = body.server.http.find((o: any) => o.id === "http.headers.user_agent");
    expect(ua.status).toBe("observed");
    expect(ua.raw).toBe("curl/8.4.0");

    const uaTokens = body.derived.find((d: any) => d.id === "derived.ua_automation_tokens");
    expect(uaTokens.value).toContain("curl");

    const nonBrowserAssessment = body.interpretation.assessments.find((a: any) => a.id === "automation.non_browser_ua");
    expect(nonBrowserAssessment).toBeDefined();
  });

  it("captures a real JA3/JA4 from the actual TLS handshake", async () => {
    const { body } = await httpsGetJson("/api/v1/fingerprint");
    const ja3 = body.derived.find((d: any) => d.id === "derived.ja3_hash");
    const ja4 = body.derived.find((d: any) => d.id === "derived.ja4");
    expect(ja3.status).toBe("computed");
    expect(ja3.value).toMatch(/^[0-9a-f]{32}$/);
    expect(ja4.status).toBe("computed");
    expect(ja4.value).toMatch(/^t\d{2}[di]\d{2}\d{2}\w{2}_[0-9a-f]{12}_[0-9a-f]{12}$/);
  });

  it("reports network.remote_ip as the real peer even though it went through the internal loopback hop", async () => {
    const { body } = await httpsGetJson("/api/v1/fingerprint");
    const ip = body.server.network.find((o: any) => o.id === "network.remote_ip");
    expect(ip.status).toBe("observed");
    expect(["127.0.0.1", "::1", "::ffff:127.0.0.1"]).toContain(ip.raw);
  });

  it("marks http.header_order as observed for HTTP/1.1", async () => {
    const { body } = await httpsGetJson("/api/v1/fingerprint");
    const order = body.server.http.find((o: any) => o.id === "http.header_order");
    expect(order.status).toBe("observed");
    expect(Array.isArray(order.raw)).toBe(true);
    expect(order.raw.length).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/fingerprint over HTTP/2", () => {
  it("negotiates h2 and reports http2 settings", async () => {
    const { status, body } = await http2GetJson("/api/v1/fingerprint");
    expect(status).toBe(200);
    expect(body.request.httpVersion).toBe("2.0");
    const settings = body.server.http2.find((o: any) => o.id === "http2.settings");
    expect(settings.status).toBe("observed");
    const alpn = body.server.tls.find((o: any) => o.id === "tls.alpn_negotiated");
    expect(alpn.raw).toBe("h2");
  });

  it("marks http.header_order as unavailable for HTTP/2 (documented compat-API limitation)", async () => {
    const { body } = await http2GetJson("/api/v1/fingerprint");
    const order = body.server.http.find((o: any) => o.id === "http.header_order");
    expect(order.status).toBe("unavailable");
  });

  it("does not crash the server across repeated HTTP/2 requests", async () => {
    for (let i = 0; i < 5; i++) {
      const { status } = await http2GetJson("/api/v1/fingerprint");
      expect(status).toBe(200);
    }
    // If the server had crashed, this HTTP/1.1 request would fail to connect at all.
    const { status } = await httpsGetJson("/api/v1/fingerprint");
    expect(status).toBe(200);
  });
});

describe("POST /api/v1/fingerprint/client", () => {
  it("merges submitted client observations into the combined fingerprint", async () => {
    const payload = {
      automation: [
        {
          id: "browser.automation.navigator_webdriver",
          category: "browser.automation",
          source: "client",
          collectionMethod: "navigator_property",
          status: "observed",
          raw: true,
          normalized: true,
          observedAt: new Date().toISOString(),
        },
      ],
    };
    const { status, body } = await httpsPostJson("/api/v1/fingerprint/client", payload);
    expect(status).toBe(200);
    expect(body.client.status).toBe("submitted");
    expect(body.client.automation[0].raw).toBe(true);

    const webdriverAssessment = body.interpretation.assessments.find((a: any) => a.id === "automation.navigator_webdriver");
    expect(webdriverAssessment).toBeDefined();
    expect(webdriverAssessment.confidence).toBe("high");
  });

  it("rejects a non-object body with 400", async () => {
    const { status, body } = await httpsPostJson("/api/v1/fingerprint/client", "not an object");
    expect(status).toBe(400);
    expect(body.error).toBeDefined();
  });

  it("treats an empty payload the same as no client submission", async () => {
    const { status, body } = await httpsPostJson("/api/v1/fingerprint/client", {});
    expect(status).toBe(200);
    expect(body.client).toBeNull();
  });
});

describe("plaintext HTTP against the TLS-only port", () => {
  it("responds with a friendly 400 instead of hanging", async () => {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.connect(publicPort, "127.0.0.1", () => {
        socket.write("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
      });
      let data = "";
      socket.on("data", (c) => (data += c.toString()));
      socket.on("end", () => resolve(data));
      socket.on("error", reject);
      setTimeout(() => reject(new Error("timed out")), 3000);
    });
    expect(response).toContain("400");
    expect(response).toContain("TLS");
  });
});

describe("GET /api/v1/signals", () => {
  it("returns the signal catalog", async () => {
    const { status, body } = await httpsGetJson("/api/v1/signals");
    expect(status).toBe(200);
    expect(body.signals["http.headers.user_agent"]).toBeDefined();
  });
});
