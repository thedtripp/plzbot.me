import type { Assessment, Fingerprint } from "../../../shared/schema/types.js";
import { derivedValue, findObservation, observedValue } from "../lookup.js";

const NON_BROWSER_CLIENT_TOKENS = new Set([
  "curl",
  "Python requests",
  "Go net/http client",
  "axios (Node HTTP client)",
  "node-fetch",
  "Wget",
  "Postman",
]);

const AUTOMATED_BROWSER_TOKENS = new Set([
  "Headless Chrome (UA token)",
  "Puppeteer (UA token)",
  "Playwright (UA token)",
  "Selenium (UA token)",
  "PhantomJS (UA token)",
]);

const GENERIC_BOT_TOKENS = new Set([
  "generic 'bot' UA token",
  "generic 'spider' UA token",
  "generic 'crawler' UA token",
]);

/**
 * Automation-oriented assessments. Deliberately not a single bot=yes/no verdict (spec §7/§10)
 * — each rule below cites the specific evidence it used and picks a confidence level that
 * reflects how spoofable that evidence is, from "high" (a browser directly reporting
 * navigator.webdriver=true) down to "low" (a User-Agent substring, trivially forged).
 */
export function automationRules(fp: Fingerprint): Assessment[] {
  const out: Assessment[] = [];

  const tokens = derivedValue<string[]>(fp, "derived.ua_automation_tokens") ?? [];
  const nonBrowserTokens = tokens.filter((t) => NON_BROWSER_CLIENT_TOKENS.has(t));
  const automatedBrowserTokens = tokens.filter((t) => AUTOMATED_BROWSER_TOKENS.has(t));
  const genericBotTokens = tokens.filter((t) => GENERIC_BOT_TOKENS.has(t));

  if (nonBrowserTokens.length > 0) {
    out.push({
      id: "automation.non_browser_ua",
      category: "general",
      title: "Non-browser HTTP client identified via User-Agent",
      statement: `The User-Agent header matches a known non-browser HTTP client/library (${nonBrowserTokens.join(", ")}). This is expected and unremarkable for API/script traffic — it is not evidence of anything adversarial.`,
      confidence: "high",
      evidence: { observationIds: ["http.headers.user_agent"], derivedIds: ["derived.ua_automation_tokens"] },
    });
  }

  if (automatedBrowserTokens.length > 0) {
    out.push({
      id: "automation.automated_browser_ua",
      category: "automation",
      title: "Automated browser framework identified via User-Agent",
      statement: `The User-Agent header contains a token associated with browser automation (${automatedBrowserTokens.join(", ")}). User-Agent is client-supplied and can be freely altered, so this is suggestive rather than conclusive on its own.`,
      confidence: "medium",
      evidence: { observationIds: ["http.headers.user_agent"], derivedIds: ["derived.ua_automation_tokens"] },
    });
  }

  if (genericBotTokens.length > 0) {
    out.push({
      id: "automation.generic_bot_ua",
      category: "automation",
      title: "Generic bot/crawler token in User-Agent",
      statement: `The User-Agent header contains a generic automation-adjacent token (${genericBotTokens.join(", ")}). This is a weak signal by itself — many legitimate services self-identify this way (e.g. search engine crawlers), and the string is entirely self-reported.`,
      confidence: "low",
      evidence: { observationIds: ["http.headers.user_agent"], derivedIds: ["derived.ua_automation_tokens"] },
    });
  }

  const webdriver = observedValue<boolean>(fp, "browser.automation.navigator_webdriver");
  if (webdriver === true) {
    out.push({
      id: "automation.navigator_webdriver",
      category: "automation",
      title: "navigator.webdriver reports true",
      statement:
        "The browser's own JavaScript environment reports navigator.webdriver = true, which the WebDriver specification requires automation-controlled browsers to set. This is a first-party signal from the browser engine itself, not a header the client chose to send, which makes it considerably harder to spoof than a User-Agent string (though not impossible — e.g. by patching the browser binary or overriding the property before page scripts run).",
      confidence: "high",
      evidence: { observationIds: ["browser.automation.navigator_webdriver"], derivedIds: [] },
      references: [
        { title: "WebDriver spec: navigator.webdriver", url: "https://www.w3.org/TR/webdriver2/#interface" },
      ],
    });
  }

  // Cross-signal: UA claims a modern Chromium browser, but none of the headers that
  // real Chromium browsers send automatically (Client Hints, Fetch Metadata) showed up.
  const browserFamily = derivedValue<string | null>(fp, "derived.ua_browser_family_guess");
  const claimsChromium = browserFamily === "Chrome" || browserFamily === "Chromium" || browserFamily === "Edge (Chromium)";
  const hasSecChUa = findObservation(fp, "client_hints.sec_ch_ua")?.status === "observed";
  const hasFetchMetadata = findObservation(fp, "http.headers.sec_fetch_site")?.status === "observed";
  if (claimsChromium && !hasSecChUa && !hasFetchMetadata && tokens.length === 0) {
    out.push({
      id: "automation.chromium_ua_missing_expected_headers",
      category: "consistency",
      title: "Claims a Chromium browser but is missing headers real Chromium browsers send",
      statement:
        "The User-Agent claims a Chromium-family browser, but neither Client Hints (Sec-CH-UA) nor Fetch Metadata (Sec-Fetch-*) headers were present, though real Chromium browsers have sent both automatically since 2020. This is consistent with a non-browser client sending a hand-set User-Agent string, or with an unusually old/reconfigured browser — the evidence doesn't distinguish between those.",
      confidence: "medium",
      evidence: {
        observationIds: ["http.headers.user_agent", "client_hints.sec_ch_ua", "http.headers.sec_fetch_site"],
        derivedIds: ["derived.ua_browser_family_guess"],
      },
    });
  }

  return out;
}
