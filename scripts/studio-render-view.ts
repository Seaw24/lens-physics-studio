// Renders a physics lab view to a PNG contact sheet so views can be reviewed
// without a browser.
//
//   node --import tsx scripts/studio-render-view.ts <engine> [out.png]
//     [--params '{"force":20}'] [--ghost '{"force":10}'] [--skin '{...}']
//     [--times 0,0.4,1.2] [--size 880x520] [--hover handleId] [--active handleId]
import fs from "node:fs";
import path from "node:path";
import { createCanvas } from "@napi-rs/canvas";
import {
  getEngine,
  resolveParams,
  runEngine,
} from "../shared/studio/engines";
import type { Lab } from "../shared/studio/schema";
import { flushLabels } from "../src/studio/lab/draw";
import { LAB_VIEWS } from "../src/studio/lab/views";

const DEFAULT_SKINS: Record<string, Lab["skin"]> = {
  projectile: { body: { name: "basketball", shape: "ball", color: "#d9772b" }, other: null, surface: { name: "court", material: "wood" }, agent: "player" },
  surface: { body: { name: "soda can", shape: "can", color: "#c8102e" }, other: null, surface: { name: "table", material: "wood" }, agent: "hand" },
  rotation: { body: { name: "door", shape: "door", color: "#9a6b43" }, other: null, surface: null, agent: "hand" },
  balance: { body: { name: "plank", shape: "bar", color: "#b98a57" }, other: { name: "plates", shape: "plate", color: "#e8e3d8" }, surface: { name: "floor", material: "concrete" }, agent: null },
  pendulum: { body: { name: "swing seat", shape: "person", color: "#4f7cff" }, other: null, surface: { name: "playground", material: "sand" }, agent: null },
  collision: { body: { name: "ball", shape: "ball", color: "#ff7a2f" }, other: { name: "can", shape: "can", color: "#3b82f6" }, surface: { name: "table", material: "wood" }, agent: null },
  spring: { body: { name: "water bottle", shape: "bottle", color: "#5fb3e6" }, other: null, surface: null, agent: "hand" },
  buoyancy: { body: { name: "banana boat", shape: "boat", color: "#f5c518" }, other: { name: "riders", shape: "person", color: "#ff7a2f" }, surface: { name: "sea", material: "water" }, agent: null },
};

function arg(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

const engineId = process.argv[2];
const engine = engineId ? getEngine(engineId) : null;
if (!engine) {
  console.error(`Usage: studio-render-view.ts <engine> [out.png] ...`);
  process.exit(1);
}
const view = LAB_VIEWS[engine.id];
const out = path.resolve(
  process.argv[3] && !process.argv[3].startsWith("--")
    ? process.argv[3]
    : `.runtime/studio-previews/${engine.id}.png`,
);
const params = resolveParams(engine, JSON.parse(arg("params") ?? "{}"));
const sim = runEngine(engine, params);
const ghostOverrides = arg("ghost");
const ghostParams = ghostOverrides
  ? resolveParams(engine, { ...params, ...JSON.parse(ghostOverrides) })
  : null;
const ghostSim = ghostParams ? runEngine(engine, ghostParams) : null;
const skin = { ...DEFAULT_SKINS[engine.id], ...(arg("skin") ? JSON.parse(arg("skin")!) : {}) };
const [w, h] = (arg("size") ?? "880x520").split("x").map(Number);
const times = arg("times")
  ? arg("times")!.split(",").map(Number)
  : [0, 0.2, 0.45, 0.7, 1].map((share) => share * sim.duration);

const columns = 2;
const rows = Math.ceil(times.length / columns);
const sheet = createCanvas(w * columns, h * rows);
const sheetCtx = sheet.getContext("2d");
sheetCtx.fillStyle = "#000";
sheetCtx.fillRect(0, 0, sheet.width, sheet.height);
times.forEach((t, index) => {
  const canvas = createCanvas(w, h);
  const ctx = canvas.getContext("2d") as unknown as CanvasRenderingContext2D;
  view.draw({
    ctx,
    width: w,
    height: h,
    t,
    sim,
    state: sim.sample(t),
    params,
    ghost:
      ghostSim && ghostParams
        ? { sim: ghostSim, params: ghostParams, state: ghostSim.sample(Math.min(t, ghostSim.duration)) }
        : null,
    skin,
    engine,
    showVectors: true,
    clock: t,
    hover: arg("hover") ?? null,
    active: arg("active") ?? null,
  });
  flushLabels();
  const hud = view.hud({ t, sim, state: sim.sample(t), params });
  (ctx as any).font = "600 12px sans-serif";
  (ctx as any).fillStyle = "rgba(255,255,255,0.85)";
  (ctx as any).fillText(hud.map((item) => `${item.label} ${item.value}`).join("   "), 12, 18);
  const handles = view.handles?.({
    ctx,
    width: w,
    height: h,
    t,
    sim,
    state: sim.sample(t),
    params,
    ghost: null,
    skin,
    engine,
    showVectors: true,
    clock: t,
    hover: null,
    active: null,
  }) ?? [];
  for (const handle of handles) {
    (ctx as any).strokeStyle = "rgba(0,255,120,0.9)";
    (ctx as any).setLineDash([]);
    (ctx as any).lineWidth = 1;
    (ctx as any).strokeRect(handle.x - handle.r, handle.y - handle.r, handle.r * 2, handle.r * 2);
  }
  sheetCtx.drawImage(canvas as any, (index % columns) * w, Math.floor(index / columns) * h);
  sheetCtx.fillStyle = "#fff";
  sheetCtx.font = "700 13px sans-serif";
  sheetCtx.fillText(`t = ${t.toFixed(2)} s`, (index % columns) * w + w - 90, Math.floor(index / columns) * h + h - 10);
});
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, sheet.toBuffer("image/png"));
console.log(
  JSON.stringify({
    out,
    duration: sim.duration,
    metrics: sim.metrics,
    events: sim.events,
    handles: view.handles ? "yes" : "no",
  }),
);
