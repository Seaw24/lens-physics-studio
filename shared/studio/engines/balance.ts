import type { Engine, Params, SimEvent } from "./types";
import { DEG, RECORD_DT, Timeline, round } from "./timeline";

export interface BalanceState extends Record<string, number> {
  /** Beam tilt, radians; positive means the right end goes down. */
  theta: number;
  omega: number;
  /** Position along the beam (from its left end) the beam rotates about. */
  axis: number;
  tipping: number;
}

const SUBSTEPS = 8;
const PIVOT_LIMIT = 18 * DEG;
const TIP_LIMIT = 32 * DEG;

export interface BalanceLoad {
  mass: number;
  x: number;
}

export function balanceLoads(p: Params): BalanceLoad[] {
  return [
    { mass: p.mass1, x: p.pos1 },
    { mass: p.mass2, x: p.pos2 },
    { mass: p.mass3, x: p.pos3 },
  ].filter((load) => load.mass > 0);
}

/** Support reactions for a beam resting on two supports; negative means it would tip. */
export function supportReactions(p: Params) {
  const g = p.gravity;
  const weights = [
    ...balanceLoads(p).map((load) => ({ w: load.mass * g, x: load.x })),
    { w: p.beamMass * g, x: p.beamLength / 2 },
  ];
  const total = weights.reduce((sum, item) => sum + item.w, 0);
  const span = Math.max(1e-6, p.support2 - p.support1);
  const r2 =
    weights.reduce((sum, item) => sum + item.w * (item.x - p.support1), 0) /
    span;
  return { r1: total - r2, r2, total };
}

function torqueAbout(p: Params, axis: number) {
  const g = p.gravity;
  return (
    balanceLoads(p).reduce(
      (sum, load) => sum + load.mass * g * (load.x - axis),
      0,
    ) +
    p.beamMass * g * (p.beamLength / 2 - axis)
  );
}

function inertiaAbout(p: Params, axis: number) {
  const beam =
    p.beamMass *
    ((p.beamLength * p.beamLength) / 12 + (p.beamLength / 2 - axis) ** 2);
  return Math.max(
    1e-6,
    beam +
      balanceLoads(p).reduce(
        (sum, load) => sum + load.mass * (load.x - axis) ** 2,
        0,
      ),
  );
}

export const balance: Engine<BalanceState> = {
  id: "balance",
  name: "Balance lab",
  tagline: "Loads, supports and the torques that tip them.",
  description:
    "Static equilibrium of a beam, plank, shelf, tabletop or seesaw carrying up to three loads. Support mode 0: one pivot (seesaw, balance scale, a lever resting on a fulcrum) — it balances only when clockwise and counter-clockwise torques cancel. Support mode 1: two supports (table legs, shelf brackets, a plank on two blocks, stacked items spread on a table) — the supports share the load, and it tips when the combined center of mass moves past a support. Use it for objects resting on, stacked on, or supported by something.",
  ignores:
    "Bending of the beam and sliding of loads. The beam's own weight acts at its middle.",
  params: [
    {
      key: "beamLength",
      label: "Beam length",
      unit: "m",
      min: 0.2,
      max: 8,
      step: 0.01,
      default: 3,
      description: "Length of the beam, plank or tabletop.",
    },
    {
      key: "beamMass",
      label: "Beam mass",
      unit: "kg",
      min: 0,
      max: 150,
      step: 0.1,
      default: 8,
      description: "Mass of the beam itself.",
    },
    {
      key: "support",
      label: "Support",
      unit: "",
      min: 0,
      max: 1,
      step: 1,
      default: 0,
      description: "0 = a single pivot, 1 = two supports.",
      options: [
        { value: 0, label: "One pivot" },
        { value: 1, label: "Two supports" },
      ],
    },
    {
      key: "pivot",
      label: "Pivot position",
      unit: "m",
      min: 0,
      max: 8,
      step: 0.01,
      default: 1.5,
      description: "Distance of the pivot from the left end.",
      visibleWhen: (p) => p.support === 0,
    },
    {
      key: "support1",
      label: "Left support",
      unit: "m",
      min: 0,
      max: 8,
      step: 0.01,
      default: 0.5,
      description: "Distance of the left support from the left end.",
      visibleWhen: (p) => p.support === 1,
    },
    {
      key: "support2",
      label: "Right support",
      unit: "m",
      min: 0,
      max: 8,
      step: 0.01,
      default: 2.5,
      description: "Distance of the right support from the left end.",
      visibleWhen: (p) => p.support === 1,
    },
    {
      key: "mass1",
      label: "Load A mass",
      unit: "kg",
      min: 0,
      max: 200,
      step: 0.1,
      default: 30,
      description: "Mass of the first load.",
    },
    {
      key: "pos1",
      label: "Load A position",
      unit: "m",
      min: 0,
      max: 8,
      step: 0.01,
      default: 0.4,
      description: "Distance of load A from the left end.",
    },
    {
      key: "mass2",
      label: "Load B mass",
      unit: "kg",
      min: 0,
      max: 200,
      step: 0.1,
      default: 20,
      description: "Mass of the second load.",
    },
    {
      key: "pos2",
      label: "Load B position",
      unit: "m",
      min: 0,
      max: 8,
      step: 0.01,
      default: 2.6,
      description: "Distance of load B from the left end.",
    },
    {
      key: "mass3",
      label: "Load C mass",
      unit: "kg",
      min: 0,
      max: 200,
      step: 0.1,
      default: 0,
      description: "Mass of the third load (0 removes it).",
    },
    {
      key: "pos3",
      label: "Load C position",
      unit: "m",
      min: 0,
      max: 8,
      step: 0.01,
      default: 1.5,
      description: "Distance of load C from the left end.",
      visibleWhen: (p) => p.mass3 > 0,
    },
    {
      key: "gravity",
      label: "Gravity",
      unit: "m/s²",
      min: 1,
      max: 25,
      step: 0.01,
      default: 9.81,
      description: "Gravitational field strength.",
      options: [
        { value: 1.62, label: "Moon" },
        { value: 9.81, label: "Earth" },
      ],
    },
  ],
  metrics: [
    {
      key: "balanced",
      label: "Stays balanced",
      unit: "",
      digits: 0,
      description: "1 if it stays level (pivot) or stays on both supports.",
    },
    {
      key: "netTorque",
      label: "Net torque",
      unit: "N·m",
      digits: 1,
      description:
        "About the pivot (or the tipping support); positive turns the right end down.",
    },
    {
      key: "tipDirection",
      label: "Tips toward",
      unit: "",
      digits: 0,
      description: "-1 = left end drops, 0 = stays, 1 = right end drops.",
    },
    {
      key: "leftSupportForce",
      label: "Left support force",
      unit: "N",
      digits: 1,
      description: "Upward force from the left support (or the pivot).",
    },
    {
      key: "rightSupportForce",
      label: "Right support force",
      unit: "N",
      digits: 1,
      description: "Upward force from the right support (0 with one pivot).",
    },
    {
      key: "centerOfMass",
      label: "Center of mass",
      unit: "m",
      digits: 2,
      description: "Distance of the combined center of mass from the left end.",
    },
    {
      key: "totalWeight",
      label: "Total weight",
      unit: "N",
      digits: 1,
      description: "Weight of the beam and all loads.",
    },
  ],
  normalize(p) {
    const L = p.beamLength;
    const fit = (value: number) => Math.min(L, Math.max(0, value));
    let s1 = fit(p.support1);
    let s2 = fit(p.support2);
    if (s1 > s2) [s1, s2] = [s2, s1];
    if (s2 - s1 < 0.02) {
      s2 = Math.min(L, s1 + 0.02);
      s1 = Math.max(0, s2 - 0.02);
    }
    return {
      ...p,
      support: Math.round(Math.min(1, Math.max(0, p.support))),
      pivot: fit(p.pivot),
      support1: s1,
      support2: s2,
      pos1: fit(p.pos1),
      pos2: fit(p.pos2),
      pos3: fit(p.pos3),
    };
  },
  simulate(p) {
    const g = p.gravity;
    const loads = balanceLoads(p);
    const totalMass = p.beamMass + loads.reduce((s, l) => s + l.mass, 0);
    const totalWeight = totalMass * g;
    const centerOfMass =
      totalMass > 0
        ? (p.beamMass * (p.beamLength / 2) +
            loads.reduce((s, l) => s + l.mass * l.x, 0)) /
          totalMass
        : p.beamLength / 2;
    let axis: number;
    let torque0: number;
    let limit: number;
    let balanced: number;
    let left: number;
    let right: number;
    if (p.support === 0) {
      axis = p.pivot;
      torque0 = torqueAbout(p, axis);
      // Pivot friction holds a near-perfect balance level.
      const hold = 0.004 * totalWeight * Math.max(0.2, p.beamLength);
      balanced = Math.abs(torque0) <= hold ? 1 : 0;
      if (balanced) torque0 = 0;
      limit = PIVOT_LIMIT;
      left = totalWeight;
      right = 0;
    } else {
      const { r1, r2 } = supportReactions(p);
      left = r1;
      right = r2;
      if (r1 < -1e-9) {
        axis = p.support2;
        torque0 = torqueAbout(p, axis);
        balanced = 0;
      } else if (r2 < -1e-9) {
        axis = p.support1;
        torque0 = torqueAbout(p, axis);
        balanced = 0;
      } else {
        axis = (p.support1 + p.support2) / 2;
        torque0 = 0;
        balanced = 1;
      }
      limit = TIP_LIMIT;
    }
    const inertia = inertiaAbout(p, axis);
    let theta = 0;
    let omega = 0;
    let t = 0;
    const tipping = torque0 !== 0 ? 1 : 0;
    const timeline = new Timeline<BalanceState>(RECORD_DT, {
      theta,
      omega,
      axis,
      tipping,
    });
    const events: SimEvent[] = [];
    let settledAt: number | null = tipping ? null : 0;
    const h = RECORD_DT / SUBSTEPS;
    while (t < 12) {
      for (let s = 0; s < SUBSTEPS && tipping && settledAt === null; s++) {
        const alpha = (torque0 * Math.cos(theta)) / inertia;
        omega += alpha * h;
        theta += omega * h;
        if (Math.abs(theta) >= limit) {
          theta = Math.sign(theta) * limit;
          omega = 0;
          settledAt = t + ((s + 1) / SUBSTEPS) * RECORD_DT;
          events.push({
            t: settledAt,
            id: "rest",
            label: theta > 0 ? "Right end comes down" : "Left end comes down",
          });
        }
      }
      t += RECORD_DT;
      timeline.push({ theta, omega, axis, tipping });
      if (settledAt !== null && t >= settledAt + 1) break;
    }
    return {
      duration: timeline.duration,
      sample: (time) => timeline.sample(time),
      metrics: {
        balanced,
        netTorque: round(torque0, 3),
        tipDirection: balanced ? 0 : Math.sign(torque0),
        leftSupportForce: round(left, 3),
        rightSupportForce: round(right, 3),
        centerOfMass: round(centerOfMass, 4),
        totalWeight: round(totalWeight, 3),
      },
      events,
      series: [
        timeline.series("theta", "Tilt", "°", (value) => value / DEG),
      ],
    };
  },
};
