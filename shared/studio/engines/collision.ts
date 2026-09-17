import type { Engine, SimEvent } from "./types";
import { RECORD_DT, Timeline, round } from "./timeline";

export interface CollisionState extends Record<string, number> {
  x1: number;
  x2: number;
  v1: number;
  v2: number;
  /** Force on body 2 from body 1 (body 1 feels the opposite). */
  force: number;
  contact: number;
}

/** Visual and contact width of a body, growing gently with mass. */
export function bodyWidth(mass: number) {
  return Math.min(1.1, Math.max(0.12, 0.26 * Math.cbrt(mass)));
}

const APPROACH_TIME = 1;
const SUBSTEPS = 20;

export const collision: Engine<CollisionState> = {
  id: "collision",
  name: "Impact lab",
  tagline: "Momentum is shared; force depends on how fast it happens.",
  description:
    "Two bodies meeting along a line: a hit, bump, kick, catch, tap, a ball striking a wall or another object, a push between two people or carts, one object knocking another. Momentum is conserved; elasticity decides how much bounce is kept, and the contact time decides how large the force is for the same impulse. Body 1 starts on the left; positive velocity is to the right. A very massive, still body 2 behaves like a wall.",
  ignores:
    "Rotation, friction with the ground and deformation details; contact force follows a smooth pulse.",
  params: [
    {
      key: "mass1",
      label: "Mass of body 1",
      unit: "kg",
      min: 0.005,
      max: 2000,
      step: 0.005,
      default: 0.6,
      description: "The body starting on the left.",
    },
    {
      key: "speed1",
      label: "Velocity of body 1",
      unit: "m/s",
      min: -30,
      max: 30,
      step: 0.1,
      default: 5,
      description: "Positive moves right.",
    },
    {
      key: "mass2",
      label: "Mass of body 2",
      unit: "kg",
      min: 0.005,
      max: 2000,
      step: 0.005,
      default: 0.6,
      description: "The body starting on the right.",
    },
    {
      key: "speed2",
      label: "Velocity of body 2",
      unit: "m/s",
      min: -30,
      max: 30,
      step: 0.1,
      default: 0,
      description: "Positive moves right.",
    },
    {
      key: "elasticity",
      label: "Bounciness",
      unit: "",
      min: 0,
      max: 1,
      step: 0.01,
      default: 0.6,
      description: "1 keeps all bounce; 0 means they stick together.",
    },
    {
      key: "contactTime",
      label: "Contact time",
      unit: "s",
      min: 0.001,
      max: 0.6,
      step: 0.001,
      default: 0.04,
      description: "How long they touch; padding makes it longer.",
    },
  ],
  metrics: [
    {
      key: "collides",
      label: "They collide",
      unit: "",
      digits: 0,
      description: "1 if the bodies approach and touch.",
    },
    {
      key: "v1After",
      label: "Body 1 velocity after",
      unit: "m/s",
      digits: 2,
      description: "Velocity of body 1 after contact.",
    },
    {
      key: "v2After",
      label: "Body 2 velocity after",
      unit: "m/s",
      digits: 2,
      description: "Velocity of body 2 after contact.",
    },
    {
      key: "momentumBefore",
      label: "Total momentum before",
      unit: "kg·m/s",
      digits: 2,
      description: "m₁v₁ + m₂v₂ before contact.",
    },
    {
      key: "momentumAfter",
      label: "Total momentum after",
      unit: "kg·m/s",
      digits: 2,
      description: "m₁v₁′ + m₂v₂′ after contact.",
    },
    {
      key: "energyLost",
      label: "Kinetic energy lost",
      unit: "%",
      digits: 0,
      description: "Share of kinetic energy turned into heat, sound and dents.",
    },
    {
      key: "impulse",
      label: "Impulse on body 2",
      unit: "N·s",
      digits: 3,
      description: "Change in body 2's momentum.",
    },
    {
      key: "peakForce",
      label: "Peak contact force",
      unit: "N",
      digits: 1,
      description: "Largest force during contact.",
    },
    {
      key: "averageForce",
      label: "Average contact force",
      unit: "N",
      digits: 1,
      description: "Impulse divided by contact time.",
    },
  ],
  simulate(p) {
    const { mass1: m1, mass2: m2, speed1: u1, speed2: u2 } = p;
    const w1 = bodyWidth(m1);
    const w2 = bodyWidth(m2);
    const collides = u1 > u2 ? 1 : 0;
    const e = p.elasticity;
    const total = m1 + m2;
    const v1f = collides ? (m1 * u1 + m2 * u2 + m2 * e * (u2 - u1)) / total : u1;
    const v2f = collides ? (m1 * u1 + m2 * u2 + m1 * e * (u1 - u2)) / total : u2;
    const dt = p.contactTime;
    const impulse = m2 * (v2f - u2);
    const tc = collides ? APPROACH_TIME : Infinity;
    let x1 = collides ? -w1 / 2 - u1 * tc : -w1 / 2 - 0.8;
    let x2 = collides ? w2 / 2 - u2 * tc : w2 / 2 + 0.8;
    const duration = collides ? tc + dt + 1.6 : 3;
    const velocities = (time: number) => {
      if (time <= tc) return { v1: u1, v2: u2, force: 0, contact: 0 };
      if (time >= tc + dt) return { v1: v1f, v2: v2f, force: 0, contact: 0 };
      const tau = (time - tc) / dt;
      const share = (1 - Math.cos(Math.PI * tau)) / 2;
      return {
        v1: u1 + (v1f - u1) * share,
        v2: u2 + (v2f - u2) * share,
        force: impulse * (Math.PI / (2 * dt)) * Math.sin(Math.PI * tau),
        contact: 1,
      };
    };
    const first = velocities(0);
    const timeline = new Timeline<CollisionState>(RECORD_DT, {
      x1,
      x2,
      ...first,
    });
    const events: SimEvent[] = [];
    if (collides) {
      events.push({ t: tc, id: "contact", label: "Contact" });
      events.push({ t: tc + dt, id: "separate", label: "Contact ends" });
    }
    let t = 0;
    const h = RECORD_DT / SUBSTEPS;
    while (t < duration) {
      for (let s = 0; s < SUBSTEPS; s++) {
        const a = velocities(t + (s / SUBSTEPS) * RECORD_DT);
        const b = velocities(t + ((s + 1) / SUBSTEPS) * RECORD_DT);
        x1 += ((a.v1 + b.v1) / 2) * h;
        x2 += ((a.v2 + b.v2) / 2) * h;
      }
      t += RECORD_DT;
      // Contact cannot let the bodies pass through each other.
      const overlap = (w1 + w2) / 2 - (x2 - x1);
      if (collides && overlap > 0 && t >= tc) {
        x1 -= (overlap * m2) / total;
        x2 += (overlap * m1) / total;
      }
      timeline.push({ x1, x2, ...velocities(t) });
    }
    const before = 0.5 * m1 * u1 * u1 + 0.5 * m2 * u2 * u2;
    const after = 0.5 * m1 * v1f * v1f + 0.5 * m2 * v2f * v2f;
    // Contact can be far shorter than a recorded frame, so the pulse is sampled analytically.
    const forcePoints: Array<[number, number]> = [];
    if (collides) {
      const from = Math.max(0, tc - dt);
      forcePoints.push([0, 0], [round(from, 5), 0]);
      for (let i = 0; i <= 48; i++) {
        const time = tc + (i / 48) * dt;
        forcePoints.push([round(time, 6), round(velocities(time).force, 4)]);
      }
      forcePoints.push([round(tc + 2 * dt, 5), 0], [round(duration, 4), 0]);
    } else forcePoints.push([0, 0], [round(duration, 4), 0]);
    return {
      duration: timeline.duration,
      sample: (time) => timeline.sample(time),
      metrics: {
        collides,
        v1After: round(v1f, 4),
        v2After: round(v2f, 4),
        momentumBefore: round(m1 * u1 + m2 * u2, 4),
        momentumAfter: round(m1 * v1f + m2 * v2f, 4),
        energyLost: before > 0 ? round(((before - after) / before) * 100, 3) : 0,
        impulse: round(impulse, 5),
        peakForce: collides ? round(Math.abs(impulse) * (Math.PI / (2 * dt)), 3) : 0,
        averageForce: collides ? round(Math.abs(impulse) / dt, 3) : 0,
      },
      events,
      series: [
        timeline.series("v1", "Body 1 velocity", "m/s"),
        timeline.series("v2", "Body 2 velocity", "m/s"),
        {
          key: "force",
          label: "Contact force on body 2",
          unit: "N",
          points: forcePoints,
        },
      ],
    };
  },
};
