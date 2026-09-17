export interface ActivityTick {
  sourceTimeMs: number;
  score: number | null;
  active: boolean;
  reset: boolean;
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

export function activityScore(previous: Uint8Array, current: Uint8Array) {
  if (previous.length !== current.length || previous.length === 0)
    throw new Error("Activity thumbnails must have equal nonzero dimensions.");
  const differences = Array.from(current, (value, index) => value - previous[index]);
  const exposureShift = median(differences);
  let changed = 0;
  for (const difference of differences)
    if (Math.abs(difference - exposureShift) > 12) changed++;
  return changed / differences.length;
}

export class ActivityGate {
  private previous: Uint8Array | null = null;
  private previousTime: number | null = null;
  private recentHigh: boolean[] = [];
  private lowTicks = 0;
  private active = false;

  reset() {
    this.previous = null;
    this.previousTime = null;
    this.recentHigh = [];
    this.lowTicks = 0;
    this.active = false;
  }

  push(sourceTimeMs: number, grayscale: Uint8Array): ActivityTick {
    const gap =
      this.previousTime !== null && sourceTimeMs - this.previousTime > 500;
    if (gap) this.reset();
    const score = this.previous ? activityScore(this.previous, grayscale) : null;
    this.previous = Uint8Array.from(grayscale);
    this.previousTime = sourceTimeMs;
    if (score !== null) {
      this.recentHigh.push(score >= 0.04);
      this.recentHigh = this.recentHigh.slice(-3);
      if (!this.active && this.recentHigh.filter(Boolean).length >= 2)
        this.active = true;
      if (score < 0.02) this.lowTicks++;
      else this.lowTicks = 0;
      if (this.active && this.lowTicks >= 8) this.active = false;
    }
    return { sourceTimeMs, score, active: this.active, reset: gap };
  }
}

export interface ScheduledWindow {
  startMs: number;
  endMs: number;
  reasons: Array<"activity" | "periodic" | "uniform_evaluation">;
  partial: boolean;
}

export function scheduleWindows(
  durationMs: number,
  activeTimes: number[],
  mode: "cascade_uniform" | "cascade_gated",
  windowMs = 6_000,
  strideMs = 3_000,
) {
  const windows: ScheduledWindow[] = [];
  let lastActivityAdmission = -Infinity;
  let periodicDue = 6_000;
  for (let startMs = 0; startMs < durationMs; startMs += strideMs) {
    const endMs = Math.min(startMs + windowMs, durationMs);
    const partial = endMs - startMs < windowMs;
    if (partial && endMs - startMs < 500) continue;
    if (mode === "cascade_uniform") {
      windows.push({
        startMs,
        endMs,
        reasons: ["uniform_evaluation"],
        partial,
      });
      continue;
    }
    const activity = activeTimes.some(
      (time) => time >= startMs && time <= endMs,
    );
    const periodic = endMs >= periodicDue;
    const reasons: ScheduledWindow["reasons"] = [];
    if (activity && endMs - lastActivityAdmission >= 6_000) {
      reasons.push("activity");
      lastActivityAdmission = endMs;
    }
    if (periodic) {
      reasons.push("periodic");
      while (periodicDue <= endMs) periodicDue += 12_000;
    }
    // EOF/Stop flushes the final partial window even when it was quiet.
    if (!reasons.length && partial && endMs === durationMs)
      reasons.push("periodic");
    if (reasons.length) windows.push({ startMs, endMs, reasons, partial });
  }
  return windows;
}
