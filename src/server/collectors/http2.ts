import type { IncomingMessage } from "node:http";
import type { Http2ServerRequest } from "node:http2";
import type { Observation } from "../../shared/schema/types.js";
import { observed, notApplicable, unavailable } from "../../shared/schema/types.js";

export function collectHttp2(req: IncomingMessage): Observation[] {
  const out: Observation[] = [];

  if (!req.httpVersion.startsWith("2")) {
    out.push(notApplicable("http2.settings", "http2", "server", "http2_session"));
    out.push(notApplicable("http2.stream_id", "http2", "server", "http2_session"));
    out.push(notApplicable("http2.pseudo_header_order", "http2", "server", "http2_session"));
    return out;
  }

  const h2req = req as unknown as Http2ServerRequest;
  const session = h2req.stream.session;
  if (session) {
    out.push(
      observed("http2.settings", "http2", "server", "http2_remote_settings", session.remoteSettings ?? {}),
    );
  } else {
    out.push(unavailable("http2.settings", "http2", "server", "http2_remote_settings"));
  }

  out.push(observed("http2.stream_id", "http2", "server", "http2_stream", h2req.stream.id ?? null));

  // Node's http2 compat API strips pseudo-headers (:method, :path, :scheme, :authority) into
  // req.method/req.url before user code runs, and does not expose the HEADERS frame's field
  // order. See docs/ARCHITECTURE.md.
  out.push(unavailable("http2.pseudo_header_order", "http2", "server", "http2_compat_api_limitation"));

  return out;
}
