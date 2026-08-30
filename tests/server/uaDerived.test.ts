import { describe, it, expect } from "vitest";
import { deriveUserAgent } from "../../src/server/derive/uaDerived.js";
import { observed } from "../../src/shared/schema/types.js";

function httpObsWithUa(ua: string) {
  return [observed("http.headers.user_agent", "http", "server", "http_header", ua)];
}

describe("deriveUserAgent", () => {
  it("identifies curl", () => {
    const derived = deriveUserAgent(httpObsWithUa("curl/8.4.0"));
    const tokens = derived.find((d) => d.id === "derived.ua_automation_tokens");
    expect(tokens?.value).toContain("curl");
  });

  it("identifies python-requests", () => {
    const derived = deriveUserAgent(httpObsWithUa("python-requests/2.31.0"));
    const tokens = derived.find((d) => d.id === "derived.ua_automation_tokens");
    expect(tokens?.value).toContain("Python requests");
  });

  it("identifies headless chrome and puppeteer tokens", () => {
    const ua =
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/120.0.0.0 Safari/537.36";
    const derived = deriveUserAgent(httpObsWithUa(ua));
    const tokens = derived.find((d) => d.id === "derived.ua_automation_tokens");
    expect(tokens?.value).toContain("Headless Chrome (UA token)");
    const family = derived.find((d) => d.id === "derived.ua_browser_family_guess");
    expect(family?.value).toBe("Chrome");
  });

  it("guesses browser/engine/os for an ordinary desktop Chrome UA", () => {
    const ua =
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
    const derived = deriveUserAgent(httpObsWithUa(ua));
    expect(derived.find((d) => d.id === "derived.ua_browser_family_guess")?.value).toBe("Chrome");
    expect(derived.find((d) => d.id === "derived.ua_os_guess")?.value).toBe("macOS");
    expect(derived.find((d) => d.id === "derived.ua_automation_tokens")?.value).toEqual([]);
  });

  it("guesses Firefox/Gecko/Windows", () => {
    const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:121.0) Gecko/20100101 Firefox/121.0";
    const derived = deriveUserAgent(httpObsWithUa(ua));
    expect(derived.find((d) => d.id === "derived.ua_browser_family_guess")?.value).toBe("Firefox");
    expect(derived.find((d) => d.id === "derived.ua_os_guess")?.value).toBe("Windows");
  });

  it("returns unavailable status when User-Agent header is absent", () => {
    const derived = deriveUserAgent([]);
    expect(derived.find((d) => d.id === "derived.ua_browser_family_guess")?.status).toBe("unavailable");
  });
});
