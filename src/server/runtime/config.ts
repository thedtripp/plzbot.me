import path from "node:path";
import { REPO_ROOT } from "./paths.js";
import type { RecaptchaConfig } from "../recaptcha/assess.js";

/**
 * Runtime configuration, all from environment variables so the same build runs unchanged in
 * local dev, in a container on a VM (self-terminated TLS, full JA3/JA4), or behind a PaaS
 * reverse proxy (plain HTTP in, TLS fingerprint unavailable). See deploy/README.md.
 */
export type ServerMode = "tls" | "http";

export interface TrustedProxyConfig {
  /** Number of trailing X-Forwarded-For hops that are trusted infrastructure (0 = none). */
  hops: number;
  /** A single header that the trusted proxy guarantees to set to the real client IP
   * (e.g. `cf-connecting-ip`, `fly-client-ip`, `true-client-ip`). Takes precedence over XFF. */
  clientIpHeader: string | null;
}

export interface RuntimeConfig {
  mode: ServerMode;
  host: string;
  port: number;
  /** In TLS mode: optional plain-HTTP listener for ACME HTTP-01 challenges + https redirect. 0 = disabled. */
  httpPort: number;
  certPath: string;
  keyPath: string;
  /** Directory certbot (or any ACME client) writes HTTP-01 challenge files into. */
  acmeWebroot: string;
  trustedProxy: TrustedProxyConfig;
  /** Public origin used in docs/text output, e.g. https://plzbot.example. Optional. */
  publicOrigin: string | null;
  /** Optional path to an iptoasn.com-style TSV (range_start range_end AS_number country AS_description). */
  ip2asnPath: string | null;
  /** Postgres connection string. Unset = fingerprints are not stored. Treat as a secret. */
  databaseUrl: string | null;
  /** Password for the private analysis page (/admin). Unset = the page and its API do not exist (404). */
  adminPassword: string | null;
  /** Max fingerprints SAVED per visitor (IPv4 address / IPv6 /64) per minute, hour and day. 0 disables a tier.
   * Over the limit, the record is counted (see the admin page) instead of stored. */
  storeLimitPerMinute: number;
  storeLimitPerHour: number;
  storeLimitPerDay: number;
  /** Stop saving full records once the fingerprints table passes this many MB (0 = no cap). Protects a small free-tier database. */
  storeMaxTableMb: number;
  /** Optional Google reCAPTCHA Enterprise scoring on the behavior page. Null = off, and nothing is sent to Google. */
  recaptcha: RecaptchaConfig | null;
}

function envInt(env: NodeJS.ProcessEnv, name: string, fallback: number): number {
  const raw = env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a non-negative integer, got "${raw}"`);
  return n;
}

export function parseTrustedProxy(raw: string | undefined, headerRaw: string | undefined): TrustedProxyConfig {
  const header = headerRaw?.trim().toLowerCase() || null;
  if (raw === undefined || raw === "" || raw === "0" || raw.toLowerCase() === "false") {
    return { hops: 0, clientIpHeader: header };
  }
  if (raw.toLowerCase() === "true") return { hops: 1, clientIpHeader: header };
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`PLZBOT_TRUST_PROXY must be a hop count or true/false, got "${raw}"`);
  return { hops: n, clientIpHeader: header };
}

/** All three of project id, site key and API key, or none. A half-configured setup fails at startup, not silently per request. */
export function parseRecaptcha(env: NodeJS.ProcessEnv): RecaptchaConfig | null {
  const projectId = env.PLZBOT_RECAPTCHA_PROJECT_ID?.trim() ?? "";
  const siteKey = env.PLZBOT_RECAPTCHA_SITE_KEY?.trim() ?? "";
  const apiKey = env.PLZBOT_RECAPTCHA_API_KEY?.trim() ?? "";
  const set = [projectId, siteKey, apiKey].filter(Boolean).length;
  if (set === 0) return null;
  if (set !== 3) {
    throw new Error("reCAPTCHA needs all of PLZBOT_RECAPTCHA_PROJECT_ID, PLZBOT_RECAPTCHA_SITE_KEY and PLZBOT_RECAPTCHA_API_KEY (or none of them)");
  }
  return { projectId, siteKey, apiKey, monthlyCap: envInt(env, "PLZBOT_RECAPTCHA_MONTHLY_CAP", 8000) };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const modeRaw = (env.PLZBOT_MODE ?? "tls").toLowerCase();
  if (modeRaw !== "tls" && modeRaw !== "http") throw new Error(`PLZBOT_MODE must be "tls" or "http", got "${modeRaw}"`);
  const mode = modeRaw as ServerMode;

  // PaaS platforms conventionally inject PORT; honor it when PLZBOT_PORT isn't set.
  const port = env.PLZBOT_PORT ? envInt(env, "PLZBOT_PORT", 0) : env.PORT ? envInt(env, "PORT", 0) : mode === "tls" ? 8443 : 8080;

  const adminPassword = env.PLZBOT_ADMIN_PASSWORD || null;
  if (adminPassword !== null && adminPassword.length < 12) {
    throw new Error("PLZBOT_ADMIN_PASSWORD must be at least 12 characters (generate one with: openssl rand -base64 18)");
  }

  return {
    mode,
    host: env.PLZBOT_HOST ?? (mode === "tls" ? "127.0.0.1" : "0.0.0.0"),
    port,
    httpPort: envInt(env, "PLZBOT_HTTP_PORT", 0),
    certPath: env.PLZBOT_TLS_CERT ?? path.join(REPO_ROOT, "certs", "dev-cert.pem"),
    keyPath: env.PLZBOT_TLS_KEY ?? path.join(REPO_ROOT, "certs", "dev-key.pem"),
    acmeWebroot: env.PLZBOT_ACME_WEBROOT ?? path.join(REPO_ROOT, "acme-webroot"),
    trustedProxy: parseTrustedProxy(env.PLZBOT_TRUST_PROXY, env.PLZBOT_CLIENT_IP_HEADER),
    publicOrigin: env.PLZBOT_PUBLIC_ORIGIN?.replace(/\/+$/, "") || null,
    ip2asnPath: env.PLZBOT_IP2ASN_PATH || null,
    databaseUrl: env.PLZBOT_DATABASE_URL || env.DATABASE_URL || null,
    adminPassword,
    storeLimitPerMinute: envInt(env, "PLZBOT_STORE_LIMIT_PER_MINUTE", 10),
    storeLimitPerHour: envInt(env, "PLZBOT_STORE_LIMIT_PER_HOUR", 30),
    storeLimitPerDay: envInt(env, "PLZBOT_STORE_LIMIT_PER_DAY", 100),
    storeMaxTableMb: envInt(env, "PLZBOT_STORE_MAX_TABLE_MB", 800),
    recaptcha: parseRecaptcha(env),
  };
}
