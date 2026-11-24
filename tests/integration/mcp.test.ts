import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import http2 from "node:http2";
import net from "node:net";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createApp } from "../../src/server/app.js";
import { loadConfig } from "../../src/server/runtime/config.js";
import { FrontProxy } from "../../src/server/tls-capture/frontProxy.js";

/**
 * The MCP endpoint (POST /mcp), driven two ways: by the official MCP client over plain HTTP, and by raw
 * 2025-style JSON-RPC over TLS + HTTP/2 through the front proxy (how production serves it), where the
 * fingerprint must include the caller's JA4.
 */

describe("MCP server over plain HTTP, official client", () => {
  let server: http.Server;
  let base: string;
  let client: Client;

  beforeAll(async () => {
    server = http.createServer(createApp(loadConfig({ PLZBOT_MODE: "http" })));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
    client = new Client({ name: "plzbot-test", version: "1.0.0" });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  });
  afterAll(async () => {
    await client?.close();
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("lists read-only tools and the docs resources", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["explain_signal", "fingerprint_me"]);
    for (const t of tools) expect(t.annotations?.readOnlyHint).toBe(true);
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toEqual(expect.arrayContaining(["plzbot://about", "plzbot://signals"]));
  });

  it("fingerprint_me describes the calling client", async () => {
    const r = await client.callTool({ name: "fingerprint_me", arguments: {} });
    const s = r.structuredContent as { fingerprintId: string; observations: { id: string }[]; assessments: { title: string }[] };
    expect(s.fingerprintId).toMatch(/^[0-9a-f-]{36}$/);
    expect(s.observations.map((o) => o.id)).toContain("http.headers.user_agent");
    expect(s.assessments.length).toBeGreaterThan(0);
    expect((r.content as { type: string; text: string }[])[0]!.text).toContain("plzbot fingerprint");
  });

  it("explain_signal finds by id or keywords and rejects bad input", async () => {
    const exact = await client.callTool({ name: "explain_signal", arguments: { query: "http.headers.user_agent" } });
    expect(exact.structuredContent).toMatchObject({ exact: true, matches: [{ id: "http.headers.user_agent" }] });
    const words = await client.callTool({ name: "explain_signal", arguments: { query: "user agent" } });
    expect((words.structuredContent as { matches: unknown[] }).matches.length).toBeGreaterThan(0);
    const bad = await client.callTool({ name: "explain_signal", arguments: { query: "" } });
    expect(bad.isError).toBe(true);
  });

  it("reads a signal through the resource template", async () => {
    const r = await client.readResource({ uri: "plzbot://signals/http.headers.user_agent" });
    expect(JSON.parse((r.contents[0] as { text: string }).text)).toMatchObject({ id: "http.headers.user_agent", title: "User-Agent header" });
  });

  it("refuses foreign browser origins and GET", async () => {
    const post = (headers: Record<string, string>) =>
      fetch(`${base}/mcp`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers }, body: '{"jsonrpc":"2.0","id":1,"method":"ping"}' });
    expect((await post({ origin: "https://evil.example" })).status).toBe(403);
    expect((await post({ origin: "http://localhost:6274" })).status).toBe(200); // local dev tools, HTTP mode only
    expect((await fetch(`${base}/mcp`)).status).toBe(405);
  });
});

describe("MCP server over TLS + HTTP/2 (production path)", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
  let internal: http2.Http2SecureServer;
  let proxy: FrontProxy;
  let port: number;

  beforeAll(async () => {
    const cert = fs.readFileSync(path.join(repoRoot, "certs", "dev-cert.pem"));
    const key = fs.readFileSync(path.join(repoRoot, "certs", "dev-key.pem"));
    internal = http2.createSecureServer({ cert, key, allowHTTP1: true, ALPNProtocols: ["h2", "http/1.1"] });
    internal.on("request", createApp());
    await new Promise<void>((r) => internal.listen(0, "127.0.0.1", r));
    const addr = internal.address();
    if (!addr || typeof addr === "string") throw new Error("bad address");
    port = await new Promise<number>((resolve) => {
      const s = net.createServer().listen(0, "127.0.0.1", () => {
        const a = s.address();
        s.close(() => resolve(typeof a === "object" && a ? a.port : 0));
      });
    });
    proxy = new FrontProxy({ publicPort: port, publicHost: "127.0.0.1", internalHost: "127.0.0.1", internalPort: addr.port, internalTlsServer: internal });
    await proxy.listen();
  });
  afterAll(async () => {
    await proxy.close();
    await new Promise<void>((r) => internal.close(() => r()));
  });

  function rpc(body: unknown): Promise<{ status: number; text: string }> {
    return new Promise((resolve, reject) => {
      const session = http2.connect(`https://127.0.0.1:${port}`, { rejectUnauthorized: false });
      session.on("error", reject);
      const req = session.request({ ":method": "POST", ":path": "/mcp", "content-type": "application/json", accept: "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18" });
      let status = 0;
      let text = "";
      req.on("response", (h) => (status = Number(h[":status"])));
      req.setEncoding("utf8");
      req.on("data", (c: string) => (text += c));
      req.on("end", () => {
        session.close();
        resolve({ status, text });
      });
      req.on("error", reject);
      req.end(JSON.stringify(body));
    });
  }

  it("answers a 2025-era tools/call with the caller's JA4", async () => {
    const { status, text } = await rpc({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "fingerprint_me", arguments: {} } });
    expect(status).toBe(200);
    const payload = JSON.parse(text.startsWith("{") ? text : text.split("\n").find((l) => l.startsWith("data: "))!.slice(6));
    const derived: { id: string; value: string }[] = payload.result.structuredContent.derived;
    // "t13i...h2": TLS 1.3, no SNI (we connect to an IP), HTTP/2 negotiated.
    expect(derived.find((d) => d.id === "derived.ja4")?.value).toMatch(/^t13[di]\d{4}h2_/);
  });
});
