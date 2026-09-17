import type { Params, Simulation } from "../../../../shared/studio/engines";
import type { BuoyancyState } from "../../../../shared/studio/engines/buoyancy";
import type { Lab, Shape } from "../../../../shared/studio/schema";
import {
  Camera,
  LAB,
  QUANTITY_COLORS,
  backdrop,
  body,
  formatQuantity,
  handleRing,
  liquid,
  meter,
  pill,
  reserve,
  roundRect,
  surfaceBand,
  unionBox,
  vector,
  type WorldBox,
} from "../draw";
import type { EngineView, LabHandle, LabScene } from "../types";

type Sim = Simulation<BuoyancyState>;
type Skin = Lab["skin"];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

// ---------------------------------------------------------------------------
// Liquids and formatting

interface Fluid {
  density: number;
  noun: string;
  label: string;
  tint: string;
  bed: string;
  veil: number;
}

const FLUIDS: Fluid[] = [
  { density: 900, noun: "oil", label: "Oil", tint: "#c98f2c", bed: "metal", veil: 0.4 },
  { density: 1000, noun: "water", label: "Fresh water", tint: "#2f7fd1", bed: "stone", veil: 0.4 },
  { density: 1025, noun: "water", label: "Sea water", tint: "#1c8499", bed: "sand", veil: 0.42 },
  { density: 1420, noun: "honey", label: "Honey", tint: "#d99a12", bed: "metal", veil: 0.55 },
];

function fluidFor(density: number) {
  return FLUIDS.reduce((best, fluid) =>
    Math.abs(fluid.density - density) < Math.abs(best.density - density) ? fluid : best,
  );
}

function formatMass(kg: number) {
  const a = Math.abs(kg);
  if (a >= 1) return formatQuantity(kg, "kg", a >= 10 ? 0 : 1);
  return formatQuantity(kg * 1000, "g", a * 1000 >= 10 ? 0 : 1);
}

function formatLength(m: number) {
  const a = Math.abs(m);
  if (a >= 0.1) return formatQuantity(m, "m", 2);
  if (a >= 0.01) return formatQuantity(m * 100, "cm", 1);
  return formatQuantity(m * 1000, "mm", a * 1000 >= 1 ? 1 : 2);
}

function formatVolume(m3: number) {
  const a = Math.abs(m3);
  if (a >= 0.1) return formatQuantity(m3, "m³", 2);
  if (a >= 0.001) return formatQuantity(m3 * 1000, "L", a * 1000 >= 10 ? 1 : 2);
  return formatQuantity(m3 * 1e6, "mL", a * 1e6 >= 10 ? 0 : 1);
}

function formatForce(n: number) {
  const a = Math.abs(n);
  if (a >= 10000) return formatQuantity(n / 1000, "kN", 1);
  return formatQuantity(n, "N", a >= 100 ? 0 : a >= 10 ? 1 : 2);
}

function tone(hex: string, amount: number) {
  const value = hex.replace("#", "");
  const num = parseInt(value.length === 3 ? value.replace(/(.)/g, "$1$1") : value, 16);
  const r = clamp(((num >> 16) & 255) + amount, 0, 255);
  const g = clamp(((num >> 8) & 255) + amount, 0, 255);
  const b = clamp((num & 255) + amount, 0, 255);
  return `rgb(${r}, ${g}, ${b})`;
}

/** Same surface wave as the liquid() helper, in canvas pixels. */
const wave = (x: number, clock: number) =>
  Math.sin(x * 0.045 + clock * 2.1) * 2.2 + Math.sin(x * 0.11 - clock * 1.3) * 0.9;

// ---------------------------------------------------------------------------
// Geometry (per simulation, cached)

interface LoadItem {
  /** Center offset from the object's center, m. */
  x: number;
  /** Bottom height above the deck, m. */
  y: number;
  w: number;
  h: number;
}

interface Geometry {
  key: string;
  h: number;
  area: number;
  volume: number;
  width: number;
  floor: number;
  floatDepth: number;
  floats: boolean;
  capacityLoad: number;
  mass: number;
  load: number;
  seated: boolean;
  items: LoadItem[];
  stackH: number;
  /** Height of the load's center of mass above the deck, m. */
  loadY: number;
  loadShape: Shape;
  loadColor: string;
  loadName: string;
}

const ITEM_ASPECT: Partial<Record<Shape, number>> = {
  can: 0.6,
  bottle: 0.45,
  cup: 0.8,
  person: 0.42,
  door: 0.5,
  bar: 2.4,
  book: 1.4,
  phone: 0.55,
};

function visualWidth(shape: Shape, area: number, h: number) {
  const side = Math.sqrt(area);
  if (shape === "ball") return h;
  if (shape === "can" || shape === "bottle" || shape === "cup" || shape === "person" || shape === "bag")
    return clamp(side * 1.13, h * 0.42, h * 6);
  return clamp(side * 1.3, h * 1.2, h * 6);
}

function computeGeometry(params: Params, skin: Skin, key: string): Geometry {
  const h = params.height;
  const area = params.volume / h;
  const width = visualWidth(skin.body.shape, area, h);
  const total = params.mass + params.load;
  const floatDepth = total / (params.fluidDensity * area);
  const other = skin.other;
  const loadShape: Shape = other?.shape ?? "box";
  const seated = loadShape === "person";
  const count = params.load > 0 ? clamp(Math.round(params.load / 75), 1, 8) : 0;
  const items: LoadItem[] = [];
  let stackH = 0;
  let loadY = 0;
  if (count && seated) {
    const usable = width * 0.84;
    const spacing = usable / count;
    let s = clamp(0.8, h * 0.9, h * 1.7);
    s = Math.max(h * 0.55, Math.min(s, spacing * 2.2));
    for (let i = 0; i < count; i++)
      items.push({ x: -usable / 2 + spacing * (i + 0.5) - s * 0.12, y: 0, w: s * 0.5, h: s });
    stackH = s;
    loadY = s * 0.4;
  } else if (count) {
    const aspect = ITEM_ASPECT[loadShape] ?? 1;
    let c = clamp(width * 0.24, h * 0.3, h * 0.9);
    let perRow = Math.max(1, Math.floor((width * 0.96) / (c * aspect * 1.08)));
    if (Math.ceil(count / perRow) > 3) {
      perRow = Math.ceil(count / 3);
      c = (width * 0.96) / (perRow * 1.08 * aspect);
    }
    let left = count;
    let row = 0;
    let rowCap = perRow;
    while (left > 0) {
      const n = Math.min(left, rowCap);
      for (let i = 0; i < n; i++)
        items.push({ x: (i - (n - 1) / 2) * c * aspect * 1.08, y: row * c * 1.02, w: c * aspect, h: c });
      left -= n;
      row++;
      rowCap = Math.max(1, n - 1);
    }
    stackH = row * c * 1.02;
    loadY = stackH * 0.4;
  }
  return {
    key,
    h,
    area,
    volume: params.volume,
    width,
    floor: h * 3,
    floatDepth,
    floats: floatDepth < h,
    capacityLoad: params.fluidDensity * params.volume - params.mass,
    mass: params.mass,
    load: params.load,
    seated,
    items,
    stackH,
    loadY,
    loadShape,
    loadColor: other?.color ?? "#b98a57",
    loadName: other?.name ?? "load",
  };
}

const geometryCache = new WeakMap<object, Geometry>();
function geometry(sim: Sim, params: Params, skin: Skin) {
  const key = `${skin.body.shape}|${skin.other?.shape ?? ""}|${skin.other?.color ?? ""}|${params.load}|${params.volume}|${params.height}`;
  let g = geometryCache.get(sim);
  if (!g || g.key !== key) geometryCache.set(sim, (g = computeGeometry(params, skin, key)));
  return g;
}

function worldBox(g: Geometry): WorldBox {
  const half = g.width / 2 + Math.max(g.h * 0.9, g.width * 0.3);
  return { x0: -half, x1: half, y0: -g.floor, y1: g.h + g.stackH };
}

/** Center of mass height above the object's bottom, m. */
function comHeight(g: Geometry) {
  const total = g.mass + g.load;
  return (g.mass * (g.h / 2) + g.load * (g.h + g.loadY)) / Math.max(1e-9, total);
}

// ---------------------------------------------------------------------------
// Layout (frozen while dragging)

interface Frame {
  box: WorldBox;
  basePx: number;
  pxPerN: number;
  kgPerPx: number;
}

let frozen: Frame | null = null;
let anchor: { id: string; px: number; py: number; load: number; volume: number; widthPx: number } | null = null;

function layout(scene: LabScene<BuoyancyState>) {
  const { sim, ghost, params, skin, width, height } = scene;
  const g = geometry(sim, params, skin);
  const gg = ghost ? geometry(ghost.sim as Sim, ghost.params, skin) : null;
  const u = clamp(Math.min(width / 880, height / 520), 0.62, 1.25);
  const basePx = 62 * u;
  const current: Frame = {
    box: unionBox(worldBox(g), gg ? worldBox(gg) : null),
    basePx,
    pxPerN: basePx / Math.max(1e-9, (params.mass + params.load) * params.gravity),
    kgPerPx:
      Math.max(1.3 * Math.max(0, g.capacityLoad), 0.3 * (params.mass + params.load), 1) / (150 * u),
  };
  if (scene.active) frozen ??= current;
  else {
    frozen = null;
    anchor = null;
  }
  const use = frozen ?? current;
  const camera = new Camera(width, height, use.box, {
    left: 20,
    right: 20,
    top: Math.round(96 * u),
    bottom: Math.round(30 * u),
  });
  return { g, gg, u, camera, ...use };
}

interface Placed {
  cx: number;
  cy: number;
  top: number;
  bottom: number;
  w: number;
  h: number;
  bob: number;
}

function place(camera: Camera, g: Geometry, depth: number, clock: number, onBottom: boolean): Placed {
  const w = camera.s(g.width);
  const h = camera.s(g.h);
  const cx = camera.sx(0);
  const weight = onBottom ? 0 : clamp(1 - (depth - g.h) / (0.25 * g.h), 0, 1);
  const bob = wave(cx, clock) * 0.85 * weight;
  const bottom = camera.sy(-depth) + bob;
  return { cx, cy: bottom - h / 2, top: bottom - h, bottom, w, h, bob };
}

function loadHandlePos(scene: LabScene<BuoyancyState>, L: ReturnType<typeof layout>, o: Placed) {
  const stack = L.camera.s(L.g.stackH);
  let y = o.top - stack - (L.g.stackH > 0 ? 16 : 40) * L.u;
  if (scene.active === "load" && anchor?.id === "load")
    y = anchor.py + (scene.params.load - anchor.load) / L.kgPerPx;
  return { x: o.cx, y };
}

function volumeHandlePos(scene: LabScene<BuoyancyState>, o: Placed) {
  let x = o.cx + o.w / 2 + 2;
  if (scene.active === "volume" && anchor?.id === "volume")
    x = o.cx + (anchor.widthPx * Math.sqrt(scene.params.volume / anchor.volume)) / 2 + 2;
  return { x, y: o.top + Math.min(o.h * 0.35, 18) };
}

function handleState(scene: LabScene, id: string) {
  return scene.active === id ? "active" : scene.hover === id ? "hover" : "idle";
}

// ---------------------------------------------------------------------------
// Drawing helpers

/** Outline path matching body() for each shape. */
function silhouette(ctx: CanvasRenderingContext2D, shape: Shape, cx: number, cy: number, w: number, h: number) {
  ctx.beginPath();
  ctx.save();
  ctx.translate(cx, cy);
  switch (shape) {
    case "ball": {
      const r = Math.min(w, h) / 2;
      ctx.moveTo(r, 0);
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      break;
    }
    case "disc":
    case "plate":
    case "cap":
    case "wheel":
      ctx.moveTo(w / 2, 0);
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
      break;
    case "bottle": {
      const neck = w * 0.36;
      ctx.moveTo(-w / 2, h / 2);
      ctx.lineTo(-w / 2, -h * 0.12);
      ctx.quadraticCurveTo(-w / 2, -h * 0.3, -neck / 2, -h * 0.34);
      ctx.lineTo(-neck / 2, -h / 2);
      ctx.lineTo(neck / 2, -h / 2);
      ctx.lineTo(neck / 2, -h * 0.34);
      ctx.quadraticCurveTo(w / 2, -h * 0.3, w / 2, -h * 0.12);
      ctx.lineTo(w / 2, h / 2);
      ctx.closePath();
      break;
    }
    case "cup":
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(w / 2, -h / 2);
      ctx.lineTo(w * 0.38, h / 2);
      ctx.lineTo(-w * 0.38, h / 2);
      ctx.closePath();
      break;
    case "boat":
      ctx.moveTo(-w / 2, -h / 2);
      ctx.lineTo(w / 2, -h / 2);
      ctx.quadraticCurveTo(w * 0.46, h / 2, w * 0.2, h / 2);
      ctx.lineTo(-w * 0.2, h / 2);
      ctx.quadraticCurveTo(-w * 0.46, h / 2, -w / 2, -h / 2);
      ctx.closePath();
      break;
    case "bag":
      ctx.moveTo(-w * 0.38, -h * 0.28);
      ctx.lineTo(w * 0.38, -h * 0.28);
      ctx.quadraticCurveTo(w / 2, h / 2, w * 0.3, h / 2);
      ctx.lineTo(-w * 0.3, h / 2);
      ctx.quadraticCurveTo(-w / 2, h / 2, -w * 0.38, -h * 0.28);
      ctx.closePath();
      break;
    case "person": {
      const headR = Math.min(w * 0.36, h * 0.16);
      ctx.moveTo(headR, -h / 2 + headR);
      ctx.arc(0, -h / 2 + headR, headR, 0, Math.PI * 2);
      roundRect(ctx, -w * 0.34, -h / 2 + headR * 2.2, w * 0.68, h * 0.48, w * 0.3);
      roundRect(ctx, -w * 0.3, -h / 2 + headR * 2.2 + h * 0.44, w * 0.24, h * 0.36, w * 0.1);
      roundRect(ctx, w * 0.06, -h / 2 + headR * 2.2 + h * 0.44, w * 0.24, h * 0.36, w * 0.1);
      break;
    }
    case "bar":
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) / 2);
      break;
    case "door":
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.08);
      break;
    case "phone":
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.18);
      break;
    case "book":
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.06);
      break;
    default:
      roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.12);
  }
  ctx.restore();
}

/** Region below the wavy liquid surface between two canvas x positions. */
function belowSurface(ctx: CanvasRenderingContext2D, x0: number, x1: number, surfaceY: number, bottom: number, clock: number) {
  ctx.beginPath();
  ctx.moveTo(x0, bottom);
  for (let x = x0; x <= x1 + 5.99; x += 6) {
    const px = Math.min(x, x1);
    ctx.lineTo(px, surfaceY + wave(px, clock));
  }
  ctx.lineTo(x1, bottom);
  ctx.closePath();
}

/** Pictogram of a seated rider facing right; (x, seatY) is the hip on the deck. */
function seatedRider(ctx: CanvasRenderingContext2D, x: number, seatY: number, size: number, color: string) {
  const s = size;
  ctx.save();
  ctx.translate(x, seatY);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const gradient = ctx.createLinearGradient(0, -s, 0, s * 0.3);
  gradient.addColorStop(0, tone(color, 45));
  gradient.addColorStop(1, tone(color, -50));
  ctx.strokeStyle = gradient;
  ctx.fillStyle = gradient;
  ctx.shadowColor = "rgba(0,0,0,0.35)";
  ctx.shadowBlur = 5;
  ctx.shadowOffsetY = 2;
  ctx.lineWidth = s * 0.17;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.05);
  ctx.lineTo(s * 0.34, -s * 0.03);
  ctx.lineTo(s * 0.38, s * 0.26);
  ctx.stroke();
  ctx.lineWidth = s * 0.26;
  ctx.beginPath();
  ctx.moveTo(0, -s * 0.1);
  ctx.lineTo(s * 0.08, -s * 0.54);
  ctx.stroke();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = s * 0.09;
  ctx.strokeStyle = tone(color, -25);
  ctx.beginPath();
  ctx.moveTo(s * 0.1, -s * 0.5);
  ctx.lineTo(s * 0.28, -s * 0.3);
  ctx.lineTo(s * 0.42, -s * 0.33);
  ctx.stroke();
  ctx.fillStyle = tone(color, 60);
  ctx.beginPath();
  ctx.arc(s * 0.14, -s * 0.84, s * 0.14, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  reserve({ left: x - s * 0.12, top: seatY - s, width: s * 0.62, height: s * 1.3 });
}

function drawLoad(ctx: CanvasRenderingContext2D, camera: Camera, g: Geometry, o: Placed) {
  for (const item of g.items) {
    const x = o.cx + camera.s(item.x);
    if (g.seated) seatedRider(ctx, x, o.top + 1, camera.s(item.h), g.loadColor);
    else {
      const ih = camera.s(item.h);
      body(ctx, g.loadShape, x, o.top - camera.s(item.y) - ih / 2, camera.s(item.w), ih, g.loadColor, { shadow: false, outline: "rgba(0,0,0,0.25)" });
    }
  }
}

function bubbles(ctx: CanvasRenderingContext2D, cx: number, span: number, fromY: number, toY: number, clock: number, strength: number) {
  if (strength <= 0.01 || fromY - toY < 10) return;
  ctx.save();
  ctx.lineWidth = 1.1;
  for (let i = 0; i < 16; i++) {
    const speed = 0.28 + (((i * 7919) % 13) / 13) * 0.35;
    const phase = (clock * speed + ((i * 0.618034) % 1)) % 1;
    const x = cx + ((((i * 104729) % 101) / 100) - 0.5) * span + Math.sin(clock * 2.3 + i * 1.7) * 4 * phase;
    const y = fromY + (toY - fromY) * phase;
    const r = (1.3 + (((i * 31) % 7) / 7) * 2.6) * (0.7 + 0.5 * phase);
    const fade = phase < 0.12 ? phase / 0.12 : phase > 0.88 ? (1 - phase) / 0.12 : 1;
    ctx.globalAlpha = strength * fade * 0.85;
    ctx.strokeStyle = "rgba(220, 245, 255, 0.9)";
    ctx.fillStyle = "rgba(220, 245, 255, 0.16)";
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function chevrons(ctx: CanvasRenderingContext2D, x: number, y: number, vertical: boolean, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  const a = 3.2;
  if (vertical) {
    ctx.moveTo(x, y - 5.5);
    ctx.lineTo(x - a, y - 1.5);
    ctx.lineTo(x + a, y - 1.5);
    ctx.moveTo(x, y + 5.5);
    ctx.lineTo(x - a, y + 1.5);
    ctx.lineTo(x + a, y + 1.5);
  } else {
    ctx.moveTo(x - 5.5, y);
    ctx.lineTo(x - 1.5, y - a);
    ctx.lineTo(x - 1.5, y + a);
    ctx.moveTo(x + 5.5, y);
    ctx.lineTo(x + 1.5, y - a);
    ctx.lineTo(x + 1.5, y + a);
  }
  ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------------------

export const buoyancyView: EngineView<BuoyancyState> = {
  charts: ["depth", "buoyant"],
  ambient: true,
  hud: ({ state, t }) => [
    { label: "time", value: formatQuantity(t, "s", 2) },
    { label: "depth", value: formatLength(Math.max(0, state.depth)) },
    { label: "buoyancy", value: formatForce(state.buoyant), color: QUANTITY_COLORS.buoyancy },
    { label: "weight", value: formatForce(state.weight), color: QUANTITY_COLORS.weight },
  ],
  draw(scene) {
    const { ctx, width, height, sim, state, params, ghost, skin, showVectors, clock } = scene;
    const L = layout(scene);
    const { camera, g, u } = L;
    const fluid = fluidFor(params.fluidDensity);
    backdrop(ctx, width, height, camera, { grid: true });

    const surfaceY = camera.sy(0);
    const floorY = camera.sy(-g.floor);
    const left = camera.wx(-8);
    const right = camera.wx(width + 8);

    // Air: soft haze toward the horizon.
    const hazeTop = surfaceY - 150 * u;
    const haze = ctx.createLinearGradient(0, hazeTop, 0, surfaceY);
    haze.addColorStop(0, "rgba(124, 165, 255, 0)");
    haze.addColorStop(1, "rgba(124, 175, 255, 0.11)");
    ctx.fillStyle = haze;
    ctx.fillRect(0, hazeTop, width, surfaceY - hazeTop);

    // Tank floor / seabed and the liquid behind the object.
    const bedThickness = Math.max(0.01, (height + 12 - floorY) / camera.scale);
    surfaceBand(ctx, camera, { x: left, y: -g.floor }, { x: right, y: -g.floor }, fluid.bed, bedThickness);
    liquid(ctx, camera, 0, -g.floor, left, right, clock, fluid.tint);

    const onBottom = state.onBottom > 0.5;
    const o = place(camera, g, state.depth, clock, onBottom);
    const shape = skin.body.shape;

    // Object and its load, then a second liquid pass veils what is underwater.
    body(ctx, shape, o.cx, o.cy, o.w, o.h, skin.body.color, { shadow: false, outline: "rgba(0,0,0,0.28)" });
    drawLoad(ctx, camera, g, o);
    ctx.save();
    ctx.globalAlpha = fluid.veil;
    liquid(ctx, camera, 0, -g.floor, camera.wx(o.cx - o.w / 2 - camera.s(g.width) - 40), camera.wx(o.cx + o.w / 2 + camera.s(g.width) + 40), clock, fluid.tint);
    ctx.restore();

    // Displaced liquid: the part of the outline below the surface.
    const submergedPx = o.bottom - (surfaceY + wave(o.cx, clock));
    const displaced = Math.min(g.volume, Math.max(0, state.depth) * g.area);
    if (submergedPx > 1.5) {
      const x0 = o.cx - o.w / 2 - 4;
      const x1 = o.cx + o.w / 2 + 4;
      const cyan = QUANTITY_COLORS.buoyancy;
      ctx.save();
      belowSurface(ctx, x0, x1, surfaceY, o.bottom + 6, clock);
      ctx.clip();
      silhouette(ctx, shape, o.cx, o.cy, o.w, o.h);
      ctx.save();
      ctx.clip();
      ctx.fillStyle = "rgba(56, 214, 232, 0.2)";
      ctx.fillRect(x0, o.top - 4, x1 - x0, o.h + 10);
      ctx.strokeStyle = "rgba(56, 214, 232, 0.5)";
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      for (let x = x0 - o.h - 10; x < x1; x += 7) {
        ctx.moveTo(x, o.bottom + 6);
        ctx.lineTo(x + o.h + 12, o.top - 6);
      }
      ctx.stroke();
      ctx.restore();
      silhouette(ctx, shape, o.cx, o.cy, o.w, o.h);
      ctx.strokeStyle = cyan;
      ctx.lineWidth = 2;
      ctx.shadowColor = cyan;
      ctx.shadowBlur = 10;
      ctx.stroke();
      ctx.restore();
    }

    // Settled waterline painted on the hull.
    if (g.floats) {
      const markY = o.bottom - camera.s(g.floatDepth);
      ctx.save();
      silhouette(ctx, shape, o.cx, o.cy, o.w, o.h);
      ctx.clip();
      ctx.strokeStyle = "rgba(255,255,255,0.85)";
      ctx.lineWidth = 1.6;
      ctx.setLineDash([7, 4]);
      ctx.beginPath();
      ctx.moveTo(o.cx - o.w / 2, markY);
      ctx.lineTo(o.cx + o.w / 2, markY);
      ctx.stroke();
      ctx.restore();
    }

    // Previous run.
    if (ghost) {
      const gg = L.gg!;
      const gs = ghost.state as BuoyancyState;
      const go = place(camera, gg, gs.depth, clock, gs.onBottom > 0.5);
      body(ctx, shape, go.cx, go.cy, go.w, go.h, skin.body.color, { ghost: true, alpha: 0.9 });
      if (Math.abs(go.cy - o.cy) > (go.h + o.h) / 2 + 8)
        pill(ctx, go.cx + go.w / 2 + 10, go.cy, "previous run", { size: 10, color: LAB.muted, align: "left" });
    }

    // Sinking: bubbles stream up from the object.
    if (!g.floats) {
      const strength = clamp((state.depth - g.h) / (0.3 * g.h), 0, 1);
      bubbles(ctx, o.cx, o.w * 0.8, o.top - camera.s(g.stackH) * 0.5, surfaceY + 4, clock, strength);
    }

    // Vectors.
    const forceLen = (force: number) => {
      if (!(force > 1e-9)) return 0;
      let len = force * L.pxPerN;
      const knee = L.basePx * 1.6;
      if (len > knee) len = knee + (len - knee) * 0.25;
      return clamp(len, 10, L.basePx * 2.4);
    };
    const settled = g.floats && Math.abs(state.buoyant - state.weight) <= 0.03 * state.weight && Math.abs(state.v) < 0.03;
    if (showVectors) {
      const off = 9 * u;
      const subDepth = clamp(state.depth, 0, g.h);
      const cbY = o.bottom - camera.s(subDepth) / 2;
      const comY = o.bottom - camera.s(comHeight(g));
      ctx.save();
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = QUANTITY_COLORS.weight;
      ctx.fillStyle = LAB.bgBottom;
      ctx.beginPath();
      ctx.arc(o.cx, comY, 4.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = QUANTITY_COLORS.weight;
      ctx.beginPath();
      ctx.moveTo(o.cx, comY);
      ctx.arc(o.cx, comY, 4.5, -Math.PI / 2, 0);
      ctx.moveTo(o.cx, comY);
      ctx.arc(o.cx, comY, 4.5, Math.PI / 2, Math.PI);
      ctx.fill();
      ctx.restore();
      const lenB = forceLen(state.buoyant);
      if (lenB > 0) vector(ctx, o.cx - off, cbY, 0, -lenB, "buoyancy", "F_B");
      vector(ctx, o.cx + off, comY, 0, forceLen(state.weight), "weight", "W");
      if (onBottom) {
        const normal = Math.max(0, state.weight - state.buoyant);
        vector(ctx, o.cx - off * 3.2, o.bottom, 0, -forceLen(normal), "normal", "N");
      }
      let status: { text: string; color: string } | null = null;
      if (settled) status = { text: "F_B = W → floats", color: LAB.good };
      else if (onBottom) status = { text: "F_B + N = W → rests on the bottom", color: LAB.muted };
      else if (!g.floats && state.submerged >= 0.999) status = { text: "F_B < W even fully under", color: LAB.bad };
      else if (state.depth > 1e-4 && state.buoyant > state.weight * 1.04) status = { text: "F_B > W → pushed back up", color: QUANTITY_COLORS.buoyancy };
      else if (state.depth > 1e-4 && state.buoyant < state.weight * 0.96) status = { text: "F_B < W → sinks deeper", color: QUANTITY_COLORS.weight };
      const belowY = Math.max(o.bottom, comY + forceLen(state.weight)) + 36 * u;
      const roomBelow = belowY + 12 < floorY - 8;
      if (status)
        pill(ctx, roomBelow ? o.cx : o.cx + o.w / 2 + 18 * u, roomBelow ? belowY : o.cy + 18 * u, status.text, {
          align: roomBelow ? "center" : "left",
          size: 12,
          weight: 700,
          color: status.color,
          border: `${status.color}66`,
        });
    }

    // Too heavy.
    if (!g.floats && state.submerged >= 0.999)
      pill(ctx, o.cx, Math.min(surfaceY - 30 * u, o.top - camera.s(g.stackH) - 16 * u - 58), "too heavy: sinks", {
        align: "center",
        size: 13,
        weight: 700,
        color: LAB.bad,
        border: `${LAB.bad}88`,
        background: "rgba(40, 8, 20, 0.85)",
      });

    // Freeboard dimension on the left of the hull.
    const freeboard = g.h - state.depth;
    const dimX = o.cx - o.w / 2 - 16 * u;
    if (freeboard > 0.001) {
      const waterAt = o.bottom - camera.s(Math.max(0, state.depth));
      ctx.save();
      ctx.strokeStyle = LAB.muted;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(dimX, waterAt);
      ctx.lineTo(dimX, o.top);
      ctx.moveTo(dimX - 5, o.top);
      ctx.lineTo(dimX + 5, o.top);
      ctx.moveTo(dimX - 5, waterAt);
      ctx.lineTo(dimX + 5, waterAt);
      ctx.stroke();
      ctx.restore();
      pill(ctx, dimX - 8, (o.top + waterAt) / 2 - 2, `${formatLength(freeboard)} above ${fluid.noun}`, {
        align: "right",
        size: 11,
        mono: true,
        weight: 500,
        color: LAB.muted,
      });
    }

    // Displaced liquid label with a leader.
    if (submergedPx > 3) {
      const midY = Math.max(surfaceY + 12 * u, o.bottom - Math.min(submergedPx, o.h) / 2);
      const box = pill(ctx, dimX - 8, midY + 12 * u, `displaced ${fluid.noun} ${formatVolume(displaced)}`, {
        immediate: true,
        align: "right",
        size: 12,
        weight: 700,
        color: QUANTITY_COLORS.buoyancy,
        border: `${QUANTITY_COLORS.buoyancy}55`,
      });
      ctx.save();
      ctx.strokeStyle = `${QUANTITY_COLORS.buoyancy}99`;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(box.left + box.width + 2, box.top + box.height / 2);
      ctx.lineTo(o.cx - o.w * 0.28, midY);
      ctx.stroke();
      ctx.fillStyle = QUANTITY_COLORS.buoyancy;
      ctx.beginPath();
      ctx.arc(o.cx - o.w * 0.28, midY, 2.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Liquid name near the floor.
    pill(ctx, 14, floorY - 16 * u, `${fluid.label} · ${formatQuantity(params.fluidDensity, "kg/m³", 0)}`, {
      size: 11,
      weight: 600,
      color: LAB.muted,
      background: "rgba(7, 18, 38, 0.55)",
    });

    // Load label and handle.
    const lh = loadHandlePos(scene, L, o);
    const loadState = handleState(scene, "load");
    if (scene.active === "load") {
      ctx.save();
      ctx.strokeStyle = LAB.faint;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(lh.x, lh.y + 11);
      ctx.lineTo(lh.x, o.top - camera.s(g.stackH));
      ctx.stroke();
      ctx.restore();
    }
    handleRing(ctx, lh.x, lh.y, 11, loadState, QUANTITY_COLORS.weight);
    chevrons(ctx, lh.x, lh.y, true, loadState === "idle" ? `${QUANTITY_COLORS.weight}aa` : QUANTITY_COLORS.weight);
    pill(
      ctx,
      lh.x,
      lh.y - 16,
      params.load > 0 ? `${g.loadName} +${formatMass(params.load)}` : loadState === "idle" ? "no load" : "drag down to add load",
      {
        align: "center",
        baseline: "bottom",
        size: 12,
        weight: 700,
        color: params.load > 0 ? QUANTITY_COLORS.weight : LAB.muted,
        border: `${QUANTITY_COLORS.weight}44`,
      },
    );

    const vh = volumeHandlePos(scene, o);
    const volumeState = handleState(scene, "volume");
    handleRing(ctx, vh.x, vh.y, 9, volumeState, LAB.muted);
    chevrons(ctx, vh.x, vh.y, false, volumeState === "idle" ? LAB.faint : LAB.text);
    if (volumeState !== "idle")
      pill(ctx, vh.x + 14, vh.y, `volume ${formatVolume(params.volume)}`, { size: 11, align: "left", color: LAB.text });

    // Load capacity meter.
    const panelW = Math.round(clamp(width * 0.26, 150, 210));
    const panelH = 54;
    const panelX = width - panelW - 14;
    const panelY = 14;
    ctx.save();
    ctx.beginPath();
    roundRect(ctx, panelX, panelY, panelW, panelH, 10);
    ctx.fillStyle = LAB.panel;
    ctx.fill();
    ctx.strokeStyle = LAB.panelBorder;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    const share = g.floats ? g.floatDepth / g.h : 1;
    const meterColor = !g.floats ? LAB.bad : share > 0.8 ? LAB.hot : LAB.good;
    const barX = panelX + 12;
    const barW = panelW - 24;
    meter(ctx, barX, panelY + 24, barW, share, meterColor, "load capacity", g.floats ? `${Math.round(share * 100)}% used` : "over 100%");
    if (L.gg) {
      const gShare = L.gg.floats ? L.gg.floatDepth / L.gg.h : 1;
      ctx.save();
      ctx.fillStyle = "rgba(255,255,255,0.75)";
      ctx.fillRect(barX + barW * clamp(gShare, 0, 1) - 1, panelY + 21, 2, 12);
      ctx.restore();
    }
    const spare = g.capacityLoad - g.load;
    ctx.save();
    ctx.font = `600 11px ${LAB.sans}`;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillStyle = spare >= 0 ? LAB.good : LAB.bad;
    ctx.fillText(spare >= 0 ? `spare load ${formatMass(spare)}` : `too heavy by ${formatMass(-spare)}`, barX, panelY + 43);
    if (panelW >= 190) {
      ctx.textAlign = "right";
      ctx.fillStyle = LAB.faint;
      ctx.fillText("100% = sinks", barX + barW, panelY + 43);
    }
    ctx.restore();
  },
  handles(scene) {
    const L = layout(scene);
    const { camera, g } = L;
    const o = place(camera, g, scene.state.depth, scene.clock, scene.state.onBottom > 0.5);
    const lh = loadHandlePos(scene, L, o);
    const vh = volumeHandlePos(scene, o);
    const { params } = scene;
    const handles: LabHandle[] = [
      {
        id: "load",
        x: lh.x,
        y: lh.y,
        r: 15,
        label: "Drag down to add load, up to remove it",
        cursor: "ns-resize",
        drag: (px, py) => {
          if (anchor?.id !== "load")
            anchor = { id: "load", px, py, load: params.load, volume: params.volume, widthPx: o.w };
          const raw = anchor.load + (py - anchor.py) * L.kgPerPx;
          const step = Math.max(0.001, 10 ** Math.floor(Math.log10(L.kgPerPx)));
          return { load: Math.max(0, Math.round(raw / step) * step) };
        },
      },
      {
        id: "volume",
        x: vh.x,
        y: vh.y,
        r: 13,
        label: "Drag sideways to make it bigger or smaller (volume)",
        cursor: "ew-resize",
        drag: (px, py) => {
          if (anchor?.id !== "volume")
            anchor = { id: "volume", px, py, load: params.load, volume: params.volume, widthPx: Math.max(8, o.w) };
          const next = Math.max(6, anchor.widthPx + 2 * (px - anchor.px));
          return { volume: anchor.volume * (next / anchor.widthPx) ** 2 };
        },
      },
    ];
    return handles;
  },
};
