import type { Assessment, Fingerprint } from "../../../shared/schema/types.js";
import { derivedValue, findObservation, observedValue } from "../lookup.js";

/**
 * Transport-layer consistency: does the TLS handshake and HTTP/2 behaviour match the browser
 * the User-Agent claims? These are the checks that make header spoofing insufficient — a
 * Python script can send Chrome's User-Agent, but its TLS stack (OpenSSL) and h2 library will
 * still handshake like Python unless the author goes to real lengths (curl-impersonate,
 * tls-client, …). Each rule only fires when both halves of the comparison were observed.
 */
export function transportRules(fp: Fingerprint): Assessment[] {
  const out: Assessment[] = [];
  const family = derivedValue<string | null>(fp, "derived.ua_browser_family_guess") ?? null;
  const claimsChromium = family === "Chrome" || family === "Chromium" || family === "Edge (Chromium)" || family === "Opera (Chromium)";
  const claimsFirefox = family === "Firefox";
  const claimsSafari = family === "Safari";
  const claimsBrowser = claimsChromium || claimsFirefox || claimsSafari;

  const greaseObs = findObservation(fp, "tls.clienthello.grease");
  const greasePresent = greaseObs?.status === "observed" ? (greaseObs.normalized as boolean) : null;
  const supportedVersions = observedValue<string[]>(fp, "tls.clienthello.supported_versions");
  const alpnOffered = observedValue<string[]>(fp, "tls.clienthello.alpn_offered");
  const tlsObserved = findObservation(fp, "tls.clienthello.cipher_suites")?.status === "observed";

  if (claimsChromium && greasePresent === false) {
    out.push({
      id: "transport.chromium_ua_without_grease",
      category: "consistency",
      title: "Claims Chrome, but the TLS handshake has no GREASE values",
      statement:
        "Every Chromium-based browser has inserted GREASE (RFC 8701) placeholder values into its ClientHello cipher, extension and group lists since Chrome 55 (2016). This handshake contains none, which is characteristic of OpenSSL-, Go- or Java-based clients rather than Chrome's BoringSSL. The TLS stack and the User-Agent disagree; the TLS stack is the harder one to fake.",
      confidence: "high",
      conflicting: true,
      evidence: { observationIds: ["http.headers.user_agent", "tls.clienthello.grease"], derivedIds: ["derived.ua_browser_family_guess", "derived.ja4"] },
      references: [{ title: "RFC 8701: GREASE", url: "https://www.rfc-editor.org/rfc/rfc8701" }],
    });
  }

  if (claimsBrowser && tlsObserved && supportedVersions && !supportedVersions.some((v) => v === "TLS 1.3")) {
    out.push({
      id: "transport.browser_ua_without_tls13",
      category: "consistency",
      title: `Claims ${family}, but does not offer TLS 1.3`,
      statement: `Chrome, Firefox and Safari have all offered TLS 1.3 by default since 2018–2019, so a modern-looking ${family} User-Agent paired with a ClientHello that lacks a supported_versions entry for TLS 1.3 points to a different (older or non-browser) TLS stack.`,
      confidence: "medium",
      conflicting: true,
      evidence: { observationIds: ["http.headers.user_agent", "tls.clienthello.supported_versions"], derivedIds: ["derived.ua_browser_family_guess"] },
    });
  }

  if (claimsBrowser && alpnOffered && alpnOffered.length > 0 && !alpnOffered.includes("h2")) {
    out.push({
      id: "transport.browser_ua_without_h2_alpn",
      category: "consistency",
      title: `Claims ${family}, but did not offer HTTP/2 in ALPN`,
      statement: `All current desktop and mobile browsers advertise "h2" in the TLS ALPN extension. This client offered only ${alpnOffered.join(", ")}.`,
      confidence: "medium",
      conflicting: true,
      evidence: { observationIds: ["http.headers.user_agent", "tls.clienthello.alpn_offered"], derivedIds: ["derived.ua_browser_family_guess"] },
    });
  }

  if (claimsBrowser && tlsObserved && alpnOffered && alpnOffered.length === 0) {
    out.push({
      id: "transport.browser_ua_without_alpn",
      category: "consistency",
      title: `Claims ${family}, but sent no ALPN extension at all`,
      statement: "Browsers always negotiate the application protocol via ALPN; a handshake with no ALPN extension is typical of minimal TLS clients and some libraries' defaults.",
      confidence: "medium",
      conflicting: true,
      evidence: { observationIds: ["http.headers.user_agent", "tls.clienthello.alpn_offered"], derivedIds: ["derived.ua_browser_family_guess"] },
    });
  }

  // HTTP/2 SETTINGS values. Chrome's and Firefox's defaults are stable and widely published
  // (Akamai 2017 paper, and both browsers' source). Only the values are compared — Node does
  // not expose frame order — and only when the request actually arrived over HTTP/2.
  const settings = observedValue<Record<string, number | boolean>>(fp, "http2.settings");
  if (settings && fp.request.httpVersion.startsWith("2")) {
    if (claimsChromium) {
      const looksLikeChrome = settings.headerTableSize === 65536 && settings.enablePush === false && settings.initialWindowSize === 6291456 && settings.maxHeaderListSize === 262144;
      out.push(
        looksLikeChrome
          ? {
              id: "transport.h2_settings_match_chromium",
              category: "consistency",
              title: "HTTP/2 SETTINGS match Chromium's defaults",
              statement: "HEADER_TABLE_SIZE=65536, ENABLE_PUSH=0, INITIAL_WINDOW_SIZE=6291456 and MAX_HEADER_LIST_SIZE=262144 are exactly the values Chromium sends in its first SETTINGS frame, consistent with the User-Agent.",
              confidence: "informational",
              evidence: { observationIds: ["http2.settings", "http.headers.user_agent"], derivedIds: ["derived.ua_browser_family_guess"] },
            }
          : {
              id: "transport.h2_settings_mismatch_chromium",
              category: "consistency",
              title: "Claims Chrome, but HTTP/2 SETTINGS are not Chromium's",
              statement: `Chromium sends HEADER_TABLE_SIZE=65536, ENABLE_PUSH=0, INITIAL_WINDOW_SIZE=6291456, MAX_HEADER_LIST_SIZE=262144. This connection's SETTINGS were ${JSON.stringify(settings)}. HTTP/2 framing comes from the client's h2 library, not from anything a script sets per request, so this is a stronger signal than headers.`,
              confidence: "medium",
              conflicting: true,
              evidence: { observationIds: ["http2.settings", "http.headers.user_agent"], derivedIds: ["derived.ua_browser_family_guess"] },
              references: [{ title: "Akamai: Passive Fingerprinting of HTTP/2 Clients (2017)", url: "https://www.blackhat.com/docs/eu-17/materials/eu-17-Shuster-Passive-Fingerprinting-Of-HTTP2-Clients-wp.pdf" }],
            },
      );
    }
    if (claimsFirefox) {
      const looksLikeFirefox = settings.headerTableSize === 65536 && settings.initialWindowSize === 131072 && settings.maxFrameSize === 16384;
      if (!looksLikeFirefox) {
        out.push({
          id: "transport.h2_settings_mismatch_firefox",
          category: "consistency",
          title: "Claims Firefox, but HTTP/2 SETTINGS are not Firefox's",
          statement: `Firefox sends HEADER_TABLE_SIZE=65536, INITIAL_WINDOW_SIZE=131072, MAX_FRAME_SIZE=16384. This connection's SETTINGS were ${JSON.stringify(settings)}.`,
          confidence: "medium",
          conflicting: true,
          evidence: { observationIds: ["http2.settings", "http.headers.user_agent"], derivedIds: ["derived.ua_browser_family_guess"] },
        });
      }
    }
  }

  // Pseudo-header order: Chrome/Edge send m,a,s,p; Firefox m,p,a,s; Safari m,s,p,a; Go m,p,a,s... only Chrome's is
  // asserted here because it's the one combination that is both stable and well documented.
  const pseudo = observedValue<string>(fp, "http2.pseudo_header_order");
  if (pseudo && claimsChromium && pseudo !== "m,a,s,p") {
    out.push({
      id: "transport.h2_pseudo_header_order_mismatch_chromium",
      category: "consistency",
      title: "Claims Chrome, but HTTP/2 pseudo-header order differs from Chromium's",
      statement: `Chromium emits the pseudo-headers as :method, :authority, :scheme, :path ("m,a,s,p"). This request used "${pseudo}".`,
      confidence: "medium",
      conflicting: true,
      evidence: { observationIds: ["http2.pseudo_header_order", "http.headers.user_agent"], derivedIds: ["derived.ua_browser_family_guess"] },
    });
  }

  // Header casing on HTTP/1.1: browsers Title-Case; a few libraries lowercase. Weak, informational.
  const casing = observedValue<{ style: string }>(fp, "http.header_casing");
  if (casing && claimsBrowser && casing.style === "lower_case") {
    out.push({
      id: "transport.browser_ua_lowercase_h1_headers",
      category: "consistency",
      title: `Claims ${family} over HTTP/1.1, but all header names are lowercase`,
      statement: "Browsers send Title-Case header names over HTTP/1.1; all-lowercase names are typical of some HTTP libraries and of proxies that re-serialize h2 requests as h1.",
      confidence: "low",
      conflicting: true,
      evidence: { observationIds: ["http.header_casing", "http.headers.user_agent"], derivedIds: ["derived.ua_browser_family_guess"] },
    });
  }

  return out;
}
