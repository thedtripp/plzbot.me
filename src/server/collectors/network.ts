import type { Observation } from "../../shared/schema/types.js";
import { observed, unavailable } from "../../shared/schema/types.js";
import type { ConnectionMeta } from "../tls-capture/frontProxy.js";
import type { IncomingMessage } from "node:http";
import type { RequestContext } from "../runtime/requestContext.js";
import { classifyIp } from "../runtime/ipClass.js";
import type { Ip2AsnTable } from "../runtime/ip2asn.js";
import dns from "node:dns/promises";

/**
 * Untrusted-by-default proxy headers. We always parse and show them (educational value —
 * these are exactly the headers a client can forge), but never use them to override the
 * directly-observed TCP peer address unless a trusted-proxy configuration says to.
 * See docs/ARCHITECTURE.md "Security & privacy defaults".
 */
export function collectNetwork(
  req: IncomingMessage,
  connectionMeta: ConnectionMeta | undefined,
  ctx?: RequestContext,
  ip2asn?: Ip2AsnTable | null,
): Observation[] {
  const out: Observation[] = [];

  // The address this deployment considers "the client". Identical to network.remote_ip unless
  // a trusted reverse proxy is configured (PLZBOT_TRUST_PROXY / PLZBOT_CLIENT_IP_HEADER), in
  // which case the TCP peer is the proxy and the client comes from a header we chose to trust.
  if (ctx?.clientIp) {
    out.push(observed("network.client_ip", "network", "server", ctx.clientIpSource, ctx.clientIp));
  } else {
    out.push(unavailable("network.client_ip", "network", "server", ctx?.clientIpSource ?? "tcp_peer"));
  }

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

  // Structural address classification — local, no lookups (RFC 6890 special-purpose ranges).
  const clientIp = ctx?.clientIp ?? remoteIp;
  if (clientIp) {
    const cls = classifyIp(clientIp);
    out.push(observed("network.client_ip_class", "network", "server", "rfc6890_special_purpose_registry", cls, cls.scope));
  } else {
    out.push(unavailable("network.client_ip_class", "network", "server", "rfc6890_special_purpose_registry"));
  }

  // ASN / network owner: only from the optional offline iptoasn.com table (PLZBOT_IP2ASN_PATH);
  // never an outbound call. Unconfigured is reported as such rather than silently omitted.
  if (ip2asn && clientIp) {
    const rec = ip2asn.lookup(clientIp);
    out.push(
      rec
        ? observed("network.asn", "network", "server", "offline_ip2asn_table", rec, `AS${rec.asn} ${rec.description}`)
        : unavailable("network.asn", "network", "server", "offline_ip2asn_table:no_match"),
    );
  } else {
    out.push(unavailable("network.asn", "network", "server", "not_configured"));
  }
  // No geolocation database is used; the iptoasn country code (registration country of the
  // AS, not the user's location) is the closest thing and is reported inside network.asn.
  out.push(unavailable("network.geo", "network", "server", "not_configured"));

  return out;
}

/**
 * Reverse DNS (PTR) for the client address. Async and bounded, so it runs after the
 * synchronous collectors; failures and timeouts are reported as `unavailable` with the reason.
 * The PTR name is whatever the address's owner chose to publish — informative (cloud
 * provider / ISP naming conventions are recognizable) but not authoritative.
 */
export async function collectReverseDns(ip: string | null, timeoutMs = 1500): Promise<Observation> {
  const id = "network.reverse_dns";
  if (!ip) return unavailable(id, "network", "server", "dns_ptr_lookup");
  const cls = classifyIp(ip);
  if (cls.scope !== "public") return unavailable(id, "network", "server", `dns_ptr_lookup:skipped_${cls.scope}`);
  try {
    const names = await Promise.race([
      dns.reverse(ip),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), timeoutMs)),
    ]);
    return names.length > 0 ? observed(id, "network", "server", "dns_ptr_lookup", names) : unavailable(id, "network", "server", "dns_ptr_lookup:no_ptr");
  } catch (err) {
    return unavailable(id, "network", "server", `dns_ptr_lookup:${(err as Error).message.toLowerCase().replace(/\s+/g, "_").slice(0, 40)}`);
  }
}
