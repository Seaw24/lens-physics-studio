import type { Engine, SimEvent } from "./types";
import { DEG, RECORD_DT, Timeline, round } from "./timeline";

export interface PendulumState extends Record<string, number> {
  /** Angle from straight down, radians; positive to the right. */
  theta: number;
  omega: number;
  speed: number;
  tension: number;
  kinetic: number;
  potential: number;
  lost: number;
}

export const pendulum: Engine<PendulumState> = {
  id: "pendulum",
  name: "Swing lab",
  tagline: "Height turns into speed and back again.",
  description:
    "A mass hanging from a pivot on a rope or rod that swings: a playground swing, a hanging bag or lamp, a person on a rope, a keychain, anything dangling that is pulled aside and let go or given a push. Shows period, speed at the bottom, rope tension and the exchange between gravitational potential and kinetic energy, with optional damping.",
  ignores:
    "Stretch of the rope, the size of the swinging mass and air resistance beyond simple damping.",
  params: [
    {
      key: "length",
      label: "Rope length",
      unit: "m",
      min: 0.05,
      max: 15,
      step: 0.01,
      default: 2,
      description: "Distance from the pivot to the center of the mass.",
    },
    {
      key: "angle",
      label: "Release angle",
      unit: "°",
      min: 0,
      max: 170,
      step: 1,
      default: 30,
      description: "How far it is pulled aside from hanging straight down.",
    },
    {
      key: "pushSpeed",
      label: "Push at release",
      unit: "m/s",
      min: -12,
      max: 12,
      step: 0.1,
      default: 0,
      description: "Extra speed given at release (0 = just let go).",
    },
    {
      key: "mass",
      label: "Mass",
      unit: "kg",
      min: 0.01,
      max: 150,
      step: 0.01,
      default: 25,
      description: "Swinging mass; changes tension, not timing.",
    },
    {
      key: "damping",
      label: "Air & pivot damping",
      unit: "1/s",
      min: 0,
      max: 1.5,
      step: 0.01,
      default: 0.03,
      description: "How quickly the swing dies away.",
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
      key: "period",
      label: "Time for one swing",
      unit: "s",
      digits: 2,
      description: "Time for a full back-and-forth swing.",
    },
    {
      key: "smallAnglePeriod",
      label: "Small-swing formula",
      unit: "s",
      digits: 2,
      description: "2π√(L/g), exact only for small swings.",
    },
    {
      key: "maxSpeed",
      label: "Speed at the bottom",
      unit: "m/s",
      digits: 2,
      description: "Fastest speed during the first swing.",
    },
    {
      key: "maxTension",
      label: "Peak rope tension",
      unit: "N",
      digits: 1,
      description: "Largest pull in the rope, at the bottom of the swing.",
    },
    {
      key: "dropHeight",
      label: "Height of release",
      unit: "m",
      digits: 2,
      description: "How far above the lowest point it starts: L(1 − cos θ).",
    },
    {
      key: "energyKept",
      label: "Energy kept after 3 swings",
      unit: "%",
      digits: 0,
      description: "Share of the starting energy left after three swings.",
    },
  ],
  simulate(p) {
    const L = p.length;
    const g = p.gravity;
    const b = p.damping;
    const theta0 = p.angle * DEG;
    const omega0 = p.pushSpeed / L;
    const accel = (theta: number, omega: number) =>
      -(g / L) * Math.sin(theta) - b * omega;
    const energy = (theta: number, omega: number) => ({
      kinetic: 0.5 * p.mass * (L * omega) ** 2,
      potential: p.mass * g * L * (1 - Math.cos(theta)),
    });
    const e0 = energy(theta0, omega0);
    const start = e0.kinetic + e0.potential;
    const smallAnglePeriod = 2 * Math.PI * Math.sqrt(L / g);
    const duration = Math.min(30, Math.max(6, smallAnglePeriod * 3.4));
    const substeps = Math.max(4, Math.ceil(RECORD_DT / (smallAnglePeriod / 200)));
    const h = RECORD_DT / substeps;
    let theta = theta0;
    let omega = omega0;
    const snapshot = () => {
      const { kinetic, potential } = energy(theta, omega);
      return {
        theta,
        omega,
        speed: Math.abs(L * omega),
        tension: p.mass * g * Math.cos(theta) + p.mass * L * omega * omega,
        kinetic,
        potential,
        lost: Math.max(0, start - kinetic - potential),
      };
    };
    const timeline = new Timeline<PendulumState>(RECORD_DT, snapshot());
    const events: SimEvent[] = [{ t: 0, id: "release", label: "Let go" }];
    const crossings: number[] = [];
    let maxSpeed = Math.abs(L * omega0);
    let maxTension = snapshot().tension;
    let t = 0;
    while (t < duration) {
      for (let s = 0; s < substeps; s++) {
        // RK4 for the nonlinear pendulum.
        const k1t = omega;
        const k1w = accel(theta, omega);
        const k2t = omega + (h / 2) * k1w;
        const k2w = accel(theta + (h / 2) * k1t, omega + (h / 2) * k1w);
        const k3t = omega + (h / 2) * k2w;
        const k3w = accel(theta + (h / 2) * k2t, omega + (h / 2) * k2w);
        const k4t = omega + h * k3w;
        const k4w = accel(theta + h * k3t, omega + h * k3w);
        const nextTheta = theta + (h / 6) * (k1t + 2 * k2t + 2 * k3t + k4t);
        const nextOmega = omega + (h / 6) * (k1w + 2 * k2w + 2 * k3w + k4w);
        const now = t + ((s + 1) / substeps) * RECORD_DT;
        if (theta > 0 && nextTheta <= 0 && omega < 0) {
          const f = theta / (theta - nextTheta);
          crossings.push(now - h + f * h);
        }
        theta = nextTheta;
        omega = nextOmega;
        const firstSwing = crossings.length < 2;
        if (firstSwing && Math.abs(L * omega) > maxSpeed)
          maxSpeed = Math.abs(L * omega);
      }
      t += RECORD_DT;
      const state = snapshot();
      if (state.tension > maxTension) maxTension = state.tension;
      timeline.push(state);
    }
    const period =
      crossings.length >= 2 ? crossings[1] - crossings[0] : null;
    if (crossings[0] !== undefined)
      events.push({ t: crossings[0], id: "bottom", label: "Lowest point · fastest" });
    const kept = (() => {
      const at = period ? Math.min(timeline.duration, period * 3) : timeline.duration;
      const s = timeline.sample(at);
      return start > 0 ? ((s.kinetic + s.potential) / start) * 100 : 100;
    })();
    return {
      duration: timeline.duration,
      sample: (time) => timeline.sample(time),
      metrics: {
        period: period === null ? null : round(period, 4),
        smallAnglePeriod: round(smallAnglePeriod, 4),
        maxSpeed: round(maxSpeed, 4),
        maxTension: round(maxTension, 3),
        dropHeight: round(L * (1 - Math.cos(theta0)), 4),
        energyKept: round(kept, 2),
      },
      events,
      series: [
        timeline.series("theta", "Swing angle", "°", (value) => value / DEG),
        timeline.series("speed", "Speed", "m/s"),
        timeline.series("tension", "Rope tension", "N"),
      ],
    };
  },
};
