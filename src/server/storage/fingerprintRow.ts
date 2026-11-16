import net from "node:net";
import type { Fingerprint, Observation } from "../../shared/schema/types.js";

/**
 * What caused this fingerprint to be recorded.
 *  - page_view     server-observed half only, recorded when the HTML page itself is requested.
 *                  This is the only record a crawler or AI agent leaves if it never runs JS.
 *  - api_get       GET /api/v1/fingerprint (curl, scripts, agents asking for their own footprint)
 *  - client_submit POST /api/v1/fingerprint/client (the browser collector, server + client halves)
 */
export type FingerprintKind = "page_view" | "api_get" | "client_submit";

/** One row of the `fingerprints` table. Column meanings are documented in migrations.ts. */
export interface FingerprintRow {
  id: string;
  seen_at: string;
  kind: FingerprintKind;
  client_ip: string | null;
  peer_ip: string | null;
  asn: number | null;
  http_version: string;
  target: string;
  user_agent: string | null;
  ja3_hash: string | null;
  ja4: string | null;
  h2_fingerprint: string | null;
  ua_family: string | null;
  agent_name: string | null;
  agent_category: string | null;
  assessment_ids: string[];
  has_client: boolean;
  schema_version: string;
  /** The full fingerprint minus `interpretation` (recomputable from the stored observations). */
  doc: Omit<Fingerprint, "interpretation">;
}

const MAX_UA_LEN = 2000;

function allObservations(fp: Fingerprint): Observation[] {
  const out: Observation[] = Object.values(fp.server).flat();
  if (fp.client) {
    for (const v of Object.values(fp.client)) if (Array.isArray(v)) out.push(...(v as Observation[]));
  }
  return out;
}

/** Return a string Postgres `inet` will accept, or null. Strips IPv6 zone ids and the ::ffff: v4-mapped prefix. */
export function normalizeIp(value: unknown): string | null {
  if (typeof value !== "string") return null;
  let ip = value.trim();
  const zone = ip.indexOf("%");
  if (zone !== -1) ip = ip.slice(0, zone);
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) ip = mapped[1]!;
  return net.isIP(ip) ? ip : null;
}

function asString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** Flatten a Fingerprint into the queryable columns plus the full JSON document. */
export function toRow(fp: Fingerprint, kind: FingerprintKind): FingerprintRow {
  const obs = new Map<string, Observation>();
  for (const o of allObservations(fp)) if (o.status === "observed") obs.set(o.id, o);
  const derived = (id: string): unknown => fp.derived.find((d) => d.id === id && d.status === "computed")?.value ?? null;

  const asnRaw = obs.get("network.asn")?.raw as { asn?: unknown } | null | undefined;
  const asn = typeof asnRaw?.asn === "number" && Number.isInteger(asnRaw.asn) ? asnRaw.asn : null;

  const sig = derived("derived.client_signature") as { name?: unknown; category?: unknown } | null;
  const ua = asString(obs.get("http.headers.user_agent")?.raw);

  const { interpretation, ...doc } = fp;
  return {
    id: fp.fingerprintId,
    seen_at: fp.request.receivedAt,
    kind,
    client_ip: normalizeIp(obs.get("network.client_ip")?.raw ?? obs.get("network.remote_ip")?.raw),
    peer_ip: normalizeIp(obs.get("network.remote_ip")?.raw),
    asn,
    http_version: fp.request.httpVersion,
    target: fp.request.target.slice(0, 2000),
    user_agent: ua ? ua.slice(0, MAX_UA_LEN) : null,
    ja3_hash: asString(derived("derived.ja3_hash")),
    ja4: asString(derived("derived.ja4")),
    h2_fingerprint: asString(obs.get("http2.fingerprint_partial")?.normalized ?? obs.get("http2.fingerprint_partial")?.raw),
    ua_family: asString(derived("derived.ua_browser_family_guess")),
    agent_name: asString(sig?.name),
    agent_category: asString(sig?.category),
    assessment_ids: interpretation.assessments.map((a) => a.id),
    has_client: fp.client !== null,
    schema_version: fp.schemaVersion,
    doc,
  };
}
