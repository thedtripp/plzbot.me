/**
 * JA4 TLS client fingerprint, per the FoxIO specification:
 * https://github.com/FoxIO-LLC/ja4/blob/main/technical_details/JA4.md
 * (blog announcement: https://blog.foxio.io/ja4+-network-fingerprinting)
 *
 * JA4 was designed to address specific JA3 weaknesses: it's human-readable in its first
 * segment (protocol/version/SNI/counts are visible, not hashed), it separates SNI and ALPN
 * out of the hashed extension list (since their presence is already captured elsewhere and
 * hashing them in made JA3 fingerprints diverge across otherwise-identical hosts, only
 * because of which server_name the client happened to request), and it hashes cipher order
 * (sorted) and extension order (sorted, +unsorted signature algorithms) into two separate
 * truncated SHA-256 segments instead of one combined MD5.
 *
 * IMPLEMENTATION NOTE: this reproduces the published algorithm from the spec text above but
 * has not been cross-validated against FoxIO's reference implementation on a large corpus of
 * real traffic. Treat exact hash values as "best-effort, spec-following" rather than
 * guaranteed byte-for-byte identical to the official `ja4` tool — flagged here rather than
 * silently presented as authoritative, per this project's own rule about not overclaiming.
 * This server only ever terminates TCP, so the leading protocol character is always "t"
 * (QUIC/"q" is out of scope — this app does not implement HTTP/3).
 */
import { createHash } from "node:crypto";
import type { ParsedClientHello } from "./clientHello.js";
import { isGrease } from "./grease.js";

export interface Ja4Result {
  ja4: string;
  parts: { a: string; b: string; c: string };
}

const TLS_VERSION_TAGS: Record<number, string> = {
  0x0304: "13",
  0x0303: "12",
  0x0302: "11",
  0x0301: "10",
  0x0300: "s3",
};

function highestTlsVersionTag(hello: ParsedClientHello): string {
  const candidates = hello.supportedVersions.length > 0 ? hello.supportedVersions : [hello.handshakeVersion];
  let best = 0;
  for (const v of candidates) {
    if (!isGrease(v) && v > best) best = v;
  }
  return TLS_VERSION_TAGS[best] ?? "00";
}

function hex4(n: number): string {
  return n.toString(16).padStart(4, "0");
}

function truncatedSha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 12);
}

export function computeJa4(hello: ParsedClientHello): Ja4Result {
  const ciphers = hello.cipherSuites.filter((c) => !isGrease(c));
  const allExtTypes = hello.extensions.map((e) => e.type).filter((t) => !isGrease(t));
  const sigAlgs = hello.signatureAlgorithms.filter((s) => !isGrease(s));

  const protocol = "t";
  const version = highestTlsVersionTag(hello);
  const sni = hello.serverName ? "d" : "i";
  const cipherCount = Math.min(ciphers.length, 99).toString().padStart(2, "0");
  const extCount = Math.min(allExtTypes.length, 99).toString().padStart(2, "0");
  const firstAlpn = hello.alpnProtocols[0] ?? "";
  const alpnTag =
    firstAlpn.length === 0
      ? "00"
      : firstAlpn.length === 1
        ? firstAlpn + firstAlpn
        : (firstAlpn[0] ?? "") + (firstAlpn[firstAlpn.length - 1] ?? "");

  const a = `${protocol}${version}${sni}${cipherCount}${extCount}${alpnTag}`;

  const sortedCiphers = [...ciphers].sort((x, y) => x - y).map(hex4);
  const b = sortedCiphers.length > 0 ? truncatedSha256(sortedCiphers.join(",")) : "000000000000";

  const extTypesForHash = allExtTypes.filter((t) => t !== 0x0000 && t !== 0x0010);
  const sortedExt = [...extTypesForHash].sort((x, y) => x - y).map(hex4);
  const sigAlgHex = sigAlgs.map(hex4);
  const cInput = `${sortedExt.join(",")}_${sigAlgHex.join(",")}`;
  const c = sortedExt.length > 0 || sigAlgHex.length > 0 ? truncatedSha256(cInput) : "000000000000";

  return { ja4: `${a}_${b}_${c}`, parts: { a, b, c } };
}
