import test from "node:test";
import assert from "node:assert/strict";
import { overlapArea, placeLabel, segmentBoxes, type LayoutContext } from "../src/studio/labelLayout";
import { fitText } from "../server/studio/tools";

const context = (): LayoutContext => ({
  bounds: { width: 1000, height: 600 },
  margin: 10,
  placed: [],
  obstacles: [],
  memory: new Map(),
});

test("a label with room keeps its preferred spot beside the point", () => {
  const layout = context();
  const { box, displaced, overlap } = placeLabel({ key: "mg", x: 500, y: 300, dx: 0, dy: 1, width: 60, height: 24, gap: 10 }, layout);
  assert.equal(displaced, false);
  assert.equal(overlap, 0);
  assert.ok(box.top >= 310, "sits below the point, clear of it");
});

test("labels never overlap each other, the objects or the arrows", () => {
  const layout = context();
  layout.obstacles.push({ left: 440, top: 260, width: 120, height: 120 }, ...segmentBoxes(500, 320, 500, 180, 18));
  const requests = ["F_push", "F_N", "mg", "Rotation"].map((key) => ({ key, x: 500, y: 190, dx: 0, dy: -1, width: 90, height: 26, gap: 10 }));
  const boxes = requests.map((request) => placeLabel(request, layout));
  for (const { overlap } of boxes) assert.equal(overlap, 0);
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) assert.equal(overlapArea(boxes[i].box, boxes[j].box), 0);
});

test("labels stay inside the frame", () => {
  const layout = context();
  const { box } = placeLabel({ key: "v", x: 990, y: 5, dx: 1, dy: -1, width: 50, height: 24, gap: 10 }, layout);
  assert.ok(box.left >= 10 && box.top >= 10 && box.left + box.width <= 990);
});

test("a label keeps the spot it used last frame while that spot is still clear", () => {
  const layout = context();
  layout.obstacles.push({ left: 480, top: 200, width: 40, height: 100 });
  const request = { key: "F_N", x: 500, y: 190, dx: 0, dy: -1, width: 60, height: 24, gap: 8 };
  const first = placeLabel(request, layout);
  layout.placed = [];
  const second = placeLabel({ ...request, x: 502 }, layout);
  assert.ok(Math.abs(second.box.left - first.box.left) <= 2 && Math.abs(second.box.top - first.box.top) <= 2);
});

test("model text is shortened at a sentence or word, never mid-word", () => {
  const caption =
    "The grip force exceeds static friction, so the bottle accelerates. Kinetic friction opposes the slide while weight and normal balance.";
  assert.equal(fitText(caption, 120), "The grip force exceeds static friction, so the bottle accelerates.");
  assert.equal(fitText("Contact force controls descent", 18), "Contact force…");
  assert.equal(fitText("mg", 18), "mg");
});
