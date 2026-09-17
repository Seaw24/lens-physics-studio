import type { Engine, SimEvent } from "./types";
import { DEG, RECORD_DT, Timeline, round } from "./timeline";

export interface ProjectileState extends Record<string, number> {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ax: number;
  ay: number;
  speed: number;
  airborne: number;
}

const AIR_DENSITY = 1.225;
const SUBSTEPS = 8;

export const projectile: Engine<ProjectileState> = {
  id: "projectile",
  name: "Flight lab",
  tagline: "Release it, throw it, drop it.",
  description:
    "A body that leaves its support and moves under gravity: thrown, tossed, kicked, dropped, jumping, released from a hand, or flying off a table. Side view, ground at height 0, launch from a chosen height at a chosen speed and angle (angle 0 = horizontal, 90 = straight up, -90 = straight down; speed 0 = a drop). Optional air drag for a sphere of given radius and mass, and optional bounces on landing.",
  ignores:
    "Spin, wind and lift. Drag treats the object as a sphere; bounces keep 92% of horizontal speed.",
  params: [
    {
      key: "speed",
      label: "Launch speed",
      unit: "m/s",
      min: 0,
      max: 40,
      step: 0.1,
      default: 8,
      description: "Speed at the instant of release (0 for a drop).",
    },
    {
      key: "angle",
      label: "Launch angle",
      unit: "°",
      min: -90,
      max: 90,
      step: 1,
      default: 45,
      description: "Direction above the horizontal at release.",
    },
    {
      key: "height",
      label: "Release height",
      unit: "m",
      min: 0,
      max: 30,
      step: 0.05,
      default: 1.5,
      description: "Height above the landing surface at release.",
    },
    {
      key: "mass",
      label: "Mass",
      unit: "kg",
      min: 0.005,
      max: 20,
      step: 0.005,
      default: 0.6,
      description: "Only matters when air drag is on.",
    },
    {
      key: "radius",
      label: "Size (radius)",
      unit: "m",
      min: 0.01,
      max: 0.6,
      step: 0.01,
      default: 0.12,
      description: "Sets the cross-section the air pushes against.",
    },
    {
      key: "drag",
      label: "Air drag coefficient",
      unit: "",
      min: 0,
      max: 1.5,
      step: 0.05,
      default: 0,
      description: "0 = no air resistance; a ball is about 0.47.",
    },
    {
      key: "bounce",
      label: "Bounciness",
      unit: "",
      min: 0,
      max: 0.9,
      step: 0.05,
      default: 0,
      description:
        "Share of vertical speed kept after landing (0 = it stops where it lands).",
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
        { value: 3.71, label: "Mars" },
        { value: 9.81, label: "Earth" },
        { value: 24.79, label: "Jupiter" },
      ],
    },
  ],
  metrics: [
    {
      key: "flightTime",
      label: "Time in the air",
      unit: "s",
      digits: 2,
      description: "From release to first touching the ground.",
    },
    {
      key: "range",
      label: "Horizontal distance",
      unit: "m",
      digits: 2,
      description: "Horizontal distance at the first landing.",
    },
    {
      key: "maxHeight",
      label: "Highest point",
      unit: "m",
      digits: 2,
      description: "Greatest height above the ground.",
    },
    {
      key: "apexTime",
      label: "Time to the top",
      unit: "s",
      digits: 2,
      description: "When vertical velocity reaches zero.",
    },
    {
      key: "impactSpeed",
      label: "Landing speed",
      unit: "m/s",
      digits: 2,
      description: "Speed at the first landing.",
    },
    {
      key: "launchVx",
      label: "Horizontal velocity at release",
      unit: "m/s",
      digits: 2,
      description: "v cos θ at release.",
    },
    {
      key: "launchVy",
      label: "Vertical velocity at release",
      unit: "m/s",
      digits: 2,
      description: "v sin θ at release.",
    },
  ],
  simulate(p) {
    const g = p.gravity;
    const k =
      (0.5 * AIR_DENSITY * p.drag * Math.PI * p.radius * p.radius) / p.mass;
    const accel = (vx: number, vy: number) => {
      const speed = Math.hypot(vx, vy);
      return [-k * speed * vx, -g - k * speed * vy] as const;
    };
    let x = 0;
    let y = p.height;
    let vx = p.speed * Math.cos(p.angle * DEG);
    let vy = p.speed * Math.sin(p.angle * DEG);
    let airborne = y > 0 || vy > 0 ? 1 : 0;
    if (!airborne) {
      vx = 0;
      vy = 0;
    }
    const [ax0, ay0] = airborne ? accel(vx, vy) : [0, 0];
    const timeline = new Timeline<ProjectileState>(RECORD_DT, {
      x,
      y,
      vx,
      vy,
      ax: ax0,
      ay: ay0,
      speed: Math.hypot(vx, vy),
      airborne,
    });
    const events: SimEvent[] = [{ t: 0, id: "release", label: "Release" }];
    let t = 0;
    let maxHeight = y;
    let apexTime = vy > 0 ? null : 0;
    let flightTime: number | null = airborne ? null : 0;
    let range: number | null = airborne ? null : 0;
    let impactSpeed: number | null = airborne ? null : 0;
    let restAt: number | null = airborne ? null : 0;
    let bounces = 0;
    const h = RECORD_DT / SUBSTEPS;
    while (t < 40) {
      for (let s = 0; s < SUBSTEPS; s++) {
        if (!airborne) break;
        // RK4 on velocity; position from the averaged velocity.
        const [k1x, k1y] = accel(vx, vy);
        const [k2x, k2y] = accel(vx + (h / 2) * k1x, vy + (h / 2) * k1y);
        const [k3x, k3y] = accel(vx + (h / 2) * k2x, vy + (h / 2) * k2y);
        const [k4x, k4y] = accel(vx + h * k3x, vy + h * k3y);
        const nvx = vx + (h / 6) * (k1x + 2 * k2x + 2 * k3x + k4x);
        const nvy = vy + (h / 6) * (k1y + 2 * k2y + 2 * k3y + k4y);
        const nx = x + (h / 2) * (vx + nvx);
        const ny = y + (h / 2) * (vy + nvy);
        const now = t + ((s + 1) / SUBSTEPS) * RECORD_DT;
        if (apexTime === null && vy > 0 && nvy <= 0) {
          const f = vy / (vy - nvy);
          apexTime = now - h + f * h;
          events.push({
            t: apexTime,
            id: "apex",
            label: "Top of the arc · vᵧ = 0",
          });
        }
        if (ny <= 0 && nvy < 0) {
          const f = y / Math.max(1e-9, y - ny);
          const hitT = now - h + f * h;
          const hitX = x + f * (nx - x);
          const hitVx = vx + f * (nvx - vx);
          const hitVy = vy + f * (nvy - vy);
          if (flightTime === null) {
            flightTime = hitT;
            range = hitX;
            impactSpeed = Math.hypot(hitVx, hitVy);
            events.push({ t: hitT, id: "landing", label: "Lands" });
          }
          x = hitX;
          y = 0;
          if (p.bounce > 0 && Math.abs(hitVy) * p.bounce > 0.6 && bounces < 8) {
            bounces++;
            vx = hitVx * 0.92;
            vy = -hitVy * p.bounce;
            events.push({ t: hitT, id: `bounce-${bounces}`, label: "Bounce" });
          } else {
            vx = 0;
            vy = 0;
            airborne = 0;
            restAt = hitT;
          }
          continue;
        }
        x = nx;
        y = ny;
        vx = nvx;
        vy = nvy;
        if (y > maxHeight) maxHeight = y;
      }
      t += RECORD_DT;
      const [ax, ay] = airborne ? accel(vx, vy) : [0, 0];
      timeline.push({
        x,
        y,
        vx,
        vy,
        ax,
        ay,
        speed: Math.hypot(vx, vy),
        airborne,
      });
      if (restAt !== null && t >= restAt + 0.6) break;
      if (Math.abs(x) > 5_000) break;
    }
    return {
      duration: timeline.duration,
      sample: (time) => timeline.sample(time),
      metrics: {
        flightTime: flightTime === null ? null : round(flightTime, 4),
        range: range === null ? null : round(range, 4),
        maxHeight: round(maxHeight, 4),
        apexTime: apexTime === null ? null : round(apexTime, 4),
        impactSpeed: impactSpeed === null ? null : round(impactSpeed, 4),
        launchVx: round(p.speed * Math.cos(p.angle * DEG), 4),
        launchVy: round(p.speed * Math.sin(p.angle * DEG), 4),
      },
      events,
      series: [
        timeline.series("y", "Height", "m"),
        timeline.series("speed", "Speed", "m/s"),
        timeline.series("vy", "Vertical velocity", "m/s"),
      ],
    };
  },
};
