/**
 * JA3 TLS client fingerprint, per the original Salesforce Engineering spec:
 * https://engineering.salesforce.com/tls-fingerprinting-with-ja3-and-ja3s-247362855967/
 * Reference implementation: https://github.com/salesforce/ja3
 *
 * JA3 = MD5(TLSVersion,Ciphers,Extensions,EllipticCurves,EllipticCurvePointFormats)
 * where each field is a dash-joined list of decimal values in wire order, GREASE values
 * removed, and TLSVersion is the ClientHello's own version field (not the record layer's).
 *
 * JA3 is widely used but has known weaknesses documented alongside JA4 below — most notably,
 * it is unkeyed to extension *order* changes introduced deliberately (e.g. by some clients
 * that now randomize extension order specifically to defeat JA3), and two otherwise very
 * different clients can collide if their handshakes happen to match on all five fields.
 */
import { createHash } from "node:crypto";
import type { ParsedClientHello } from "./clientHello.js";
import { isGrease } from "./grease.js";

export interface Ja3Result {
  ja3String: string;
  ja3Hash: string;
}

export function computeJa3(hello: ParsedClientHello): Ja3Result {
  const ciphers = hello.cipherSuites.filter((c) => !isGrease(c));
  const extTypes = hello.extensions.map((e) => e.type).filter((t) => !isGrease(t));
  const curves = hello.supportedGroups.filter((g) => !isGrease(g));
  const pointFormats = hello.ecPointFormats;

  const ja3String = [
    hello.handshakeVersion,
    ciphers.join("-"),
    extTypes.join("-"),
    curves.join("-"),
    pointFormats.join("-"),
  ].join(",");

  const ja3Hash = createHash("md5").update(ja3String).digest("hex");

  return { ja3String, ja3Hash };
}
