/**
 * Historical 1.1 specification, not connected to the app.
 * Detector/provenance design is superseded by VISION-FIRST-DIRECTION.md.
 * Do not copy this as the revised runtime contract without coordinated changes.
 * Copy/adapt into shared/discovery.ts and implement matching Zod schemas.
 * Runtime semantic constraints are specified in IMPLEMENTATION.md.
 */
export type InputMode = "uploaded_video" | "uploaded_image" | "live_phone";
export type ProcessingMode = "scan" | "replay" | "live" | "image";
export type OpportunityKind = "observed_action" | "scene_context";
export type Concept = "force" | "torque" | "equilibrium" | "projectile";
export type ActionLabel = "opening_hinged_door" | "basketball_shot";
export type Family = "rotation" | "projectile" | "force_interaction" | "static_context";
export type Verdict = "teachable" | "not_teachable" | "insufficient_evidence";
export type SessionState =
  | "created" | "waiting_for_input" | "running" | "paused"
  | "draining" | "completed" | "stopped" | "failed" | "interrupted";
export type CandidateState =
  | "collecting" | "awaiting_media" | "queued" | "reviewing"
  | "approved" | "rejected" | "insufficient_evidence"
  | "suppressed" | "budget_exhausted" | "failed" | "cancelled";
export type DetectorStatus = "ready" | "disabled" | "unavailable" | "degraded" | "not_applicable";
export type ModelMode = "custom_head" | "pretrained_baseline" | "disabled";
export interface TimeRangeMs { startMs: number; endMs: number }
export interface Gap { startMs: number; endMs: number; reason: string }

export interface CourseContext {
  moduleId: "intro-mechanics-forces-torque";
  version: "1";
  objectives: Array<{ id: string; concept: Concept; text: string }>;
}

export interface FrameRecord {
  frameId: string;
  sessionId: string;
  seq: number;
  sourceTimeMs: number;
  receivedAt: string;
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
  relativePath: string; // Internal only; never accept a client filesystem path.
  pinCount: number;
}

export interface DetectionSignal {
  detectionId: string;
  detector: "action" | "explorer";
  modelId: string;
  modelVersion: string;
  modelMode: ModelMode | "bedrock";
  promptVersion: string | null;
  label: string;
  family: Family;
  opportunityKind: OpportunityKind;
  sourceRange: TimeRangeMs | null;
  rawScore: number | null;
  scoreMeaning: "uncalibrated_softmax" | "self_reported_support" | "none";
  support: "weak" | "moderate" | "strong";
  observation: string;
  evidenceFrameIds: string[];
  inferenceMs: number;
}

export interface CandidateRecord {
  candidateId: string;
  sessionId: string;
  state: CandidateState;
  opportunityKind: OpportunityKind;
  family: Family;
  sourceRange: TimeRangeMs | null;
  detections: DetectionSignal[];
  priority: 1 | 2 | 3;
  createdAt: string;
  revision: number;
  processingGeneration: number;
  terminalReason: string | null;
  mergedIntoCandidateId: string | null;
  evidenceSnapshotId: string | null;
  reviewJobId: string | null;
}

export interface Usage {
  inputTokens: number | null;
  outputTokens: number | null;
  latencyMs: number;
  estimatedUsd: number | null;
  pricingVersion: string | null;
}

export interface InvocationRecord {
  invocationId: string;
  sessionId: string | null;
  candidateId: string | null;
  stage: "explorer" | "reviewer" | "legacy" | "preflight";
  modelId: string;
  promptVersion: string | null;
  attempt: number;
  state: "reserved" | "started" | "succeeded" | "failed" | "unknown";
  startedAt: string | null;
  usage: Usage | null;
  errorCode: string | null;
}

export interface MediaDescriptor {
  kind: "video" | "image";
  assetId: string;
  url: string; // Same-origin path, authentication required.
  mimeType: "video/mp4" | "image/jpeg";
  sha256: string;
  width: number;
  height: number;
  byteLength: number;
  sourceTimebase: "uploaded_media_seconds" | "session_media_seconds" | "not_applicable";
  sourceStartSeconds: number | null;
  sourceEndSeconds: number | null;
  clipDurationSeconds: number | null;
  eventStartInClipSeconds: number | null;
  eventEndInClipSeconds: number | null;
  fidelity: "source_video_transcode" | "sampled_camera_frames" | "normalized_image";
  nominalFps: number | null;
  timingUncertaintyMs: number | null;
  gaps: Gap[]; // Milliseconds relative to the delivered clip; normally empty.
  hasAudio: false;
}

export interface ReviewEvidence {
  frameId: string;
  timeInClipSeconds: number | null;
  statement: string;
}

export interface ReviewResult {
  verdict: Verdict;
  opportunityKind: OpportunityKind;
  modelId: string;
  promptVersion: string;
  objectiveIds: string[];
  concepts: Concept[];
  observation: string;
  evidence: ReviewEvidence[];
  reason: string;
  limitations: string[];
  reviewedAt: string;
  usage: Usage;
}

export interface DiscoveryEvent {
  schemaVersion: "1.1";
  exampleOnly: boolean; // Must be false for real runtime records.
  eventId: string;
  sessionId: string;
  candidateId: string;
  inputMode: InputMode;
  processingMode: ProcessingMode;
  createdAt: string;
  media: MediaDescriptor;
  course: CourseContext;
  detections: DetectionSignal[];
  fusion: {
    support: "action_only" | "explorer_only" | "both_detectors";
    reason: string;
    disagreement: boolean;
  };
  review: ReviewResult;
}

/** Exact JSON requested from the explorer; provenance is added by the server. */
export interface ExplorerModelOutput {
  proposals: Array<{
    label: string;
    family: Family;
    opportunityKind: OpportunityKind;
    startFrameId: string;
    endFrameId: string;
    support: "weak" | "moderate" | "strong";
    observation: string;
    evidenceFrameIds: string[];
  }>;
}

/** Exact JSON requested from reviewer. No model-generated paths or timestamps. */
export interface ReviewerModelOutput {
  verdict: Verdict;
  opportunityKind: OpportunityKind;
  objectiveIds: string[];
  concepts: Concept[];
  observation: string;
  evidence: Array<{ frameId: string; statement: string }>;
  reason: string;
  limitations: string[];
}

export interface SessionCounters {
  acceptedFrames: number;
  duplicateFrames: number;
  droppedFrames: number;
  actionWindows: number;
  skippedActionWindows: number;
  explorerAttempts: number;
  reviewerAttempts: number;
  candidates: number;
  mergedCandidates: number;
  suppressedCandidates: number;
  approved: number;
  rejected: number;
  insufficientEvidence: number;
  inputTokens: number | null;
  outputTokens: number | null;
  estimatedUsd: number | null;
}

export interface SessionSnapshot {
  sessionId: string;
  state: SessionState;
  inputMode: InputMode;
  processingMode: ProcessingMode;
  revision: number;
  mediaTimeMs: number;
  sourceDurationMs: number | null;
  acceptingFrames: boolean;
  detectors: {
    action: { status: DetectorStatus; mode: ModelMode; modelVersion: string | null };
    explorer: { status: DetectorStatus; modelId: string };
    reviewer: { status: DetectorStatus; modelId: string };
  };
  counters: SessionCounters;
  warnings: string[];
  error: { code: string; message: string } | null;
}

export interface CreateSessionRequest {
  inputMode: InputMode;
  processingMode: ProcessingMode;
}
export interface FrameBatchMetadata {
  batchId: string;
  clock: "media_time" | "performance_clock";
  frames: Array<{ partName: string; seq: number; sourceTimeMs: number }>;
  gaps: Gap[]; // Source-time gaps since previous acknowledged batch, possibly empty.
}
export interface FrameBatchResponse {
  acceptedThroughSeq: number;
  acceptedCount: number;
  duplicates: number;
  acceptingFrames: boolean;
}
export interface DiscoveryError {
  error: { code: string; message: string; retryable: boolean; requestId: string };
}

export interface CandidateSummary {
  candidateId: string;
  state: CandidateState;
  family: Family;
  sourceRange: TimeRangeMs | null;
  detectors: Array<"action" | "explorer">;
  terminalReason: string | null;
}
export interface EventSummary {
  eventId: string;
  verdict: Verdict;
  observation: string;
  concepts: Concept[];
  createdAt: string;
}
export interface SessionReadResponse {
  session: SessionSnapshot;
  candidates: CandidateSummary[];
  events: EventSummary[];
  nextRevision: number;
}
export interface CaptureConfig {
  targetFps: number;
  maxLongSide: number;
  jpegQuality: number;
  maxFrameBytes: number;
  maxBatchFrames: number;
  batchIntervalMs: number;
  maxPendingBatches: number;
}
export interface PairingRedemptionResponse {
  sessionId: string;
  config: CaptureConfig;
}
