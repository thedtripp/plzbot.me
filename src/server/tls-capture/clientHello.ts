/**
 * Minimal parser for a TLS ClientHello, read directly off the wire before Node's own
 * TLS engine consumes it. See docs/TLS_CAPTURE.md for why this exists and how it's wired
 * into the connection pipeline (src/server/net/frontProxy.ts).
 *
 * Only the fields needed for fingerprinting (JA3/JA4) and educational display are parsed.
 * References:
 *  - RFC 8446 §4.1.2 (TLS 1.3 ClientHello) https://www.rfc-editor.org/rfc/rfc8446#section-4.1.2
 *  - RFC 5246 §7.4.1.2 (TLS 1.2 ClientHello) https://www.rfc-editor.org/rfc/rfc5246#section-7.4.1.2
 */

export interface ParsedExtension {
  type: number;
  length: number;
  data: Buffer;
}

export interface ParsedClientHello {
  recordVersion: number; // uint16, from the TLS record layer
  handshakeVersion: number; // uint16, "legacy_version" field inside ClientHello
  random: Buffer; // 32 bytes
  sessionIdLength: number;
  cipherSuites: number[]; // in wire order, GREASE included (callers filter as needed)
  compressionMethods: number[];
  extensions: ParsedExtension[]; // in wire order
  serverName: string | null; // from SNI extension (type 0), if present
  supportedGroups: number[]; // from extension type 10 ("supported_groups" / elliptic_curves)
  ecPointFormats: number[]; // from extension type 11
  signatureAlgorithms: number[]; // from extension type 13
  alpnProtocols: string[]; // from extension type 16
  supportedVersions: number[]; // from extension type 43 (TLS 1.3 version list)
  totalLength: number; // bytes of the record this ClientHello consumed, for buffer bookkeeping
}

const HANDSHAKE_CONTENT_TYPE = 0x16;
const CLIENT_HELLO_HANDSHAKE_TYPE = 0x01;

/**
 * Attempts to parse a ClientHello from `buf`. Returns null if `buf` doesn't look like a TLS
 * handshake record at all (e.g. plaintext HTTP), or throws `NeedMoreDataError` if it looks like
 * one but more bytes are needed (record/handshake not fully buffered yet) — callers should keep
 * accumulating and retry.
 */
export class NeedMoreDataError extends Error {}

export function parseClientHello(buf: Buffer): ParsedClientHello | null {
  if (buf.length < 5) throw new NeedMoreDataError();
  if (buf[0] !== HANDSHAKE_CONTENT_TYPE) return null; // not a TLS handshake record at all

  const recordVersion = buf.readUInt16BE(1);
  const recordLength = buf.readUInt16BE(3);
  const recordEnd = 5 + recordLength;
  if (buf.length < recordEnd) throw new NeedMoreDataError();

  let o = 5;
  if (buf[o] !== CLIENT_HELLO_HANDSHAKE_TYPE) return null; // handshake, but not a ClientHello
  const handshakeLength = buf.readUIntBE(o + 1, 3);
  o += 4;
  const handshakeEnd = o + handshakeLength;
  if (buf.length < handshakeEnd || handshakeEnd > recordEnd) {
    // ClientHello spans more than this one record (large extension set) — ask for more.
    throw new NeedMoreDataError();
  }

  const handshakeVersion = buf.readUInt16BE(o);
  o += 2;
  const random = buf.subarray(o, o + 32);
  o += 32;

  const sessionIdLength = buf.readUInt8(o);
  o += 1 + sessionIdLength;

  const cipherSuitesLength = buf.readUInt16BE(o);
  o += 2;
  const cipherSuites: number[] = [];
  for (let i = 0; i < cipherSuitesLength; i += 2) {
    cipherSuites.push(buf.readUInt16BE(o + i));
  }
  o += cipherSuitesLength;

  const compressionMethodsLength = buf.readUInt8(o);
  o += 1;
  const compressionMethods: number[] = [];
  for (let i = 0; i < compressionMethodsLength; i++) {
    compressionMethods.push(buf.readUInt8(o + i));
  }
  o += compressionMethodsLength;

  const extensions: ParsedExtension[] = [];
  let serverName: string | null = null;
  let supportedGroups: number[] = [];
  let ecPointFormats: number[] = [];
  let signatureAlgorithms: number[] = [];
  let alpnProtocols: string[] = [];
  let supportedVersions: number[] = [];

  if (o < handshakeEnd) {
    const extensionsLength = buf.readUInt16BE(o);
    o += 2;
    const extensionsEnd = o + extensionsLength;
    while (o < extensionsEnd) {
      const type = buf.readUInt16BE(o);
      const length = buf.readUInt16BE(o + 2);
      const data = buf.subarray(o + 4, o + 4 + length);
      extensions.push({ type, length, data });

      switch (type) {
        case 0: // server_name
          serverName = parseServerName(data);
          break;
        case 10: // supported_groups
          supportedGroups = readUInt16List(data, 0);
          break;
        case 11: // ec_point_formats (length-prefixed uint8 list)
          ecPointFormats = Array.from(data.subarray(1, 1 + (data[0] ?? 0)));
          break;
        case 13: // signature_algorithms
          signatureAlgorithms = readUInt16List(data, 0);
          break;
        case 16: // application_layer_protocol_negotiation
          alpnProtocols = parseAlpn(data);
          break;
        case 43: // supported_versions
          supportedVersions = readUInt8PrefixedUInt16List(data);
          break;
        default:
          break;
      }

      o += 4 + length;
    }
  }

  return {
    recordVersion,
    handshakeVersion,
    random: Buffer.from(random),
    sessionIdLength,
    cipherSuites,
    compressionMethods,
    extensions,
    serverName,
    supportedGroups,
    ecPointFormats,
    signatureAlgorithms,
    alpnProtocols,
    supportedVersions,
    totalLength: recordEnd,
  };
}

function readUInt16List(data: Buffer, offsetOfLengthPrefix: number): number[] {
  const len = data.readUInt16BE(offsetOfLengthPrefix);
  const out: number[] = [];
  for (let i = 0; i < len; i += 2) {
    out.push(data.readUInt16BE(offsetOfLengthPrefix + 2 + i));
  }
  return out;
}

function readUInt8PrefixedUInt16List(data: Buffer): number[] {
  const len = data.readUInt8(0);
  const out: number[] = [];
  for (let i = 0; i < len; i += 2) {
    out.push(data.readUInt16BE(1 + i));
  }
  return out;
}

function parseServerName(data: Buffer): string | null {
  if (data.length < 2) return null;
  const listLength = data.readUInt16BE(0);
  let o = 2;
  const end = Math.min(2 + listLength, data.length);
  while (o < end) {
    const nameType = data.readUInt8(o);
    const nameLength = data.readUInt16BE(o + 1);
    const name = data.subarray(o + 3, o + 3 + nameLength).toString("utf8");
    if (nameType === 0) return name; // host_name
    o += 3 + nameLength;
  }
  return null;
}

function parseAlpn(data: Buffer): string[] {
  if (data.length < 2) return [];
  const listLength = data.readUInt16BE(0);
  const out: string[] = [];
  let o = 2;
  const end = Math.min(2 + listLength, data.length);
  while (o < end) {
    const len = data.readUInt8(o);
    out.push(data.subarray(o + 1, o + 1 + len).toString("utf8"));
    o += 1 + len;
  }
  return out;
}
