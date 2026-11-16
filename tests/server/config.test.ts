import { describe, it, expect } from "vitest";
import { loadConfig, parseTrustedProxy } from "../../src/server/runtime/config.js";

describe("runtime config", () => {
  it("defaults to TLS mode on 127.0.0.1:8443 with no trusted proxy", () => {
    const c = loadConfig({});
    expect(c.mode).toBe("tls");
    expect(c.port).toBe(8443);
    expect(c.host).toBe("127.0.0.1");
    expect(c.trustedProxy).toEqual({ hops: 0, clientIpHeader: null });
    expect(c.httpPort).toBe(0);
  });

  it("http mode binds 0.0.0.0:8080 by default and honors PaaS-style PORT", () => {
    expect(loadConfig({ PLZBOT_MODE: "http" }).port).toBe(8080);
    expect(loadConfig({ PLZBOT_MODE: "http" }).host).toBe("0.0.0.0");
    expect(loadConfig({ PLZBOT_MODE: "http", PORT: "10000" }).port).toBe(10000);
    expect(loadConfig({ PLZBOT_MODE: "http", PORT: "10000", PLZBOT_PORT: "9" }).port).toBe(9);
  });

  it("rejects unknown modes", () => {
    expect(() => loadConfig({ PLZBOT_MODE: "h3" })).toThrow(/PLZBOT_MODE/);
  });

  it("parses trusted-proxy settings", () => {
    expect(parseTrustedProxy(undefined, undefined)).toEqual({ hops: 0, clientIpHeader: null });
    expect(parseTrustedProxy("true", undefined)).toEqual({ hops: 1, clientIpHeader: null });
    expect(parseTrustedProxy("2", "CF-Connecting-IP")).toEqual({ hops: 2, clientIpHeader: "cf-connecting-ip" });
    expect(parseTrustedProxy("0", "fly-client-ip")).toEqual({ hops: 0, clientIpHeader: "fly-client-ip" });
    expect(() => parseTrustedProxy("lots", undefined)).toThrow();
  });

  it("keeps stored fingerprints forever unless retention is explicitly set", () => {
    expect(loadConfig({}).storeRetentionDays).toBe(0);
    expect(loadConfig({ PLZBOT_STORE_RETENTION_DAYS: "30" }).storeRetentionDays).toBe(30);
  });
});
