import type { IncomingMessage } from "node:http";
import type { Observation } from "../../shared/schema/types.js";
import { observed, unavailable } from "../../shared/schema/types.js";

function headerString(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  if (Array.isArray(v)) return v.join(", ");
  return v;
}

function pushHeaderObservation(out: Observation[], id: string, req: IncomingMessage, name: string): void {
  const v = headerString(req, name);
  if (v !== undefined) {
    out.push(observed(id, "http", "server", "http_header", v));
  } else {
    out.push(unavailable(id, "http", "server", "http_header"));
  }
}

/** Reconstructs header order+casing exactly as sent, from Node's rawHeaders array. */
function headerOrder(req: IncomingMessage): string[] {
  const names: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const name = req.rawHeaders[i];
    if (name !== undefined) names.push(name);
  }
  return names;
}

export function collectHttp(req: IncomingMessage): Observation[] {
  const out: Observation[] = [];

  out.push(observed("http.method", "http", "server", "http_request_line", req.method ?? ""));
  out.push(observed("http.version", "http", "server", "http_request_line", req.httpVersion));
  out.push(observed("http.target", "http", "server", "http_request_line", req.url ?? ""));

  out.push(
    observed("http.headers_raw", "http", "server", "http_headers", req.rawHeaders, {
      count: req.rawHeaders.length / 2,
    }),
  );

  if (req.httpVersion.startsWith("1")) {
    out.push(observed("http.header_order", "http", "server", "http1_raw_header_order", headerOrder(req)));
  } else {
    // Node's http2 compat API normalizes headers into a plain object before user code sees
    // them and does not expose HEADERS-frame field order. See docs/ARCHITECTURE.md.
    out.push(unavailable("http.header_order", "http", "server", "http2_compat_api_limitation"));
  }

  pushHeaderObservation(out, "http.headers.user_agent", req, "user-agent");
  pushHeaderObservation(out, "http.headers.accept", req, "accept");
  pushHeaderObservation(out, "http.headers.accept_language", req, "accept-language");
  pushHeaderObservation(out, "http.headers.accept_encoding", req, "accept-encoding");
  pushHeaderObservation(out, "http.headers.connection", req, "connection");
  pushHeaderObservation(out, "http.headers.host", req, "host");
  pushHeaderObservation(out, "http.headers.referer", req, "referer");
  pushHeaderObservation(out, "http.headers.origin", req, "origin");
  pushHeaderObservation(out, "http.headers.dnt", req, "dnt");
  pushHeaderObservation(out, "http.headers.upgrade_insecure_requests", req, "upgrade-insecure-requests");
  pushHeaderObservation(out, "http.headers.cache_control", req, "cache-control");
  pushHeaderObservation(out, "http.headers.te", req, "te");

  // Fetch Metadata (https://www.w3.org/TR/fetch-metadata/) — sent automatically by modern
  // browsers, absent from most non-browser HTTP clients, so useful as a browser/non-browser
  // signal on its own.
  pushHeaderObservation(out, "http.headers.sec_fetch_site", req, "sec-fetch-site");
  pushHeaderObservation(out, "http.headers.sec_fetch_mode", req, "sec-fetch-mode");
  pushHeaderObservation(out, "http.headers.sec_fetch_user", req, "sec-fetch-user");
  pushHeaderObservation(out, "http.headers.sec_fetch_dest", req, "sec-fetch-dest");

  // Reflected back to the requester only — see docs/ARCHITECTURE.md security notes. Names
  // only, not values, since a raw session-cookie value has no fingerprinting purpose here
  // and there's no reason to echo it back verbatim.
  const cookieHeader = headerString(req, "cookie");
  if (cookieHeader !== undefined) {
    const names = cookieHeader
      .split(";")
      .map((p) => p.split("=")[0]?.trim())
      .filter((n): n is string => Boolean(n));
    out.push(observed("http.headers.cookie_names", "http", "server", "http_header_names_only", names));
  } else {
    out.push(unavailable("http.headers.cookie_names", "http", "server", "http_header_names_only"));
  }

  return out;
}
