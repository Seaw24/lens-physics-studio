import { useEffect, useRef, useState, type ReactNode } from "react";
import type {
  Overlay,
  Quantity,
  StudioSpec,
  Track,
} from "../../../shared/studio/schema";
import { QUANTITY_COLORS, textRuns } from "../lab/draw";
import {
  nearestEdgePoint,
  placeLabel,
  segmentBoxes,
  type Box,
  type LayoutContext,
} from "../labelLayout";
import { anchorAt, trackAt, trackPath } from "./tracks";

export interface GhostImage {
  t: number;
  url: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * timeline: the telestration while the clip plays. question: a clean frame, so
 * nothing covers what the learner must look at. reveal: only the answer's
 * overlays. hidden: annotations switched off (answers still reveal).
 */
export type OverlayMode = "timeline" | "question" | "reveal" | "hidden";

/** Spots on the frame that must stay clear (normalized center, radius as a share of width). */
export interface ClearSpot {
  x: number;
  y: number;
  radius: number;
}

/** Ambient marks that sit on or behind the object and carry no label. */
const AMBIENT_TYPES = new Set<Overlay["type"]>(["trail", "halo", "ghosts"]);
/** One idea at a time: at most this many labeled marks and ambient marks on screen. */
const MAX_TEACHING = 3;
const MAX_AMBIENT = 2;
/** Labels are placed in this order, so the most important ones get the best spots. */
const LABEL_PRIORITY: Overlay["type"][] = ["vector", "arc", "pivot", "angle", "dimension", "zone", "label"];
const DRAW_ORDER: Overlay["type"][] = ["zone", "trail", "ghosts", "halo", "dimension", "angle", "arc", "pivot", "vector", "label"];

const TONE_COLORS = {
  neutral: "#eef3ff",
  hot: "#ff7a2f",
  blue: "#7c9bff",
};

export function RichText({ text }: { text: string }) {
  return (
    <>
      {textRuns(text).map((run, index) =>
        run.sub ? <sub key={index}>{run.text}</sub> : <span key={index}>{run.text}</span>,
      )}
    </>
  );
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeOut = (x: number) => 1 - (1 - x) ** 3;
const easeOutBack = (x: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
};

interface Visible {
  overlay: Overlay;
  /** 0–1 entrance progress. */
  enter: number;
  /** 0–1 overall opacity. */
  opacity: number;
}

interface LabelRequest {
  key: string;
  type: Overlay["type"];
  text: string;
  color: string;
  opacity: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
  gap: number;
  /** Callouts always keep their leader line. */
  leader?: boolean;
}

const speedCache = new WeakMap<Track, number>();
function referenceSpeed(track: Track, aspect: number) {
  let value = speedCache.get(track);
  if (value === undefined) {
    value = 0;
    const first = track.samples[0]?.t ?? 0;
    const last = track.samples.at(-1)?.t ?? 0;
    for (let t = first; t <= last; t += 1 / 30) {
      const p = trackAt(track, t);
      if (p) value = Math.max(value, Math.hypot(p.vx, p.vy * aspect));
    }
    speedCache.set(track, value);
  }
  return value;
}

const KINEMATIC = new Set<Quantity>(["velocity", "acceleration", "momentum", "displacement"]);

/**
 * When the model asked for more marks than fit cleanly, keep the physics: up to
 * two arrows (forces before motion), then one of each other kind, then fill up.
 */
function declutter(items: Visible[]) {
  const newest = [...items].sort((a, b) => b.overlay.from - a.overlay.from);
  const ambient = newest.filter(({ overlay }) => AMBIENT_TYPES.has(overlay.type)).slice(0, MAX_AMBIENT);
  const kinematic = (item: Visible) => item.overlay.type === "vector" && KINEMATIC.has(item.overlay.quantity);
  const arrows = newest.filter(({ overlay }) => overlay.type === "vector").sort((a, b) => Number(kinematic(a)) - Number(kinematic(b)));
  const teaching: Visible[] = arrows.slice(0, 2);
  for (const type of LABEL_PRIORITY) {
    const pick = newest.find(({ overlay }) => overlay.type === type && type !== "vector");
    if (pick && teaching.length < MAX_TEACHING) teaching.push(pick);
  }
  for (const item of arrows) if (teaching.length < MAX_TEACHING && !teaching.includes(item)) teaching.push(item);
  for (const item of newest)
    if (teaching.length < MAX_TEACHING && !AMBIENT_TYPES.has(item.overlay.type) && !teaching.includes(item)) teaching.push(item);
  return [...ambient, ...teaching];
}

/**
 * Telestration layer drawn over the event video: trails, halos, vectors, pivots,
 * arcs, angles, dimensions, zones and strobe ghosts, with glass labels in HTML
 * placed so they never cover each other, the tracked objects or the arrows.
 */
export default function Overlays({
  spec,
  t,
  mode,
  reveal,
  now,
  ghosts,
  clear = [],
  extra,
}: {
  spec: StudioSpec;
  t: number;
  mode: OverlayMode;
  reveal: { ids: string[]; startedAt: number } | null;
  now: number;
  ghosts: Record<string, GhostImage[]>;
  /** Quiz spots labels must not cover. */
  clear?: ClearSpot[];
  /** Extra SVG drawn above the overlays (quiz interactions). */
  extra?: ReactNode;
}) {
  const layer = useRef<HTMLDivElement>(null);
  const [pixelWidth, setPixelWidth] = useState(720);
  useEffect(() => {
    const element = layer.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setPixelWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const memory = useRef(new Map<string, number>());
  const memoryFor = useRef(spec.eventId);
  if (memoryFor.current !== spec.eventId) {
    memoryFor.current = spec.eventId;
    memory.current.clear();
  }

  const W = 1000;
  const H = (1000 * spec.clip.height) / spec.clip.width;
  const aspect = H / W;
  const tracks = new Map(spec.annotations.tracks.map((track) => [track.id, track]));
  const all = new Map(
    [...spec.annotations.overlays, ...spec.revealOverlays].map((overlay) => [overlay.id, overlay]),
  );

  let visible: Visible[] = [];
  if (mode === "timeline")
    for (const overlay of spec.annotations.overlays) {
      if (t < overlay.from - 0.001 || t > overlay.to + 0.25) continue;
      const enter = clamp01((t - overlay.from) / 0.35);
      const exit = clamp01((overlay.to + 0.25 - t) / 0.25);
      visible.push({ overlay, enter: t >= overlay.from ? Math.max(enter, 0.02) : 0, opacity: Math.min(1, exit) });
    }
  if (reveal && mode !== "question")
    reveal.ids.forEach((id, index) => {
      const overlay = all.get(id);
      if (!overlay) return;
      const progress = clamp01((now - reveal.startedAt - index * 140) / 550);
      const existing = visible.find((item) => item.overlay.id === id);
      if (existing) {
        existing.enter = Math.max(existing.enter, progress);
        existing.opacity = Math.max(existing.opacity, clamp01(progress * 3));
      } else visible.push({ overlay, enter: progress, opacity: clamp01(progress * 3) });
    });
  visible = declutter(visible);
  visible.sort((a, b) => DRAW_ORDER.indexOf(a.overlay.type) - DRAW_ORDER.indexOf(b.overlay.type));

  const px = (x: number) => x * W;
  const py = (y: number) => y * H;
  const requests: LabelRequest[] = [];
  const obstacles: Box[] = [];

  // Every visible tracked object stays uncovered, with a little breathing room.
  for (const track of spec.annotations.tracks) {
    const p = trackAt(track, t);
    if (!p) continue;
    const w = Math.max(p.w * W, 40) + 16;
    const h = Math.max(p.h * H, 40) + 16;
    obstacles.push({ left: px(p.x) - w / 2, top: py(p.y) - h / 2, width: w, height: h });
  }
  for (const spot of clear) {
    const r = spot.radius * W;
    obstacles.push({ left: px(spot.x) - r, top: py(spot.y) - r, width: 2 * r, height: 2 * r });
  }

  const elements = visible.map(({ overlay, enter, opacity }) => {
    const key = overlay.id;
    switch (overlay.type) {
      case "trail": {
        const track = tracks.get(overlay.track);
        const end = Math.min(t, overlay.to + 0.25);
        const points = trackPath(track, overlay.from, end, 1 / 60);
        if (points.length < 2) return null;
        if (overlay.style === "strobe") {
          const dots = points.filter((_, i) => i % 6 === 0);
          return (
            <g key={key} opacity={opacity} className="ov-trail">
              <polyline points={points.map((p) => `${px(p.x)},${py(p.y)}`).join(" ")} className="ov-trail-line" />
              {dots.map((p, i) => (
                <circle key={i} cx={px(p.x)} cy={py(p.y)} r={4.5} className="ov-strobe" style={{ opacity: 0.35 + (0.65 * i) / Math.max(1, dots.length - 1) }} />
              ))}
            </g>
          );
        }
        const segments = [];
        const n = points.length;
        const pieces = Math.min(28, n - 1);
        for (let s = 0; s < pieces; s++) {
          const a = Math.floor((s / pieces) * (n - 1));
          const b = Math.floor(((s + 1) / pieces) * (n - 1));
          const share = (s + 1) / pieces;
          segments.push(
            <polyline
              key={s}
              points={points.slice(a, b + 1).map((p) => `${px(p.x)},${py(p.y)}`).join(" ")}
              className="ov-comet"
              style={{ strokeWidth: 2 + 5 * share, opacity: 0.06 + 0.8 * share * share }}
            />,
          );
        }
        const head = points[n - 1];
        return (
          <g key={key} opacity={opacity}>
            {segments}
            <circle cx={px(head.x)} cy={py(head.y)} r={5} className="ov-comet-head" />
          </g>
        );
      }
      case "halo": {
        const p = trackAt(tracks.get(overlay.track), t);
        if (!p) return null;
        // A thin ring around the object, never a tint over it.
        const r = Math.max(p.w * W, p.h * H) * 0.58 + 10;
        const scale = 0.85 + 0.15 * easeOut(enter);
        return (
          <g key={key} transform={`translate(${px(p.x)} ${py(p.y)}) scale(${scale})`} opacity={opacity * easeOut(enter)} className={`ov-halo tone-${overlay.tone}`}>
            <circle r={r} className="ov-halo-shadow" />
            <circle r={r} className="ov-halo-ring" />
          </g>
        );
      }
      case "ghosts": {
        const images = ghosts[overlay.id] ?? [];
        return (
          <g key={key} opacity={opacity * easeOut(enter)}>
            {images
              .filter((image) => image.t <= t + 0.02 || mode === "reveal")
              .map((image, i, list) => (
                <image
                  key={image.t}
                  href={image.url}
                  x={px(image.x - image.w / 2)}
                  y={py(image.y - image.h / 2)}
                  width={px(image.w)}
                  height={py(image.h)}
                  opacity={0.3 + (0.45 * (i + 1)) / list.length}
                />
              ))}
          </g>
        );
      }
      case "vector": {
        const origin = anchorAt(overlay.anchor, tracks, t);
        if (!origin) return null;
        let dx: number;
        let dy: number;
        let speedShare = 1;
        if (overlay.direction.mode === "angle") {
          const rad = (overlay.direction.deg * Math.PI) / 180;
          dx = Math.cos(rad);
          dy = -Math.sin(rad);
        } else if (overlay.direction.mode === "motion") {
          const sx = origin.vx * W;
          const sy = origin.vy * H;
          const speed = Math.hypot(sx, sy);
          if (speed < 12) return null;
          dx = sx / speed;
          dy = sy / speed;
          if (overlay.scale === "speed" && "track" in overlay.anchor) {
            const track = tracks.get(overlay.anchor.track)!;
            const reference = referenceSpeed(track, aspect) * W;
            speedShare = Math.min(1.4, Math.max(0.3, speed / Math.max(1, reference)));
          }
        } else {
          const target = anchorAt(overlay.direction.anchor, tracks, t);
          if (!target) return null;
          const tx = px(target.x) - px(origin.x);
          const ty = py(target.y) - py(origin.y);
          const len = Math.hypot(tx, ty);
          if (len < 1) return null;
          dx = tx / len;
          dy = ty / len;
        }
        // Arrows start at the object's outline so the shaft never covers the object itself.
        const rx = (origin.w * W) / 2;
        const ry = (origin.h * H) / 2;
        const edge = rx > 1 && ry > 1 ? 1 / Math.sqrt((dx / rx) ** 2 + (dy / ry) ** 2) : 0;
        const objectSize = Math.max(origin.w * W, origin.h * H);
        const length = Math.min(320, Math.max(130, objectSize * 0.8)) * overlay.magnitude * speedShare * easeOutBack(enter);
        if (length < 4) return null;
        const x0 = px(origin.x) + dx * edge;
        const y0 = py(origin.y) + dy * edge;
        const x1 = x0 + dx * length;
        const y1 = y0 + dy * length;
        const color = QUANTITY_COLORS[overlay.quantity as Quantity];
        const head = Math.min(22, length * 0.4);
        const bx = x1 - dx * head;
        const by = y1 - dy * head;
        const half = head * 0.55;
        const headPath = `M${x1} ${y1}L${bx - dy * half} ${by + dx * half}L${bx + dx * head * 0.2} ${by + dy * head * 0.2}L${bx + dy * half} ${by - dx * half}Z`;
        obstacles.push(...segmentBoxes(x0, y0, x1, y1, 18));
        if (enter > 0.6)
          requests.push({ key, type: overlay.type, text: overlay.label, color, opacity: opacity * clamp01((enter - 0.6) / 0.4), x: x1, y: y1, dx, dy, gap: 10 });
        return (
          <g key={key} opacity={opacity} className="ov-vector">
            <line x1={x0} y1={y0} x2={bx} y2={by} className="ov-casing" style={{ strokeWidth: 10 }} />
            <path d={headPath} className="ov-casing-head" />
            <line x1={x0} y1={y0} x2={bx + dx * 2} y2={by + dy * 2} stroke={color} strokeWidth={5.5} strokeLinecap="round" />
            <path d={headPath} fill={color} />
            <circle cx={x0} cy={y0} r={4.5} fill={color} stroke="#081427" strokeWidth={2} />
          </g>
        );
      }
      case "label": {
        const p = anchorAt(overlay.anchor, tracks, t);
        if (!p) return null;
        // Callouts sit beside the object, pointing back at it with a leader line.
        const side = p.x > 0.6 ? -1 : 1;
        const reach = Math.max(p.w * W, p.h * H) * 0.5 + 18;
        obstacles.push({ left: px(p.x) - 10, top: py(p.y) - 10, width: 20, height: 20 });
        if (enter > 0.2)
          requests.push({
            key,
            type: overlay.type,
            text: overlay.text,
            color: TONE_COLORS[overlay.tone],
            opacity: opacity * clamp01((enter - 0.2) / 0.5),
            x: px(p.x),
            y: py(p.y),
            dx: side,
            dy: -0.8,
            gap: reach,
            leader: true,
          });
        return (
          <g key={key} opacity={opacity * easeOut(enter)}>
            <circle cx={px(p.x)} cy={py(p.y)} r={4} fill={TONE_COLORS[overlay.tone]} stroke="#081427" strokeWidth={2} />
          </g>
        );
      }
      case "pivot": {
        const p = anchorAt(overlay.anchor, tracks, t);
        if (!p) return null;
        const s = easeOutBack(enter);
        obstacles.push({ left: px(p.x) - 34, top: py(p.y) - 34, width: 68, height: 68 });
        if (enter > 0.4)
          requests.push({ key, type: overlay.type, text: overlay.label, color: "#eef3ff", opacity: opacity * clamp01((enter - 0.4) / 0.6), x: px(p.x), y: py(p.y), dx: 1, dy: 1, gap: 30 });
        return (
          <g key={key} transform={`translate(${px(p.x)} ${py(p.y)}) scale(${s})`} opacity={opacity} className="ov-pivot">
            <circle r={9} className="ov-pivot-ring" />
            <circle r={3} className="ov-pivot-dot" />
            <path d="M-26 0H-15M15 0H26M0 -26V-15M0 15V26" className="ov-pivot-cross" />
          </g>
        );
      }
      case "arc": {
        const p = anchorAt(overlay.anchor, tracks, t);
        if (!p) return null;
        const r = overlay.radius * W;
        const sweep = overlay.sweepDeg * easeOut(enter);
        if (Math.abs(sweep) < 2) return null;
        const start = (overlay.startDeg * Math.PI) / 180;
        const end = ((overlay.startDeg + sweep) * Math.PI) / 180;
        const cx = px(p.x);
        const cy = py(p.y);
        // Screen angles: counter-clockwise positive, so y flips.
        const point = (a: number) => [cx + Math.cos(a) * r, cy - Math.sin(a) * r];
        const [sx, sy] = point(start);
        const [ex, ey] = point(end);
        const large = Math.abs(sweep) > 180 ? 1 : 0;
        const clockwise = sweep < 0 ? 1 : 0;
        const tangent = sweep > 0 ? [-Math.sin(end), -Math.cos(end)] : [Math.sin(end), Math.cos(end)];
        const head = 16;
        const hx = ex - tangent[0] * head;
        const hy = ey - tangent[1] * head;
        const nx = -tangent[1];
        const ny = tangent[0];
        const mid = (start + end) / 2;
        for (let i = 0; i <= 12; i++) {
          const [ax, ay] = point(start + ((end - start) * i) / 12);
          obstacles.push({ left: ax - 9, top: ay - 9, width: 18, height: 18 });
        }
        if (enter > 0.5)
          requests.push({ key, type: overlay.type, text: overlay.label, color: "#f472d0", opacity: opacity * clamp01((enter - 0.5) / 0.5), x: cx + Math.cos(mid) * r, y: cy - Math.sin(mid) * r, dx: Math.cos(mid), dy: -Math.sin(mid), gap: 16 });
        return (
          <g key={key} opacity={opacity} className="ov-arc">
            <path d={`M${sx} ${sy}A${r} ${r} 0 ${large} ${clockwise} ${ex} ${ey}`} className="ov-casing" style={{ strokeWidth: 9, fill: "none" }} />
            <path d={`M${sx} ${sy}A${r} ${r} 0 ${large} ${clockwise} ${ex} ${ey}`} className="ov-arc-line" />
            <path d={`M${ex + tangent[0] * 4} ${ey + tangent[1] * 4}L${hx + nx * 9} ${hy + ny * 9}L${hx - nx * 9} ${hy - ny * 9}Z`} className="ov-arc-head" />
          </g>
        );
      }
      case "angle": {
        const p = anchorAt(overlay.anchor, tracks, t);
        if (!p) return null;
        const r = 64;
        const cx = px(p.x);
        const cy = py(p.y);
        const a0 = (overlay.fromDeg * Math.PI) / 180;
        const a1 = ((overlay.fromDeg + (overlay.toDeg - overlay.fromDeg) * easeOut(enter)) * Math.PI) / 180;
        const pt = (a: number, rr: number) => [cx + Math.cos(a) * rr, cy - Math.sin(a) * rr];
        const [sx, sy] = pt(a0, r);
        const [ex, ey] = pt(a1, r);
        const sweep = overlay.toDeg - overlay.fromDeg;
        const large = Math.abs(sweep) > 180 ? 1 : 0;
        const dir = sweep < 0 ? 1 : 0;
        const [rx0, ry0] = pt(a0, r * 1.7);
        const [rx1, ry1] = pt(a1, r * 1.7);
        const mid = (a0 + a1) / 2;
        obstacles.push(...segmentBoxes(cx, cy, rx0, ry0, 12), ...segmentBoxes(cx, cy, rx1, ry1, 12));
        if (enter > 0.5)
          requests.push({ key, type: overlay.type, text: overlay.label, color: "#eef3ff", opacity: opacity * clamp01((enter - 0.5) / 0.5), x: pt(mid, r)[0], y: pt(mid, r)[1], dx: Math.cos(mid), dy: -Math.sin(mid), gap: 14 });
        return (
          <g key={key} opacity={opacity} className="ov-angle">
            <path d={`M${cx} ${cy}L${sx} ${sy}A${r} ${r} 0 ${large} ${dir} ${ex} ${ey}Z`} className="ov-angle-fill" />
            <line x1={cx} y1={cy} x2={rx0} y2={ry0} className="ov-angle-ray" />
            <line x1={cx} y1={cy} x2={rx1} y2={ry1} className="ov-angle-ray" />
            <path d={`M${sx} ${sy}A${r} ${r} 0 ${large} ${dir} ${ex} ${ey}`} className="ov-angle-arc" />
          </g>
        );
      }
      case "dimension": {
        const a = anchorAt(overlay.a, tracks, t);
        const b = anchorAt(overlay.b, tracks, t);
        if (!a || !b) return null;
        const ax = px(a.x);
        const ay = py(a.y);
        const bx = ax + (px(b.x) - ax) * easeOut(enter);
        const by = ay + (py(b.y) - ay) * easeOut(enter);
        const len = Math.hypot(bx - ax, by - ay);
        if (len < 4) return null;
        const nx = -(by - ay) / len;
        const ny = (bx - ax) / len;
        obstacles.push(...segmentBoxes(ax, ay, bx, by, 12));
        if (enter > 0.7)
          requests.push({ key, type: overlay.type, text: overlay.label, color: "#eef3ff", opacity: opacity * clamp01((enter - 0.7) / 0.3), x: (ax + bx) / 2, y: (ay + by) / 2, dx: nx, dy: ny, gap: 12 });
        return (
          <g key={key} opacity={opacity} className="ov-dimension">
            <line x1={ax} y1={ay} x2={bx} y2={by} className="ov-casing" style={{ strokeWidth: 7 }} />
            <line x1={ax} y1={ay} x2={bx} y2={by} className="ov-dimension-line" />
            <path d={`M${ax + nx * 11} ${ay + ny * 11}L${ax - nx * 11} ${ay - ny * 11}M${bx + nx * 11} ${by + ny * 11}L${bx - nx * 11} ${by - ny * 11}`} className="ov-dimension-line" />
          </g>
        );
      }
      case "zone": {
        const { box } = overlay;
        const draw = easeOut(enter);
        if (enter > 0.3)
          requests.push({ key, type: overlay.type, text: overlay.label, color: "#eef3ff", opacity: opacity * clamp01((enter - 0.3) / 0.7), x: px(box.x + box.w / 2), y: py(box.y), dx: 0, dy: -1, gap: 10 });
        return (
          <g key={key} opacity={opacity * draw} className="ov-zone">
            <rect x={px(box.x)} y={py(box.y)} width={px(box.w)} height={py(box.h)} rx={12} className="ov-zone-line" />
          </g>
        );
      }
    }
  });

  // Label sizes in viewBox units, from the rendered pill font (clamp(11px, 2.2cqw, 15px)).
  const unit = W / pixelWidth;
  const fontPx = Math.min(15, Math.max(11, 0.022 * pixelWidth));
  const measure = (text: string) => {
    const chars = textRuns(text).reduce((sum, run) => sum + run.text.length * (run.sub ? 0.72 : 1), 0);
    return { width: (chars * 0.6 * fontPx + 24) * unit, height: (fontPx * 1.15 + 12) * unit };
  };
  const context: LayoutContext = {
    bounds: { width: W, height: H },
    margin: 10,
    placed: [],
    obstacles,
    memory: memory.current,
  };
  const placed = [...requests]
    .sort((a, b) => LABEL_PRIORITY.indexOf(a.type) - LABEL_PRIORITY.indexOf(b.type))
    .map((request) => {
      const size = measure(request.text);
      const placement = placeLabel({ ...request, ...size }, context);
      const { box } = placement;
      const end = nearestEdgePoint(box, request.x, request.y);
      const far = Math.hypot(end.x - request.x, end.y - request.y) > request.gap * 1.6 + 8;
      return { request, box, leader: request.leader || (placement.displaced && far) ? end : null };
    });

  return (
    <div className="ov-layer" aria-hidden="true" ref={layer}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="ov-svg">
        <defs>
          <filter id="ov-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="3.2" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        {elements}
        {placed.map(({ request, leader }) =>
          leader ? (
            <line
              key={`leader-${request.key}`}
              x1={request.x}
              y1={request.y}
              x2={leader.x}
              y2={leader.y}
              className="ov-leader"
              style={{ stroke: request.color, opacity: request.opacity * 0.75 }}
            />
          ) : null,
        )}
        {extra}
      </svg>
      {placed.map(({ request, box }) => (
        <span
          key={request.key}
          className="ov-label"
          style={{
            left: `${((box.left + box.width / 2) / W) * 100}%`,
            top: `${((box.top + box.height / 2) / H) * 100}%`,
            opacity: request.opacity,
            ["--tone" as string]: request.color,
          }}
        >
          <RichText text={request.text} />
        </span>
      ))}
    </div>
  );
}
