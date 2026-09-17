// Serial upload with two queued batches. Stale unsent footage is dropped,
// rather than allowing capture or network latency to grow an unbounded queue.
export class CaptureQueue<T> {
  private pending: T[] = [];
  private active: Promise<void> | null = null;
  private closed = false;
  constructor(
    private send: (batch: T) => Promise<void>,
    private dropped: () => void,
    private failed: (error: unknown) => void,
  ) {}
  enqueue(batch: T) {
    if (this.closed) return;
    this.pending.push(batch);
    if (this.pending.length > 2) { this.pending.shift(); this.dropped(); }
    this.pump();
  }
  private pump() {
    if (this.active || this.closed || !this.pending.length) return;
    const next = this.pending.shift()!;
    this.active = Promise.resolve().then(() => this.send(next)).catch(error => {
      this.closed = true;
      this.pending = [];
      this.failed(error);
    }).finally(() => { this.active = null; this.pump(); });
  }
  async drain() {
    while (this.active) await this.active;
  }
  close() { this.closed = true; this.pending = []; }
}
