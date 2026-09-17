import type { Simulation } from "../../../../shared/studio/engines";
import type { SurfaceState } from "../../../../shared/studio/engines/surface";
import {
  Camera,
  LAB,
  QUANTITY_COLORS,
  arrowLength,
  backdrop,
  body,
  dimension,
  formatQuantity,
  handleRing,
  meter,
  pill,
  reserve,
  roundRect,
  surfaceBand,
  vector,
  type WorldBox,
} from "../draw";
import type { EngineView, LabHandle, LabScene } from "../types";

type Sim = Simulation<SurfaceState>;
const DEG = Math.PI / 180;

const extents = new WeakMap<Sim, { min: number; max: number; speed: number }>();
function extent(sim: Sim) {
  let value = extents.get(sim);
  if (!value) {
    value = { min: 0, max: 0, speed: 0 };
    for (let i = 0; i <= 160; i++) {
      const s = sim.sample((sim.duration * i) / 160);
      value.min = Math.min(value.min, s.x);
      value.max = Math.max(value.max, s.x);
      value.speed = Math.max(value.speed, Math.abs(s.v));
    }
    extents.set(sim, value);
  }
  return value;
}

let frozen: { box: WorldBox; pxPerN: number } | null = null;

function layout(scene: LabScene<SurfaceState>) {
  const { sim, ghost, params, width, height } = scene;
  const run = extent(sim);
  const other = ghost ? extent(ghost.sim as Sim) : run;
  const min = Math.min(run.min, other.min);
  const max = Math.max(run.max, other.max);
  const span = Math.max(0.6, max - min);
  const s0 = min - span * 0.35;
  const s1 = max + span * 0.3;
  const alpha = params.incline * DEG;
  const box: WorldBox = {
    x0: s0 * Math.cos(alpha),
    x1: s1 * Math.cos(alpha),
    y0: Math.min(s0 * Math.sin(alpha), 0) - span * 0.1,
    y1: Math.max(s1 * Math.sin(alpha), 0) + span * 0.25,
  };
  const reference = Math.max(params.mass * params.gravity, params.force, 0.5);
  const pxPerN = 78 / reference;
  if (scene.active) frozen ??= { box, pxPerN };
  else frozen = null;
  const use = frozen ?? { box, pxPerN };
  const camera = new Camera(width, height, use.box, { left: 70, right: 70, top: 120, bottom: 70 });
  const size = Math.max(40, Math.min(92, 44 + 12 * Math.cbrt(params.mass)));
  const tangent = { x: Math.cos(alpha), y: -Math.sin(alpha) };
  const normal = { x: -Math.sin(alpha), y: -Math.cos(alpha) };
  const onSurface = (s: number) => ({ x: camera.sx(s * Math.cos(alpha)), y: camera.sy(s * Math.sin(alpha)) });
  return { camera, pxPerN: use.pxPerN, size, alpha, tangent, normal, onSurface, s0, s1, reference };
}

function dims(shape: string, size: number) {
  if (shape === "can" || shape === "bottle" || shape === "cup") return { w: size * 0.6, h: size };
  if (shape === "book" || shape === "phone") return { w: size * 1.1, h: size * 0.35 };
  if (shape === "person") return { w: size * 0.55, h: size * 1.4 };
  return { w: size, h: size * 0.82 };
}

function state(scene: LabScene, id: string) {
  return scene.active === id ? "active" : scene.hover === id ? "hover" : "idle";
}

export const surfaceView: EngineView<SurfaceState> = {
  charts: ["v", "x", "friction"],
  hud: ({ t, state: s }) => [
    { label: "time", value: formatQuantity(t, "s", 2) },
    { label: "speed", value: formatQuantity(Math.abs(s.v), "m/s", 2), color: QUANTITY_COLORS.velocity },
    { label: "moved", value: formatQuantity(Math.abs(s.x), "m", 3) },
    { label: "friction", value: formatQuantity(Math.abs(s.friction), "N", 2), color: QUANTITY_COLORS.friction },
  ],
  draw(scene) {
    const { ctx, width, height, sim, params, ghost, skin, t, showVectors } = scene;
    const s = scene.state;
    const L = layout(scene);
    const { camera, size, alpha, tangent, normal, onSurface, pxPerN, reference } = L;
    backdrop(ctx, width, height, camera, { grid: true, labels: true });
    const A = onSurface(L.s0);
    const B = onSurface(L.s1);
    surfaceBand(
      ctx,
      camera,
      { x: L.s0 * Math.cos(alpha), y: L.s0 * Math.sin(alpha) },
      { x: L.s1 * Math.cos(alpha), y: L.s1 * Math.sin(alpha) },
      skin.surface?.material ?? "wood",
      Math.max(0.05, (L.s1 - L.s0) * 0.12),
    );
    if (params.incline > 0.5) {
      const flat = camera.sx(L.s1 * Math.cos(alpha));
      ctx.save();
      ctx.strokeStyle = LAB.faint;
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(A.x, A.y);
      ctx.lineTo(flat, A.y);
      ctx.stroke();
      ctx.restore();
      pill(ctx, A.x + 70, A.y + 16, `${params.incline.toFixed(0)}° slope`, { size: 11, color: LAB.muted });
    }
    const { w, h } = dims(skin.body.shape, size);
    const centerAt = (x: number) => {
      const p = onSurface(x);
      return { x: p.x + normal.x * (h / 2), y: p.y + normal.y * (h / 2) };
    };
    // Start marker and ruler.
    const start = onSurface(0);
    ctx.save();
    ctx.strokeStyle = LAB.muted;
    ctx.lineWidth = 1.5;
    ctx.setLineDash([3, 4]);
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(start.x + normal.x * (h + 26), start.y + normal.y * (h + 26));
    ctx.stroke();
    ctx.restore();
    pill(ctx, start.x + normal.x * (h + 34), start.y + normal.y * (h + 34), "start", { align: "center", size: 10, color: LAB.muted });
    if (ghost) {
      const gs = ghost.state as SurfaceState;
      const g = centerAt(gs.x);
      body(ctx, skin.body.shape, g.x, g.y, w, h, skin.body.color, { ghost: true, angle: -alpha });
    }
    const here = onSurface(s.x);
    if (Math.abs(s.x) > 1e-4) {
      const off = 26;
      dimension(ctx, start.x - normal.x * off, start.y - normal.y * off, here.x - normal.x * off, here.y - normal.y * off, `moved ${formatQuantity(Math.abs(s.x), "m", 3)}`, LAB.hot);
    }
    const c = centerAt(s.x);
    // The pusher, fading after release.
    const pushDir = { x: Math.cos(alpha + params.forceAngle * DEG), y: -Math.sin(alpha + params.forceAngle * DEG) };
    const pushLen = Math.max(18, Math.min(170, params.force * pxPerN));
    if (params.force > 0 && params.pushTime > 0) {
      const fade = s.pushing ? 1 : Math.max(0, 1 - (t - params.pushTime) * 2.5);
      if (fade > 0) {
        const hx = c.x - pushDir.x * (w / 2 + 22);
        const hy = c.y - pushDir.y * (w / 2 + 22);
        ctx.save();
        ctx.globalAlpha = 0.9 * fade;
        ctx.translate(hx, hy);
        ctx.rotate(Math.atan2(pushDir.y, pushDir.x));
        ctx.beginPath();
        roundRect(ctx, -34, -15, 34, 30, 12);
        ctx.fillStyle = "#e9b894";
        ctx.fill();
        ctx.fillStyle = "#d59f78";
        for (let i = 0; i < 4; i++) {
          ctx.beginPath();
          roundRect(ctx, -6, -14 + i * 7.3, 14, 6, 3);
          ctx.fill();
        }
        ctx.restore();
        reserve({ left: hx - pushDir.x * 17 - 24, top: hy - pushDir.y * 17 - 24, width: 48, height: 48 });
        if (s.pushing) pill(ctx, hx - pushDir.x * 30, hy - pushDir.y * 30 - 26, skin.agent ?? "push", { align: "center", size: 10, color: LAB.muted });
      }
    }
    body(ctx, skin.body.shape, c.x, c.y, w, h, skin.body.color, { angle: -alpha });

    if (showVectors) {
      const contact = { x: c.x - normal.x * (h / 2), y: c.y - normal.y * (h / 2) };
      const len = (value: number) => arrowLength(value, reference, 78, 14);
      if (s.pushing && s.applied !== 0) {
        const l = pushLen;
        vector(ctx, c.x - pushDir.x * (w / 2 + l), c.y - pushDir.y * (w / 2 + l), pushDir.x * l, pushDir.y * l, "force", "F_push");
      }
      const weight = params.mass * params.gravity;
      vector(ctx, c.x, c.y, 0, len(weight), "weight", "mg");
      if (s.normal > 1e-6) vector(ctx, contact.x + tangent.x * w * 0.18, contact.y + tangent.y * w * 0.18, normal.x * len(s.normal), normal.y * len(s.normal), "normal", "F_N");
      if (Math.abs(s.friction) > 1e-6) {
        const sign = Math.sign(s.friction);
        vector(ctx, contact.x - tangent.x * w * 0.18, contact.y - tangent.y * w * 0.18, tangent.x * sign * len(Math.abs(s.friction)), tangent.y * sign * len(Math.abs(s.friction)), "friction", s.moving ? "f_k" : "f_s");
      }
      if (Math.abs(s.net) > 1e-4 && s.moving) {
        const sign = Math.sign(s.net);
        vector(ctx, c.x + normal.x * (h / 2 + 30), c.y + normal.y * (h / 2 + 30), tangent.x * sign * len(Math.abs(s.net)), tangent.y * sign * len(Math.abs(s.net)), "acceleration", "F_net", { dashed: true, width: 2.6 });
      }
      const top = extent(sim).speed;
      if (Math.abs(s.v) > 0.002 && top > 0) {
        const l = 30 + 70 * (Math.abs(s.v) / top);
        const sign = Math.sign(s.v);
        vector(ctx, c.x + normal.x * (h / 2 + 62), c.y + normal.y * (h / 2 + 62), tangent.x * sign * l, tangent.y * sign * l, "velocity", "v");
      }
    }

    // Friction status meter.
    const limit = params.muS * s.normal;
    if (s.moving) meter(ctx, width - 250, 34, 220, 1, QUANTITY_COLORS.friction, "sliding", `f_k = μk·N = ${formatQuantity(params.muK * s.normal, "N", 2)}`);
    else meter(ctx, width - 250, 34, 220, s.grip, s.grip > 0.9 ? LAB.hot : LAB.good, "static friction in use", `${formatQuantity(Math.abs(s.friction), "N", 2)} of ${formatQuantity(limit, "N", 2)}`);

    const stop = sim.metrics.stopTime;
    if (sim.metrics.startsMoving && stop !== null && stop > 0 && t >= stop)
      pill(ctx, c.x + normal.x * (h / 2 + 96), c.y + normal.y * (h / 2 + 96), `stops after ${formatQuantity(sim.metrics.distance, "m", 3)}`, { align: "center", color: LAB.hot, border: `${LAB.hot}66` });
    else if (!sim.metrics.startsMoving && t > 0.05)
      pill(ctx, c.x + normal.x * (h / 2 + 96), c.y + normal.y * (h / 2 + 96), "static friction holds it", { align: "center", color: LAB.good, border: `${LAB.good}66` });

    if (params.force > 0 && t < 0.04) {
      const tail = { x: c.x - pushDir.x * (w / 2 + pushLen), y: c.y - pushDir.y * (w / 2 + pushLen) };
      handleRing(ctx, tail.x, tail.y, 11, state(scene, "force"), QUANTITY_COLORS.force);
    }
    handleRing(ctx, B.x, B.y, 10, state(scene, "incline"), LAB.muted);
  },
  handles(scene) {
    const L = layout(scene);
    const { params } = scene;
    const { size, alpha, normal, onSurface, pxPerN } = L;
    const { w, h } = dims(scene.skin.body.shape, size);
    const p = onSurface(scene.state.x);
    const c = { x: p.x + normal.x * (h / 2), y: p.y + normal.y * (h / 2) };
    const pushDir = { x: Math.cos(alpha + params.forceAngle * DEG), y: -Math.sin(alpha + params.forceAngle * DEG) };
    const pushLen = Math.max(18, Math.min(170, params.force * pxPerN));
    const A = onSurface(L.s0);
    const B = onSurface(L.s1);
    const handles: LabHandle[] = [
      {
        id: "incline",
        x: B.x,
        y: B.y,
        r: 14,
        label: "Drag up or down to tilt the surface",
        cursor: "ns-resize",
        drag: (px, py) => ({ incline: Math.max(0, Math.min(60, (Math.atan2(A.y - py, Math.max(20, px - A.x)) * 180) / Math.PI)) }),
      },
    ];
    if (scene.t < 0.04)
      handles.push({
        id: "force",
        x: c.x - pushDir.x * (w / 2 + pushLen),
        y: c.y - pushDir.y * (w / 2 + pushLen),
        r: 16,
        label: "Drag the arrow's tail to change the push force",
        cursor: "ew-resize",
        drag: (px, py) => {
          const baseX = c.x - pushDir.x * (w / 2);
          const baseY = c.y - pushDir.y * (w / 2);
          const along = (baseX - px) * pushDir.x + (baseY - py) * pushDir.y;
          return { force: Math.max(0, along / pxPerN) };
        },
      });
    return handles;
  },
};
