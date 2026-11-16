/**
 * Layered per-visitor limits on how many fingerprints get SAVED (visitors always still get their
 * normal response). A record is saved only if the visitor is under every tier, so a burst, a
 * sustained hammering and a patient slow scraper are each caught by a different window.
 *
 * State is in memory (per process, resets on restart). Fixed windows start at a visitor's first
 * saved record. Refused records do not consume allowance, so limits never snowball.
 */
export interface Tier {
  name: string;
  windowMs: number;
  /** Max saved records per visitor per window. 0 disables the tier. */
  max: number;
}

/** One key per visitor: the IPv4 address, or the /64 prefix for IPv6 (a single host can rotate
 * through the addresses inside its /64, so per-address limits would be trivially bypassed). */
export function limiterKey(ip: string | null): string {
  if (!ip) return "unknown";
  if (!ip.includes(":")) return ip;
  const [head = "", tail = ""] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const gap = ip.includes("::") ? Math.max(8 - h.length - t.length, 0) : 0;
  const groups = [...h, ...Array<string>(gap).fill("0"), ...t].slice(0, 4);
  return groups.map((g) => g.toLowerCase().replace(/^0+(?=.)/, "")).join(":") + "::/64";
}

const SWEEP_AT = 50_000;
const HARD_CAP = 200_000;

export class StorageLimiter {
  private readonly tiers: Tier[];
  private readonly state = new Map<string, { start: number; count: number }[]>();

  constructor(tiers: Tier[]) {
    this.tiers = tiers.filter((t) => t.max > 0 && t.windowMs > 0);
  }

  /** Returns null and counts the record if allowed; otherwise the name of the first tier exceeded. */
  check(key: string, now = Date.now()): string | null {
    if (this.tiers.length === 0) return null;
    let windows = this.state.get(key);
    if (!windows) {
      windows = this.tiers.map(() => ({ start: now, count: 0 }));
      this.state.set(key, windows);
      if (this.state.size > SWEEP_AT) this.sweep(now);
    }
    this.tiers.forEach((t, i) => {
      if (now - windows![i]!.start >= t.windowMs) windows![i] = { start: now, count: 0 };
    });
    for (let i = 0; i < this.tiers.length; i++) {
      if (windows[i]!.count >= this.tiers[i]!.max) return this.tiers[i]!.name;
    }
    for (const w of windows) w.count++;
    return null;
  }

  private sweep(now: number): void {
    for (const [key, windows] of this.state) {
      if (windows.every((w, i) => now - w.start >= this.tiers[i]!.windowMs)) this.state.delete(key);
    }
    // Memory guard under a many-address flood: forgetting everyone is better than growing forever.
    if (this.state.size > HARD_CAP) this.state.clear();
  }
}
