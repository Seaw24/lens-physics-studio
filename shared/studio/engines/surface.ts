import type { Engine, SimEvent } from "./types";
import { DEG, RECORD_DT, Timeline, round } from "./timeline";

export interface SurfaceState extends Record<string, number> {
  /** Position along the surface, positive in the push direction (uphill on a slope). */
  x: number;
  v: number;
  a: number;
  applied: number;
  friction: number;
  normal: number;
  /** Gravity component along the surface. */
  gravityAlong: number;
  net: number;
  pushing: number;
  moving: number;
  /** Share of the available static friction in use while at rest (0–1). */
  grip: number;
}

const SUBSTEPS = 10;
const REST_SPEED = 1e-3;

export const surface: Engine<SurfaceState> = {
  id: "surface",
  name: "Push & friction lab",
  tagline: "Forces, friction and motion on a surface.",
  description:
    "A body on a flat or tilted surface: pushed, pulled, slid, dragged, nudged, resting, placed, or held still by friction. A hand or other agent applies a force along the surface (optionally angled upward) for a chosen time; static and kinetic friction, the normal force and gravity along any slope decide whether it starts moving, how fast it accelerates and where it stops. Side view.",
  ignores:
    "Air resistance, rolling and tipping. Friction follows the simple μ·N model.",
  params: [
    {
      key: "mass",
      label: "Mass",
      unit: "kg",
      min: 0.02,
      max: 300,
      step: 0.01,
      default: 0.4,
      description: "Mass of the object on the surface.",
    },
    {
      key: "force",
      label: "Push force",
      unit: "N",
      min: 0,
      max: 600,
      step: 0.1,
      default: 3,
      description: "Size of the applied push or pull.",
    },
    {
      key: "forceAngle",
      label: "Push angle",
      unit: "°",
      min: -60,
      max: 60,
      step: 1,
      default: 0,
      description:
        "Angle of the force above the surface (positive pulls up, negative presses down).",
    },
    {
      key: "pushTime",
      label: "Push duration",
      unit: "s",
      min: 0,
      max: 8,
      step: 0.05,
      default: 0.5,
      description: "How long the force acts before it is released.",
    },
    {
      key: "incline",
      label: "Surface tilt",
      unit: "°",
      min: 0,
      max: 60,
      step: 0.5,
      default: 0,
      description: "Slope of the surface; pushes act uphill.",
    },
    {
      key: "muS",
      label: "Static friction μs",
      unit: "",
      min: 0,
      max: 1.5,
      step: 0.01,
      default: 0.45,
      description: "How strongly the surface resists starting to slide.",
    },
    {
      key: "muK",
      label: "Sliding friction μk",
      unit: "",
      min: 0,
      max: 1.5,
      step: 0.01,
      default: 0.3,
      description: "Friction while sliding; never above static friction.",
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
        { value: 24.79, label: "Jupiter" },
      ],
    },
  ],
  metrics: [
    {
      key: "startsMoving",
      label: "Starts moving",
      unit: "",
      digits: 0,
      description: "1 if the object breaks free of static friction, else 0.",
    },
    {
      key: "pushAcceleration",
      label: "Acceleration during the push",
      unit: "m/s²",
      digits: 2,
      description: "Acceleration at the start of the push (0 if it holds).",
    },
    {
      key: "maxSpeed",
      label: "Top speed",
      unit: "m/s",
      digits: 2,
      description: "Greatest speed reached.",
    },
    {
      key: "distance",
      label: "Distance travelled",
      unit: "m",
      digits: 3,
      description: "How far it ends up from where it started.",
    },
    {
      key: "stopTime",
      label: "Time until it stops",
      unit: "s",
      digits: 2,
      description: "When it comes to rest after moving (null if it keeps going).",
    },
    {
      key: "normalForce",
      label: "Normal force",
      unit: "N",
      digits: 2,
      description: "Support force from the surface during the push.",
    },
    {
      key: "maxStaticFriction",
      label: "Static friction limit",
      unit: "N",
      digits: 2,
      description: "Largest friction the surface can supply before sliding: μs·N.",
    },
    {
      key: "weight",
      label: "Weight",
      unit: "N",
      digits: 2,
      description: "Gravity on the object: m·g.",
    },
  ],
  normalize(p) {
    return { ...p, muK: Math.min(p.muK, p.muS) };
  },
  simulate(p) {
    const m = p.mass;
    const g = p.gravity;
    const alpha = p.incline * DEG;
    const phi = p.forceAngle * DEG;
    const gravityAlong = -m * g * Math.sin(alpha);
    const hasPush = p.pushTime > 0 && p.force > 0;
    /** Forces on the object at a time, given whether it is currently sliding. */
    const forces = (time: number, velocity: number) => {
      const pushing = hasPush && time < p.pushTime ? 1 : 0;
      const applied = pushing ? p.force * Math.cos(phi) : 0;
      const lift = pushing ? p.force * Math.sin(phi) : 0;
      const normal = Math.max(0, m * g * Math.cos(alpha) - lift);
      const drive = applied + gravityAlong;
      if (Math.abs(velocity) < REST_SPEED) {
        const limit = p.muS * normal;
        if (Math.abs(drive) <= limit + 1e-9)
          return {
            pushing,
            applied,
            normal,
            friction: -drive,
            net: 0,
            a: 0,
            moving: 0,
            grip: limit > 0 ? Math.abs(drive) / limit : 0,
          };
        const friction = -Math.sign(drive) * p.muK * normal;
        const net = drive + friction;
        return { pushing, applied, normal, friction, net, a: net / m, moving: 1, grip: 1 };
      }
      const friction = -Math.sign(velocity) * p.muK * normal;
      const net = drive + friction;
      return { pushing, applied, normal, friction, net, a: net / m, moving: 1, grip: 1 };
    };
    let x = 0;
    let v = 0;
    let t = 0;
    const events: SimEvent[] = [];
    if (hasPush) events.push({ t: 0, id: "push", label: "Push begins" });
    const first = forces(0, 0);
    const record = (time: number) => {
      const f = forces(time, v);
      const moving = Math.abs(v) >= REST_SPEED ? 1 : 0;
      return {
        x,
        v,
        a: moving ? f.a : 0,
        applied: f.applied,
        friction: f.friction,
        normal: f.normal,
        gravityAlong,
        net: moving ? f.net : 0,
        pushing: f.pushing,
        moving,
        grip: moving ? 1 : f.moving ? 1 : f.grip,
      };
    };
    const timeline = new Timeline<SurfaceState>(RECORD_DT, record(0));
    let startsMoving = 0;
    let maxSpeed = 0;
    let restSince: number | null = null;
    let wasMoving = false;
    const h = RECORD_DT / SUBSTEPS;
    while (t < 20) {
      for (let s = 0; s < SUBSTEPS; s++) {
        const now = t + (s / SUBSTEPS) * RECORD_DT;
        const f = forces(now, v);
        if (!f.moving) {
          v = 0;
          continue;
        }
        const nv = v + f.a * h;
        if (v !== 0 && Math.sign(nv) !== Math.sign(v)) {
          // Momentarily at rest: the next step decides between static grip and sliding back.
          x += (v * h) / 2;
          v = 0;
          continue;
        }
        x += ((v + nv) / 2) * h;
        v = nv;
        if (Math.abs(v) > maxSpeed) maxSpeed = Math.abs(v);
      }
      t += RECORD_DT;
      const moving = Math.abs(v) >= REST_SPEED;
      if (moving) {
        startsMoving = 1;
        wasMoving = true;
        restSince = null;
      } else if (wasMoving && restSince === null) restSince = t;
      timeline.push(record(t));
      if (!moving && t > p.pushTime + 0.9 && !forces(t, 0).moving) break;
      if (Math.abs(x) > 400) break;
    }
    if (hasPush && p.pushTime < timeline.duration)
      events.push({ t: p.pushTime, id: "release", label: "Push ends" });
    const stopTime = startsMoving ? restSince : 0;
    if (startsMoving && restSince !== null)
      events.push({ t: restSince, id: "stop", label: "Comes to rest" });
    events.sort((a, b) => a.t - b.t);
    const end = timeline.at(timeline.length - 1);
    return {
      duration: timeline.duration,
      sample: (time) => timeline.sample(time),
      metrics: {
        startsMoving,
        pushAcceleration: round(first.a, 4),
        maxSpeed: round(maxSpeed, 4),
        distance: round(Math.abs(end.x), 4),
        stopTime: stopTime === null ? null : round(stopTime, 4),
        normalForce: round(first.normal, 4),
        maxStaticFriction: round(p.muS * first.normal, 4),
        weight: round(m * g, 4),
      },
      events,
      series: [
        timeline.series("v", "Speed", "m/s", Math.abs),
        timeline.series("x", "Position", "m"),
        timeline.series("friction", "Friction force", "N"),
      ],
    };
  },
};
