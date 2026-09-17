import type { Simulation } from "../../../../shared/studio/engines";
import type { SpringState } from "../../../../shared/studio/engines/spring";
import {
  LAB,
  QUANTITY_COLORS,
  Camera,
  arrowLength,
  backdrop,
  body,
  coil,
  formatQuantity,
  handleRing,
  meter,
  pill,
  reserve,
  roundRect,
  vector,
} from "../draw";
import type { EngineView, LabHandle, LabScene } from "../types";

type Sim = Simulation<SpringState>;

const peaks = new WeakMap<Sim, { deformation: number; force: number; hand: number }>();
function peak(sim: Sim) {
  let value = peaks.get(sim);
  if (!value) {
    value = { deformation: 0, force: 0, hand: 0 };
    for (let i = 0; i <= 200; i++) {
      const s = sim.sample((sim.duration * i) / 200);
      value.deformation = Math.max(value.deformation, Math.abs(s.x));
      value.force = Math.max(value.force, Math.abs(s.force));
      value.hand = Math.max(value.hand, Math.abs(s.hand));
    }
    peaks.set(sim, value);
  }
  return value;
}

let frozen: { pxPerM: number; pxPerN: number } | null = null;

function layout(scene: LabScene<SpringState>) {
  const { sim, ghost, params, width, height } = scene;
  const a = peak(sim);
  const b = ghost ? peak(ghost.sim as Sim) : a;
  const reach = Math.max(a.deformation, b.deformation, params.elasticLimit, 1e-4);
  const pxPerM = (params.mode === 1 ? Math.min(190, width * 0.24) * 0.45 : Math.min(width * 0.2, 150)) / reach;
  const forceRef = Math.max(a.force, a.hand, b.force, b.hand, params.force, 1e-3);
  const pxPerN = 110 / forceRef;
  if (scene.active) frozen ??= { pxPerM, pxPerN };
  else frozen = null;
  return { ...(frozen ?? { pxPerM, pxPerN }), cy: height * 0.55, wallX: Math.max(90, width * 0.2) };
}

function inset(ctx: CanvasRenderingContext2D, scene: LabScene<SpringState>) {
  const { sim, state: s, params, width } = scene;
  const curve = sim.series.find((series) => series.key === "curve");
  if (!curve || curve.points.length < 2) return;
  const W = 210;
  const H = 128;
  const x0 = width - W - 18;
  const y0 = 18;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x0, y0, W, H, 12);
  ctx.fillStyle = LAB.panel;
  ctx.fill();
  ctx.strokeStyle = LAB.panelBorder;
  ctx.stroke();
  const xs = curve.points.map((p) => p[0]);
  const fs = curve.points.map((p) => p[1]);
  const xr = Math.max(...xs.map(Math.abs), params.elasticLimit * 1.2, 1e-4);
  const fr = Math.max(...fs.map(Math.abs), 1e-3);
  const px = (x: number) => x0 + W / 2 + (x / xr) * (W / 2 - 14);
  const py = (f: number) => y0 + H / 2 + 6 - (f / fr) * (H / 2 - 22);
  ctx.strokeStyle = "rgba(255,255,255,0.12)";
  ctx.beginPath();
  ctx.moveTo(x0 + 10, py(0));
  ctx.lineTo(x0 + W - 10, py(0));
  ctx.moveTo(px(0), y0 + 22);
  ctx.lineTo(px(0), y0 + H - 8);
  ctx.stroke();
  ctx.setLineDash([3, 3]);
  ctx.strokeStyle = "rgba(255,178,36,0.6)";
  for (const edge of [s.set - params.elasticLimit, s.set + params.elasticLimit]) {
    ctx.beginPath();
    ctx.moveTo(px(edge), y0 + 22);
    ctx.lineTo(px(edge), y0 + H - 8);
    ctx.stroke();
  }
  ctx.setLineDash([]);
  ctx.strokeStyle = "rgba(255,122,47,0.3)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  curve.points.forEach(([x, f], i) => (i ? ctx.lineTo(px(x), py(f)) : ctx.moveTo(px(x), py(f))));
  ctx.stroke();
  const shown = curve.points.filter((_, i) => (i / (curve.points.length - 1)) * sim.duration <= scene.t + 1e-6);
  ctx.strokeStyle = LAB.hot;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  shown.forEach(([x, f], i) => (i ? ctx.lineTo(px(x), py(f)) : ctx.moveTo(px(x), py(f))));
  ctx.stroke();
  ctx.fillStyle = "#fff";
  ctx.beginPath();
  ctx.arc(px(s.x), py(-s.force), 4.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.font = `600 10px ${LAB.mono}`;
  ctx.fillStyle = LAB.muted;
  ctx.textBaseline = "top";
  ctx.fillText("force vs deformation", x0 + 10, y0 + 8);
  ctx.fillStyle = "rgba(255,178,36,0.8)";
  ctx.textAlign = "right";
  ctx.fillText("elastic limit", x0 + W - 10, y0 + H - 18);
  ctx.restore();
}

function crumple(ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, amount: number) {
  if (amount <= 0) return;
  ctx.save();
  ctx.strokeStyle = `rgba(20,30,50,${Math.min(0.7, 0.25 + amount)})`;
  ctx.lineWidth = 1.6;
  const lines = 2 + Math.round(amount * 5);
  for (let i = 0; i < lines; i++) {
    const y = cy - h * 0.35 + (h * 0.7 * (i + 0.5)) / lines;
    ctx.beginPath();
    for (let k = 0; k <= 6; k++) {
      const x = cx - w * 0.4 + (w * 0.8 * k) / 6;
      const yy = y + (k % 2 ? -1 : 1) * (3 + amount * 6);
      k ? ctx.lineTo(x, yy) : ctx.moveTo(x, yy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function hs(scene: LabScene, id: string) {
  return scene.active === id ? "active" : scene.hover === id ? "hover" : "idle";
}

export const springView: EngineView<SpringState> = {
  charts: ["x", "force", "curve"],
  hud: ({ t, state: s }) => [
    { label: "time", value: formatQuantity(t, "s", 2) },
    { label: "deformation", value: formatQuantity(s.x * 100, "cm", 2) },
    { label: "force", value: formatQuantity(Math.abs(s.force), "N", 1), color: QUANTITY_COLORS.tension },
    { label: "permanent", value: formatQuantity(Math.abs(s.set) * 100, "cm", 2) },
  ],
  draw(scene) {
    const { ctx, width, height, params, ghost, skin, showVectors } = scene;
    const s = scene.state;
    const L = layout(scene);
    backdrop(ctx, width, height, new Camera(width, height, { x0: 0, x1: 4, y0: 0, y1: 2.5 }), { grid: true });
    const wallX = L.wallX;
    ctx.save();
    const wallGrad = ctx.createLinearGradient(wallX - 26, 0, wallX, 0);
    wallGrad.addColorStop(0, "#1d2d4b");
    wallGrad.addColorStop(1, "#33466a");
    ctx.fillStyle = wallGrad;
    ctx.fillRect(wallX - 26, L.cy - 130, 26, 260);
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    for (let y = L.cy - 124; y < L.cy + 130; y += 14) {
      ctx.beginPath();
      ctx.moveTo(wallX - 26, y + 10);
      ctx.lineTo(wallX - 16, y);
      ctx.stroke();
    }
    ctx.restore();
    const limitShare = Math.abs(s.x - s.set) / params.elasticLimit;

    if (params.mode === 1) {
      const W0 = Math.min(190, width * 0.24);
      const H0 = skin.body.shape === "can" || skin.body.shape === "bottle" || skin.body.shape === "cup" ? W0 * 1.35 : W0 * 0.9;
      const shape = (x: number) => {
        const dx = Math.max(-W0 * 0.7, Math.min(W0 * 1.2, x * L.pxPerM));
        const w = W0 + dx;
        const h = H0 * (1 - (0.22 * dx) / W0);
        return { w, h, cx: wallX + w / 2 + 2 };
      };
      if (ghost) {
        const g = shape((ghost.state as SpringState).x);
        body(ctx, skin.body.shape, g.cx, L.cy, g.w, g.h, skin.body.color, { ghost: true });
      }
      const now = shape(s.x);
      body(ctx, skin.body.shape, now.cx, L.cy, now.w, now.h, skin.body.color);
      crumple(ctx, now.cx, L.cy, now.w, now.h, Math.min(1, Math.abs(s.set) / Math.max(params.elasticLimit, 1e-6) / 3));
      const right = wallX + now.w + 2;
      const handActive = Math.abs(s.hand) > 1e-6;
      ctx.save();
      ctx.globalAlpha = handActive ? 1 : 0.35;
      ctx.translate(right + 26, L.cy);
      ctx.beginPath();
      roundRect(ctx, 0, -26, 46, 52, 18);
      ctx.fillStyle = "#e9b894";
      ctx.fill();
      ctx.fillStyle = "#d59f78";
      for (let i = 0; i < 4; i++) {
        ctx.beginPath();
        roundRect(ctx, -10, -24 + i * 12.5, 18, 10, 5);
        ctx.fill();
      }
      ctx.restore();
      reserve({ left: right + 12, top: L.cy - 30, width: 64, height: 60 });
      pill(ctx, right + 50, L.cy + 44, skin.agent ?? "hand", { align: "center", size: 10, color: LAB.muted });
      if (showVectors) {
        if (handActive) {
          const len = Math.max(16, Math.abs(s.hand) * L.pxPerN);
          const dir = Math.sign(s.hand);
          vector(ctx, right + (dir < 0 ? len + 2 : 2), L.cy - 52, dir * len, 0, "force", "F_hand");
        }
        if (Math.abs(s.force) > 1e-6) {
          const len = Math.max(16, Math.abs(s.force) * L.pxPerN);
          vector(ctx, right, L.cy + 58, Math.sign(s.force) * len, 0, "tension", "F_elastic");
          vector(ctx, wallX + 2, L.cy + 58, -Math.sign(s.force) * Math.min(len, 60), 0, "normal", "F_wall", { alpha: 0.7 });
        }
      }
      const label = s.x < -1e-5 ? `squeezed ${formatQuantity(-s.x * 100, "cm", 2)}` : s.x > 1e-5 ? `stretched ${formatQuantity(s.x * 100, "cm", 2)}` : "original shape";
      pill(ctx, now.cx, L.cy - now.h / 2 - 22, label, { align: "center" });
      if (Math.abs(s.set) > 1e-5)
        pill(ctx, now.cx, L.cy - now.h / 2 - 50, `permanent ${s.set < 0 ? "dent" : "stretch"} ${formatQuantity(Math.abs(s.set) * 100, "cm", 2)}`, { align: "center", color: LAB.bad, border: `${LAB.bad}66` });
      if (scene.t < 0.04 || scene.active === "force") {
        const len = Math.max(16, params.force * L.pxPerN);
        const tipX = right + 26 + 46 + len;
        handleRing(ctx, tipX, L.cy - 52, 11, hs(scene, "force"), QUANTITY_COLORS.force);
      }
    } else {
      const rest = wallX + Math.min(260, width * 0.3);
      const blockW = 66;
      const blockH = 66;
      const at = (x: number) => rest + x * L.pxPerM;
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.setLineDash([4, 5]);
      ctx.beginPath();
      ctx.moveTo(at(s.set), L.cy - 90);
      ctx.lineTo(at(s.set), L.cy + 90);
      ctx.stroke();
      ctx.restore();
      pill(ctx, at(s.set), L.cy - 100, "rest position", { align: "center", size: 10, color: LAB.muted });
      ctx.fillStyle = "rgba(255,255,255,0.08)";
      ctx.fillRect(wallX, L.cy + blockH / 2, width - wallX - 20, 3);
      if (ghost) {
        const gx = at((ghost.state as SpringState).x);
        body(ctx, skin.body.shape, gx + blockW / 2, L.cy, blockW, blockH, skin.body.color, { ghost: true });
      }
      const bx = at(s.x);
      coil(ctx, wallX, L.cy, bx, L.cy, 12, 14, "#c9d4ea", 2.5);
      body(ctx, skin.body.shape, bx + blockW / 2, L.cy, blockW, blockH, skin.body.color);
      if (showVectors) {
        if (Math.abs(s.x - s.set) > 1e-5) vector(ctx, at(s.set), L.cy + 70, (s.x - s.set) * L.pxPerM, 0, "displacement", "x", { width: 2.4 });
        if (Math.abs(s.force) > 1e-6) vector(ctx, bx + blockW / 2, L.cy - 52, Math.sign(s.force) * Math.max(16, Math.abs(s.force) * L.pxPerN), 0, "tension", "F_spring");
        if (Math.abs(s.v) > 1e-3) vector(ctx, bx + blockW / 2, L.cy - 90, Math.sign(s.v) * arrowLength(Math.abs(s.v), peak(scene.sim).deformation * Math.sqrt(params.stiffness / params.mass), 70, 12), 0, "velocity", "v");
      }
      if (scene.t < 0.04 || scene.active === "mass")
        handleRing(ctx, bx + blockW / 2, L.cy, 16, hs(scene, "mass"), LAB.hot);
    }

    meter(ctx, 24, height - 34, 230, limitShare, limitShare >= 0.999 ? LAB.bad : limitShare > 0.7 ? LAB.hot : LAB.good, "toward the elastic limit", `${Math.round(Math.min(1, limitShare) * 100)}%`);
    pill(ctx, 280, height - 38, `stored ½·k·x² = ${formatQuantity(s.energy, "J", 3)}`, { size: 11, color: LAB.muted });
    inset(ctx, scene);
  },
  handles(scene) {
    const L = layout(scene);
    const { params, skin, width } = scene;
    const s = scene.state;
    const handles: LabHandle[] = [];
    if (params.mode === 1) {
      if (scene.t >= 0.04 && scene.active !== "force") return handles;
      const W0 = Math.min(190, width * 0.24);
      void skin;
      const dx = Math.max(-W0 * 0.7, Math.min(W0 * 1.2, s.x * L.pxPerM));
      const right = L.wallX + W0 + dx + 2;
      const base = right + 26 + 46;
      handles.push({
        id: "force",
        x: base + Math.max(16, params.force * L.pxPerN),
        y: L.cy - 52,
        r: 16,
        label: "Drag to change how hard the hand presses",
        cursor: "ew-resize",
        drag: (px) => ({ force: Math.max(0, (px - base) / L.pxPerN) }),
      });
    } else if (scene.t < 0.04 || scene.active === "mass") {
      const rest = L.wallX + Math.min(260, width * 0.3);
      handles.push({
        id: "mass",
        x: rest + s.x * L.pxPerM + 33,
        y: L.cy,
        r: 26,
        label: "Drag the mass to stretch or squeeze the spring",
        cursor: "ew-resize",
        drag: (px) => ({ displacement: (px - 33 - rest) / L.pxPerM }),
      });
    }
    return handles;
  },
};
