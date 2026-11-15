import { isIP } from "node:net";
import { ipToBigInt } from "./ip2asn.js";

/**
 * Structural classification of an IP address from the special-purpose registries
 * (RFC 6890 / IANA IPv4 and IPv6 Special-Purpose Address Registries). Purely local — says
 * what *kind* of address this is, never where it is.
 */
export type IpScope =
  | "loopback"
  | "private"
  | "link_local"
  | "shared_cgnat"
  | "unique_local"
  | "documentation"
  | "multicast"
  | "unspecified"
  | "public";

export interface IpClassification {
  version: 4 | 6 | null;
  scope: IpScope | "invalid";
  ipv4Mapped: boolean;
  /** For 6to4 / Teredo-style transition addresses, the embedded IPv4 if obvious. */
  note?: string;
}

function inV4(ip: bigint, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const b = ipToBigInt(base!)!;
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(32 - bits);
  return (ip & mask) === (b & mask);
}

function inV6(ip: bigint, cidr: string): boolean {
  const [base, bitsStr] = cidr.split("/");
  const bits = Number(bitsStr);
  const b = ipToBigInt(base!)!;
  const mask = ((1n << BigInt(bits)) - 1n) << BigInt(128 - bits);
  return (ip & mask) === (b & mask);
}

export function classifyIp(ip: string): IpClassification {
  const kind = isIP(ip);
  if (kind === 0) return { version: null, scope: "invalid", ipv4Mapped: false };

  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (mapped && mapped[1]) {
    const inner = classifyIp(mapped[1]);
    return { ...inner, ipv4Mapped: true, note: `IPv4-mapped IPv6 address wrapping ${mapped[1]}` };
  }

  const n = ipToBigInt(ip)!;
  if (kind === 4) {
    const scope: IpScope = inV4(n, "127.0.0.0/8")
      ? "loopback"
      : inV4(n, "10.0.0.0/8") || inV4(n, "172.16.0.0/12") || inV4(n, "192.168.0.0/16")
        ? "private"
        : inV4(n, "169.254.0.0/16")
          ? "link_local"
          : inV4(n, "100.64.0.0/10")
            ? "shared_cgnat"
            : inV4(n, "192.0.2.0/24") || inV4(n, "198.51.100.0/24") || inV4(n, "203.0.113.0/24")
              ? "documentation"
              : inV4(n, "224.0.0.0/4")
                ? "multicast"
                : inV4(n, "0.0.0.0/8")
                  ? "unspecified"
                  : "public";
    return { version: 4, scope, ipv4Mapped: false };
  }

  const scope: IpScope = n === 1n
    ? "loopback"
    : n === 0n
      ? "unspecified"
      : inV6(n, "fe80::/10")
        ? "link_local"
        : inV6(n, "fc00::/7")
          ? "unique_local"
          : inV6(n, "2001:db8::/32")
            ? "documentation"
            : inV6(n, "ff00::/8")
              ? "multicast"
              : "public";
  let note: string | undefined;
  if (inV6(n, "2002::/16")) note = "6to4 transition address";
  else if (inV6(n, "2001::/32")) note = "Teredo transition address";
  return { version: 6, scope, ipv4Mapped: false, ...(note ? { note } : {}) };
}
