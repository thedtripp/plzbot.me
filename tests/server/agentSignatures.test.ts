import { describe, it, expect } from "vitest";
import { matchAgentSignature, deriveClientSignature } from "../../src/server/derive/agentSignatures.js";
import { observed } from "../../src/shared/schema/types.js";

describe("agent signatures", () => {
  it.each([
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; GPTBot/1.2; +https://openai.com/gptbot)", "GPTBot", "ai_training_crawler"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot", "ChatGPT-User", "ai_user_fetcher"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot", "OAI-SearchBot", "ai_search_crawler"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "ClaudeBot", "ai_training_crawler"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)", "Claude-User", "ai_user_fetcher"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)", "Claude-SearchBot", "ai_search_crawler"],
    ["Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)", "PerplexityBot", "ai_search_crawler"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "Googlebot", "search_engine"],
    ["curl/8.7.1", "curl", "cli_tool"],
    ["python-requests/2.32.3", "requests", "http_library"],
    ["Go-http-client/2.0", "net/http", "http_library"],
    ["node", "undici (Node.js global fetch)", "http_library"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/131.0.0.0 Safari/537.36", "HeadlessChrome", "headless_browser"],
  ])("recognizes %s", (ua, name, category) => {
    const m = matchAgentSignature(ua);
    expect(m?.name).toBe(name);
    expect(m?.category).toBe(category);
  });

  it("does not match an ordinary browser User-Agent", () => {
    expect(matchAgentSignature("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36")).toBeNull();
    expect(matchAgentSignature("Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0")).toBeNull();
  });

  it("derives no_user_agent when the header is missing and unrecognized otherwise", () => {
    expect(deriveClientSignature([])[0]?.value).toEqual({ category: "no_user_agent" });
    const d = deriveClientSignature([observed("http.headers.user_agent", "http", "server", "http_header", "Mozilla/5.0 Firefox/133.0")]);
    expect(d[0]?.value).toEqual({ category: "unrecognized" });
  });
});
