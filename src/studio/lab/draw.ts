import type { Quantity, Shape } from "../../../shared/studio/schema";
import { nearestEdgePoint, placeLabel, segmentBoxes, type Box, type LayoutContext } from "../labelLayout";

// Drawing toolkit for the physics lab: one dark "instrument" look shared by
// every engine view. World units are meters with y up; canvas units are CSS px.

export const LAB = {
  bgTop: "#10254a",
  bgBottom: "#07142a",
  grid: "rgba(160, 182, 222, 0.06)",
  gridMajor: "rgba(160, 182, 222, 0.12)",
  axis: "rgba(196, 210, 238, 0.42)",
  text: "#eef3ff",
  muted: "rgba(206, 218, 242, 0.66)",
  faint: "rgba(206, 218, 242, 0.34)",
  panel: "rgba(8, 20, 42, 0.72)",
  panelBorder: "rgba(160, 182, 222, 0.22)",
  hot: "#ff7a2f",
  blue: "#7c9bff",
  good: "#3ddc97",
  bad: "#ff5c7a",
  ghost: "rgba(206, 218, 242, 0.28)",
  sans: '"Source Sans 3", system-ui, -apple-system, "Segoe UI", sans-serif',
  mono: '"Source Code Pro", ui-monospace, SFMono-Regular, Menlo, monospace',
};

/** One color per physical quantity, used in the lab and on the video. */
export const QUANTITY_COLORS: Record<Quantity, string> = {
  force: "#ff7a2f",
  weight: "#ffb224",
  normal: "#3ddc97",
  friction: "#ff5c7a",
  tension: "#b69cff",
  buoyancy: "#38d6e8",
  velocity: "#7c9bff",
  acceleration: "#f472d0",
  momentum: "#a5b4fc",
  displacement: "#e6ecf8",
};

export interface Point {
  x: number;
  y: number;
}

export interface WorldBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Uniform world-to-canvas mapping that fits a world box inside padded canvas space. */
export class Camera {
  readonly scale: number;
  private readonly ox: number;
  private readonly oy: number;

  constructor(
    readonly width: number,
    readonly height: number,
    readonly world: WorldBox,
    pad: { left: number; right: number; top: number; bottom: number } = {
      left: 48,
      right: 48,
      top: 56,
      bottom: 48,
    },
  ) {
    const innerW = Math.max(10, width - pad.left - pad.right);
    const innerH = Math.max(10, height - pad.top - pad.bottom);
    const worldW = Math.max(1e-6, world.x1 - world.x0);
    const worldH = Math.max(1e-6, world.y1 - world.y0);
    this.scale = Math.min(innerW / worldW, innerH / worldH);
    const usedW = worldW * this.scale;
    const usedH = worldH * this.scale;
    this.ox = pad.left + (innerW - usedW) / 2 - world.x0 * this.scale;
    this.oy = pad.top + (innerH - usedH) / 2 + world.y1 * this.scale;
  }

  sx(x: number) {
    return this.ox + x * this.scale;
  }
  sy(y: number) {
    return this.oy - y * this.scale;
  }
  s(length: number) {
    return length * this.scale;
  }
  wx(px: number) {
    return (px - this.ox) / this.scale;
  }
  wy(py: number) {
    return (this.oy - py) / this.scale;
  }
  /** Visible world box (the whole canvas, not just the fitted region). */
  visible(): WorldBox {
    return {
      x0: this.wx(0),
      x1: this.wx(this.width),
      y0: this.wy(this.height),
      y1: this.wy(0),
    };
  }
}

const boxCache = new WeakMap<object, WorldBox>();
/** Memoizes an expensive bounds computation per simulation object. */
export function cachedBox(key: object, compute: () => WorldBox) {
  let box = boxCache.get(key);
  if (!box) boxCache.set(key, (box = compute()));
  return box;
}

export function unionBox(a: WorldBox, b: WorldBox | null | undefined): WorldBox {
  if (!b) return a;
  return {
    x0: Math.min(a.x0, b.x0),
    x1: Math.max(a.x1, b.x1),
    y0: Math.min(a.y0, b.y0),
    y1: Math.max(a.y1, b.y1),
  };
}

/** Round step (1, 2, 5 × 10^n) giving about `target` ticks across `range`. */
export function niceStep(range: number, target = 8) {
  const raw = Math.max(1e-9, range / target);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return nice * power;
}

export function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  if (abs >= 10_000) return value.toExponential(1).replace("e+", "e");
  if (abs >= 1000) return Math.round(value).toLocaleString("en-US");
  const fixed = value.toFixed(abs >= 100 ? Math.min(1, digits) : digits);
  return fixed === "-0" || /^-0\.0*$/.test(fixed) ? fixed.slice(1) : fixed;
}

export function formatQuantity(value: number | null | undefined, unit: string, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const number = formatNumber(value, digits);
  if (!unit) return number;
  if (unit === "°" || unit === "%") return `${number}${unit}`;
  return `${number} ${unit}`;
}

/** Background gradient, vignette and an optional metric grid. */
export function backdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  camera?: Camera,
  options: { grid?: boolean; labels?: boolean } = {},
) {
  resetLabels(width, height);
  const gradient = ctx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, LAB.bgTop);
  gradient.addColorStop(1, LAB.bgBottom);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  const glow = ctx.createRadialGradient(
    width * 0.72,
    height * 0.12,
    0,
    width * 0.72,
    height * 0.12,
    Math.max(width, height) * 0.7,
  );
  glow.addColorStop(0, "rgba(90, 120, 255, 0.16)");
  glow.addColorStop(1, "rgba(90, 120, 255, 0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);
  if (camera && options.grid !== false) {
    const view = camera.visible();
    const step = niceStep(Math.max(view.x1 - view.x0, view.y1 - view.y0), 12);
    ctx.lineWidth = 1;
    const startX = Math.floor(view.x0 / step) * step;
    const startY = Math.floor(view.y0 / step) * step;
    for (let x = startX, i = 0; x <= view.x1 && i < 400; x += step, i++) {
      const major = Math.abs(Math.round(x / step) % 5) === 0;
      ctx.strokeStyle = major ? LAB.gridMajor : LAB.grid;
      const px = Math.round(camera.sx(x)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, height);
      ctx.stroke();
    }
    for (let y = startY, i = 0; y <= view.y1 && i < 400; y += step, i++) {
      const major = Math.abs(Math.round(y / step) % 5) === 0;
      ctx.strokeStyle = major ? LAB.gridMajor : LAB.grid;
      const py = Math.round(camera.sy(y)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(0, py);
      ctx.lineTo(width, py);
      ctx.stroke();
    }
    if (options.labels) {
      ctx.font = `500 10px ${LAB.mono}`;
      ctx.fillStyle = LAB.faint;
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      const label = `grid ${formatNumber(step, step < 1 ? 2 : 0)} m`;
      ctx.fillText(label, 14, height - 10);
    }
  }
  const vignette = ctx.createRadialGradient(
    width / 2,
    height / 2,
    Math.min(width, height) * 0.35,
    width / 2,
    height / 2,
    Math.max(width, height) * 0.75,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.28)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}

const MATERIAL_COLORS: Record<string, [string, string]> = {
  wood: ["#8a5a36", "#5e3b22"],
  metal: ["#8793a6", "#566174"],
  stone: ["#7d7f86", "#50535b"],
  ice: ["#bfe6f5", "#79b7d2"],
  water: ["#2f7fd1", "#1a4f8f"],
  sand: ["#d9b77c", "#a88450"],
  grass: ["#4f9a4a", "#2f6a31"],
  carpet: ["#7a5d8c", "#4f3b5c"],
  plastic: ["#d8dde6", "#9aa3b2"],
  glass: ["#9fd3e6", "#5f99b0"],
  concrete: ["#9b9ea4", "#6c6f75"],
  fabric: ["#b56b6b", "#7a4242"],
};

/**
 * A solid surface band whose top edge runs from (x0, y0) to (x1, y1) in world
 * units, with a material texture and a bright top edge.
 */
export function surfaceBand(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  a: Point,
  b: Point,
  material = "wood",
  thickness = 0.35,
) {
  const [light, dark] = MATERIAL_COLORS[material] ?? MATERIAL_COLORS.wood;
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = Math.sin(angle);
  const ny = -Math.cos(angle);
  const depth = thickness;
  const pts = [
    a,
    b,
    { x: b.x + nx * depth, y: b.y + ny * depth },
    { x: a.x + nx * depth, y: a.y + ny * depth },
  ];
  ctx.save();
  ctx.beginPath();
  pts.forEach((p, i) =>
    i ? ctx.lineTo(camera.sx(p.x), camera.sy(p.y)) : ctx.moveTo(camera.sx(p.x), camera.sy(p.y)),
  );
  ctx.closePath();
  const gradient = ctx.createLinearGradient(
    camera.sx(a.x),
    camera.sy(a.y),
    camera.sx(a.x + nx * depth),
    camera.sy(a.y + ny * depth),
  );
  gradient.addColorStop(0, light);
  gradient.addColorStop(1, dark);
  ctx.fillStyle = gradient;
  ctx.globalAlpha = 0.92;
  ctx.fill();
  ctx.clip();
  // Texture strokes along the surface direction.
  ctx.globalAlpha = material === "water" ? 0.25 : 0.16;
  ctx.strokeStyle = material === "grass" ? "#9be08f" : "#ffffff";
  ctx.lineWidth = 1;
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const lines = material === "sand" || material === "concrete" ? 0 : 6;
  for (let i = 1; i <= lines; i++) {
    const offset = (depth * i) / (lines + 1);
    const wobble = material === "wood" ? 0.04 : 0;
    ctx.beginPath();
    for (let s = 0; s <= 24; s++) {
      const u = (s / 24) * length;
      const w = wobble * Math.sin(u * 3.1 + i * 1.7);
      const px = a.x + Math.cos(angle) * u + nx * (offset + w * 0.3);
      const py = a.y + Math.sin(angle) * u + ny * (offset + w * 0.3);
      s ? ctx.lineTo(camera.sx(px), camera.sy(py)) : ctx.moveTo(camera.sx(px), camera.sy(py));
    }
    ctx.stroke();
  }
  if (material === "sand" || material === "concrete") {
    ctx.fillStyle = "#ffffff";
    const count = Math.min(220, Math.floor(camera.s(length) / 3));
    for (let i = 0; i < count; i++) {
      const u = ((i * 7919) % 1000) / 1000;
      const v = ((i * 104729) % 997) / 997;
      const px = a.x + Math.cos(angle) * u * length + nx * v * depth;
      const py = a.y + Math.sin(angle) * u * length + ny * v * depth;
      ctx.fillRect(camera.sx(px), camera.sy(py), 1.4, 1.4);
    }
  }
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(255,255,255,0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(camera.sx(a.x), camera.sy(a.y));
  ctx.lineTo(camera.sx(b.x), camera.sy(b.y));
  ctx.stroke();
  ctx.restore();
}

export interface ArrowOptions {
  width?: number;
  head?: number;
  glow?: boolean;
  dashed?: boolean;
  alpha?: number;
}

/** Arrow from (x, y) along (dx, dy) in canvas pixels. */
export function arrow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: string,
  options: ArrowOptions = {},
) {
  const length = Math.hypot(dx, dy);
  if (length < 2) return;
  const width = options.width ?? 3;
  const head = Math.min(options.head ?? width * 4 + 4, length * 0.6);
  const ux = dx / length;
  const uy = dy / length;
  const tipX = x + dx;
  const tipY = y + dy;
  const baseX = tipX - ux * head;
  const baseY = tipY - uy * head;
  ctx.save();
  ctx.globalAlpha = options.alpha ?? 1;
  if (options.glow) {
    ctx.shadowColor = color;
    ctx.shadowBlur = 12;
  }
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  if (options.dashed) ctx.setLineDash([width * 2.2, width * 1.8]);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(baseX + ux * 1, baseY + uy * 1);
  ctx.stroke();
  ctx.setLineDash([]);
  const half = head * 0.55;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(baseX - uy * half, baseY + ux * half);
  ctx.lineTo(baseX + ux * head * 0.18, baseY + uy * head * 0.18);
  ctx.lineTo(baseX + uy * half, baseY - ux * half);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  reserve(...segmentBoxes(x, y, tipX, tipY, width + 10));
}

export interface PillOptions {
  color?: string;
  background?: string;
  border?: string;
  align?: "left" | "center" | "right";
  baseline?: "top" | "middle" | "bottom";
  size?: number;
  weight?: number;
  mono?: boolean;
  alpha?: number;
  /** Place and draw right away (when the caller needs the final box); otherwise placed at the end of the frame. */
  immediate?: boolean;
}

/** Splits "F_push", "v_x" or "F_{net}" into normal and subscript runs. */
export function textRuns(text: string) {
  const runs: Array<{ text: string; sub: boolean }> = [];
  const pattern = /_\{([^}]*)\}|_([A-Za-z0-9]+)/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    if (match.index > last) runs.push({ text: text.slice(last, match.index), sub: false });
    runs.push({ text: match[1] ?? match[2], sub: true });
    last = pattern.lastIndex;
  }
  if (last < text.length) runs.push({ text: text.slice(last), sub: false });
  return runs;
}

function fontFor(size: number, weight: number, mono?: boolean) {
  return `${weight} ${size}px ${mono ? LAB.mono : LAB.sans}`;
}

/** Width of text with subscript runs. */
export function measureRich(
  ctx: CanvasRenderingContext2D,
  text: string,
  size: number,
  weight = 600,
  mono = false,
) {
  let width = 0;
  for (const run of textRuns(text)) {
    ctx.font = fontFor(run.sub ? size * 0.72 : size, weight, mono);
    width += ctx.measureText(run.text).width;
  }
  return width;
}

/** Draws text with subscript runs, left-aligned, vertically centered on y. */
export function richText(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  size: number,
  color: string,
  weight = 600,
  mono = false,
) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let cursor = x;
  for (const run of textRuns(text)) {
    const runSize = run.sub ? size * 0.72 : size;
    ctx.font = fontFor(runSize, weight, mono);
    ctx.fillText(run.text, cursor, y + (run.sub ? size * 0.26 : 0));
    cursor += ctx.measureText(run.text).width;
  }
  ctx.restore();
  return cursor - x;
}

/**
 * Label layout for the current frame. Pills are queued while the scene draws
 * and placed at the end (flushLabels), so every body, arrow and handle is known:
 * each pill takes the nearest spot that clears them and earlier pills, and
 * keeps that spot across frames.
 */
const layout: LayoutContext = {
  bounds: { width: Infinity, height: Infinity },
  margin: 6,
  placed: [],
  obstacles: [],
  memory: new Map(),
};

interface PendingPill {
  ctx: CanvasRenderingContext2D;
  transform: DOMMatrix;
  x: number;
  y: number;
  text: string;
  options: PillOptions;
  natural: Box;
}
let pending: PendingPill[] = [];

/** Starts a new frame of label placement (backdrop() calls this). */
export function resetLabels(width = Infinity, height = Infinity) {
  layout.bounds = { width, height };
  layout.placed = [];
  layout.obstacles = [];
  pending = [];
  if (layout.memory!.size > 400) layout.memory!.clear();
}

/** Marks canvas areas labels must not cover. */
export function reserve(...boxes: Box[]) {
  layout.obstacles.push(...boxes);
}

function pillSize(ctx: CanvasRenderingContext2D, text: string, options: PillOptions) {
  const size = options.size ?? 12;
  const weight = options.weight ?? 600;
  const padX = size * 0.62;
  const h = size + 9;
  const w = measureRich(ctx, text, size, weight, options.mono) + padX * 2;
  return { size, weight, padX, w, h };
}

/** Rounded label chip (supports "_" subscripts); returns its preferred bounding box. */
export function pill(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  text: string,
  options: PillOptions = {},
) {
  const { w, h } = pillSize(ctx, text, options);
  const left =
    options.align === "center" ? x - w / 2 : options.align === "right" ? x - w : x;
  const top =
    options.baseline === "top" ? y : options.baseline === "bottom" ? y - h : y - h / 2;
  const item = { ctx, transform: ctx.getTransform(), x, y, text, options, natural: { left, top, width: w, height: h } };
  if (options.immediate) return drawPill(item);
  pending.push(item);
  return item.natural;
}

/** Places and draws every queued pill; call once after the scene is drawn. */
export function flushLabels() {
  const queue = pending;
  pending = [];
  for (const item of queue) drawPill(item);
}

function drawPill({ ctx, transform, x, y, text, options, natural }: PendingPill) {
  const { size, weight, padX, w, h } = pillSize(ctx, text, options);
  const dx = options.align === "left" ? 1 : options.align === "right" ? -1 : 0;
  const dy = options.baseline === "top" ? 1 : options.baseline === "bottom" ? -1 : 0;
  const placement = placeLabel({ key: text, x, y, dx, dy, width: w, height: h, gap: 6, natural }, layout);
  const box = placement.box;
  ctx.save();
  ctx.setTransform(transform);
  ctx.globalAlpha = options.alpha ?? 1;
  const end = nearestEdgePoint(box, x, y);
  if (placement.displaced && Math.hypot(end.x - x, end.y - y) > h * 0.9) {
    ctx.strokeStyle = options.color ?? LAB.text;
    ctx.globalAlpha = (options.alpha ?? 1) * 0.45;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
    ctx.globalAlpha = options.alpha ?? 1;
  }
  ctx.beginPath();
  roundRect(ctx, box.left, box.top, w, h, h / 2);
  ctx.fillStyle = options.background ?? "rgba(7, 18, 38, 0.82)";
  ctx.fill();
  ctx.strokeStyle = options.border ?? "rgba(255,255,255,0.14)";
  ctx.lineWidth = 1;
  ctx.stroke();
  richText(ctx, box.left + padX, box.top + h / 2 + 0.5, text, size, options.color ?? LAB.text, weight, options.mono);
  ctx.restore();
  return { left: box.left, top: box.top, width: w, height: h };
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/**
 * A labeled physics vector in canvas pixels, colored by quantity. The label
 * sits beyond the tip, nudged away from the arrow direction.
 */
export function vector(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  dx: number,
  dy: number,
  quantity: Quantity,
  label?: string,
  options: ArrowOptions & { labelAlpha?: number } = {},
) {
  const color = QUANTITY_COLORS[quantity];
  arrow(ctx, x, y, dx, dy, color, { width: 3.2, glow: true, ...options });
  const length = Math.hypot(dx, dy);
  if (!label || length < 6) return;
  const ux = dx / length;
  const uy = dy / length;
  const lx = x + dx + ux * 14;
  const ly = y + dy + uy * 14;
  pill(ctx, lx, ly, label, {
    color,
    align: ux > 0.35 ? "left" : ux < -0.35 ? "right" : "center",
    baseline: uy > 0.35 ? "top" : uy < -0.35 ? "bottom" : "middle",
    size: 12,
    weight: 700,
    alpha: options.labelAlpha ?? options.alpha ?? 1,
    border: `${color}55`,
  });
}

function shade(hex: string, amount: number) {
  const value = hex.replace("#", "");
  const num = parseInt(value.length === 3 ? value.replace(/(.)/g, "$1$1") : value, 16);
  const r = Math.min(255, Math.max(0, ((num >> 16) & 255) + amount));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 255) + amount));
  const b = Math.min(255, Math.max(0, (num & 255) + amount));
  return `rgb(${r}, ${g}, ${b})`;
}

export interface BodyOptions {
  angle?: number;
  alpha?: number;
  shadow?: boolean;
  outline?: string;
  ghost?: boolean;
}

/**
 * Stylized object skin centered at (cx, cy) with size w × h in pixels. Shapes
 * read clearly at small sizes: a can has a rim, a ball has seams, a door has a handle.
 */
export function body(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  cx: number,
  cy: number,
  w: number,
  h: number,
  color: string,
  options: BodyOptions = {},
) {
  ctx.save();
  ctx.translate(cx, cy);
  if (options.angle) ctx.rotate(options.angle);
  ctx.globalAlpha = options.alpha ?? 1;
  if (options.ghost) {
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = LAB.ghost;
    ctx.lineWidth = 1.5;
  }
  if (options.shadow !== false && !options.ghost) {
    ctx.shadowColor = "rgba(0,0,0,0.45)";
    ctx.shadowBlur = 16;
    ctx.shadowOffsetY = 6;
  }
  const fill = (path: () => void, gradientAxis: "x" | "y" | "radial" = "y") => {
    ctx.beginPath();
    path();
    if (options.ghost) {
      ctx.stroke();
      return;
    }
    let gradient: CanvasGradient;
    if (gradientAxis === "radial") {
      gradient = ctx.createRadialGradient(-w * 0.18, -h * 0.22, 1, 0, 0, Math.max(w, h) * 0.62);
      gradient.addColorStop(0, shade(color, 70));
      gradient.addColorStop(0.55, color);
      gradient.addColorStop(1, shade(color, -60));
    } else if (gradientAxis === "x") {
      gradient = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);
      gradient.addColorStop(0, shade(color, -45));
      gradient.addColorStop(0.38, shade(color, 55));
      gradient.addColorStop(0.62, color);
      gradient.addColorStop(1, shade(color, -60));
    } else {
      gradient = ctx.createLinearGradient(0, -h / 2, 0, h / 2);
      gradient.addColorStop(0, shade(color, 40));
      gradient.addColorStop(1, shade(color, -40));
    }
    ctx.fillStyle = gradient;
    ctx.fill();
    ctx.shadowColor = "transparent";
    if (options.outline) {
      ctx.strokeStyle = options.outline;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  };
  const detail = (draw: () => void) => {
    if (options.ghost) return;
    ctx.save();
    ctx.shadowColor = "transparent";
    draw();
    ctx.restore();
  };
  switch (shape) {
    case "ball": {
      const r = Math.min(w, h) / 2;
      fill(() => ctx.arc(0, 0, r, 0, Math.PI * 2), "radial");
      detail(() => {
        ctx.strokeStyle = "rgba(0,0,0,0.35)";
        ctx.lineWidth = Math.max(1, r * 0.07);
        ctx.beginPath();
        ctx.arc(0, 0, r * 0.98, 0, Math.PI * 2);
        ctx.moveTo(-r, 0);
        ctx.quadraticCurveTo(0, r * 0.28, r, 0);
        ctx.moveTo(0, -r);
        ctx.quadraticCurveTo(r * 0.28, 0, 0, r);
        ctx.stroke();
      });
      break;
    }
    case "disc":
    case "plate":
    case "cap":
    case "wheel": {
      fill(() => ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2), "radial");
      detail(() => {
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        ctx.ellipse(0, 0, w * 0.34, h * 0.34, 0, 0, Math.PI * 2);
        ctx.stroke();
        if (shape === "wheel" || shape === "cap") {
          // Spokes or grip ridges make rotation visible.
          const count = shape === "wheel" ? 6 : 18;
          ctx.strokeStyle = shape === "wheel" ? "rgba(255,255,255,0.45)" : "rgba(0,0,0,0.25)";
          ctx.lineWidth = shape === "wheel" ? 2 : 1;
          ctx.beginPath();
          for (let i = 0; i < count; i++) {
            const a = (i / count) * Math.PI * 2;
            const inner = shape === "wheel" ? 0.08 : 0.4;
            ctx.moveTo(Math.cos(a) * w * inner, Math.sin(a) * h * inner);
            ctx.lineTo(Math.cos(a) * w * 0.48, Math.sin(a) * h * 0.48);
          }
          ctx.stroke();
        }
      });
      break;
    }
    case "can":
    case "bottle":
    case "cup": {
      const neck = shape === "bottle" ? w * 0.36 : w;
      fill(() => {
        if (shape === "bottle") {
          ctx.moveTo(-w / 2, h / 2);
          ctx.lineTo(-w / 2, -h * 0.12);
          ctx.quadraticCurveTo(-w / 2, -h * 0.3, -neck / 2, -h * 0.34);
          ctx.lineTo(-neck / 2, -h / 2);
          ctx.lineTo(neck / 2, -h / 2);
          ctx.lineTo(neck / 2, -h * 0.34);
          ctx.quadraticCurveTo(w / 2, -h * 0.3, w / 2, -h * 0.12);
          ctx.lineTo(w / 2, h / 2);
          ctx.closePath();
        } else if (shape === "cup") {
          ctx.moveTo(-w / 2, -h / 2);
          ctx.lineTo(w / 2, -h / 2);
          ctx.lineTo(w * 0.38, h / 2);
          ctx.lineTo(-w * 0.38, h / 2);
          ctx.closePath();
        } else roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.12);
      }, "x");
      detail(() => {
        ctx.fillStyle = "rgba(255,255,255,0.22)";
        ctx.fillRect(-w / 2, -h / 2 + h * 0.08, shape === "cup" ? w * 0.9 : w, Math.max(2, h * 0.05));
        ctx.fillRect(-w / 2, h / 2 - h * 0.13, shape === "cup" ? w * 0.76 : w, Math.max(2, h * 0.05));
        if (shape === "can") {
          ctx.fillStyle = "rgba(255,255,255,0.8)";
          ctx.font = `800 ${Math.max(8, Math.min(w * 0.28, 14))}px ${LAB.sans}`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";
          ctx.save();
          ctx.rotate(-Math.PI / 2);
          ctx.globalAlpha = 0.55;
          ctx.fillText("FIZZ", 0, 1);
          ctx.restore();
        }
      });
      break;
    }
    case "door": {
      fill(() => roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.08), "y");
      detail(() => {
        ctx.strokeStyle = "rgba(255,255,255,0.18)";
        ctx.lineWidth = 1;
        const inset = Math.min(w, h) * 0.22;
        ctx.strokeRect(-w / 2 + inset, -h / 2 + inset * 0.6, w - inset * 2, h - inset * 1.2);
      });
      break;
    }
    case "bar": {
      fill(() => roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) / 2), "y");
      break;
    }
    case "person": {
      const headR = Math.min(w * 0.36, h * 0.16);
      fill(() => {
        ctx.arc(0, -h / 2 + headR, headR, 0, Math.PI * 2);
        roundRect(ctx, -w * 0.34, -h / 2 + headR * 2.2, w * 0.68, h * 0.48, w * 0.3);
        roundRect(ctx, -w * 0.3, -h / 2 + headR * 2.2 + h * 0.44, w * 0.24, h * 0.36, w * 0.1);
        roundRect(ctx, w * 0.06, -h / 2 + headR * 2.2 + h * 0.44, w * 0.24, h * 0.36, w * 0.1);
      }, "y");
      break;
    }
    case "boat": {
      fill(() => {
        ctx.moveTo(-w / 2, -h / 2);
        ctx.lineTo(w / 2, -h / 2);
        ctx.quadraticCurveTo(w * 0.46, h / 2, w * 0.2, h / 2);
        ctx.lineTo(-w * 0.2, h / 2);
        ctx.quadraticCurveTo(-w * 0.46, h / 2, -w / 2, -h / 2);
        ctx.closePath();
      }, "y");
      detail(() => {
        ctx.fillStyle = "rgba(255,255,255,0.28)";
        ctx.fillRect(-w * 0.48, -h / 2, w * 0.96, Math.max(2, h * 0.12));
      });
      break;
    }
    case "bag": {
      fill(() => {
        ctx.moveTo(-w * 0.38, -h * 0.28);
        ctx.lineTo(w * 0.38, -h * 0.28);
        ctx.quadraticCurveTo(w / 2, h / 2, w * 0.3, h / 2);
        ctx.lineTo(-w * 0.3, h / 2);
        ctx.quadraticCurveTo(-w / 2, h / 2, -w * 0.38, -h * 0.28);
        ctx.closePath();
      }, "y");
      detail(() => {
        ctx.strokeStyle = shade(color, -30);
        ctx.lineWidth = Math.max(1.5, w * 0.05);
        ctx.beginPath();
        ctx.arc(0, -h * 0.28, w * 0.22, Math.PI, 0);
        ctx.stroke();
      });
      break;
    }
    case "book":
    case "phone": {
      fill(() => roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * (shape === "phone" ? 0.18 : 0.06)), "y");
      detail(() => {
        ctx.fillStyle = shape === "phone" ? "rgba(10,20,40,0.75)" : "rgba(255,255,255,0.3)";
        if (shape === "phone") ctx.fillRect(-w / 2 + w * 0.08, -h / 2 + h * 0.08, w * 0.84, h * 0.84);
        else ctx.fillRect(-w / 2, -h / 2 + h * 0.15, w * 0.08, h * 0.7);
      });
      break;
    }
    default: {
      fill(() => roundRect(ctx, -w / 2, -h / 2, w, h, Math.min(w, h) * 0.12), "y");
      detail(() => {
        ctx.fillStyle = "rgba(255,255,255,0.14)";
        ctx.fillRect(-w / 2 + 2, -h / 2 + 2, w - 4, Math.max(2, h * 0.14));
      });
    }
  }
  ctx.restore();
  if (!options.ghost) {
    const angle = options.angle ?? 0;
    const halfW = Math.abs((w / 2) * Math.cos(angle)) + Math.abs((h / 2) * Math.sin(angle));
    const halfH = Math.abs((w / 2) * Math.sin(angle)) + Math.abs((h / 2) * Math.cos(angle));
    reserve({ left: cx - halfW - 4, top: cy - halfH - 4, width: 2 * halfW + 8, height: 2 * halfH + 8 });
  }
}

/** Fading motion trail with optional strobe dots every `dotEvery` points. */
export function trail(
  ctx: CanvasRenderingContext2D,
  points: Point[],
  color: string,
  options: { width?: number; dotEvery?: number; alpha?: number; dashed?: boolean } = {},
) {
  if (points.length < 2) return;
  const width = options.width ?? 3;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  const n = points.length;
  if (options.dashed) {
    ctx.globalAlpha = options.alpha ?? 0.5;
    ctx.setLineDash([6, 6]);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * 0.6;
    ctx.beginPath();
    points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
    ctx.stroke();
    ctx.restore();
    return;
  }
  const segments = Math.min(40, n - 1);
  for (let s = 0; s < segments; s++) {
    const from = Math.floor((s / segments) * (n - 1));
    const to = Math.floor(((s + 1) / segments) * (n - 1));
    const share = (s + 1) / segments;
    ctx.globalAlpha = (options.alpha ?? 1) * (0.12 + 0.88 * share * share);
    ctx.strokeStyle = color;
    ctx.lineWidth = width * (0.45 + 0.55 * share);
    ctx.beginPath();
    for (let i = from; i <= to; i++)
      i === from ? ctx.moveTo(points[i].x, points[i].y) : ctx.lineTo(points[i].x, points[i].y);
    ctx.stroke();
  }
  if (options.dotEvery) {
    for (let i = 0; i < n; i += options.dotEvery) {
      const share = i / (n - 1);
      ctx.globalAlpha = (options.alpha ?? 1) * (0.25 + 0.75 * share);
      ctx.fillStyle = LAB.bgBottom;
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(points[i].x, points[i].y, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
  ctx.restore();
}

/** Dimension line between two canvas points with end ticks and a centered label. */
export function dimension(
  ctx: CanvasRenderingContext2D,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  text: string,
  color = LAB.muted,
  offset = 0,
) {
  const length = Math.hypot(bx - ax, by - ay);
  if (length < 4) return;
  const nx = -(by - ay) / length;
  const ny = (bx - ax) / length;
  const x1 = ax + nx * offset;
  const y1 = ay + ny * offset;
  const x2 = bx + nx * offset;
  const y2 = by + ny * offset;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  for (const [x, y] of [
    [x1, y1],
    [x2, y2],
  ]) {
    ctx.moveTo(x + nx * 6, y + ny * 6);
    ctx.lineTo(x - nx * 6, y - ny * 6);
  }
  ctx.stroke();
  ctx.restore();
  pill(ctx, (x1 + x2) / 2, (y1 + y2) / 2, text, {
    align: "center",
    size: 11,
    mono: true,
    weight: 500,
    color,
  });
}

/** Curved rotation arrow; angles in canvas radians (clockwise positive). */
export function arcArrow(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  start: number,
  end: number,
  color: string,
  label?: string,
  width = 3,
) {
  if (Math.abs(end - start) < 0.05) return;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = width;
  ctx.lineCap = "round";
  ctx.shadowColor = color;
  ctx.shadowBlur = 10;
  const clockwise = end > start;
  const headAngle = Math.min(0.5, Math.abs(end - start) * 0.4, 14 / Math.max(10, r));
  const lineEnd = clockwise ? end - headAngle * 0.6 : end + headAngle * 0.6;
  ctx.beginPath();
  ctx.arc(cx, cy, r, start, lineEnd, !clockwise);
  ctx.stroke();
  const tipX = cx + Math.cos(end) * r;
  const tipY = cy + Math.sin(end) * r;
  const back = clockwise ? end - headAngle : end + headAngle;
  const bx = cx + Math.cos(back) * r;
  const by = cy + Math.sin(back) * r;
  const tx = tipX - bx;
  const ty = tipY - by;
  const len = Math.hypot(tx, ty) || 1;
  const half = width * 2.4;
  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(bx - (ty / len) * half, by + (tx / len) * half);
  ctx.lineTo(bx + (ty / len) * half, by - (tx / len) * half);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  for (let i = 0; i <= 10; i++) {
    const a = start + ((end - start) * i) / 10;
    reserve({ left: cx + Math.cos(a) * r - width - 4, top: cy + Math.sin(a) * r - width - 4, width: 2 * width + 8, height: 2 * width + 8 });
  }
  if (label) {
    const mid = (start + end) / 2;
    pill(ctx, cx + Math.cos(mid) * (r + 16), cy + Math.sin(mid) * (r + 16), label, {
      color,
      align: Math.cos(mid) > 0.3 ? "left" : Math.cos(mid) < -0.3 ? "right" : "center",
      size: 12,
      weight: 700,
      border: `${color}55`,
    });
  }
}

/** Zig-zag spring between two canvas points. */
export function coil(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  turns: number,
  amplitude: number,
  color: string,
  width = 2.5,
) {
  const length = Math.hypot(x2 - x1, y2 - y1);
  if (length < 1) return;
  const ux = (x2 - x1) / length;
  const uy = (y2 - y1) / length;
  const nx = -uy;
  const ny = ux;
  const lead = Math.min(14, length * 0.12);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + ux * lead, y1 + uy * lead);
  const steps = Math.max(2, Math.round(turns * 2));
  const inner = length - lead * 2;
  for (let i = 1; i < steps; i++) {
    const d = lead + (inner * i) / steps;
    const side = i % 2 ? 1 : -1;
    ctx.lineTo(x1 + ux * d + nx * amplitude * side, y1 + uy * d + ny * amplitude * side);
  }
  ctx.lineTo(x2 - ux * lead, y2 - uy * lead);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** Animated liquid body from `levelY` down to `bottomY` (world units). */
export function liquid(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  levelY: number,
  bottomY: number,
  x0: number,
  x1: number,
  clock: number,
  tint = "#2f7fd1",
) {
  const top = camera.sy(levelY);
  const bottom = camera.sy(bottomY);
  const left = camera.sx(x0);
  const right = camera.sx(x1);
  ctx.save();
  const gradient = ctx.createLinearGradient(0, top, 0, bottom);
  gradient.addColorStop(0, `${tint}cc`);
  gradient.addColorStop(1, `${tint}55`);
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  const amplitude = 2.2;
  for (let x = left; x <= right; x += 6) {
    const y = top + Math.sin(x * 0.045 + clock * 2.1) * amplitude + Math.sin(x * 0.11 - clock * 1.3) * 0.9;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(right, bottom);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(190, 230, 255, 0.7)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  for (let x = left; x <= right; x += 6) {
    const y = top + Math.sin(x * 0.045 + clock * 2.1) * amplitude + Math.sin(x * 0.11 - clock * 1.3) * 0.9;
    x === left ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  ctx.restore();
}

/** Small round marker, e.g. a pivot or contact point. */
export function pivot(ctx: CanvasRenderingContext2D, x: number, y: number, r = 7, color = LAB.text) {
  ctx.save();
  ctx.fillStyle = LAB.bgBottom;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.35, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Draggable handle ring; brighter while hovered or active. */
export function handleRing(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  state: "idle" | "hover" | "active",
  color = LAB.hot,
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.globalAlpha = state === "idle" ? 0.55 : 1;
  ctx.lineWidth = state === "active" ? 2.5 : 1.8;
  ctx.setLineDash(state === "idle" ? [3, 3] : []);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  if (state !== "idle") {
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.restore();
  reserve({ left: x - r - 3, top: y - r - 3, width: 2 * r + 6, height: 2 * r + 6 });
}

/** Bar meter (0–1) with label, drawn inside the canvas. */
export function meter(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  value: number,
  color: string,
  label: string,
  detail?: string,
) {
  const share = Math.min(1, Math.max(0, value));
  ctx.save();
  ctx.font = `600 11px ${LAB.sans}`;
  ctx.fillStyle = LAB.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText(label, x, y - 5);
  if (detail) {
    ctx.textAlign = "right";
    ctx.font = `500 11px ${LAB.mono}`;
    ctx.fillText(detail, x + width, y - 5);
  }
  ctx.beginPath();
  roundRect(ctx, x, y, width, 6, 3);
  ctx.fillStyle = "rgba(255,255,255,0.09)";
  ctx.fill();
  if (share > 0) {
    ctx.beginPath();
    roundRect(ctx, x, y, Math.max(6, width * share), 6, 3);
    ctx.fillStyle = color;
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fill();
  }
  ctx.restore();
}

/** Scale world vectors to a readable pixel length with a soft cap. */
export function arrowLength(magnitude: number, reference: number, maxPx: number, minPx = 18) {
  if (!(Math.abs(magnitude) > 1e-9) || !(reference > 0)) return 0;
  const share = Math.abs(magnitude) / reference;
  const eased = share <= 1 ? share : 1 + Math.log(share) * 0.35;
  return Math.max(minPx, Math.min(maxPx * 1.35, eased * maxPx));
}
