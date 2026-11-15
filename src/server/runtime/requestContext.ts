import type { IncomingMessage } from "node:http";
import type { TLSSocket } from "node:tls";
import type { RuntimeConfig } from "./config.js";
import { getConnectionMeta } from "../tls-capture/frontProxy.js";

/**
 * Per-request facts that depend on *how this server is deployed* rather than on the client:
 * whether we terminated TLS ourselves, what the effective scheme is, and which address we
 * consider the client's. Everything here is explicit about its provenance, because a reverse
 * proxy in front of us changes what "the remote address" even means.
 */
export interface RequestContext {
  /** True when this process terminated TLS for this connection (so raw handshake data is ours). */
  isTls: boolean;
  scheme: "http" | "https";
  /** Where `scheme` came from: `tls_socket`, `x-forwarded-proto` (trusted), or `plain_listener`. */
  schemeSource: string;
  /** The TCP peer we actually accepted (behind a proxy, this is the proxy). */
  tcpPeerIp: string | null;
  tcpPeerPort: number | null;
  tcpPeerFamily: string | null;
  /** Our best-supported notion of the end client's IP. Equals tcpPeerIp unless a trusted proxy is configured. */
  clientIp: string | null;
  /** Provenance of clientIp: `tcp_peer`, `trusted_proxy_header:<name>`, `x_forwarded_for:trusted_hops=<n>`. */
  clientIpSource: string;
  trustedProxyConfigured: boolean;
}

export function isTlsSocket(req: IncomingMessage): boolean {
  const s = req.socket as Partial<TLSSocket> | undefined;
  return Boolean(s && (s as { encrypted?: boolean }).encrypted && typeof s.getProtocol === "function");
}

function firstHeader(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0];
  return v;
}

export function getRequestContext(req: IncomingMessage, config: RuntimeConfig): RequestContext {
  const meta = getConnectionMeta(req.socket);
  const isTls = isTlsSocket(req);
  const tcpPeerIp = meta?.realIp ?? req.socket.remoteAddress ?? null;
  const tcpPeerPort = meta?.realPort ?? req.socket.remotePort ?? null;
  const tcpPeerFamily = meta?.family ?? req.socket.remoteFamily ?? null;
  const trusted = config.trustedProxy;
  const trustedProxyConfigured = trusted.hops > 0 || trusted.clientIpHeader !== null;

  let scheme: "http" | "https" = isTls ? "https" : "http";
  let schemeSource = isTls ? "tls_socket" : "plain_listener";
  if (!isTls && trusted.hops > 0) {
    const xfp = firstHeader(req, "x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
    if (xfp === "https" || xfp === "http") {
      scheme = xfp;
      schemeSource = "x-forwarded-proto";
    }
  }

  let clientIp = tcpPeerIp;
  let clientIpSource = "tcp_peer";
  if (trusted.clientIpHeader) {
    const v = firstHeader(req, trusted.clientIpHeader)?.trim();
    if (v) {
      clientIp = v;
      clientIpSource = `trusted_proxy_header:${trusted.clientIpHeader}`;
    }
  } else if (trusted.hops > 0) {
    const xff = firstHeader(req, "x-forwarded-for");
    if (xff) {
      const chain = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      // The last `hops` entries were appended by infrastructure we trust; the entry just
      // before them is the address that infrastructure saw connecting — i.e. the client.
      const idx = Math.max(0, chain.length - trusted.hops);
      const candidate = chain[idx - 1 >= 0 ? idx - 1 : 0];
      if (candidate) {
        clientIp = candidate;
        clientIpSource = `x_forwarded_for:trusted_hops=${trusted.hops}`;
      }
    }
  }

  return {
    isTls,
    scheme,
    schemeSource,
    tcpPeerIp,
    tcpPeerPort,
    tcpPeerFamily,
    clientIp,
    clientIpSource,
    trustedProxyConfigured,
  };
}
