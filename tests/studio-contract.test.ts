import test from "node:test";
import assert from "node:assert/strict";
import { SAMPLE_STUDIO } from "../shared/studio/sample";
import { StudioSpecSchema } from "../shared/studio/schema";
import { normalizeStudioSpec, validateStudioSpec } from "../shared/studio/validate";
import { studioFrameTimes } from "../server/studio/frames";
import { normalizeLab, normalizeOverlay, normalizeQuestion, normalizeTracks } from "../server/studio/tools";

test("the prepared sample studio satisfies the contract and the physics checks", () => {
  const spec = normalizeStudioSpec(StudioSpecSchema.parse(SAMPLE_STUDIO));
  assert.deepEqual(validateStudioSpec(spec), []);
});

test("physics checks catch a wrong experiment expectation and bad references", () => {
  const broken = structuredClone(SAMPLE_STUDIO);
  broken.lab.experiments[1].expect = "increase";
  (broken.quiz[1] as any).reveal = ["missing-overlay"];
  const problems = validateStudioSpec(normalizeStudioSpec(broken));
  assert.ok(problems.some((p) => p.includes('"heavier"') && p.includes('"same"')), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("missing-overlay")));
});

test("frame times cover the event densely and stay inside the clip", () => {
  const times = studioFrameTimes(6, 2, 4);
  assert.ok(times.length >= 15);
  assert.ok(times.every((t) => t >= 0 && t < 6));
  assert.ok(times.filter((t) => t >= 2 && t <= 4).length >= 11);
  assert.equal(studioFrameTimes(4, 1, 1).length, 12);
});

test("tool answers in percent and frame labels normalize to the contract", () => {
  const frames = new Map([
    ["F01", 0.5],
    ["F02", 1],
  ]);
  const [track] = normalizeTracks(
    [
      {
        id: "Soda Can",
        label: "can",
        role: "body",
        keyframes: [
          { frame: "F02", box: [40, 50, 60, 70], visible: true },
          { frame: "F01", visible: false },
        ],
      },
    ],
    frames,
  );
  assert.equal(track.id, "soda-can");
  assert.deepEqual(track.samples.map((s) => s.t), [0.5, 1]);
  assert.equal(track.samples[1].x, 0.5);
  assert.equal(track.samples[1].h, 0.2);
  const overlay = normalizeOverlay(
    { id: "w", type: "vector", from: 0, to: 1, anchor: { track: "Soda Can" }, quantity: "weight", direction: { mode: "angle", deg: 270 }, label: "mg" },
    0,
  );
  assert.deepEqual((overlay as any).anchor, { track: "soda-can" });
  const question = normalizeQuestion({ id: "q", type: "hotspot", t: 1, target: { x: 25, y: 75 }, radius: 8 }, 0);
  assert.deepEqual((question as any).target, { x: 0.25, y: 0.75 });
  assert.equal((question as any).radius, 0.08);
  const lab = normalizeLab({
    engine: "surface",
    skin: { body: { name: "can", shape: "can", color: "red" }, other: null, surface: null, agent: "hand" },
    params: [{ key: "force", value: 3, min: 0, max: 10 }],
    experiments: [{ id: "a", change: [{ key: "force", value: 6 }] }],
  });
  assert.deepEqual(lab.params.force, { value: 3, min: 0, max: 10 });
  assert.deepEqual(lab.experiments[0].change, { force: 6 });
  assert.equal(lab.skin.body.color, "#c8102e");
});
