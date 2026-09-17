import type { Anchor, Track } from "../../../shared/studio/schema";

export interface TrackPoint {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Velocity in normalized image units per second. */
  vx: number;
  vy: number;
  visible: boolean;
}

interface Run {
  t: number[];
  x: number[];
  y: number[];
  w: number[];
  h: number[];
}

const EDGE = 0.08;

const cache = new WeakMap<Track, Run[]>();

/**
 * Visible stretches of a track, lightly smoothed. Model boxes jitter by a few
 * pixels between frames; one pass of [¼, ½, ¼] keeps motion honest but calm.
 */
function runs(track: Track): Run[] {
  const hit = cache.get(track);
  if (hit) return hit;
  const result: Run[] = [];
  let current: Track["samples"] = [];
  const flush = () => {
    if (!current.length) return;
    const smooth = (values: number[]) =>
      values.map((value, i) =>
        i === 0 || i === values.length - 1
          ? value
          : 0.25 * values[i - 1] + 0.5 * value + 0.25 * values[i + 1],
      );
    result.push({
      t: current.map((s) => s.t),
      x: smooth(current.map((s) => s.x)),
      y: smooth(current.map((s) => s.y)),
      w: current.map((s) => s.w),
      h: current.map((s) => s.h),
    });
    current = [];
  };
  for (const sample of track.samples) {
    if (sample.visible) current.push(sample);
    else flush();
  }
  flush();
  cache.set(track, result);
  return result;
}

/** Cubic Hermite with finite-difference tangents in time (handles uneven spacing). */
function hermite(times: number[], values: number[], t: number) {
  const n = times.length;
  if (n === 1) return { value: values[0], slope: 0 };
  let i = 0;
  while (i < n - 2 && t > times[i + 1]) i++;
  const t0 = times[i];
  const t1 = times[i + 1];
  const dt = Math.max(1e-6, t1 - t0);
  const tangent = (k: number) => {
    if (k <= 0) return (values[1] - values[0]) / Math.max(1e-6, times[1] - times[0]);
    if (k >= n - 1)
      return (values[n - 1] - values[n - 2]) / Math.max(1e-6, times[n - 1] - times[n - 2]);
    return (values[k + 1] - values[k - 1]) / Math.max(1e-6, times[k + 1] - times[k - 1]);
  };
  const m0 = tangent(i) * dt;
  const m1 = tangent(i + 1) * dt;
  const u = Math.min(1, Math.max(0, (t - t0) / dt));
  const u2 = u * u;
  const u3 = u2 * u;
  const p0 = values[i];
  const p1 = values[i + 1];
  const value =
    (2 * u3 - 3 * u2 + 1) * p0 + (u3 - 2 * u2 + u) * m0 + (-2 * u3 + 3 * u2) * p1 + (u3 - u2) * m1;
  const derivative =
    ((6 * u2 - 6 * u) * p0 + (3 * u2 - 4 * u + 1) * m0 + (-6 * u2 + 6 * u) * p1 + (3 * u2 - 2 * u) * m1) /
    dt;
  return { value, slope: derivative };
}

export function trackAt(track: Track | undefined, t: number): TrackPoint | null {
  if (!track) return null;
  for (const run of runs(track)) {
    const first = run.t[0];
    const last = run.t[run.t.length - 1];
    if (t < first - EDGE || t > last + EDGE) continue;
    const clamped = Math.min(last, Math.max(first, t));
    const x = hermite(run.t, run.x, clamped);
    const y = hermite(run.t, run.y, clamped);
    const w = hermite(run.t, run.w, clamped);
    const h = hermite(run.t, run.h, clamped);
    return {
      x: x.value,
      y: y.value,
      w: Math.max(0.005, w.value),
      h: Math.max(0.005, h.value),
      vx: run.t.length > 1 ? x.slope : 0,
      vy: run.t.length > 1 ? y.slope : 0,
      visible: true,
    };
  }
  return null;
}

/** Sampled positions of a track between two times (visible stretches only). */
export function trackPath(track: Track | undefined, from: number, to: number, step = 1 / 60) {
  if (!track || to <= from) return [];
  const points: Array<{ t: number; x: number; y: number }> = [];
  for (let t = from; t <= to + 1e-9; t += step) {
    const p = trackAt(track, t);
    if (p) points.push({ t, x: p.x, y: p.y });
  }
  return points;
}

export function anchorAt(
  anchor: Anchor,
  tracks: Map<string, Track>,
  t: number,
): TrackPoint | null {
  if ("track" in anchor) return trackAt(tracks.get(anchor.track), t);
  return { x: anchor.x, y: anchor.y, w: 0, h: 0, vx: 0, vy: 0, visible: true };
}

/** Time span a track is visible over. */
export function trackSpan(track: Track | undefined) {
  if (!track) return null;
  const visible = track.samples.filter((sample) => sample.visible);
  if (!visible.length) return null;
  return { from: visible[0].t, to: visible[visible.length - 1].t };
}
