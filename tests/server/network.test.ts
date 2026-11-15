import { describe, it, expect } from "vitest";
import { classifyIp } from "../../src/server/runtime/ipClass.js";
import { Ip2AsnTable, ipToBigInt } from "../../src/server/runtime/ip2asn.js";

describe("IP classification", () => {
  it.each([
    ["127.0.0.1", 4, "loopback"],
    ["10.1.2.3", 4, "private"],
    ["172.31.255.1", 4, "private"],
    ["172.32.0.1", 4, "public"],
    ["192.168.0.9", 4, "private"],
    ["169.254.1.1", 4, "link_local"],
    ["100.64.0.1", 4, "shared_cgnat"],
    ["203.0.113.7", 4, "documentation"],
    ["8.8.8.8", 4, "public"],
    ["::1", 6, "loopback"],
    ["fe80::1", 6, "link_local"],
    ["fd12::1", 6, "unique_local"],
    ["2001:db8::1", 6, "documentation"],
    ["2606:4700::1111", 6, "public"],
  ])("%s → v%d %s", (ip, version, scope) => {
    const c = classifyIp(ip);
    expect(c.version).toBe(version);
    expect(c.scope).toBe(scope);
  });

  it("unwraps IPv4-mapped IPv6", () => {
    const c = classifyIp("::ffff:192.168.1.5");
    expect(c.ipv4Mapped).toBe(true);
    expect(c.scope).toBe("private");
  });

  it("rejects garbage", () => {
    expect(classifyIp("not-an-ip").scope).toBe("invalid");
  });
});

describe("ip2asn table", () => {
  const table = Ip2AsnTable.fromText(
    [
      "1.0.0.0\t1.0.0.255\t13335\tUS\tCLOUDFLARENET",
      "1.0.1.0\t1.0.3.255\t0\tNone\tNot routed",
      "8.8.8.0\t8.8.8.255\t15169\tUS\tGOOGLE",
      "2606:4700::\t2606:4700:ffff:ffff:ffff:ffff:ffff:ffff\t13335\tUS\tCLOUDFLARENET",
    ].join("\n"),
  );

  it("converts addresses to integers", () => {
    expect(ipToBigInt("1.0.0.1")).toBe(16777217n);
    expect(ipToBigInt("::1")).toBe(1n);
    expect(ipToBigInt("::ffff:1.0.0.1")).toBe(16777217n);
  });

  it("finds the enclosing range for v4 and v6, skipping unrouted rows", () => {
    expect(table.lookup("1.0.0.77")?.asn).toBe(13335);
    expect(table.lookup("8.8.8.8")?.description).toBe("GOOGLE");
    expect(table.lookup("1.0.2.1")).toBeNull();
    expect(table.lookup("2606:4700::1111")?.asn).toBe(13335);
    expect(table.lookup("9.9.9.9")).toBeNull();
    expect(table.size).toBe(3);
  });
});
