import type { Engine, SimEvent } from "./types";
import { RECORD_DT, Timeline, round } from "./timeline";

export interface SpringState extends Record<string, number> {
  /** Change in length from the original shape, m; negative = squeezed. */
  x: number;
  v: number;
  /** Restoring force of the material on the hand or mass (signed). */
  force: number;
  /** Permanent change in shape after yielding (signed). */
  set: number;
  hand: number;
  energy: number;
}

const RAMP = 1.2;
const HOLD = 0.6;
const RELEASE = 0.4;
const AFTER = 2;

export const spring: Engine<SpringState> = {
  id: "spring",
  name: "Squeeze & stretch lab",
  tagline: "Springy until it isn't.",
  description:
    "Anything that deforms under a force: squeezing or crushing a bottle or can, stretching a rubber band or spring, pressing a cushion, bending a ruler, a bouncing mass on a spring. Hooke's law F = k·x up to an elastic limit; beyond it the object yields and keeps a permanent dent or stretch. Mode 0: pull or squeeze it by a set amount and let go (it oscillates). Mode 1: a hand presses (direction -1) or pulls (direction +1) with a force that ramps up, holds and releases.",
  ignores:
    "Gravity on the mass, heating, and materials that stiffen or soften as they deform.",
  params: [
    {
      key: "mode",
      label: "Experiment",
      unit: "",
      min: 0,
      max: 1,
      step: 1,
      default: 1,
      description: "0 = deform and release, 1 = press or pull by hand.",
      options: [
        { value: 0, label: "Deform & let go" },
        { value: 1, label: "Press by hand" },
      ],
    },
    {
      key: "stiffness",
      label: "Stiffness k",
      unit: "N/m",
      min: 1,
      max: 20000,
      step: 1,
      default: 1500,
      description: "Force needed per meter of deformation.",
    },
    {
      key: "elasticLimit",
      label: "Elastic limit",
      unit: "m",
      min: 0.002,
      max: 1.5,
      step: 0.001,
      default: 0.02,
      description: "Deformation it can take and still spring back fully.",
    },
    {
      key: "mass",
      label: "Moving mass",
      unit: "kg",
      min: 0.005,
      max: 100,
      step: 0.005,
      default: 0.2,
      description: "Mass that moves as it deforms.",
    },
    {
      key: "damping",
      label: "Damping",
      unit: "N·s/m",
      min: 0,
      max: 80,
      step: 0.1,
      default: 1,
      description: "Internal friction that calms vibrations.",
    },
    {
      key: "displacement",
      label: "Starting deformation",
      unit: "m",
      min: -1,
      max: 1,
      step: 0.001,
      default: 0.05,
      description: "Stretch (+) or squeeze (−) before letting go.",
      visibleWhen: (p) => p.mode === 0,
    },
    {
      key: "force",
      label: "Hand force",
      unit: "N",
      min: 0,
      max: 3000,
      step: 0.5,
      default: 45,
      description: "Largest force the hand applies.",
      visibleWhen: (p) => p.mode === 1,
    },
    {
      key: "direction",
      label: "Hand action",
      unit: "",
      min: -1,
      max: 1,
      step: 2,
      default: -1,
      description: "-1 squeezes, +1 stretches.",
      options: [
        { value: -1, label: "Squeeze" },
        { value: 1, label: "Stretch" },
      ],
      visibleWhen: (p) => p.mode === 1,
    },
  ],
  metrics: [
    {
      key: "maxForce",
      label: "Largest spring force",
      unit: "N",
      digits: 1,
      description: "Largest restoring force during the run.",
    },
    {
      key: "maxDeformation",
      label: "Largest deformation",
      unit: "m",
      digits: 3,
      description: "Largest change in shape.",
    },
    {
      key: "permanentSet",
      label: "Permanent dent or stretch",
      unit: "m",
      digits: 3,
      description: "Change in shape that stays after the force is gone.",
    },
    {
      key: "yielded",
      label: "Deformed for good",
      unit: "",
      digits: 0,
      description: "1 if it passed its elastic limit.",
    },
    {
      key: "storedEnergy",
      label: "Peak stored energy",
      unit: "J",
      digits: 3,
      description: "Largest elastic energy ½·k·x².",
    },
    {
      key: "period",
      label: "Vibration period",
      unit: "s",
      digits: 3,
      description: "2π√(m/k): time for one vibration.",
    },
  ],
  normalize(p) {
    return {
      ...p,
      mode: p.mode >= 0.5 ? 1 : 0,
      direction: p.direction >= 0 ? 1 : -1,
    };
  },
  simulate(p) {
    const k = p.stiffness;
    const m = p.mass;
    const limit = p.elasticLimit;
    const period = 2 * Math.PI * Math.sqrt(m / k);
    const byHand = p.mode === 1;
    const duration = byHand
      ? RAMP + HOLD + RELEASE + AFTER
      : Math.min(20, Math.max(3, period * 5));
    const substeps = Math.min(4000, Math.max(8, Math.ceil(RECORD_DT / (period / 80))));
    const h = RECORD_DT / substeps;
    const critical = 2 * Math.sqrt(k * m);
    const handForce = (time: number) => {
      if (!byHand) return 0;
      const peak = p.force * p.direction;
      if (time < RAMP) return (peak * time) / RAMP;
      if (time < RAMP + HOLD) return peak;
      if (time < RAMP + HOLD + RELEASE)
        return peak * (1 - (time - RAMP - HOLD) / RELEASE);
      return 0;
    };
    let x = byHand ? 0 : p.displacement;
    let set = 0;
    let yielded = 0;
    // Work hardening: past the limit the material keeps 10% of its stiffness, so a crush settles.
    const hardening = 0.1 / 0.9;
    let plastic = 0;
    const yieldTo = () => {
      const elastic = x - set;
      const allowed = limit + hardening * plastic;
      const excess = Math.abs(elastic) - allowed;
      if (excess <= 0) return;
      const flow = excess / (1 + hardening);
      set += Math.sign(elastic) * flow;
      plastic += flow;
      yielded = 1;
    };
    yieldTo();
    let v = 0;
    const springForce = () => -k * (x - set);
    const snapshot = (time: number) => {
      const f = springForce();
      return {
        x,
        v,
        force: f,
        set,
        hand: handForce(time),
        energy: (0.5 * f * f) / k,
      };
    };
    const timeline = new Timeline<SpringState>(RECORD_DT, snapshot(0));
    const events: SimEvent[] = byHand
      ? [
          { t: 0, id: "press", label: p.direction < 0 ? "Squeeze begins" : "Pull begins" },
          { t: RAMP, id: "hold", label: "Full force" },
          { t: RAMP + HOLD + RELEASE, id: "release", label: "Let go" },
        ]
      : [{ t: 0, id: "release", label: "Let go" }];
    let maxForce = Math.abs(springForce());
    let maxDeformation = Math.abs(x);
    let yieldLogged = yielded === 1;
    let t = 0;
    while (t < duration) {
      for (let s = 0; s < substeps; s++) {
        const now = t + (s / substeps) * RECORD_DT;
        const hand = handForce(now);
        // The hand holds the object steady, so the motion is heavily damped while pressing.
        const c = byHand && now < RAMP + HOLD + RELEASE ? Math.max(p.damping, 1.2 * critical) : p.damping;
        const a = (hand + springForce() - c * v) / m;
        v += a * h;
        x += v * h;
        yieldTo();
        if (yielded && !yieldLogged) {
          yieldLogged = true;
          events.push({ t: now, id: "yield", label: "Passes the elastic limit" });
        }
        const f = Math.abs(springForce());
        if (f > maxForce) maxForce = f;
        if (Math.abs(x) > maxDeformation) maxDeformation = Math.abs(x);
      }
      t += RECORD_DT;
      timeline.push(snapshot(t));
    }
    events.sort((a, b) => a.t - b.t);
    const deformations: Array<[number, number]> = [];
    const stride = Math.max(1, Math.ceil(timeline.length / 300));
    for (let i = 0; i < timeline.length; i += stride) {
      const state = timeline.at(i);
      deformations.push([round(state.x, 5), round(-state.force, 4)]);
    }
    return {
      duration: timeline.duration,
      sample: (time) => timeline.sample(time),
      metrics: {
        maxForce: round(maxForce, 3),
        maxDeformation: round(maxDeformation, 5),
        permanentSet: round(Math.abs(set), 5),
        yielded,
        storedEnergy: round((0.5 * maxForce * maxForce) / k, 5),
        period: round(period, 5),
      },
      events,
      series: [
        timeline.series("x", "Deformation", "m"),
        {
          ...timeline.series("force", "Spring force", "N", (value) => -value),
        },
        {
          key: "curve",
          label: "Force vs deformation",
          unit: "N",
          xLabel: "Deformation",
          xUnit: "m",
          points: deformations,
        },
      ],
    };
  },
};
