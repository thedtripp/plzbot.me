import type { IncomingMessage } from "node:http";
import type { Http2ServerRequest } from "node:http2";
import type { Observation } from "../../shared/schema/types.js";
import { observed, notApplicable, unavailable } from "../../shared/schema/types.js";

/** SETTINGS identifiers from RFC 9113 §6.5.2, in the order Node's remoteSettings exposes them. */
const SETTINGS_IDS: Array<[keyof import("node:http2").Settings, number]> = [
  ["headerTableSize", 1],
  ["enablePush", 2],
  ["maxConcurrentStreams", 3],
  ["initialWindowSize", 4],
  ["maxFrameSize", 5],
  ["maxHeaderListSize", 6],
  ["enableConnectProtocol", 8],
];

const NOT_APPLICABLE_IDS = [
  "http2.settings",
  "http2.stream_id",
  "http2.pseudo_header_order",
  "http2.header_order",
  "http2.stream_priority",
  "http2.connection_window",
  "http2.fingerprint_partial",
];

export function collectHttp2(req: IncomingMessage): Observation[] {
  const out: Observation[] = [];

  if (!req.httpVersion.startsWith("2")) {
    for (const id of NOT_APPLICABLE_IDS) out.push(notApplicable(id, "http2", "server", "http2_session"));
    return out;
  }

  const h2req = req as unknown as Http2ServerRequest;
  const session = h2req.stream.session;
  const settings = session?.remoteSettings;
  if (settings) {
    // Node reports the *values* the peer sent in its SETTINGS frame(s) (merged with defaults)
    // but not the order of the settings within the frame, so the order component of an
    // Akamai-style HTTP/2 fingerprint can't be reproduced exactly; see fingerprint_partial.
    out.push(observed("http2.settings", "http2", "server", "http2_remote_settings_values_only", settings));
  } else {
    out.push(unavailable("http2.settings", "http2", "server", "http2_remote_settings_values_only"));
  }

  out.push(observed("http2.stream_id", "http2", "server", "http2_stream", h2req.stream.id ?? null));

  // Node's http2 compat layer keeps rawHeaders in HEADERS-frame order *including* the
  // pseudo-headers, so both orders are observable (verified empirically; earlier versions of
  // this project assumed otherwise and reported them unavailable).
  const names: string[] = [];
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    const n = req.rawHeaders[i];
    if (n !== undefined) names.push(n);
  }
  const pseudo = names.filter((n) => n.startsWith(":"));
  const regular = names.filter((n) => !n.startsWith(":"));
  out.push(
    observed("http2.pseudo_header_order", "http2", "server", "http2_headers_frame_order", pseudo, pseudo.map((p) => p.slice(1, 2)).join(",")),
  );
  out.push(observed("http2.header_order", "http2", "server", "http2_headers_frame_order", regular));

  const state = h2req.stream.state;
  const priority = {
    weight: state.weight ?? null,
    sumDependencyWeight: state.sumDependencyWeight ?? null,
    // Node does not expose the stream dependency / exclusive flag from the HEADERS frame.
    dependency: null,
    exclusive: null,
  };
  out.push(observed("http2.stream_priority", "http2", "server", "http2_stream_state_partial", priority));

  const sessionState = session?.state;
  if (sessionState) {
    out.push(
      observed("http2.connection_window", "http2", "server", "http2_session_state", {
        remoteWindowSize: sessionState.remoteWindowSize ?? null,
        localWindowSize: sessionState.localWindowSize ?? null,
        effectiveLocalWindowSize: sessionState.effectiveLocalWindowSize ?? null,
      }),
    );
  } else {
    out.push(unavailable("http2.connection_window", "http2", "server", "http2_session_state"));
  }

  // Akamai-style HTTP/2 fingerprint: SETTINGS | WINDOW_UPDATE | PRIORITY | pseudo-header order.
  // (Akamai, "Passive Fingerprinting of HTTP/2 Clients", 2017.) Node gives us settings values
  // (not frame order), no WINDOW_UPDATE increments, and only the stream weight for PRIORITY, so
  // this is explicitly a *partial* reproduction — the missing components are written as "?"
  // rather than guessed. Still useful: the settings values + pseudo-header order alone separate
  // Chrome / Firefox / Safari / Go / curl in practice.
  if (settings) {
    const settingsPart = SETTINGS_IDS.filter(([k]) => settings[k] !== undefined)
      .map(([k, id]) => `${id}:${typeof settings[k] === "boolean" ? (settings[k] ? 1 : 0) : settings[k]}`)
      .join(";");
    const priorityPart = state.weight !== undefined ? `1:?:?:${state.weight}` : "?";
    const fp = `${settingsPart}|?|${priorityPart}|${pseudo.map((p) => p.slice(1, 2)).join(",")}`;
    out.push(
      observed("http2.fingerprint_partial", "http2", "server", "akamai_h2_fingerprint_partial", fp, {
        settings: settingsPart,
        windowUpdate: "unavailable",
        priority: priorityPart,
        pseudoHeaderOrder: pseudo.map((p) => p.slice(1, 2)).join(","),
      }),
    );
  } else {
    out.push(unavailable("http2.fingerprint_partial", "http2", "server", "akamai_h2_fingerprint_partial"));
  }

  return out;
}
