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

  "derived.client_signature": {
    title: "Client signature (self-identified)",
    description:
      "The User-Agent matched against a curated table of tokens that AI agents, crawlers, HTTP libraries, CLI tools and headless browsers use to identify themselves (OpenAI's GPTBot/ChatGPT-User, Anthropic's ClaudeBot/Claude-User, Perplexity, Googlebot, python-requests, Go-http-client, curl, HeadlessChrome, …).",
    whyItMatters:
      "Most legitimate automated clients announce themselves, and their operators document the token and often the IP ranges it comes from. For a site operator this is the cheapest first-pass classification of automated traffic; for an agent developer it shows exactly what your tool is telling every site it visits.",
    caveats:
      "Entirely self-reported. Any client can send any token, and a client that sends none tells you nothing. Browser-driving agents (Operator-style, computer-use, 'Claude in Chrome') run a real browser and typically carry a normal browser User-Agent — they do not appear here.",
    references: [
      { title: "OpenAI: Overview of OpenAI crawlers", url: "https://platform.openai.com/docs/bots" },
      { title: "Anthropic: web crawler documentation", url: "https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler" },
    ],
  },
  "network.client_ip": {
    title: "Client IP (deployment's best notion)",
    description:
      "The address this deployment treats as the client. Equal to the TCP peer unless a trusted reverse proxy is configured, in which case it comes from X-Forwarded-For or a platform header — the collection method says which.",
    whyItMatters: "The IP is the oldest network-level identifier and the key for rate limits, reputation lists and ASN/geo lookups.",
    caveats: "Behind a proxy the TCP peer is the proxy; trusting forwarded headers from anyone else lets clients choose their own 'IP'.",
  },
  "network.client_ip_class": {
    title: "IP address class",
    description: "Structural classification of the client address against the IANA special-purpose registries: loopback, private (RFC 1918), link-local, shared/CGNAT (RFC 6598), unique-local, documentation, or public; plus IPv4-mapped and transition-address notes.",
    whyItMatters: "Tells you whether the address can be meaningfully looked up or rate-limited at all. A CGNAT address, for instance, is shared by many subscribers.",
    references: [{ title: "RFC 6890: Special-Purpose IP Address Registries", url: "https://www.rfc-editor.org/rfc/rfc6890" }],
  },
  "network.asn": {
    title: "Autonomous System (network owner)",
    description: "The AS number, registration country and organisation name that announce the client's IP range, from an offline copy of the public-domain iptoasn.com table (when configured).",
    whyItMatters:
      "Whether traffic comes from a residential ISP, a mobile carrier, a hosting/cloud provider or a VPN exit is one of the strongest coarse signals bot-detection systems use — most scripted traffic originates in data-center ASNs.",
    caveats: "The country is where the AS is registered, not where the user is. No geolocation database is used by this project.",
    references: [{ title: "iptoasn.com", url: "https://iptoasn.com/" }],
  },
  "network.reverse_dns": {
    title: "Reverse DNS (PTR)",
    description: "The hostname(s) the owner of the client IP published for it in reverse DNS.",
    whyItMatters: "Cloud providers, ISPs and crawler operators follow recognizable naming conventions (e.g. crawl-66-249-66-1.googlebot.com), and verified crawlers are confirmed by forward-confirming the PTR name.",
    caveats: "Controlled by whoever owns the address block; absent for most residential and many cloud addresses; only the forward-confirmed form is trustworthy.",
  },
  "http.header_order": {
    title: "HTTP header order",
    description: "The names of the request headers in the exact order they were sent (HEADERS-frame order for HTTP/2).",
    whyItMatters:
      "Each HTTP stack emits headers in its own fixed order. Chrome, Firefox, Safari, curl, Go and Python all differ, and a script that copies a browser's header *values* rarely reproduces the *order* — which is why header order features in most commercial bot-detection products.",
    caveats: "Proxies and CDNs frequently re-serialize requests and change the order; behind one, this reflects the proxy's stack.",
  },
  "http.header_casing": {
    title: "HTTP/1.1 header-name casing",
    description: "Whether header names were sent Title-Cased, all-lowercase, or mixed. HTTP/2 mandates lowercase, so this exists only for HTTP/1.x.",
    whyItMatters: "Another cheap stack tell: browsers Title-Case on HTTP/1.1, a few libraries and most h2-to-h1 proxies lowercase.",
  },
  "http.accept_encoding_tokens": {
    title: "Accept-Encoding tokens",
    description: "The compression algorithms the client says it can decode.",
    whyItMatters: "`br` (Brotli) and especially `zstd` are advertised by current browsers but not by most HTTP libraries' defaults; the exact set and order is a stack signature.",
  },
  "http.fetch_metadata_present": {
    title: "Fetch Metadata headers present",
    description: "Whether any Sec-Fetch-Site / Mode / User / Dest headers were sent.",
    whyItMatters: "Browsers attach these automatically to every request and non-browser clients almost never do, making them one of the simplest browser-vs-script separators available server-side.",
    references: [{ title: "W3C Fetch Metadata Request Headers", url: "https://www.w3.org/TR/fetch-metadata/" }],
  },
  "http.headers.priority": {
    title: "Priority header (RFC 9218)",
    description: "The extensible-priorities request header (`u=` urgency, `i` incremental).",
    whyItMatters: "Sent by Chromium and Firefox on navigations; absent from scripts unless deliberately added.",
    references: [{ title: "RFC 9218: Extensible Prioritization Scheme for HTTP", url: "https://www.rfc-editor.org/rfc/rfc9218" }],
  },
  "http2.settings": {
    title: "HTTP/2 SETTINGS values",
    description: "The connection-level parameters the client announced in its SETTINGS frame (header table size, push, concurrent streams, initial window, max frame size, max header list size).",
    whyItMatters:
      "These come from the client's HTTP/2 library, not from per-request code, and the default values differ between Chrome, Firefox, Safari, Go, curl/nghttp2 and others — the basis of Akamai's HTTP/2 fingerprinting.",
    caveats: "Node exposes the values but not the order of settings within the frame, nor WINDOW_UPDATE increments, so the Akamai fingerprint can only be partially reproduced here.",
    references: [{ title: "Akamai: Passive Fingerprinting of HTTP/2 Clients", url: "https://www.blackhat.com/docs/eu-17/materials/eu-17-Shuster-Passive-Fingerprinting-Of-HTTP2-Clients-wp.pdf" }],
  },
  "http2.pseudo_header_order": {
    title: "HTTP/2 pseudo-header order",
    description: "The order of :method, :authority, :scheme and :path in the HEADERS frame, abbreviated m/a/s/p.",
    whyItMatters: "Chromium sends m,a,s,p; Firefox m,p,a,s; Safari m,s,p,a; Go's net/http m,p,a,s — fixed per implementation and almost never spoofed by header-copying scripts.",
  },
  "http2.fingerprint_partial": {
    title: "Akamai-style HTTP/2 fingerprint (partial)",
    description: "SETTINGS | WINDOW_UPDATE | PRIORITY | pseudo-header-order, in the format Akamai popularized. Components Node cannot expose are written as '?' rather than guessed.",
    whyItMatters: "A compact string that separates browser families and h2 libraries even when HTTP headers are perfectly spoofed.",
    caveats: "Partial: settings order and WINDOW_UPDATE are unavailable through Node's http2 module.",
  },
  "tls.clienthello.grease": {
    title: "GREASE values in the ClientHello",
    description: "Reserved placeholder values (RFC 8701) that some TLS stacks sprinkle into their cipher, extension, group and version lists to keep servers tolerant of unknown values.",
    whyItMatters: "Chromium (BoringSSL) has sent GREASE since 2016 and Firefox since 2021; OpenSSL-based clients (Python, curl by default, Node) and Go do not. Presence or absence therefore says a lot about the TLS library regardless of the User-Agent.",
    references: [{ title: "RFC 8701: GREASE", url: "https://www.rfc-editor.org/rfc/rfc8701" }],
  },
  "tls.clienthello.extensions": {
    title: "TLS extensions offered",
    description: "The extension types in the ClientHello, in wire order, with IANA names.",
    whyItMatters: "The set of extensions (and for some stacks their order) is the most library-specific part of the handshake. Chrome randomizes extension order since v110 specifically to defeat naive JA3 matching — JA4 sorts them for that reason.",
    references: [{ title: "IANA TLS ExtensionType Values", url: "https://www.iana.org/assignments/tls-extensiontype-values/" }],
  },
  "tls.clienthello.key_share_groups": {
    title: "key_share groups",
    description: "The key-exchange groups the client pre-generated key shares for (TLS 1.3).",
    whyItMatters: "Chrome and Firefox now send a post-quantum hybrid (X25519MLKEM768) share first; most libraries still send only x25519 or secp256r1. Hard to fake without the right library.",
  },
  "tls.clienthello.supported_versions": {
    title: "supported_versions",
    description: "The TLS versions the client is willing to negotiate (TLS 1.3's replacement for the legacy_version field).",
    whyItMatters: "Every modern browser offers TLS 1.3 first; its absence indicates an older or minimal stack.",
  },
  "tls.clienthello.ech_present": {
    title: "Encrypted Client Hello extension present",
    description: "Whether the client attached an encrypted_client_hello extension (even a GREASE one).",
    whyItMatters: "Chrome and Firefox send a GREASE ECH extension on every connection; almost no library does yet.",
  },
  "tls.clienthello.alps_present": {
    title: "ALPS extension present",
    description: "Application-Layer Protocol Settings, a Chromium-specific extension carrying h2 settings in the handshake.",
    whyItMatters: "Currently a near-unique Chromium marker.",
  },
  "tls.clienthello.raw_hex": {
    title: "Raw ClientHello bytes",
    description: "The exact bytes of the TLS record containing the ClientHello, as hex.",
    whyItMatters: "Lets you verify every parsed field above against the wire, or feed the handshake into another JA3/JA4 implementation.",
  },
  "tls.session_reused": {
    title: "TLS session resumed",
    description: "Whether this connection resumed a previous TLS session (session ticket / PSK) instead of doing a full handshake.",
    whyItMatters: "Resumption behaviour differs between stacks, and resumed handshakes carry a pre_shared_key extension that changes JA3/JA4.",
  },
  // --- behavior page (POST /api/v1/behavior); see src/server/behavior/ ---
  "behavior.events.untrusted": {
    title: "Untrusted input events",
    description: "Count of mouse/key/input events whose isTrusted flag was false.",
    whyItMatters: "A script or test driver created them; browsers report real hardware input as trusted.",
    caveats: "Input injected through the DevTools protocol (Playwright, Puppeteer, computer-use agents) is trusted, so zero proves nothing.",
  },
  "behavior.keys.programmatic_inputs": {
    title: "Fields changed without causing input",
    description: "Input/change events on a field with no key press (typed text) or click/key/touch (select, checkbox) on that field just before.",
    whyItMatters: "Setting a value directly (Playwright fill, DOM writes, form-fill APIs) skips the events a person generates. It was one of the strongest agent tells in FP-Agent.",
    caveats: "Password managers and browser autofill also set values without typing.",
  },
  "behavior.mouse.teleport_clicks": {
    title: "Clicks with no approach path",
    description: "Mouse clicks preceded by at most one mousemove in the previous 400 ms (touch taps excluded).",
    whyItMatters: "People steer the pointer to a target. Many agents jump the cursor and click, producing a single mousemove then mousedown/mouseup.",
    caveats: "Keyboard users and assistive technology click without a pointer path.",
  },
  "behavior.mouse.clicks": {
    title: "Pointer clicks",
    description: "Number of mouse button presses, excluding taps on a touch screen.",
    whyItMatters: "Denominator for teleport_clicks.",
  },
  "behavior.mouse.moves": {
    title: "Mouse movement samples",
    description: "Number of mousemove events kept (samples closer than 8 ms apart are dropped).",
    whyItMatters: "Touch-only and keyboard-only visitors have none.",
  },
  "behavior.mouse.curvature_angle_range_deg": {
    title: "Spread of turning angles in mouse paths",
    description: "Difference between the most extreme left and right turn between consecutive mouse samples, in degrees.",
    whyItMatters: "Hand movement wobbles and corrects; synthetic paths are straight or smooth Bezier curves. Angle-of-curvature range was the second most discriminative feature in FP-Agent.",
    caveats: "Needs at least 5 turning angles; trackpads and touch differ from mice.",
  },
  "behavior.mouse.straightness": {
    title: "Mouse path straightness",
    description: "Mean of straight-line distance divided by path length for longer movements (1.0 = perfect ruler line).",
    whyItMatters: "Scripted movement is often a straight interpolation.",
    caveats: "Short, fast flicks of a real mouse can also be nearly straight.",
  },
  "behavior.mouse.velocity_cv": {
    title: "Pointer speed variation",
    description: "Standard deviation of pointer speed divided by its mean.",
    whyItMatters: "Humans accelerate and decelerate; linear interpolation moves at constant speed.",
    caveats: "Needs 10+ speed samples.",
  },
  "behavior.keys.chars": {
    title: "Character keys pressed",
    description: "Number of keydown events for printable characters. Which keys is never recorded.",
    whyItMatters: "Context for the typing-rhythm measures.",
  },
  "behavior.keys.paste_count": {
    title: "Paste events",
    description: "Number of paste events (or insertFromPaste/insertFromDrop inputs).",
    whyItMatters: "Pasting was the top-ranked feature separating agents from people in FP-Agent: several agents paste whole values.",
    caveats: "People paste too, especially passwords and addresses.",
  },
  "behavior.keys.hold_median_ms": {
    title: "Key hold time (median)",
    description: "How long a key stays down before release, measured in the browser.",
    whyItMatters: "Physical keys are held for tens of milliseconds; synthetic keystrokes can be released in under a millisecond.",
    caveats: "Needs 3+ character keys.",
  },
  "behavior.keys.interkey_median_ms": {
    title: "Time between keystrokes (median)",
    description: "Median gap between consecutive character keydowns in the same field.",
    whyItMatters: "Fast human typing is roughly 60-150 ms between keys; some agents send keys 1-5 ms apart.",
    caveats: "Autocomplete and text expanders can compress human typing.",
  },
  "behavior.keys.interkey_stdev_ms": {
    title: "Keystroke spacing variation",
    description: "Standard deviation of the gaps between keystrokes.",
    whyItMatters: "Human rhythm varies with finger travel and letter pairs; a fixed delay does not.",
    caveats: "Needs 3+ gaps.",
  },
  "behavior.keys.corrections": {
    title: "Backspace/Delete presses",
    description: "Count of correction keys.",
    whyItMatters: "People make and fix typos.",
    caveats: "Absence proves nothing for a short phrase.",
  },
  "behavior.keys.dangling_keydowns": {
    title: "Key presses never released",
    description: "keydown events with no matching keyup.",
    whyItMatters: "Synthetic key events are sometimes sent as unpaired events.",
    caveats: "A key still held when the form was submitted counts.",
  },
  "behavior.keys.dangling_keyups": {
    title: "Key releases never pressed",
    description: "keyup events with no matching keydown.",
    whyItMatters: "Another sign of synthetic or partial key event streams.",
    caveats: "Focus changes mid-press can cause it.",
  },
  "behavior.scroll.events": {
    title: "Scroll events",
    description: "Number of scroll events on the page or inside the notice box.",
    whyItMatters: "Context for the other behavior signals.",
  },
  "behavior.scroll.without_input": {
    title: "Scrolls with no input",
    description: "Scroll events with no wheel, touch, key or scrollbar-drag input just before them.",
    whyItMatters: "scrollTo(), scrollIntoView and DevTools-protocol scrolls move the page without a gesture.",
    caveats: "Touch scrolling coasts after the finger lifts, so any trace with a touch is not counted.",
  },
  "behavior.scroll.without_input_share": {
    title: "Share of scrolling with no input",
    description: "Fraction of all scroll events that had no wheel, touch, key or scrollbar-drag input around them.",
    whyItMatters: "A few unexplained events are normal (momentum tails, browser-initiated scrolls); scripted scrolling is unexplained almost throughout, so the share separates the two.",
    caveats: "Browser-initiated scrolls (focus scrolling into view, find-in-page) count as unexplained too.",
  },
  "behavior.scroll.instant_jumps": {
    title: "Instant scroll jumps",
    description: "Scroll bursts that moved 200+ px within 20 ms.",
    whyItMatters: "Wheel and touch scrolling are animated across many frames; Playwright's default element scrolling is instant.",
    caveats: "Keyboard End/Home or a jump link can also jump.",
  },
  "behavior.scroll.gradual_bursts": {
    title: "Gradual scroll bursts",
    description: "Scroll bursts with 5+ events over 100+ ms.",
    whyItMatters: "What an animated wheel or touch scroll looks like.",
  },
  "behavior.scroll.distance_stdev": {
    title: "Variation in scroll distance",
    description: "Standard deviation of distance moved per scroll burst.",
    whyItMatters: "Humans scroll irregular distances; automation tends to scroll a fixed step.",
    caveats: "Needs 2+ bursts.",
  },
  "behavior.timing.actions": {
    title: "Deliberate actions",
    description: "Clicks, pastes, changes and the first key pressed in each field.",
    whyItMatters: "Used to measure pace.",
  },
  "behavior.timing.action_gap_median_ms": {
    title: "Time between actions (median)",
    description: "Median time between consecutive deliberate actions.",
    whyItMatters: "Automation frameworks chain steps within tens of milliseconds, while people take seconds; LLM agents show model-round-trip pauses.",
    caveats: "Needs 4+ actions.",
  },
  "behavior.events.interactions": {
    title: "Interaction events",
    description: "Clicks, key presses, inputs, changes, pastes and scrolls.",
    whyItMatters: "If there are fewer than three, no verdict is attempted.",
  },
  "behavior.events.total": {
    title: "Events recorded",
    description: "Total events in the trace, capped at 5,000.",
    whyItMatters: "Context for the other behavior signals.",
  },
  "behavior.events.duration_ms": {
    title: "Trace duration",
    description: "Time from the first to the last event.",
    whyItMatters: "Forms completed in a couple of seconds are not human.",
  },
};
