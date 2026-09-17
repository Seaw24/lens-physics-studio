import type { Params, Simulation } from "../../../../shared/studio/engines";
import type { PendulumState } from "../../../../shared/studio/engines/pendulum";
import type { Shape } from "../../../../shared/studio/schema";
import {
  Camera,
  LAB,
  QUANTITY_COLORS,
  arcArrow,
  backdrop,
  body,
  dimension,
  formatQuantity,
  handleRing,
  pill,
  pivot as pivotMarker,
  roundRect,
  surfaceBand,
  trail,
  vector,
  type Point,
  type WorldBox,
} from "../draw";
import type { EngineView, LabHandle, LabScene } from "../types";

// Side view of a swing. World origin is the lowest point of the swing (y up),
// so the current run and the previous run share the ground and the height
// reference; each hangs from its own pivot at (0, length).

type Sim = Simulation<PendulumState>;
type Scene = LabScene<PendulumState>;

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Largest body drawn, px; pads reserve room for it. */
const BODY_MAX = 54;
const BODY_MIN = 18;

/** Width and height of each skin relative to its size. */
const BODY_ASPECT: Partial<Record<Shape, [number, number]>> = {
  person: [0.56, 1],
  bottle: [0.44, 1],
  can: [0.64, 1],
  cup: [0.84, 0.9],
  door: [0.58, 1],
  bar: [1, 0.36],
  book: [0.74, 1],
  phone: [0.52, 1],
  bag: [0.92, 1],
  boat: [1, 0.52],
  box: [0.92, 0.84],
  block: [0.92, 0.84],
};

/** How far the drawn body reaches below its center, as a share of its size (the person's legs overhang). */
const hangOf = (shape: Shape) => (shape === "person" ? 0.66 : 0.5);

interface RunInfo {
  length: number;
  /** Lowest and highest angle reached (unwrapped, radians). */
  lo: number;
  hi: number;
  /** Goes all the way around at least once. */
  full: boolean;
  /** Widest sideways reach of the bob, m. */
  reachX: number;
  /** Highest point of the bob above the lowest point, m. */
  reachTop: number;
  maxSpeed: number;
  maxTension: number;
  weight: number;
  start: number;
  /** Times at which a new full swing (or loop) begins. */
  cycles: number[];
}

function containsAngle(lo: number, hi: number, target: number) {
  const k = Math.ceil((lo - target) / TAU);
  return target + k * TAU <= hi + 1e-9;
}

const runInfos = new WeakMap<Sim, RunInfo>();
function runInfo(sim: Sim, params: Params): RunInfo {
  const cached = runInfos.get(sim);
  if (cached) return cached;
  const L = params.length;
  const first = sim.sample(0);
  const steps = clamp(Math.ceil(sim.duration * 90), 240, 2400);
  let lo = first.theta;
  let hi = first.theta;
  let maxSpeed = first.speed;
  let maxTension = Math.abs(first.tension);
  // A release from rest counts as the first turning point.
  let turns = Math.abs(first.omega) < 1e-9 ? 0 : -1;
  let revolutions = 0;
  const cycles: number[] = [];
  let prevOmega = first.omega;
  let prevT = 0;
  for (let i = 1; i <= steps; i++) {
    const t = (sim.duration * i) / steps;
    const s = sim.sample(t);
    if (s.theta < lo) lo = s.theta;
    if (s.theta > hi) hi = s.theta;
    if (s.speed > maxSpeed) maxSpeed = s.speed;
    if (Math.abs(s.tension) > maxTension) maxTension = Math.abs(s.tension);
    if ((prevOmega > 0 && s.omega <= 0) || (prevOmega < 0 && s.omega >= 0)) {
      turns++;
      if (turns > 0 && turns % 2 === 0) {
        const f = prevOmega / (prevOmega - s.omega || 1);
        cycles.push(prevT + f * (t - prevT));
      }
    }
    const loops = Math.floor(Math.abs(s.theta - first.theta) / TAU);
    if (loops > revolutions) {
      revolutions = loops;
      cycles.push(t);
    }
    prevOmega = s.omega;
    prevT = t;
  }
  cycles.sort((a, b) => a - b);
  const full = hi - lo >= TAU - 1e-6;
  const side = full || containsAngle(lo, hi, Math.PI / 2) || containsAngle(lo, hi, -Math.PI / 2);
  const over = full || containsAngle(lo, hi, Math.PI);
  const info: RunInfo = {
    length: L,
    lo,
    hi,
    full,
    reachX: side ? L : L * Math.max(Math.abs(Math.sin(lo)), Math.abs(Math.sin(hi))),
    reachTop: over ? 2 * L : L * Math.max(1 - Math.cos(lo), 1 - Math.cos(hi)),
    maxSpeed,
    maxTension,
    weight: params.mass * params.gravity,
    start: first.kinetic + first.potential,
    cycles,
  };
  runInfos.set(sim, info);
  return info;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Frame {
  camera: Camera;
  /** Canvas y of the ground's top edge, or null without a surface. */
  groundY: number | null;
  pxPerN: number;
  pxPerMs: number;
  panel: Rect;
  /** Ceiling beam for gentle swings, an A-frame for swings or anything that goes over the top. */
  support: "beam" | "frame";
}

function panelRect(width: number, height: number): Rect {
  const w = Math.round(clamp(width * 0.19, 140, 172));
  const h = Math.round(clamp(height * 0.26, 116, 138));
  return { x: width - w - 12, y: 12, w, h };
}

/** Right column taken by the energy panel plus the swing counter below it. */
function panelZone(panel: Rect): Rect {
  return { x: panel.x - 6, y: 0, w: panel.w + 18, h: panel.y + panel.h + 34 };
}

function bodySize(camera: Camera, length: number) {
  return clamp(camera.s(length) * 0.2, BODY_MIN, BODY_MAX);
}

function bobAt(camera: Camera, length: number, theta: number): Point {
  return { x: camera.sx(length * Math.sin(theta)), y: camera.sy(length * (1 - Math.cos(theta))) };
}

/** Does anything the swing draws land inside the rectangle? */
function crowds(camera: Camera, runs: RunInfo[], main: RunInfo, angle: number, zone: Rect, shape: Shape) {
  const inside = (x: number, y: number, margin: number) =>
    x > zone.x - margin && x < zone.x + zone.w + margin && y > zone.y - margin && y < zone.y + zone.h + margin;
  const size = bodySize(camera, main.length);
  for (const run of runs) {
    const lo = run.full ? 0 : run.lo;
    const hi = run.full ? TAU : run.hi;
    for (let i = 0; i <= 48; i++) {
      const p = bobAt(camera, run.length, lo + ((hi - lo) * i) / 48);
      if (inside(p.x, p.y, size * 0.7 + 6)) return true;
    }
    if (inside(camera.sx(0), camera.sy(run.length) - 26, 20)) return true;
  }
  // Height dimension and its label on the right of the swing.
  const h0 = main.length * (1 - Math.cos(angle * DEG));
  const xDim = camera.sx(main.reachX) + size * 0.5 + 24;
  if (h0 > 0 && (inside(xDim + 44, camera.sy(h0 / 2), 12) || inside(xDim, camera.sy(h0), 8))) return true;
  void shape;
  return false;
}

let frameCache: { key: unknown[]; frame: Frame } | null = null;
/** Camera and arrow scales stay fixed while a handle is dragged, so the drag never feeds back on itself. */
let frozen: Frame | null = null;

function buildFrame(scene: Scene): Frame {
  const { width, height, sim, params, ghost, skin } = scene;
  const main = runInfo(sim, params);
  const other = ghost ? runInfo(ghost.sim as Sim, ghost.params) : null;
  const runs = other ? [main, other] : [main];
  const longest = Math.max(...runs.map((run) => run.length));
  const halfW = Math.max(longest * 0.3, ...runs.map((run) => run.reachX));
  const top = Math.max(...runs.map((run) => Math.max(run.length, run.reachTop)));
  const box: WorldBox = { x0: -halfW, x1: halfW, y0: 0, y1: top };
  const shape = skin.body.shape;
  const hang = hangOf(shape);
  const side = BODY_MAX / 2 + 70;
  const pad = {
    left: side,
    right: side,
    top: 50 + BODY_MAX / 2,
    bottom: BODY_MAX * hang + 14 + (skin.surface ? 30 : 10),
  };
  const panel = panelRect(width, height);
  const zone = panelZone(panel);
  let camera = new Camera(width, height, box, pad);
  if (crowds(camera, runs, main, params.angle, zone, shape)) {
    // Try moving the swing left of the panel, then below it; keep whichever is larger.
    const left = new Camera(width, height, box, { ...pad, right: Math.max(pad.right, width - zone.x + BODY_MAX / 2 + 8) });
    const below = new Camera(width, height, box, { ...pad, top: Math.max(pad.top, zone.h + BODY_MAX / 2 + 6) });
    const leftFits = !crowds(left, runs, main, params.angle, zone, shape);
    const belowFits = !crowds(below, runs, main, params.angle, zone, shape);
    camera =
      leftFits && belowFits
        ? left.scale >= below.scale
          ? left
          : below
        : leftFits
          ? left
          : belowFits
            ? below
            : left.scale >= below.scale
              ? left
              : below;
  }
  const lengthPx = camera.s(main.length);
  const size = bodySize(camera, main.length);
  const forcePx = clamp(lengthPx * 0.42, 40, 100);
  const forceRef = Math.max(main.maxTension, main.weight, other?.maxTension ?? 0, other?.weight ?? 0);
  const pxPerN = forceRef > 0 ? Math.max(forcePx / forceRef, 20 / Math.max(1e-9, main.weight)) : 0;
  const speedRef = Math.max(main.maxSpeed, other?.maxSpeed ?? 0);
  const pxPerMs = speedRef > 1e-6 ? forcePx / speedRef : 0;
  const bigSwing = runs.some((run) => run.full || run.reachTop > run.length * 1.02);
  return {
    camera,
    groundY: skin.surface ? camera.sy(0) + size * hang + 12 : null,
    pxPerN,
    pxPerMs,
    panel,
    support: shape === "person" || bigSwing ? "frame" : "beam",
  };
}

function layout(scene: Scene): Frame {
  const key = [
    scene.sim,
    scene.ghost?.sim ?? null,
    scene.width,
    scene.height,
    scene.skin.body.shape,
    Boolean(scene.skin.surface),
  ];
  let frame: Frame;
  if (frameCache && frameCache.key.every((value, i) => value === key[i])) frame = frameCache.frame;
  else {
    frame = buildFrame(scene);
    frameCache = { key, frame };
  }
  if (scene.active) frozen ??= frame;
  else frozen = null;
  return frozen ?? frame;
}

function handleState(scene: Scene, id: string) {
  return scene.active === id ? "active" : scene.hover === id ? "hover" : "idle";
}

function formatEnergy(joules: number) {
  const a = Math.abs(joules);
  if (a < 5e-4) return "0 J";
  if (a >= 1e6) return `${(joules / 1e6).toFixed(2)} MJ`;
  if (a >= 1e4) return `${(joules / 1e3).toFixed(a >= 1e5 ? 0 : 1)} kJ`;
  if (a >= 100) return `${Math.round(joules)} J`;
  if (a >= 10) return `${joules.toFixed(1)} J`;
  if (a >= 0.1) return `${joules.toFixed(2)} J`;
  return `${(joules * 1000).toFixed(a >= 0.01 ? 1 : 2)} mJ`;
}

function dashedLine(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number, color: string, dash = [5, 5], width = 1.2) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.setLineDash(dash);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

/** Stroke the reachable arc of a run around its pivot. */
function reachArc(ctx: CanvasRenderingContext2D, camera: Camera, run: RunInfo) {
  const cx = camera.sx(0);
  const cy = camera.sy(run.length);
  const r = camera.s(run.length);
  ctx.beginPath();
  if (run.full) ctx.arc(cx, cy, r, 0, TAU);
  else ctx.arc(cx, cy, r, Math.PI / 2 - run.hi, Math.PI / 2 - run.lo);
}

function drawSupport(ctx: CanvasRenderingContext2D, frame: Frame, top: Point, lowY: number, lengthPx: number) {
  ctx.save();
  if (frame.support === "frame") {
    // Swing set seen end-on: the top bar is a tube, the legs splay to the ground.
    const footY = frame.groundY ?? lowY + 18;
    const spread = Math.tan(20 * DEG) * (footY - top.y);
    const legs = ctx.createLinearGradient(0, top.y, 0, footY);
    legs.addColorStop(0, "rgba(176, 192, 222, 0.42)");
    legs.addColorStop(1, frame.groundY === null ? "rgba(176, 192, 222, 0)" : "rgba(176, 192, 222, 0.22)");
    ctx.strokeStyle = legs;
    ctx.lineCap = "round";
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(top.x - 3, top.y);
    ctx.lineTo(top.x - spread, footY);
    ctx.moveTo(top.x + 3, top.y);
    ctx.lineTo(top.x + spread, footY);
    ctx.stroke();
    // Cross brace a third of the way down.
    const braceY = top.y + (footY - top.y) * 0.36;
    const braceX = spread * 0.36;
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(176, 192, 222, 0.24)";
    ctx.beginPath();
    ctx.moveTo(top.x - braceX, braceY);
    ctx.lineTo(top.x + braceX, braceY);
    ctx.stroke();
    ctx.fillStyle = "#1a2c4d";
    ctx.strokeStyle = "rgba(196, 210, 238, 0.55)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(top.x, top.y, 12, 0, TAU);
    ctx.fill();
    ctx.stroke();
  } else {
    // Ceiling beam with a fixed-support hatch and a small bracket down to the pivot.
    const w = clamp(lengthPx * 0.5, 92, 210);
    const beamBottom = top.y - 16;
    const beamH = 8;
    const left = top.x - w / 2;
    ctx.strokeStyle = "rgba(196, 210, 238, 0.2)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = left + 4; x <= left + w; x += 9) {
      ctx.moveTo(x, beamBottom - beamH);
      ctx.lineTo(x - 7, beamBottom - beamH - 7);
    }
    ctx.stroke();
    const fill = ctx.createLinearGradient(0, beamBottom - beamH, 0, beamBottom);
    fill.addColorStop(0, "#40557d");
    fill.addColorStop(1, "#243555");
    ctx.fillStyle = fill;
    ctx.beginPath();
    roundRect(ctx, left, beamBottom - beamH, w, beamH, 3);
    ctx.fill();
    ctx.strokeStyle = "rgba(196, 210, 238, 0.35)";
    ctx.stroke();
    ctx.fillStyle = "#2c3f63";
    ctx.beginPath();
    ctx.moveTo(top.x - 9, beamBottom);
    ctx.lineTo(top.x + 9, beamBottom);
    ctx.lineTo(top.x + 4, top.y);
    ctx.lineTo(top.x - 4, top.y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function drawRope(ctx: CanvasRenderingContext2D, a: Point, b: Point, ghost = false) {
  ctx.save();
  ctx.lineCap = "round";
  if (ghost) {
    ctx.strokeStyle = LAB.ghost;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 4]);
  } else {
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 4.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = "rgba(226, 233, 246, 0.9)";
    ctx.lineWidth = 2;
  }
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.restore();
}

/** Body hanging along the rope; returns where the rope meets it. */
function drawBob(
  ctx: CanvasRenderingContext2D,
  shape: Shape,
  color: string,
  top: Point,
  bob: Point,
  theta: number,
  size: number,
  ghost: boolean,
) {
  const [aw, ah] = BODY_ASPECT[shape] ?? [1, 1];
  const w = size * aw;
  const h = size * ah;
  const ux = Math.sin(theta);
  const uy = Math.cos(theta);
  if (shape === "person") {
    // Rope runs behind the rider to the seat; the seat sits at hip height.
    const seat = { x: bob.x + ux * h * 0.26, y: bob.y + uy * h * 0.26 };
    drawRope(ctx, top, seat, ghost);
    body(ctx, shape, bob.x, bob.y, w, h, color, { angle: -theta, ghost });
    ctx.save();
    ctx.translate(seat.x, seat.y);
    ctx.rotate(-theta);
    ctx.beginPath();
    roundRect(ctx, -w * 0.7, -1, w * 1.4, 5, 2.5);
    if (ghost) {
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = LAB.ghost;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    } else {
      ctx.fillStyle = "#8a5a36";
      ctx.fill();
      ctx.strokeStyle = "rgba(255, 255, 255, 0.35)";
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    return;
  }
  const reach = ghost ? h * 0.46 : 0;
  drawRope(ctx, top, { x: bob.x - ux * reach, y: bob.y - uy * reach }, ghost);
  body(ctx, shape, bob.x, bob.y, w, h, color, { angle: -theta, ghost });
}

function energyPanel(ctx: CanvasRenderingContext2D, rect: Rect, state: PendulumState, start: number) {
  const { x, y, w, h } = rect;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, w, h, 12);
  ctx.fillStyle = LAB.panel;
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = 18;
  ctx.shadowOffsetY = 6;
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = LAB.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  ctx.font = `700 10px ${LAB.sans}`;
  ctx.fillStyle = LAB.muted;
  ctx.fillText("ENERGY", x + 12, y + 16);
  ctx.textAlign = "right";
  ctx.font = `500 10px ${LAB.mono}`;
  ctx.fillStyle = LAB.faint;
  ctx.fillText(`total ${formatEnergy(start)}`, x + w - 12, y + 16);

  const bars = [
    { label: "KE", value: state.kinetic, color: QUANTITY_COLORS.velocity },
    { label: "PE", value: state.potential, color: QUANTITY_COLORS.weight },
    { label: "heat", value: state.lost, color: QUANTITY_COLORS.friction },
  ];
  const barTop = y + 32;
  const base = y + h - 34;
  const barH = Math.max(10, base - barTop);
  const colW = (w - 20) / 3;
  const bw = Math.min(26, colW * 0.52);
  dashedLine(ctx, x + 10, barTop + 0.5, x + w - 10, barTop + 0.5, "rgba(206, 218, 242, 0.3)", [3, 3], 1);
  bars.forEach((bar, i) => {
    const cx = x + 10 + colW * (i + 0.5);
    const share = start > 1e-12 ? clamp(bar.value / start, 0, 1) : 0;
    ctx.beginPath();
    roundRect(ctx, cx - bw / 2, barTop, bw, barH, 4);
    ctx.fillStyle = "rgba(255, 255, 255, 0.05)";
    ctx.fill();
    if (share > 0.004) {
      const fillH = Math.max(3, barH * share);
      const gradient = ctx.createLinearGradient(0, base - fillH, 0, base);
      gradient.addColorStop(0, bar.color);
      gradient.addColorStop(1, `${bar.color}80`);
      ctx.beginPath();
      roundRect(ctx, cx - bw / 2, base - fillH, bw, fillH, Math.min(4, fillH / 2));
      ctx.fillStyle = gradient;
      ctx.shadowColor = bar.color;
      ctx.shadowBlur = 10;
      ctx.fill();
      ctx.shadowColor = "transparent";
    }
    ctx.textAlign = "center";
    ctx.font = `700 11px ${LAB.sans}`;
    ctx.fillStyle = bar.color;
    ctx.fillText(bar.label, cx, base + 11);
    ctx.font = `500 10px ${LAB.mono}`;
    ctx.fillStyle = LAB.muted;
    ctx.fillText(formatEnergy(bar.value), cx, base + 24);
  });
  ctx.restore();
}

export const pendulumView: EngineView<PendulumState> = {
  charts: ["theta", "speed", "tension"],
  hud: ({ state, t }) => [
    { label: "time", value: formatQuantity(t, "s", 2) },
    { label: "angle", value: formatQuantity(Math.atan2(Math.sin(state.theta), Math.cos(state.theta)) / DEG, "°", 0) },
    { label: "speed", value: formatQuantity(state.speed, "m/s", 2), color: QUANTITY_COLORS.velocity },
    {
      label: "tension",
      value: formatQuantity(state.tension, "N", Math.abs(state.tension) >= 100 ? 0 : 1),
      color: QUANTITY_COLORS.tension,
    },
  ],
  draw(scene) {
    const { ctx, width, height, sim, state, params, ghost, skin, t, showVectors } = scene;
    const frame = layout(scene);
    const { camera } = frame;
    const main = runInfo(sim, params);
    const L = params.length;
    const shape = skin.body.shape;
    const size = bodySize(camera, L);
    backdrop(ctx, width, height, camera, { grid: true, labels: true });

    if (frame.groundY !== null && skin.surface) {
      const view = camera.visible();
      const groundWorld = camera.wy(frame.groundY);
      surfaceBand(
        ctx,
        camera,
        { x: view.x0 - 1, y: groundWorld },
        { x: view.x1 + 1, y: groundWorld },
        skin.surface.material,
        Math.max(0.2, groundWorld - view.y0 + 0.2),
      );
    }

    const top = { x: camera.sx(0), y: camera.sy(L) };
    const lowY = camera.sy(0);
    const lengthPx = camera.s(L);
    drawSupport(ctx, frame, top, lowY, lengthPx);

    // Height reference: release level, lowest point and the drop between them.
    const theta0 = params.angle * DEG;
    const h0 = L * (1 - Math.cos(theta0));
    const xDim = camera.sx(main.reachX) + size * 0.5 + 24;
    const xLeft = camera.sx(-main.reachX) - size * 0.5;
    dashedLine(ctx, top.x, top.y + 14, top.x, lowY, "rgba(206, 218, 242, 0.16)", [2, 5]);
    dashedLine(ctx, top.x - 18, lowY, xDim + 8, lowY, "rgba(206, 218, 242, 0.34)");
    if (h0 > 1e-4) {
      const relY = camera.sy(h0);
      dashedLine(ctx, xLeft, relY, xDim + 8, relY, "rgba(206, 218, 242, 0.34)");
      dimension(ctx, xDim, lowY, xDim, relY, `h = ${formatQuantity(h0, "m", 2)}`, LAB.muted);
    }

    // Previous run, faintly, from its own pivot.
    if (ghost) {
      const other = runInfo(ghost.sim as Sim, ghost.params);
      ctx.save();
      ctx.strokeStyle = LAB.ghost;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([2, 6]);
      reachArc(ctx, camera, other);
      ctx.stroke();
      ctx.restore();
      const gTop = { x: camera.sx(0), y: camera.sy(other.length) };
      const gTheta = ghost.state.theta;
      const gBob = bobAt(camera, other.length, gTheta);
      drawBob(ctx, shape, skin.body.color, gTop, gBob, gTheta, size, true);
      if (Math.abs(other.length - L) > 1e-6) pivotMarker(ctx, gTop.x, gTop.y, 4, LAB.ghost);
    }

    // Reachable path for these settings.
    ctx.save();
    ctx.strokeStyle = LAB.hot;
    ctx.globalAlpha = 0.34;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 6]);
    reachArc(ctx, camera, main);
    ctx.stroke();
    ctx.restore();

    // Fading trail of the last moments.
    if (t > 0) {
      const span = clamp(0.3 * (sim.metrics.smallAnglePeriod ?? 2), 0.18, 1.1);
      const from = Math.max(0, t - span);
      const points: Point[] = [];
      for (let i = 0; i <= 30; i++) {
        const s = sim.sample(from + ((t - from) * i) / 30);
        points.push(bobAt(camera, L, s.theta));
      }
      trail(ctx, points, LAB.hot, { width: 4 });
    }

    const theta = state.theta;
    const bob = bobAt(camera, L, theta);
    drawBob(ctx, shape, skin.body.color, top, bob, theta, size, false);
    pivotMarker(ctx, top.x, top.y, 5.5, LAB.text);

    const atStart = t < 0.04;
    if ((atStart || scene.active === "release") && theta0 > 0.05) {
      const r = clamp(lengthPx * 0.3, 34, 84);
      arcArrow(ctx, top.x, top.y, r, Math.PI / 2, Math.PI / 2 - theta0, "rgba(255,255,255,0.7)", `${Math.round(params.angle)}°`, 1.6);
    }

    if (showVectors) {
      const ux = Math.sin(theta);
      const uy = Math.cos(theta);
      const v = L * state.omega;
      const vLen = v * frame.pxPerMs;
      if (Math.abs(vLen) > 3) vector(ctx, bob.x, bob.y, uy * vLen, -ux * vLen, "velocity", "v");
      const cap = clamp(lengthPx * 0.42, 40, 100) * 1.6;
      const weightLen = Math.min(cap, main.weight * frame.pxPerN);
      vector(ctx, bob.x, bob.y, 0, weightLen, "weight", "mg");
      const tensionLen = Math.min(cap, Math.abs(state.tension) * frame.pxPerN);
      if (tensionLen > 3) {
        const sign = state.tension >= 0 ? 1 : -1;
        vector(ctx, bob.x, bob.y, -ux * tensionLen * sign, -uy * tensionLen * sign, "tension", sign > 0 ? "T" : "T < 0");
      }
    }

    if (atStart) handleRing(ctx, bob.x, bob.y, size * 0.5 + 8, handleState(scene, "release"), LAB.hot);
    handleRing(ctx, top.x, top.y, 13, handleState(scene, "length"), LAB.muted);
    if (scene.active === "length" || scene.hover === "length")
      pill(ctx, top.x - 22, top.y, `L = ${formatQuantity(L, "m", 2)}`, { align: "right", size: 11, mono: true, weight: 500 });

    energyPanel(ctx, frame.panel, state, main.start);
    let swing = 1;
    for (const at of main.cycles) if (at <= t + 1e-9) swing++;
    const period = sim.metrics.period;
    const counter =
      main.start <= 1e-9
        ? "at rest"
        : period
          ? `swing ${swing} · T = ${formatQuantity(period, "s", 2)}`
          : `swing ${swing}`;
    pill(ctx, frame.panel.x + frame.panel.w, frame.panel.y + frame.panel.h + 8, counter, {
      align: "right",
      baseline: "top",
      size: 11,
      weight: 600,
      color: LAB.text,
    });
  },
  handles(scene) {
    const { params } = scene;
    const frame = layout(scene);
    const { camera } = frame;
    const L = params.length;
    const top = { x: camera.sx(0), y: camera.sy(L) };
    const handles: LabHandle[] = [
      {
        id: "length",
        x: top.x,
        y: top.y,
        r: 14,
        label: "Drag the pivot up or down to change the rope length",
        cursor: "ns-resize",
        drag: (_px, py) => ({ length: Math.max(0.05, camera.wy(py)) }),
      },
    ];
    if (scene.t < 0.04 || scene.active === "release") {
      const bob = bobAt(camera, L, params.angle * DEG);
      handles.push({
        id: "release",
        x: bob.x,
        y: bob.y,
        r: Math.max(16, bodySize(camera, L) * 0.5 + 8),
        label: "Drag the swing around the pivot to set the release angle",
        cursor: "grab",
        drag: (px, py) => ({
          angle: clamp(Math.abs(Math.atan2(px - top.x, py - top.y)) / DEG, 0, 170),
        }),
      });
    }
    return handles;
  },
};
