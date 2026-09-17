import { z } from "zod";
import { DISCOVERY_COURSE } from "./discoveryCourse";
import type { CardKind, HumanFeedback } from "./learning";

export const objectiveIds = DISCOVERY_COURSE.objectives.map((o) => o.id) as [
  "force-interaction",
  "torque-rotation",
  "equilibrium-support",
  "released-object-motion",
];
/** Longest live camera session; server, USB page, and phone page share it. */
export const LIVE_SESSION_MAX_MS = 30 * 60_000;

const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
const ids = z.array(id).min(1).max(12);
const text = z.string().trim().min(1).max(1200);
const objective = z.enum(objectiveIds);
const FactSchema = z.object({ text, frameIds: ids }).strict();
const opportunityBase = {
  kind: z.enum(["observed_action", "scene_context"]),
  subject: z.string().trim().min(1).max(120),
  startFrameId: id,
  endFrameId: id,
  observation: text,
  before: FactSchema.nullable(),
  after: FactSchema.nullable(),
  evidenceFrameIds: ids,
  objectiveIds: z.array(objective).min(1).max(4),
  limitations: z.array(text).max(8),
};

export const ProposalSchema = z.object(opportunityBase).strict();
export const ProposerResponseSchema = z
  .object({ proposals: z.array(ProposalSchema).max(3) })
  .strict();
export const GroundedOpportunitySchema = z
  .object({ ...opportunityBase, connection: text })
  .strict();
/**
 * The judge's opportunity adds the physics concept it teaches, the covered
 * concept of this video it repeats, and whether it would make the better card
 * for that concept. All stay out of the public event.
 */
export const JudgedOpportunitySchema = z
  .object({
    ...opportunityBase,
    connection: text,
    concept: z.string().trim().min(1).max(160).optional(),
    coveredBy: id.nullable().optional(),
    replacesCovered: z.boolean().optional(),
  })
  .strict();
export const ReviewResponseSchema = z
  .object({
    verdict: z.enum(["teachable", "not_teachable", "insufficient_evidence"]),
    reason: text,
    opportunities: z.array(JudgedOpportunitySchema).max(3),
  })
  .strict()
  .superRefine((review, ctx) => {
    if ((review.verdict === "teachable") !== (review.opportunities.length > 0))
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "Only teachable reviews contain opportunities; teachable requires at least one.",
      });
  });

export const FrameSchema = z
  .object({
    frameId: id,
    seq: z.number().int().nonnegative(),
    sourceTimeMs: z.number().int().nonnegative().nullable(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    orientation: z.number().int(),
  })
  .strict();
export type DiscoveryFrame = z.infer<typeof FrameSchema>;
export type Proposal = z.infer<typeof ProposalSchema>;
export type GroundedOpportunity = z.infer<typeof GroundedOpportunitySchema>;
export type JudgedOpportunity = z.infer<typeof JudgedOpportunitySchema>;
export type ReviewResponse = z.infer<typeof ReviewResponseSchema>;

/** Drops judge-only fields so an opportunity fits the strict public event. */
export function publicOpportunity(
  opportunity: JudgedOpportunity,
): GroundedOpportunity {
  const {
    concept: _concept,
    coveredBy: _coveredBy,
    replacesCovered: _replacesCovered,
    ...grounded
  } = opportunity;
  return grounded;
}

/** The earlier card of this video that already covers a concept. */
export interface CoverageRef {
  candidateId: string;
  eventId: string | null;
  concept: string | null;
  subject: string;
  startSeconds: number | null;
}

/** One judged opportunity as kept on its card. */
export interface CandidateOpportunity {
  concept: string | null;
  subject: string;
  observation: string;
  connection: string;
  objectiveIds: string[];
  eventId: string | null;
  coveredBy: CoverageRef | null;
  /** The earlier card this opportunity took over as the better card for its concept. */
  replaced?: CoverageRef | null;
}

/** Structural/temporal validation only; it does not prove visual truth. */
export function validateEvidence(
  proposal: Proposal | GroundedOpportunity,
  frames: Pick<DiscoveryFrame, "frameId" | "sourceTimeMs" | "sha256">[],
  sourceKind: "image" | "video" | "phone",
) {
  const index = new Map(frames.map((frame) => [frame.frameId, frame]));
  if (index.size !== frames.length) throw new Error("Duplicate frame identity");
  const get = (value: string) => {
    const frame = index.get(value);
    if (!frame) throw new Error("Unknown frame reference");
    return frame;
  };
  const start = get(proposal.startFrameId);
  const end = get(proposal.endFrameId);
  if (new Set(proposal.evidenceFrameIds).size !== proposal.evidenceFrameIds.length)
    throw new Error("Duplicate evidence");
  proposal.evidenceFrameIds.forEach(get);
  if (
    !proposal.evidenceFrameIds.includes(proposal.startFrameId) ||
    !proposal.evidenceFrameIds.includes(proposal.endFrameId)
  )
    throw new Error("Boundary absent from evidence");
  if (sourceKind === "image") {
    if (
      frames.length !== 1 ||
      frames[0].sourceTimeMs !== null ||
      proposal.kind !== "scene_context" ||
      proposal.before !== null ||
      proposal.after !== null ||
      proposal.startFrameId !== proposal.endFrameId
    )
      throw new Error("Image may only establish static context");
  } else {
    if (frames.some((frame) => frame.sourceTimeMs === null))
      throw new Error("Temporal source needs times");
    if (start.sourceTimeMs! > end.sourceTimeMs!)
      throw new Error("Reversed interval");
    if (
      proposal.evidenceFrameIds.some(
        (frameId) =>
          get(frameId).sourceTimeMs! < start.sourceTimeMs! ||
          get(frameId).sourceTimeMs! > end.sourceTimeMs!,
      )
    )
      throw new Error("Evidence outside interval");
  }
  if (proposal.kind === "scene_context") {
    if (proposal.before !== null || proposal.after !== null)
      throw new Error("Static context has no claimed transition");
  } else {
    if (
      !proposal.before ||
      !proposal.after ||
      start.sourceTimeMs === null ||
      end.sourceTimeMs === null
    )
      throw new Error("Missing observed transition");
    const factTimes = (fact: { frameIds: string[] }) =>
      fact.frameIds.map((frameId) => {
        if (!proposal.evidenceFrameIds.includes(frameId))
          throw new Error("Transition references evidence not declared");
        return get(frameId).sourceTimeMs!;
      });
    if (
      Math.max(...factTimes(proposal.before)) >=
      Math.min(...factTimes(proposal.after))
    )
      throw new Error("Before must precede after");
  }
}

const IntervalSchema = z
  .object({
    startSeconds: z.number().finite().nonnegative(),
    endSeconds: z.number().finite().nonnegative(),
  })
  .strict();
const ModelSchema = z
  .object({
    modelId: z.string().trim().min(1).max(240),
    promptHash: z.string().regex(/^[a-f0-9]{64}$/),
    invocationId: id,
  })
  .strict();
const MediaSchema = z
  .object({
    assetId: id,
    url: z.string().regex(/^\/api\/discovery\/assets\/[a-zA-Z0-9_-]+$/),
    mimeType: z.enum(["image/jpeg", "video/mp4"]),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    fidelity: z.enum([
      "normalized_still",
      "source_video_clip",
      "sampled_camera_frames",
    ]),
    sourceInterval: IntervalSchema.nullable(),
    durationSeconds: z.number().finite().positive().nullable(),
    timingUncertaintyMs: z.number().finite().nonnegative().nullable(),
    maxCaptureGapMs: z.number().finite().nonnegative().nullable(),
  })
  .strict();
const EvidenceSchema = z
  .object({
    frameId: id,
    sourceTimeSeconds: z.number().finite().nonnegative().nullable(),
    clipTimeSeconds: z.number().finite().nonnegative().nullable(),
  })
  .strict();

export const EventSchema = z
  .object({
    schemaVersion: z.literal("2.0"),
    exampleOnly: z.boolean(),
    id,
    sessionId: id,
    candidateId: id,
    createdAt: z.string().datetime(),
    course: z
      .object({
        id: z.literal("intro-mechanics-forces-torque"),
        version: z.literal("2"),
      })
      .strict(),
    source: z
      .object({
        kind: z.enum(["image", "video", "phone"]),
        sourceId: id,
      })
      .strict(),
    review: z
      .object({
        verdict: z.literal("teachable"),
        reason: text,
        opportunity: GroundedOpportunitySchema,
        eventSourceInterval: IntervalSchema.nullable(),
        evidence: z.array(EvidenceSchema).min(1).max(12),
      })
      .strict(),
    media: MediaSchema,
    provenance: z
      .object({
        schedulingReasons: z
          .array(
            z.enum([
              "activity",
              "periodic",
              "uniform_evaluation",
              "uploaded_image",
            ]),
          )
          .min(1),
        proposer: ModelSchema.nullable(),
        reviewer: ModelSchema,
        snapshotHash: z.string().regex(/^[a-f0-9]{64}$/),
      })
      .strict(),
  })
  .strict()
  .superRefine((event, ctx) => {
    const fail = (message: string) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    const image = event.source.kind === "image";
    if (image) {
      if (
        event.media.mimeType !== "image/jpeg" ||
        event.media.fidelity !== "normalized_still" ||
        event.media.sourceInterval !== null ||
        event.media.durationSeconds !== null ||
        event.media.timingUncertaintyMs !== null ||
        event.media.maxCaptureGapMs !== null ||
        event.review.eventSourceInterval !== null ||
        event.review.opportunity.kind !== "scene_context" ||
        event.review.evidence.some(
          (frame) =>
            frame.sourceTimeSeconds !== null || frame.clipTimeSeconds !== null,
        )
      )
        fail("Image event has temporal claims");
    } else {
      const media = event.media.sourceInterval;
      const interval = event.review.eventSourceInterval;
      if (
        event.media.mimeType !== "video/mp4" ||
        event.media.fidelity !==
          (event.source.kind === "phone"
            ? "sampled_camera_frames"
            : "source_video_clip") ||
        !media ||
        !interval ||
        event.media.durationSeconds === null ||
        event.media.timingUncertaintyMs === null
      ) {
        fail("Missing or inconsistent temporal media");
        return;
      }
      if (
        media.endSeconds <= media.startSeconds ||
        interval.endSeconds < interval.startSeconds ||
        interval.startSeconds < media.startSeconds ||
        interval.endSeconds > media.endSeconds
      )
        fail("Invalid media/event bounds");
      const first = event.review.evidence.find(
        (frame) => frame.frameId === event.review.opportunity.startFrameId,
      );
      const last = event.review.evidence.find(
        (frame) => frame.frameId === event.review.opportunity.endFrameId,
      );
      if (
        first?.sourceTimeSeconds !== interval.startSeconds ||
        last?.sourceTimeSeconds !== interval.endSeconds
      )
        fail("Event interval differs from boundary evidence");
      if (
        Math.abs(
          event.media.durationSeconds -
            (media.endSeconds - media.startSeconds),
        ) > Math.max(0.15, event.media.timingUncertaintyMs / 1000)
      )
        fail("Clip duration mismatch");
      for (const frame of event.review.evidence) {
        if (
          frame.sourceTimeSeconds === null ||
          frame.clipTimeSeconds === null ||
          frame.sourceTimeSeconds < interval.startSeconds ||
          frame.sourceTimeSeconds > interval.endSeconds ||
          frame.clipTimeSeconds < 0 ||
          frame.clipTimeSeconds > event.media.durationSeconds ||
          Math.abs(
            frame.clipTimeSeconds -
              (frame.sourceTimeSeconds - media.startSeconds),
          ) > 0.002
        )
          fail("Inconsistent evidence clock");
      }
      if (
        event.source.kind === "phone" &&
        (event.media.maxCaptureGapMs === null ||
          (event.review.opportunity.kind === "observed_action" &&
            event.media.maxCaptureGapMs > 500))
      )
        fail("Action crosses a capture gap");
    }
    const actual = event.review.evidence.map((frame) => frame.frameId);
    if (
      actual.length !== new Set(actual).size ||
      actual.length !== event.review.opportunity.evidenceFrameIds.length ||
      actual.some(
        (frameId) =>
          !event.review.opportunity.evidenceFrameIds.includes(frameId),
      )
    )
      fail("Evidence identity mismatch");
    try {
      validateEvidence(
        event.review.opportunity,
        event.review.evidence.map((frame) => ({
          frameId: frame.frameId,
          sourceTimeMs:
            frame.sourceTimeSeconds === null
              ? null
              : Math.round(frame.sourceTimeSeconds * 1000),
          sha256: "0".repeat(64),
        })),
        event.source.kind,
      );
    } catch {
      fail("Invalid opportunity evidence");
    }
  });

export type DiscoveryEvent = z.infer<typeof EventSchema>;
export const sourceKindSchema = z.enum(["image", "video", "phone"]);
export const discoveryModeSchema = z.enum(["scan", "replay", "live"]);
export const sessionStateSchema = z.enum([
  "created",
  "ingesting",
  "paused",
  "draining",
  "completed",
  "budget_exhausted",
  "interrupted",
  "failed",
  "canceled",
]);
export const candidateStateSchema = z.enum([
  "proposed",
  "collecting",
  "queued",
  "reviewing",
  "approved",
  "not_teachable",
  "insufficient_evidence",
  "suppressed_duplicate",
  "suppressed_budget",
  "expired",
  "failed",
  "canceled",
]);
export type SessionState = z.infer<typeof sessionStateSchema>;
export type CandidateState = z.infer<typeof candidateStateSchema>;

export const CreateSessionRequestSchema = z
  .object({ sourceKind: sourceKindSchema, mode: discoveryModeSchema })
  .strict()
  .superRefine((value, ctx) => {
    if (
      (value.sourceKind === "phone") !== (value.mode === "live") ||
      (value.sourceKind === "image" && value.mode !== "scan")
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Source kind and mode are incompatible.",
      });
  });
export const GenerationRequestSchema = z
  .object({ generation: z.number().int().positive() })
  .strict();
export const PreflightRequestSchema = z
  .object({ invoke: z.boolean().default(false) })
  .strict();

export interface CandidateSummary {
  id: string;
  state: CandidateState;
  schedulingReasons: Array<
    "activity" | "periodic" | "uniform_evaluation" | "uploaded_image"
  >;
  sourceInterval: { startSeconds: number; endSeconds: number } | null;
  proposerProposalCount: number | null;
  reviewVerdict: "teachable" | "not_teachable" | "insufficient_evidence" | null;
  reviewReason: string | null;
  errorCode: string | null;
  suppressionReason: string | null;
  /** Review card shown to the human; absent on sessions created before feedback existed. */
  cardKind?: CardKind | null;
  cardFramesKept?: boolean;
  humanFeedback?: HumanFeedback | null;
  /** The judge's opportunities for this window, with concepts and coverage. */
  opportunities?: CandidateOpportunity[];
}

export interface SessionSnapshot {
  id: string;
  generation: number;
  revision: number;
  sourceKind: "image" | "video" | "phone";
  mode: "scan" | "replay" | "live";
  state: SessionState;
  createdAt: string;
  updatedAt: string;
  sourceDurationMs: number | null;
  observedSourceMs: number;
  connection: "not_applicable" | "waiting" | "connected" | "disconnected";
  counters: {
    proposerAttempts: number;
    reviewerAttempts: number;
    reviewerReservations: number;
    skippedWindows: number;
    replacedWindows: number;
    droppedFrameBatches: number;
    captureGaps: number;
  };
  events: DiscoveryEvent[];
  candidates: CandidateSummary[];
  errors: Array<{ code: string; message: string; retryable: boolean }>;
}

export function parseStrictModelJson<T>(textValue: string, schema: z.ZodType<T>) {
  const trimmed = textValue.trim();
  const fenced = /^```(?:json)?\s*\n([\s\S]*?)\n```$/.exec(trimmed);
  return schema.parse(JSON.parse(fenced ? fenced[1] : trimmed));
}
