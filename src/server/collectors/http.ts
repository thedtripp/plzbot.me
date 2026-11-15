import type { IncomingMessage } from "node:http";
import type { Observation } from "../../shared/schema/types.js";
import { observed, unavailable, notApplicable } from "../../shared/schema/types.js";

function classifyCasing(names: string[]): { style: string; titleCase: number; lowerCase: number; other: number } {
  let titleCase = 0;
  let lowerCase = 0;
  let other = 0;
  for (const n of names) {
    if (n === n.toLowerCase()) lowerCase++;
    else if (/^[A-Z][a-z0-9]*(-[A-Z][a-z0-9]*)*$/.test(n) || /^[A-Z][A-Za-z0-9]*(-[A-Z][A-Za-z0-9]*)*$/.test(n)) titleCase++;
    else other++;
  }
  const style = names.length === 0 ? "none" : titleCase === names.length ? "title_case" : lowerCase === names.length ? "lower_case" : "mixed";
  return { style, titleCase, lowerCase, other };
}

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

  // Node preserves wire order (and original casing) in rawHeaders for HTTP/1.1, and
  // HEADERS-frame order for HTTP/2 (pseudo-headers included; those are reported separately
  // under http2.*, so they're filtered out here to keep the two versions comparable).
  const order = headerOrder(req).filter((n) => !n.startsWith(":"));
  out.push(
    observed(
      "http.header_order",
      "http",
      "server",
      req.httpVersion.startsWith("1") ? "http1_raw_header_order" : "http2_headers_frame_order",
      order,
      order.map((n) => n.toLowerCase()).join(","),
    ),
  );
  out.push(observed("http.header_count", "http", "server", "http_headers", order.length));

  // HTTP/1.1 clients differ in how they case header names (most send Title-Case; some
  // libraries and proxies lowercase everything). HTTP/2 mandates lowercase field names
  // (RFC 9113 §8.2), so the signal only exists on HTTP/1.x.
  if (req.httpVersion.startsWith("1")) {
    const casing = classifyCasing(order);
    out.push(observed("http.header_casing", "http", "server", "http1_raw_header_names", casing));
  } else {
    out.push(notApplicable("http.header_casing", "http", "server", "http2_requires_lowercase"));
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
  pushHeaderObservation(out, "http.headers.pragma", req, "pragma");
  pushHeaderObservation(out, "http.headers.priority", req, "priority");
  pushHeaderObservation(out, "http.headers.sec_gpc", req, "sec-gpc");
  pushHeaderObservation(out, "http.headers.sec_purpose", req, "sec-purpose");
  pushHeaderObservation(out, "http.headers.save_data", req, "save-data");
  pushHeaderObservation(out, "http.headers.via", req, "via");
  pushHeaderObservation(out, "http.headers.x_requested_with", req, "x-requested-with");
  pushHeaderObservation(out, "http.headers.from", req, "from");

  // Presence only — never the value — for credential-bearing headers.
  out.push(
    observed("http.headers.authorization_present", "http", "server", "http_header_presence_only", req.headers.authorization !== undefined),
  );

  // Accept-Encoding as a token list: `zstd` support in particular narrows the client a lot
  // (Chromium ≥123, Firefox ≥126; absent from curl/requests defaults).
  const ae = headerString(req, "accept-encoding");
  out.push(
    ae !== undefined
      ? observed(
          "http.accept_encoding_tokens",
          "http",
          "server",
          "http_header_parsed",
          ae.split(",").map((t) => t.trim().split(";")[0]?.trim().toLowerCase() ?? "").filter(Boolean),
        )
      : unavailable("http.accept_encoding_tokens", "http", "server", "http_header_parsed"),
  );

  // Fetch Metadata (https://www.w3.org/TR/fetch-metadata/) — sent automatically by modern
  // browsers, absent from most non-browser HTTP clients, so useful as a browser/non-browser
  // signal on its own.
  pushHeaderObservation(out, "http.headers.sec_fetch_site", req, "sec-fetch-site");
  pushHeaderObservation(out, "http.headers.sec_fetch_mode", req, "sec-fetch-mode");
  pushHeaderObservation(out, "http.headers.sec_fetch_user", req, "sec-fetch-user");
  pushHeaderObservation(out, "http.headers.sec_fetch_dest", req, "sec-fetch-dest");
  const fetchMetadataCount = ["sec-fetch-site", "sec-fetch-mode", "sec-fetch-user", "sec-fetch-dest"].filter((h) => req.headers[h] !== undefined).length;
  out.push(observed("http.fetch_metadata_present", "http", "server", "http_header_presence", fetchMetadataCount > 0, { count: fetchMetadataCount }));

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
