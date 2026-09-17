import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  LessonDraftResponseSchema,
  LessonUpdateSchema,
  MAX_ACTIVE_LESSONS,
} from "../shared/learning";
import { LearningStore } from "../server/discovery/learning";

async function withStore(
  work: (store: LearningStore, root: string) => Promise<void>,
) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-drafting-test-"));
  try {
    const store = new LearningStore(root);
    await store.initialize();
    await work(store, root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

const cases = new Map([
  ["h1", { sessionId: "v1", human: true }],
  ["h2", { sessionId: "v2", human: true }],
]);
const draft = (
  model: "proposer" | "reviewer",
  text: string,
  replacesLessonIds: string[] = [],
) => ({
  model,
  text,
  supportingIds: ["h1", "h2"],
  contradictingIds: [],
  replacesLessonIds,
});

test("drafts never re-add a rejected lesson and replace only same-model live lessons", async () => {
  await withStore(async (store) => {
    const [refused, nova] = await store.addDraftedLessons(
      [
        draft("reviewer", "A hand near an object is not a push."),
        draft("proposer", "Propose only visible motion changes."),
      ],
      cases,
    );
    await store.updateLesson(refused.id, "reject");
    const again = await store.addDraftedLessons(
      [draft("reviewer", "a hand near an object is NOT a push!")],
      cases,
    );
    assert.equal(again.length, 0, "a rejected lesson stays rejected");
    const [replacement] = await store.addDraftedLessons(
      [
        draft(
          "proposer",
          "Propose a moment only when the object's motion visibly changes.",
          [nova.id, refused.id, "missing"],
        ),
      ],
      cases,
    );
    assert.deepEqual(replacement.replaces, [nova.id]);
  });
});

test("accepting a replacement turns off what it replaces, even at the active cap", async () => {
  await withStore(async (store) => {
    const drafts = Array.from({ length: MAX_ACTIVE_LESSONS }, (_, index) =>
      draft("reviewer", `Reviewer rule number ${index} about visible evidence.`),
    );
    const added = await store.addDraftedLessons(drafts, cases);
    for (const lesson of added) await store.updateLesson(lesson.id, "accept");
    const [extra] = await store.addDraftedLessons(
      [draft("reviewer", "One more reviewer rule without replacement.")],
      cases,
    );
    await assert.rejects(store.updateLesson(extra.id, "accept"), /At most/);
    await store.suggestRetirements(
      [{ lessonId: added[0].id, reason: "Merged into a clearer rule.", supportingIds: ["h1"] }],
      cases,
    );
    const [merged] = await store.addDraftedLessons(
      [draft("reviewer", "A merged, clearer reviewer rule about evidence.", [added[0].id])],
      cases,
    );
    const accepted = await store.updateLesson(merged.id, "accept");
    assert.equal(accepted.status, "active");
    const replaced = store.listLessons().find((item) => item.id === added[0].id)!;
    assert.equal(replaced.status, "disabled");
    assert.equal(replaced.retireSuggestion ?? null, null);
  });
});

test("retire suggestions target live lessons, keep known cases, and can be dismissed", async () => {
  await withStore(async (store) => {
    const [active, rejected] = await store.addDraftedLessons(
      [
        draft("proposer", "Nova must not propose repeats across cards."),
        draft("proposer", "A refused proposer rule about lighting."),
      ],
      cases,
    );
    await store.updateLesson(active.id, "accept");
    await store.updateLesson(rejected.id, "reject");
    const updated = await store.suggestRetirements(
      [
        {
          lessonId: active.id,
          reason: "Nova never sees other cards.",
          supportingIds: ["h1", "unknown"],
        },
        { lessonId: rejected.id, reason: "Already rejected lesson.", supportingIds: [] },
        { lessonId: "missing", reason: "Unknown lesson ID here.", supportingIds: [] },
      ],
      cases,
    );
    assert.deepEqual(
      updated.map((lesson) => lesson.id),
      [active.id],
    );
    const suggested = store.listLessons().find((item) => item.id === active.id)!;
    assert.equal(suggested.retireSuggestion?.reason, "Nova never sees other cards.");
    assert.deepEqual(suggested.retireSuggestion?.supportingIds, ["h1"]);
    const kept = await store.updateLesson(active.id, "dismiss_suggestion");
    assert.equal(kept.status, "active");
    assert.equal(kept.retireSuggestion, null);
    await store.suggestRetirements(
      [{ lessonId: active.id, reason: "Suggested a second time.", supportingIds: [] }],
      cases,
    );
    const off = await store.updateLesson(active.id, "disable");
    assert.equal(off.retireSuggestion, null);
    const reloaded = new LearningStore(path.dirname(store.root));
    await reloaded.initialize();
    assert.equal(
      reloaded.listLessons().find((item) => item.id === active.id)?.status,
      "disabled",
    );
  });
});

test("draft and update schemas accept replacements, retirements, and dismissals", () => {
  const parsed = LessonDraftResponseSchema.parse({
    lessons: [
      {
        model: "reviewer",
        text: "A rule that replaces two older ones.",
        supportingIds: ["h1"],
        contradictingIds: [],
        replacesLessonIds: ["l1"],
      },
    ],
    retire: [{ lessonId: "l2", reason: "Contradicted by labels.", supportingIds: ["h2"] }],
  });
  assert.deepEqual(parsed.lessons[0].replacesLessonIds, ["l1"]);
  assert.equal(parsed.retire.length, 1);
  assert.deepEqual(LessonDraftResponseSchema.parse({ lessons: [] }), {
    lessons: [],
    retire: [],
  });
  assert.equal(
    LessonUpdateSchema.safeParse({ action: "dismiss_suggestion" }).success,
    true,
  );
});

function labelRecord(
  candidateId: string,
  cardKind: "approved" | "not_teachable",
  verdictTag: "should_approve" | "should_reject",
  note: string,
) {
  return {
    candidateId,
    sessionId: "legacy",
    sourceKind: "phone" as const,
    cardKind,
    proposals: [],
    reviewVerdict: cardKind === "approved" ? ("teachable" as const) : ("not_teachable" as const),
    reviewReason: "reason",
    feedback: {
      correct: false,
      verdictTag,
      issueTags: [],
      note,
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
  };
}

test("legacy 'already have this' rejections are tagged as repeats exactly once", async () => {
  const { tagRepeatNotes } = await import("../server/discovery/migrations");
  await withStore(async (store) => {
    await store.saveFeedback(labelRecord("dup", "approved", "should_reject", "have this already"), []);
    await store.saveFeedback(labelRecord("door", "approved", "should_reject", "The door did not rotate"), []);
    await store.saveFeedback(labelRecord("plate", "not_teachable", "should_approve", "already visible throw"), []);
    await store.saveFeedback(labelRecord("open", "approved", "should_reject", "The can was already open"), []);
    await store.saveFeedback(labelRecord("slide", "approved", "should_reject", "sliding the can around is already there"), []);
    assert.deepEqual((await tagRepeatNotes(store)).sort(), ["dup", "slide"]);
    assert.deepEqual(store.feedback("dup")!.feedback.issueTags, ["already_covered"]);
    assert.deepEqual(store.feedback("door")!.feedback.issueTags, []);
    assert.deepEqual(store.feedback("plate")!.feedback.issueTags, []);
    assert.deepEqual(store.feedback("open")!.feedback.issueTags, [], "'already open' is not a repeat");
    await store.updateRecord("dup", (record) => ({
      ...record,
      feedback: { ...record.feedback, issueTags: [] },
    }));
    assert.deepEqual(await tagRepeatNotes(store), [], "a removed tag stays removed");
  });
});

test("labels keep the judge's analysis, evidence, and video context beyond session retention", async () => {
  const { loadDiscoveryConfig } = await import("../server/discovery/config");
  const { DiscoveryService } = await import("../server/discovery/service");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-enrich-test-"));
  const config = loadDiscoveryConfig(
    { DISCOVERY_ACCESS_CODE: "k".repeat(32) },
    path.join(root, "runtime"),
  );
  const service = await DiscoveryService.create(config);
  const internal = service as any;
  try {
    const session = await service.createSession(
      { sourceKind: "phone", mode: "live" },
      "enrich_test_key",
    );
    const dir = service.store.sessionDir(session.id);
    const candidate = (id: string) => ({
      id,
      state: "approved",
      schedulingReasons: ["periodic"],
      sourceInterval: { startSeconds: 0, endSeconds: 6 },
      proposerProposalCount: 1,
      reviewVerdict: "teachable",
      reviewReason: "A visible push.",
      errorCode: null,
      suppressionReason: null,
      snapshotId: "none",
      proposerInvocationId: "p",
      proposerPromptHash: null,
      reviewerInvocationId: "r",
      reviewerPromptHash: null,
      contributingCandidateIds: [id],
      cardKind: "approved",
      opportunities: [
        {
          concept: "a push sets a resting object sliding",
          subject: "hand slides a can",
          observation: "The can moves.",
          connection: "Contact force.",
          objectiveIds: ["force-interaction"],
          eventId: "e1",
          coveredBy: null,
        },
      ],
    });
    await internal.store.mutate(session.id, (value: any) => {
      const old = candidate("old");
      delete (old as any).opportunities;
      value.candidates.push(candidate("labeled"), candidate("legacy"), old);
      value.events.push({
        id: "ev-old",
        candidateId: "old",
        review: { opportunity: { subject: "Hand slides a can" } },
      });
    });
    for (const id of ["labeled", "legacy", "old"]) {
      await fs.writeFile(
        path.join(dir, "candidates", `${id}-reviewer.json`),
        JSON.stringify({
          rawText: JSON.stringify({ analysis: "The can slides right while the hand pushes." }),
          response: {
            verdict: "teachable",
            reason: "A visible push.",
            opportunities: [
              { subject: "hand slides a can", evidenceFrameIds: ["f1", "f2"] },
            ],
          },
          videoContext: { text: "THIS VIDEO SO FAR\nC1 · concept: a lever turns about its pivot" },
        }),
      );
      await fs.writeFile(
        path.join(dir, "candidates", `${id}-proposer.json`),
        JSON.stringify({ response: { proposals: [{ evidenceFrameIds: ["f0"] }] } }),
      );
    }
    await service.saveFeedback(session.id, "labeled", {
      correct: true,
      verdictTag: null,
      issueTags: [],
      note: "",
    });
    const labeled = service.learning.feedback("labeled")!;
    assert.match(labeled.judge!.analysis!, /can slides right/);
    assert.equal(labeled.judge!.opportunities[0].concept, "a push sets a resting object sliding");
    assert.deepEqual(labeled.evidenceFrameIds, ["f1", "f2"]);
    assert.match(labeled.videoContext!, /lever turns about its pivot/);

    await service.learning.saveFeedback(
      { ...labelRecord("legacy", "approved", "should_reject", "wrong"), sessionId: session.id },
      [],
    );
    await service.learning.saveFeedback(
      { ...labelRecord("old", "approved", "should_reject", "wrong"), sessionId: session.id },
      [],
    );
    assert.equal(service.learning.feedback("legacy")!.judge, undefined);
    assert.equal(await internal.backfillJudgeDetails(), 2);
    assert.equal(
      service.learning.feedback("old")!.judge!.opportunities[0].eventId,
      "ev-old",
      "an older card's published event is found by subject",
    );
    const legacy = service.learning.feedback("legacy")!;
    assert.match(legacy.judge!.analysis!, /can slides right/);
    assert.deepEqual(legacy.evidenceFrameIds, ["f1", "f2"]);
    assert.equal(await internal.backfillJudgeDetails(), 0);
  } finally {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("contact sheets tile a card's frames within Claude's image budget", async () => {
  const sharp = (await import("sharp")).default;
  const {
    SHEET_MAX_EDGE,
    SHEET_MAX_PIXELS,
    buildContactSheet,
    layoutContactSheet,
    tileLabel,
  } = await import("../server/discovery/contactSheet");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-sheet-test-"));
  try {
    const frames = async (width: number, height: number, count: number) => {
      const bytes = await sharp({
        create: { width, height, channels: 3, background: "gray" },
      })
        .jpeg()
        .toBuffer();
      return Promise.all(
        Array.from({ length: count }, async (_, index) => {
          const file = path.join(root, `${width}x${height}_${index}.jpg`);
          await fs.writeFile(file, bytes);
          return {
            file,
            sourceTimeMs: index * 500,
            evidence: index % 3 === 0,
          };
        }),
      );
    };
    for (const [width, height] of [
      [72, 128],
      [128, 72],
    ]) {
      const sheet = await buildContactSheet(await frames(width, height, 12));
      const metadata = await sharp(sheet.bytes).metadata();
      assert.equal(metadata.format, "jpeg");
      assert.equal(metadata.width, sheet.width);
      assert.equal(metadata.height, sheet.height);
      assert.ok(sheet.width * sheet.height <= SHEET_MAX_PIXELS);
      assert.ok(Math.max(sheet.width, sheet.height) <= SHEET_MAX_EDGE);
      assert.ok(sheet.columns * sheet.rows >= 12);
    }
    const portrait = layoutContactSheet(12, 720 / 1280);
    assert.ok(portrait.tileHeight >= 380, "portrait tiles stay legible");
    const single = await buildContactSheet(await frames(64, 64, 1));
    assert.equal(single.columns, 1);
    assert.equal(single.rows, 1);
    assert.equal(tileLabel(0, null, false), "1 · still");
    assert.equal(tileLabel(2, 1_500, true), "3 · 1.5 s · evidence");
    await assert.rejects(buildContactSheet([]), /at least one frame/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("draft cases put commented disagreements first, cap images, and skip held-out videos", async () => {
  const { isHoldoutVideo } = await import("../shared/learning");
  const { selectDraftCases, MAX_IMAGED_CASES, MAX_JUDGE_ONLY_CASES } =
    await import("../server/discovery/draftContext");
  const visible = Array.from({ length: 200 }, (_, index) => `video-${index}`)
    .filter((id) => !isHoldoutVideo(id));
  const labeled = (index: number, overrides: Record<string, unknown>) => ({
    ...labelRecord(`c${index}`, "approved", "should_reject", ""),
    sessionId: visible[index % 5],
    framesKept: 12,
    feedback: {
      correct: true,
      verdictTag: null,
      issueTags: [],
      note: "",
      updatedAt: `2026-09-16T00:${String(index).padStart(2, "0")}:00Z`,
    },
    ...overrides,
  });
  const records: any[] = Array.from({ length: 25 }, (_, index) => labeled(index, {}));
  records.push(
    labeled(40, {
      feedback: { correct: false, verdictTag: "should_reject", issueTags: [], note: "camera turned", updatedAt: "2026-09-15T00:00:00Z" },
    }),
    labeled(41, {
      feedback: { correct: false, verdictTag: "should_approve", issueTags: [], note: "", updatedAt: "2026-09-15T00:00:00Z" },
    }),
    labeled(42, { holdout: true, feedback: { correct: false, verdictTag: "should_reject", issueTags: [], note: "held", updatedAt: "2026-09-17T00:00:00Z" } }),
    labeled(43, { framesKept: 0, feedback: { correct: false, verdictTag: "should_reject", issueTags: [], note: "no frames", updatedAt: "2026-09-17T00:00:00Z" } }),
  );
  const outcomes: any[] = Array.from({ length: 65 }, (_, index) => ({
    candidateId: index === 0 ? "c0" : `o${index}`,
    sessionId: visible[index % 7],
    at: "t",
    proposerLessonVersion: "none",
    reviewerLessonVersion: "none",
    reviewerModelId: "judge",
    proposals: [{ kind: "scene_context", subject: "s", observation: "o", before: null, after: null, objectiveIds: [] }],
    reviewVerdict: "not_teachable",
    reviewReason: "r",
  }));
  const selected = selectDraftCases(records, outcomes);
  assert.ok(!selected.human.some((record) => record.holdout));
  assert.equal(selected.human[0].candidateId, "c43", "newest note + disagreement first");
  assert.equal(selected.human[1].candidateId, "c40");
  assert.equal(selected.human[2].candidateId, "c41");
  assert.equal(selected.imaged.length, MAX_IMAGED_CASES);
  assert.equal(selected.imaged[0].candidateId, "c40", "cards without frames get no image");
  assert.ok(selected.imaged.every((record) => record.framesKept > 0));
  assert.equal(selected.judgeOnly.length, MAX_JUDGE_ONLY_CASES);
  assert.ok(!selected.judgeOnly.some((outcome) => outcome.candidateId === "c0"));
});

test("the drafter sees every lesson, the base rules, contact sheets, notes, and can retire or replace lessons", async () => {
  const sharp = (await import("sharp")).default;
  const { loadDiscoveryConfig } = await import("../server/discovery/config");
  const { DiscoveryService } = await import("../server/discovery/service");
  const { isHoldoutVideo } = await import("../shared/learning");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-draft-service-"));
  const config = loadDiscoveryConfig(
    { DISCOVERY_ACCESS_CODE: "m".repeat(32) },
    path.join(root, "runtime"),
  );
  config.limits.minCloudStartSpacingMs = 0;
  const service = await DiscoveryService.create(config);
  const internal = service as any;
  try {
    const sessions = Array.from({ length: 50 }, (_, index) => `video-${index}`)
      .filter((id) => !isHoldoutVideo(id));
    const learningCases = new Map([
      ["x1", { sessionId: sessions[0], human: true }],
      ["x2", { sessionId: sessions[1], human: true }],
    ]);
    const [active, refused] = await service.learning.addDraftedLessons(
      [
        { model: "proposer", text: "Nova must not repeat cards it proposed before.", supportingIds: ["x1", "x2"], contradictingIds: [] },
        { model: "reviewer", text: "A refused rule about shiny floors being wet.", supportingIds: ["x1", "x2"], contradictingIds: [] },
      ],
      learningCases,
    );
    await service.updateLesson(active.id, "accept");
    await service.updateLesson(refused.id, "reject");

    const jpeg = await sharp({ create: { width: 36, height: 64, channels: 3, background: "gray" } }).jpeg().toBuffer();
    const frameDir = path.join(root, "frames");
    await fs.mkdir(frameDir);
    const frames = await Promise.all(
      [0, 1, 2].map(async (index) => {
        const file = path.join(frameDir, `${index}.jpg`);
        await fs.writeFile(file, jpeg);
        return {
          file,
          frame: { frameId: `f${index}`, seq: index, sourceTimeMs: index * 500, sha256: "b".repeat(64), width: 36, height: 64, orientation: 1 },
        };
      }),
    );
    await service.learning.saveFeedback(
      {
        ...labelRecord("case1", "approved", "should_reject", "sliding the can around is already there"),
        sessionId: sessions[2],
        feedback: { correct: false, verdictTag: "should_reject", issueTags: ["already_covered"], note: "sliding the can around is already there", updatedAt: "2026-09-16T01:00:00Z" },
        judge: { analysis: "The hand slides the can to the right.", opportunities: [] },
        evidenceFrameIds: ["f1"],
        videoContext: "THIS VIDEO SO FAR\nC1 · concept: a push sets a resting object sliding",
      },
      frames,
    );

    const requests: any[] = [];
    internal.models.transport = {
      converse: async (_model: string, request: any) => {
        requests.push(request);
        return {
          output: {
            message: {
              role: "assistant",
              content: [
                {
                  toolUse: {
                    toolUseId: "d1",
                    name: "submit_lessons",
                    input: {
                      analysis: "Repeat labels mean teachable content shown twice.",
                      lessons: [
                        {
                          model: "proposer",
                          text: "Propose a moment only when an object's motion visibly changes in these frames.",
                          supportingIds: ["case1"],
                          contradictingIds: [],
                          replacesLessonIds: [active.id],
                        },
                      ],
                      retire: [
                        { lessonId: active.id, reason: "Nova never sees other cards, so it cannot avoid repeats.", supportingIds: ["case1"] },
                      ],
                    },
                  },
                },
              ],
            },
          },
          stopReason: "tool_use",
          usage: { inputTokens: 100, outputTokens: 50 },
        };
      },
    };
    const result = await service.draftLessons();
    assert.equal(result.added.length, 1);
    assert.deepEqual(result.added[0].replaces, [active.id]);
    assert.equal(result.suggestions.length, 1);
    assert.match(
      service.learning.listLessons().find((lesson) => lesson.id === active.id)!.retireSuggestion!.reason,
      /never sees other cards/,
    );
    const [request] = requests;
    const content = request.messages[0].content;
    const texts = content.filter((block: any) => block.text).map((block: any) => block.text).join("\n");
    assert.equal(content.filter((block: any) => block.image).length, 1);
    assert.match(texts, /A refused rule about shiny floors being wet/);
    assert.match(texts, /"status":"rejected"/);
    assert.match(texts, /candidate finder, not a lesson generator/, "Nova's base rules");
    assert.match(texts, /one card per physics concept/i, "the judge's base rules");
    assert.match(texts, /sliding the can around is already there/);
    assert.match(texts, /The hand slides the can to the right/);
    assert.match(texts, /a push sets a resting object sliding/);
    assert.match(request.system.map((block: any) => block.text).join("\n"), /contact sheet/i);
    const tool = request.toolConfig.tools[0].toolSpec.inputSchema.json;
    assert.deepEqual(tool.properties.retire.items.properties.lessonId.enum, [active.id]);
    assert.deepEqual(
      tool.properties.lessons.items.properties.replacesLessonIds.items.enum,
      [active.id],
    );
    assert.equal(request.inferenceConfig.maxTokens, 10_000);
  } finally {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("drafting waits for live review, and a card cannot be labeled while it is still publishing", async () => {
  const { loadDiscoveryConfig } = await import("../server/discovery/config");
  const { DiscoveryService } = await import("../server/discovery/service");
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-guard-test-"));
  const config = loadDiscoveryConfig(
    { DISCOVERY_ACCESS_CODE: "n".repeat(32) },
    path.join(root, "runtime"),
  );
  const service = await DiscoveryService.create(config);
  const internal = service as any;
  try {
    const created = await service.createSession(
      { sourceKind: "phone", mode: "live" },
      "guard_test_key",
    );
    const session = await service.start(created.id, created.generation);
    await assert.rejects(
      service.draftLessons(),
      (error: any) => error.code === "SESSION_ACTIVE" && error.status === 409,
    );
    await assert.rejects(
      service.checkLesson("any"),
      (error: any) => error.code === "SESSION_ACTIVE",
    );
    await internal.store.mutate(session.id, (value: any) => {
      value.candidates.push({
        id: "publishing",
        state: "reviewing",
        schedulingReasons: ["periodic"],
        sourceInterval: { startSeconds: 0, endSeconds: 6 },
        proposerProposalCount: 1,
        reviewVerdict: "teachable",
        reviewReason: "A visible push.",
        errorCode: null,
        suppressionReason: null,
        snapshotId: "none",
        proposerInvocationId: "p",
        proposerPromptHash: null,
        reviewerInvocationId: "r",
        reviewerPromptHash: null,
        contributingCandidateIds: ["publishing"],
        cardKind: null,
      });
    });
    await assert.rejects(
      service.saveFeedback(session.id, "publishing", {
        correct: true,
        verdictTag: null,
        issueTags: [],
        note: "",
      }),
      (error: any) => error.code === "CARD_NOT_READY" && error.status === 409,
    );
    await service.cancel(session.id, session.generation);
    await assert.rejects(
      service.draftLessons(),
      (error: any) => error.code === "NOTHING_TO_LEARN",
    );
  } finally {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("tool enums disappear with no lessons, and a draft never carries more than 20 images", async () => {
  const { lessonToolConfig } = await import("../server/discovery/models");
  const { buildDraftContent, selectDraftCases } = await import(
    "../server/discovery/draftContext"
  );
  const { isHoldoutVideo } = await import("../shared/learning");
  const empty = lessonToolConfig([], []).tools[0].toolSpec.inputSchema.json as any;
  assert.equal(empty.properties.retire, undefined);
  assert.equal(empty.properties.lessons.items.properties.replacesLessonIds, undefined);
  assert.deepEqual(empty.required, ["analysis", "lessons"]);

  const sessions = Array.from({ length: 100 }, (_, index) => `video-${index}`)
    .filter((id) => !isHoldoutVideo(id));
  const records: any[] = Array.from({ length: 25 }, (_, index) => ({
    ...labelRecord(`card${index}`, "approved", "should_reject", `note ${index}`),
    sessionId: sessions[index],
    framesKept: 12,
  }));
  const selected = selectDraftCases(records, []);
  const sheets = new Map(records.map((record) => [record.candidateId, Buffer.from([1])]));
  const built = buildDraftContent({
    lessons: [],
    report: { groups: [], yesManAlarm: false, totals: { labels: 25, holdoutLabels: 0, outcomes: 0 } },
    human: selected.human,
    imaged: selected.imaged,
    sheets,
    judgeOnly: [],
    basePrompts: { proposer: "p", reviewer: "r" },
  });
  assert.equal(built.imageCount, 20);
  assert.equal(built.content.filter((block: any) => block.image).length, 20);
  assert.equal(built.cases.size, 25, "the other 5 cards still go as text");
});
