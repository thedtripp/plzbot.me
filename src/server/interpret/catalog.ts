/**
 * Static, per-signal educational metadata. Deliberately separate from the runtime
 * Observation/DerivedAttribute objects (see docs/SCHEMA.md) — this is documentation content,
 * looked up by id, not re-sent on every fingerprint. The frontend (Phase 5) fetches this via
 * GET /api/v1/signals to annotate whatever ids appear in a given fingerprint.
 *
 * Entries are added incrementally alongside the collectors that produce the ids they describe;
 * an id with no catalog entry is not an error (see docs/SCHEMA.md "Extensibility rules") — it
 * just won't have rendered documentation yet, which the frontend handles gracefully.
 */

export interface CatalogEntry {
  title: string;
  description: string;
  whyItMatters: string;
  caveats?: string;
  references?: { title: string; url: string }[];
}

export const SIGNAL_CATALOG: Record<string, CatalogEntry> = {
  "http.headers.user_agent": {
    title: "User-Agent header",
    description:
      "A string the client sends describing itself — traditionally browser/engine/OS/device, though the format is not enforced and any client can send any value.",
    whyItMatters:
      "Historically the primary browser-identification signal; still widely used as a first-pass client classifier and as an input to cross-signal consistency checks.",
    caveats:
      "Entirely client-supplied and trivially spoofed. Chromium browsers are progressively 'freezing' this header's version/platform detail in favor of Client Hints, specifically because of its fingerprinting/spoofing history.",
    references: [
      { title: "MDN: User-Agent header", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/User-Agent" },
      { title: "Chromium: reducing User-Agent granularity", url: "https://www.chromium.org/updates/ua-reduction/" },
    ],
  },
  "client_hints.sec_ch_ua": {
    title: "Sec-CH-UA (User-Agent Client Hint, low entropy)",
    description:
      "A structured, opt-in replacement for parts of the User-Agent string: a list of {brand, significant version} pairs, sent automatically by supporting browsers on every request.",
    whyItMatters:
      "Designed explicitly to be lower-entropy and more honest than User-Agent (browsers intentionally include 'greased' fake brands to prevent naive parsing), while still useful for coarse client classification.",
    caveats: "Client-supplied like any header; only sent by Chromium-family browsers as of this writing.",
    references: [{ title: "W3C User-Agent Client Hints", url: "https://wicg.github.io/ua-client-hints/" }],
  },
  "tls.clienthello.cipher_suites": {
    title: "TLS ClientHello cipher suite list",
    description:
      "The ordered list of cipher suites the client offered during the TLS handshake, captured from the raw ClientHello before Node's TLS engine processes it.",
    whyItMatters:
      "The specific set and order of ciphers/extensions a TLS library offers is characteristic of that library and its configuration — this is the basis of JA3/JA4 fingerprinting, and it is much harder for a script to spoof than an HTTP header, since it's produced by the underlying TLS stack rather than application code.",
    caveats:
      "Only observable because this app terminates TLS itself — see docs/TLS_CAPTURE.md. Some clients (e.g. some Chromium versions) randomize extension order specifically to resist naive JA3 matching.",
    references: [
      { title: "RFC 8446 §4.1.2 TLS 1.3 ClientHello", url: "https://www.rfc-editor.org/rfc/rfc8446#section-4.1.2" },
    ],
  },
  "derived.ja3_hash": {
    title: "JA3 hash",
    description: "An MD5 hash of five ClientHello-derived fields, computed by this server from the raw handshake.",
    whyItMatters:
      "A compact way to compare TLS client fingerprints across requests; widely used in network security tooling to identify the TLS library/version/config a client is using, independent of what its HTTP headers claim.",
    caveats:
      "A computed/derived value, not something the client sent directly — see docs/SCHEMA.md on the Observation vs DerivedAttribute distinction. Collisions are possible between unrelated clients with coincidentally identical handshake shapes.",
    references: [
      {
        title: "Salesforce Engineering: TLS Fingerprinting with JA3 and JA3S",
        url: "https://engineering.salesforce.com/tls-fingerprinting-with-ja3-and-ja3s-247362855967/",
      },
    ],
  },
  "derived.ja4": {
    title: "JA4 fingerprint",
    description:
      "FoxIO's successor to JA3: a partly human-readable, partly SHA-256-hashed summary of the ClientHello.",
    whyItMatters:
      "Addresses several JA3 weaknesses (see src/server/tls-capture/ja4.ts) — notably separating SNI/ALPN out of the hashed portion and using sorted rather than raw-order cipher/extension lists for the hashed segments, which makes it more stable across otherwise-identical clients that happen to request different hostnames.",
    caveats: "This project's JA4 implementation is best-effort against the published spec; see ja4.ts for details.",
    references: [
      { title: "FoxIO JA4 specification", url: "https://github.com/FoxIO-LLC/ja4/blob/main/technical_details/JA4.md" },
    ],
  },
  "http.header_order": {
    title: "HTTP header order",
    description: "The order in which the client sent its request headers, preserved from the raw wire bytes.",
    whyItMatters:
      "Different HTTP client libraries and browser versions order headers differently and fairly consistently; combined with the header *set* itself, order is a lightweight extra signal for distinguishing client implementations.",
    caveats: "Only available for HTTP/1.1 in this app's current implementation — see docs/ARCHITECTURE.md.",
  },
  "browser.automation.navigator_webdriver": {
    title: "navigator.webdriver",
    description:
      "A boolean the browser sets to true when it is under WebDriver (automation) control, per the WebDriver specification.",
    whyItMatters:
      "A first-party signal produced by the browser engine itself, not something the page's own script chose to send — considerably harder to spoof convincingly than a header, though not impossible (e.g. by patching the browser binary or overriding the property before page scripts run).",
    caveats: "Some automation setups explicitly patch this property back to false/undefined to evade detection.",
    references: [{ title: "W3C WebDriver: navigator.webdriver", url: "https://www.w3.org/TR/webdriver2/#interface" }],
  },
  "browser.graphics.canvas_hash": {
    title: "Canvas rendering hash",
    description: "A hash of pixel data produced by drawing fixed text/shapes to a hidden <canvas> and reading it back.",
    whyItMatters:
      "GPU, driver, OS font rasterizer, and anti-aliasing differences produce measurably different pixels for identical drawing instructions — a classic, well-studied high-entropy fingerprinting signal.",
    caveats: "Some privacy-focused browsers/extensions intentionally add noise to canvas output specifically to defeat this.",
    references: [{ title: "EFF Cover Your Tracks", url: "https://coveryourtracks.eff.org/" }],
  },
  "browser.graphics.webgl_renderer": {
    title: "WebGL renderer string",
    description: "The GPU vendor/renderer string exposed via the WEBGL_debug_renderer_info extension.",
    whyItMatters: "Directly identifies GPU hardware/driver stack, a meaningfully high-entropy signal on its own.",
    caveats: "Some browsers mask this behind a generic ANGLE string by default for privacy reasons.",
  },
  "browser.audio.fingerprint_hash": {
    title: "AudioContext fingerprint",
    description: "A hash of samples produced by rendering a signal through an OfflineAudioContext DSP chain (never played aloud).",
    whyItMatters: "Floating-point DSP implementation differences across audio stacks/hardware produce a per-machine-characteristic, deterministic output.",
    references: [
      { title: "MDN: OfflineAudioContext", url: "https://developer.mozilla.org/en-US/docs/Web/API/OfflineAudioContext" },
    ],
  },
  "browser.fonts.detected": {
    title: "Detected installed fonts",
    description: "Fonts inferred as installed via canvas text-metrics comparison against generic fallback fonts.",
    whyItMatters: "The specific set of installed fonts varies a lot across machines/OSes and is a historically high-entropy fingerprinting signal.",
    caveats: "This is a detection technique against a fixed candidate list, not a full enumeration of every installed font — browsers deliberately don't expose that.",
  },
  "browser.navigator.ua_data_high_entropy": {
    title: "High-entropy Client Hints",
    description: "Detailed platform/version/architecture values obtained via navigator.userAgentData.getHighEntropyValues().",
    whyItMatters: "Provides precise version/platform detail without relying on the (increasingly frozen) traditional User-Agent string.",
    caveats: "Requires an explicit async call and is only available in Chromium-family browsers.",
    references: [{ title: "MDN: getHighEntropyValues()", url: "https://developer.mozilla.org/en-US/docs/Web/API/NavigatorUAData/getHighEntropyValues" }],
  },
  "network.x_forwarded_for": {
    title: "X-Forwarded-For header",
    description: "A de facto standard header proxies use to record the original client IP address of a request.",
    whyItMatters: "Can reveal the real client IP when a trusted proxy sets it correctly.",
    caveats:
      "Entirely client-suppliable when there is no trusted proxy in front of the app — any client can send an arbitrary value. This app never trusts it to override the directly-observed TCP peer address.",
    references: [{ title: "MDN: X-Forwarded-For", url: "https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/X-Forwarded-For" }],
  },
};
