import type { Engine, SimEvent } from "./types";
import { RECORD_DT, Timeline, round } from "./timeline";

export interface BuoyancyState extends Record<string, number> {
  /** How far the bottom of the object is below the water surface, m. */
  depth: number;
  v: number;
  buoyant: number;
  weight: number;
  /** Submerged share of the object's height, 0–1. */
  submerged: number;
  onBottom: number;
}

export const buoyancy: Engine<BuoyancyState> = {
  id: "buoyancy",
  name: "Float lab",
  tagline: "Push water aside, get pushed back up.",
  description:
    "Objects in water or another liquid: boats, inflatables, rafts, swimmers, floating toys, ice, a bottle or can dropped in water, loading passengers or cargo onto something that floats. The object is a box of given volume and height; the liquid pushes up with a force equal to the weight of liquid displaced (Archimedes). Adding load makes it sit deeper until it sinks.",
  ignores:
    "Waves, tilting and water flowing in. The object keeps its shape and volume.",
  params: [
    {
      key: "mass",
      label: "Object mass",
      unit: "kg",
      min: 0.005,
      max: 6000,
      step: 0.005,
      default: 60,
      description: "Mass of the floating object itself.",
    },
    {
      key: "load",
      label: "Added load",
      unit: "kg",
      min: 0,
      max: 6000,
      step: 0.5,
      default: 240,
      description: "People or cargo it carries.",
    },
    {
      key: "volume",
      label: "Object volume",
      unit: "m³",
      min: 0.0005,
      max: 20,
      step: 0.0005,
      default: 1.1,
      description: "Total volume it could push aside if fully under.",
    },
    {
      key: "height",
      label: "Object height",
      unit: "m",
      min: 0.02,
      max: 4,
      step: 0.01,
      default: 0.55,
      description: "From its bottom to its top.",
    },
    {
      key: "fluidDensity",
      label: "Liquid density",
      unit: "kg/m³",
      min: 600,
      max: 1500,
      step: 1,
      default: 1000,
      description: "Mass of one cubic meter of the liquid.",
      options: [
        { value: 900, label: "Oil" },
        { value: 1000, label: "Fresh water" },
        { value: 1025, label: "Sea water" },
        { value: 1420, label: "Honey" },
      ],
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
    },
  ],
  metrics: [
    {
      key: "floats",
      label: "Floats",
      unit: "",
      digits: 0,
      description: "1 if it floats, 0 if it sinks.",
    },
    {
      key: "submergedFraction",
      label: "Share underwater",
      unit: "%",
      digits: 0,
      description: "How much of its height sits below the surface when settled.",
    },
    {
      key: "freeboard",
      label: "Height above water",
      unit: "m",
      digits: 3,
      description: "Distance from the water surface to its top when floating.",
    },
    {
      key: "buoyantForce",
      label: "Buoyant force",
      unit: "N",
      digits: 1,
      description: "Upward push of the liquid when settled.",
    },
    {
      key: "weight",
      label: "Total weight",
      unit: "N",
      digits: 1,
      description: "Weight of object plus load.",
    },
    {
      key: "spareLoad",
      label: "Load it could still take",
      unit: "kg",
      digits: 1,
      description: "Extra mass before it goes under (negative when sinking).",
    },
    {
      key: "averageDensity",
      label: "Average density",
      unit: "kg/m³",
      digits: 0,
      description: "Total mass divided by volume; floats if below the liquid's.",
    },
  ],
  simulate(p) {
    const g = p.gravity;
    const M = p.mass + p.load;
    const area = p.volume / p.height;
    const rho = p.fluidDensity;
    const weight = M * g;
    const floatDepth = M / (rho * area);
    const floats = floatDepth < p.height ? 1 : 0;
    const floor = p.height * 3;
    const stiffness = rho * g * area;
    const damping = 2 * 0.22 * Math.sqrt(stiffness * M);
    const period = 2 * Math.PI * Math.sqrt(M / stiffness);
    const substeps = Math.min(400, Math.max(6, Math.ceil(RECORD_DT / (period / 60))));
    const h = RECORD_DT / substeps;
    const buoyantAt = (depth: number) =>
      rho * g * area * Math.min(p.height, Math.max(0, depth));
    let depth = 0;
    let v = 0;
    let onBottom = 0;
    const snapshot = () => ({
      depth,
      v,
      buoyant: buoyantAt(depth),
      weight,
      submerged: Math.min(1, Math.max(0, depth / p.height)),
      onBottom,
    });
    const timeline = new Timeline<BuoyancyState>(RECORD_DT, snapshot());
    const events: SimEvent[] = [{ t: 0, id: "place", label: "Placed on the water" }];
    const maxDuration = Math.min(20, Math.max(4, period * 5));
    let t = 0;
    let settled = 0;
    while (t < maxDuration) {
      for (let s = 0; s < substeps; s++) {
        if (onBottom) break;
        const a = (weight - buoyantAt(depth) - damping * v) / M;
        v += a * h;
        depth += v * h;
        if (depth >= floor) {
          depth = floor;
          v = 0;
          onBottom = 1;
          events.push({ t: t + ((s + 1) / substeps) * RECORD_DT, id: "bottom", label: "Hits the bottom" });
        }
      }
      t += RECORD_DT;
      timeline.push(snapshot());
      if (Math.abs(v) < 1e-3 && Math.abs(depth - (floats ? floatDepth : floor)) < 1e-3) {
        settled += RECORD_DT;
        if (settled > 0.8) break;
      } else settled = 0;
    }
    if (floats)
      events.push({
        t: Math.min(timeline.duration, period * 1.5),
        id: "settle",
        label: "Settles at its waterline",
      });
    events.sort((a, b) => a.t - b.t);
    return {
      duration: timeline.duration,
      sample: (time) => timeline.sample(time),
      metrics: {
        floats,
        submergedFraction: round(Math.min(1, floatDepth / p.height) * 100, 2),
        freeboard: floats ? round(p.height - floatDepth, 4) : 0,
        buoyantForce: round(floats ? weight : rho * g * p.volume, 3),
        weight: round(weight, 3),
        spareLoad: round(rho * p.volume - M, 3),
        averageDensity: round(M / p.volume, 2),
      },
      events,
      series: [
        timeline.series("depth", "Depth of the bottom", "m"),
        timeline.series("buoyant", "Buoyant force", "N"),
      ],
    };
  },
};
