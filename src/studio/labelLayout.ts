// Collision-aware label placement shared by the video telestration and the
// physics lab. A label is offered positions around the point it describes,
// nearest and most natural first, and takes the first that clears every label
// already placed, every obstacle (bodies, arrows, markers) and the frame edge.

export interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface LabelRequest {
  /** Stable identity, so a label keeps its spot from frame to frame. */
  key: string;
  /** The point the label describes: an arrow tip, a marker, a midpoint. */
  x: number;
  y: number;
  /** Preferred direction from the point toward the label; (0, 0) centers it on the point. */
  dx: number;
  dy: number;
  width: number;
  height: number;
  /** Space between the point and the label's nearest edge. */
  gap: number;
  /** Exact preferred box, when the caller already has one. */
  natural?: Box;
}

export interface Placement {
  box: Box;
  /** True when the label moved away from its preferred spot (draw a leader line). */
  displaced: boolean;
  /** Remaining overlap; 0 when the label found a clear spot. */
  overlap: number;
}

export interface LayoutContext {
  bounds: { width: number; height: number };
  /** Space kept clear along the frame edges. */
  margin: number;
  placed: Box[];
  obstacles: Box[];
  /** Candidate index each label used last frame. */
  memory?: Map<string, number>;
}

const ROTATIONS = [0, 40, -40, 90, -90, 140, -140, 180];
const REACHES = 5;

export function overlapArea(a: Box, b: Box, pad = 0) {
  const w = Math.min(a.left + a.width, b.left + b.width) - Math.max(a.left, b.left) + pad;
  const h = Math.min(a.top + a.height, b.top + b.height) - Math.max(a.top, b.top) + pad;
  // Sub-pixel slivers from rotated candidates are not overlaps.
  return w > 1e-3 && h > 1e-3 ? w * h : 0;
}

function candidates(request: LabelRequest): Box[] {
  const { x, y, width: w, height: h, gap } = request;
  const length = Math.hypot(request.dx, request.dy);
  const centered = length < 1e-6;
  const ux = centered ? 0 : request.dx / length;
  const uy = centered ? -1 : request.dy / length;
  const at = (cx: number, cy: number): Box => ({ left: cx - w / 2, top: cy - h / 2, width: w, height: h });
  const list: Box[] = [request.natural ?? (centered ? at(x, y) : at(x + ux * (gap + support(ux, uy, w, h)), y + uy * (gap + support(ux, uy, w, h))))];
  for (let reach = 1; reach <= REACHES; reach++)
    for (const degrees of ROTATIONS) {
      if (reach === 1 && degrees === 0 && !centered) continue;
      const a = (degrees * Math.PI) / 180;
      const rx = ux * Math.cos(a) - uy * Math.sin(a);
      const ry = ux * Math.sin(a) + uy * Math.cos(a);
      const s = support(rx, ry, w, h);
      const distance = s + gap + (reach - 1) * (s + gap);
      list.push(at(x + rx * distance, y + ry * distance));
    }
  return list;
}

/** Half-extent of a box along a unit direction. */
function support(ux: number, uy: number, w: number, h: number) {
  return Math.abs(ux) * (w / 2) + Math.abs(uy) * (h / 2);
}

function score(box: Box, context: LayoutContext) {
  const { bounds, margin } = context;
  let value = 0;
  for (const other of context.placed) value += 3 * overlapArea(box, other, 4);
  for (const other of context.obstacles) value += overlapArea(box, other);
  const outside =
    box.width * box.height -
    overlapArea(box, {
      left: margin,
      top: margin,
      width: bounds.width - 2 * margin,
      height: bounds.height - 2 * margin,
    });
  const total = value + 4 * Math.max(0, outside);
  return total < 1e-3 ? 0 : total;
}

/** Places one label and records its box in `context.placed`. */
export function placeLabel(request: LabelRequest, context: LayoutContext): Placement {
  const list = candidates(request);
  const remembered = context.memory?.get(request.key);
  let bestIndex = 0;
  let bestScore = Infinity;
  const order = remembered !== undefined && remembered < list.length ? [remembered, ...list.keys()] : [...list.keys()];
  for (const index of order) {
    const value = score(list[index], context);
    if (value < bestScore - 1e-6) {
      bestScore = value;
      bestIndex = index;
    }
    if (value === 0) break;
  }
  const box = list[bestIndex];
  context.placed.push(box);
  context.memory?.set(request.key, bestIndex);
  return { box, displaced: bestIndex !== 0, overlap: bestScore };
}

/** Boxes along a segment, so labels steer clear of arrow shafts and lines. */
export function segmentBoxes(x0: number, y0: number, x1: number, y1: number, thickness: number): Box[] {
  const length = Math.hypot(x1 - x0, y1 - y0);
  const steps = Math.max(1, Math.ceil(length / Math.max(6, thickness)));
  const boxes: Box[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = x0 + ((x1 - x0) * i) / steps;
    const y = y0 + ((y1 - y0) * i) / steps;
    boxes.push({ left: x - thickness / 2, top: y - thickness / 2, width: thickness, height: thickness });
  }
  return boxes;
}

/** The point on a box's edge nearest to (x, y), where a leader line should end. */
export function nearestEdgePoint(box: Box, x: number, y: number) {
  const cx = Math.min(box.left + box.width, Math.max(box.left, x));
  const cy = Math.min(box.top + box.height, Math.max(box.top, y));
  return { x: cx, y: cy };
}
