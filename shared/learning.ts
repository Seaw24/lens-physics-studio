import { z } from "zod";
import type { CandidateOpportunity } from "./discovery";

// Shared rules for human feedback, learned lessons, and the learning report.
// Kept free of I/O so the same logic is testable and usable by server and UI.

export const verdictTags = [
  "should_approve",
  "should_reject",
  "wrong_details",
] as const;
export const issueTags = [
  "nothing_physics",
  "wrong_concept",
  "action_not_happened",
  "evidence_not_visible",
  "wrong_time_range",
  "already_covered",
] as const;
export type VerdictTag = (typeof verdictTags)[number];
export type IssueTag = (typeof issueTags)[number];

export const verdictTagLabels: Record<VerdictTag, string> = {
  should_approve: "Should have been approved",
  should_reject: "Should have been rejected",
  wrong_details: "Right verdict, wrong details",
};
export const issueTagLabels: Record<IssueTag, string> = {
  nothing_physics: "Nothing physics-relevant happened",
  wrong_concept: "Wrong concept / objective",
  action_not_happened: "Action didn't actually happen",
  evidence_not_visible: "Evidence not visible in frames",
  wrong_time_range: "Wrong time range",
  already_covered: "Already covered by another card",
};

export const FeedbackRequestSchema = z
  .object({
    correct: z.boolean(),
    verdictTag: z.enum(verdictTags).nullable(),
    issueTags: z.array(z.enum(issueTags)).max(issueTags.length),
    note: z.string().trim().max(1000),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (!value.correct && !value.verdictTag)
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Not correct feedback needs a verdict tag.",
      });
    if (value.correct && (value.verdictTag || value.issueTags.length))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Correct feedback carries no verdict or issue tags.",
      });
  });
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

/**
 * What the card showed: a reviewed verdict, a teachable window whose concepts
 * this video already covers, or a sampled window where Nova proposed nothing.
 */
export type CardKind =
  | "approved"
  | "already_covered"
  | "not_teachable"
  | "insufficient_evidence"
  | "nova_empty";

/** Verdict wording follows what the card claimed. */
export function verdictLabel(cardKind: CardKind, tag: VerdictTag) {
  if (cardKind === "already_covered")
    return {
      should_approve: "New concept — should be its own card",
      should_reject: "Nothing teachable here",
      wrong_details: "Right call, wrong details",
    }[tag];
  return verdictTagLabels[tag];
}

export interface HumanFeedback extends FeedbackRequest {
  updatedAt: string;
}

export interface ProposalSummary {
  kind: "observed_action" | "scene_context";
  subject: string;
  observation: string;
  before: string | null;
  after: string | null;
  objectiveIds: string[];
}

export interface FeedbackRecord {
  candidateId: string;
  sessionId: string;
  sourceKind: "image" | "video" | "phone";
  cardKind: CardKind;
  proposals: ProposalSummary[];
  reviewVerdict: "teachable" | "not_teachable" | "insufficient_evidence" | null;
  reviewReason: string | null;
  feedback: HumanFeedback;
  proposerPromptHash: string | null;
  reviewerPromptHash: string | null;
  proposerLessonVersion: string;
  reviewerLessonVersion: string;
  /** The judge model; metrics never mix judges. */
  reviewerModelId: string;
  holdout: boolean;
  framesKept: number;
  createdAt: string;
  /** The judge's view, kept so lesson drafting outlives session retention. */
  judge?: {
    analysis: string | null;
    opportunities: CandidateOpportunity[];
  } | null;
  /** Frames cited by the judge's opportunities, else by Nova's proposals. */
  evidenceFrameIds?: string[];
  /** What earlier cards of the same video covered when the judge decided. */
  videoContext?: string | null;
}

/** One row per proposer pass, so Nova can learn from Sonnet without a human label. */
export interface ProposerOutcome {
  candidateId: string;
  sessionId: string;
  at: string;
  proposerLessonVersion: string;
  reviewerLessonVersion: string;
  reviewerModelId: string;
  proposals: ProposalSummary[];
  reviewVerdict: "teachable" | "not_teachable" | "insufficient_evidence" | null;
  reviewReason: string | null;
  /** Teachable, but every concept was already covered in this video. */
  alreadyCovered?: boolean;
}

export type LessonModel = "proposer" | "reviewer";
export type LessonStatus =
  "pending" | "needs_evidence" | "active" | "rejected" | "disabled";

export interface LessonCheck {
  at: string;
  cases: number;
  baselineAgreement: number;
  withLessonAgreement: number;
  calls: number;
}

export interface Lesson {
  id: string;
  model: LessonModel;
  text: string;
  status: LessonStatus;
  supportingIds: string[];
  contradictingIds: string[];
  supportingVideos: number;
  humanContradictions: number;
  createdAt: string;
  updatedAt: string;
  check: LessonCheck | null;
  /** Existing lessons this one supersedes; accepting it turns them off. */
  replaces?: string[];
  /** The drafter's advice to turn this lesson off, until the human decides. */
  retireSuggestion?: RetireSuggestion | null;
}

export interface RetireSuggestion {
  reason: string;
  supportingIds: string[];
  at: string;
}

export const lessonActions = [
  "accept",
  "reject",
  "disable",
  "edit",
  "dismiss_suggestion",
] as const;
export type LessonAction = (typeof lessonActions)[number];

export const LessonUpdateSchema = z
  .object({
    action: z.enum(lessonActions),
    text: z.string().trim().min(12).max(280).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if ((value.action === "edit") !== Boolean(value.text))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Only edit carries text.",
      });
  });

export const LessonDraftResponseSchema = z
  .object({
    lessons: z
      .array(
        z
          .object({
            model: z.enum(["proposer", "reviewer"]),
            text: z.string().trim().min(12).max(280),
            supportingIds: z.array(z.string().min(1).max(80)).min(1).max(20),
            contradictingIds: z.array(z.string().min(1).max(80)).max(20),
            replacesLessonIds: z
              .array(z.string().min(1).max(80))
              .max(10)
              .default([]),
          })
          .strict(),
      )
      .max(6),
    retire: z
      .array(
        z
          .object({
            lessonId: z.string().min(1).max(80),
            reason: z.string().trim().min(8).max(280),
            supportingIds: z.array(z.string().min(1).max(80)).max(20).default([]),
          })
          .strict(),
      )
      .max(6)
      .default([]),
  })
  .strict();

export const MAX_ACTIVE_LESSONS = 15;
export const MIN_SUPPORTING_VIDEOS = 2;
export const NOISY_SAMPLE = 50;

// FNV-1a keeps this module browser-safe (no node:crypto) and the buckets stable.
function fnv1a(value: string, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}
function bucket(value: string, modulo: number) {
  return fnv1a(value) % modulo;
}
/** Every 5th video is held out: never used for lessons or examples, only for checks. */
export function isHoldoutVideo(sessionId: string) {
  return bucket(`holdout:${sessionId}`, 5) === 0;
}
/** About 1 in 5 empty proposer windows becomes a gray audit card. */
export function isAuditSample(candidateId: string) {
  return bucket(`audit:${candidateId}`, 5) === 0;
}

export function cardKindFor(
  reviewVerdict: FeedbackRecord["reviewVerdict"],
  proposalCount: number | null,
): CardKind | null {
  if (reviewVerdict === "teachable") return "approved";
  if (reviewVerdict) return reviewVerdict;
  return proposalCount === 0 ? "nova_empty" : null;
}

/**
 * The human's ground truth: was this window's content teachable? A repeat of a
 * covered concept is teachable content shown twice, not unteachable content.
 */
export function humanTruth(cardKind: CardKind, feedback: FeedbackRequest) {
  if (feedback.issueTags.includes("already_covered")) return true;
  const modelSaidTeachable =
    cardKind === "approved" || cardKind === "already_covered";
  if (feedback.correct || feedback.verdictTag === "wrong_details")
    return modelSaidTeachable;
  return feedback.verdictTag === "should_approve";
}

/**
 * Labels about repetition within one video: the repeat tag, or any label on an
 * already-covered card except "nothing teachable here" (a teachability label).
 * Their notes need the video's earlier cards, so other videos and replays skip them.
 */
export function isRepeatLabel(
  record: Pick<FeedbackRecord, "cardKind" | "feedback">,
) {
  return (
    record.feedback.issueTags.includes("already_covered") ||
    (record.cardKind === "already_covered" &&
      record.feedback.verdictTag !== "should_reject")
  );
}

export type JudgeLabelOutcome =
  | "agreement"
  | "false_approval"
  | "false_rejection"
  | "missed_repeat"
  | "wrong_merge"
  | "other";

/** How one human label scores the judge; repeats are scored apart from teachability. */
export function judgeLabelOutcome(
  cardKind: CardKind,
  feedback: FeedbackRequest,
): JudgeLabelOutcome {
  if (feedback.correct || feedback.verdictTag === "wrong_details")
    return "agreement";
  if (cardKind === "already_covered")
    return feedback.verdictTag === "should_approve"
      ? "wrong_merge"
      : "false_approval";
  if (cardKind === "approved")
    return feedback.verdictTag !== "should_reject"
      ? "other"
      : feedback.issueTags.includes("already_covered")
        ? "missed_repeat"
        : "false_approval";
  return feedback.verdictTag === "should_approve" ? "false_rejection" : "other";
}

/** Nova's label: human truth when present, else Sonnet's verdict. Insufficient evidence carries no label. */
export function proposerTruth(
  reviewVerdict: FeedbackRecord["reviewVerdict"],
  human: { cardKind: CardKind; feedback: FeedbackRequest } | null,
) {
  if (human) return humanTruth(human.cardKind, human.feedback);
  if (reviewVerdict === "teachable") return true;
  if (reviewVerdict === "not_teachable") return false;
  return null;
}

export function lessonVersion(lessons: Lesson[], model: LessonModel) {
  const active = lessons
    .filter((lesson) => lesson.model === model && lesson.status === "active")
    .map((lesson) => `${lesson.id}:${lesson.text}`)
    .sort();
  if (!active.length) return "none";
  const serialized = JSON.stringify(active);
  return (
    fnv1a(serialized).toString(16).padStart(8, "0") +
    fnv1a(serialized, 0x01000193).toString(16).padStart(8, "0")
  ).slice(0, 12);
}

export function renderLessons(
  lessons: Lesson[],
  model: LessonModel,
  extra?: Lesson,
) {
  const active = lessons.filter(
    (lesson) => lesson.model === model && lesson.status === "active",
  );
  if (extra && !active.some((lesson) => lesson.id === extra.id))
    active.push(extra);
  if (!active.length) return null;
  return [
    "LEARNED LESSONS from reviewed cases on other videos. They refine, and never loosen, the grounding rules above:",
    ...active.map((lesson, index) => `${index + 1}. ${lesson.text}`),
  ].join("\n");
}

/** Lesson gating: general evidence from at least two videos and no human label against it. */
export function draftStatus(
  supportingVideos: number,
  humanContradictions: number,
): LessonStatus {
  return supportingVideos >= MIN_SUPPORTING_VIDEOS && humanContradictions === 0
    ? "pending"
    : "needs_evidence";
}

export function summarizeProposal(proposal: {
  kind: "observed_action" | "scene_context";
  subject: string;
  observation: string;
  before: { text: string } | null;
  after: { text: string } | null;
  objectiveIds: string[];
}): ProposalSummary {
  return {
    kind: proposal.kind,
    subject: proposal.subject,
    observation: proposal.observation,
    before: proposal.before?.text ?? null,
    after: proposal.after?.text ?? null,
    objectiveIds: proposal.objectiveIds,
  };
}

/**
 * Reviewer examples: human-labeled, never from the current or a held-out video,
 * at most one per video, balanced between teachable and not, preferring matching objectives.
 */
export function selectReviewerExamples(
  records: FeedbackRecord[],
  excludeSessionId: string,
  preferObjectives: string[] = [],
  max = 4,
) {
  const newestPerVideo = new Map<string, FeedbackRecord>();
  for (const record of records) {
    if (record.holdout || record.sessionId === excludeSessionId) continue;
    if (record.cardKind === "nova_empty" || !record.proposals.length) continue;
    if (isRepeatLabel(record)) continue;
    const prior = newestPerVideo.get(record.sessionId);
    if (!prior || prior.feedback.updatedAt < record.feedback.updatedAt)
      newestPerVideo.set(record.sessionId, record);
  }
  const score = (record: FeedbackRecord) =>
    record.proposals.some((proposal) =>
      proposal.objectiveIds.some((objective) =>
        preferObjectives.includes(objective),
      ),
    )
      ? 1
      : 0;
  const ordered = [...newestPerVideo.values()].sort(
    (a, b) =>
      score(b) - score(a) ||
      b.feedback.updatedAt.localeCompare(a.feedback.updatedAt),
  );
  const teachable = ordered.filter((record) =>
    humanTruth(record.cardKind, record.feedback),
  );
  const notTeachable = ordered.filter(
    (record) => !humanTruth(record.cardKind, record.feedback),
  );
  const picked: FeedbackRecord[] = [];
  for (
    let i = 0;
    picked.length < max && (i < teachable.length || i < notTeachable.length);
    i++
  ) {
    if (teachable[i] && picked.length < max) picked.push(teachable[i]);
    if (notTeachable[i] && picked.length < max) picked.push(notTeachable[i]);
  }
  return picked;
}

export function renderReviewerExamples(examples: FeedbackRecord[]) {
  if (!examples.length) return null;
  return [
    "PAST HUMAN-VERIFIED CASES from other videos. Text only; they do not describe the images below. Use them to calibrate the evidence bar, not to recognize scenes:",
    ...examples.map((record, index) => {
      const truth = humanTruth(record.cardKind, record.feedback);
      const proposal = record.proposals[0];
      const change =
        proposal.before && proposal.after
          ? ` Before: ${proposal.before} After: ${proposal.after}`
          : "";
      const note = record.feedback.note
        ? ` Human reason: ${record.feedback.note}`
        : "";
      return `${index + 1}. Candidate: ${proposal.subject}. ${proposal.observation}${change} Objectives: ${proposal.objectiveIds.join(", ")}. Reviewer said ${record.reviewVerdict ?? "nothing"}. Human verified: ${truth ? "teachable" : "not teachable"}.${note}`;
    }),
  ].join("\n");
}

export interface ReportGroup {
  reviewerModelId: string;
  proposerLessonVersion: string;
  reviewerLessonVersion: string;
  windows: number;
  proposedWindows: number;
  labeledProposals: number;
  truePositiveProposals: number;
  reviewerLabels: number;
  reviewerAgreements: number;
  falseApprovals: number;
  falseRejections: number;
  detailErrors: number;
  approvals: number;
  reviews: number;
  auditLabels: number;
  auditMisses: number;
  /** Teachable windows whose concepts this video already covered. */
  alreadyCovered: number;
  repeatsCaught: number;
  missedRepeats: number;
  wrongMerges: number;
}

export interface LearningReport {
  groups: Array<
    ReportGroup & {
      proposalRate: number | null;
      proposerPrecision: number | null;
      reviewerAgreement: number | null;
      approvalRate: number | null;
      missRate: number | null;
      noisy: boolean;
    }
  >;
  yesManAlarm: boolean;
  totals: { labels: number; holdoutLabels: number; outcomes: number };
}

const ratio = (a: number, b: number) => (b ? a / b : null);

export function buildReport(
  outcomes: ProposerOutcome[],
  records: FeedbackRecord[],
): LearningReport {
  const byCandidate = new Map(
    records.map((record) => [record.candidateId, record]),
  );
  const groups = new Map<string, ReportGroup>();
  const group = (model: string, proposer: string, reviewer: string) => {
    const key = `${model}|${proposer}|${reviewer}`;
    let value = groups.get(key);
    if (!value) {
      value = {
        reviewerModelId: model,
        proposerLessonVersion: proposer,
        reviewerLessonVersion: reviewer,
        windows: 0,
        proposedWindows: 0,
        labeledProposals: 0,
        truePositiveProposals: 0,
        reviewerLabels: 0,
        reviewerAgreements: 0,
        falseApprovals: 0,
        falseRejections: 0,
        detailErrors: 0,
        approvals: 0,
        reviews: 0,
        auditLabels: 0,
        auditMisses: 0,
        alreadyCovered: 0,
        repeatsCaught: 0,
        missedRepeats: 0,
        wrongMerges: 0,
      };
      groups.set(key, value);
    }
    return value;
  };
  for (const outcome of outcomes) {
    const g = group(
      outcome.reviewerModelId,
      outcome.proposerLessonVersion,
      outcome.reviewerLessonVersion,
    );
    const record = byCandidate.get(outcome.candidateId);
    g.windows++;
    if (outcome.proposals.length) {
      g.proposedWindows++;
      const truth = proposerTruth(
        outcome.reviewVerdict,
        record
          ? { cardKind: record.cardKind, feedback: record.feedback }
          : null,
      );
      if (truth !== null) {
        g.labeledProposals++;
        if (truth) g.truePositiveProposals++;
      }
    }
    if (outcome.reviewVerdict) {
      g.reviews++;
      if (outcome.reviewVerdict === "teachable") g.approvals++;
    }
    if (outcome.alreadyCovered) g.alreadyCovered++;
  }
  for (const record of records) {
    const g = group(
      record.reviewerModelId,
      record.proposerLessonVersion,
      record.reviewerLessonVersion,
    );
    if (record.cardKind === "nova_empty") {
      g.auditLabels++;
      if (humanTruth(record.cardKind, record.feedback)) g.auditMisses++;
      continue;
    }
    g.reviewerLabels++;
    const outcome = judgeLabelOutcome(record.cardKind, record.feedback);
    if (outcome === "agreement") g.reviewerAgreements++;
    if (record.feedback.verdictTag === "wrong_details") g.detailErrors++;
    if (outcome === "false_approval") g.falseApprovals++;
    if (outcome === "false_rejection") g.falseRejections++;
    if (outcome === "missed_repeat") g.missedRepeats++;
    if (outcome === "wrong_merge") g.wrongMerges++;
    if (record.cardKind === "already_covered" && outcome === "agreement")
      g.repeatsCaught++;
  }
  const rows = [...groups.values()].map((g) => ({
    ...g,
    proposalRate: ratio(g.proposedWindows, g.windows),
    proposerPrecision: ratio(g.truePositiveProposals, g.labeledProposals),
    reviewerAgreement: ratio(g.reviewerAgreements, g.reviewerLabels),
    approvalRate: ratio(g.approvals, g.reviews),
    missRate: ratio(g.auditMisses, g.auditLabels),
    noisy: g.reviewerLabels < NOISY_SAMPLE,
  }));
  // Rows arrive in first-seen order, so the last two are the latest lesson versions.
  const [previous, latest] = rows.slice(-2);
  const yesManAlarm = Boolean(
    previous &&
    latest &&
    previous.approvalRate !== null &&
    latest.approvalRate !== null &&
    latest.approvalRate - previous.approvalRate >= 0.1 &&
    (latest.reviewerAgreement ?? 0) <= (previous.reviewerAgreement ?? 0),
  );
  return {
    groups: rows,
    yesManAlarm,
    totals: {
      labels: records.length,
      holdoutLabels: records.filter((record) => record.holdout).length,
      outcomes: outcomes.length,
    },
  };
}

/** Card kind for a candidate summary; older sessions only have reviewed verdicts. */
export function candidateCardKind(candidate: {
  cardKind?: CardKind | null;
  reviewVerdict: FeedbackRecord["reviewVerdict"];
  proposerProposalCount: number | null;
}): CardKind | null {
  if (candidate.cardKind) return candidate.cardKind;
  return candidate.reviewVerdict
    ? cardKindFor(candidate.reviewVerdict, candidate.proposerProposalCount)
    : null;
}

/** Live per-session numbers for the scoreboard, using the same rules as the report. */
export function sessionScore(
  candidates: Array<{
    cardKind?: CardKind | null;
    reviewVerdict: FeedbackRecord["reviewVerdict"];
    proposerProposalCount: number | null;
    humanFeedback?: HumanFeedback | null;
  }>,
) {
  let windows = 0;
  let proposed = 0;
  let labeledProposals = 0;
  let truePositives = 0;
  let reviewerLabels = 0;
  let agreements = 0;
  let falseApprovals = 0;
  let falseRejections = 0;
  let alreadyCovered = 0;
  let missedRepeats = 0;
  let wrongMerges = 0;
  for (const candidate of candidates) {
    if (candidate.proposerProposalCount === null) continue;
    windows++;
    const kind = candidateCardKind(candidate);
    const feedback = candidate.humanFeedback ?? null;
    if (kind === "already_covered") alreadyCovered++;
    if (candidate.proposerProposalCount > 0) {
      proposed++;
      const truth = proposerTruth(
        candidate.reviewVerdict,
        kind && feedback ? { cardKind: kind, feedback } : null,
      );
      if (truth !== null) {
        labeledProposals++;
        if (truth) truePositives++;
      }
    }
    if (!kind || kind === "nova_empty" || !feedback) continue;
    reviewerLabels++;
    const outcome = judgeLabelOutcome(kind, feedback);
    if (outcome === "agreement") agreements++;
    if (outcome === "false_approval") falseApprovals++;
    if (outcome === "false_rejection") falseRejections++;
    if (outcome === "missed_repeat") missedRepeats++;
    if (outcome === "wrong_merge") wrongMerges++;
  }
  return {
    windows,
    proposed,
    proposalRate: windows ? proposed / windows : null,
    proposerPrecision: labeledProposals
      ? truePositives / labeledProposals
      : null,
    reviewerLabels,
    reviewerAgreement: reviewerLabels ? agreements / reviewerLabels : null,
    falseApprovals,
    falseRejections,
    alreadyCovered,
    missedRepeats,
    wrongMerges,
  };
}

/** Short display name for a Bedrock model ID. */
export function modelLabel(modelId: string) {
  if (/opus-4-6/.test(modelId)) return "Opus 4.6";
  if (/sonnet-4-6/.test(modelId)) return "Sonnet 4.6";
  if (/nova-lite/.test(modelId)) return "Nova Lite";
  return modelId;
}
