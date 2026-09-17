import type { Simulation } from "../../../../shared/studio/engines";
import type { ProjectileState } from "../../../../shared/studio/engines/projectile";
import {
  Camera,
  LAB,
  QUANTITY_COLORS,
  arcArrow,
  arrowLength,
  backdrop,
  body,
  cachedBox,
  dimension,
  formatQuantity,
  handleRing,
  pill,
  surfaceBand,
  trail,
  unionBox,
  vector,
  type WorldBox,
} from "../draw";
import type { EngineView, LabHandle, LabScene } from "../types";

type Sim = Simulation<ProjectileState>;

function runBox(sim: Sim): WorldBox {
  return cachedBox(sim, () => {
    let x0 = 0;
    let x1 = 0;
    let y1 = 0;
    for (let i = 0; i <= 160; i++) {
      const s = sim.sample((sim.duration * i) / 160);
      x0 = Math.min(x0, s.x);
      x1 = Math.max(x1, s.x);
      y1 = Math.max(y1, s.y);
    }
    return { x0, x1, y0: 0, y1 };
  });
}

const topSpeeds = new WeakMap<Sim, number>();
function topSpeed(sim: Sim) {
  let value = topSpeeds.get(sim);
  if (value === undefined) {
    value = 0;
    for (let i = 0; i <= 120; i++)
      value = Math.max(value, sim.sample((sim.duration * i) / 120).speed);
    topSpeeds.set(sim, value);
  }
  return value;
}

/** Camera and arrow scale stay fixed while a handle is dragged, so the drag never feeds back on itself. */
let frozen: { box: WorldBox; pxPerMs: number } | null = null;

function layout(scene: LabScene<ProjectileState>) {
  const { sim, ghost, params, width, height } = scene;
  const run = unionBox(runBox(sim), ghost ? runBox(ghost.sim as Sim) : null);
  const w = Math.max(3, run.x1 - run.x0);
  const h = Math.max(2, run.y1 - run.y0);
  const box = {
    x0: run.x0 - Math.max(0.7, w * 0.08),
    x1: run.x1 + Math.max(0.7, w * 0.1),
    y0: -Math.max(0.3, h * 0.08),
    y1: Math.max(run.y1, params.height) + Math.max(0.5, h * 0.2),
  };
  const pxPerMs = Math.max(2.5, Math.min(14, 110 / Math.max(4, topSpeed(sim))));
  if (scene.active) frozen ??= { box, pxPerMs };
  else frozen = null;
  const use = frozen ?? { box, pxPerMs };
  const camera = new Camera(width, height, use.box, { left: 50, right: 44, top: 64, bottom: 40 });
  const size = Math.max(16, Math.min(64, camera.s(params.radius * 2)));
  // Positions are the object's center; lift drawings so a resting object sits on the ground.
  const lift = size / 2;
  const at = (x: number, y: number) => ({ x: camera.sx(x), y: camera.sy(y) - lift });
  return { camera, pxPerMs: use.pxPerMs, size, lift, at };
}

function path(sim: Sim, at: (x: number, y: number) => { x: number; y: number }, until: number) {
  const end = Math.min(until, sim.duration);
  const steps = Math.max(2, Math.ceil(end * 90));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const s = sim.sample((end * i) / steps);
    points.push(at(s.x, s.y));
  }
  return points;
}

function handleState(scene: LabScene, id: string) {
  return scene.active === id ? "active" : scene.hover === id ? "hover" : "idle";
}

export const projectileView: EngineView<ProjectileState> = {
  charts: ["y", "speed", "vy"],
  hud: ({ state, t }) => [
    { label: "time", value: formatQuantity(t, "s", 2) },
    { label: "speed", value: formatQuantity(state.speed, "m/s", 2), color: QUANTITY_COLORS.velocity },
    { label: "height", value: formatQuantity(Math.max(0, state.y), "m", 2) },
    { label: "across", value: formatQuantity(state.x, "m", 2) },
  ],
  draw(scene) {
    const { ctx, width, height, sim, state, params, ghost, skin, t, showVectors } = scene;
    const { camera, pxPerMs, size, lift, at } = layout(scene);
    backdrop(ctx, width, height, camera, { grid: true, labels: true });
    const view = camera.visible();
    surfaceBand(
      ctx,
      camera,
      { x: view.x0 - 1, y: 0 },
      { x: view.x1 + 1, y: 0 },
      skin.surface?.material ?? "wood",
      Math.max(0.3, (view.y1 - view.y0) * 0.25),
    );

    const release = at(0, params.height);
    const groundY = camera.sy(0);
    if (params.height > 0.02)
      dimension(ctx, release.x, groundY, release.x, release.y, `release height ${formatQuantity(params.height, "m", 2)}`, LAB.faint, -58);

    // Predicted path for these settings, and the previous run for comparison.
    trail(ctx, path(sim, at, sim.duration), LAB.hot, { dashed: true, alpha: 0.32, width: 2 });
    if (ghost) {
      const gsim = ghost.sim as Sim;
      const gs = ghost.state as ProjectileState;
      trail(ctx, path(gsim, at, gsim.duration), LAB.muted, { dashed: true, alpha: 0.55, width: 2 });
      const g = at(gs.x, gs.y);
      body(ctx, skin.body.shape, g.x, g.y, size, size, skin.body.color, { ghost: true });
      const current = at(state.x, state.y);
      if (Math.hypot(current.x - g.x, current.y - g.y) > 60)
        pill(ctx, g.x, g.y - size * 0.8, "previous run", { size: 10, color: LAB.muted, align: "center", baseline: "bottom" });
    }

    // Travelled path with strobe dots every 0.1 s.
    trail(ctx, path(sim, at, t), LAB.hot, { width: 3.5, dotEvery: 9 });

    const apexTime = sim.metrics.apexTime;
    if (sim.events.some((event) => event.id === "apex") && apexTime !== null && t >= apexTime) {
      const apex = sim.sample(apexTime);
      const p = at(apex.x, apex.y);
      ctx.save();
      ctx.strokeStyle = "rgba(255,255,255,0.3)";
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y + size / 2);
      ctx.lineTo(p.x, groundY);
      ctx.stroke();
      ctx.restore();
      pill(ctx, p.x, p.y - size / 2 - 10, `top · v_y = 0 · ${formatQuantity(apex.y, "m", 2)} high`, {
        align: "center",
        baseline: "bottom",
        size: 11,
      });
    }
    const landing = sim.events.find((event) => event.id === "landing");
    if (landing && t >= landing.t && sim.metrics.range !== null) {
      const p = at(sim.metrics.range, 0);
      ctx.save();
      ctx.strokeStyle = LAB.hot;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.ellipse(p.x, groundY, 18, 5, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      dimension(ctx, release.x, groundY + 20, p.x, groundY + 20, `lands ${formatQuantity(sim.metrics.range, "m", 2)} away`, LAB.hot);
    }

    const center = at(state.x, state.y);
    const spins = skin.body.shape === "ball" || skin.body.shape === "disc" || skin.body.shape === "plate";
    body(ctx, skin.body.shape, center.x, center.y, size, size, skin.body.color, {
      angle: spins ? state.x / Math.max(0.02, params.radius) : 0,
    });

    const atStart = t < 0.04;
    if (atStart && params.speed > 0.05)
      arcArrow(ctx, release.x, release.y, 46, 0, (-params.angle * Math.PI) / 180, "rgba(255,255,255,0.7)", `${Math.round(params.angle)}°`, 1.6);

    if (showVectors && (state.airborne || atStart)) {
      const speed = Math.hypot(state.vx, state.vy);
      if (speed > 0.05) {
        vector(ctx, center.x, center.y, state.vx * pxPerMs, -state.vy * pxPerMs, "velocity", "v");
        if (Math.abs(state.vx) > 0.2 && Math.abs(state.vy) > 0.2) {
          vector(ctx, center.x, center.y, state.vx * pxPerMs, 0, "velocity", "v_x", { dashed: true, width: 2, alpha: 0.5, glow: false });
          vector(ctx, center.x, center.y, 0, -state.vy * pxPerMs, "velocity", "v_y", { dashed: true, width: 2, alpha: 0.5, glow: false });
        }
      }
      vector(ctx, center.x, center.y + size * 0.1, 0, arrowLength(params.gravity, 9.81, 56), "weight", "mg");
      const dragAccel = Math.hypot(state.ax, state.ay + params.gravity);
      if (params.drag > 0 && speed > 0.05 && dragAccel > 0.05) {
        const len = arrowLength(dragAccel, params.gravity, 56, 12);
        vector(ctx, center.x, center.y, (-state.vx / speed) * len, (state.vy / speed) * len, "friction", "air drag", { width: 2.6 });
      }
    }

    if (atStart)
      handleRing(
        ctx,
        release.x + params.speed * Math.cos((params.angle * Math.PI) / 180) * pxPerMs,
        release.y - params.speed * Math.sin((params.angle * Math.PI) / 180) * pxPerMs,
        11,
        handleState(scene, "launch"),
        QUANTITY_COLORS.velocity,
      );
    handleRing(ctx, release.x - 34, release.y, 9, handleState(scene, "height"), LAB.muted);
  },
  handles(scene) {
    const { params } = scene;
    const { camera, pxPerMs, lift, at } = layout(scene);
    const release = at(0, params.height);
    const handles: LabHandle[] = [
      {
        id: "height",
        x: release.x - 34,
        y: release.y,
        r: 14,
        label: "Drag up or down to change the release height",
        cursor: "ns-resize",
        drag: (_px, py) => ({ height: Math.max(0, camera.wy(py + lift)) }),
      },
    ];
    if (scene.t < 0.04)
      handles.push({
        id: "launch",
        x: release.x + params.speed * Math.cos((params.angle * Math.PI) / 180) * pxPerMs,
        y: release.y - params.speed * Math.sin((params.angle * Math.PI) / 180) * pxPerMs,
        r: 16,
        label: "Drag the arrow tip to aim and set the launch speed",
        cursor: "grab",
        drag: (px, py) => {
          const dx = Math.max(0, px - release.x);
          const dy = release.y - py;
          return {
            speed: Math.hypot(dx, dy) / pxPerMs,
            angle: (Math.atan2(dy, dx) * 180) / Math.PI,
          };
        },
      });
    return handles;
  },
};
