// Physics lab engines: deterministic simulations shared by the server (to
// verify what the lesson designer claims) and the browser (to animate them).

export const ENGINE_IDS = [
  "projectile",
  "surface",
  "rotation",
  "balance",
  "pendulum",
  "collision",
  "spring",
  "buoyancy",
] as const;
export type EngineId = (typeof ENGINE_IDS)[number];

export type Params = Record<string, number>;

export interface ParamSpec {
  key: string;
  label: string;
  unit: string;
  /** Hard limits; agent ranges are clamped inside them. */
  min: number;
  max: number;
  step: number;
  default: number;
  description: string;
  /** Discrete settings render as segmented choices instead of sliders. */
  options?: Array<{ value: number; label: string }>;
  /** Hidden unless the predicate holds for the current parameters. */
  visibleWhen?: (params: Params) => boolean;
}

export interface MetricSpec {
  key: string;
  label: string;
  unit: string;
  digits: number;
  description: string;
}

export interface SimEvent {
  t: number;
  id: string;
  label: string;
}

export interface SimSeries {
  key: string;
  label: string;
  unit: string;
  /** Chart x axis; defaults to time. */
  xLabel?: string;
  xUnit?: string;
  points: Array<[number, number]>;
}

export interface Simulation<S> {
  /** Seconds of simulated motion worth animating. */
  duration: number;
  sample(t: number): S;
  /** null when a metric does not apply to this run (for example, it never stops). */
  metrics: Record<string, number | null>;
  events: SimEvent[];
  series: SimSeries[];
}

export interface Engine<S = Record<string, number>> {
  id: EngineId;
  name: string;
  tagline: string;
  /** Written for the lesson designer: what situations this engine models. */
  description: string;
  /** Idealizations shown to learners. */
  ignores: string;
  params: ParamSpec[];
  metrics: MetricSpec[];
  /** Enforces relations between parameters, such as kinetic ≤ static friction. */
  normalize?(params: Params): Params;
  simulate(params: Params): Simulation<S>;
}
