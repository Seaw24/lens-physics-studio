import assert from "node:assert/strict";
import test from "node:test";
import {
  EventSchema,
  ProposalSchema,
  ProposerResponseSchema,
  ReviewResponseSchema,
  parseStrictModelJson,
  validateEvidence,
} from "../shared/discovery";
import { ActivityGate, activityScore, scheduleWindows } from "../server/discovery/activity";
import {
  eventsOverlap,
  intervalIoU,
  normalizedMeanAbsoluteDifference,
  normalizeSubject,
} from "../server/discovery/grouping";
import { GlobalCloudDispatcher } from "../server/bedrock";
import { loadDiscoveryConfig } from "../server/discovery/config";

const hash = "a".repeat(64);
const action = {
  kind: "observed_action" as const,
  subject: "visible panel",
  startFrameId: "f0",
  endFrameId: "f1",
  observation: "The panel changes orientation relative to its frame.",
  before: { text: "Panel aligned.", frameIds: ["f0"] },
  after: { text: "Panel angled.", frameIds: ["f1"] },
  evidenceFrameIds: ["f0", "f1"],
  objectiveIds: ["torque-rotation" as const],
  limitations: ["Force magnitude is not established."],
};
const frames = [
  { frameId: "f0", sourceTimeMs: 1000, sha256: hash },
  { frameId: "f1", sourceTimeMs: 1500, sha256: hash },
];

test("v2 contract enforces evidence chronology, image semantics, clocks, and strict JSON", () => {
  validateEvidence(ProposalSchema.parse(action), frames, "video");
  assert.throws(() => validateEvidence({ ...action, endFrameId: "missing" }, frames, "video"));
  assert.throws(() => validateEvidence({ ...action, before: action.after, after: action.before }, frames, "video"));
  assert.throws(() => validateEvidence(action, [{ ...frames[0], sourceTimeMs: null }], "image"));
  assert.equal(ProposerResponseSchema.safeParse({ proposals: [{ ...action, confidence: 1 }] }).success, false);
  assert.equal(ProposalSchema.safeParse({ ...action, objectiveIds: ["unknown"] }).success, false);
  assert.deepEqual(
    parseStrictModelJson('```json\n{"proposals":[]}\n```', ProposerResponseSchema),
    { proposals: [] },
  );
  assert.throws(() =>
    parseStrictModelJson('Result: {"proposals":[]}', ProposerResponseSchema),
  );
  assert.equal(
    ReviewResponseSchema.safeParse({
      verdict: "teachable",
      reason: "Unsupported",
      opportunities: [],
    }).success,
    false,
  );
});

test("approved image and video event fixtures validate and reject bad clock offsets", () => {
  const model = {
    modelId: "us.anthropic.claude-sonnet-4-6",
    promptHash: hash,
    invocationId: "call",
  };
  const event: any = {
    schemaVersion: "2.0",
    exampleOnly: true,
    id: "event",
    sessionId: "session",
    candidateId: "candidate",
    createdAt: "2026-09-16T00:00:00.000Z",
    course: { id: "intro-mechanics-forces-torque", version: "2" },
    source: { kind: "video", sourceId: "source" },
    review: {
      verdict: "teachable",
      reason: "Synthetic fixture only.",
      opportunity: { ...action, connection: "Visible rotation supports qualitative torque reasoning." },
      eventSourceInterval: { startSeconds: 1, endSeconds: 1.5 },
      evidence: [
        { frameId: "f0", sourceTimeSeconds: 1, clipTimeSeconds: 1 },
        { frameId: "f1", sourceTimeSeconds: 1.5, clipTimeSeconds: 1.5 },
      ],
    },
    media: {
      assetId: "asset",
      url: "/api/discovery/assets/asset",
      mimeType: "video/mp4",
      sha256: hash,
      width: 640,
      height: 480,
      fidelity: "source_video_clip",
      sourceInterval: { startSeconds: 0, endSeconds: 3 },
      durationSeconds: 3,
      timingUncertaintyMs: 100,
      maxCaptureGapMs: null,
    },
    provenance: {
      schedulingReasons: ["uniform_evaluation"],
      proposer: model,
      reviewer: model,
      snapshotHash: hash,
    },
  };
  EventSchema.parse(event);
  event.provenance.proposer.modelId = "amazon.nova-lite-v1:0";
  EventSchema.parse(event);
  event.review.evidence[0].clipTimeSeconds = 0;
  assert.equal(EventSchema.safeParse(event).success, false);
});

test("activity score subtracts exposure shift; gate activates, exits, and resets on gaps", () => {
  const dark = new Uint8Array(64 * 36).fill(30);
  const exposure = new Uint8Array(64 * 36).fill(50);
  assert.equal(activityScore(dark, exposure), 0);
  const changed = new Uint8Array(dark);
  changed.fill(200, 0, 200);
  assert.ok(activityScore(dark, changed) > 0.04);
  const gate = new ActivityGate();
  gate.push(0, dark);
  assert.equal(gate.push(250, changed).active, false);
  assert.equal(gate.push(500, dark).active, true);
  let tick;
  for (let index = 1; index <= 8; index++) tick = gate.push(500 + index * 250, dark);
  assert.equal(tick!.active, false);
  assert.equal(gate.push(4000, changed).reset, true);
});

test("gated scheduling keeps activity and independent periodic opportunities bounded", () => {
  const idle = scheduleWindows(30_000, [], "cascade_gated");
  assert.deepEqual(
    idle.map((window) => window.reasons),
    [["periodic"], ["periodic"], ["periodic"], ["periodic"]],
  );
  assert.equal(idle.at(-1)?.partial, true);
  const active = scheduleWindows(18_000, [4_000, 4_250, 10_000], "cascade_gated");
  assert.ok(active.some((window) => window.reasons.includes("activity")));
  assert.ok(active.some((window) => window.reasons.includes("periodic")));
  assert.equal(scheduleWindows(18_000, [], "cascade_uniform").length, 6);
});

test("gated scheduling flushes a quiet final partial window at EOF", () => {
  assert.deepEqual(scheduleWindows(2_300, [], "cascade_gated"), [
    {
      startMs: 0,
      endMs: 2_300,
      reasons: ["periodic"],
      partial: true,
    },
  ]);
});

test("event grouping merges only matching overlapping evidence and preserves separate actions", () => {
  assert.equal(normalizeSubject("  Visible—Panel! "), "visible panel");
  assert.equal(intervalIoU({ startSeconds: 1, endSeconds: 3 }, { startSeconds: 2, endSeconds: 4 }), 1 / 3);
  const existing: any = {
    review: {
      opportunity: { ...action, connection: "Torque" },
      eventSourceInterval: { startSeconds: 1, endSeconds: 1.5 },
    },
  };
  assert.equal(eventsOverlap(existing, { ...action, connection: "Torque" }, { startSeconds: 1, endSeconds: 1.5 }), true);
  assert.equal(eventsOverlap(existing, { ...action, connection: "Torque" }, { startSeconds: 8, endSeconds: 8.5 }), false);
});

test("static thumbnail suppression uses normalized grayscale distance", () => {
  assert.equal(
    normalizedMeanAbsoluteDifference(
      Uint8Array.from([0, 64, 128, 255]),
      Uint8Array.from([0, 64, 128, 255]),
    ),
    0,
  );
  assert.ok(
    normalizedMeanAbsoluteDifference(
      Uint8Array.from([0, 64, 128, 255]),
      Uint8Array.from([12, 76, 140, 243]),
    ) > 0.02,
  );
  assert.equal(
    normalizedMeanAbsoluteDifference(Uint8Array.of(0), Uint8Array.of(0, 1)),
    Infinity,
  );
});

test("global dispatcher keeps one call in flight and enforces rolling starts", async () => {
  const config = loadDiscoveryConfig(
    { DISCOVERY_ACCESS_CODE: "a".repeat(32) },
    `/tmp/lens-dispatch-${crypto.randomUUID()}`,
  );
  config.limits.minCloudStartSpacingMs = 0;
  config.limits.proposerStartsPerMinute = 1;
  const dispatcher = new GlobalCloudDispatcher(config);
  let inFlight = 0;
  let maximum = 0;
  const work = () =>
    dispatcher.run("legacy", async () => {
      inFlight++;
      maximum = Math.max(maximum, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 10));
      inFlight--;
    });
  await Promise.all([work(), work()]);
  assert.equal(maximum, 1);
  await dispatcher.run("proposer", async () => undefined);
  await assert.rejects(() => dispatcher.run("proposer", async () => undefined), /rolling start limit/i);
});
