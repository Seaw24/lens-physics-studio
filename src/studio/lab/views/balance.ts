import type { Params, Simulation } from "../../../../shared/studio/engines";
import {
  supportReactions,
  type BalanceState,
} from "../../../../shared/studio/engines/balance";
import type { Shape } from "../../../../shared/studio/schema";
import {
  Camera,
  LAB,
  QUANTITY_COLORS,
  arcArrow,
  arrow,
  arrowLength,
  backdrop,
  body,
  formatQuantity,
  handleRing,
  niceStep,
  pill,
  pivot,
  roundRect,
  surfaceBand,
  unionBox,
  type ArrowOptions,
  type PillOptions,
  type WorldBox,
} from "../draw";
import type { EngineView, HudItem, LabHandle, LabScene } from "../types";

type Sim = Simulation<BalanceState>;
type Scene = LabScene<BalanceState>;

const TAU = Math.PI * 2;
const LOAD_KEYS = ["A", "B", "C"];
const LOAD_COLOR = "#c9924f";
const STEEL = "#8d98ab";
/** Width ÷ height of a load's skin in side view; boxes are square. */
const ASPECT: Partial<Record<Shape, number>> = {
  can: 0.62,
  bottle: 0.42,
  cup: 0.85,
  person: 0.42,
  door: 0.5,
  phone: 0.5,
  bag: 0.9,
  plate: 2.6,
  bar: 3,
  boat: 2.2,
  book: 2.2,
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

interface Load {
  key: string;
  n: number;
  mass: number;
  /** Along the beam from its left end, m. */
  x: number;
  w: number;
  h: number;
  /** Height of its bottom above the beam's top face (stacked loads), m. */
  base: number;
  /** Index of the load it rests on, or -1 when it sits on the beam. */
  parent: number;
}

/** Everything about a run that depends only on its parameters, computed once per simulation. */
interface Rig {
  shape: Shape;
  L: number;
  mode: number;
  /** Height of the beam's underside above the ground when level. */
  H: number;
  thick: number;
  axis: number;
  g: number;
  /** Stacking order: loads resting on the beam come first. */
  loads: Load[];
  beamWeight: number;
  total: number;
  /** Torque sums about the pivot (mode 0), N·m. */
  ccw: number;
  cw: number;
  r1: number;
  r2: number;
  com: number;
  /** Largest tilt drawn: the engine's stop angle, or earlier if the beam end meets the ground. */
  limit: number;
  box: WorldBox;
  forceRef: number;
}

const rigs = new WeakMap<Sim, Rig>();

function rigFor(sim: Sim, p: Params, shape: Shape): Rig {
  const cached = rigs.get(sim);
  if (cached && cached.shape === shape) return cached;
  const L = Math.max(0.05, p.beamLength);
  const mode = p.support >= 0.5 ? 1 : 0;
  const H = L * (mode ? 0.3 : 0.16);
  const thick = L * 0.022;
  const g = p.gravity;
  const axis = sim.sample(0).axis;
  const aspect = Math.sqrt(ASPECT[shape] ?? 1);
  const loads: Load[] = [
    { n: 1, mass: p.mass1, x: p.pos1 },
    { n: 2, mass: p.mass2, x: p.pos2 },
    { n: 3, mass: p.mass3, x: p.pos3 },
  ]
    .filter((load) => load.mass > 0)
    .map((load) => {
      // Side ∝ cube root of mass (a 30 kg load is a 0.36 m crate), kept readable on any beam.
      const side = clamp(0.36 * Math.cbrt(load.mass / 30), 0.045 * L, 0.26 * L);
      return { ...load, key: LOAD_KEYS[load.n - 1], w: side * aspect, h: side / aspect, base: 0, parent: -1 };
    })
    .sort((a, b) => b.mass - a.mass || a.n - b.n);
  // Heavier loads sit on the beam; lighter ones that overlap them stack on top.
  loads.forEach((load, i) => {
    for (let j = 0; j < i; j++) {
      const other = loads[j];
      if (Math.abs(load.x - other.x) < (load.w + other.w) / 2 - 1e-6 && other.base + other.h > load.base) {
        load.base = other.base + other.h;
        load.parent = j;
      }
    }
  });

  const beamWeight = p.beamMass * g;
  const total = beamWeight + loads.reduce((sum, load) => sum + load.mass * g, 0);
  let ccw = 0;
  let cw = 0;
  const torqueAt = (w: number, x: number) => {
    const arm = x - axis;
    if (arm < 0) ccw -= w * arm;
    else cw += w * arm;
  };
  loads.forEach((load) => torqueAt(load.mass * g, load.x));
  torqueAt(beamWeight, L / 2);
  const reactions = mode ? supportReactions(p) : { r1: total, r2: 0 };
  const com = sim.metrics.centerOfMass ?? L / 2;

  const end = sim.sample(sim.duration).theta;
  const dir = Math.sign(end);
  let limit = Math.abs(end);
  if (dir !== 0) {
    // Largest tilt before a point d along the beam (c above its underside) reaches the ground.
    const touch = (d: number, c: number) => {
      const rho = Math.hypot(d, c);
      return rho <= H ? Infinity : Math.acos(-H / rho) - Math.atan2(d, c);
    };
    limit = Math.min(limit, touch(dir > 0 ? L - axis : axis, 0));
    for (const load of loads) {
      const reach = (load.x - axis) * dir + load.w / 2;
      if (reach > 0) limit = Math.min(limit, touch(reach, thick + load.base));
    }
    limit = Math.max(0, limit);
  }

  let x0 = 0;
  let x1 = L;
  let top = H + thick;
  for (const phi of dir ? [0, dir * limit] : [0]) {
    const cos = Math.cos(phi);
    const sin = Math.sin(phi);
    const reach = (s: number, c: number) => {
      const e = s - axis;
      const x = axis + e * cos + c * sin;
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      top = Math.max(top, H - e * sin + c * cos);
    };
    reach(0, thick);
    reach(L, thick);
    for (const load of loads) {
      reach(load.x - load.w / 2, thick + load.base + load.h);
      reach(load.x + load.w / 2, thick + load.base + load.h);
    }
  }
  const box = {
    x0: x0 - 0.12 * L,
    x1: x1 + 0.12 * L,
    y0: -0.08 * L,
    y1: Math.max(top + 0.1 * L, H + thick + 0.3 * L),
  };

  const rig: Rig = {
    shape,
    L,
    mode,
    H,
    thick,
    axis,
    g,
    loads,
    beamWeight,
    total,
    ccw,
    cw,
    r1: reactions.r1,
    r2: reactions.r2,
    com,
    limit,
    box,
    forceRef: Math.max(total, Math.abs(reactions.r1), Math.abs(reactions.r2)),
  };
  rigs.set(sim, rig);
  return rig;
}

interface Pose {
  ax: number;
  ay: number;
  phi: number;
  cos: number;
  sin: number;
  k: number;
  axis: number;
}

/** Beam placement in canvas pixels: rotated by the (ground-limited) tilt about the axis contact point. */
function poseFor(rig: Rig, camera: Camera, theta: number): Pose {
  const phi = Math.sign(theta) * Math.min(Math.abs(theta), rig.limit);
  return {
    ax: camera.sx(rig.axis),
    ay: camera.sy(rig.H),
    phi,
    cos: Math.cos(phi),
    sin: Math.sin(phi),
    k: camera.scale,
    axis: rig.axis,
  };
}

/** Canvas point `s` meters along the beam and `c` meters (plus `extra` px) above its underside. */
function onBeam(pose: Pose, s: number, c: number, extra = 0) {
  const e = (s - pose.axis) * pose.k;
  const h = c * pose.k + extra;
  return { x: pose.ax + e * pose.cos + h * pose.sin, y: pose.ay + e * pose.sin - h * pose.cos };
}

/** Camera and arrow scale stay fixed while a handle is dragged, so the drag never feeds back on itself. */
let frozen: { box: WorldBox; forceRef: number } | null = null;
/** Offset between the pointer and the dragged item, so grabbing never makes it jump. */
let grab: { id: string; offset: number } | null = null;

function slide(id: string, pointer: number, current: number) {
  if (!grab || grab.id !== id) grab = { id, offset: pointer - current };
  return pointer - grab.offset;
}

function layout(scene: Scene) {
  const { sim, ghost, params, width, height, skin } = scene;
  const shape = skin.other?.shape ?? "box";
  const rig = rigFor(sim, params, shape);
  const ghostRig = ghost ? rigFor(ghost.sim as Sim, ghost.params, shape) : null;
  const box = unionBox(rig.box, ghostRig?.box);
  if (scene.active) frozen ??= { box, forceRef: rig.forceRef };
  else {
    frozen = null;
    grab = null;
  }
  const use = frozen ?? { box, forceRef: rig.forceRef };
  const camera = new Camera(width, height, use.box, {
    left: 36,
    right: 36,
    top: rig.mode ? 58 : 80,
    bottom: 34,
  });
  const maxPx = clamp(Math.min(camera.s(rig.L * 0.24), height * 0.21), 48, 112);
  return { rig, ghostRig, camera, forceRef: use.forceRef, maxPx, pose: poseFor(rig, camera, scene.state.theta) };
}

type Layout = ReturnType<typeof layout>;

interface Spot {
  id: string;
  x: number;
  y: number;
  r: number;
  color: string;
  label: string;
  /** Parameter this handle moves, its current value and its allowed range. */
  key: string;
  value: number;
  min: number;
  max: number;
  /** Pointer position → value along the beam, before the grab offset. */
  read: (px: number, py: number) => number;
}

function spots(scene: Scene, { rig, camera, pose }: Layout): Spot[] {
  const { params } = scene;
  const list: Spot[] = rig.loads.map((load) => {
    const center = onBeam(pose, load.x, rig.thick + load.base + load.h / 2);
    return {
      id: `load${load.n}`,
      x: center.x,
      y: center.y,
      r: clamp((Math.min(load.w, load.h) * pose.k) / 2 + 6, 14, 30),
      color: LAB.hot,
      label: `Drag load ${load.key} along the beam`,
      key: `pos${load.n}`,
      value: load.x,
      min: 0,
      max: rig.L,
      read: (px, py) =>
        rig.axis + (camera.wx(px) - rig.axis) * pose.cos - (camera.wy(py) - rig.H) * pose.sin,
    };
  });
  const groundY = camera.sy(0);
  const supportY = camera.sy(rig.H);
  if (rig.mode === 0)
    list.push({
      id: "pivot",
      x: camera.sx(params.pivot),
      y: supportY + (groundY - supportY) * 0.62,
      r: 15,
      color: LAB.muted,
      label: "Drag the pivot along the beam",
      key: "pivot",
      value: params.pivot,
      min: 0,
      max: rig.L,
      read: (px) => camera.wx(px),
    });
  else
    for (const n of [1, 2]) {
      const key = `support${n}`;
      list.push({
        id: key,
        x: camera.sx(params[key]),
        y: supportY + (groundY - supportY) * 0.55,
        r: 15,
        color: LAB.muted,
        label: `Drag the ${n === 1 ? "left" : "right"} support along the beam`,
        key,
        value: params[key],
        min: n === 1 ? 0 : params.support1 + 0.02,
        max: n === 1 ? params.support2 - 0.02 : rig.L,
        read: (px) => camera.wx(px),
      });
    }
  return list;
}

function handleState(scene: Scene, id: string) {
  return scene.active === id ? "active" : scene.hover === id ? "hover" : "idle";
}

function shade(hex: string, amount: number) {
  const value = hex.replace("#", "");
  const num = parseInt(value.length === 3 ? value.replace(/(.)/g, "$1$1") : value, 16);
  if (!Number.isFinite(num)) return hex;
  const channel = (shift: number) => Math.min(255, Math.max(0, ((num >> shift) & 255) + amount));
  return `rgb(${channel(16)}, ${channel(8)}, ${channel(0)})`;
}

function signed(text: string) {
  return text.replace("-", "−");
}
function newtons(value: number, unit = "N") {
  const abs = Math.abs(value);
  return signed(formatQuantity(value, unit, abs < 10 ? 2 : abs < 100 ? 1 : 0));
}

interface Label {
  x: number;
  y: number;
  text: string;
  options: PillOptions;
  priority: number;
}

/** Labels are placed after all drawing, most important first, so the rest nudge around them. */
function flush(ctx: CanvasRenderingContext2D, labels: Label[]) {
  labels
    .sort((a, b) => a.priority - b.priority)
    .forEach((label) => pill(ctx, label.x, label.y, label.text, label.options));
}

function force(
  ctx: CanvasRenderingContext2D,
  labels: Label[],
  x: number,
  y: number,
  dx: number,
  dy: number,
  color: string,
  text: string,
  priority: number,
  options: ArrowOptions = {},
) {
  arrow(ctx, x, y, dx, dy, color, { width: 3.2, glow: true, ...options });
  const length = Math.hypot(dx, dy);
  if (length < 6) return;
  const ux = dx / length;
  const uy = dy / length;
  labels.push({
    x: x + dx + ux * 12,
    y: y + dy + uy * 12,
    text,
    priority,
    options: {
      color,
      align: ux > 0.35 ? "left" : ux < -0.35 ? "right" : "center",
      baseline: uy > 0.35 ? "top" : uy < -0.35 ? "bottom" : "middle",
      size: 12,
      weight: 700,
      alpha: options.alpha,
      border: `${color}55`,
    },
  });
}

function plank(ctx: CanvasRenderingContext2D, rig: Rig, pose: Pose, color: string, ghost = false) {
  const left = -rig.axis * pose.k;
  const w = rig.L * pose.k;
  const t = Math.max(5, rig.thick * pose.k);
  ctx.save();
  ctx.translate(pose.ax, pose.ay);
  ctx.rotate(pose.phi);
  ctx.beginPath();
  roundRect(ctx, left, -t, w, t, Math.min(4, t / 2));
  if (ghost) {
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = LAB.ghost;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.shadowColor = "rgba(0,0,0,0.45)";
  ctx.shadowBlur = 14;
  ctx.shadowOffsetY = 6;
  const gradient = ctx.createLinearGradient(0, -t, 0, 0);
  gradient.addColorStop(0, shade(color, 50));
  gradient.addColorStop(0.45, color);
  gradient.addColorStop(1, shade(color, -55));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255,255,255,0.38)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left + 3, -t + 1.5);
  ctx.lineTo(left + w - 3, -t + 1.5);
  ctx.stroke();
  // Ruler ticks make positions along the beam readable.
  const step = niceStep(rig.L, 6);
  ctx.strokeStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath();
  for (let i = 1; i * step < rig.L - step * 0.2 && i < 80; i++) {
    const x = left + i * step * pose.k;
    ctx.moveTo(x, -0.5);
    ctx.lineTo(x, -t * (i % 2 ? 0.35 : 0.55));
  }
  ctx.stroke();
  ctx.restore();
}

function drawLoads(
  ctx: CanvasRenderingContext2D,
  rig: Rig,
  pose: Pose,
  shape: Shape,
  color: string,
  ghost = false,
) {
  for (const load of rig.loads) {
    const center = onBeam(pose, load.x, rig.thick + load.base + load.h / 2);
    body(ctx, shape, center.x, center.y, load.w * pose.k, load.h * pose.k, color, {
      angle: pose.phi,
      ghost,
      outline: ghost ? undefined : "rgba(0,0,0,0.3)",
    });
  }
}

function fulcrum(ctx: CanvasRenderingContext2D, camera: Camera, rig: Rig, at: number) {
  const x = camera.sx(at);
  const apex = camera.sy(rig.H);
  const base = camera.sy(0);
  const half = (base - apex) * 0.6;
  const round = Math.min(6, (base - apex) * 0.12);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 12;
  ctx.shadowOffsetY = 4;
  ctx.beginPath();
  ctx.moveTo(x - half, base - 3);
  ctx.lineTo(x - round * 0.7, apex + round);
  ctx.quadraticCurveTo(x, apex - round, x + round * 0.7, apex + round);
  ctx.lineTo(x + half, base - 3);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(x - half, 0, x + half, 0);
  gradient.addColorStop(0, shade(STEEL, 40));
  gradient.addColorStop(0.5, STEEL);
  gradient.addColorStop(1, shade(STEEL, -55));
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "rgba(255,255,255,0.2)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.beginPath();
  roundRect(ctx, x - half * 1.25, base - 5, half * 2.5, 5, 2);
  ctx.fillStyle = shade(STEEL, -45);
  ctx.fill();
  ctx.restore();
}

function leg(ctx: CanvasRenderingContext2D, camera: Camera, rig: Rig, at: number, lifted: boolean) {
  const x = camera.sx(at);
  const top = camera.sy(rig.H);
  const base = camera.sy(0);
  const w = clamp(camera.s(rig.L * 0.03), 7, 14);
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.4)";
  ctx.shadowBlur = 10;
  ctx.shadowOffsetY = 4;
  const gradient = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
  gradient.addColorStop(0, shade(STEEL, -40));
  gradient.addColorStop(0.35, shade(STEEL, 45));
  gradient.addColorStop(1, shade(STEEL, -60));
  ctx.fillStyle = gradient;
  ctx.fillRect(x - w / 2, top + 4, w, base - top - 6);
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  roundRect(ctx, x - w * 1.35, top, w * 2.7, 6, 2);
  ctx.fillStyle = lifted ? shade(STEEL, 10) : shade(STEEL, 30);
  ctx.fill();
  ctx.beginPath();
  roundRect(ctx, x - w * 1.1, base - 5, w * 2.2, 5, 2);
  ctx.fillStyle = shade(STEEL, -45);
  ctx.fill();
  ctx.restore();
}

/** Classic center-of-mass symbol: a circle with alternating filled quarters. */
function comMarker(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string) {
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fillStyle = LAB.bgBottom;
  ctx.fill();
  ctx.fillStyle = color;
  for (const start of [-Math.PI / 2, Math.PI / 2]) {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, start, start + Math.PI / 2);
    ctx.closePath();
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.moveTo(x - r - 4, y);
  ctx.lineTo(x + r + 4, y);
  ctx.moveTo(x, y - r - 4);
  ctx.lineTo(x, y + r + 4);
  ctx.stroke();
  ctx.restore();
}

/** Compact torque-balance instrument: needle shows net torque against the total turning effect. */
function torqueGauge(ctx: CanvasRenderingContext2D, width: number, rig: Rig, net: number, balanced: boolean) {
  const w = Math.min(290, width - 32);
  const h = 50;
  const x = (width - w) / 2;
  const y = 12;
  const accent = balanced ? LAB.good : LAB.hot;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = LAB.panel;
  ctx.fill();
  ctx.strokeStyle = balanced ? `${LAB.good}66` : LAB.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.textBaseline = "middle";
  ctx.textAlign = "center";
  ctx.font = `700 12px ${LAB.sans}`;
  ctx.fillStyle = accent;
  const status = balanced
    ? "Balanced · the torques cancel"
    : `Net torque ${newtons(Math.abs(net), "N·m")} · ${net > 0 ? "right" : "left"} end drops`;
  ctx.fillText(status, x + w / 2, y + 16);
  const t0 = x + 42;
  const t1 = x + w - 42;
  const mid = (t0 + t1) / 2;
  const ty = y + 35;
  ctx.font = `600 10px ${LAB.mono}`;
  ctx.fillStyle = LAB.muted;
  ctx.textAlign = "left";
  ctx.fillText("CCW", x + 12, ty);
  ctx.textAlign = "right";
  ctx.fillText("CW", x + w - 12, ty);
  ctx.beginPath();
  roundRect(ctx, t0, ty - 3, t1 - t0, 6, 3);
  ctx.fillStyle = "rgba(255,255,255,0.09)";
  ctx.fill();
  const share = clamp(net / Math.max(1e-9, rig.ccw + rig.cw), -1, 1);
  const needle = mid + share * (t1 - mid);
  if (Math.abs(needle - mid) > 1) {
    ctx.beginPath();
    roundRect(ctx, Math.min(mid, needle), ty - 3, Math.abs(needle - mid), 6, 3);
    ctx.fillStyle = accent;
    ctx.shadowColor = accent;
    ctx.shadowBlur = 8;
    ctx.fill();
    ctx.shadowColor = "transparent";
  }
  ctx.strokeStyle = LAB.muted;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(mid, ty - 8);
  ctx.lineTo(mid, ty + 8);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(needle, ty, 5.5, 0, TAU);
  ctx.fillStyle = accent;
  ctx.shadowColor = accent;
  ctx.shadowBlur = 10;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  ctx.restore();
}

export const balanceView: EngineView<BalanceState> = {
  charts: ["theta"],
  hud: ({ sim, params }) => {
    const m = sim.metrics;
    const items: HudItem[] = [
      {
        label: "net torque",
        value: newtons(m.netTorque ?? 0, "N·m"),
        color: m.balanced === 1 ? LAB.good : LAB.hot,
      },
    ];
    if (params.support >= 0.5) {
      const left = m.leftSupportForce ?? 0;
      const right = m.rightSupportForce ?? 0;
      items.push(
        { label: "left support", value: newtons(left), color: left < 0 ? QUANTITY_COLORS.friction : QUANTITY_COLORS.normal },
        { label: "right support", value: newtons(right), color: right < 0 ? QUANTITY_COLORS.friction : QUANTITY_COLORS.normal },
      );
    } else items.push({ label: "pivot force", value: newtons(m.leftSupportForce ?? 0), color: QUANTITY_COLORS.normal });
    items.push({ label: "center of mass", value: formatQuantity(m.centerOfMass, "m", 2) });
    return items;
  },
  draw(scene) {
    const { ctx, width, height, sim, params, ghost, skin, t, showVectors } = scene;
    const lay = layout(scene);
    const { rig, ghostRig, camera, pose, forceRef, maxPx } = lay;
    backdrop(ctx, width, height, camera, { grid: true, labels: true });
    const view = camera.visible();
    surfaceBand(
      ctx,
      camera,
      { x: view.x0 - 1, y: 0 },
      { x: view.x1 + 1, y: 0 },
      skin.surface?.material ?? "concrete",
      Math.max(0.02, -view.y0 * 1.1),
    );
    const labels: Label[] = [];
    const groundY = camera.sy(0);
    const balanced = sim.metrics.balanced === 1;
    const loadShape = skin.other?.shape ?? "box";
    const loadColor = skin.other?.color ?? LOAD_COLOR;
    const beamColor = skin.body.color;
    const tipping = !balanced && Math.abs(pose.phi) > 1e-4;

    // Base of support (two supports): the span the center of mass must stay above.
    const outside = rig.mode === 1 && (rig.com < params.support1 - 1e-6 || rig.com > params.support2 + 1e-6);
    if (rig.mode === 1) {
      const a = camera.sx(params.support1);
      const b = camera.sx(params.support2);
      ctx.save();
      ctx.fillStyle = outside ? `${LAB.bad}33` : `${LAB.good}2e`;
      ctx.fillRect(a, groundY - 2, b - a, 5);
      ctx.restore();
    }

    // Previous run, faint.
    if (ghost && ghostRig) {
      const gpose = poseFor(ghostRig, camera, ghost.state.theta);
      plank(ctx, ghostRig, gpose, beamColor, true);
      drawLoads(ctx, ghostRig, gpose, loadShape, loadColor, true);
      let far = { d: 0, x: 0, y: 0 };
      const compare = (a: { x: number; y: number }, b: { x: number; y: number }, lift: number) => {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d > far.d) far = { d, x: a.x, y: a.y - lift };
      };
      compare(onBeam(gpose, 0, ghostRig.thick), onBeam(pose, 0, rig.thick), 14);
      compare(onBeam(gpose, ghostRig.L, ghostRig.thick), onBeam(pose, rig.L, rig.thick), 14);
      for (const load of ghostRig.loads) {
        const now = rig.loads.find((item) => item.n === load.n);
        const top = onBeam(gpose, load.x, ghostRig.thick + load.base + load.h);
        compare(top, now ? onBeam(pose, now.x, rig.thick + now.base + now.h) : { x: -1e4, y: -1e4 }, 10);
      }
      if (far.d > 28)
        labels.push({
          x: far.x,
          y: far.y,
          text: "previous run",
          priority: 7,
          options: { size: 10, color: LAB.muted, align: "center", baseline: "bottom" },
        });
    }

    // Supports.
    if (rig.mode === 0) fulcrum(ctx, camera, rig, params.pivot);
    else {
      const liftedLeft = tipping && pose.phi > 0;
      const liftedRight = tipping && pose.phi < 0;
      leg(ctx, camera, rig, params.support1, liftedLeft);
      leg(ctx, camera, rig, params.support2, liftedRight);
    }

    // Lever arms from the pivot to each load, measured along the beam.
    if (rig.mode === 0 && showVectors) {
      const sides = [-1, 1].map((side) =>
        rig.loads
          .filter((load) => Math.sign(load.x - rig.axis) === side && Math.abs(load.x - rig.axis) * pose.k > 14)
          .sort((a, b) => Math.abs(a.x - rig.axis) - Math.abs(b.x - rig.axis)),
      );
      ctx.save();
      ctx.strokeStyle = LAB.faint;
      ctx.lineWidth = 1.1;
      for (const side of sides)
        side.forEach((load, rank) => {
          const drop = -(16 + rank * 17);
          const a = onBeam(pose, rig.axis, 0, drop);
          const b = onBeam(pose, load.x, 0, drop);
          const nx = pose.sin * 5;
          const ny = -pose.cos * 5;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.moveTo(b.x + nx, b.y + ny);
          ctx.lineTo(b.x - nx, b.y - ny);
          ctx.stroke();
          labels.push({
            x: (a.x + b.x) / 2,
            y: (a.y + b.y) / 2,
            text: formatQuantity(Math.abs(load.x - rig.axis), "m", 2),
            priority: 6,
            options: { size: 10, mono: true, weight: 500, color: LAB.muted, align: "center" },
          });
        });
      ctx.restore();
    }

    // Center of mass: dashed plumb line to the ground.
    const comPoint = onBeam(pose, rig.com, rig.thick / 2);
    const comColor = outside ? LAB.bad : "#e6ecf8";
    ctx.save();
    ctx.strokeStyle = outside ? LAB.bad : "rgba(230, 236, 248, 0.5)";
    ctx.lineWidth = outside ? 1.8 : 1.3;
    ctx.setLineDash([5, 5]);
    ctx.beginPath();
    ctx.moveTo(comPoint.x, comPoint.y);
    ctx.lineTo(comPoint.x, groundY);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = outside ? LAB.bad : "rgba(230, 236, 248, 0.7)";
    ctx.beginPath();
    ctx.moveTo(comPoint.x, groundY);
    ctx.lineTo(comPoint.x - 5, groundY - 8);
    ctx.lineTo(comPoint.x + 5, groundY - 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    labels.push(
      outside
        ? {
            x: comPoint.x,
            y: groundY + 10,
            text: "center of mass past the support → it tips",
            priority: 1,
            options: { size: 11, weight: 700, color: LAB.bad, align: "center", baseline: "top", border: `${LAB.bad}66` },
          }
        : {
            x: comPoint.x,
            y: groundY + 10,
            text: "center of mass",
            priority: 6,
            options: { size: 10, color: LAB.muted, align: "center", baseline: "top" },
          },
    );

    // The beam and its loads.
    plank(ctx, rig, pose, beamColor);
    drawLoads(ctx, rig, pose, loadShape, loadColor);
    if (rig.mode === 0) pivot(ctx, pose.ax, pose.ay, 5, LAB.text);
    else if (tipping) pivot(ctx, pose.ax, pose.ay, 5, LAB.text);
    comMarker(ctx, comPoint.x, comPoint.y, 6, comColor);

    // One label per stack of loads, above its top.
    for (const load of rig.loads) {
      if (rig.loads.some((other) => other.parent >= 0 && rig.loads[other.parent] === load)) continue;
      const chain: Load[] = [];
      for (let item: Load | undefined = load; item; item = item.parent >= 0 ? rig.loads[item.parent] : undefined)
        chain.push(item);
      const top = onBeam(pose, load.x, rig.thick + load.base + load.h, 8);
      labels.push({
        x: top.x,
        y: top.y,
        text: chain.map((item) => `${item.key} ${formatQuantity(item.mass, "kg", item.mass < 10 ? 1 : 0)}`).join(" · "),
        priority: 0,
        options: { size: 12, weight: 700, align: "center", baseline: "bottom" },
      });
    }

    if (showVectors) {
      // Turning effects about the pivot: counter-clockwise on the left, clockwise on the right.
      if (rig.mode === 0) {
        const most = Math.max(rig.ccw, rig.cw);
        const r = clamp(camera.s(rig.H) * 0.5, 24, 50);
        const winner = balanced ? 0 : rig.cw > rig.ccw ? 1 : -1;
        for (const side of [-1, 1]) {
          const tau = side < 0 ? rig.ccw : rig.cw;
          if (!(tau > 1e-9) || !(most > 1e-9)) continue;
          const sweep = 0.4 + 0.7 * (tau / most);
          const start = side > 0 ? pose.phi + 0.3 : Math.PI + pose.phi - 0.3;
          const end = start + side * sweep;
          const color = balanced ? LAB.good : winner === side ? LAB.hot : "#c3cde2";
          arcArrow(ctx, pose.ax, pose.ay, r, start, end, color, undefined, 2.6);
          const mid = (start + end) / 2;
          labels.push({
            x: pose.ax + Math.cos(mid) * (r + 14),
            y: pose.ay + Math.sin(mid) * (r + 14),
            text: `τ_${side < 0 ? "ccw" : "cw"} ${newtons(tau, "N·m")}`,
            priority: 3,
            options: {
              color,
              align: side > 0 ? "left" : "right",
              baseline: "top",
              size: 11,
              weight: 700,
              border: `${color}55`,
            },
          });
        }
      }

      const weight = QUANTITY_COLORS.weight;
      for (const load of rig.loads) {
        const center = onBeam(pose, load.x, rig.thick + load.base + load.h / 2);
        const length = arrowLength(load.mass * rig.g, forceRef, maxPx);
        force(ctx, labels, center.x, center.y, 0, length, weight, `m_${load.key}g`, 2);
      }
      if (rig.beamWeight > 0) {
        const center = onBeam(pose, rig.L / 2, rig.thick / 2);
        const length = arrowLength(rig.beamWeight, forceRef, maxPx);
        force(ctx, labels, center.x, center.y, 0, length, weight, "m_beam g", 4, { alpha: 0.55, width: 2.4, glow: false });
      }

      const normal = QUANTITY_COLORS.normal;
      if (rig.mode === 0) {
        const length = arrowLength(rig.r1, forceRef, maxPx);
        force(ctx, labels, pose.ax, pose.ay, 0, -length, normal, `R = ${newtons(rig.r1)}`, 1);
      } else {
        const supports: Array<[number, number, number]> = [
          [1, params.support1, rig.r1],
          [2, params.support2, rig.r2],
        ];
        for (const [n, at, value] of supports) {
          const x = camera.sx(at);
          const y = camera.sy(rig.H);
          const length = arrowLength(value, forceRef, maxPx);
          if (value >= 0) force(ctx, labels, x, y, 0, -length, normal, `R_${n} = ${newtons(value)}`, 1);
          else {
            const bad = QUANTITY_COLORS.friction;
            force(ctx, labels, x + 12, y, 0, length, bad, `R_${n} = ${newtons(value)}`, 1, { dashed: true });
            labels.push({
              x: x + 12,
              y: y + length + 36,
              text: "a support can only push up",
              priority: 2,
              options: { size: 10, weight: 600, color: bad, align: "center", baseline: "top" },
            });
          }
        }
      }
    }

    // Status at the top.
    if (rig.mode === 0) torqueGauge(ctx, width, rig, sim.metrics.netTorque ?? 0, balanced);
    else
      labels.push({
        x: width / 2,
        y: 22,
        text: balanced ? "Stable · both supports push up" : `Tips ${rig.r1 < 0 ? "right" : "left"} · it pivots on the ${rig.r1 < 0 ? "right" : "left"} support`,
        priority: -1,
        options: {
          size: 12,
          weight: 700,
          align: "center",
          color: balanced ? LAB.good : LAB.hot,
          border: balanced ? `${LAB.good}55` : `${LAB.hot}55`,
        },
      });

    // Handles: always visible while at rest, only on hover during motion.
    const atRest = t < 0.04 || t >= sim.duration - 1e-3;
    for (const spot of spots(scene, lay)) {
      const state = handleState(scene, spot.id);
      if (state === "idle" && !atRest) continue;
      handleRing(ctx, spot.x, spot.y, spot.r, state, spot.color);
      if (state === "active")
        labels.push({
          x: spot.x,
          y: groundY + 30,
          text: `${formatQuantity(spot.value, "m", 2)} from the left end`,
          priority: -2,
          options: { size: 11, mono: true, weight: 600, align: "center", baseline: "top", color: LAB.text },
        });
    }

    flush(ctx, labels);
  },
  handles(scene) {
    const lay = layout(scene);
    return spots(scene, lay).map(
      (spot): LabHandle => ({
        id: spot.id,
        x: spot.x,
        y: spot.y,
        r: spot.r,
        label: spot.label,
        cursor: "ew-resize",
        drag: (px, py) => ({
          [spot.key]: clamp(slide(spot.id, spot.read(px, py), spot.value), spot.min, Math.max(spot.min, spot.max)),
        }),
      }),
    );
  },
};
