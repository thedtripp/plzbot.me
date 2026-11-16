import { describe, it, expect } from "vitest";
import { StorageLimiter, limiterKey } from "../../src/server/storage/rateLimit.js";

const tiers = (fast: number, medium: number, slow: number) => [
  { name: "fast", windowMs: 60_000, max: fast },
  { name: "medium", windowMs: 3_600_000, max: medium },
  { name: "slow", windowMs: 86_400_000, max: slow },
];

describe("limiterKey", () => {
  it("keys IPv4 by address and IPv6 by /64", () => {
    expect(limiterKey("203.0.113.9")).toBe("203.0.113.9");
    expect(limiterKey("2001:db8:1:2:aaaa:bbbb:cccc:dddd")).toBe("2001:db8:1:2::/64");
    expect(limiterKey("2001:db8:1:2:1111:2222:3333:4444")).toBe("2001:db8:1:2::/64"); // same host, rotated address
    expect(limiterKey("2001:0DB8::5")).toBe("2001:db8:0:0::/64");
    expect(limiterKey("::1")).toBe("0:0:0:0::/64");
    expect(limiterKey(null)).toBe("unknown");
  });
});

describe("StorageLimiter", () => {
  it("fast tier stops a burst, and the window reopens", () => {
    const l = new StorageLimiter(tiers(3, 1000, 1000));
    const t0 = 1_000_000;
    expect([1, 2, 3, 4, 5].map((i) => l.check("a", t0 + i))).toEqual([null, null, null, "fast", "fast"]);
    expect(l.check("a", t0 + 61_000)).toBeNull();
  });

  it("medium tier catches sustained traffic that stays under the fast limit", () => {
    const l = new StorageLimiter(tiers(10, 5, 1000));
    let t = 0;
    const results: (string | null)[] = [];
    for (let i = 0; i < 8; i++) results.push(l.check("a", (t += 61_000))); // one per minute: never fast
    expect(results).toEqual([null, null, null, null, null, "medium", "medium", "medium"]);
  });

  it("slow tier catches a patient scraper under both other limits", () => {
    const l = new StorageLimiter(tiers(100, 100, 3));
    const results: (string | null)[] = [];
    for (let i = 0; i < 5; i++) results.push(l.check("a", i * 4_000_000)); // one per ~67 min
    expect(results).toEqual([null, null, null, "slow", "slow"]);
  });

  it("refused records do not use up allowance, so limits do not snowball", () => {
    const l = new StorageLimiter(tiers(2, 1000, 1000));
    for (let i = 0; i < 50; i++) l.check("a", 1000 + i);
    expect(l.check("a", 61_500)).toBeNull(); // fast window expired; the 50 refusals did not extend it
  });

  it("keeps visitors independent and treats a tier of 0 as disabled", () => {
    const l = new StorageLimiter(tiers(1, 0, 0));
    expect(l.check("a", 1)).toBeNull();
    expect(l.check("a", 2)).toBe("fast");
    expect(l.check("b", 3)).toBeNull();
    const off = new StorageLimiter(tiers(0, 0, 0));
    for (let i = 0; i < 1000; i++) expect(off.check("a", i)).toBeNull();
  });
});
