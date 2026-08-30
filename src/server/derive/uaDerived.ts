import type { DerivedAttribute, Observation } from "../../shared/schema/types.js";

/**
 * Deliberately minimal, regex-based User-Agent parsing rather than a full UA-parser
 * dependency/database. Browser/engine/OS "guesses" here are coarse and meant for the
 * educational display and as cross-signal-consistency inputs, not as a precise device
 * database — the schema's DerivedAttribute.method field says exactly how each was produced
 * so nothing here is presented as more authoritative than it is.
 */

const KNOWN_AUTOMATION_TOKENS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /HeadlessChrome/i, label: "Headless Chrome (UA token)" },
  { pattern: /\bPuppeteer\b/i, label: "Puppeteer (UA token)" },
  { pattern: /\bPlaywright\b/i, label: "Playwright (UA token)" },
  { pattern: /\bSelenium\b/i, label: "Selenium (UA token)" },
  { pattern: /\bPhantomJS\b/i, label: "PhantomJS (UA token)" },
  { pattern: /\bcurl\//i, label: "curl" },
  { pattern: /\bpython-requests\//i, label: "Python requests" },
  { pattern: /\bGo-http-client\//i, label: "Go net/http client" },
  { pattern: /\baxios\//i, label: "axios (Node HTTP client)" },
  { pattern: /\bnode-fetch\b/i, label: "node-fetch" },
  { pattern: /\bwget\//i, label: "Wget" },
  { pattern: /\bpostman/i, label: "Postman" },
  { pattern: /\bbot\b/i, label: "generic 'bot' UA token" },
  { pattern: /\bspider\b/i, label: "generic 'spider' UA token" },
  { pattern: /\bcrawler\b/i, label: "generic 'crawler' UA token" },
];

function guessBrowserFamily(ua: string): string | null {
  if (/Edg\//.test(ua)) return "Edge (Chromium)";
  if (/OPR\//.test(ua)) return "Opera (Chromium)";
  if (/Chrome\//.test(ua) && !/Chromium/.test(ua)) return "Chrome";
  if (/Chromium\//.test(ua)) return "Chromium";
  if (/\bFirefox\//.test(ua)) return "Firefox";
  if (/\bSafari\//.test(ua) && /\bVersion\//.test(ua)) return "Safari";
  return null;
}

function guessEngine(ua: string): string | null {
  if (/\bAppleWebKit\//.test(ua) && /\bGecko\)/.test(ua) === false && /Chrome|Safari|Edg/.test(ua)) return "Blink/WebKit";
  if (/\bGecko\/\d/.test(ua)) return "Gecko";
  return null;
}

function guessOs(ua: string): string | null {
  if (/Windows NT/.test(ua)) return "Windows";
  if (/Mac OS X/.test(ua) && !/iPhone|iPad/.test(ua)) return "macOS";
  if (/\bAndroid\b/.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/.test(ua)) return "iOS";
  if (/\bLinux\b/.test(ua)) return "Linux";
  return null;
}

export function deriveUserAgent(httpObservations: Observation[]): DerivedAttribute[] {
  const uaObs = httpObservations.find((o) => o.id === "http.headers.user_agent");
  const ua = uaObs?.status === "observed" ? String(uaObs.raw) : null;

  if (!ua) {
    return [
      {
        id: "derived.ua_browser_family_guess",
        derivedFrom: ["http.headers.user_agent"],
        value: null,
        method: "regex heuristics over the User-Agent header",
        status: "unavailable",
      },
      {
        id: "derived.ua_automation_tokens",
        derivedFrom: ["http.headers.user_agent"],
        value: [],
        method: "known automation/HTTP-client substring match against the User-Agent header",
        status: "unavailable",
      },
    ];
  }

  const matchedTokens = KNOWN_AUTOMATION_TOKENS.filter((t) => t.pattern.test(ua)).map((t) => t.label);

  return [
    {
      id: "derived.ua_browser_family_guess",
      derivedFrom: ["http.headers.user_agent"],
      value: guessBrowserFamily(ua),
      method: "regex heuristics over the User-Agent header",
      status: "computed",
    },
    {
      id: "derived.ua_engine_guess",
      derivedFrom: ["http.headers.user_agent"],
      value: guessEngine(ua),
      method: "regex heuristics over the User-Agent header",
      status: "computed",
    },
    {
      id: "derived.ua_os_guess",
      derivedFrom: ["http.headers.user_agent"],
      value: guessOs(ua),
      method: "regex heuristics over the User-Agent header",
      status: "computed",
    },
    {
      id: "derived.ua_automation_tokens",
      derivedFrom: ["http.headers.user_agent"],
      value: matchedTokens,
      method: "known automation/HTTP-client substring match against the User-Agent header",
      status: "computed",
    },
  ];
}
