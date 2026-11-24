# plzbot.me MCP server

plzbot.me serves a public [Model Context Protocol](https://modelcontextprotocol.io) (MCP) endpoint at
`https://plzbot.me.ddtripp.com/mcp`, so an AI application (Claude, Cursor, ChatGPT, an agent you wrote) can ask
plzbot what a website sees about the client making the request, and look up what each signal means. No account and
no key are needed. Code: `src/server/mcp/server.ts`. Tests: `tests/integration/mcp.test.ts`.

## MCP in five minutes

**The problem it solves.** Every AI app used to invent its own plugin format. MCP is one standard plug: a server
describes what it offers, and any MCP-speaking app (the *client*) can use it without custom code.

**The three roles.**

- **Host**: the AI application the person uses (Claude Desktop, Claude Code, an IDE).
- **Client**: the part of the host that holds one connection to one server.
- **Server**: a program that offers capabilities. This repo's `/mcp` endpoint is one.

**What a server can offer.**

| Primitive | Who decides to use it | plzbot offers |
|---|---|---|
| **Tools**: functions with typed inputs and outputs | the *model*, during a conversation | `fingerprint_me`, `explain_signal` |
| **Resources**: read-only documents, addressed by URI | the *application* or the user, to load into context | `plzbot://about`, `plzbot://signals`, `plzbot://signals/{id}` |
| **Prompts**: reusable prompt templates | the *user*, e.g. as a slash command | none yet |

A tool's description and input schema are all the model sees. They are written for the model, which is why they say
what the tool returns and when to use it.

**The wire format.** Messages are JSON-RPC 2.0 (`{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{…}}`).
Methods include `tools/list`, `tools/call`, `resources/list` and `resources/read`.

**Transports.** *stdio* is for a server the host starts as a local subprocess. *Streamable HTTP* is for a remote
server like this one. The client POSTs each JSON-RPC message to one URL, and the server answers with JSON, or with a
short Server-Sent Events stream when it has progress to report before the result.

**Versions.** The current spec is **2026-07-28**. It removed protocol sessions, so every request stands alone. Many
apps still speak the **2025** versions, which open with an `initialize` handshake. This server answers both: the
SDK's `createMcpHandler` serves 2026 requests natively and 2025 requests statelessly.

**Security rules a public server follows.** Validate the `Origin` header, so a web page can't make a visitor's
browser talk to the server (DNS rebinding). Validate every tool input. Rate-limit. Treat everything as public.
Authorization (OAuth) is optional in the spec, and this server is deliberately open and read-only.

## How this server works

```
AI app ──POST /mcp (JSON-RPC)──▶ Router ──▶ mcpRoute()
                                            ├─ Origin check (403) and rate limit (429)
                                            ├─ Node request ➜ web Request
                                            ├─ createMcpHandler(() => buildServer(req))   ← fresh McpServer per request
                                            │     tools/call fingerprint_me ➜ buildFingerprint(req) (same engine as the website)
                                            └─ web Response ➜ Node response (works on HTTP/1.1 and HTTP/2)
```

- **Stateless.** Each HTTP request gets a new `McpServer` and nothing is kept between requests. There are no
  sessions to expire and no memory to leak, and it works behind any load balancer.
- **Same engine as the site.** `fingerprint_me` runs `buildFingerprint` on the MCP request itself. The front proxy
  captures that connection's TLS ClientHello, so the result includes the caller's JA3/JA4, HTTP/2 settings and
  headers. Results are saved like `GET /api/v1/fingerprint`, with kind `mcp`, under the same storage limits.
- **Who is "me"?** The HTTP client that sent the request. With a local client (Claude Code, Cursor, your own
  script) that is your machine. With a hosted connector (claude.ai, ChatGPT) it is the AI provider's server. Either
  way, it is a real, fingerprintable client.
- **Plumbing.** The SDK speaks web-standard `Request`/`Response`. `mcpRoute` converts to and from Node's
  request/response itself instead of using `@modelcontextprotocol/node`. That keeps the app on the hand-rolled
  router; Express-style adapters crash on this server's HTTP/2 stack (see `src/server/http/router.ts`).

### Tools

| Tool | Input | Returns |
|---|---|---|
| `fingerprint_me` | none | `structuredContent`: `fingerprintId`, `derived` (e.g. `derived.ja4`), `observations` (each observed signal), `assessments` (plzbot's hedged findings); plus a short text summary |
| `explain_signal` | `query`: a signal id (`http.headers.user_agent`) or keywords (`tls cipher`), 1–100 characters | `structuredContent`: `exact`, `matches` (catalog entries: title, description, why it matters, caveats, references) |

Both are marked `readOnlyHint: true` and `openWorldHint: false`. Each tool declares an `outputSchema`, and the SDK
checks every result against it. Bad input comes back as a tool error (`isError: true`) that the model can read and
correct.

### Limits

- 120 requests per minute per visitor (IPv6 counts per /64); beyond that, `429` with `Retry-After`.
- Request bodies over 256 KB get `413`.
- A request with an `Origin` header must come from the site itself or from `PLZBOT_MCP_ALLOWED_ORIGINS`
  (comma-separated). In local `PLZBOT_MODE=http`, `http://localhost:*` is also allowed. Server-side clients send no
  Origin and are allowed.
- `GET /mcp` returns `405`: this server never pushes messages on its own.

## Connect to it

**Claude Code**

```sh
claude mcp add --transport http plzbot https://plzbot.me.ddtripp.com/mcp
```

Then ask "use plzbot to fingerprint this connection".

**Claude Desktop / claude.ai**: Settings → Connectors → Add custom connector → URL `https://plzbot.me.ddtripp.com/mcp`.

**MCP Inspector** (a web UI for poking at any MCP server):

```sh
npx @modelcontextprotocol/inspector
```

Choose transport "Streamable HTTP", URL `http://127.0.0.1:8080/mcp` for a local server.

**Your own code** (TypeScript, `@modelcontextprotocol/client`):

```ts
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
const client = new Client({ name: "my-agent", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL("https://plzbot.me.ddtripp.com/mcp")));
const result = await client.callTool({ name: "fingerprint_me", arguments: {} });
```

**curl** (2025-style, one request, no handshake needed because the server is stateless):

```sh
curl -s https://plzbot.me.ddtripp.com/mcp -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' -H 'mcp-protocol-version: 2025-06-18' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"explain_signal","arguments":{"query":"ja4"}}}'
```

## Ideas for later

- A probe tool: hand the model a one-time link for a browser agent to open, then report how detectable that browser
  and its behavior were. This needs short-lived state, kept by explicit handle, as the 2026 spec recommends.
- Prompts, for example "audit this client" built on `fingerprint_me` + `explain_signal`.
- A resource with the site's docs (`docs/ARCHITECTURE.md`, `docs/SCHEMA.md`). They aren't in the Docker image today.
