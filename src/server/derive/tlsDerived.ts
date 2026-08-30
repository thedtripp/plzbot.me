import type { DerivedAttribute } from "../../shared/schema/types.js";
import type { ConnectionMeta } from "../tls-capture/frontProxy.js";

export function deriveTls(connectionMeta: ConnectionMeta | undefined): DerivedAttribute[] {
  const out: DerivedAttribute[] = [];
  const evidence = [
    "tls.clienthello.version",
    "tls.clienthello.cipher_suites",
    "tls.clienthello.extensions",
    "tls.clienthello.supported_groups",
  ];

  if (connectionMeta?.ja3) {
    out.push({
      id: "derived.ja3",
      derivedFrom: evidence,
      value: connectionMeta.ja3.ja3String,
      method: "JA3 field concatenation (Salesforce spec) prior to hashing",
      status: "computed",
    });
    out.push({
      id: "derived.ja3_hash",
      derivedFrom: ["derived.ja3"],
      value: connectionMeta.ja3.ja3Hash,
      method: "MD5(derived.ja3)",
      status: "computed",
    });
  } else {
    out.push({
      id: "derived.ja3",
      derivedFrom: evidence,
      value: null,
      method: "JA3 field concatenation (Salesforce spec) prior to hashing",
      status: "unavailable",
      error: connectionMeta?.tlsParseNote ?? "no ClientHello captured for this connection",
    });
    out.push({
      id: "derived.ja3_hash",
      derivedFrom: ["derived.ja3"],
      value: null,
      method: "MD5(derived.ja3)",
      status: "unavailable",
    });
  }

  if (connectionMeta?.ja4) {
    out.push({
      id: "derived.ja4",
      derivedFrom: [...evidence, "tls.clienthello.signature_algorithms", "tls.clienthello.sni", "tls.clienthello.alpn_offered"],
      value: connectionMeta.ja4.ja4,
      method: "JA4 (FoxIO spec) — see src/server/tls-capture/ja4.ts for implementation notes",
      status: "computed",
    });
  } else {
    out.push({
      id: "derived.ja4",
      derivedFrom: evidence,
      value: null,
      method: "JA4 (FoxIO spec)",
      status: "unavailable",
      error: connectionMeta?.tlsParseNote ?? "no ClientHello captured for this connection",
    });
  }

  return out;
}
