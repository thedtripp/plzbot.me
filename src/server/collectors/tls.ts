import type { TLSSocket } from "node:tls";
import type { IncomingMessage } from "node:http";
import type { Observation } from "../../shared/schema/types.js";
import { observed, unavailable } from "../../shared/schema/types.js";
import type { ConnectionMeta } from "../tls-capture/frontProxy.js";

const TLS_VERSION_NAMES: Record<number, string> = {
  0x0304: "TLS 1.3",
  0x0303: "TLS 1.2",
  0x0302: "TLS 1.1",
  0x0301: "TLS 1.0",
  0x0300: "SSL 3.0",
};

export function collectTls(req: IncomingMessage, connectionMeta: ConnectionMeta | undefined): Observation[] {
  const out: Observation[] = [];
  const socket = req.socket as TLSSocket;
  const isTls = typeof socket.getProtocol === "function";

  if (!isTls) {
    out.push(unavailable("tls.negotiated_protocol", "tls", "server", "tls_socket"));
    return out;
  }

  const protocol = socket.getProtocol?.();
  out.push(
    protocol
      ? observed("tls.negotiated_protocol", "tls", "server", "tls_socket_negotiated", protocol)
      : unavailable("tls.negotiated_protocol", "tls", "server", "tls_socket_negotiated"),
  );

  const cipher = socket.getCipher?.();
  out.push(
    cipher
      ? observed("tls.negotiated_cipher", "tls", "server", "tls_socket_negotiated", cipher)
      : unavailable("tls.negotiated_cipher", "tls", "server", "tls_socket_negotiated"),
  );

  const alpn = socket.alpnProtocol;
  out.push(
    alpn
      ? observed("tls.alpn_negotiated", "tls", "server", "tls_socket_negotiated", alpn)
      : unavailable("tls.alpn_negotiated", "tls", "server", "tls_socket_negotiated"),
  );

  const hello = connectionMeta?.parsedClientHello;
  if (!hello) {
    const note = connectionMeta?.tlsParseNote ?? "no_connection_meta";
    out.push(unavailable("tls.clienthello.version", "tls", "server", `self_observed_clienthello:${note}`));
    out.push(unavailable("tls.clienthello.cipher_suites", "tls", "server", `self_observed_clienthello:${note}`));
    out.push(unavailable("tls.clienthello.extensions", "tls", "server", `self_observed_clienthello:${note}`));
    out.push(unavailable("tls.clienthello.supported_groups", "tls", "server", `self_observed_clienthello:${note}`));
    out.push(unavailable("tls.clienthello.signature_algorithms", "tls", "server", `self_observed_clienthello:${note}`));
    out.push(unavailable("tls.clienthello.sni", "tls", "server", `self_observed_clienthello:${note}`));
    out.push(unavailable("tls.clienthello.alpn_offered", "tls", "server", `self_observed_clienthello:${note}`));
    return out;
  }

  out.push(
    observed("tls.clienthello.version", "tls", "server", "self_observed_clienthello", hello.handshakeVersion, {
      hex: `0x${hello.handshakeVersion.toString(16)}`,
      name: TLS_VERSION_NAMES[hello.handshakeVersion] ?? "unknown",
    }),
  );
  out.push(
    observed(
      "tls.clienthello.cipher_suites",
      "tls",
      "server",
      "self_observed_clienthello",
      hello.cipherSuites,
      hello.cipherSuites.map((c) => `0x${c.toString(16).padStart(4, "0")}`),
    ),
  );
  out.push(
    observed(
      "tls.clienthello.extensions",
      "tls",
      "server",
      "self_observed_clienthello",
      hello.extensions.map((e) => e.type),
      hello.extensions.map((e) => `0x${e.type.toString(16).padStart(4, "0")}`),
    ),
  );
  out.push(
    observed(
      "tls.clienthello.supported_groups",
      "tls",
      "server",
      "self_observed_clienthello",
      hello.supportedGroups,
    ),
  );
  out.push(
    observed(
      "tls.clienthello.signature_algorithms",
      "tls",
      "server",
      "self_observed_clienthello",
      hello.signatureAlgorithms,
    ),
  );
  out.push(
    hello.serverName
      ? observed("tls.clienthello.sni", "tls", "server", "self_observed_clienthello", hello.serverName)
      : unavailable("tls.clienthello.sni", "tls", "server", "self_observed_clienthello"),
  );
  out.push(
    observed("tls.clienthello.alpn_offered", "tls", "server", "self_observed_clienthello", hello.alpnProtocols),
  );

  return out;
}
