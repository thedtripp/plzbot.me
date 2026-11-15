import type { TLSSocket } from "node:tls";
import type { IncomingMessage } from "node:http";
import type { Observation } from "../../shared/schema/types.js";
import { observed, unavailable } from "../../shared/schema/types.js";
import type { ConnectionMeta } from "../tls-capture/frontProxy.js";
import { isGrease } from "../tls-capture/grease.js";
import {
  CIPHER_SUITE_NAMES,
  EXTENSION_NAMES,
  GROUP_NAMES,
  PSK_MODE_NAMES,
  SIGNATURE_ALGORITHM_NAMES,
  TLS_VERSION_NAMES,
  hex4,
  nameOf,
} from "../tls-capture/names.js";

const CLIENTHELLO_IDS = [
  "tls.clienthello.version",
  "tls.clienthello.record_version",
  "tls.clienthello.cipher_suites",
  "tls.clienthello.extensions",
  "tls.clienthello.supported_groups",
  "tls.clienthello.signature_algorithms",
  "tls.clienthello.sni",
  "tls.clienthello.alpn_offered",
  "tls.clienthello.supported_versions",
  "tls.clienthello.key_share_groups",
  "tls.clienthello.psk_key_exchange_modes",
  "tls.clienthello.ec_point_formats",
  "tls.clienthello.compression_methods",
  "tls.clienthello.session_id_length",
  "tls.clienthello.grease",
  "tls.clienthello.ech_present",
  "tls.clienthello.alps_present",
  "tls.clienthello.extension_count",
  "tls.clienthello.raw_hex",
];

/** key_share extension (RFC 8446 §4.2.8): list of (group, key_exchange) entries; we keep the groups. */
function parseKeyShareGroups(data: Buffer): number[] {
  if (data.length < 2) return [];
  const listLen = data.readUInt16BE(0);
  const out: number[] = [];
  let o = 2;
  const end = Math.min(2 + listLen, data.length);
  while (o + 4 <= end) {
    const group = data.readUInt16BE(o);
    const len = data.readUInt16BE(o + 2);
    out.push(group);
    o += 4 + len;
  }
  return out;
}

export function collectTls(req: IncomingMessage, connectionMeta: ConnectionMeta | undefined): Observation[] {
  const out: Observation[] = [];
  const socket = req.socket as TLSSocket;
  const isTls = typeof socket.getProtocol === "function";

  if (!isTls) {
    // Plain-HTTP deployment (PLZBOT_MODE=http): some upstream proxy/load balancer terminated TLS,
    // so nothing about the handshake is observable here. Reported per-signal as unavailable
    // rather than omitted, per the "never make it look like a signal was never tested" rule.
    const method = "tls_terminated_upstream";
    for (const id of ["tls.negotiated_protocol", "tls.negotiated_cipher", "tls.alpn_negotiated", "tls.session_reused", ...CLIENTHELLO_IDS]) {
      out.push(unavailable(id, "tls", "server", method));
    }
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

  out.push(
    typeof socket.isSessionReused === "function"
      ? observed("tls.session_reused", "tls", "server", "tls_socket_negotiated", socket.isSessionReused())
      : unavailable("tls.session_reused", "tls", "server", "tls_socket_negotiated"),
  );

  const hello = connectionMeta?.parsedClientHello;
  if (!hello) {
    const note = connectionMeta?.tlsParseNote ?? "no_connection_meta";
    for (const id of CLIENTHELLO_IDS) out.push(unavailable(id, "tls", "server", `self_observed_clienthello:${note}`));
    return out;
  }

  const M = "self_observed_clienthello";
  out.push(
    observed("tls.clienthello.version", "tls", "server", M, hello.handshakeVersion, {
      hex: hex4(hello.handshakeVersion),
      name: TLS_VERSION_NAMES[hello.handshakeVersion] ?? "unknown",
      note: "legacy_version field; TLS 1.3 clients send 0x0303 here and the real list in supported_versions",
    }),
  );
  out.push(
    observed("tls.clienthello.record_version", "tls", "server", M, hello.recordVersion, {
      hex: hex4(hello.recordVersion),
      name: TLS_VERSION_NAMES[hello.recordVersion] ?? "unknown",
    }),
  );
  out.push(
    observed("tls.clienthello.cipher_suites", "tls", "server", M, hello.cipherSuites, hello.cipherSuites.map((c) => nameOf(CIPHER_SUITE_NAMES, c, isGrease))),
  );
  out.push(
    observed(
      "tls.clienthello.extensions",
      "tls",
      "server",
      M,
      hello.extensions.map((e) => e.type),
      hello.extensions.map((e) => nameOf(EXTENSION_NAMES, e.type, isGrease)),
    ),
  );
  out.push(observed("tls.clienthello.extension_count", "tls", "server", M, hello.extensions.length));
  out.push(
    observed("tls.clienthello.supported_groups", "tls", "server", M, hello.supportedGroups, hello.supportedGroups.map((g) => nameOf(GROUP_NAMES, g, isGrease))),
  );
  out.push(
    observed(
      "tls.clienthello.signature_algorithms",
      "tls",
      "server",
      M,
      hello.signatureAlgorithms,
      hello.signatureAlgorithms.map((a) => nameOf(SIGNATURE_ALGORITHM_NAMES, a, isGrease)),
    ),
  );
  out.push(hello.serverName ? observed("tls.clienthello.sni", "tls", "server", M, hello.serverName) : unavailable("tls.clienthello.sni", "tls", "server", M));
  out.push(observed("tls.clienthello.alpn_offered", "tls", "server", M, hello.alpnProtocols));
  out.push(
    observed(
      "tls.clienthello.supported_versions",
      "tls",
      "server",
      M,
      hello.supportedVersions,
      hello.supportedVersions.map((v) => nameOf(TLS_VERSION_NAMES, v, isGrease)),
    ),
  );

  const keyShare = hello.extensions.find((e) => e.type === 51);
  const keyShareGroups = keyShare ? parseKeyShareGroups(keyShare.data) : null;
  out.push(
    keyShareGroups
      ? observed("tls.clienthello.key_share_groups", "tls", "server", M, keyShareGroups, keyShareGroups.map((g) => nameOf(GROUP_NAMES, g, isGrease)))
      : unavailable("tls.clienthello.key_share_groups", "tls", "server", M),
  );

  const pskModes = hello.extensions.find((e) => e.type === 45);
  const modes = pskModes ? Array.from(pskModes.data.subarray(1, 1 + (pskModes.data[0] ?? 0))) : null;
  out.push(
    modes
      ? observed("tls.clienthello.psk_key_exchange_modes", "tls", "server", M, modes, modes.map((m) => PSK_MODE_NAMES[m] ?? String(m)))
      : unavailable("tls.clienthello.psk_key_exchange_modes", "tls", "server", M),
  );

  out.push(observed("tls.clienthello.ec_point_formats", "tls", "server", M, hello.ecPointFormats));
  out.push(observed("tls.clienthello.compression_methods", "tls", "server", M, hello.compressionMethods));
  out.push(observed("tls.clienthello.session_id_length", "tls", "server", M, hello.sessionIdLength));

  const greaseCiphers = hello.cipherSuites.filter(isGrease).map(hex4);
  const greaseExtensions = hello.extensions.map((e) => e.type).filter(isGrease).map(hex4);
  const greaseGroups = hello.supportedGroups.filter(isGrease).map(hex4);
  const greaseVersions = hello.supportedVersions.filter(isGrease).map(hex4);
  out.push(
    observed(
      "tls.clienthello.grease",
      "tls",
      "server",
      M,
      { ciphers: greaseCiphers, extensions: greaseExtensions, groups: greaseGroups, versions: greaseVersions },
      greaseCiphers.length + greaseExtensions.length + greaseGroups.length + greaseVersions.length > 0,
    ),
  );
  out.push(observed("tls.clienthello.ech_present", "tls", "server", M, hello.extensions.some((e) => e.type === 0xfe0d)));
  out.push(observed("tls.clienthello.alps_present", "tls", "server", M, hello.extensions.some((e) => e.type === 0x4469 || e.type === 0x44cd)));

  const raw = connectionMeta?.clientHelloRaw;
  if (raw) {
    const slice = raw.subarray(0, Math.min(raw.length, hello.totalLength));
    out.push(
      observed("tls.clienthello.raw_hex", "tls", "server", M, slice.toString("hex"), { bytes: slice.length, truncated: slice.length < hello.totalLength }),
    );
  } else {
    out.push(unavailable("tls.clienthello.raw_hex", "tls", "server", M));
  }

  return out;
}
