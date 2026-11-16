/**
 * Bounded in-memory queue that drains to an async sink in batches.
 *
 * Why it exists: request handlers must never wait on, or fail because of, the database.
 * `push` is synchronous and O(1). A background loop flushes up to `batchSize` items at a time,
 * retrying a failed batch with exponential backoff. If the sink stays down long enough for
 * the queue to reach `maxQueue`, the *oldest* items are dropped and counted -- the loss is
 * visible in stats() / GET /healthz, never silent.
 */
export interface BatchQueueOptions<T> {
  sink: (batch: T[]) => Promise<void>;
  batchSize?: number;
  maxQueue?: number;
  flushIntervalMs?: number;
  maxBackoffMs?: number;
  log?: (msg: string) => void;
}

export interface BatchQueueStats {
  queued: number;
  written: number;
  dropped: number;
  failedBatches: number;
  lastError: string | null;
  lastWriteAt: string | null;
}

export class BatchQueue<T> {
  private items: T[] = [];
  private timer: NodeJS.Timeout | null = null;
  private flushing: Promise<void> | null = null;
  private backoffMs = 0;
  private closed = false;
  private written = 0;
  private dropped = 0;
  private failedBatches = 0;
  private lastError: string | null = null;
  private lastWriteAt: string | null = null;
  private readonly batchSize: number;
  private readonly maxQueue: number;
  private readonly flushIntervalMs: number;
  private readonly maxBackoffMs: number;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: BatchQueueOptions<T>) {
    this.batchSize = opts.batchSize ?? 50;
    this.maxQueue = opts.maxQueue ?? 5000;
    this.flushIntervalMs = opts.flushIntervalMs ?? 500;
    this.maxBackoffMs = opts.maxBackoffMs ?? 30_000;
    this.log = opts.log ?? (() => {});
  }

  push(item: T): void {
    if (this.closed) {
      this.dropped++;
      return;
    }
    this.items.push(item);
    if (this.items.length > this.maxQueue) {
      const over = this.items.length - this.maxQueue;
      this.items.splice(0, over);
      this.dropped += over;
      this.log(`[store] queue full, dropped ${over} oldest record(s)`);
    }
    this.schedule();
  }

  stats(): BatchQueueStats {
    return {
      queued: this.items.length,
      written: this.written,
      dropped: this.dropped,
      failedBatches: this.failedBatches,
      lastError: this.lastError,
      lastWriteAt: this.lastWriteAt,
    };
  }

  private schedule(delay = this.backoffMs || this.flushIntervalMs): void {
    if (this.timer || this.flushing || this.items.length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flushOnce();
    }, delay);
    this.timer.unref();
  }

  private flushOnce(): Promise<void> {
    if (this.flushing) return this.flushing;
    this.flushing = (async () => {
      while (this.items.length > 0) {
        const batch = this.items.slice(0, this.batchSize);
        try {
          await this.opts.sink(batch);
          // Remove exactly what we wrote; push() may have trimmed the head meanwhile.
          const removed = Math.min(batch.length, this.items.length);
          this.items.splice(0, removed);
          this.written += batch.length;
          this.lastWriteAt = new Date().toISOString();
          this.backoffMs = 0;
        } catch (err) {
          this.failedBatches++;
          this.lastError = (err as Error).message;
          this.backoffMs = Math.min(this.maxBackoffMs, this.backoffMs ? this.backoffMs * 2 : 1000);
          this.log(`[store] write failed (${this.lastError}); retrying in ${this.backoffMs}ms, ${this.items.length} queued`);
          break;
        }
      }
    })().finally(() => {
      this.flushing = null;
      this.schedule();
    });
    return this.flushing;
  }

  /** Flush what's queued and stop accepting items. Gives up after `timeoutMs`; remaining items count as dropped. */
  async close(timeoutMs = 5000): Promise<void> {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const deadline = Date.now() + timeoutMs;
    while ((this.items.length > 0 || this.flushing) && Date.now() < deadline) {
      this.backoffMs = 0;
      await this.flushOnce();
      if (this.items.length > 0 && this.lastError) await new Promise((r) => setTimeout(r, 100));
    }
    if (this.items.length > 0) {
      this.dropped += this.items.length;
      this.log(`[store] shutdown with ${this.items.length} unwritten record(s)`);
      this.items = [];
    }
  }
}

/** Fixed-window per-key counter, so one noisy IP can't fill the database. */
export class RateLimiter {
  private windows = new Map<string, { start: number; count: number }>();
  constructor(
    private readonly maxPerWindow: number,
    private readonly windowMs = 60_000,
  ) {}

  allow(key: string, now = Date.now()): boolean {
    if (this.maxPerWindow <= 0) return true;
    if (this.windows.size > 50_000) this.sweep(now);
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    w.count++;
    return w.count <= this.maxPerWindow;
  }

  private sweep(now: number): void {
    for (const [k, w] of this.windows) if (now - w.start >= this.windowMs) this.windows.delete(k);
  }
}
