import type { Engine, SimEvent } from "./types";
import { DEG, RECORD_DT, Timeline, round } from "./timeline";

export interface RotationState extends Record<string, number> {
  /** Rotation from the starting position, radians. */
  theta: number;
  omega: number;
  alpha: number;
  torque: number;
  resisting: number;
  pushing: number;
  moving: number;
}

const SUBSTEPS = 10;
const REST_OMEGA = 1e-3;
/** A door-like rod cannot swing through its own wall. */
const DOOR_STOP = 175 * DEG;

export const ROTATION_SHAPES = [
  { value: 0, label: "Door / lever (pivot at one end)" },
  { value: 1, label: "Wheel / lid / cap (pivot at the center)" },
  { value: 2, label: "Bar (pivot in the middle)" },
] as const;

export function momentOfInertia(shape: number, mass: number, length: number) {
  if (shape === 1) return 0.5 * mass * length * length;
  if (shape === 2) return (mass * length * length) / 12;
  return (mass * length * length) / 3;
}

/** Farthest point from the pivot where a force can be applied. */
export function maxLeverArm(shape: number, length: number) {
  return shape === 2 ? length / 2 : length;
}

export const rotation: Engine<RotationState> = {
  id: "rotation",
  name: "Torque lab",
  tagline: "Where you push decides how it turns.",
  description:
    "A rigid body turning about a fixed pivot: a door on its hinges, a lever door handle, a wrench, a pull-tab lifting about its rivet, a jar lid or bottle cap being twisted, a wheel, a can spun about its axis, a seesaw-like bar. A force is applied at a chosen distance from the pivot and angle to the lever for a chosen time; torque = r·F·sin(angle) must beat a resisting torque (hinge or cap friction) to start rotation. Shapes: 0 = pivot at one end (door, lever, handle, tab), 1 = pivot at the center of a disc (cap, lid, wheel, can), 2 = bar pivoting at its middle.",
  ignores:
    "Flexing of the body, air resistance and friction that changes with speed.",
  params: [
    {
      key: "force",
      label: "Applied force",
      unit: "N",
      min: 0,
      max: 400,
      step: 0.1,
      default: 20,
      description: "Size of the push, pull or twist.",
    },
    {
      key: "leverArm",
      label: "Distance from pivot",
      unit: "m",
      min: 0.005,
      max: 2.5,
      step: 0.005,
      default: 0.75,
      description: "Where the force is applied, measured from the pivot.",
    },
    {
      key: "forceAngle",
      label: "Force angle to the lever",
      unit: "°",
      min: 0,
      max: 180,
      step: 1,
      default: 90,
      description: "90° pushes square-on; 0° or 180° pushes straight along the lever.",
    },
    {
      key: "mass",
      label: "Mass",
      unit: "kg",
      min: 0.005,
      max: 80,
      step: 0.005,
      default: 20,
      description: "Mass of the turning body.",
    },
    {
      key: "length",
      label: "Size (length or radius)",
      unit: "m",
      min: 0.01,
      max: 2.5,
      step: 0.005,
      default: 0.9,
      description: "Length of the lever or door, or radius of a disc.",
    },
    {
      key: "shape",
      label: "Pivot",
      unit: "",
      min: 0,
      max: 2,
      step: 1,
      default: 0,
      description: "0 = at one end, 1 = at a disc's center, 2 = in the middle of a bar.",
      options: ROTATION_SHAPES.map((option) => ({ ...option })),
    },
    {
      key: "resistance",
      label: "Resisting torque",
      unit: "N·m",
      min: 0,
      max: 60,
      step: 0.01,
      default: 1.5,
      description: "Hinge, latch or cap friction that must be overcome.",
    },
    {
      key: "pushTime",
      label: "Push duration",
      unit: "s",
      min: 0,
      max: 5,
      step: 0.05,
      default: 0.4,
      description: "How long the force keeps acting.",
    },
    {
      key: "targetAngle",
      label: "Goal angle",
      unit: "°",
      min: 5,
      max: 720,
      step: 1,
      default: 90,
      description: "Rotation that counts as done (door open, cap loosened).",
    },
  ],
  metrics: [
    {
      key: "torque",
      label: "Applied torque",
      unit: "N·m",
      digits: 2,
      description: "r·F·sin(angle).",
    },
    {
      key: "momentOfInertia",
      label: "Moment of inertia",
      unit: "kg·m²",
      digits: 3,
      description: "How hard the body is to spin up.",
    },
    {
      key: "angularAcceleration",
      label: "Angular acceleration",
      unit: "rad/s²",
      digits: 2,
      description: "(torque − resisting torque) / moment of inertia while pushed.",
    },
    {
      key: "maxAngularSpeed",
      label: "Top spin rate",
      unit: "rad/s",
      digits: 2,
      description: "Greatest angular speed.",
    },
    {
      key: "finalAngle",
      label: "Final angle",
      unit: "°",
      digits: 1,
      description: "How far it has turned when it settles.",
    },
    {
      key: "timeToTarget",
      label: "Time to reach the goal",
      unit: "s",
      digits: 2,
      description: "When the goal angle is first reached (null if never).",
    },
    {
      key: "startsTurning",
      label: "Starts turning",
      unit: "",
      digits: 0,
      description: "1 if the applied torque beats the resisting torque, else 0.",
    },
  ],
  normalize(p) {
    const shape = Math.round(Math.min(2, Math.max(0, p.shape)));
    return {
      ...p,
      shape,
      leverArm: Math.min(p.leverArm, maxLeverArm(shape, p.length)),
    };
  },
  simulate(p) {
    const inertia = Math.max(1e-9, momentOfInertia(p.shape, p.mass, p.length));
    const applied = p.leverArm * p.force * Math.sin(p.forceAngle * DEG);
    const hasPush = p.pushTime > 0 && Math.abs(applied) > 0;
    const target = p.targetAngle * DEG;
    const door = p.shape === 0;
    const state = (time: number, omega: number) => {
      const pushing = hasPush && time < p.pushTime ? 1 : 0;
      const torque = pushing ? applied : 0;
      if (Math.abs(omega) < REST_OMEGA) {
        if (Math.abs(torque) <= p.resistance + 1e-9)
          return { pushing, torque, resisting: -torque, alpha: 0, moving: 0 };
        const resisting = -Math.sign(torque) * p.resistance;
        return {
          pushing,
          torque,
          resisting,
          alpha: (torque + resisting) / inertia,
          moving: 1,
        };
      }
      const resisting = -Math.sign(omega) * p.resistance;
      return {
        pushing,
        torque,
        resisting,
        alpha: (torque + resisting) / inertia,
        moving: 1,
      };
    };
    let theta = 0;
    let omega = 0;
    let t = 0;
    const first = state(0, 0);
    const timeline = new Timeline<RotationState>(RECORD_DT, {
      theta,
      omega,
      alpha: first.alpha,
      torque: first.torque,
      resisting: first.resisting,
      pushing: first.pushing,
      moving: 0,
    });
    const events: SimEvent[] = [];
    if (hasPush) events.push({ t: 0, id: "push", label: "Force applied" });
    let maxOmega = 0;
    let timeToTarget: number | null = null;
    let startsTurning = 0;
    const h = RECORD_DT / SUBSTEPS;
    while (t < 15) {
      for (let s = 0; s < SUBSTEPS; s++) {
        const now = t + (s / SUBSTEPS) * RECORD_DT;
        const f = state(now, omega);
        if (!f.moving) {
          omega = 0;
          continue;
        }
        const next = omega + f.alpha * h;
        if (omega !== 0 && Math.sign(next) !== Math.sign(omega)) {
          theta += (omega * h) / 2;
          omega = 0;
          continue;
        }
        theta += ((omega + next) / 2) * h;
        omega = next;
        if (door && Math.abs(theta) >= DOOR_STOP) {
          theta = Math.sign(theta) * DOOR_STOP;
          omega = 0;
        }
        startsTurning = 1;
        if (Math.abs(omega) > maxOmega) maxOmega = Math.abs(omega);
        if (timeToTarget === null && Math.abs(theta) >= target) {
          timeToTarget = now + h;
          events.push({ t: timeToTarget, id: "target", label: "Goal angle reached" });
        }
      }
      t += RECORD_DT;
      const f = state(t, omega);
      const moving = Math.abs(omega) >= REST_OMEGA ? 1 : 0;
      timeline.push({
        theta,
        omega,
        alpha: moving ? f.alpha : 0,
        torque: f.torque,
        resisting: f.resisting,
        pushing: f.pushing,
        moving,
      });
      if (!moving && t > p.pushTime + 0.8) break;
    }
    if (hasPush && p.pushTime < timeline.duration)
      events.push({ t: p.pushTime, id: "release", label: "Force removed" });
    events.sort((a, b) => a.t - b.t);
    return {
      duration: timeline.duration,
      sample: (time) => timeline.sample(time),
      metrics: {
        torque: round(applied, 4),
        momentOfInertia: round(inertia, 6),
        angularAcceleration: round(first.alpha, 4),
        maxAngularSpeed: round(maxOmega, 4),
        finalAngle: round(Math.abs(theta) / DEG, 3),
        timeToTarget: timeToTarget === null ? null : round(timeToTarget, 4),
        startsTurning,
      },
      events,
      series: [
        timeline.series("theta", "Angle turned", "°", (value) => value / DEG),
        timeline.series("omega", "Spin rate", "rad/s"),
      ],
    };
  },
};
