import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  FeedbackRequestSchema,
  buildReport,
  humanTruth,
  lessonVersion,
  proposerTruth,
  renderLessons,
  selectReviewerExamples,
  type FeedbackRecord,
  type ProposerOutcome,
} from "../shared/learning";
import { GlobalCloudDispatcher } from "../server/bedrock";
import { loadDiscoveryConfig } from "../server/discovery/config";
import { LearningStore } from "../server/discovery/learning";
import {
  DiscoveryModels,
  ModelOutputError,
  type ModelFrame,
} from "../server/discovery/models";
import { DiscoveryService } from "../server/discovery/service";

const proposal = {
  kind: "observed_action" as const,
  subject: "bottle",
  observation: "A hand squeezes a bottle.",
  before: "held",
  after: "dented",
  objectiveIds: ["force-interaction"],
};

function record(overrides: Partial<FeedbackRecord>): FeedbackRecord {
  return {
    candidateId: "c1",
    sessionId: "s1",
    sourceKind: "phone",
    cardKind: "not_teachable",
    proposals: [proposal],
    reviewVerdict: "not_teachable",
    reviewReason: "no deformation",
    feedback: {
      correct: true,
      verdictTag: null,
      issueTags: [],
      note: "",
      updatedAt: "2026-09-16T00:00:00Z",
    },
    proposerPromptHash: null,
    reviewerPromptHash: null,
    proposerLessonVersion: "none",
    reviewerLessonVersion: "none",
    reviewerModelId: "judge",
    holdout: false,
    framesKept: 0,
    createdAt: "2026-09-16T00:00:00Z",
    ...overrides,
  };
}

test("human truth follows the verdict tag and Nova falls back to Sonnet", () => {
  const notCorrect = (
    verdictTag: "should_approve" | "should_reject" | "wrong_details",
  ) => ({
    correct: false,
    verdictTag,
    issueTags: [],
    note: "",
  });
  assert.equal(
    humanTruth("approved", {
      correct: true,
      verdictTag: null,
      issueTags: [],
      note: "",
    }),
    true,
  );
  assert.equal(humanTruth("not_teachable", notCorrect("should_approve")), true);
  assert.equal(humanTruth("approved", notCorrect("should_reject")), false);
  assert.equal(humanTruth("approved", notCorrect("wrong_details")), true);
  assert.equal(humanTruth("nova_empty", notCorrect("should_approve")), true);
  assert.equal(proposerTruth("teachable", null), true);
  assert.equal(proposerTruth("not_teachable", null), false);
  assert.equal(proposerTruth("insufficient_evidence", null), null);
  assert.equal(
    proposerTruth("teachable", {
      cardKind: "approved",
      feedback: notCorrect("should_reject"),
    }),
    false,
  );
  assert.equal(
    FeedbackRequestSchema.safeParse({
      correct: false,
      verdictTag: null,
      issueTags: [],
      note: "",
    }).success,
    false,
  );
  assert.equal(
    FeedbackRequestSchema.safeParse({
      correct: true,
      verdictTag: "should_approve",
      issueTags: [],
      note: "",
    }).success,
    false,
  );
});

test("reviewer examples skip the current and held-out videos, one per video, balanced", () => {
  const teachable = {
    correct: false,
    verdictTag: "should_approve" as const,
    issueTags: [],
    note: "dent visible",
  };
  const records = [
    record({ candidateId: "same", sessionId: "current" }),
    record({ candidateId: "held", sessionId: "held", holdout: true }),
    record({
      candidateId: "a-old",
      sessionId: "a",
      feedback: { ...teachable, updatedAt: "2026-09-01T00:00:00Z" },
    }),
    record({
      candidateId: "a-new",
      sessionId: "a",
      feedback: { ...teachable, updatedAt: "2026-09-02T00:00:00Z" },
    }),
    record({ candidateId: "b", sessionId: "b" }),
    record({ candidateId: "c", sessionId: "c" }),
  ];
  const picked = selectReviewerExamples(
    records,
    "current",
    ["force-interaction"],
    2,
  );
  assert.equal(picked.length, 2);
  assert.equal(picked[0].candidateId, "a-new");
  assert.ok(
    picked.every(
      (item) => !["same", "held", "a-old"].includes(item.candidateId),
    ),
  );
  assert.equal(
    new Set(picked.map((item) => item.sessionId)).size,
    picked.length,
  );
  assert.equal(
    picked.filter((item) => humanTruth(item.cardKind, item.feedback)).length,
    1,
  );
});

test("report measures Nova precision, Sonnet agreement, misses, and the yes-man alarm", () => {
  const outcome = (
    candidateId: string,
    verdict: ProposerOutcome["reviewVerdict"],
    version: string,
    count = 1,
  ): ProposerOutcome => ({
    candidateId,
    sessionId: "s",
    at: "t",
    proposerLessonVersion: version,
    reviewerLessonVersion: version,
    reviewerModelId: "judge",
    proposals: Array(count).fill(proposal),
    reviewVerdict: verdict,
    reviewReason: null,
  });
  const report = buildReport(
    [
      outcome("o1", "teachable", "v1"),
      outcome("o2", "not_teachable", "v1"),
      outcome("o3", null, "v1", 0),
      outcome("o4", "teachable", "v2"),
      outcome("o5", "teachable", "v2"),
    ],
    [
      record({
        candidateId: "o1",
        cardKind: "approved",
        reviewVerdict: "teachable",
        proposerLessonVersion: "v1",
        reviewerLessonVersion: "v1",
        feedback: {
          correct: false,
          verdictTag: "should_reject",
          issueTags: [],
          note: "",
          updatedAt: "t",
        },
      }),
      record({
        candidateId: "o3",
        cardKind: "nova_empty",
        reviewVerdict: null,
        proposerLessonVersion: "v1",
        reviewerLessonVersion: "v1",
        feedback: {
          correct: false,
          verdictTag: "should_approve",
          issueTags: [],
          note: "",
          updatedAt: "t",
        },
      }),
      record({
        candidateId: "o4",
        cardKind: "approved",
        reviewVerdict: "teachable",
        proposerLessonVersion: "v2",
        reviewerLessonVersion: "v2",
        feedback: {
          correct: false,
          verdictTag: "should_reject",
          issueTags: [],
          note: "",
          updatedAt: "t",
        },
      }),
    ],
  );
  const [v1, v2] = report.groups;
  assert.equal(v1.windows, 3);
  assert.equal(v1.proposalRate, 2 / 3);
  assert.equal(v1.proposerPrecision, 0); // o1 human-rejected, o2 Sonnet-rejected
  assert.equal(v1.falseApprovals, 1);
  assert.equal(v1.missRate, 1);
  assert.equal(v2.approvalRate, 1);
  assert.equal(v2.reviewerAgreement, 0);
  assert.equal(report.yesManAlarm, true);
  // Switching the judge model starts a separate group instead of mixing numbers.
  const split = buildReport(
    [
      outcome("o1", "teachable", "none"),
      { ...outcome("o2", "teachable", "none"), reviewerModelId: "other" },
    ],
    [],
  );
  assert.deepEqual(
    split.groups.map((group) => group.reviewerModelId),
    ["judge", "other"],
  );
});

test("lessons need two supporting videos, human-only reviewer support, and respect the cap", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-lessons-test-"));
  try {
    const store = new LearningStore(root);
    await store.initialize();
    const cases = new Map([
      ["h1", { sessionId: "v1", human: true }],
      ["h2", { sessionId: "v2", human: true }],
      ["r1", { sessionId: "v3", human: false }],
      ["r2", { sessionId: "v4", human: false }],
    ]);
    const added = await store.addDraftedLessons(
      [
        {
          model: "reviewer",
          text: "Squeezing counts only when deformation is visible.",
          supportingIds: ["h1", "h2"],
          contradictingIds: [],
        },
        {
          model: "reviewer",
          text: "Reviewer lesson backed only by reviewer cases.",
          supportingIds: ["r1", "r2"],
          contradictingIds: [],
        },
        {
          model: "proposer",
          text: "Holding is not a force interaction by itself.",
          supportingIds: ["r1", "r2"],
          contradictingIds: ["h1"],
        },
        {
          model: "proposer",
          text: "Only one video supports this proposer lesson.",
          supportingIds: ["r1"],
          contradictingIds: [],
        },
        {
          model: "reviewer",
          text: "squeezing counts ONLY when deformation is visible!",
          supportingIds: ["h1", "h2"],
          contradictingIds: [],
        },
      ],
      cases,
    );
    assert.deepEqual(
      added.map((lesson) => [lesson.model, lesson.status]),
      [
        ["reviewer", "pending"],
        ["proposer", "needs_evidence"],
        ["proposer", "needs_evidence"],
      ],
    );
    assert.equal(lessonVersion(store.listLessons(), "reviewer"), "none");
    const accepted = await store.updateLesson(added[0].id, "accept");
    assert.equal(accepted.status, "active");
    assert.notEqual(store.version("reviewer"), "none");
    assert.match(
      renderLessons(store.listLessons(), "reviewer")!,
      /deformation is visible/,
    );
    const reloaded = new LearningStore(root);
    await reloaded.initialize();
    assert.equal(reloaded.version("reviewer"), store.version("reviewer"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function jpegFrames(dir: string, count: number): Promise<ModelFrame[]> {
  const jpeg = await sharp({
    create: { width: 16, height: 16, channels: 3, background: "white" },
  })
    .jpeg()
    .toBuffer();
  const frames: ModelFrame[] = [];
  for (let i = 0; i < count; i++) {
    const file = path.join(dir, `f${i}.jpg`);
    await fs.writeFile(file, jpeg);
    frames.push({
      frameId: `f${i}`,
      seq: i,
      sourceTimeMs: i * 500,
      sha256: createHash("sha256").update(jpeg).digest("hex"),
      width: 16,
      height: 16,
      orientation: 1,
      path: file,
    });
  }
  return frames;
}

test("Nova proposals use a forced tool and one repair on invalid output", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-models-test-"));
  try {
    const config = loadDiscoveryConfig(
      { DISCOVERY_ACCESS_CODE: "d".repeat(32) },
      path.join(root, "runtime"),
    );
    config.limits.minCloudStartSpacingMs = 0;
    const frames = await jpegFrames(root, 3);
    const toolResponse = (input: unknown) => ({
      output: {
        message: {
          role: "assistant",
          content: [
            { toolUse: { toolUseId: "t1", name: "submit_proposals", input } },
          ],
        },
      },
      stopReason: "tool_use",
      usage: { inputTokens: 10, outputTokens: 5 },
    });
    const valid = {
      proposals: [
        {
          kind: "observed_action",
          subject: "bottle",
          startFrameId: "f0",
          endFrameId: "f2",
          observation: "A hand squeezes a bottle.",
          before: { text: "round", frameIds: ["f0"] },
          after: { text: "dented", frameIds: ["f2"] },
          evidenceFrameIds: ["f0", "f1", "f2"],
          objectiveIds: ["force-interaction"],
          limitations: [],
        },
      ],
    };
    // An unknown frame cannot be fitted or completed, so this still needs the repair turn.
    const invalid = {
      proposals: [
        {
          ...valid.proposals[0],
          startFrameId: null,
          evidenceFrameIds: ["f0", "f9", "f2"],
        },
      ],
    };
    // Evidence missing boundary/transition frames is bookkeeping and gets completed.
    const incompleteEvidence = {
      proposals: [{ ...valid.proposals[0], evidenceFrameIds: ["f1", "f1"] }],
    };
    const reversed = {
      proposals: [
        { ...valid.proposals[0], startFrameId: "f2", endFrameId: "f0" },
      ],
    };
    const afterBeforeBefore = {
      proposals: [
        {
          ...valid.proposals[0],
          before: { text: "dented", frameIds: ["f2"] },
          after: { text: "round", frameIds: ["f0"] },
        },
      ],
    };
    const requests: any[] = [];
    const replies = [
      toolResponse(invalid),
      toolResponse(valid),
      toolResponse(invalid),
      toolResponse(invalid),
      toolResponse(incompleteEvidence),
      toolResponse(reversed),
      toolResponse(afterBeforeBefore),
      toolResponse(afterBeforeBefore),
    ];
    const transport = {
      converse: async (_model: string, request: any) => (
        requests.push(request),
        replies.shift()
      ),
    } as any;
    const store = { appendLedger: async () => undefined } as any;
    const models = new DiscoveryModels(
      config,
      store,
      transport,
      new GlobalCloudDispatcher(config),
    );
    const repaired = await models.propose(
      "s",
      1,
      "phone",
      "h",
      frames,
      "periodic",
      [],
    );
    assert.equal(repaired.repaired, true);
    assert.equal(repaired.response.proposals[0].after?.text, "dented");
    assert.deepEqual(requests[0].toolConfig.toolChoice, {
      tool: { name: "submit_proposals" },
    });
    assert.deepEqual(
      requests[0].toolConfig.tools[0].toolSpec.inputSchema.json.properties
        .proposals.items.properties.startFrameId.enum,
      ["f0", "f1", "f2"],
    );
    assert.equal(requests[1].messages[2].content[0].toolResult.status, "error");
    await assert.rejects(
      models.propose("s", 1, "phone", "h", frames, "periodic", []),
      (error) => error instanceof ModelOutputError,
    );
    const completed = await models.propose(
      "s",
      1,
      "phone",
      "h",
      frames,
      "periodic",
      [],
    );
    assert.equal(completed.repaired, false);
    assert.deepEqual(completed.response.proposals[0].evidenceFrameIds, [
      "f1",
      "f0",
      "f2",
    ]);
    // Start/end follow the cited frames (the judge's live failure cited a before frame earlier than its start).
    const refit = await models.propose(
      "s",
      1,
      "phone",
      "h",
      frames,
      "periodic",
      [],
    );
    assert.equal(refit.repaired, false);
    assert.equal(refit.response.proposals[0].startFrameId, "f0");
    assert.equal(refit.response.proposals[0].endFrameId, "f2");
    // A real claim error, after shown before before, is still rejected.
    await assert.rejects(
      models.propose("s", 1, "phone", "h", frames, "periodic", []),
      (error) =>
        error instanceof ModelOutputError &&
        /Before must precede after/.test(error.validation),
    );
    // Lesson drafting goes to the configured drafter model (Opus 4.6 by default).
    const called: string[] = [];
    const drafter = new DiscoveryModels(
      config,
      store,
      {
        converse: async (modelId: string) => (
          called.push(modelId),
          {
            output: { message: { content: [{ text: '{"lessons":[]}' }] } },
            usage: {},
          }
        ),
      } as any,
      new GlobalCloudDispatcher(config),
    );
    const drafted = await drafter.draft({
      system: "system",
      content: [{ text: "cases" }],
      replaceableIds: [],
      retirableIds: [],
    });
    assert.deepEqual(drafted.response, { lessons: [], retire: [] });
    assert.deepEqual(called, ["us.anthropic.claude-opus-4-6-v1"]);
    assert.equal(config.reviewerModelId, "us.anthropic.claude-opus-4-6-v1");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("reviewed proposals become cards with kept frames, and feedback outlives the session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-cards-test-"));
  const config = loadDiscoveryConfig(
    { DISCOVERY_ACCESS_CODE: "e".repeat(32) },
    path.join(root, "runtime"),
  );
  config.limits.minCloudStartSpacingMs = 0;
  const service = await DiscoveryService.create(config);
  const internal = service as any;
  const proposed = {
    kind: "scene_context",
    subject: "desk",
    startFrameId: "",
    endFrameId: "",
    observation: "A bottle rests on a desk.",
    before: null,
    after: null,
    evidenceFrameIds: [] as string[],
    objectiveIds: ["equilibrium-support"],
    limitations: [],
  };
  internal.models.propose = async (
    _s: string,
    _g: number,
    _k: string,
    _h: string,
    frames: ModelFrame[],
  ) => ({
    attemptId: "p1",
    promptHash: "ph",
    repaired: false,
    rawText: "{}",
    usage: {},
    latencyMs: 1,
    response: {
      proposals: [
        {
          ...proposed,
          startFrameId: frames[0].frameId,
          endFrameId: frames[0].frameId,
          evidenceFrameIds: [frames[0].frameId],
        },
      ],
    },
  });
  internal.models.review = async () => ({
    attemptId: "r1",
    promptHash: "rh",
    rawText: "{}",
    usage: {},
    latencyMs: 1,
    response: {
      verdict: "not_teachable",
      reason: "No specific support arrangement.",
      opportunities: [],
    },
  });
  try {
    const created = await service.createSession(
      { sourceKind: "phone", mode: "live" },
      "cards_test_key_1",
    );
    const session = await service.start(created.id, created.generation);
    const jpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const sha256 = createHash("sha256").update(jpeg).digest("hex");
    for (let seq = 0; seq < 16; seq += 4) {
      const frames = [0, 1, 2, 3].map((k) => ({
        frameId: `usb_${seq + k}`,
        seq: seq + k,
        sourceTimeMs: (seq + k) * 250,
        sha256,
        partName: `frame_${seq + k}`,
      }));
      await service.ingestPhoneBatch(
        {
          sessionId: session.id,
          generation: session.generation,
          batchId: `cards_batch_${seq}`,
          timingMethod: "performanceNow",
          frames,
        } as any,
        frames.map((frame) => ({
          partName: frame.partName,
          bytes: jpeg,
          mimeType: "image/jpeg",
        })),
      );
    }
    await service.stop(session.id, session.generation);
    for (
      let i = 0;
      i < 50 && service.captureStatus(session.id).state !== "completed";
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 10));
    const card = service.getSession(session.id) as any;
    const candidate = card.candidates.find(
      (item: any) => item.cardKind === "not_teachable",
    );
    assert.ok(candidate, "a red card exists");
    const detail = await service.candidateDetail(session.id, candidate.id);
    assert.equal(detail.review?.reason, "No specific support arrangement.");
    assert.ok(detail.frames.length >= 2);
    assert.equal(detail.frames[0].evidence, true);
    const saved = await service.saveFeedback(session.id, candidate.id, {
      correct: false,
      verdictTag: "should_approve",
      issueTags: ["evidence_not_visible"],
      note: "The bottle is balanced on its edge.",
    });
    assert.equal(saved.framesKept, detail.frames.length);
    await fs.rm(service.store.sessionDir(session.id), {
      recursive: true,
      force: true,
    });
    const durable = await service.candidateFramePath(
      session.id,
      candidate.id,
      0,
    );
    assert.match(durable, /learning/);
    const overview = service.learningOverview();
    assert.equal(overview.report.totals.labels, 1);
    assert.equal(overview.report.groups[0].falseRejections, 1);
  } finally {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the judge answers through a forced tool; analysis is kept out of the verdict and prose is repaired", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-judge-test-"));
  try {
    const config = loadDiscoveryConfig(
      { DISCOVERY_ACCESS_CODE: "f".repeat(32) },
      path.join(root, "runtime"),
    );
    config.limits.minCloudStartSpacingMs = 0;
    const frames = await jpegFrames(root, 3);
    const prose = {
      output: {
        message: {
          role: "assistant",
          content: [{ text: "I need to look closely first." }],
        },
      },
      stopReason: "end_turn",
      usage: {},
    };
    const tool = {
      output: {
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId: "t2",
                name: "submit_review",
                input: {
                  analysis: "Only a resting bottle is visible.",
                  verdict: "not_teachable",
                  reason: "No specific supported connection.",
                  opportunities: [],
                },
              },
            },
          ],
        },
      },
      stopReason: "tool_use",
      usage: {},
    };
    const requests: any[] = [];
    const replies = [prose, tool];
    const models = new DiscoveryModels(
      config,
      { appendLedger: async () => undefined } as any,
      {
        converse: async (_m: string, request: any) => (
          requests.push(request),
          replies.shift()
        ),
      } as any,
      new GlobalCloudDispatcher(config),
    );
    const review = await models.review(
      "s",
      1,
      "phone",
      "h",
      frames,
      "periodic",
      [],
    );
    assert.equal(review.repaired, true);
    assert.deepEqual(review.response, {
      verdict: "not_teachable",
      reason: "No specific supported connection.",
      opportunities: [],
    });
    assert.match(review.rawText, /resting bottle/);
    assert.deepEqual(requests[0].toolConfig.toolChoice, {
      tool: { name: "submit_review" },
    });
    assert.equal(
      requests[0].toolConfig.tools[0].toolSpec.inputSchema.json.required[0],
      "analysis",
    );
    assert.deepEqual(
      requests[0].toolConfig.tools[0].toolSpec.inputSchema.json.properties
        .opportunities.items.properties.startFrameId.enum,
      ["f0", "f1", "f2"],
    );
    assert.match(requests[1].messages[2].content[0].text, /Validation failed/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
