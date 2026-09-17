import type { SimSeries } from "./types";

/**
 * Fixed-step recording of flat numeric state. Sampling interpolates linearly,
 * so animation stays smooth at any frame rate while the integrator runs finely.
 */
export class Timeline<S extends Record<string, number>> {
  private readonly keys: (keyof S & string)[];
  private readonly columns: number[][];
  private count = 0;

  constructor(
    readonly dt: number,
    first: S,
  ) {
    this.keys = Object.keys(first) as (keyof S & string)[];
    this.columns = this.keys.map(() => []);
    this.push(first);
  }

  push(state: S) {
    for (let i = 0; i < this.keys.length; i++)
      this.columns[i].push(state[this.keys[i]]);
    this.count++;
  }

  get length() {
    return this.count;
  }

  get duration() {
    return (this.count - 1) * this.dt;
  }

  at(index: number): S {
    const i = Math.max(0, Math.min(this.count - 1, index));
    const out = {} as Record<string, number>;
    for (let k = 0; k < this.keys.length; k++)
      out[this.keys[k]] = this.columns[k][i];
    return out as S;
  }

  sample(t: number): S {
    if (!(t > 0)) return this.at(0);
    const f = t / this.dt;
    const i = Math.floor(f);
    if (i >= this.count - 1) return this.at(this.count - 1);
    const w = f - i;
    const out = {} as Record<string, number>;
    for (let k = 0; k < this.keys.length; k++) {
      const a = this.columns[k][i];
      const b = this.columns[k][i + 1];
      out[this.keys[k]] = a + (b - a) * w;
    }
    return out as S;
  }

  /** Downsampled column for charts. */
  series(
    key: keyof S & string,
    label: string,
    unit: string,
    transform: (value: number) => number = (value) => value,
    maxPoints = 240,
  ): SimSeries {
    const column = this.columns[this.keys.indexOf(key)];
    const stride = Math.max(1, Math.ceil(this.count / maxPoints));
    const points: Array<[number, number]> = [];
    for (let i = 0; i < this.count; i += stride)
      points.push([round(i * this.dt, 4), round(transform(column[i]), 5)]);
    if ((this.count - 1) % stride !== 0)
      points.push([
        round((this.count - 1) * this.dt, 4),
        round(transform(column[this.count - 1]), 5),
      ]);
    return { key, label, unit, points };
  }

  column(key: keyof S & string) {
    return this.columns[this.keys.indexOf(key)];
  }
}

export function round(value: number, digits = 3) {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

export const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

export const DEG = Math.PI / 180;

/** Recording step: fine enough for the integrators to stay stable. */
export const RECORD_DT = 1 / 120;
