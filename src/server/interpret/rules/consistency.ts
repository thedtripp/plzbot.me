import type { Assessment, Fingerprint } from "../../../shared/schema/types.js";
import { derivedValue, findObservation, observedValue } from "../lookup.js";

/**
 * Cross-signal consistency checks (spec §8). Each rule compares two independently-collected
 * signals and reports either a match or a conflict — never a verdict about the client's intent.
 * New checks are added by writing another small function and calling it below; nothing else
 * needs to change (spec: "additional rules can easily be added later").
 */
export function consistencyRules(fp: Fingerprint): Assessment[] {
  const out: Assessment[] = [];

  checkUaVsClientHintsBrand(fp, out);
  checkUaVsClientHintsPlatform(fp, out);
  checkUaVsJsPlatform(fp, out);
  checkAcceptLanguageVsJsLanguages(fp, out);
  checkMobileUaVsClientHintsMobile(fp, out);

  return out;
}

function checkUaVsClientHintsBrand(fp: Fingerprint, out: Assessment[]): void {
  const secChUa = observedValue<Array<{ brand: string; version: string }>>(fp, "client_hints.sec_ch_ua");
  const browserFamily = derivedValue<string | null>(fp, "derived.ua_browser_family_guess");
  if (!secChUa || !browserFamily) return;

  const brands = secChUa.map((b) => b.brand.toLowerCase());
  const familyToken = browserFamily.split(" ")[0]?.toLowerCase() ?? "";
  const matches = brands.some((b) => b.includes(familyToken) || familyToken.includes(b));

  if (matches) {
    out.push({
      id: "consistency.ua_vs_sec_ch_ua_brand.match",
      category: "consistency",
      title: "User-Agent and Sec-CH-UA brand agree",
      statement: `The User-Agent-derived browser family ("${browserFamily}") is consistent with the brands listed in Sec-CH-UA (${brands.join(", ")}).`,
      confidence: "informational",
      evidence: { observationIds: ["http.headers.user_agent", "client_hints.sec_ch_ua"], derivedIds: ["derived.ua_browser_family_guess"] },
    });
  } else {
    out.push({
      id: "consistency.ua_vs_sec_ch_ua_brand.conflict",
      category: "consistency",
      title: "User-Agent and Sec-CH-UA brand disagree",
      statement: `The User-Agent-derived browser family ("${browserFamily}") does not appear among the brands listed in Sec-CH-UA (${brands.join(", ")}). Both are client-supplied and independently spoofable, so this flags a discrepancy worth a closer look rather than proving anything on its own — note that Sec-CH-UA intentionally includes randomized "greased" fake brand entries by design, which can also explain an apparent mismatch.`,
      confidence: "medium",
      conflicting: true,
      evidence: { observationIds: ["http.headers.user_agent", "client_hints.sec_ch_ua"], derivedIds: ["derived.ua_browser_family_guess"] },
      references: [{ title: "UA-CH: GREASE-like brand list", url: "https://wicg.github.io/ua-client-hints/#grease" }],
    });
  }
}

function checkUaVsClientHintsPlatform(fp: Fingerprint, out: Assessment[]): void {
  const platform = observedValue<string>(fp, "client_hints.sec_ch_ua_platform");
  const osGuess = derivedValue<string | null>(fp, "derived.ua_os_guess");
  if (!platform || !osGuess) return;

  const normalizedPlatform = platform.replace(/"/g, "").toLowerCase();
  const normalizedOsGuess = osGuess.toLowerCase();
  const matches =
    normalizedPlatform.includes(normalizedOsGuess) ||
    normalizedOsGuess.includes(normalizedPlatform) ||
    (normalizedPlatform === "macos" && normalizedOsGuess === "macos");

  out.push({
    id: matches ? "consistency.ua_vs_ch_platform.match" : "consistency.ua_vs_ch_platform.conflict",
    category: "consistency",
    title: matches ? "User-Agent OS and Sec-CH-UA-Platform agree" : "User-Agent OS and Sec-CH-UA-Platform disagree",
    statement: matches
      ? `The OS guessed from the User-Agent ("${osGuess}") matches the Sec-CH-UA-Platform hint ("${platform}").`
      : `The OS guessed from the User-Agent ("${osGuess}") does not match the Sec-CH-UA-Platform hint ("${platform}"). Both come from the client; a mismatch can indicate a modified/spoofed User-Agent, a browser extension rewriting headers, or simply an OS our regex-based guess didn't recognize.`,
    confidence: matches ? "informational" : "medium",
    conflicting: !matches,
    evidence: {
      observationIds: ["http.headers.user_agent", "client_hints.sec_ch_ua_platform"],
      derivedIds: ["derived.ua_os_guess"],
    },
  });
}

function checkUaVsJsPlatform(fp: Fingerprint, out: Assessment[]): void {
  if (!fp.client) return;
  const jsPlatform = observedValue<string>(fp, "browser.navigator.platform");
  const osGuess = derivedValue<string | null>(fp, "derived.ua_os_guess");
  if (!jsPlatform || !osGuess) return;

  const p = jsPlatform.toLowerCase();
  const matches =
    (osGuess === "Windows" && p.includes("win")) ||
    (osGuess === "macOS" && p.includes("mac")) ||
    (osGuess === "Linux" && p.includes("linux")) ||
    (osGuess === "Android" && p.includes("linux")) || // Android reports "Linux armv..." on navigator.platform
    (osGuess === "iOS" && (p.includes("iphone") || p.includes("ipad") || p.includes("mac")));

  if (!matches) {
    out.push({
      id: "consistency.ua_os_vs_navigator_platform.conflict",
      category: "consistency",
      title: "HTTP User-Agent OS and JS navigator.platform disagree",
      statement: `The server-observed User-Agent implies "${osGuess}", but the browser's own navigator.platform reported "${jsPlatform}". Since navigator.platform is deprecated and increasingly frozen/spoofed-by-design in modern browsers, this is weak evidence — but a large mismatch (e.g. claimed Windows vs. reported Linux) is still worth surfacing.`,
      confidence: "low",
      conflicting: true,
      evidence: {
        observationIds: ["http.headers.user_agent", "browser.navigator.platform"],
        derivedIds: ["derived.ua_os_guess"],
      },
      references: [{ title: "MDN: navigator.platform (deprecated)", url: "https://developer.mozilla.org/en-US/docs/Web/API/Navigator/platform" }],
    });
  }
}

function checkAcceptLanguageVsJsLanguages(fp: Fingerprint, out: Assessment[]): void {
  if (!fp.client) return;
  const acceptLanguage = observedValue<string>(fp, "http.headers.accept_language");
  const jsLanguages = observedValue<string[]>(fp, "browser.navigator.languages");
  if (!acceptLanguage || !jsLanguages || jsLanguages.length === 0) return;

  const primaryHeaderLang = acceptLanguage.split(",")[0]?.split(";")[0]?.trim().toLowerCase();
  const primaryJsLang = jsLanguages[0]?.toLowerCase();
  if (!primaryHeaderLang || !primaryJsLang) return;

  const matches = primaryHeaderLang === primaryJsLang || primaryHeaderLang.split("-")[0] === primaryJsLang.split("-")[0];
  if (!matches) {
    out.push({
      id: "consistency.accept_language_vs_navigator_languages.conflict",
      category: "consistency",
      title: "Accept-Language and navigator.languages disagree",
      statement: `The Accept-Language header's primary language ("${primaryHeaderLang}") does not match navigator.languages[0] ("${primaryJsLang}"). This can legitimately happen (browser language vs. OS/Accept-Language settings can differ), but is also consistent with an automation tool that sets one and not the other.`,
      confidence: "low",
      conflicting: true,
      evidence: {
        observationIds: ["http.headers.accept_language", "browser.navigator.languages"],
        derivedIds: [],
      },
    });
  }
}

function checkMobileUaVsClientHintsMobile(fp: Fingerprint, out: Assessment[]): void {
  const uaObs = findObservation(fp, "http.headers.user_agent");
  const mobileHint = observedValue<string>(fp, "client_hints.sec_ch_ua_mobile");
  if (uaObs?.status !== "observed" || mobileHint === undefined) return;

  const uaClaimsMobile = /Mobi|Android.*Mobile|iPhone/.test(String(uaObs.raw));
  const hintClaimsMobile = mobileHint === "?1";

  if (uaClaimsMobile !== hintClaimsMobile) {
    out.push({
      id: "consistency.ua_mobile_vs_ch_mobile.conflict",
      category: "consistency",
      title: "User-Agent mobile indicator and Sec-CH-UA-Mobile disagree",
      statement: `The User-Agent string ${uaClaimsMobile ? "looks like a mobile device" : "does not look like a mobile device"}, but Sec-CH-UA-Mobile reports ${hintClaimsMobile ? "mobile (?1)" : "non-mobile (?0)"}.`,
      confidence: "medium",
      conflicting: true,
      evidence: { observationIds: ["http.headers.user_agent", "client_hints.sec_ch_ua_mobile"], derivedIds: [] },
    });
  }
}
