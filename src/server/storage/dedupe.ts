import crypto from "node:crypto";
import net from "node:net";
import type { Fingerprint, Observation } from "../../shared/schema/types.js";

/**
 * What makes two fingerprints "the same", and what is recorded per visit instead.
 *
 * The hash covers the things that identify a CLIENT: its TLS fingerprint (JA4 plus the negotiated
 * protocol/cipher/ALPN), the HTTP headers it sends and their order, its HTTP/2 settings, Client
 * Hints, and every browser-collected signal. It deliberately ignores values that change on every
 * request without saying anything about the client: ids, timestamps, the client IP and port, the
 * Host header and SNI (chosen by the visitor), the request path, the Referer, the HTTP/2 stream
 * number, and the raw ClientHello bytes (they contain random data). Those go in the visit row.
 *
 * A hash that is too strict only costs a little storage (a duplicate is kept). One that is too
 * loose would merge genuinely different clients, so only a short, explicit list is ignored, and
 * every browser-collected signal counts. Bump HASH_VERSION if the definition ever changes.
 */
const HASH_VERSION = 1;

/** Server-side observations that vary per request and so are not part of the fingerprint. */
const PER_REQUEST = new Set(["http.headers.host", "http.headers.referer", "http.target", "http.headers_raw", "http2.stream_id"]);
/** Of the TLS observations only these (plus JA4, below) count; the rest vary per connection (random bytes, extension order). */
const TLS_KEEP = new Set(["tls.negotiated_protocol", "tls.negotiated_cipher", "tls.alpn_negotiated"]);

const entry = (o: Observation): [string, string, unknown] => [o.id, o.status, o.status === "observed" ? (o.normalized ?? o.raw ?? null) : null];
const byId = (a: [string, string, unknown], b: [string, string, unknown]) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
const pick = (obs: Observation[] | undefined, keep: (o: Observation) => boolean) => (obs ?? []).filter(keep).map(entry).sort(byId);

/** Same value, with object keys sorted, so jsonb round-trips (which reorder keys) hash identically. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, canonical((v as Record<string, unknown>)[k])]));
  }
  return v;
}

export function fingerprintHash(fp: Fingerprint): string {
  const clientObs: Observation[] = fp.client
    ? Object.values(fp.client).filter((x): x is Observation[] => Array.isArray(x)).flat()
    : [];
  const parts = {
    v: HASH_VERSION,
    request: [fp.request.httpVersion, fp.request.scheme],
    ja4: fp.derived.find((d) => d.id === "derived.ja4")?.value ?? null,
    tls: pick(fp.server.tls, (o) => TLS_KEEP.has(o.id)),
    network: pick(fp.server.network, (o) => o.id === "network.client_ip_class"),
    http: pick(fp.server.http, (o) => !PER_REQUEST.has(o.id)),
    http2: pick(fp.server.http2, (o) => !PER_REQUEST.has(o.id)),
    clientHints: pick(fp.server.clientHints, () => true),
    client: pick(clientObs, () => true),
  };
  return crypto.createHash("sha256").update(JSON.stringify(canonical(parts))).digest("hex");
}

/** The client address: the resolved client IP, else the TCP peer, in a form Postgres `inet` accepts. */
export function clientIp(fp: Fingerprint): string | null {
  const obs = fp.server.network.find((o) => o.id === "network.client_ip" && o.status === "observed")
    ?? fp.server.network.find((o) => o.id === "network.remote_ip" && o.status === "observed");
  const ip = typeof obs?.raw === "string" ? obs.raw.replace(/%.*$/, "").replace(/^::ffff:(?=\d+\.)/i, "") : "";
  return net.isIP(ip) ? ip : null;
}

export interface VisitFields {
  hash: string;
  ip: string | null;
  /** Reverse-DNS name of the client IP, when it has one. */
  hostname: string | null;
  /** The Host header the visitor sent. Chosen by the visitor, so it is not trustworthy. */
  host: string | null;
  target: string;
  ja4: string | null;
}

export function describeVisit(fp: Fingerprint): VisitFields {
  const find = (obs: Observation[], id: string) => obs.find((o) => o.id === id && o.status === "observed");
  const ptr = find(fp.server.network, "network.reverse_dns")?.normalized;
  const host = find(fp.server.http, "http.headers.host")?.raw;
  return {
    hash: fingerprintHash(fp),
    ip: clientIp(fp),
    hostname: Array.isArray(ptr) && typeof ptr[0] === "string" ? ptr[0].slice(0, 255) : null,
    host: typeof host === "string" ? host.slice(0, 255) : null,
    target: fp.request.target.slice(0, 2000),
    ja4: (fp.derived.find((d) => d.id === "derived.ja4")?.value as string | null | undefined) ?? null,
  };
}
