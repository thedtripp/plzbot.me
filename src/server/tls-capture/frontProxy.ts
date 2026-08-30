/**
 * The public-facing TCP listener.
 *
 * Node's `tls`/`https`/`http2` modules terminate and parse the TLS handshake internally and
 * never expose the raw ClientHello bytes to application code — there is no public hook for it.
 * To compute JA3/JA4 we have to read those bytes ourselves, before Node's TLS engine does.
 *
 * The catch: once a `net.Socket` has had data read from it via the normal Readable-stream API
 * (which is what peeking requires), Node's `tls.TLSSocket` can no longer safely wrap that same
 * socket object to perform the handshake — it works by re-parenting the socket's underlying
 * handle, which assumes a handle that has never been read from. Confirmed empirically while
 * building this (see docs/TLS_CAPTURE.md): reusing the same socket object hangs the handshake.
 *
 * So this module runs a tiny in-process TCP proxy instead of trying to reuse one socket:
 *   1. Accept the real client connection here, on the public port.
 *   2. Peek + parse the ClientHello (may span a few TCP segments; accumulate until parseable).
 *   3. Open a *new* loopback connection to the real TLS-terminating server (which listens
 *      normally on a loopback-only port, so every socket it accepts is untouched by our code).
 *   4. Pipe bytes through in both directions.
 *   5. Correlate the loopback connection back to this client's real IP/port and parsed
 *      ClientHello by binding the outbound loopback connection to a *locally chosen* source
 *      port, so the internal server's `secureConnection` event (which reports that same port
 *      as `remotePort`) can look our metadata up deterministically — no shared state needed
 *      beyond a small in-memory map, and no race with the OS's own ephemeral port assignment.
 */
import net from "node:net";
import { EventEmitter } from "node:events";
import { parseClientHello, NeedMoreDataError, type ParsedClientHello } from "./clientHello.js";
import { computeJa3, type Ja3Result } from "./ja3.js";
import { computeJa4, type Ja4Result } from "./ja4.js";

export interface ConnectionMeta {
  realIp: string;
  realPort: number;
  localPort: number;
  family: string | undefined;
  clientHelloRaw: Buffer | null;
  parsedClientHello: ParsedClientHello | null;
  ja3: Ja3Result | null;
  ja4: Ja4Result | null;
  tlsParseNote?: string;
  connectedAt: string;
}

const META = Symbol("plzbotConnectionMeta");

export function getConnectionMeta(socket: unknown): ConnectionMeta | undefined {
  if (!socket || typeof socket !== "object") return undefined;
  return (socket as Record<symbol, ConnectionMeta | undefined>)[META];
}

function attachConnectionMeta(socket: object, meta: ConnectionMeta): void {
  (socket as Record<symbol, ConnectionMeta>)[META] = meta;
}

const MAX_PEEK_BYTES = 32 * 1024;
const PEEK_TIMEOUT_MS = 3000;
const LOCAL_PORT_RANGE_START = 45000;
const LOCAL_PORT_RANGE_SIZE = 15000;

interface PeekResult {
  buf: Buffer;
  parsed: ParsedClientHello | null;
  note?: string;
}

function peekClientHello(socket: net.Socket): Promise<PeekResult> {
  return new Promise((resolve) => {
    let acc = Buffer.alloc(0);
    let settled = false;

    const finish = (result: PeekResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.removeListener("data", onData);
      socket.removeListener("close", onClose);
      socket.removeListener("error", onError);
      resolve(result);
    };

    const onData = (chunk: Buffer) => {
      acc = Buffer.concat([acc, chunk]);
      try {
        const parsed = parseClientHello(acc);
        finish({ buf: acc, parsed });
      } catch (err) {
        if (err instanceof NeedMoreDataError) {
          if (acc.length > MAX_PEEK_BYTES) {
            finish({ buf: acc, parsed: null, note: "clienthello_exceeded_peek_limit" });
          }
          return; // wait for more data
        }
        finish({ buf: acc, parsed: null, note: `parse_error: ${(err as Error).message}` });
      }
    };
    const onClose = () => finish({ buf: acc, parsed: null, note: "connection_closed_during_peek" });
    const onError = () => finish({ buf: acc, parsed: null, note: "connection_error_during_peek" });
    const timer = setTimeout(() => finish({ buf: acc, parsed: null, note: "peek_timeout" }), PEEK_TIMEOUT_MS);

    socket.on("data", onData);
    socket.once("close", onClose);
    socket.once("error", onError);
  });
}

export interface FrontProxyOptions {
  publicPort: number;
  publicHost?: string;
  internalHost: string;
  internalPort: number;
  /** The internal TLS server, so we can attach the correlation listener to it. */
  internalTlsServer: {
    on(event: "secureConnection", listener: (tlsSocket: net.Socket & { [META]?: ConnectionMeta }) => void): void;
  };
  logger?: (event: string, detail?: Record<string, unknown>) => void;
}

export declare interface FrontProxy {
  on(event: "listening", listener: (address: net.AddressInfo) => void): this;
}

export class FrontProxy extends EventEmitter {
  private readonly server: net.Server;
  private readonly pending = new Map<number, ConnectionMeta>();
  private portCursor = LOCAL_PORT_RANGE_START;
  private readonly opts: FrontProxyOptions;

  constructor(opts: FrontProxyOptions) {
    super();
    this.opts = opts;

    opts.internalTlsServer.on("secureConnection", (tlsSocket) => {
      const meta = this.pending.get(tlsSocket.remotePort ?? -1);
      if (meta) {
        this.pending.delete(tlsSocket.remotePort as number);
        attachConnectionMeta(tlsSocket, meta);
      } else {
        opts.logger?.("tls_correlation_miss", { remotePort: tlsSocket.remotePort });
      }
    });

    this.server = net.createServer((clientSocket) => this.handleClient(clientSocket));
  }

  listen(): Promise<net.AddressInfo> {
    return new Promise((resolve) => {
      this.server.listen(this.opts.publicPort, this.opts.publicHost ?? "0.0.0.0", () => {
        const addr = this.server.address() as net.AddressInfo;
        this.emit("listening", addr);
        resolve(addr);
      });
    });
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.server.close(() => resolve()));
  }

  private nextLocalPort(): number {
    for (let i = 0; i < LOCAL_PORT_RANGE_SIZE; i++) {
      const port = LOCAL_PORT_RANGE_START + ((this.portCursor++ - LOCAL_PORT_RANGE_START) % LOCAL_PORT_RANGE_SIZE);
      if (!this.pending.has(port)) return port;
    }
    throw new Error("FrontProxy: exhausted local correlation port range");
  }

  private async handleClient(clientSocket: net.Socket): Promise<void> {
    const realIp = clientSocket.remoteAddress ?? "unknown";
    const realPort = clientSocket.remotePort ?? 0;
    const family = clientSocket.remoteFamily;
    const connectedAt = new Date().toISOString();

    const { buf, parsed, note } = await peekClientHello(clientSocket);

    if (!parsed && looksLikePlaintextHttp(buf)) {
      clientSocket.end(
        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\n" +
          "This server only speaks TLS on this port. Use https:// instead of http://.\n",
      );
      return;
    }

    let ja3: Ja3Result | null = null;
    let ja4: Ja4Result | null = null;
    if (parsed) {
      try {
        ja3 = computeJa3(parsed);
      } catch (err) {
        this.opts.logger?.("ja3_compute_error", { error: (err as Error).message });
      }
      try {
        ja4 = computeJa4(parsed);
      } catch (err) {
        this.opts.logger?.("ja4_compute_error", { error: (err as Error).message });
      }
    }

    const localPort = this.nextLocalPort();
    const meta: ConnectionMeta = {
      realIp,
      realPort,
      localPort,
      family,
      clientHelloRaw: buf.length > 0 ? buf : null,
      parsedClientHello: parsed,
      ja3,
      ja4,
      tlsParseNote: note,
      connectedAt,
    };
    this.pending.set(localPort, meta);

    const upstream = net.connect(
      {
        port: this.opts.internalPort,
        host: this.opts.internalHost,
        localPort,
        localAddress: "127.0.0.1",
      },
      () => {
        if (buf.length > 0) upstream.write(buf);
        clientSocket.pipe(upstream);
        upstream.pipe(clientSocket);
      },
    );

    const cleanup = () => {
      this.pending.delete(localPort);
      clientSocket.destroy();
      upstream.destroy();
    };
    upstream.on("error", (err) => {
      this.opts.logger?.("upstream_proxy_error", { error: err.message });
      cleanup();
    });
    clientSocket.on("error", () => cleanup());
    clientSocket.on("close", () => this.pending.delete(localPort));
  }
}

function looksLikePlaintextHttp(buf: Buffer): boolean {
  if (buf.length < 4) return false;
  const start = buf.subarray(0, Math.min(buf.length, 8)).toString("ascii");
  return /^(GET |POST |PUT |HEAD |DELETE|OPTIONS|CONNECT|PATCH )/.test(start);
}
