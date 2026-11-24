import type { IncomingMessage, ServerResponse } from "node:http";
import { McpServer, ResourceTemplate, createMcpHandler } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import { buildFingerprint } from "../fingerprint.js";
import { SIGNAL_CATALOG, type CatalogEntry } from "../interpret/catalog.js";
import { SCHEMA_VERSION } from "../../shared/schema/types.js";
import type { RuntimeConfig } from "../runtime/config.js";
import { getRequestContext } from "../runtime/requestContext.js";
import type { FingerprintStore } from "../storage/postgres.js";
import { limiterKey } from "../storage/rateLimit.js";

/**
 * plzbot.me's public MCP server, at POST /mcp (Streamable HTTP, stateless). See docs/MCP.md.
 *
 * An MCP server offers three kinds of things to an AI application:
 * - tools: functions the model may call (here: fingerprint_me, explain_signal);
 * - resources: read-only documents the application can load into context (here: plzbot://about, plzbot://signals…);
 * - prompts: reusable prompt templates (none yet).
 *
 * Every HTTP request gets a fresh McpServer from the factory below and nothing is kept between requests, so the
 * endpoint needs no sessions and scales like any other stateless API. The SDK's createMcpHandler speaks the
 * 2026-07-28 protocol and also answers 2025-era clients statelessly.
 */

const SERVER_INFO = { name: "plzbot", title: "plzbot.me", version: "1.0.0" };

const INSTRUCTIONS = `plzbot.me is a public, educational client-fingerprinting and bot-detection demo.
Use fingerprint_me to see what a website can learn about the client making this MCP request (TLS, HTTP/2, headers)
and how plzbot interprets it. Use explain_signal to look up what any signal id means. Results describe the HTTP
client that called this server, which is often the AI application's backend rather than the end user's browser.`;

const ABOUT = `# plzbot.me

plzbot.me shows what a website can observe about a visitor without asking: the TLS handshake (JA3/JA4), HTTP/2
settings, headers and Client Hints on the server side, and, in a browser, navigator/screen/graphics/audio/font
signals. It then explains each signal and gives hedged assessments: automation tells, consistency between
signals, and how identifying the combination is.

Everything is educational: assessments say how confident they are, and none of them is proof on its own.

- Website: https://plzbot.me.ddtripp.com
- Tools: fingerprint_me (what plzbot sees about this MCP connection), explain_signal (look up a signal)
- Resources: plzbot://signals (index of every documented signal), plzbot://signals/{id} (one signal)
`;

// --- shapes returned to the model (outputSchema = what structuredContent must look like) ---

const fingerprintOutput = z.object({
  fingerprintId: z.string(),
  generatedAt: z.string(),
  schemaVersion: z.string(),
  derived: z.array(z.object({ id: z.string(), value: z.string() })).describe("Values computed from raw signals, e.g. derived.ja4"),
  observations: z.array(z.object({ id: z.string(), value: z.string() })).describe("Raw signals plzbot observed on this request"),
  assessments: z
    .array(z.object({ id: z.string(), category: z.string(), title: z.string(), statement: z.string(), confidence: z.string() }))
    .describe("plzbot's hedged interpretation of the signals"),
});

const catalogEntry = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  whyItMatters: z.string(),
  caveats: z.string().optional(),
  references: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
});
const explainOutput = z.object({
  exact: z.boolean().describe("true when the query was a known signal id"),
  matches: z.array(catalogEntry),
});

const show = (v: unknown): string => {
  const s = typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 300 ? s.slice(0, 297) + "…" : s;
};
const entry = (id: string, e: CatalogEntry) => ({ id, ...e });

/** Exact id, else entries whose id or title contains every word of the query (up to 10). */
export function searchCatalog(query: string): z.infer<typeof explainOutput> {
  const q = query.trim();
  const exact = SIGNAL_CATALOG[q];
  if (exact) return { exact: true, matches: [entry(q, exact)] };
  const words = q.toLowerCase().split(/[\s._-]+/).filter(Boolean);
  const matches = Object.entries(SIGNAL_CATALOG)
    .filter(([id, e]) => words.every((w) => `${id} ${e.title}`.toLowerCase().includes(w)))
    .slice(0, 10)
    .map(([id, e]) => entry(id, e));
  return { exact: false, matches };
}

interface Deps {
  config: RuntimeConfig;
  store: FingerprintStore | null;
}

/** One McpServer for one HTTP request: `req` is that request, so fingerprint_me can describe the caller. */
function buildServer(req: IncomingMessage, { config, store }: Deps): McpServer {
  const server = new McpServer(SERVER_INFO, { instructions: INSTRUCTIONS });

  server.registerTool(
    "fingerprint_me",
    {
      title: "Fingerprint this connection",
      description:
        "Shows what plzbot.me can observe about the HTTP client making this MCP request: TLS fingerprint (JA3/JA4), " +
        "HTTP version and HTTP/2 settings, headers and Client Hints, plus plzbot's assessments (automation tells, " +
        "consistency, identifiability). The client is whatever sent this request, often the AI app's server.",
      outputSchema: fingerprintOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const fp = await buildFingerprint(req, undefined, config);
      store?.save(fp, "mcp");
      const observed = Object.values(fp.server).flat().filter((o) => o.status === "observed");
      const result: z.infer<typeof fingerprintOutput> = {
        fingerprintId: fp.fingerprintId,
        generatedAt: fp.generatedAt,
        schemaVersion: fp.schemaVersion,
        derived: fp.derived.filter((d) => d.value !== null && d.value !== undefined).map((d) => ({ id: d.id, value: show(d.value) })),
        observations: observed.map((o) => ({ id: o.id, value: show(o.normalized ?? o.raw) })),
        assessments: fp.interpretation.assessments.map((a) => ({ id: a.id, category: a.category, title: a.title, statement: a.statement, confidence: a.confidence })),
      };
      const ja4 = result.derived.find((d) => d.id === "derived.ja4")?.value ?? "unavailable";
      const lines = [
        `plzbot fingerprint ${result.fingerprintId} (JA4 ${ja4}). ${result.observations.length} signals observed.`,
        ...result.assessments.map((a) => `- [${a.category}, ${a.confidence}] ${a.title}: ${a.statement}`),
      ];
      return { content: [{ type: "text", text: lines.join("\n") }], structuredContent: result };
    },
  );

  server.registerTool(
    "explain_signal",
    {
      title: "Explain a signal",
      description:
        "Looks up a fingerprinting signal in plzbot's catalog: what it is, why it matters and its caveats. Pass an " +
        "exact id from fingerprint_me (e.g. http.headers.user_agent) or a few words (e.g. 'tls cipher').",
      inputSchema: z.object({ query: z.string().min(1).max(100).describe("A signal id or a few keywords") }),
      outputSchema: explainOutput,
      annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    },
    async ({ query }) => {
      const result = searchCatalog(query);
      const text = result.matches.length
        ? result.matches.map((m) => `${m.id}: ${m.title}\n${m.description}\nWhy it matters: ${m.whyItMatters}${m.caveats ? `\nCaveats: ${m.caveats}` : ""}`).join("\n\n")
        : `No signal matches "${query}". Read plzbot://signals for the full list.`;
      return { content: [{ type: "text", text }], structuredContent: result };
    },
  );

  server.registerResource("about", "plzbot://about", { title: "About plzbot.me", description: "What plzbot.me is and what this server offers", mimeType: "text/markdown" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "text/markdown", text: ABOUT }],
  }));

  server.registerResource("signals", "plzbot://signals", { title: "Signal catalog index", description: "Every documented signal id with its title", mimeType: "application/json" }, async (uri) => ({
    contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify({ schemaVersion: SCHEMA_VERSION, signals: Object.entries(SIGNAL_CATALOG).map(([id, e]) => ({ id, title: e.title })) }) }],
  }));

  server.registerResource(
    "signal",
    new ResourceTemplate("plzbot://signals/{id}", {
      list: async () => ({ resources: Object.entries(SIGNAL_CATALOG).map(([id, e]) => ({ uri: `plzbot://signals/${id}`, name: id, title: e.title, mimeType: "application/json" })) }),
    }),
    { title: "One signal", description: "A signal's catalog entry", mimeType: "application/json" },
    async (uri, { id }) => {
      const key = String(id);
      const e = SIGNAL_CATALOG[key];
      if (!e) throw new Error(`Unknown signal: ${key}`);
      return { contents: [{ uri: uri.href, mimeType: "application/json", text: JSON.stringify(entry(key, e)) }] };
    },
  );

  return server;
}

// --- HTTP plumbing: Node request -> web Request -> SDK handler -> web Response -> Node response ---

const MAX_BODY = 256 * 1024;
const WINDOW_MS = 60_000;
/** Requests per visitor per minute. A tool call is one or two requests; this is generous for people, not scrapers. */
const MAX_PER_WINDOW = 120;
const windows = new Map<string, { start: number; count: number }>();

function rateLimited(key: string, now = Date.now()): number | null {
  if (windows.size > 50_000) for (const [k, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(k);
  const w = windows.get(key);
  if (!w || now - w.start >= WINDOW_MS) {
    windows.set(key, { start: now, count: 1 });
    return null;
  }
  w.count += 1;
  return w.count > MAX_PER_WINDOW ? Math.ceil((w.start + WINDOW_MS - now) / 1000) : null;
}

/** Browsers send Origin; MCP clients running on servers usually don't. A present Origin must be one we trust. */
function originAllowed(origin: string | undefined, config: RuntimeConfig): boolean {
  if (!origin) return true;
  const allowed = new Set([config.publicOrigin, ...(process.env.PLZBOT_MCP_ALLOWED_ORIGINS ?? "").split(",")].map((o) => o?.trim().replace(/\/+$/, "")).filter(Boolean));
  if (allowed.has(origin)) return true;
  // Local development (plain HTTP mode): allow tools like the MCP Inspector running on localhost.
  return config.mode === "http" && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function readBody(req: IncomingMessage): Promise<Buffer | null> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        resolve(null);
        req.removeAllListeners("data");
        req.resume();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function plain(res: ServerResponse, status: number, message: string, headers: Record<string, string> = {}): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.end(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }));
}

/** Converts the Node request (HTTP/1.1 or HTTP/2 compat) into a web Request the SDK understands. */
async function toWebRequest(req: IncomingMessage, config: RuntimeConfig): Promise<Request | null> {
  const host = (req.headers.host ?? (req.headers[":authority"] as string | undefined) ?? "localhost").replace(/[^A-Za-z0-9.:[\]-]/g, "");
  const scheme = config.mode === "tls" ? "https" : "http";
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (name.startsWith(":") || ["host", "connection", "keep-alive", "transfer-encoding", "upgrade"].includes(name) || value === undefined) continue;
    for (const v of Array.isArray(value) ? value : [value]) headers.append(name, v);
  }
  const method = (req.method ?? "GET").toUpperCase();
  let body: string | undefined;
  if (method === "POST") {
    const b = await readBody(req);
    if (b === null) return null;
    body = b.toString("utf8"); // MCP bodies are JSON text
  }
  return new Request(`${scheme}://${host}${req.url ?? "/mcp"}`, { method, headers, body });
}

async function sendWebResponse(webRes: Response, req: IncomingMessage, res: ServerResponse): Promise<void> {
  res.statusCode = webRes.status;
  webRes.headers.forEach((value, name) => res.setHeader(name, value));
  if (!webRes.body) return void res.end();
  const reader = webRes.body.getReader();
  req.on("close", () => void reader.cancel().catch(() => {})); // client went away: closing the stream cancels the call
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  } finally {
    res.end();
  }
}

export function mcpRoute(deps: Deps) {
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (!originAllowed(req.headers.origin, deps.config)) return plain(res, 403, "Origin not allowed");
    const retryAfter = rateLimited(limiterKey(getRequestContext(req, deps.config).clientIp));
    if (retryAfter !== null) return plain(res, 429, "Too many requests", { "retry-after": String(retryAfter) });
    const webReq = await toWebRequest(req, deps.config);
    if (!webReq) return plain(res, 413, "Request body too large");
    // A handler per request, so the factory can close over this exact Node request (fingerprint_me needs its socket).
    const handler = createMcpHandler(() => buildServer(req, deps), { responseMode: "json" });
    try {
      await sendWebResponse(await handler.fetch(webReq), req, res);
    } finally {
      await handler.close();
    }
  };
}
