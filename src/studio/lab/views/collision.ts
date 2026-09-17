import type { Params, Simulation } from "../../../../shared/studio/engines";
import { bodyWidth, type CollisionState } from "../../../../shared/studio/engines/collision";
import type { Lab, Shape } from "../../../../shared/studio/schema";
import {
  Camera,
  LAB,
  QUANTITY_COLORS,
  backdrop,
  body,
  cachedBox,
  formatNumber,
  formatQuantity,
  handleRing,
  measureRich,
  pill,
  richText,
  roundRect,
  surfaceBand,
  unionBox,
  vector,
  type WorldBox,
} from "../draw";
import type { EngineView, LabHandle, LabScene } from "../types";

type Sim = Simulation<CollisionState>;
type Skin = Lab["skin"];

const FLASH = 0.25;
const P1_COLOR = QUANTITY_COLORS.momentum;
const P2_COLOR = "#6f7cf2";
const DEFAULT_OTHER = { name: "body 2", shape: "box" as Shape, color: "#3fb6a8" };

/** Drawn height relative to width, per shape. */
function aspect(shape: Shape) {
  switch (shape) {
    case "can":
      return 1.5;
    case "bottle":
      return 1.9;
    case "cup":
      return 1.1;
    case "person":
      return 2.2;
    case "door":
      return 1.9;
    case "bar":
      return 0.4;
    case "book":
    case "phone":
      return 0.6;
    case "boat":
      return 0.5;
    case "box":
    case "block":
      return 0.85;
    default:
      return 1;
  }
}

/** Extent of both bodies over the whole run, in meters. */
function runBox(sim: Sim, params: Params): WorldBox {
  return cachedBox(sim, () => {
    const w1 = bodyWidth(params.mass1);
    const w2 = bodyWidth(params.mass2);
    let x0 = Infinity;
    let x1 = -Infinity;
    for (let i = 0; i <= 160; i++) {
      const s = sim.sample((sim.duration * i) / 160);
      x0 = Math.min(x0, s.x1 - w1 / 2, s.x2 - w2 / 2);
      x1 = Math.max(x1, s.x1 + w1 / 2, s.x2 + w2 / 2);
    }
    return { x0, x1, y0: 0, y1: Math.max(w1, w2) };
  });
}

function speeds(params: Params, sim: Sim) {
  const m = sim.metrics;
  return {
    top: Math.max(1, Math.abs(params.speed1), Math.abs(params.speed2), Math.abs(m.v1After ?? 0), Math.abs(m.v2After ?? 0)),
    right2: Math.max(0, params.speed2, m.v2After ?? 0),
    left1: Math.max(0, -params.speed1, -(m.v1After ?? 0)),
  };
}

/** Camera, arrow scale and handle anchors stay fixed while a handle is dragged. */
let frozen: { camera: Camera; pxPerMs: number; ground: number; base: Record<string, number> } | null = null;

function sizes(camera: Camera, params: Params, skin: Skin, height: number) {
  const other = skin.other ?? DEFAULT_OTHER;
  const w1 = bodyWidth(params.mass1);
  const w2 = bodyWidth(params.mass2);
  // Uniform boost keeps the mass ratio visible while small bodies stay readable.
  const boost = Math.max(1, 24 / Math.max(1e-6, camera.s(Math.min(w1, w2))));
  const one = (w: number, shape: Shape) => {
    const a = aspect(shape);
    const s = Math.min(camera.s(w) * boost, 130, (height * 0.3) / a);
    return { w: s, h: s * a };
  };
  return { b1: one(w1, skin.body.shape), b2: one(w2, other.shape), w1, w2, other };
}

function layout(scene: LabScene<CollisionState>) {
  const { sim, ghost, params, width, height, skin } = scene;
  const ground = Math.round(height * 0.72);
  const run = unionBox(
    runBox(sim, params),
    ghost ? runBox(ghost.sim as Sim, ghost.params) : null,
  );
  const span = Math.max(2, run.x1 - run.x0);
  const x0 = run.x0 - span * 0.05;
  const x1 = run.x1 + span * 0.05;
  const sp = speeds(params, sim);
  const pxPerMs = Math.max(2, Math.min(36, 96 / sp.top));

  const build = (left: number, right: number) => {
    const scale = Math.max(1e-6, (width - left - right) / (x1 - x0));
    return new Camera(width, height, { x0, x1, y0: -(height - ground) / scale, y1: ground / scale }, { left, right, top: 0, bottom: 0 });
  };
  const rough = build(70, 70);
  const z = sizes(rough, params, skin, height);
  const maxPad = width * 0.24;
  const left = Math.min(maxPad, 30 + (z.b1.w - rough.s(z.w1)) + Math.max(0, sp.left1 * pxPerMs - z.b1.w / 2));
  const right = Math.min(maxPad, 30 + (z.b2.w - rough.s(z.w2)) + Math.max(0, sp.right2 * pxPerMs - z.b2.w / 2));
  const fresh = { camera: build(Math.max(40, left), Math.max(40, right)), pxPerMs, ground };

  if (!scene.active) frozen = null;
  const use = frozen ?? fresh;
  const { b1, b2, w1, w2, other } = sizes(use.camera, params, skin, height);
  const cam = use.camera;
  // Positions are centers; anchor the drawn edges to the contact faces so the bodies touch exactly at contact.
  const centers = (s: CollisionState, a = w1, b = w2, s1 = b1.w, s2 = b2.w) => ({
    c1: cam.sx(s.x1 + a / 2) - s1 / 2,
    c2: cam.sx(s.x2 - b / 2) + s2 / 2,
  });
  const start = centers(sim.sample(0));
  const view = { camera: cam, pxPerMs: use.pxPerMs, ground: use.ground, b1, b2, w1, w2, other, centers, start };
  if (scene.active && !frozen)
    frozen = { ...fresh, base: { v1: start.c1, v2: start.c2 } };
  return view;
}

function arrowY(ground: number, h: number) {
  return ground - h - 26;
}

function handleState(scene: LabScene, id: string) {
  return scene.active === id ? "active" : scene.hover === id ? "hover" : "idle";
}

function speedLabel(index: 1 | 2, v: number) {
  return `v_${index} = ${formatQuantity(v, "m/s", Math.abs(v) >= 100 ? 0 : 1)}`;
}

function drawVelocity(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  v: number,
  pxPerMs: number,
  index: 1 | 2,
) {
  const len = v * pxPerMs;
  if (Math.abs(v) < 0.05) {
    pill(ctx, x, y, `v_${index} = 0 · at rest`, { align: "center", size: 11, color: QUANTITY_COLORS.velocity, border: `${QUANTITY_COLORS.velocity}44` });
    return;
  }
  vector(ctx, x, y, len, 0, "velocity");
  pill(ctx, x + len / 2, y - 10, speedLabel(index, v), {
    align: "center",
    baseline: "bottom",
    size: 11,
    weight: 700,
    color: QUANTITY_COLORS.velocity,
    border: `${QUANTITY_COLORS.velocity}55`,
  });
}

function flash(ctx: CanvasRenderingContext2D, x: number, y: number, age: number) {
  const k = 1 - age / FLASH;
  ctx.save();
  const r = 26 + 46 * (1 - k);
  const glow = ctx.createRadialGradient(x, y, 0, x, y, r);
  glow.addColorStop(0, `rgba(255, 244, 214, ${0.95 * k})`);
  glow.addColorStop(0.35, `rgba(255, 170, 80, ${0.55 * k})`);
  glow.addColorStop(1, "rgba(255, 122, 47, 0)");
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = `rgba(255, 214, 150, ${k})`;
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.3;
    const r0 = 14 + 34 * (1 - k);
    const r1 = r0 + 6 + 14 * k;
    ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
    ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
  }
  ctx.stroke();
  ctx.restore();
}

/** Signed stacked bar: positives stack right of zero, negatives left. */
function stackedBar(
  ctx: CanvasRenderingContext2D,
  zero: number,
  y: number,
  half: number,
  scale: number,
  p1: number,
  p2: number,
) {
  let pos = 0;
  let neg = 0;
  for (const [p, color] of [
    [p1, P1_COLOR],
    [p2, P2_COLOR],
  ] as const) {
    if (Math.abs(p) * scale < 0.5) continue;
    const from = p >= 0 ? pos : neg;
    const len = Math.max(2, Math.min(half, Math.abs(p) * scale));
    const x = p >= 0 ? zero + from : zero - from - len;
    ctx.beginPath();
    roundRect(ctx, x, y - 5, len, 10, 2);
    ctx.fillStyle = color;
    ctx.fill();
    if (p >= 0) pos += len;
    else neg += len;
  }
  const total = p1 + p2;
  const tx = zero + Math.max(-half, Math.min(half, total * scale));
  ctx.strokeStyle = LAB.text;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tx, y - 9);
  ctx.lineTo(tx, y + 9);
  ctx.stroke();
}

function momentumPanel(scene: LabScene<CollisionState>) {
  const { ctx, width, params, sim, t } = scene;
  const m = sim.metrics;
  const collides = (m.collides ?? 0) >= 0.5;
  const contact = sim.events.find((event) => event.id === "contact");
  const hit = collides && contact !== undefined && t >= contact.t;
  const before = [params.mass1 * params.speed1, params.mass2 * params.speed2];
  const after = collides
    ? [params.mass1 * (m.v1After ?? 0), params.mass2 * (m.v2After ?? 0)]
    : before;
  const showAfter = hit || (!collides && t > 0);
  const extent = (p: number[]) =>
    Math.max(p.filter((v) => v > 0).reduce((a, b) => a + b, 0), -p.filter((v) => v < 0).reduce((a, b) => a + b, 0));
  const maxP = Math.max(1e-6, extent(before), extent(after));

  const W = Math.min(300, width * 0.46);
  const H = 112;
  const x = width - W - 14;
  const y = 12;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, x, y, W, H, 12);
  ctx.fillStyle = LAB.panel;
  ctx.fill();
  ctx.strokeStyle = LAB.panelBorder;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.font = `700 10px ${LAB.sans}`;
  ctx.fillStyle = LAB.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText("MOMENTUM  p = mv", x + 12, y + 16);
  // Legend.
  let lx = x + W - 12;
  for (const [label, color] of [
    ["p_2", P2_COLOR],
    ["p_1", P1_COLOR],
  ] as const) {
    lx -= measureRich(ctx, label, 11, 700);
    richText(ctx, lx, y + 16, label, 11, color, 700);
    lx -= 13;
    ctx.fillStyle = color;
    ctx.fillRect(lx, y + 12, 9, 9);
    lx -= 10;
  }

  const labelW = 44;
  const totalW = 64;
  const barX0 = x + 12 + labelW;
  const barX1 = x + W - 12 - totalW;
  const zero = (barX0 + barX1) / 2;
  const half = (barX1 - barX0) / 2;
  const scale = half / maxP;
  const rows: Array<[string, number, number[] | null]> = [
    ["before", y + 42, before],
    ["after", y + 66, showAfter ? after : null],
  ];
  ctx.strokeStyle = "rgba(255,255,255,0.28)";
  ctx.setLineDash([2, 3]);
  ctx.beginPath();
  ctx.moveTo(zero + 0.5, y + 30);
  ctx.lineTo(zero + 0.5, y + 78);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const [label, ry, p] of rows) {
    ctx.font = `600 11px ${LAB.sans}`;
    ctx.fillStyle = LAB.muted;
    ctx.textAlign = "left";
    ctx.fillText(label, x + 12, ry);
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(barX0, ry - 5, barX1 - barX0, 10);
    ctx.textAlign = "right";
    ctx.font = `600 11px ${LAB.mono}`;
    if (p) {
      stackedBar(ctx, zero, ry, half, scale, p[0], p[1]);
      ctx.fillStyle = LAB.text;
      ctx.fillText(`Σ ${formatNumber(p[0] + p[1], 2)}`, x + W - 12, ry);
    } else {
      ctx.fillStyle = LAB.faint;
      ctx.font = `italic 500 10px ${LAB.sans}`;
      ctx.textAlign = "center";
      ctx.fillText("after the hit…", zero, ry);
      ctx.textAlign = "right";
      ctx.font = `600 11px ${LAB.mono}`;
      ctx.fillText("Σ ?", x + W - 12, ry);
    }
  }

  ctx.font = `600 11px ${LAB.sans}`;
  ctx.textAlign = "left";
  const footY = y + 96;
  if (!collides) {
    ctx.fillStyle = LAB.muted;
    ctx.fillText("no hit · each keeps its momentum", x + 12, footY);
  } else if (hit) {
    ctx.fillStyle = LAB.good;
    ctx.fillText("total unchanged", x + 12, footY);
    ctx.textAlign = "right";
    ctx.fillStyle = LAB.hot;
    ctx.fillText(`energy lost ${formatQuantity(m.energyLost ?? 0, "%", 0)}`, x + W - 12, footY);
  } else {
    ctx.fillStyle = LAB.muted;
    ctx.fillText("kg·m/s · watch the total through the hit", x + 12, footY);
  }
  ctx.restore();
}

export const collisionView: EngineView<CollisionState> = {
  charts: ["v1", "v2", "force"],
  hud: ({ state, t, params }) => [
    { label: "time", value: formatQuantity(t, "s", 2) },
    { label: "v1", value: formatQuantity(state.v1, "m/s", 2), color: QUANTITY_COLORS.velocity },
    { label: "v2", value: formatQuantity(state.v2, "m/s", 2), color: QUANTITY_COLORS.velocity },
    {
      label: "total p",
      value: formatQuantity(params.mass1 * state.v1 + params.mass2 * state.v2, "kg·m/s", 2),
      color: QUANTITY_COLORS.momentum,
    },
  ],
  draw(scene) {
    const { ctx, width, height, sim, state, params, ghost, skin, t, showVectors } = scene;
    const L = layout(scene);
    const { camera, ground, pxPerMs, b1, b2, other } = L;
    backdrop(ctx, width, height, camera, { grid: true, labels: false });
    const view = camera.visible();
    surfaceBand(
      ctx,
      camera,
      { x: view.x0 - 1, y: 0 },
      { x: view.x1 + 1, y: 0 },
      skin.surface?.material ?? "wood",
      Math.max(0.3, -view.y0 + 0.2),
    );

    if (ghost) {
      const gp = ghost.params;
      const gs = ghost.state as CollisionState;
      const g = sizes(camera, gp, skin, height);
      const gc = L.centers(gs, g.w1, g.w2, g.b1.w, g.b2.w);
      body(ctx, skin.body.shape, gc.c1, ground - g.b1.h / 2, g.b1.w, g.b1.h, skin.body.color, { ghost: true });
      body(ctx, other.shape, gc.c2, ground - g.b2.h / 2, g.b2.w, g.b2.h, other.color, { ghost: true });
    }

    const { c1, c2 } = L.centers(state);
    body(ctx, skin.body.shape, c1, ground - b1.h / 2, b1.w, b1.h, skin.body.color);
    body(ctx, other.shape, c2, ground - b2.h / 2, b2.w, b2.h, other.color);

    // Name + mass under each body, kept apart when they touch.
    const n1 = `${skin.body.name} ${formatQuantity(params.mass1, "kg", params.mass1 < 1 ? 2 : 1)}`;
    const n2 = `${other.name} ${formatQuantity(params.mass2, "kg", params.mass2 < 1 ? 2 : 1)}`;
    const lw1 = measureRich(ctx, n1, 11) + 16;
    const lw2 = measureRich(ctx, n2, 11) + 16;
    const mid = (c1 + b1.w / 2 + c2 - b2.w / 2) / 2;
    pill(ctx, Math.min(c1, mid - lw1 / 2 - 4), ground + 16, n1, { align: "center", size: 11, color: LAB.text });
    pill(ctx, Math.max(c2, mid + lw2 / 2 + 4), ground + 16, n2, { align: "center", size: 11, color: LAB.text });

    const m = sim.metrics;
    const collides = (m.collides ?? 0) >= 0.5;
    const contact = sim.events.find((event) => event.id === "contact");
    const age = contact ? t - contact.t : -1;
    const impact = collides && age >= 0 && age <= FLASH;
    const contactX = c1 + b1.w / 2;
    const contactY = ground - Math.min(b1.h, b2.h) / 2;

    const atStart = t < 0.04;
    if (showVectors || atStart) {
      const y1 = arrowY(ground, b1.h);
      const y2 = arrowY(ground, b2.h);
      const x1 = scene.active === "v1" && frozen ? frozen.base.v1 : c1;
      const x2 = scene.active === "v2" && frozen ? frozen.base.v2 : c2;
      drawVelocity(ctx, x1, y1, state.v1, pxPerMs, 1);
      drawVelocity(ctx, x2, y2, state.v2, pxPerMs, 2);
      if (atStart) {
        handleRing(ctx, x1 + params.speed1 * pxPerMs, y1, 11, handleState(scene, "v1"), QUANTITY_COLORS.velocity);
        handleRing(ctx, x2 + params.speed2 * pxPerMs, y2, 11, handleState(scene, "v2"), QUANTITY_COLORS.velocity);
      }
    }

    if (impact) {
      flash(ctx, contactX, contactY, age);
      if (showVectors) {
        const dir = Math.sign(m.impulse ?? 1) || 1;
        const len = 72;
        vector(ctx, c2, ground - b2.h / 2, dir * len, 0, "force", "F_{on 2}");
        vector(ctx, c1, ground - b1.h / 2, -dir * len, 0, "force", "F_{on 1}");
      }
      const dt = params.contactTime;
      pill(
        ctx,
        contactX,
        ground + 50,
        `peak ${formatQuantity(m.peakForce ?? 0, "N", 0)} · lasts ${formatQuantity(dt, "s", dt < 0.01 ? 3 : 2)}`,
        { align: "center", size: 12, weight: 700, color: QUANTITY_COLORS.force, border: `${QUANTITY_COLORS.force}66` },
      );
    }

    if (!collides)
      pill(ctx, width / 2, ground + 56, "They never meet", {
        align: "center",
        size: 13,
        weight: 700,
        color: LAB.text,
        border: "rgba(255,255,255,0.3)",
      });

    momentumPanel(scene);
  },
  handles(scene) {
    if (scene.t >= 0.04) return [];
    const L = layout(scene);
    const { ground, pxPerMs, b1, b2, start } = L;
    const base = frozen?.base ?? { v1: start.c1, v2: start.c2 };
    const make = (id: "v1" | "v2", key: "speed1" | "speed2", h: number, label: string): LabHandle => ({
      id,
      x: base[id] + scene.params[key] * pxPerMs,
      y: arrowY(ground, h),
      r: 16,
      label,
      cursor: "ew-resize",
      drag: (px) => ({
        [key]: Math.round(((px - (frozen?.base[id] ?? base[id])) / pxPerMs) * 10) / 10,
      }),
    });
    return [
      make("v1", "speed1", b1.h, "Drag the arrow tip to set body 1's velocity"),
      make("v2", "speed2", b2.h, "Drag the arrow tip to set body 2's velocity"),
    ];
  },
};
