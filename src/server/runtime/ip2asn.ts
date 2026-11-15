import fs from "node:fs";
import { isIP } from "node:net";

/**
 * Optional offline ASN lookup backed by the public-domain iptoasn.com TSV
 * (`range_start<TAB>range_end<TAB>AS_number<TAB>country_code<TAB>AS_description`, IPv4 and
 * IPv6 mixed in the "combined" file). No API key and no outbound calls — which is why this is
 * the one IP-intelligence source the project uses. When PLZBOT_IP2ASN_PATH is unset the lookup
 * reports `not_configured`, exactly as before.
 */
export interface AsnRecord {
  asn: number;
  country: string;
  description: string;
}

interface Range {
  start: bigint;
  end: bigint;
  record: AsnRecord;
}

export function ipToBigInt(ip: string): bigint | null {
  const kind = isIP(ip);
  if (kind === 4) {
    const parts = ip.split(".").map(Number);
    return parts.reduce((acc, p) => (acc << 8n) + BigInt(p), 0n);
  }
  if (kind === 6) {
    // Handle ::ffff:a.b.c.d (IPv4-mapped) by mapping into the v4 space, so one table serves both.
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped && mapped[1]) return ipToBigInt(mapped[1]);
    const [head, tail] = ip.split("::");
    const headParts = head ? head.split(":") : [];
    const tailParts = tail ? tail.split(":") : [];
    const missing = 8 - headParts.length - tailParts.length;
    const groups = [...headParts, ...Array<string>(Math.max(0, missing)).fill("0"), ...tailParts];
    if (groups.length !== 8) return null;
    return groups.reduce((acc, g) => (acc << 16n) + BigInt(parseInt(g || "0", 16)), 0n);
  }
  return null;
}

export class Ip2AsnTable {
  private readonly v4: Range[] = [];
  private readonly v6: Range[] = [];

  static fromFile(path: string): Ip2AsnTable {
    return Ip2AsnTable.fromText(fs.readFileSync(path, "utf8"));
  }

  static fromText(text: string): Ip2AsnTable {
    const table = new Ip2AsnTable();
    for (const line of text.split("\n")) {
      if (!line || line.startsWith("#")) continue;
      const [a, b, asn, country, ...desc] = line.split("\t");
      if (!a || !b || !asn) continue;
      const asnNum = Number(asn);
      if (asnNum === 0) continue; // "Not routed" filler rows
      const start = ipToBigInt(a);
      const end = ipToBigInt(b);
      if (start === null || end === null) continue;
      const bucket = isIP(a) === 4 ? table.v4 : table.v6;
      bucket.push({ start, end, record: { asn: asnNum, country: country ?? "", description: desc.join("\t").trim() } });
    }
    table.v4.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
    table.v6.sort((x, y) => (x.start < y.start ? -1 : x.start > y.start ? 1 : 0));
    return table;
  }

  get size(): number {
    return this.v4.length + this.v6.length;
  }

  lookup(ip: string): AsnRecord | null {
    const n = ipToBigInt(ip);
    if (n === null) return null;
    const mapped = /^::ffff:\d+\.\d+\.\d+\.\d+$/i.test(ip);
    const ranges = isIP(ip) === 4 || mapped ? this.v4 : this.v6;
    let lo = 0;
    let hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = ranges[mid]!;
      if (n < r.start) hi = mid - 1;
      else if (n > r.end) lo = mid + 1;
      else return r.record;
    }
    return null;
  }
}

let cached: { path: string; table: Ip2AsnTable | null } | null = null;

/** Lazily loads (once) the table named by config; returns null when unconfigured or unreadable. */
export function getIp2AsnTable(path: string | null, log: (msg: string) => void = () => {}): Ip2AsnTable | null {
  if (!path) return null;
  if (cached && cached.path === path) return cached.table;
  try {
    const table = Ip2AsnTable.fromFile(path);
    log(`ip2asn: loaded ${table.size} ranges from ${path}`);
    cached = { path, table };
  } catch (err) {
    log(`ip2asn: could not load ${path}: ${(err as Error).message}`);
    cached = { path, table: null };
  }
  return cached.table;
}
