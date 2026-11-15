import type { DerivedAttribute, Observation } from "../../shared/schema/types.js";

/**
 * Known self-identifying User-Agent tokens for AI crawlers/agents, search engines, HTTP client
 * libraries, CLI tools and headless browsers. Everything here is *self-reported*: a token
 * match tells you what a client says it is, which is useful (most legitimate operators are
 * honest and document their tokens) but never conclusive. The vendor documentation URL is
 * carried along so the UI can cite it.
 *
 * Categories:
 *   ai_training_crawler  — fetches pages to build training corpora (GPTBot, ClaudeBot, CCBot…)
 *   ai_user_fetcher      — fetches a page because a user asked an assistant to (ChatGPT-User, Claude-User…)
 *   ai_search_crawler    — indexes for an AI search product (OAI-SearchBot, Claude-SearchBot…)
 *   search_engine        — classic web search crawlers
 *   social_preview       — link-unfurlers for chat/social apps
 *   seo_crawler          — SEO/backlink crawlers
 *   monitoring           — uptime checkers
 *   http_library         — programming-language HTTP clients (requests, Go net/http, undici…)
 *   cli_tool             — curl, wget, httpie, …
 *   api_client           — Postman, Insomnia, …
 *   headless_browser     — HeadlessChrome, PhantomJS, Lightpanda, Electron
 *   scraping_framework   — Scrapy, …
 */
export type AgentCategory =
  | "ai_training_crawler"
  | "ai_user_fetcher"
  | "ai_search_crawler"
  | "search_engine"
  | "social_preview"
  | "seo_crawler"
  | "monitoring"
  | "http_library"
  | "cli_tool"
  | "api_client"
  | "headless_browser"
  | "scraping_framework";

export interface AgentSignature {
  pattern: RegExp;
  name: string;
  vendor: string;
  category: AgentCategory;
  docs?: string;
}

const OPENAI_DOCS = "https://platform.openai.com/docs/bots";
const ANTHROPIC_DOCS = "https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler";
const GOOGLE_DOCS = "https://developers.google.com/search/docs/crawling-indexing/overview-google-crawlers";
const PERPLEXITY_DOCS = "https://docs.perplexity.ai/guides/bots";
const META_DOCS = "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers";
const APPLE_DOCS = "https://support.apple.com/en-us/119829";

/** Order matters: more specific tokens first (e.g. "Claude-SearchBot" before "ClaudeBot"). */
export const AGENT_SIGNATURES: AgentSignature[] = [
  // --- AI: OpenAI
  { pattern: /\bOAI-SearchBot\b/i, name: "OAI-SearchBot", vendor: "OpenAI", category: "ai_search_crawler", docs: OPENAI_DOCS },
  { pattern: /\bChatGPT-User\b/i, name: "ChatGPT-User", vendor: "OpenAI", category: "ai_user_fetcher", docs: OPENAI_DOCS },
  { pattern: /\bGPTBot\b/i, name: "GPTBot", vendor: "OpenAI", category: "ai_training_crawler", docs: OPENAI_DOCS },
  // --- AI: Anthropic
  { pattern: /\bClaude-SearchBot\b/i, name: "Claude-SearchBot", vendor: "Anthropic", category: "ai_search_crawler", docs: ANTHROPIC_DOCS },
  { pattern: /\bClaude-User\b/i, name: "Claude-User", vendor: "Anthropic", category: "ai_user_fetcher", docs: ANTHROPIC_DOCS },
  { pattern: /\bClaudeBot\b/i, name: "ClaudeBot", vendor: "Anthropic", category: "ai_training_crawler", docs: ANTHROPIC_DOCS },
  { pattern: /\bClaude-Web\b/i, name: "Claude-Web (legacy)", vendor: "Anthropic", category: "ai_training_crawler", docs: ANTHROPIC_DOCS },
  { pattern: /\banthropic-ai\b/i, name: "anthropic-ai (legacy)", vendor: "Anthropic", category: "ai_training_crawler", docs: ANTHROPIC_DOCS },
  // --- AI: others
  { pattern: /\bPerplexity-User\b/i, name: "Perplexity-User", vendor: "Perplexity", category: "ai_user_fetcher", docs: PERPLEXITY_DOCS },
  { pattern: /\bPerplexityBot\b/i, name: "PerplexityBot", vendor: "Perplexity", category: "ai_search_crawler", docs: PERPLEXITY_DOCS },
  { pattern: /\bGoogle-CloudVertexBot\b/i, name: "Google-CloudVertexBot", vendor: "Google", category: "ai_user_fetcher", docs: GOOGLE_DOCS },
  { pattern: /\bGoogleOther\b/i, name: "GoogleOther", vendor: "Google", category: "ai_training_crawler", docs: GOOGLE_DOCS },
  { pattern: /\bmeta-externalfetcher\b/i, name: "meta-externalfetcher", vendor: "Meta", category: "ai_user_fetcher", docs: META_DOCS },
  { pattern: /\bmeta-externalagent\b/i, name: "meta-externalagent", vendor: "Meta", category: "ai_training_crawler", docs: META_DOCS },
  { pattern: /\bFacebookBot\b/i, name: "FacebookBot", vendor: "Meta", category: "ai_training_crawler", docs: META_DOCS },
  { pattern: /\bApplebot-Extended\b/i, name: "Applebot-Extended", vendor: "Apple", category: "ai_training_crawler", docs: APPLE_DOCS },
  { pattern: /\bApplebot\b/i, name: "Applebot", vendor: "Apple", category: "search_engine", docs: APPLE_DOCS },
  { pattern: /\bAmazonbot\b/i, name: "Amazonbot", vendor: "Amazon", category: "ai_training_crawler", docs: "https://developer.amazon.com/amazonbot" },
  { pattern: /\bBytespider\b/i, name: "Bytespider", vendor: "ByteDance", category: "ai_training_crawler" },
  { pattern: /\bCCBot\b/i, name: "CCBot", vendor: "Common Crawl", category: "ai_training_crawler", docs: "https://commoncrawl.org/ccbot" },
  { pattern: /\bcohere-ai\b/i, name: "cohere-ai", vendor: "Cohere", category: "ai_training_crawler" },
  { pattern: /\bMistralAI-User\b/i, name: "MistralAI-User", vendor: "Mistral AI", category: "ai_user_fetcher" },
  { pattern: /\bDuckAssistBot\b/i, name: "DuckAssistBot", vendor: "DuckDuckGo", category: "ai_search_crawler", docs: "https://duckduckgo.com/duckduckgo-help-pages/results/duckassistbot/" },
  { pattern: /\bYouBot\b/i, name: "YouBot", vendor: "You.com", category: "ai_search_crawler" },
  { pattern: /\bAI2Bot\b/i, name: "AI2Bot", vendor: "Allen Institute for AI", category: "ai_training_crawler" },
  { pattern: /\bDiffbot\b/i, name: "Diffbot", vendor: "Diffbot", category: "ai_training_crawler" },
  { pattern: /\bTimpibot\b/i, name: "Timpibot", vendor: "Timpi", category: "ai_training_crawler" },
  { pattern: /\bomgili(bot)?\b/i, name: "omgili", vendor: "Webz.io", category: "ai_training_crawler" },
  { pattern: /\bPetalBot\b/i, name: "PetalBot", vendor: "Huawei", category: "search_engine" },
  // --- search engines
  { pattern: /\bGooglebot\b/i, name: "Googlebot", vendor: "Google", category: "search_engine", docs: GOOGLE_DOCS },
  { pattern: /\bbingbot\b/i, name: "Bingbot", vendor: "Microsoft", category: "search_engine", docs: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0" },
  { pattern: /\bDuckDuckBot\b/i, name: "DuckDuckBot", vendor: "DuckDuckGo", category: "search_engine" },
  { pattern: /\bYandex(Bot)?\b/i, name: "YandexBot", vendor: "Yandex", category: "search_engine" },
  { pattern: /\bBaiduspider\b/i, name: "Baiduspider", vendor: "Baidu", category: "search_engine" },
  // --- social previews
  { pattern: /\bfacebookexternalhit\b/i, name: "facebookexternalhit", vendor: "Meta", category: "social_preview", docs: META_DOCS },
  { pattern: /\bTwitterbot\b/i, name: "Twitterbot", vendor: "X", category: "social_preview" },
  { pattern: /\bLinkedInBot\b/i, name: "LinkedInBot", vendor: "LinkedIn", category: "social_preview" },
  { pattern: /\bSlackbot(-LinkExpanding)?\b/i, name: "Slackbot", vendor: "Slack", category: "social_preview" },
  { pattern: /\bDiscordbot\b/i, name: "Discordbot", vendor: "Discord", category: "social_preview" },
  { pattern: /\bTelegramBot\b/i, name: "TelegramBot", vendor: "Telegram", category: "social_preview" },
  { pattern: /\bWhatsApp\b/i, name: "WhatsApp", vendor: "Meta", category: "social_preview" },
  // --- SEO / monitoring
  { pattern: /\bAhrefsBot\b/i, name: "AhrefsBot", vendor: "Ahrefs", category: "seo_crawler" },
  { pattern: /\bSemrushBot\b/i, name: "SemrushBot", vendor: "Semrush", category: "seo_crawler" },
  { pattern: /\bMJ12bot\b/i, name: "MJ12bot", vendor: "Majestic", category: "seo_crawler" },
  { pattern: /\bDotBot\b/i, name: "DotBot", vendor: "Moz", category: "seo_crawler" },
  { pattern: /\bUptimeRobot\b/i, name: "UptimeRobot", vendor: "UptimeRobot", category: "monitoring" },
  { pattern: /\bPingdom\b/i, name: "Pingdom", vendor: "SolarWinds", category: "monitoring" },
  { pattern: /\bStatusCake\b/i, name: "StatusCake", vendor: "StatusCake", category: "monitoring" },
  // --- headless browsers / automation runtimes
  { pattern: /\bHeadlessChrome\//i, name: "HeadlessChrome", vendor: "Chromium project", category: "headless_browser", docs: "https://developer.chrome.com/docs/chromium/headless" },
  { pattern: /\bPhantomJS\b/i, name: "PhantomJS", vendor: "PhantomJS (discontinued)", category: "headless_browser" },
  { pattern: /\bLightpanda\b/i, name: "Lightpanda", vendor: "Lightpanda", category: "headless_browser" },
  { pattern: /\bElectron\//i, name: "Electron", vendor: "OpenJS Foundation", category: "headless_browser" },
  // --- scraping frameworks
  { pattern: /\bScrapy\//i, name: "Scrapy", vendor: "Zyte", category: "scraping_framework" },
  { pattern: /\bcolly\b/i, name: "Colly", vendor: "gocolly", category: "scraping_framework" },
  // --- CLI tools
  { pattern: /^curl\//i, name: "curl", vendor: "curl project", category: "cli_tool", docs: "https://curl.se/docs/manpage.html" },
  { pattern: /^Wget\//i, name: "Wget", vendor: "GNU", category: "cli_tool" },
  { pattern: /\bHTTPie\//i, name: "HTTPie", vendor: "HTTPie", category: "cli_tool" },
  { pattern: /^xh\//i, name: "xh", vendor: "xh", category: "cli_tool" },
  // --- API clients
  { pattern: /\bPostmanRuntime\//i, name: "Postman", vendor: "Postman", category: "api_client" },
  { pattern: /\binsomnia\//i, name: "Insomnia", vendor: "Kong", category: "api_client" },
  { pattern: /\bBruno\b/i, name: "Bruno", vendor: "Bruno", category: "api_client" },
  // --- HTTP libraries (language runtimes)
  { pattern: /\bpython-requests\//i, name: "requests", vendor: "Python", category: "http_library" },
  { pattern: /\bpython-httpx\//i, name: "httpx", vendor: "Python", category: "http_library" },
  { pattern: /\bPython-urllib\//i, name: "urllib", vendor: "Python stdlib", category: "http_library" },
  { pattern: /\baiohttp\b/i, name: "aiohttp", vendor: "Python", category: "http_library" },
  { pattern: /\bGo-http-client\//i, name: "net/http", vendor: "Go", category: "http_library" },
  { pattern: /\bokhttp\//i, name: "OkHttp", vendor: "Square (JVM/Android)", category: "http_library" },
  { pattern: /\bApache-HttpClient\//i, name: "Apache HttpClient", vendor: "Apache (JVM)", category: "http_library" },
  { pattern: /^Java\//i, name: "java.net.HttpURLConnection", vendor: "Java", category: "http_library" },
  { pattern: /^node$/i, name: "undici (Node.js global fetch)", vendor: "Node.js", category: "http_library", docs: "https://undici.nodejs.org/" },
  { pattern: /\bundici\b/i, name: "undici", vendor: "Node.js", category: "http_library", docs: "https://undici.nodejs.org/" },
  { pattern: /\bnode-fetch\b/i, name: "node-fetch", vendor: "Node.js ecosystem", category: "http_library" },
  { pattern: /\baxios\//i, name: "axios", vendor: "Node.js ecosystem", category: "http_library" },
  { pattern: /\bgot \(https:\/\/github\.com\/sindresorhus\/got\)/i, name: "got", vendor: "Node.js ecosystem", category: "http_library" },
  { pattern: /^Deno\//i, name: "Deno fetch", vendor: "Deno", category: "http_library" },
  { pattern: /^Bun\//i, name: "Bun fetch", vendor: "Bun", category: "http_library" },
  { pattern: /\blibwww-perl\//i, name: "LWP", vendor: "Perl", category: "http_library" },
  { pattern: /\bRuby\b|\bFaraday\b/i, name: "Ruby HTTP client", vendor: "Ruby", category: "http_library" },
  { pattern: /\bGuzzleHttp\//i, name: "Guzzle", vendor: "PHP", category: "http_library" },
  { pattern: /\bDart\//i, name: "dart:io HttpClient", vendor: "Dart/Flutter", category: "http_library" },
  { pattern: /\bRestSharp\//i, name: "RestSharp", vendor: ".NET", category: "http_library" },
  { pattern: /\breqwest\//i, name: "reqwest", vendor: "Rust", category: "http_library" },
  { pattern: /\blibcurl\//i, name: "libcurl", vendor: "curl project", category: "http_library" },
];

export interface ClientSignatureMatch {
  name: string;
  vendor: string;
  category: AgentCategory;
  matchedText: string;
  docs: string | null;
}

export function matchAgentSignature(userAgent: string): ClientSignatureMatch | null {
  for (const sig of AGENT_SIGNATURES) {
    const m = userAgent.match(sig.pattern);
    if (m) return { name: sig.name, vendor: sig.vendor, category: sig.category, matchedText: m[0], docs: sig.docs ?? null };
  }
  return null;
}

export function deriveClientSignature(httpObservations: Observation[]): DerivedAttribute[] {
  const uaObs = httpObservations.find((o) => o.id === "http.headers.user_agent");
  const method = "User-Agent token match against a curated table of self-identifying AI agents, crawlers, HTTP libraries and tools (src/server/derive/agentSignatures.ts)";
  if (uaObs?.status !== "observed") {
    return [
      {
        id: "derived.client_signature",
        derivedFrom: ["http.headers.user_agent"],
        value: { category: "no_user_agent" },
        method,
        status: "computed",
      },
    ];
  }
  const match = matchAgentSignature(String(uaObs.raw));
  return [
    {
      id: "derived.client_signature",
      derivedFrom: ["http.headers.user_agent"],
      value: match ?? { category: "unrecognized" },
      method,
      status: "computed",
    },
  ];
}
