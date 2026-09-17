import type { Params, Simulation } from "../../../../shared/studio/engines";
import { maxLeverArm, type RotationState } from "../../../../shared/studio/engines/rotation";
import type { Shape } from "../../../../shared/studio/schema";
import {
  Camera,
  LAB,
  QUANTITY_COLORS,
  arcArrow,
  arrow,
  backdrop,
  body,
  formatNumber,
  formatQuantity,
  handleRing,
  pill,
  pivot,
  unionBox,
  vector,
  type Point,
  type WorldBox,
} from "../draw";
import type { EngineView, LabHandle, LabScene } from "../types";

// Torque lab, seen from above: the pivot axis points out of the screen and a
// positive torque turns the body counter-clockwise.

type Sim = Simulation<RotationState>;
type Scene = LabScene<RotationState>;
/** 0 = pivot at one end (door, lever), 1 = disc about its center, 2 = bar about its middle. */
type Kind = 0 | 1 | 2;

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
/** The engine stops a door-like body here. */
const DOOR_STOP = 175 * DEG;
const TORQUE = "#f472d0";
const RESIST = QUANTITY_COLORS.friction;
const FORCE = QUANTITY_COLORS.force;
const TURN = QUANTITY_COLORS.displacement;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const kindOf = (params: Params): Kind => {
  const shape = Math.round(params.shape);
  return shape === 1 ? 1 : shape === 2 ? 2 : 0;
};
/** Farthest point of the body from the pivot, meters. */
const reachOf = (kind: Kind, length: number) => (kind === 2 ? length / 2 : length);
/** Canvas unit vector for a world angle (counter-clockwise positive). */
const unit = (angle: number): Point => ({ x: Math.cos(angle), y: -Math.sin(angle) });

/** Trims trailing zeros: 20 N, 0.75 m, 0.005 m. */
function num(value: number, digits = 2) {
  const abs = Math.abs(value);
  const places = abs >= 100 ? 0 : abs >= 10 ? Math.min(1, digits) : abs >= 0.1 || abs === 0 ? digits : digits + 1;
  const text = formatNumber(value, places);
  return text.includes(".") ? text.replace(/0+$/, "").replace(/\.$/, "") : text;
}

const torqueText = (value: number) => formatQuantity(value, "N·m", Math.abs(value) >= 10 ? 1 : 2);

function turnedText(theta: number) {
  const deg = Math.abs(theta) / DEG;
  const turns = deg / 360;
  if (turns >= 10) return `${formatNumber(turns, 0)} turns`;
  if (deg >= 359.5) return `${Math.round(deg)}° · ${formatNumber(turns, 1)} turns`;
  return `${formatNumber(deg, deg < 9.95 ? 1 : 0)}°`;
}

/** Meters of arrow per newton: the larger of this run's and the previous run's push fills a set share of the body. */
function forceScale(params: Params, ghostParams: Params | null) {
  const kind = kindOf(params);
  const share = kind === 0 ? 0.5 : kind === 1 ? 1.05 : 0.72;
  const reference = Math.max(params.force, ghostParams?.force ?? 0);
  return (share * reachOf(kind, params.length)) / Math.max(1e-6, reference || 1);
}

/** World region one run can occupy: every pose of the body plus the push arrow. */
function runBox(params: Params, sim: Sim, metersPerN: number): WorldBox {
  const kind = kindOf(params);
  const reach = reachOf(kind, params.length);
  const lever = Math.min(params.leverArm, maxLeverArm(kind, params.length));
  const alpha = clamp(params.forceAngle, 0, 180) * DEG;
  const arrowLength = params.force * metersPerN;
  const box =
    kind === 0
      ? { x0: -reach * 1.12, x1: reach * 1.12, y0: -reach * 0.3, y1: reach * 1.14 }
      : { x0: -reach * 1.2, x1: reach * 1.2, y0: -reach * 1.2, y1: reach * 1.2 };
  const grow = (x: number, y: number) => {
    box.x0 = Math.min(box.x0, x);
    box.x1 = Math.max(box.x1, x);
    box.y0 = Math.min(box.y0, y);
    box.y1 = Math.max(box.y1, y);
  };
  if (kind === 0) {
    const end = Math.min(DOOR_STOP, (sim.metrics.finalAngle ?? 0) * DEG);
    for (let i = 0; i <= 18; i++) {
      const theta = (end * i) / 18;
      grow(
        lever * Math.cos(theta) + arrowLength * Math.cos(theta + alpha),
        lever * Math.sin(theta) + arrowLength * Math.sin(theta + alpha),
      );
    }
  } else {
    // A spinning body can carry the arrow all the way around.
    const tip = Math.hypot(lever + arrowLength * Math.cos(alpha), arrowLength * Math.sin(alpha));
    grow(-tip, -tip);
    grow(tip, tip);
  }
  return box;
}

const boxes = new WeakMap<object, { ghost: object | null; scale: number; box: WorldBox }>();
function frameBox(scene: Scene, metersPerN: number): WorldBox {
  const ghostSim = scene.ghost?.sim ?? null;
  const hit = boxes.get(scene.sim);
  if (hit && hit.ghost === ghostSim && hit.scale === metersPerN) return hit.box;
  let box = runBox(scene.params, scene.sim, metersPerN);
  if (scene.ghost) box = unionBox(box, runBox(scene.ghost.params, scene.ghost.sim as Sim, metersPerN));
  boxes.set(scene.sim, { ghost: ghostSim, scale: metersPerN, box });
  return box;
}

interface Layout {
  camera: Camera;
  kind: Kind;
  /** Pose being drawn (held still while a handle is dragged). */
  theta: number;
  metersPerN: number;
  cx: number;
  cy: number;
  /** Body reach and lever arm, px. */
  reach: number;
  lever: number;
  /** Body thickness, px. */
  thick: number;
}

/**
 * Camera, arrow scale and pose freeze while a handle is dragged, so the drag
 * never feeds back on itself. Keyed by canvas so several labs stay independent.
 */
const frozen = new WeakMap<object, { box: WorldBox; metersPerN: number; theta: number }>();
const lastPose = new WeakMap<object, number>();

function layout(scene: Scene): Layout {
  const { ctx, params, state, width, height } = scene;
  const key = ctx as object;
  let use = frozen.get(key);
  if (!scene.active || !use) {
    const metersPerN = forceScale(params, scene.ghost?.params ?? null);
    const fresh = { box: frameBox(scene, metersPerN), metersPerN, theta: state.theta };
    if (scene.active) {
      // The drag resets playback; keep the pose that was grabbed.
      fresh.theta = lastPose.get(key) ?? state.theta;
      frozen.set(key, fresh);
    } else {
      frozen.delete(key);
      lastPose.set(key, state.theta);
    }
    use = fresh;
  }
  const kind = kindOf(params);
  const camera = new Camera(width, height, use.box, { left: 56, right: 56, top: 70, bottom: 46 });
  const reach = camera.s(reachOf(kind, params.length));
  return {
    camera,
    kind,
    theta: use.theta,
    metersPerN: use.metersPerN,
    cx: camera.sx(0),
    cy: camera.sy(0),
    reach,
    lever: camera.s(Math.min(params.leverArm, maxLeverArm(kind, params.length))),
    thick: kind === 1 ? 0 : clamp(reach * (kind === 0 ? 0.045 : 0.07), 8, kind === 0 ? 16 : 20),
  };
}

function forceGeometry(L: Layout, params: Params) {
  const alpha = clamp(params.forceAngle, 0, 180) * DEG;
  const u = unit(L.theta);
  const n = unit(L.theta + Math.PI / 2);
  const d = unit(L.theta + alpha);
  const length = L.camera.s(params.force * L.metersPerN);
  const at = { x: L.cx + u.x * L.lever, y: L.cy + u.y * L.lever };
  return { alpha, u, n, d, length, at, tip: { x: at.x + d.x * length, y: at.y + d.y * length } };
}

/** Where the force-tip handle sits: never on top of the push point. */
function forceHandlePoint(f: ReturnType<typeof forceGeometry>) {
  const length = Math.max(f.length, 26);
  return { x: f.at.x + f.d.x * length, y: f.at.y + f.d.y * length };
}

const polar = (L: Layout, radius: number, angle: number): Point => ({
  x: L.cx + Math.cos(angle) * radius,
  y: L.cy - Math.sin(angle) * radius,
});

/** Canvas arc for world angles; counter-clockwise when `to` > `from`. */
function worldArc(ctx: CanvasRenderingContext2D, L: Layout, radius: number, from: number, to: number) {
  ctx.arc(L.cx, L.cy, radius, -from, -to, to > from);
}

function handleState(scene: Scene, id: string) {
  return scene.active === id ? "active" : scene.hover === id ? "hover" : "idle";
}

// ---------------------------------------------------------------------------
// Scenery

/** Plan-view wall with architectural hatching, centered on the pivot line. */
function wallSegment(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, half: number, openEnd: "left" | "right") {
  const left = Math.min(x0, x1);
  const w = Math.abs(x1 - x0);
  if (w < 1) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(left, y - half, w, half * 2);
  const gradient = ctx.createLinearGradient(0, y - half, 0, y + half);
  gradient.addColorStop(0, "#1d3563");
  gradient.addColorStop(1, "#122444");
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.clip();
  ctx.strokeStyle = "rgba(170, 192, 236, 0.2)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  const h = half * 2;
  for (let x = left - h - ((left % 9) + 9); x < left + w + h; x += 9) {
    ctx.moveTo(x, y + half);
    ctx.lineTo(x + h, y - half);
  }
  ctx.stroke();
  ctx.restore();
  ctx.save();
  ctx.strokeStyle = "rgba(226, 234, 252, 0.55)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(left, y - half);
  ctx.lineTo(left + w, y - half);
  ctx.moveTo(left, y + half);
  ctx.lineTo(left + w, y + half);
  const endX = openEnd === "right" ? left + w : left;
  ctx.moveTo(endX, y - half);
  ctx.lineTo(endX, y + half);
  ctx.stroke();
  ctx.restore();
}

function drawMount(ctx: CanvasRenderingContext2D, L: Layout, door: boolean, width: number) {
  const half = Math.max(L.thick * 1.15, 11);
  if (door) {
    wallSegment(ctx, -4, L.cx, L.cy, half, "right");
    wallSegment(ctx, L.cx + L.reach + 3, width + 4, L.cy, half, "left");
  } else {
    // A short bracket the lever is pinned to.
    wallSegment(ctx, L.cx - Math.max(36, L.reach * 0.22), L.cx + 2, L.cy, half, "right");
  }
}

/** Skin shape that reads as the right silhouette from above. */
function planShape(kind: Kind, shape: Shape): Shape {
  const round = ["ball", "disc", "plate", "cap", "wheel", "can", "cup", "bottle"].includes(shape);
  if (kind === 1) {
    if (shape === "cup" || shape === "bottle") return "cap";
    return round ? shape : "disc";
  }
  if (round || shape === "person" || shape === "boat" || shape === "bag") return "bar";
  return shape;
}

function drawBody(scene: Scene, L: Layout, theta: number, options: { ghost?: boolean; alpha?: number } = {}) {
  const { ctx, skin } = scene;
  const shape = planShape(L.kind, skin.body.shape);
  const color = skin.body.color;
  if (L.kind === 1) {
    body(ctx, shape, L.cx, L.cy, L.reach * 2, L.reach * 2, color, { angle: -theta, ghost: options.ghost, alpha: options.alpha });
    return;
  }
  const u = unit(theta);
  const offset = L.kind === 0 ? L.reach / 2 : 0;
  const length = L.kind === 0 ? L.reach + L.thick * 0.3 : L.reach * 2;
  body(ctx, shape, L.cx + u.x * offset, L.cy + u.y * offset, length, L.thick, color, {
    angle: -theta,
    ghost: options.ghost,
    alpha: options.alpha,
  });
}

/** Reference marks that make a disc's rotation obvious: a radial stripe and a rim notch. */
function discMarks(ctx: CanvasRenderingContext2D, L: Layout, theta: number, shape: Shape) {
  const u = unit(theta);
  ctx.save();
  ctx.lineCap = "round";
  ctx.strokeStyle = "rgba(255,255,255,0.78)";
  ctx.lineWidth = Math.max(2, L.reach * 0.035);
  ctx.beginPath();
  ctx.moveTo(L.cx + u.x * L.reach * 0.12, L.cy + u.y * L.reach * 0.12);
  ctx.lineTo(L.cx + u.x * L.reach * 0.96, L.cy + u.y * L.reach * 0.96);
  ctx.stroke();
  if (shape === "can") {
    // Pull tab, which also turns with the can.
    ctx.translate(L.cx, L.cy);
    ctx.rotate(-theta);
    ctx.fillStyle = "rgba(230, 236, 246, 0.9)";
    ctx.strokeStyle = "rgba(0,0,0,0.35)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.ellipse(-L.reach * 0.22, 0, L.reach * 0.3, L.reach * 0.14, 0, 0, TAU);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Blurs detail on a body spinning too fast to follow frame by frame. */
function spinBlur(ctx: CanvasRenderingContext2D, L: Layout, theta: number, omega: number, color: string) {
  const perFrame = Math.abs(omega) / 60;
  const amount = clamp((perFrame - 0.25) / 0.9, 0, 1);
  if (amount <= 0) return 0;
  const radius = L.kind === 1 ? L.reach : L.reach;
  ctx.save();
  if (L.kind === 1) {
    ctx.globalAlpha = 0.75 * amount;
    const gradient = ctx.createRadialGradient(L.cx, L.cy, 0, L.cx, L.cy, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, "rgba(10, 20, 40, 0.6)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, radius * 0.985, 0, TAU);
    ctx.fill();
  } else {
    ctx.globalAlpha = 0.28 * amount;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(L.cx, L.cy, radius, 0, TAU);
    ctx.fill();
  }
  const sweep = Math.min(TAU * 0.85, perFrame * 2.5);
  ctx.lineCap = "round";
  ctx.strokeStyle = "#ffffff";
  for (const [share, alpha] of [
    [0.42, 0.22],
    [0.7, 0.3],
    [0.93, 0.4],
  ] as const) {
    ctx.globalAlpha = alpha * amount;
    ctx.lineWidth = Math.max(1.5, radius * 0.03);
    ctx.beginPath();
    worldArc(ctx, L, radius * share, theta - sweep, theta);
    ctx.stroke();
  }
  ctx.restore();
  return amount;
}

/** Lever door handle in plan view: a rose on each face and a grip pointing at the hinge. */
function doorHandle(ctx: CanvasRenderingContext2D, at: Point, u: Point, n: Point, thick: number) {
  const grip = Math.max(14, thick * 2.2);
  ctx.save();
  ctx.lineCap = "round";
  for (const side of [1, -1]) {
    const face = thick / 2 + 3;
    const bx = at.x + n.x * side * face;
    const by = at.y + n.y * side * face;
    ctx.strokeStyle = "rgba(0,0,0,0.45)";
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - u.x * grip, by - u.y * grip);
    ctx.stroke();
    ctx.strokeStyle = "#dfe5ef";
    ctx.lineWidth = 3.6;
    ctx.stroke();
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------

export const rotationView: EngineView<RotationState> = {
  charts: ["theta", "omega"],
  hud: ({ t, state }) => [
    { label: "time", value: formatQuantity(t, "s", 2) },
    { label: "angle turned", value: turnedText(state.theta), color: TURN },
    { label: "spin rate", value: formatQuantity(state.omega, "rad/s", 2), color: QUANTITY_COLORS.velocity },
    { label: "torque", value: torqueText(state.torque), color: TORQUE },
  ],
  draw(scene) {
    const { ctx, width, height, params, state, sim, ghost, skin, t, showVectors } = scene;
    const L = layout(scene);
    const { kind, theta, cx, cy, reach } = L;
    backdrop(ctx, width, height, L.camera, { grid: true, labels: true });
    const labels: Array<() => void> = [];
    const dragging = scene.active !== null;

    const applied = sim.metrics.torque ?? 0;
    const resistance = Math.max(0, params.resistance);
    const pushOn = params.pushTime > 0 && params.force > 0 && (dragging || t < params.pushTime);
    const stuck = params.pushTime > 0 && applied > 1e-9 && sim.metrics.startsTurning === 0;
    const target = Math.max(0, params.targetAngle) * DEG;
    const reachedAt = sim.metrics.timeToTarget;
    const reached = theta >= target - 1e-6 || (reachedAt !== null && reachedAt !== undefined && t >= reachedAt);

    // Wall or bracket the pivot is fixed to.
    if (kind === 0) drawMount(ctx, L, skin.body.shape === "door", width);

    // Swept angle so far.
    const ring = kind === 0 ? reach : reach + 14;
    if (kind === 0) {
      ctx.save();
      ctx.strokeStyle = LAB.faint;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 5]);
      ctx.beginPath();
      worldArc(ctx, L, reach, 0, DOOR_STOP);
      ctx.stroke();
      ctx.restore();
    } else {
      ctx.save();
      ctx.strokeStyle = "rgba(206, 218, 242, 0.14)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, ring, 0, TAU);
      ctx.stroke();
      // Fixed start mark.
      const a = polar(L, ring - 7, 0);
      const b = polar(L, ring + 9, 0);
      ctx.strokeStyle = LAB.muted;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.restore();
    }
    if (theta > 0.004) {
      ctx.save();
      const sweepEnd = Math.min(theta, kind === 0 ? DOOR_STOP : TAU * 3);
      if (kind === 0 || theta < TAU) {
        ctx.fillStyle = "rgba(230, 236, 248, 0.07)";
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        worldArc(ctx, L, ring, 0, Math.min(sweepEnd, TAU));
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = TURN;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      ctx.shadowColor = TURN;
      ctx.shadowBlur = 6;
      ctx.beginPath();
      if (kind !== 0 && theta > TAU) {
        // One ring per turn, spiraling outward.
        const steps = Math.ceil((sweepEnd / TAU) * 96);
        for (let i = 0; i <= steps; i++) {
          const a = (sweepEnd * i) / steps;
          const p = polar(L, ring + (a / TAU) * 6, a);
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y);
        }
      } else worldArc(ctx, L, ring, 0, sweepEnd);
      ctx.stroke();
      ctx.restore();
    }

    // Goal ray.
    const goalColor = reached ? LAB.good : "rgba(206, 218, 242, 0.62)";
    const goalAngle = kind === 0 ? Math.min(target, DOOR_STOP) : target % TAU;
    {
      const from = polar(L, kind === 0 ? reach * 0.36 : reach * 0.62, goalAngle);
      const to = polar(L, reach + (kind === 0 ? 24 : 40), goalAngle);
      ctx.save();
      ctx.strokeStyle = goalColor;
      ctx.lineWidth = reached ? 2 : 1.5;
      ctx.setLineDash([6, 5]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
      const gu = unit(goalAngle);
      const labelAt = polar(L, reach + (kind === 0 ? 34 : 50), goalAngle);
      const goalText = `goal ${formatNumber(params.targetAngle, 0)}°${reached ? " ✓" : ""}`;
      labels.push(() =>
        pill(ctx, labelAt.x, labelAt.y, goalText, {
          align: gu.x > 0.35 ? "left" : gu.x < -0.35 ? "right" : "center",
          baseline: gu.y > 0.35 ? "top" : gu.y < -0.35 ? "bottom" : "middle",
          size: 11,
          weight: 700,
          color: reached ? LAB.good : LAB.muted,
          border: reached ? `${LAB.good}66` : undefined,
        }),
      );
    }

    // Previous run.
    if (ghost) {
      const gp = ghost.params;
      const gkind = kindOf(gp);
      const gL: Layout = {
        ...L,
        kind: gkind,
        reach: L.camera.s(reachOf(gkind, gp.length)),
        lever: L.camera.s(Math.min(gp.leverArm, maxLeverArm(gkind, gp.length))),
      };
      const gtheta = ghost.state.theta;
      drawBody(scene, gL, gtheta, { ghost: true });
      if (gkind === 1) {
        const gu = unit(gtheta);
        ctx.save();
        ctx.strokeStyle = LAB.ghost;
        ctx.setLineDash([4, 4]);
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(cx + gu.x * gL.reach, cy + gu.y * gL.reach);
        ctx.stroke();
        ctx.restore();
      }
      const gPush = gp.pushTime > 0 && gp.force > 0 && (dragging || t < gp.pushTime);
      const differs =
        Math.abs(gp.force - params.force) > 1e-6 ||
        Math.abs(gp.leverArm - params.leverArm) > 1e-6 ||
        Math.abs(gp.forceAngle - params.forceAngle) > 1e-6;
      if (showVectors && gPush && differs) {
        const gf = forceGeometry({ ...gL, theta: gtheta }, gp);
        arrow(ctx, gf.at.x, gf.at.y, gf.d.x * gf.length, gf.d.y * gf.length, LAB.ghost, { width: 2, dashed: true, alpha: 0.9 });
      }
      if (Math.abs(gtheta - theta) > 14 * DEG && gkind !== 1) {
        const tipAt = polar(gL, gL.reach * (gkind === 0 ? 0.62 : 0.8), gtheta + 0.12);
        labels.push(() => pill(ctx, tipAt.x, tipAt.y, "previous run", { size: 10, color: LAB.muted, align: "center" }));
      }
    }

    // The body.
    drawBody(scene, L, theta);
    const f = forceGeometry(L, params);
    let blur = 0;
    if (kind === 1) {
      blur = spinBlur(ctx, L, theta, state.omega, skin.body.color);
      if (blur < 0.6) {
        ctx.save();
        ctx.globalAlpha = 1 - blur;
        discMarks(ctx, L, theta, skin.body.shape);
        ctx.restore();
      }
    } else if (kind === 2) {
      blur = spinBlur(ctx, L, theta, state.omega, skin.body.color);
    }
    if (kind === 0 && skin.body.shape === "door") doorHandle(ctx, f.at, f.u, f.n, L.thick);
    pivot(ctx, cx, cy, kind === 1 ? 6 : 7);

    // Push point.
    ctx.save();
    ctx.fillStyle = FORCE;
    ctx.strokeStyle = LAB.bgBottom;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(f.at.x, f.at.y, 4.5, 0, TAU);
    ctx.fill();
    ctx.stroke();
    ctx.restore();

    // Lever arm, measured from the pivot along the body.
    if (L.lever > 3) {
      const offset = kind === 1 ? 0 : L.thick / 2 + 12;
      const nx = f.u.y;
      const ny = -f.u.x;
      const x1 = cx + nx * offset;
      const y1 = cy + ny * offset;
      const x2 = f.at.x + nx * offset;
      const y2 = f.at.y + ny * offset;
      ctx.save();
      ctx.strokeStyle = LAB.muted;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      for (const [x, y] of [
        [x1, y1],
        [x2, y2],
      ]) {
        ctx.moveTo(x + nx * 5, y + ny * 5);
        ctx.lineTo(x - nx * 5, y - ny * 5);
      }
      ctx.stroke();
      ctx.restore();
      const text = `r = ${num(params.leverArm, 2)} m`;
      const push = Math.max(0, 40 - L.lever / 2);
      const mx = (x1 + x2) / 2 + nx * (10 + push * 0.4);
      const my = (y1 + y2) / 2 + ny * (10 + push * 0.4);
      labels.push(() =>
        pill(ctx, mx, my, text, { align: "center", size: 11, mono: true, weight: 500, color: LAB.muted }),
      );
    }

    // Forces and torques.
    if (showVectors) {
      const sin = Math.sin(f.alpha);
      if (f.length > 2) {
        if (pushOn) vector(ctx, f.at.x, f.at.y, f.d.x * f.length, f.d.y * f.length, "force");
        else arrow(ctx, f.at.x, f.at.y, f.d.x * f.length, f.d.y * f.length, FORCE, { width: 2, dashed: true, alpha: 0.4 });
        const fl = f.length + 14;
        const lx = f.at.x + f.d.x * fl;
        const ly = f.at.y + f.d.y * fl;
        const text = `F = ${num(params.force, 1)} N`;
        labels.unshift(() =>
          pill(ctx, lx, ly, text, {
            color: FORCE,
            align: f.d.x > 0.35 ? "left" : f.d.x < -0.35 ? "right" : "center",
            baseline: f.d.y > 0.35 ? "top" : f.d.y < -0.35 ? "bottom" : "middle",
            size: 12,
            weight: 700,
            border: `${FORCE}55`,
            alpha: pushOn ? 1 : 0.55,
          }),
        );
      }
      if (pushOn && f.length > 2) {
        // Perpendicular component and the right angle it makes with the lever.
        const perp = f.length * sin;
        const s = 9;
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.7)";
        ctx.lineWidth = 1.3;
        ctx.beginPath();
        ctx.moveTo(f.at.x + f.u.x * s, f.at.y + f.u.y * s);
        ctx.lineTo(f.at.x + f.u.x * s + f.n.x * s, f.at.y + f.u.y * s + f.n.y * s);
        ctx.lineTo(f.at.x + f.n.x * s, f.at.y + f.n.y * s);
        ctx.stroke();
        ctx.restore();
        if (Math.abs(sin) < 0.985 && perp > 8) {
          vector(ctx, f.at.x, f.at.y, f.n.x * perp, f.n.y * perp, "force", undefined, {
            dashed: true,
            width: 2,
            alpha: 0.75,
            glow: false,
          });
          ctx.save();
          ctx.strokeStyle = "rgba(255, 122, 47, 0.45)";
          ctx.setLineDash([2, 3]);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(f.tip.x, f.tip.y);
          ctx.lineTo(f.at.x + f.n.x * perp, f.at.y + f.n.y * perp);
          ctx.stroke();
          ctx.restore();
          const px = f.at.x + f.n.x * (perp + 14);
          const py = f.at.y + f.n.y * (perp + 14);
          const text = `F_{⊥} = F·sinθ = ${num(params.force * sin, 1)} N`;
          labels.push(() =>
            pill(ctx, px, py, text, {
              color: FORCE,
              align: f.n.x > 0.35 ? "left" : f.n.x < -0.35 ? "right" : "center",
              baseline: f.n.y > 0.35 ? "top" : f.n.y < -0.35 ? "bottom" : "middle",
              size: 11,
              weight: 600,
              alpha: 0.9,
            }),
          );
        }
        if (Math.abs(f.alpha - Math.PI / 2) > 1.5 * DEG) {
          // Angle between the lever and the push.
          const r = 26;
          ctx.save();
          ctx.strokeStyle = "rgba(255,255,255,0.75)";
          ctx.lineWidth = 1.4;
          ctx.beginPath();
          ctx.arc(f.at.x, f.at.y, r, -L.theta, -(L.theta + f.alpha), true);
          ctx.stroke();
          if (L.reach - L.lever < r + 10) {
            ctx.setLineDash([3, 4]);
            ctx.strokeStyle = LAB.faint;
            ctx.beginPath();
            ctx.moveTo(f.at.x, f.at.y);
            ctx.lineTo(f.at.x + f.u.x * (r + 16), f.at.y + f.u.y * (r + 16));
            ctx.stroke();
          }
          ctx.restore();
          const mid = unit(L.theta + f.alpha / 2);
          const ax = f.at.x + mid.x * (r + 12);
          const ay = f.at.y + mid.y * (r + 12);
          const text = `θ = ${Math.round(params.forceAngle)}°`;
          labels.push(() =>
            pill(ctx, ax, ay, text, {
              align: mid.x > 0.35 ? "left" : mid.x < -0.35 ? "right" : "center",
              size: 11,
              weight: 600,
            }),
          );
        }
      }

      // Torque arcs around the pivot: magenta turns it, red resists.
      const reference = Math.max(applied, resistance, 1e-9);
      const center = kind === 0 ? theta + Math.PI / 2 : Math.PI / 2;
      const radius = kind === 1 ? clamp(reach * 0.5, 22, 70) : clamp(reach * 0.15, 30, 52);
      const drawTorque = pushOn && applied > 1e-9;
      if (drawTorque) {
        const span = (50 + 150 * (applied / reference)) * DEG;
        const from = center - span / 2;
        const to = center + span / 2;
        arcArrow(ctx, cx, cy, radius, -from, -to, TORQUE, undefined, 3);
        const at = polar(L, radius + 16, center);
        const text = `τ = r·F·sinθ = ${torqueText(applied)}`;
        labels.splice(1, 0, () =>
          pill(ctx, at.x, at.y, text, {
            color: TORQUE,
            align: "center",
            baseline: "bottom",
            size: 12,
            weight: 700,
            border: `${TORQUE}55`,
          }),
        );
      }
      const moving = state.moving >= 0.5 && !dragging;
      if (resistance > 0 && (drawTorque || (moving && Math.abs(state.omega) > 1e-3))) {
        const span = (40 + 150 * (resistance / reference)) * DEG;
        const r = radius - 12;
        const from = center + span / 2;
        const to = center - span / 2;
        arcArrow(ctx, cx, cy, r, -from, -to, RESIST, undefined, 2.4);
        const side = polar(L, radius + 16, center + span / 2 + 0.35);
        const text = stuck ? `τ_{resist} up to ${torqueText(resistance)}` : `τ_{resist} ${torqueText(resistance)}`;
        labels.push(() =>
          pill(ctx, side.x, side.y, text, {
            color: RESIST,
            align: "right",
            size: 11,
            weight: 700,
            border: `${RESIST}55`,
          }),
        );
      }
    }

    // Angle turned.
    if (theta > 0.004 || reached) {
      const at = kind === 0 ? polar(L, reach + 22, theta) : polar(L, ring + 18, theta);
      const dir = unit(theta);
      const text = turnedText(theta);
      labels.push(() =>
        pill(ctx, at.x, at.y, text, {
          color: TURN,
          align: dir.x > 0.35 ? "left" : dir.x < -0.35 ? "right" : "center",
          baseline: dir.y > 0.35 ? "top" : dir.y < -0.35 ? "bottom" : "middle",
          size: 12,
          weight: 700,
          mono: true,
        }),
      );
    }

    // Outcome banners.
    if (params.force > 0 && params.pushTime > 0 && Math.abs(Math.sin(clamp(params.forceAngle, 0, 180) * DEG)) < 1e-3)
      labels.unshift(() =>
        pill(ctx, width / 2, 50, "F points along the lever, so τ = 0 and nothing turns", {
          align: "center",
          color: LAB.bad,
          border: `${LAB.bad}66`,
          size: 12,
          weight: 700,
        }),
      );
    else if (stuck)
      labels.unshift(() =>
        pill(ctx, width / 2, 50, `τ too small to beat resistance · ${torqueText(applied)} < ${torqueText(resistance)}`, {
          align: "center",
          color: LAB.bad,
          border: `${LAB.bad}66`,
          size: 12,
          weight: 700,
        }),
      );

    for (const label of labels) label();

    ctx.save();
    ctx.font = `600 10px ${LAB.mono}`;
    ctx.fillStyle = LAB.faint;
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText("TOP VIEW", 14, height - 26);
    ctx.restore();

    // Handles.
    handleRing(ctx, f.at.x, f.at.y, 11, handleState(scene, "leverArm"), LAB.text);
    const h = forceHandlePoint(f);
    handleRing(ctx, h.x, h.y, 12, handleState(scene, "force"), FORCE);
    void blur;
  },
  handles(scene) {
    const { params, engine } = scene;
    const L = layout(scene);
    const f = forceGeometry(L, params);
    const kind = L.kind;
    const pxPerN = L.camera.s(L.metersPerN);
    const step = (key: string, value: number) => {
      const spec = engine.params.find((item) => item.key === key);
      return spec && spec.step > 0 ? Math.round(value / spec.step) * spec.step : value;
    };
    const tip = forceHandlePoint(f);
    const handles: LabHandle[] = [
      {
        id: "force",
        x: tip.x,
        y: tip.y,
        r: 16,
        label: "Drag the arrow tip to change how hard and at what angle you push",
        cursor: "grab",
        drag: (px, py) => {
          const dx = px - f.at.x;
          const dy = f.at.y - py;
          const ux = Math.cos(L.theta);
          const uy = Math.sin(L.theta);
          let angle = Math.atan2(ux * dy - uy * dx, ux * dx + uy * dy) / DEG;
          if (angle < 0) angle = angle < -90 ? 180 : 0;
          if (Math.abs(angle - 90) < 3) angle = 90;
          return {
            force: Math.max(0, step("force", Math.hypot(dx, dy) / Math.max(1e-9, pxPerN))),
            forceAngle: clamp(Math.round(angle), 0, 180),
          };
        },
      },
      {
        id: "leverArm",
        x: f.at.x,
        y: f.at.y,
        r: 13,
        label: "Drag along the body to change where the force is applied",
        cursor: "grab",
        drag: (px, py) => {
          const along = ((px - L.cx) * f.u.x + (py - L.cy) * f.u.y) / L.camera.scale;
          return { leverArm: clamp(step("leverArm", along), 0.005, maxLeverArm(kind, params.length)) };
        },
      },
    ];
    return handles;
  },
};
