import type { Observation } from "../../shared/schema/types.js";
import { observed, unavailable } from "../../shared/schema/types.js";
import type { ConnectionMeta } from "../tls-capture/frontProxy.js";
import type { IncomingMessage } from "node:http";

/**
 * Untrusted-by-default proxy headers. We always parse and show them (educational value —
 * these are exactly the headers a client can forge), but never use them to override the
 * directly-observed TCP peer address unless a trusted-proxy configuration says to.
 * See docs/ARCHITECTURE.md "Security & privacy defaults".
 */
export function collectNetwork(req: IncomingMessage, connectionMeta: ConnectionMeta | undefined): Observation[] {
  const out: Observation[] = [];

  const remoteIp = connectionMeta?.realIp ?? req.socket.remoteAddress;
  const remotePort = connectionMeta?.realPort ?? req.socket.remotePort;
  const family = connectionMeta?.family ?? req.socket.remoteFamily;

  if (remoteIp) {
    out.push(
      observed(
        "network.remote_ip",
        "network",
        "server",
        connectionMeta ? "tcp_accept_pre_tls" : "tcp_socket",
        remoteIp,
      ),
    );
  } else {
    out.push(unavailable("network.remote_ip", "network", "server", "tcp_socket"));
  }

  out.push(
    remotePort
      ? observed("network.remote_port", "network", "server", "tcp_socket", remotePort)
      : unavailable("network.remote_port", "network", "server", "tcp_socket"),
  );

  out.push(
    family
      ? observed("network.remote_family", "network", "server", "tcp_socket", family)
      : unavailable("network.remote_family", "network", "server", "tcp_socket"),
  );

  const xff = req.headers["x-forwarded-for"];
  if (typeof xff === "string") {
    const chain = xff.split(",").map((s) => s.trim());
    out.push(
      observed("network.x_forwarded_for", "network", "server", "http_header_untrusted", xff, {
        chain,
        trust: "untrusted_client_suppliable",
      }),
    );
  } else {
    out.push(unavailable("network.x_forwarded_for", "network", "server", "http_header_untrusted"));
  }

  const forwarded = req.headers["forwarded"];
  if (typeof forwarded === "string") {
    out.push(
      observed("network.forwarded_header", "network", "server", "http_header_untrusted", forwarded, {
        trust: "untrusted_client_suppliable",
      }),
    );
  } else {
    out.push(unavailable("network.forwarded_header", "network", "server", "http_header_untrusted"));
  }

  const xRealIp = req.headers["x-real-ip"];
  if (typeof xRealIp === "string") {
    out.push(
      observed("network.x_real_ip", "network", "server", "http_header_untrusted", xRealIp, {
        trust: "untrusted_client_suppliable",
      }),
    );
  } else {
    out.push(unavailable("network.x_real_ip", "network", "server", "http_header_untrusted"));
  }

  // Deliberately not collected in the MVP: no outbound call to a third-party IP-intelligence
  // service is made. Reported explicitly as not_configured rather than silently omitted.
  out.push(unavailable("network.asn", "network", "server", "not_configured"));
  out.push(unavailable("network.geo", "network", "server", "not_configured"));

  return out;
}
