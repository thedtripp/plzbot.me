import type { IncomingMessage } from "node:http";
import type { Observation } from "../../shared/schema/types.js";
import { observed, unavailable } from "../../shared/schema/types.js";

/**
 * User-Agent Client Hints (https://wicg.github.io/ua-client-hints/). Treated as a distinct
 * fingerprinting category per spec §3, not just "more headers": low-entropy hints
 * (Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform) are sent by supporting browsers on every
 * request; high-entropy hints (full version list, platform version, model, arch, etc.) are
 * only sent once the server has asked for them via `Accept-CH` (see setClientHintHeaders
 * below), so a *first* request in a fresh connection legitimately won't have them yet — that
 * is a protocol characteristic, not a collection bug.
 */

const LOW_ENTROPY_HINTS = ["sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform"] as const;

const HIGH_ENTROPY_HINTS = [
  "sec-ch-ua-full-version-list",
  "sec-ch-ua-full-version",
  "sec-ch-ua-platform-version",
  "sec-ch-ua-model",
  "sec-ch-ua-arch",
  "sec-ch-ua-bitness",
  "sec-ch-ua-wow64",
  "sec-ch-prefers-color-scheme",
  "sec-ch-prefers-reduced-motion",
  "sec-ch-viewport-width",
  "sec-ch-viewport-height",
  "sec-ch-dpr",
  "sec-ch-device-memory",
] as const;

/** Response header this app sends so supporting browsers attach high-entropy hints next time. */
export const ACCEPT_CH_VALUE = [...LOW_ENTROPY_HINTS, ...HIGH_ENTROPY_HINTS].join(", ");

function parseSecChUa(value: string): Array<{ brand: string; version: string }> {
  // Format: `"Brand";v="Version", "Brand";v="Version", ...` (quotes and spacing per spec, but
  // real clients vary slightly, so this is deliberately tolerant.)
  const out: Array<{ brand: string; version: string }> = [];
  for (const part of value.split(",")) {
    const m = part.trim().match(/^"([^"]*)";v="([^"]*)"$/);
    if (m && m[1] !== undefined && m[2] !== undefined) out.push({ brand: m[1], version: m[2] });
  }
  return out;
}

export function collectClientHints(req: IncomingMessage): Observation[] {
  const out: Observation[] = [];

  for (const name of [...LOW_ENTROPY_HINTS, ...HIGH_ENTROPY_HINTS]) {
    const raw = req.headers[name];
    const id = `client_hints.${name.replace(/-/g, "_")}`;
    if (raw === undefined) {
      out.push(unavailable(id, "client_hints", "server", "http_header_client_hint"));
      continue;
    }
    const value = Array.isArray(raw) ? raw.join(", ") : raw;
    const normalized = name === "sec-ch-ua" || name === "sec-ch-ua-full-version-list" ? parseSecChUa(value) : value;
    out.push(observed(id, "client_hints", "server", "http_header_client_hint", value, normalized));
  }

  return out;
}
