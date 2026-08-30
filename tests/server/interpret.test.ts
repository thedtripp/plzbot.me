import { describe, it, expect } from "vitest";
import { runInterpretation } from "../../src/server/interpret/engine.js";
import { SCHEMA_VERSION, observed, type Fingerprint } from "../../src/shared/schema/types.js";

function emptyServer(): Fingerprint["server"] {
  return { network: [], tls: [], http: [], http2: [], clientHints: [] };
}

function baseFingerprint(overrides: Partial<Fingerprint> = {}): Fingerprint {
  return {
    schemaVersion: SCHEMA_VERSION,
    fingerprintId: "test-id",
    generatedAt: new Date().toISOString(),
    request: { method: "GET", httpVersion: "1.1", target: "/", scheme: "https", receivedAt: new Date().toISOString() },
    server: emptyServer(),
    client: null,
    derived: [],
    interpretation: { assessments: [] },
    ...overrides,
  };
}

describe("automation rules", () => {
  it("flags a non-browser UA as high-confidence, general (not automation) evidence", () => {
    const fp = baseFingerprint({
      server: { ...emptyServer(), http: [observed("http.headers.user_agent", "http", "server", "http_header", "curl/8.4.0")] },
      derived: [{ id: "derived.ua_automation_tokens", derivedFrom: [], value: ["curl"], method: "test", status: "computed" }],
    });
    const assessments = runInterpretation(fp);
    const a = assessments.find((x) => x.id === "automation.non_browser_ua");
    expect(a).toBeDefined();
    expect(a?.category).toBe("general");
    expect(a?.confidence).toBe("high");
  });

  it("flags navigator.webdriver=true as high-confidence automation evidence", () => {
    const fp = baseFingerprint({
      client: {
        status: "submitted",
        navigator: [],
        screen: [],
        hardware: [],
        graphics: [],
        audio: [],
        fonts: [],
        media: [],
        storage: [],
        apis: [],
        automation: [
          observed("browser.automation.navigator_webdriver", "browser.automation", "client", "navigator_property", true),
        ],
      },
    });
    const assessments = runInterpretation(fp);
    const a = assessments.find((x) => x.id === "automation.navigator_webdriver");
    expect(a).toBeDefined();
    expect(a?.confidence).toBe("high");
    expect(a?.category).toBe("automation");
  });

  it("does not flag automation for an ordinary browser-shaped fingerprint", () => {
    const fp = baseFingerprint({
      server: {
        ...emptyServer(),
        http: [
          observed(
            "http.headers.user_agent",
            "http",
            "server",
            "http_header",
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36",
          ),
          observed("http.headers.sec_fetch_site", "http", "server", "http_header", "none"),
        ],
        clientHints: [observed("client_hints.sec_ch_ua", "client_hints", "server", "http_header_client_hint", '"Chromium";v="120"')],
      },
      derived: [
        { id: "derived.ua_automation_tokens", derivedFrom: [], value: [], method: "test", status: "computed" },
        { id: "derived.ua_browser_family_guess", derivedFrom: [], value: "Chrome", method: "test", status: "computed" },
      ],
    });
    const assessments = runInterpretation(fp);
    expect(assessments.filter((a) => a.category === "automation")).toHaveLength(0);
  });
});

describe("consistency rules", () => {
  it("flags a User-Agent/Sec-CH-UA-Mobile mismatch", () => {
    const fp = baseFingerprint({
      server: {
        ...emptyServer(),
        http: [observed("http.headers.user_agent", "http", "server", "http_header", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")],
        clientHints: [observed("client_hints.sec_ch_ua_mobile", "client_hints", "server", "http_header_client_hint", "?0")],
      },
    });
    const assessments = runInterpretation(fp);
    const a = assessments.find((x) => x.id === "consistency.ua_mobile_vs_ch_mobile.conflict");
    expect(a).toBeDefined();
    expect(a?.conflicting).toBe(true);
  });

  it("does not flag when User-Agent and Sec-CH-UA-Mobile agree", () => {
    const fp = baseFingerprint({
      server: {
        ...emptyServer(),
        http: [observed("http.headers.user_agent", "http", "server", "http_header", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)")],
        clientHints: [observed("client_hints.sec_ch_ua_mobile", "client_hints", "server", "http_header_client_hint", "?1")],
      },
    });
    const assessments = runInterpretation(fp);
    expect(assessments.find((x) => x.id === "consistency.ua_mobile_vs_ch_mobile.conflict")).toBeUndefined();
  });
});

describe("identifiability rules", () => {
  it("reports high-entropy signals present when JA3/JA4 are computed", () => {
    const fp = baseFingerprint({
      derived: [
        { id: "derived.ja3_hash", derivedFrom: [], value: "abc123", method: "test", status: "computed" },
        { id: "derived.ja4", derivedFrom: [], value: "t13d...", method: "test", status: "computed" },
      ],
    });
    const assessments = runInterpretation(fp);
    const a = assessments.find((x) => x.id === "identifiability.high_entropy_signals_present");
    expect(a).toBeDefined();
    expect(a?.confidence).toBe("informational");
  });

  it("stays silent when no high-entropy signals are present", () => {
    const fp = baseFingerprint();
    const assessments = runInterpretation(fp);
    expect(assessments.find((x) => x.id === "identifiability.high_entropy_signals_present")).toBeUndefined();
  });
});

describe("rule engine resilience", () => {
  it("never throws even on a minimally-populated fingerprint", () => {
    expect(() => runInterpretation(baseFingerprint())).not.toThrow();
  });
});
