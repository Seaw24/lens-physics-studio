import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { GlobalCloudDispatcher } from "../server/bedrock";
import { loadDiscoveryConfig } from "../server/discovery/config";
import { DiscoveryModels, type ModelFrame } from "../server/discovery/models";
import {
  GroundedOpportunitySchema,
  ReviewResponseSchema,
  publicOpportunity,
} from "../shared/discovery";
import {
  buildReport,
  humanTruth,
  isRepeatLabel,
  judgeLabelOutcome,
  selectReviewerExamples,
  sessionScore,
  verdictLabel,
  type FeedbackRecord,
  type FeedbackRequest,
  type ProposerOutcome,
} from "../shared/learning";

const proposal = {
  kind: "observed_action" as const,
  subject: "can",
  observation: "A hand slides a can across a table.",
  before: "can at left",
  after: "can at right",
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
    reviewReason: "no displacement",
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

const correct: FeedbackRequest = {
  correct: true,
  verdictTag: null,
  issueTags: [],
  note: "",
};
const notCorrect = (
  verdictTag: "should_approve" | "should_reject" | "wrong_details",
  issueTags: FeedbackRequest["issueTags"] = [],
): FeedbackRequest => ({ correct: false, verdictTag, issueTags, note: "" });

test("a repeat is teachable content, scored apart from wrong approvals", () => {
  const repeat = notCorrect("should_reject", ["already_covered"]);
  assert.equal(humanTruth("approved", repeat), true);
  assert.equal(humanTruth("already_covered", correct), true);
  assert.equal(humanTruth("already_covered", notCorrect("should_approve")), true);
  assert.equal(humanTruth("already_covered", notCorrect("should_reject")), false);
  assert.equal(judgeLabelOutcome("approved", repeat), "missed_repeat");
  assert.equal(
    judgeLabelOutcome("approved", notCorrect("should_reject")),
    "false_approval",
  );
  assert.equal(
    judgeLabelOutcome("already_covered", notCorrect("should_approve")),
    "wrong_merge",
  );
  assert.equal(
    judgeLabelOutcome("already_covered", notCorrect("should_reject")),
    "false_approval",
  );
  assert.equal(judgeLabelOutcome("already_covered", correct), "agreement");
  assert.equal(
    judgeLabelOutcome("not_teachable", notCorrect("should_approve")),
    "false_rejection",
  );
  assert.equal(
    verdictLabel("already_covered", "should_approve"),
    "New concept — should be its own card",
  );
  assert.equal(
    verdictLabel("approved", "should_approve"),
    "Should have been approved",
  );
});

test("repeat labels never become cross-video teachability examples", () => {
  const picked = selectReviewerExamples(
    [
      record({
        candidateId: "tagged",
        sessionId: "a",
        cardKind: "approved",
        reviewVerdict: "teachable",
        feedback: {
          ...notCorrect("should_reject", ["already_covered"]),
          updatedAt: "2026-09-16T00:00:00Z",
        },
      }),
      record({
        candidateId: "covered",
        sessionId: "b",
        cardKind: "already_covered",
        reviewVerdict: "teachable",
      }),
      record({ candidateId: "plain", sessionId: "c" }),
    ],
    "current",
  );
  assert.deepEqual(
    picked.map((item) => item.candidateId),
    ["plain"],
  );
  // "Nothing teachable here" on an already-covered card is a teachability label.
  assert.equal(
    isRepeatLabel(
      record({
        cardKind: "already_covered",
        feedback: { ...notCorrect("should_reject"), updatedAt: "t" },
      }),
    ),
    false,
  );
});

test("report and session score count repeats caught, missed, and wrongly merged", () => {
  const outcome = (
    candidateId: string,
    alreadyCovered: boolean,
  ): ProposerOutcome => ({
    candidateId,
    sessionId: "s",
    at: "t",
    proposerLessonVersion: "none",
    reviewerLessonVersion: "none",
    reviewerModelId: "judge",
    proposals: [proposal],
    reviewVerdict: "teachable",
    reviewReason: null,
    alreadyCovered,
  });
  const labeled = (
    candidateId: string,
    cardKind: FeedbackRecord["cardKind"],
    feedback: FeedbackRequest,
  ) =>
    record({
      candidateId,
      cardKind,
      reviewVerdict: "teachable",
      feedback: { ...feedback, updatedAt: "t" },
    });
  const report = buildReport(
    [outcome("a", false), outcome("b", true), outcome("c", true)],
    [
      labeled("a", "approved", notCorrect("should_reject", ["already_covered"])),
      labeled("b", "already_covered", correct),
      labeled("c", "already_covered", notCorrect("should_approve")),
    ],
  );
  const [group] = report.groups;
  assert.equal(group.alreadyCovered, 2);
  assert.equal(group.missedRepeats, 1);
  assert.equal(group.repeatsCaught, 1);
  assert.equal(group.wrongMerges, 1);
  assert.equal(group.falseApprovals, 0);
  assert.equal(group.falseRejections, 0);
  assert.equal(group.reviewerAgreements, 1);

  const score = sessionScore([
    {
      cardKind: "already_covered",
      reviewVerdict: "teachable",
      proposerProposalCount: 1,
      humanFeedback: { ...notCorrect("should_approve"), updatedAt: "t" },
    },
    {
      cardKind: "approved",
      reviewVerdict: "teachable",
      proposerProposalCount: 1,
      humanFeedback: {
        ...notCorrect("should_reject", ["already_covered"]),
        updatedAt: "t",
      },
    },
  ]);
  assert.equal(score.alreadyCovered, 1);
  assert.equal(score.wrongMerges, 1);
  assert.equal(score.missedRepeats, 1);
  assert.equal(score.falseApprovals, 0);
});

test("judge opportunities carry a concept and coverage that never reach the public event", () => {
  const judged = {
    kind: "scene_context" as const,
    subject: "table with plates",
    startFrameId: "f0",
    endFrameId: "f0",
    observation: "Plates rest on a table.",
    before: null,
    after: null,
    evidenceFrameIds: ["f0"],
    objectiveIds: ["equilibrium-support" as const],
    connection: "The table supports the plates' weight.",
    limitations: [],
    concept: "a support holds up a resting load",
    coveredBy: "C2",
  };
  const parsed = ReviewResponseSchema.parse({
    verdict: "teachable",
    reason: "Visible support arrangement.",
    opportunities: [judged],
  });
  assert.equal(parsed.opportunities[0].concept, judged.concept);
  assert.equal(parsed.opportunities[0].coveredBy, "C2");
  const grounded = publicOpportunity(parsed.opportunities[0]);
  assert.equal("concept" in grounded, false);
  assert.equal("coveredBy" in grounded, false);
  assert.equal(GroundedOpportunitySchema.safeParse(grounded).success, true);
  // Older judge answers without the new fields remain valid.
  const { concept: _c, coveredBy: _b, ...legacy } = judged;
  assert.equal(
    ReviewResponseSchema.safeParse({
      verdict: "teachable",
      reason: "Visible support arrangement.",
      opportunities: [legacy],
    }).success,
    true,
  );
});

test("video context lists covered concepts and earlier decisions for the judge", async () => {
  const { buildVideoContext, renderVideoContext } = await import(
    "../server/discovery/videoContext"
  );
  const human = (
    feedback: FeedbackRequest,
  ): FeedbackRecord["feedback"] => ({ ...feedback, updatedAt: "t" });
  const interval = (start: number) => ({
    startSeconds: start,
    endSeconds: start + 6,
  });
  const event = (id: string, candidateId: string, subject: string, start: number) => ({
    id,
    candidateId,
    review: {
      reason: `approved ${subject}`,
      eventSourceInterval: interval(start),
      opportunity: {
        subject,
        observation: `${subject} observed`,
        objectiveIds: ["force-interaction"],
      },
    },
  });
  const pushConcept = "a push sets a resting object sliding";
  const candidate = (id: string, overrides: Record<string, unknown>) => ({
    id,
    sourceInterval: interval(0),
    proposerProposalCount: 1,
    reviewVerdict: "not_teachable",
    reviewReason: "empty hallway",
    humanFeedback: null,
    ...overrides,
  });
  const rejected = Array.from({ length: 12 }, (_, index) =>
    candidate(`r${index + 2}`, {
      cardKind: "not_teachable",
      sourceInterval: interval(40 + index * 6),
    }),
  );
  const session: any = {
    events: [
      event("E1", "k1", "hand slides a can", 4),
      event("E2", "k2", "door swings", 20),
      event("E3", "k3", "hand turns a handle", 30),
    ],
    candidates: [
      candidate("k1", {
        cardKind: "approved",
        reviewVerdict: "teachable",
        sourceInterval: interval(4),
        humanFeedback: human(correct),
        opportunities: [
          {
            concept: pushConcept,
            subject: "hand slides a can",
            observation: "",
            connection: "",
            objectiveIds: ["force-interaction"],
            eventId: "E1",
            coveredBy: null,
          },
        ],
      }),
      candidate("k2", {
        cardKind: "approved",
        reviewVerdict: "teachable",
        sourceInterval: interval(20),
        humanFeedback: human({
          ...notCorrect("should_reject", ["action_not_happened"]),
          note: "camera turned",
        }),
      }),
      candidate("k3", {
        cardKind: "approved",
        reviewVerdict: "teachable",
        sourceInterval: interval(30),
        humanFeedback: human(notCorrect("should_reject", ["already_covered"])),
      }),
      candidate("r1", {
        cardKind: "not_teachable",
        reviewReason: "plate position unclear",
        sourceInterval: interval(12),
        novaProposals: [
          {
            kind: "observed_action",
            subject: "plate thrown",
            observation: "A plate flies up.",
            objectiveIds: ["released-object-motion"],
          },
        ],
        humanFeedback: human({
          ...notCorrect("should_approve"),
          note: "I threw it",
        }),
      }),
      ...rejected,
      candidate("r14", {
        cardKind: "insufficient_evidence",
        reviewVerdict: "insufficient_evidence",
        reviewReason: "blurry",
        sourceInterval: interval(100),
        humanFeedback: human(correct),
      }),
      candidate("a1", {
        cardKind: "already_covered",
        reviewVerdict: "teachable",
        sourceInterval: interval(2),
        humanFeedback: human({
          ...notCorrect("should_approve"),
          note: "lifting is different",
        }),
        opportunities: [
          {
            concept: "a lift raises an object against gravity",
            subject: "hand lifts can",
            observation: "",
            connection: "",
            objectiveIds: ["force-interaction"],
            eventId: null,
            coveredBy: {
              candidateId: "k1",
              eventId: "E1",
              concept: pushConcept,
              subject: "hand slides a can",
              startSeconds: 4,
            },
          },
        ],
      }),
      candidate("now", { cardKind: null, reviewVerdict: null }),
    ],
  };
  const context = buildVideoContext(session, "now");
  // Only published events cover a concept; human corrections stay decisions,
  // so a concept the human wanted as a card can still be published later.
  assert.deepEqual(
    context.covered.map((entry) => [entry.ref, entry.coverage.candidateId]),
    [["C1", "k1"]],
  );
  assert.equal(context.covered[0].coverage.eventId, "E1");
  assert.equal(context.covered[0].coverage.concept, pushConcept);
  assert.equal(context.decisions.length, 10);
  const decided = context.decisions.map((item) => item.candidateId);
  for (const labeled of ["k2", "r1", "r14", "a1"])
    assert.ok(decided.includes(labeled), `${labeled} is a labeled decision`);
  assert.ok(!decided.includes("r2"), "the oldest unlabeled decision is dropped");
  assert.ok(!decided.includes("k3") && !decided.includes("now"));
  const starts = context.decisions.map((item) => item.startSeconds ?? 0);
  assert.deepEqual(starts, [...starts].sort((a, b) => a - b));

  const text = renderVideoContext(context)!;
  assert.match(text, /does not describe the images below/);
  assert.match(text, /C1 · 4\.0–10\.0 s · concept: a push sets a resting object sliding/);
  assert.match(text, /not teachable \(Nova proposed "plate thrown"\).*I threw it/);
  assert.match(
    text,
    /judged a repeat of "hand slides a can" \(concept: a lift raises an object against gravity\).*New concept — should be its own card: "lifting is different"/,
  );
  assert.match(text, /EARLIER DECISIONS/);
  assert.match(text, /camera turned/);
  assert.equal(
    renderVideoContext(buildVideoContext({ events: [], candidates: [] } as any)),
    null,
  );
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

test("the judge sees this video's covered concepts and must cite a real ref", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-concept-judge-"));
  try {
    const config = loadDiscoveryConfig(
      { DISCOVERY_ACCESS_CODE: "g".repeat(32) },
      path.join(root, "runtime"),
    );
    config.limits.minCloudStartSpacingMs = 0;
    const frames = await jpegFrames(root, 3);
    const concept = "a push sets a resting object sliding";
    const reply = (coveredBy: string, toolUseId: string) => ({
      output: {
        message: {
          role: "assistant",
          content: [
            {
              toolUse: {
                toolUseId,
                name: "submit_review",
                input: {
                  analysis: "A hand pushes a table; compare with C1.",
                  verdict: "teachable",
                  reason: "A visible push.",
                  opportunities: [
                    {
                      kind: "scene_context",
                      subject: "hand on a table",
                      startFrameId: "f0",
                      endFrameId: "f0",
                      observation: "A hand pushes a table.",
                      evidenceFrameIds: ["f0"],
                      objectiveIds: ["force-interaction"],
                      connection: "Contact push.",
                      concept,
                      coveredBy,
                      limitations: [],
                    },
                  ],
                },
              },
            },
          ],
        },
      },
      stopReason: "tool_use",
      usage: {},
    });
    const requests: any[] = [];
    const replies = [reply("C9", "t1"), reply("C1", "t2"), reply("none", "t3")];
    const models = new DiscoveryModels(
      config,
      { appendLedger: async () => undefined } as any,
      {
        converse: async (_model: string, request: any) => (
          requests.push(request),
          replies.shift()
        ),
      } as any,
      new GlobalCloudDispatcher(config),
    );
    const video = {
      text: `THIS VIDEO SO FAR\nC1 · 4.0–10.0 s · concept: ${concept}`,
      refs: ["C1"],
    };
    const review = await models.review(
      "s",
      1,
      "phone",
      "h",
      frames,
      "periodic",
      [],
      undefined,
      undefined,
      undefined,
      video,
    );
    assert.equal(review.repaired, true);
    assert.equal(review.response.opportunities[0].coveredBy, "C1");
    assert.equal(review.response.opportunities[0].concept, concept);
    assert.equal(requests[0].messages[0].content[0].text, video.text);
    const item =
      requests[0].toolConfig.tools[0].toolSpec.inputSchema.json.properties
        .opportunities.items;
    assert.deepEqual(item.properties.coveredBy.enum, ["none", "C1"]);
    assert.ok(item.required.includes("concept"));
    assert.ok(item.required.includes("coveredBy"));
    assert.equal(item.properties.replacesCovered.type, "boolean");
    assert.match(
      JSON.stringify(requests[1].messages[2].content),
      /coveredBy C9 is not a covered concept/,
    );
    assert.match(
      requests[0].system.map((block: any) => block.text).join("\n"),
      /one card per physics concept/i,
    );
    const uncovered = await models.review(
      "s",
      1,
      "phone",
      "h",
      frames,
      "periodic",
      [],
      undefined,
      undefined,
      undefined,
      video,
    );
    assert.equal(uncovered.response.opportunities[0].coveredBy, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a window repeating a covered concept becomes an already-covered card and publishes nothing", async () => {
  const { DiscoveryService } = await import("../server/discovery/service");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-concept-service-"));
  const config = loadDiscoveryConfig(
    { DISCOVERY_ACCESS_CODE: "h".repeat(32) },
    path.join(root, "runtime"),
  );
  config.limits.minCloudStartSpacingMs = 0;
  const service = await DiscoveryService.create(config);
  const internal = service as any;
  const hash = "a".repeat(64);
  let clipCalls = 0;
  let failClipCall = -1;
  internal.media.publishPhoneClip = async () => {
    clipCalls++;
    if (clipCalls === failClipCall) throw new Error("ffmpeg crashed");
    return {
    record: {
      assetId: `asset_${Math.random().toString(36).slice(2)}`,
      relativePath: "assets/clip.mp4",
      mimeType: "video/mp4",
      size: 1,
      sha256: hash,
    },
    probe: { width: 16, height: 16 },
    };
  };
  const pushConcept = "a push sets a resting object sliding";
  const opportunity = (
    frame: ModelFrame,
    subject: string,
    concept: string,
    coveredBy: string | null,
  ) => ({
    kind: "scene_context",
    subject,
    startFrameId: frame.frameId,
    endFrameId: frame.frameId,
    observation: `${subject}.`,
    before: null,
    after: null,
    evidenceFrameIds: [frame.frameId],
    objectiveIds: ["force-interaction"],
    connection: "Contact force changes motion.",
    concept,
    coveredBy,
    limitations: [],
  });
  const videoArgs: any[] = [];
  const reviews: Array<(frames: ModelFrame[]) => unknown[]> = [
    (frames) => [opportunity(frames[0], "hand slides a can", pushConcept, null)],
    (frames) => [
      opportunity(frames[0], "hand pushes a table", "a push moves a table", "C1"),
    ],
    (frames) => [
      opportunity(frames[0], "hand pushes the can again", pushConcept, "C1"),
      opportunity(frames[1], "can tab lifted", "a lever turns about its pivot", null),
    ],
    // A covered repeat plus a new action that a capture gap blocks.
    (frames) => [
      opportunity(frames[0], "hand pushes the can once more", pushConcept, "C1"),
      {
        ...opportunity(frames[0], "pen dropped", "a released object falls", null),
        kind: "observed_action",
        endFrameId: frames[1].frameId,
        before: { text: "pen held", frameIds: [frames[0].frameId] },
        after: { text: "pen on floor", frameIds: [frames[1].frameId] },
        evidenceFrameIds: [frames[0].frameId, frames[1].frameId],
      },
    ],
    // Two new concepts; publishing the second one crashes.
    (frames) => [
      opportunity(frames[0], "hand squeezes a bottle", "a squeeze deforms an object", null),
      opportunity(frames[1], "ball rolls to a stop", "friction slows a rolling object", null),
    ],
  ];
  internal.models.propose = async (...args: any[]) => ({
    attemptId: "p1",
    promptHash: hash,
    repaired: false,
    rawText: "{}",
    usage: {},
    latencyMs: 1,
    response: {
      proposals: [
        {
          ...opportunity(args[4][0], "can on a table", "unused", null),
          connection: undefined,
          concept: undefined,
          coveredBy: undefined,
        },
      ],
    },
  });
  internal.models.review = async (...args: any[]) => {
    videoArgs.push(args[10]);
    return {
      attemptId: `r${videoArgs.length}`,
      promptHash: hash,
      rawText: '{"analysis":"compared"}',
      usage: {},
      latencyMs: 1,
      response: {
        verdict: "teachable",
        reason: "A visible push.",
        opportunities: reviews.shift()!(args[4]),
      },
    };
  };
  try {
    const created = await service.createSession(
      { sourceKind: "phone", mode: "live" },
      "concept_service_key",
    );
    const session = await service.start(created.id, created.generation);
    const dir = service.store.sessionDir(session.id);
    const jpeg = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const sha256 = createHash("sha256").update(jpeg).digest("hex");
    const windowFrames = async (window: number, indices = [0, 1, 2, 3]) => {
      const frames: ModelFrame[] = [];
      for (const i of indices) {
        const frameId = `w${window}_${i}`;
        const file = path.join(dir, "frames", `${frameId}.jpg`);
        await fs.writeFile(file, jpeg);
        frames.push({
          frameId,
          seq: window * 10 + i,
          sourceTimeMs: window * 6_000 + i * 500,
          sha256,
          width: 16,
          height: 16,
          orientation: 1,
          path: file,
        });
      }
      await internal.store.mutate(session.id, (value: any) => {
        for (const { path: _path, ...frame } of frames) value.frames.push(frame);
        value.observedSourceMs = 60_000;
      });
      return frames;
    };
    const run = async (window: number, indices?: number[]) =>
      internal.processSnapshot(
        session.id,
        session.generation,
        await windowFrames(window, indices),
        ["periodic"],
        { startMs: window * 6_000, endMs: window * 6_000 + 6_000 },
        new AbortController().signal,
      );

    await run(0);
    let state = service.getSession(session.id) as any;
    assert.equal(state.events.length, 1);
    const first = state.candidates[0];
    assert.equal(first.cardKind, "approved");
    assert.equal(first.state, "approved");
    assert.equal(first.opportunities[0].concept, pushConcept);
    assert.equal(first.opportunities[0].eventId, state.events[0].id);
    assert.equal("concept" in state.events[0].review.opportunity, false);
    assert.equal(first.novaProposals[0].subject, "can on a table");
    assert.deepEqual(videoArgs[0], { text: null, refs: [] });

    await run(1);
    state = service.getSession(session.id) as any;
    assert.equal(state.events.length, 1, "the repeat publishes no event");
    const repeat = state.candidates[1];
    assert.equal(repeat.cardKind, "already_covered");
    assert.equal(repeat.state, "suppressed_duplicate");
    assert.equal(repeat.suppressionReason, `already_covered_by_${first.id}`);
    assert.equal(repeat.opportunities[0].coveredBy.eventId, state.events[0].id);
    assert.equal(repeat.opportunities[0].coveredBy.concept, pushConcept);
    assert.deepEqual(videoArgs[1].refs, ["C1"]);
    assert.match(videoArgs[1].text, /C1 · .*a push sets a resting object sliding/);
    const stage = JSON.parse(
      await fs.readFile(
        path.join(dir, "candidates", `${repeat.id}-reviewer.json`),
        "utf8",
      ),
    );
    assert.match(stage.videoContext.text, /a push sets a resting object sliding/);

    await run(2);
    state = service.getSession(session.id) as any;
    assert.equal(state.events.length, 2, "only the new concept publishes");
    const mixed = state.candidates[2];
    assert.equal(mixed.cardKind, "approved");
    assert.ok(mixed.opportunities[0].coveredBy);
    assert.equal(mixed.opportunities[1].eventId, state.events[1].id);

    // Frames 1.5 s apart: the new action crosses a capture gap, so the card is not a repeat.
    await run(3, [0, 3]);
    state = service.getSession(session.id) as any;
    const gapped = state.candidates[3];
    assert.equal(state.events.length, 2);
    assert.equal(gapped.cardKind, "insufficient_evidence");
    assert.equal(gapped.errorCode, "CAPTURE_GAP");
    assert.equal(gapped.opportunities.length, 2);

    failClipCall = clipCalls + 2;
    await run(4);
    state = service.getSession(session.id) as any;
    const crashed = state.candidates[4];
    assert.equal(state.events.length, 3, "the first concept still published");
    assert.equal(crashed.state, "failed");
    assert.equal(crashed.cardKind, "approved");
    assert.equal(crashed.opportunities.length, 1);
    assert.equal(crashed.opportunities[0].eventId, state.events[2].id);

    const outcomes = service.learning.outcomeList();
    assert.deepEqual(
      outcomes.map((item) => item.alreadyCovered),
      [false, true, false, false, false],
    );
    const detail = await service.candidateDetail(session.id, repeat.id);
    assert.equal(detail.opportunities[0].coveredBy?.eventId, state.events[0].id);
  } finally {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("a clearly better repeat takes over its concept's card unless the human labeled it", async () => {
  const { DiscoveryService } = await import("../server/discovery/service");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-concept-upgrade-"));
  const config = loadDiscoveryConfig(
    { DISCOVERY_ACCESS_CODE: "h".repeat(32) },
    path.join(root, "runtime"),
  );
  config.limits.minCloudStartSpacingMs = 0;
  const service = await DiscoveryService.create(config);
  const internal = service as any;
  const hash = "a".repeat(64);
  internal.media.publishPhoneClip = async () => ({
    record: {
      assetId: `asset_${Math.random().toString(36).slice(2)}`,
      relativePath: "assets/clip.mp4",
      mimeType: "video/mp4",
      size: 1,
      sha256: hash,
    },
    probe: { width: 16, height: 16 },
  });
  const pushConcept = "a push sets a resting object sliding";
  const opportunity = (
    frame: ModelFrame,
    subject: string,
    coveredBy: string | null,
    replacesCovered: boolean,
  ) => ({
    kind: "scene_context",
    subject,
    startFrameId: frame.frameId,
    endFrameId: frame.frameId,
    observation: `${subject}.`,
    before: null,
    after: null,
    evidenceFrameIds: [frame.frameId],
    objectiveIds: ["force-interaction"],
    connection: "Contact force changes motion.",
    concept: pushConcept,
    coveredBy,
    replacesCovered,
    limitations: ["the can is half out of frame"],
  });
  const videoArgs: any[] = [];
  const reviews: Array<(frames: ModelFrame[]) => unknown[]> = [
    (frames) => [opportunity(frames[0], "hand nudges a can", null, false)],
    // Better, twice in one review: the second repeat covers the new card.
    (frames) => [
      opportunity(frames[0], "a kick sends a box skidding", "C1", true),
      opportunity(frames[1], "the box skids again", "C1", true),
    ],
    // Better again, but the human already confirmed the covered card.
    (frames) => [opportunity(frames[0], "a shove slides a sofa", "C1", true)],
  ];
  internal.models.propose = async (...args: any[]) => ({
    attemptId: "p1",
    promptHash: hash,
    repaired: false,
    rawText: "{}",
    usage: {},
    latencyMs: 1,
    response: {
      proposals: [
        {
          ...opportunity(args[4][0], "a can", null, false),
          connection: undefined,
          concept: undefined,
          coveredBy: undefined,
          replacesCovered: undefined,
        },
      ],
    },
  });
  internal.models.review = async (...args: any[]) => {
    videoArgs.push(args[10]);
    return {
      attemptId: `r${videoArgs.length}`,
      promptHash: hash,
      rawText: '{"analysis":"compared"}',
      usage: {},
      latencyMs: 1,
      response: {
        verdict: "teachable",
        reason: "A visible push.",
        opportunities: reviews.shift()!(args[4]),
      },
    };
  };
  try {
    const created = await service.createSession(
      { sourceKind: "phone", mode: "live" },
      "concept_upgrade_key",
    );
    const session = await service.start(created.id, created.generation);
    const dir = service.store.sessionDir(session.id);
    const jpeg = await sharp({
      create: { width: 16, height: 16, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const sha256 = createHash("sha256").update(jpeg).digest("hex");
    const run = async (window: number) => {
      const frames: ModelFrame[] = [];
      for (const i of [0, 1, 2, 3]) {
        const frameId = `w${window}_${i}`;
        const file = path.join(dir, "frames", `${frameId}.jpg`);
        await fs.writeFile(file, jpeg);
        frames.push({
          frameId,
          seq: window * 10 + i,
          sourceTimeMs: window * 6_000 + i * 500,
          sha256,
          width: 16,
          height: 16,
          orientation: 1,
          path: file,
        });
      }
      await internal.store.mutate(session.id, (value: any) => {
        for (const { path: _path, ...frame } of frames) value.frames.push(frame);
        value.observedSourceMs = 60_000;
      });
      await internal.processSnapshot(
        session.id,
        session.generation,
        frames,
        ["periodic"],
        { startMs: window * 6_000, endMs: window * 6_000 + 6_000 },
        new AbortController().signal,
      );
    };

    await run(0);
    let state = service.getSession(session.id) as any;
    const firstEvent = state.events[0];

    await run(1);
    state = service.getSession(session.id) as any;
    assert.match(videoArgs[1].text, /C1 · .*scene context.*limits: the can is half out of frame/);
    assert.equal(state.events.length, 1, "the better card replaces, not adds");
    assert.notEqual(state.events[0].id, firstEvent.id);
    assert.equal("retiredEvents" in state, false);
    const [first, better] = state.candidates;
    assert.equal(better.cardKind, "approved");
    assert.equal(better.opportunities[0].eventId, state.events[0].id);
    assert.equal(better.opportunities[0].replaced.eventId, firstEvent.id);
    assert.equal(better.opportunities[1].eventId, null);
    assert.equal(better.opportunities[1].coveredBy.eventId, state.events[0].id);
    assert.equal(first.cardKind, "already_covered");
    assert.equal(first.state, "suppressed_duplicate");
    assert.equal(first.suppressionReason, `replaced_by_${better.id}`);
    assert.equal(first.opportunities[0].eventId, null);
    assert.equal(first.opportunities[0].coveredBy.candidateId, better.id);
    assert.equal((await service.getEvent(firstEvent.id)).id, firstEvent.id);

    await internal.store.mutate(session.id, (value: any) => {
      value.candidates[1].humanFeedback = {
        ...correct,
        updatedAt: "2026-09-16T00:00:00Z",
      };
    });
    await run(2);
    state = service.getSession(session.id) as any;
    const kept = state.candidates[2];
    assert.equal(state.events.length, 1);
    assert.equal(state.events[0].candidateId, better.id);
    assert.equal(kept.cardKind, "already_covered");
    assert.equal(kept.suppressionReason, `already_covered_by_${better.id}`);
  } finally {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
