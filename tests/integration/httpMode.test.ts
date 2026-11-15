import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { createApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/runtime/config.js";

/**
 * PLZBOT_MODE=http: the app behind a TLS-terminating proxy. No front proxy, no TLS socket —
 * the TLS category must be reported as unavailable (not omitted), proxy headers must be shown
 * but only *trusted* when configured, and everything else must keep working.
 */
function startServer(env: NodeJS.ProcessEnv): Promise<{ server: http.Server; port: number }> {
  const server = http.createServer(createApp(loadConfig({ PLZBOT_MODE: "http", ...env })));
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    }),
  );
}

function getJson(port: number, pathname: string, headers: Record<string, string> = {}): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    http
      .get({ host: "127.0.0.1", port, path: pathname, headers }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
      })
      .on("error", reject);
  });
}

const obs = (fp: any, id: string) =>
  [...Object.values(fp.server)].flatMap((g: any) => g).find((o: any) => o.id === id);

describe("HTTP mode (behind a TLS-terminating proxy)", () => {
  describe("without a trusted proxy", () => {
    let server: http.Server;
    let port: number;
    beforeAll(async () => ({ server, port } = await startServer({})));
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it("serves /healthz with the mode", async () => {
      const { status, body } = await getJson(port, "/healthz");
      expect(status).toBe(200);
      expect(body.mode).toBe("http");
    });

    it("reports every TLS signal as unavailable with an upstream-termination reason", async () => {
      const { body: fp } = await getJson(port, "/api/v1/fingerprint");
      expect(fp.request.scheme).toBe("http");
      expect(fp.server.tls.length).toBeGreaterThanOrEqual(10);
      for (const o of fp.server.tls) {
        expect(o.status).toBe("unavailable");
        expect(o.collectionMethod).toBe("tls_terminated_upstream");
      }
      expect(fp.derived.find((d: any) => d.id === "derived.ja4").status).toBe("unavailable");
    });

    it("shows X-Forwarded-For but does NOT use it for client_ip", async () => {
      const { body: fp } = await getJson(port, "/api/v1/fingerprint", { "x-forwarded-for": "203.0.113.9", "x-forwarded-proto": "https" });
      expect(obs(fp, "network.x_forwarded_for").normalized.trust).toBe("untrusted_client_suppliable");
      expect(obs(fp, "network.client_ip").raw).toBe("127.0.0.1");
      expect(obs(fp, "network.client_ip").collectionMethod).toBe("tcp_peer");
      expect(fp.request.scheme).toBe("http");
    });
  });

  describe("with one trusted proxy hop", () => {
    let server: http.Server;
    let port: number;
    beforeAll(async () => ({ server, port } = await startServer({ PLZBOT_TRUST_PROXY: "1" })));
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it("takes client_ip from the hop before the trusted proxy and scheme from X-Forwarded-Proto", async () => {
      const { body: fp } = await getJson(port, "/api/v1/fingerprint", {
        "x-forwarded-for": "198.51.100.4, 203.0.113.9, 10.0.0.2",
        "x-forwarded-proto": "https",
      });
      expect(obs(fp, "network.client_ip").raw).toBe("203.0.113.9");
      expect(obs(fp, "network.client_ip").collectionMethod).toBe("x_forwarded_for:trusted_hops=1");
      expect(obs(fp, "network.remote_ip").raw).toBe("127.0.0.1");
      expect(fp.request.scheme).toBe("https");
    });

    it("falls back to the TCP peer when the header is absent", async () => {
      const { body: fp } = await getJson(port, "/api/v1/fingerprint");
      expect(obs(fp, "network.client_ip").raw).toBe("127.0.0.1");
    });
  });

  describe("with a platform client-IP header", () => {
    let server: http.Server;
    let port: number;
    beforeAll(async () => ({ server, port } = await startServer({ PLZBOT_CLIENT_IP_HEADER: "fly-client-ip" })));
    afterAll(() => new Promise<void>((r) => server.close(() => r())));

    it("prefers the configured header", async () => {
      const { body: fp } = await getJson(port, "/api/v1/fingerprint", { "fly-client-ip": "2001:db8::7", "x-forwarded-for": "1.2.3.4" });
      expect(obs(fp, "network.client_ip").raw).toBe("2001:db8::7");
      expect(obs(fp, "network.client_ip").collectionMethod).toBe("trusted_proxy_header:fly-client-ip");
    });
  });
});
