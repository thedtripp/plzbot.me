import type { Assessment, Fingerprint } from "../../../shared/schema/types.js";
import { derivedValue, findObservation } from "../lookup.js";
import type { ClientSignatureMatch } from "../../derive/agentSignatures.js";

const CATEGORY_TEXT: Record<string, { title: string; explain: string }> = {
  ai_training_crawler: {
    title: "Self-identified AI training crawler",
    explain: "fetches pages to build or refresh a model's training corpus. Reputable operators publish their token and honor robots.txt directives for it.",
  },
  ai_user_fetcher: {
    title: "Self-identified AI assistant fetching on a user's behalf",
    explain: "retrieves a page because a person asked an AI assistant to read it (a live 'browse this URL' action), not for indexing or training.",
  },
  ai_search_crawler: {
    title: "Self-identified AI search indexer",
    explain: "indexes pages so an AI search product can cite them in answers.",
  },
  search_engine: { title: "Self-identified search engine crawler", explain: "indexes pages for a classic web search engine." },
  social_preview: { title: "Link-preview fetcher", explain: "fetches a page once to render a link unfurl in a chat or social app." },
  seo_crawler: { title: "SEO / backlink crawler", explain: "builds a commercial link-graph or SEO index." },
  monitoring: { title: "Uptime monitor", explain: "polls the page on a schedule to check availability." },
  http_library: {
    title: "Programming-language HTTP client library",
    explain: "is the default User-Agent of an HTTP library — the string a script sends when its author didn't set one. Most AI agent frameworks and custom scrapers fall here unless they override it.",
  },
  cli_tool: { title: "Command-line HTTP tool", explain: "is a command-line download tool run by a person or a script." },
  api_client: { title: "API testing client", explain: "is a desktop/CLI API client typically driven by a developer." },
  headless_browser: {
    title: "Headless / embedded browser runtime",
    explain: "is a real browser engine running without a visible window — the usual substrate for Puppeteer, Playwright, Selenium and browser-based AI agents.",
  },
  scraping_framework: { title: "Web-scraping framework", explain: "is a purpose-built crawling framework." },
};

/**
 * Turns `derived.client_signature` into one hedged, cited assessment. Everything here rests on
 * a self-reported User-Agent token, so the confidence ceiling is "medium" — a token identifies
 * what a client *claims* to be. (Operators who want to be trusted usually also publish IP
 * ranges or sign requests; that verification is out of scope here and the statement says so.)
 */
export function agentRules(fp: Fingerprint): Assessment[] {
  const sig = derivedValue<ClientSignatureMatch | { category: string }>(fp, "derived.client_signature");
  if (!sig) return [];
  const evidence = { observationIds: ["http.headers.user_agent"], derivedIds: ["derived.client_signature"] };

  if (sig.category === "no_user_agent") {
    return [
      {
        id: "agent.no_user_agent",
        category: "automation",
        title: "No User-Agent header at all",
        statement:
          "The request carried no User-Agent header. Every mainstream browser and nearly every HTTP library sends one by default, so its complete absence usually means a hand-built request (raw sockets, a stripped-down client, or a script that deliberately removed it). Not malicious by itself, but unusual.",
        confidence: "medium",
        evidence,
      },
    ];
  }
  if (sig.category === "unrecognized" || !("name" in sig)) return [];

  const text = CATEGORY_TEXT[sig.category];
  if (!text) return [];
  const isAi = sig.category.startsWith("ai_");
  const references = sig.docs ? [{ title: `${sig.vendor}: documentation for ${sig.name}`, url: sig.docs }] : undefined;

  const out: Assessment[] = [
    {
      id: `agent.${sig.category}`,
      category: isAi || sig.category === "headless_browser" || sig.category === "scraping_framework" ? "automation" : "general",
      title: `${text.title}: ${sig.name} (${sig.vendor})`,
      statement: `The User-Agent contains "${sig.matchedText}", the token ${sig.vendor} documents for ${sig.name}, which ${text.explain} This is self-identification: the token proves only that the client chose to send it — anyone can send the same string — and absence of a token proves nothing either. ${
        isAi ? "Operators that document a token generally also publish IP ranges or request-signing so sites can verify it; that verification is not performed here." : ""
      }`.trim(),
      confidence: "medium",
      evidence,
      ...(references ? { references } : {}),
    },
  ];

  // A self-identified non-browser client that nonetheless submitted browser-side signals
  // is an interesting combination (e.g. an agent framework driving a real browser while
  // overriding the UA) — surface it rather than leave the reader to notice.
  if (fp.client && (sig.category === "http_library" || sig.category === "cli_tool" || isAi)) {
    out.push({
      id: "agent.non_browser_token_with_browser_signals",
      category: "consistency",
      title: "Non-browser User-Agent token, but browser-side JavaScript ran",
      statement: `The User-Agent identifies as ${sig.name}, yet this fingerprint includes signals collected by JavaScript executing in a page, which ${sig.name} cannot do on its own. The likely explanation is a real browser (headless or not) with an overridden User-Agent — common for browser-automation agents that want to announce themselves.`,
      confidence: "medium",
      conflicting: true,
      evidence: { observationIds: ["http.headers.user_agent", "browser.navigator.user_agent"], derivedIds: ["derived.client_signature"] },
    });
  }

  // Browser-like fetch metadata from a self-identified crawler/library is a contradiction too.
  const fetchMeta = findObservation(fp, "http.fetch_metadata_present");
  if (fetchMeta?.status === "observed" && fetchMeta.raw === true && (sig.category === "http_library" || sig.category === "cli_tool")) {
    out.push({
      id: "agent.library_token_with_fetch_metadata",
      category: "consistency",
      title: "HTTP-library User-Agent, but browser Fetch Metadata headers present",
      statement: `Sec-Fetch-* headers are attached automatically by browsers and are not sent by ${sig.name} by default. Seeing both suggests either a browser with a replaced User-Agent or a script that copied a browser's headers wholesale.`,
      confidence: "low",
      conflicting: true,
      evidence: { observationIds: ["http.headers.user_agent", "http.headers.sec_fetch_site"], derivedIds: ["derived.client_signature"] },
    });
  }

  return out;
}
