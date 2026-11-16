import { describe, it, expect } from "vitest";
import { BatchQueue, RateLimiter } from "../../src/server/storage/batchQueue.js";

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("BatchQueue", () => {
  it("writes pushed items in batches and counts them", async () => {
    const batches: number[][] = [];
    const q = new BatchQueue<number>({ sink: async (b) => void batches.push(b), batchSize: 3, flushIntervalMs: 5 });
    for (let i = 0; i < 7; i++) q.push(i);
    await q.close();
    expect(batches.flat()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(Math.max(...batches.map((b) => b.length))).toBeLessThanOrEqual(3);
    expect(q.stats()).toMatchObject({ written: 7, dropped: 0, queued: 0 });
  });

  it("retries a failed batch without losing or duplicating items", async () => {
    let fail = 2;
    const written: number[] = [];
    const q = new BatchQueue<number>({
      sink: async (b) => {
        if (fail-- > 0) throw new Error("db down");
        written.push(...b);
      },
      flushIntervalMs: 1,
      maxBackoffMs: 5,
    });
    q.push(1);
    q.push(2);
    await q.close(3000);
    expect(written).toEqual([1, 2]);
    expect(q.stats().failedBatches).toBe(2);
    expect(q.stats().dropped).toBe(0);
  });

  it("drops the oldest items, visibly, when the sink is down and the queue is full", async () => {
    const q = new BatchQueue<number>({ sink: async () => { throw new Error("down"); }, maxQueue: 3, flushIntervalMs: 1000 });
    for (let i = 0; i < 5; i++) q.push(i);
    expect(q.stats()).toMatchObject({ queued: 3, dropped: 2 });
    await q.close(200);
    expect(q.stats().dropped).toBe(5);
    expect(q.stats().lastError).toBe("down");
  });

  it("never blocks push on a slow sink", async () => {
    const q = new BatchQueue<number>({ sink: async () => {
        await wait(200);
      },
      flushIntervalMs: 1 });
    const t0 = Date.now();
    for (let i = 0; i < 100; i++) q.push(i);
    expect(Date.now() - t0).toBeLessThan(50);
    await q.close(3000);
  });
});

describe("RateLimiter", () => {
  it("limits per key per window and resets after the window", () => {
    const rl = new RateLimiter(2, 1000);
    expect([rl.allow("a", 0), rl.allow("a", 1), rl.allow("a", 2)]).toEqual([true, true, false]);
    expect(rl.allow("b", 3)).toBe(true);
    expect(rl.allow("a", 1500)).toBe(true);
  });
  it("0 disables limiting", () => {
    const rl = new RateLimiter(0);
    for (let i = 0; i < 1000; i++) expect(rl.allow("a")).toBe(true);
  });
});
