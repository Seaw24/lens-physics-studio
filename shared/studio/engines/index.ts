import { balance } from "./balance";
import { buoyancy } from "./buoyancy";
import { collision } from "./collision";
import { pendulum } from "./pendulum";
import { projectile } from "./projectile";
import { rotation } from "./rotation";
import { spring } from "./spring";
import { surface } from "./surface";
import type { Engine, EngineId, Params, Simulation } from "./types";

export * from "./types";

export const ENGINES: Record<EngineId, Engine<any>> = {
  projectile,
  surface,
  rotation,
  balance,
  pendulum,
  collision,
  spring,
  buoyancy,
};

export function getEngine(id: string): Engine<any> | null {
  return (ENGINES as Record<string, Engine<any>>)[id] ?? null;
}

export function defaultParams(engine: Engine<any>): Params {
  return Object.fromEntries(engine.params.map((spec) => [spec.key, spec.default]));
}

/** Defaults, then overrides, clamped to hard limits and snapped to discrete options. */
export function resolveParams(
  engine: Engine<any>,
  overrides: Record<string, number | undefined> = {},
): Params {
  const values: Params = {};
  for (const spec of engine.params) {
    const raw = overrides[spec.key];
    let value = typeof raw === "number" && Number.isFinite(raw) ? raw : spec.default;
    value = Math.min(spec.max, Math.max(spec.min, value));
    if (spec.options?.length && spec.step >= 1)
      value = spec.options.reduce((best, option) =>
        Math.abs(option.value - value) < Math.abs(best.value - value) ? option : best,
      ).value;
    values[spec.key] = value;
  }
  return engine.normalize ? engine.normalize(values) : values;
}

const cache = new WeakMap<Engine<any>, Map<string, Simulation<any>>>();

/** Simulations are pure; memoize the most recent parameter sets per engine. */
export function runEngine(engine: Engine<any>, params: Params): Simulation<any> {
  let entries = cache.get(engine);
  if (!entries) cache.set(engine, (entries = new Map()));
  const key = engine.params.map((spec) => params[spec.key]).join("|");
  const hit = entries.get(key);
  if (hit) return hit;
  const result = engine.simulate(params);
  entries.set(key, result);
  if (entries.size > 24) entries.delete(entries.keys().next().value!);
  return result;
}

export type Direction = "increase" | "decrease" | "same";

export interface MetricComparison {
  before: number | null;
  after: number | null;
  direction: Direction | null;
  /** after / before when both are non-zero numbers. */
  ratio: number | null;
}

/** Changes smaller than 2% of the larger value count as "the same". */
export function compareMetric(
  before: number | null | undefined,
  after: number | null | undefined,
): MetricComparison {
  const b = before ?? null;
  const a = after ?? null;
  if (b === null || a === null)
    return {
      before: b,
      after: a,
      direction: b === null && a === null ? "same" : null,
      ratio: null,
    };
  const scale = Math.max(Math.abs(a), Math.abs(b));
  const delta = a - b;
  const direction: Direction =
    scale < 1e-9 || Math.abs(delta) <= 0.02 * scale
      ? "same"
      : delta > 0
        ? "increase"
        : "decrease";
  return {
    before: b,
    after: a,
    direction,
    ratio: Math.abs(b) > 1e-9 ? a / b : null,
  };
}

export function runExperiment(
  engine: Engine<any>,
  base: Params,
  change: Record<string, number>,
  metric: string,
) {
  const baseline = runEngine(engine, resolveParams(engine, base));
  const changedParams = resolveParams(engine, { ...base, ...change });
  const changed = runEngine(engine, changedParams);
  return {
    params: changedParams,
    baseline,
    changed,
    comparison: compareMetric(baseline.metrics[metric], changed.metrics[metric]),
  };
}

/** Compact catalog for the lesson designer's prompt. */
export function engineCatalogText() {
  return Object.values(ENGINES)
    .map((engine) =>
      [
        `ENGINE ${engine.id} — ${engine.name}: ${engine.description}`,
        `  Ignores: ${engine.ignores}`,
        `  Params: ${engine.params
          .map(
            (spec) =>
              `${spec.key} (${spec.label}${spec.unit ? `, ${spec.unit}` : ""}; ${spec.min}–${spec.max}; default ${spec.default}${
                spec.options
                  ? `; options ${spec.options.map((o) => `${o.value}=${o.label}`).join(", ")}`
                  : ""
              }) ${spec.description}`,
          )
          .join(" | ")}`,
        `  Metrics: ${engine.metrics
          .map(
            (spec) =>
              `${spec.key} (${spec.label}${spec.unit ? `, ${spec.unit}` : ""}) ${spec.description}`,
          )
          .join(" | ")}`,
      ].join("\n"),
    )
    .join("\n\n");
}
