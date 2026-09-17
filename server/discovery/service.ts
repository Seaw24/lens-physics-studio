import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import QRCode from "qrcode";
import {
  EventSchema,
  parseStrictModelJson,
  publicOpportunity,
  type CandidateOpportunity,
  type CoverageRef,
  type DiscoveryEvent,
  type DiscoveryFrame,
  type GroundedOpportunity,
  type JudgedOpportunity,
  type SessionSnapshot,
} from "../../shared/discovery";
import { DISCOVERY_COURSE } from "../../shared/discoveryCourse";
import {
  LessonDraftResponseSchema,
  buildReport,
  cardKindFor,
  humanTruth,
  isAuditSample,
  isHoldoutVideo,
  isRepeatLabel,
  renderLessons,
  renderReviewerExamples,
  selectReviewerExamples,
  summarizeProposal,
  type CardKind,
  type FeedbackRequest,
  type Lesson,
  type LessonAction,
  type LessonModel,
  type ProposalSummary,
} from "../../shared/learning";
import { BedrockTransport, GlobalCloudDispatcher } from "../bedrock";
import { ActivityGate, scheduleWindows } from "./activity";
import { DiscoveryAuth } from "./auth";
import { reserveBuildEvaluationCalls } from "./buildBudget";
import type { DiscoveryConfig } from "./config";
import { safeDiscoveryConfig } from "./config";
import { DiscoveryError } from "./errors";
import {
  eventsOverlap,
  maximumGapMs,
  normalizedMeanAbsoluteDifference,
  normalizeSubject,
} from "./grouping";
import { LearningStore } from "./learning";
import { DiscoveryMedia } from "./media";
import { tagRepeatNotes } from "./migrations";
import {
  DiscoveryModels,
  ModelOutputError,
  type LearningContext,
  type ModelFrame,
} from "./models";
import { buildContactSheet } from "./contactSheet";
import { buildDraftContent, selectDraftCases } from "./draftContext";
import {
  PROMPT_VERSION,
  lessonDrafterSystemPrompt,
  proposerSystemPrompt,
  reviewerSystemPrompt,
} from "./prompts";
import {
  DiscoveryStore,
  type StoredCandidate,
  type StoredSession,
} from "./store";
import { buildVideoContext, renderVideoContext } from "./videoContext";

/** What happened to one judged opportunity when the server tried to publish it. */
interface PublishOutcome {
  eventId: string | null;
  startSeconds: number | null;
  /** The earlier event this opportunity was merged into by the server's overlap checks. */
  mergedInto: CoverageRef | null;
}
const notPublished: PublishOutcome = {
  eventId: null,
  startSeconds: null,
  mergedInto: null,
};

/** Held-out cards replayed per lesson check (each case costs two model calls). */
const MAX_CHECK_CASES = 6;

function sha256(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}
function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
function terminal(state: StoredSession["state"]) {
  return [
    "completed",
    "budget_exhausted",
    "interrupted",
    "failed",
    "canceled",
  ].includes(state);
}
function publicSnapshot(session: StoredSession): SessionSnapshot {
  const {
    sourceId: _sourceId,
    sourceRelativePath: _sourceRelativePath,
    sourceMimeType: _sourceMimeType,
    frames: _frames,
    snapshots: _snapshots,
    assets: _assets,
    retiredEvents: _retiredEvents,
    workCache: _workCache,
    idempotency: _idempotency,
    phone: _phone,
    ownerUserId: _ownerUserId,
    ...snapshot
  } = session;
  return snapshot;
}

interface UploadedPart {
  tempPath: string;
  size: number;
  mimeType: string;
}
interface PhonePart {
  partName: string;
  bytes: Buffer;
  mimeType: string;
}
interface PhoneMetadata {
  sessionId: string;
  generation: number;
  batchId: string;
  timingMethod?: string;
  droppedBatches?: number;
  frames: Array<{
    frameId: string;
    seq: number;
    sourceTimeMs: number;
    sha256: string;
    partName: string;
  }>;
}

export class DiscoveryService {
  readonly auth: DiscoveryAuth;
  readonly store: DiscoveryStore;
  readonly media: DiscoveryMedia;
  readonly transport: BedrockTransport;
  readonly dispatcher: GlobalCloudDispatcher;
  readonly models: DiscoveryModels;
  readonly learning: LearningStore;
  private controllers = new Map<string, AbortController>();
  private processing = new Map<string, Promise<void>>();
  private createIdempotency = new Map<
    string,
    { hash: string; sessionId: string }
  >();
  private activityTimes = new Map<string, number[]>();
  private activityGates = new Map<string, ActivityGate>();
  private phoneLastProcessedEnd = new Map<string, number>();
  private phoneDrainRequested = new Set<string>();
  private modelStates: {
    proposer: "unknown" | "available" | "unavailable";
    reviewer: "unknown" | "available" | "unavailable";
  } = { proposer: "unknown", reviewer: "unknown" };

  private constructor(readonly config: DiscoveryConfig) {
    this.store = new DiscoveryStore(config);
    this.auth = new DiscoveryAuth(config);
    this.media = new DiscoveryMedia(config, this.store);
    this.transport = new BedrockTransport(config);
    this.dispatcher = new GlobalCloudDispatcher(config);
    this.models = new DiscoveryModels(
      config,
      this.store,
      this.transport,
      this.dispatcher,
    );
    this.learning = new LearningStore(config.runtimeRoot);
  }

  static async create(config: DiscoveryConfig) {
    const service = new DiscoveryService(config);
    await service.store.initialize();
    await service.learning.initialize();
    // Learning data fixes must never keep Discovery from starting.
    try {
      const tagged = await tagRepeatNotes(service.learning);
      if (tagged.length) {
        await service.syncSessionLabels(tagged);
        console.log(
          `Discovery learning: tagged ${tagged.length} earlier label(s) as repeats: ${tagged.join(", ")}`,
        );
      }
    } catch (error) {
      console.warn("Discovery repeat-label migration skipped:", error);
    }
    try {
      const filled = await service.backfillJudgeDetails();
      if (filled)
        console.log(
          `Discovery learning: kept the judge's view for ${filled} earlier label(s).`,
        );
    } catch (error) {
      console.warn("Discovery judge-detail backfill skipped:", error);
    }
    return service;
  }

  /** Keeps a stored session's copy of a label in step with its durable record. */
  private async syncSessionLabels(candidateIds: string[]) {
    const live = new Set(this.store.list().map((session) => session.id));
    for (const id of candidateIds) {
      const record = this.learning.feedback(id);
      if (!record || !live.has(record.sessionId)) continue;
      await this.store.mutate(record.sessionId, (session) => {
        const candidate = session.candidates.find((item) => item.id === id);
        if (candidate?.humanFeedback)
          candidate.humanFeedback = { ...record.feedback };
      });
    }
  }

  /** Older labels lack the judge's view; copy it from stage files while their sessions still exist. */
  private async backfillJudgeDetails() {
    const live = new Set(this.store.list().map((session) => session.id));
    const sessions = new Map<string, StoredSession>();
    let filled = 0;
    for (const record of this.learning.feedbackRecords()) {
      if (record.judge !== undefined || !live.has(record.sessionId)) continue;
      if (!sessions.has(record.sessionId))
        sessions.set(record.sessionId, this.store.get(record.sessionId));
      const candidate = sessions
        .get(record.sessionId)!
        .candidates.find((item) => item.id === record.candidateId);
      const details = await this.judgeDetails(
        record.sessionId,
        record.candidateId,
        candidate,
        sessions.get(record.sessionId)!.events,
      );
      await this.learning.updateRecord(record.candidateId, (value) => ({
        ...value,
        ...details,
      }));
      filled++;
    }
    return filled;
  }

  /** The judge's view of a card, read from its stage files, for durable feedback records. */
  private async judgeDetails(
    sessionId: string,
    candidateId: string,
    candidate?: StoredCandidate,
    events: DiscoveryEvent[] = [],
  ) {
    const stageFile = (stage: string) =>
      path.join(
        this.store.sessionDir(sessionId),
        "candidates",
        `${candidateId}-${stage}.json`,
      );
    const reviewer = await this.readJson<{
      rawText?: string;
      response?: { opportunities?: Array<Partial<JudgedOpportunity>> };
      videoContext?: { text?: string | null };
    }>(stageFile("reviewer"));
    const proposer = await this.readJson<{
      response?: { proposals?: Array<{ evidenceFrameIds?: string[] }> };
    }>(stageFile("proposer"));
    let analysis: string | null = null;
    try {
      const raw = reviewer?.rawText ? JSON.parse(reviewer.rawText) : null;
      if (typeof raw?.analysis === "string")
        analysis = raw.analysis.slice(0, 2_000);
    } catch {
      analysis = null;
    }
    const cited = (items?: Array<{ evidenceFrameIds?: string[] }>) => [
      ...new Set((items ?? []).flatMap((item) => item.evidenceFrameIds ?? [])),
    ];
    const judgeEvidence = cited(reviewer?.response?.opportunities);
    const opportunities: CandidateOpportunity[] =
      candidate?.opportunities ??
      (reviewer?.response?.opportunities ?? []).map((item) => ({
        concept: typeof item.concept === "string" ? item.concept : null,
        subject: item.subject ?? "",
        observation: item.observation ?? "",
        connection: item.connection ?? "",
        objectiveIds: [...(item.objectiveIds ?? [])],
        // Older cards predate stored opportunities; match their published event by subject.
        eventId:
          events.find(
            (event) =>
              event.candidateId === candidateId &&
              normalizeSubject(event.review.opportunity.subject) ===
                normalizeSubject(item.subject ?? ""),
          )?.id ?? null,
        coveredBy: null,
      }));
    return {
      judge: reviewer ? { analysis, opportunities } : null,
      evidenceFrameIds: judgeEvidence.length
        ? judgeEvidence
        : cited(proposer?.response?.proposals),
      videoContext: reviewer?.videoContext?.text
        ? reviewer.videoContext.text.slice(0, 4_000)
        : null,
    };
  }

  async close() {
    for (const controller of this.controllers.values()) controller.abort();
    this.transport.close();
    await this.store.close();
  }

  getConfig() {
    return {
      ...safeDiscoveryConfig(this.config),
      course: DISCOVERY_COURSE,
      modelStates: { ...this.modelStates },
    };
  }

  listSessions(cursor?: string, limit = 20) {
    const sessions = this.store.list();
    const cursorIndex = cursor
      ? sessions.findIndex((session) => session.id === cursor)
      : -1;
    if (cursor && cursorIndex < 0)
      throw new DiscoveryError(
        "INVALID_CURSOR",
        "The session page cursor is no longer available.",
        400,
      );
    const start = cursor ? cursorIndex + 1 : 0;
    const page = sessions.slice(start, start + limit);
    return {
      sessions: page,
      nextCursor:
        start + page.length < sessions.length ? page.at(-1)?.id || null : null,
    };
  }

  getSession(id: string, afterRevision?: number) {
    const session = this.store.get(id);
    if (afterRevision !== undefined && session.revision <= afterRevision)
      return { unchanged: true, revision: session.revision };
    return publicSnapshot(session);
  }

  async createSession(
    input: {
      sourceKind: "image" | "video" | "phone";
      mode: "scan" | "replay" | "live";
    },
    idempotencyKey: string,
    ownerUserId?: string,
  ) {
    if (!this.config.enabled)
      throw new DiscoveryError(
        "DISCOVERY_DISABLED",
        "Discovery is disabled on this server.",
        503,
      );
    const inputHash = sha256(JSON.stringify(input));
    const prior = this.createIdempotency.get(idempotencyKey);
    if (prior) {
      if (prior.hash !== inputHash)
        throw new DiscoveryError(
          "IDEMPOTENCY_CONFLICT",
          "This idempotency key was already used with different input.",
          409,
        );
      return publicSnapshot(this.store.get(prior.sessionId));
    }
    const session = await this.store.create(
      input.sourceKind,
      input.mode,
      ownerUserId,
    );
    this.createIdempotency.set(idempotencyKey, {
      hash: inputHash,
      sessionId: session.id,
    });
    return publicSnapshot(session);
  }

  async uploadSource(sessionId: string, upload: UploadedPart) {
    const session = this.store.get(sessionId);
    if (session.state !== "created" || session.sourceKind === "phone")
      throw new DiscoveryError(
        "INVALID_STATE",
        "This session cannot accept an uploaded source.",
        409,
      );
    const limit =
      session.sourceKind === "image"
        ? this.config.limits.stillBytes
        : this.config.limits.recordingBytes;
    if (upload.size > limit)
      throw new DiscoveryError(
        "SOURCE_TOO_LARGE",
        "The uploaded source exceeds its configured limit.",
        413,
      );
    await this.store.assertStorageCapacity(upload.size * 2);
    const folder = path.join(this.store.sessionDir(sessionId), "source");
    if (session.sourceKind === "image") {
      const destination = path.join(folder, "normalized.jpg");
      const normalized = await this.media.normalizeStill(
        upload.tempPath,
        destination,
      );
      await this.store.mutate(sessionId, (value) => {
        value.sourceRelativePath = path.join("source", "normalized.jpg");
        value.sourceMimeType = "image/jpeg";
        value.sourceDurationMs = null;
        value.observedSourceMs = 0;
        value.frames = [
          {
            frameId: "image_frame",
            seq: 0,
            sourceTimeMs: null,
            sha256: normalized.sha256,
            width: normalized.width,
            height: normalized.height,
            orientation: 1,
          },
        ];
      });
    } else {
      const destination = path.join(folder, "source.bin");
      await fs.rename(upload.tempPath, destination);
      const probe = await this.media.probeVideo(destination);
      await this.store.mutate(sessionId, (value) => {
        value.sourceRelativePath = path.join("source", "source.bin");
        value.sourceMimeType = upload.mimeType;
        value.sourceDurationMs = probe.durationMs;
      });
    }
    try {
      await fs.unlink(upload.tempPath);
    } catch {
      // The video path was atomically moved; still uploads clean their temp here.
    }
    return publicSnapshot(this.store.get(sessionId));
  }

  async start(sessionId: string, generation: number) {
    const session = this.store.get(sessionId);
    if (session.generation !== generation)
      throw new DiscoveryError(
        "GENERATION_CONFLICT",
        "The session generation has changed.",
        409,
      );
    if (["ingesting", "paused", "draining"].includes(session.state))
      return publicSnapshot(session);
    if (terminal(session.state))
      throw new DiscoveryError(
        "INVALID_STATE",
        "A terminal session cannot be started again.",
        409,
      );
    if (session.sourceKind !== "phone" && !session.sourceRelativePath)
      throw new DiscoveryError(
        "SOURCE_REQUIRED",
        "Upload a source before starting Discovery.",
        409,
      );
    await this.store.mutate(sessionId, (value) => {
      value.state = "ingesting";
    });
    const controller = new AbortController();
    this.controllers.set(sessionId, controller);
    if (session.sourceKind !== "phone") {
      const job = this.processFiniteSession(
        sessionId,
        generation,
        controller.signal,
      );
      this.processing.set(sessionId, job);
      job.finally(() => this.processing.delete(sessionId));
    }
    return publicSnapshot(this.store.get(sessionId));
  }

  async pause(sessionId: string, generation: number) {
    await this.requireGeneration(sessionId, generation);
    await this.store.mutate(sessionId, (session) => {
      if (session.state === "paused") return;
      if (session.state !== "ingesting")
        throw new DiscoveryError(
          "INVALID_STATE",
          "Only an ingesting session can be paused.",
          409,
        );
      session.state = "paused";
    });
    return publicSnapshot(this.store.get(sessionId));
  }

  async resume(sessionId: string, generation: number) {
    await this.requireGeneration(sessionId, generation);
    await this.store.mutate(sessionId, (session) => {
      if (session.state === "ingesting") return;
      if (session.state !== "paused")
        throw new DiscoveryError(
          "INVALID_STATE",
          "Only a paused session can be resumed.",
          409,
        );
      session.state = "ingesting";
    });
    return publicSnapshot(this.store.get(sessionId));
  }

  async stop(sessionId: string, generation: number) {
    await this.requireGeneration(sessionId, generation);
    const session = this.store.get(sessionId);
    if (terminal(session.state)) return publicSnapshot(session);
    await this.store.mutate(sessionId, (value) => {
      value.state = "draining";
      if (value.sourceKind === "phone") value.connection = "disconnected";
    });
    if (session.sourceKind === "phone") {
      this.phoneDrainRequested.add(sessionId);
      await this.queuePhoneProcessing(sessionId, generation);
    }
    return publicSnapshot(this.store.get(sessionId));
  }

  async cancel(sessionId: string, generation: number) {
    await this.requireGeneration(sessionId, generation);
    this.controllers
      .get(sessionId)
      ?.abort(new DOMException("Discovery session canceled", "AbortError"));
    await this.store.mutate(sessionId, (session) => {
      if (session.state === "canceled") return;
      session.generation++;
      session.state = "canceled";
      session.connection =
        session.sourceKind === "phone" ? "disconnected" : "not_applicable";
      session.counters.reviewerReservations = 0;
      for (const candidate of session.candidates)
        if (
          ["proposed", "collecting", "queued", "reviewing"].includes(
            candidate.state,
          )
        )
          candidate.state = "canceled";
    });
    this.auth.revokeSession(sessionId);
    return publicSnapshot(this.store.get(sessionId));
  }

  async delete(sessionId: string) {
    const current = this.store.get(sessionId);
    if (!terminal(current.state))
      await this.cancel(sessionId, current.generation);
    this.auth.revokeSession(sessionId);
    await this.store.delete(sessionId);
  }

  async pair(sessionId: string) {
    const session = this.store.get(sessionId);
    if (session.sourceKind !== "phone" || terminal(session.state))
      throw new DiscoveryError(
        "PAIRING_UNAVAILABLE",
        "Only an active phone session can be paired.",
        409,
      );
    const pairing = this.auth.issuePairing(sessionId, session.generation);
    return {
      ...pairing,
      qrDataUrl: await QRCode.toDataURL(pairing.url, {
        margin: 1,
        width: 280,
        errorCorrectionLevel: "M",
      }),
    };
  }

  async heartbeat(sessionId: string, generation: number) {
    await this.requireGeneration(sessionId, generation);
    await this.store.mutate(sessionId, (session) => {
      session.phone.lastHeartbeatAt = new Date().toISOString();
      session.connection = "connected";
    });
    return this.captureStatus(sessionId);
  }

  captureStatus(sessionId: string) {
    const session = this.store.get(sessionId);
    return {
      sessionId: session.id,
      generation: session.generation,
      state: session.state,
      connection: session.connection,
      ackSequence: session.phone.ackSequence,
      captureGaps: session.counters.captureGaps,
      droppedFrameBatches: session.counters.droppedFrameBatches,
      observedSourceMs: session.observedSourceMs,
    };
  }

  async ingestPhoneBatch(metadata: PhoneMetadata, parts: PhonePart[]) {
    const session = this.store.get(metadata.sessionId);
    if (session.sourceKind !== "phone" || session.state !== "ingesting")
      throw new DiscoveryError(
        "INVALID_STATE",
        "This session is not accepting phone frames.",
        409,
      );
    await this.requireGeneration(metadata.sessionId, metadata.generation);
    if (
      metadata.frames.length < 1 ||
      metadata.frames.length > 8 ||
      parts.length !== metadata.frames.length
    )
      throw new DiscoveryError(
        "INVALID_FRAME_BATCH",
        "A phone batch must contain one to eight matching frames.",
      );
    const metadataHash = sha256(
      JSON.stringify({
        ...metadata,
        frames: metadata.frames.map((frame) => ({ ...frame })),
        receivedParts: parts
          .map((part) => ({
            partName: part.partName,
            sha256: sha256(part.bytes),
          }))
          .sort((a, b) => a.partName.localeCompare(b.partName)),
      }),
    );
    const priorBatch = session.phone.batchIds[metadata.batchId];
    if (priorBatch) {
      if (priorBatch !== metadataHash)
        throw new DiscoveryError(
          "FRAME_BATCH_CONFLICT",
          "This batch ID was reused with different metadata.",
          409,
        );
      return this.captureStatus(metadata.sessionId);
    }
    await this.store.assertStorageCapacity(
      parts.reduce((total, part) => total + part.bytes.length, 0) * 2,
    );
    const byName = new Map(parts.map((part) => [part.partName, part]));
    const normalized: Array<
      DiscoveryFrame & { path: string; active: boolean }
    > = [];
    let previousTime = session.frames.at(-1)?.sourceTimeMs ?? null;
    let previousSeq = session.phone.ackSequence;
    const gate =
      this.activityGates.get(metadata.sessionId) || new ActivityGate();
    this.activityGates.set(metadata.sessionId, gate);
    for (const frame of metadata.frames) {
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(frame.frameId))
        throw new DiscoveryError("INVALID_FRAME_ID", "Invalid frame ID.");
      const part = byName.get(frame.partName);
      if (
        !part ||
        part.mimeType !== "image/jpeg" ||
        sha256(part.bytes) !== frame.sha256
      )
        throw new DiscoveryError(
          "FRAME_INTEGRITY_FAILED",
          "A phone frame failed its MIME type or SHA-256 assertion.",
          400,
        );
      const sequenceKey = String(frame.seq);
      const priorHash = session.phone.sequenceHashes[sequenceKey];
      if (priorHash) {
        if (priorHash !== frame.sha256)
          throw new DiscoveryError(
            "FRAME_SEQUENCE_CONFLICT",
            "A frame sequence was reused with different content.",
            409,
          );
        continue;
      }
      if (
        frame.seq <= previousSeq ||
        (previousTime !== null && frame.sourceTimeMs <= previousTime)
      )
        throw new DiscoveryError(
          "FRAME_CLOCK_CONFLICT",
          "New phone frames must have increasing sequence and source time.",
          409,
        );
      if (previousTime !== null && frame.sourceTimeMs - previousTime > 500)
        session.counters.captureGaps++;
      const result = await this.media.normalizePhoneFrame(part.bytes);
      const destination = path.join(
        this.store.sessionDir(metadata.sessionId),
        "frames",
        `${frame.frameId}.jpg`,
      );
      await fs.writeFile(destination, result.bytes, {
        flag: "wx",
        mode: 0o600,
      });
      const tick = gate.push(
        frame.sourceTimeMs,
        await this.media.grayscaleThumbnail(result.bytes),
      );
      normalized.push({
        frameId: frame.frameId,
        seq: frame.seq,
        sourceTimeMs: frame.sourceTimeMs,
        sha256: result.sha256,
        width: result.width,
        height: result.height,
        orientation: 1,
        path: destination,
        active: tick.active,
      });
      previousTime = frame.sourceTimeMs;
      previousSeq = frame.seq;
    }
    await this.store.mutate(metadata.sessionId, (value) => {
      value.phone.batchIds[metadata.batchId] = metadataHash;
      value.phone.timingMethod =
        metadata.timingMethod || value.phone.timingMethod;
      value.counters.droppedFrameBatches += Math.max(
        0,
        metadata.droppedBatches || 0,
      );
      for (const frame of normalized) {
        value.frames.push({
          frameId: frame.frameId,
          seq: frame.seq,
          sourceTimeMs: frame.sourceTimeMs,
          sha256: frame.sha256,
          width: frame.width,
          height: frame.height,
          orientation: 1,
        });
        value.phone.sequenceHashes[String(frame.seq)] = metadata.frames.find(
          (item) => item.seq === frame.seq,
        )!.sha256;
        value.phone.ackSequence = Math.max(value.phone.ackSequence, frame.seq);
        value.observedSourceMs = Math.max(
          value.observedSourceMs,
          frame.sourceTimeMs!,
        );
      }
      value.connection = "connected";
      value.phone.lastHeartbeatAt = new Date().toISOString();
      if (value.observedSourceMs >= this.config.limits.phoneSessionMs)
        value.state = "draining";
    });
    const active = this.activityTimes.get(metadata.sessionId) || [];
    active.push(
      ...normalized
        .filter((frame) => frame.active)
        .map((frame) => frame.sourceTimeMs!),
    );
    this.activityTimes.set(metadata.sessionId, active);
    if (
      this.store.get(metadata.sessionId).observedSourceMs >=
      this.config.limits.phoneSessionMs
    )
      this.phoneDrainRequested.add(metadata.sessionId);
    void this.queuePhoneProcessing(metadata.sessionId, metadata.generation);
    return this.captureStatus(metadata.sessionId);
  }

  async getEvent(eventId: string) {
    for (const summary of this.store.list()) {
      const session = this.store.get(summary.id);
      const event = [...session.events, ...(session.retiredEvents ?? [])].find(
        (item) => item.id === eventId,
      );
      if (event) return event;
    }
    throw new DiscoveryError("NOT_FOUND", "Discovery event not found.", 404);
  }

  findAsset(assetId: string) {
    if (!/^[a-zA-Z0-9_-]+$/.test(assetId))
      throw new DiscoveryError("NOT_FOUND", "Discovery asset not found.", 404);
    for (const summary of this.store.list()) {
      const session = this.store.get(summary.id);
      const asset = session.assets.find((item) => item.assetId === assetId);
      if (asset)
        return {
          asset,
          path: this.media.assetPath(session.id, asset),
          sessionId: session.id,
        };
    }
    throw new DiscoveryError("NOT_FOUND", "Discovery asset not found.", 404);
  }

  async preflight(invoke: boolean) {
    const local = this.getConfig();
    if (!invoke)
      return {
        invoked: false,
        local,
        models: { proposer: "not_invoked", reviewer: "not_invoked" },
      };
    this.transport.resetCircuit();
    const folder = path.join(this.config.runtimeRoot, "preflight");
    await fs.mkdir(folder, { recursive: true, mode: 0o700 });
    const file = path.join(folder, "chronological-image-check.jpg");
    await sharp({
      create: {
        width: 96,
        height: 96,
        channels: 3,
        background: { r: 235, g: 231, b: 218 },
      },
    })
      .jpeg()
      .toFile(file);
    const bytes = await fs.readFile(file);
    const frame: ModelFrame = {
      frameId: "preflight_image",
      seq: 0,
      sourceTimeMs: null,
      sha256: sha256(bytes),
      width: 96,
      height: 96,
      orientation: 1,
      path: file,
    };
    const results: Record<string, unknown> = {};
    await this.reserveBuildCall("preflight_proposer");
    try {
      const proposer = await this.models.propose(
        "preflight",
        1,
        "image",
        frame.sha256,
        [frame],
        "explicit_preflight",
        [
          "Synthetic blank image used only to verify chronological image input.",
        ],
      );
      results.proposer = {
        state: "available",
        modelId: this.config.proposerModelId,
        usage: proposer.usage,
        latencyMs: proposer.latencyMs,
      };
      this.modelStates.proposer = "available";
    } catch (error) {
      this.modelStates.proposer = "unavailable";
      results.proposer = {
        state: "unavailable",
        modelId: this.config.proposerModelId,
        error: error instanceof Error ? error.name : "UnknownError",
      };
      return { invoked: true, local, models: results };
    }
    await this.reserveBuildCall("preflight_reviewer");
    try {
      const reviewer = await this.models.review(
        "preflight",
        1,
        "image",
        frame.sha256,
        [frame],
        "explicit_preflight",
        [
          "Synthetic blank image used only to verify chronological image input.",
        ],
      );
      results.reviewer = {
        state: "available",
        modelId: this.config.reviewerModelId,
        usage: reviewer.usage,
        latencyMs: reviewer.latencyMs,
      };
      this.modelStates.reviewer = "available";
    } catch (error) {
      this.modelStates.reviewer = "unavailable";
      results.reviewer = {
        state: "unavailable",
        modelId: this.config.reviewerModelId,
        error: error instanceof Error ? error.name : "UnknownError",
      };
    }
    return { invoked: true, local, models: results };
  }

  private async reserveBuildCall(reason: string) {
    await reserveBuildEvaluationCalls(this.config, [reason]);
  }

  private async processFiniteSession(
    sessionId: string,
    generation: number,
    signal: AbortSignal,
  ) {
    try {
      const initial = this.store.get(sessionId);
      if (initial.sourceKind === "image") {
        const source = this.sourcePath(initial);
        const frame = initial.frames[0];
        await this.processSnapshot(
          sessionId,
          generation,
          [{ ...frame, path: source }],
          ["uploaded_image"],
          null,
          signal,
        );
      } else {
        const source = this.sourcePath(initial);
        const duration = initial.sourceDurationMs!;
        const windows = scheduleWindows(duration, [], "cascade_uniform");
        const activityGate = new ActivityGate();
        const activeTimes: number[] = [];
        let activityAnalyzedThrough = 0;
        let lastActivityAdmission = -Infinity;
        let periodicDue = 6_000;
        let replayWatermark = 0;
        let replayLastWall = Date.now();
        for (const window of windows) {
          if (signal.aborted) throw signal.reason;
          await this.waitWhilePaused(sessionId, generation, signal);
          const current = this.store.get(sessionId);
          if (current.state === "draining") break;
          if (current.mode === "replay") {
            const requiredWatermark = Math.min(duration, window.endMs + 2_000);
            while (replayWatermark < requiredWatermark) {
              await this.waitWhilePaused(sessionId, generation, signal);
              const now = Date.now();
              replayWatermark += now - replayLastWall;
              replayLastWall = now;
              await this.store.mutate(sessionId, (session) => {
                session.observedSourceMs = Math.min(duration, replayWatermark);
              });
              if (replayWatermark < requiredWatermark) await sleep(100);
            }
          }
          const thumbnails = await this.media.extractActivityThumbnails(
            source,
            activityAnalyzedThrough,
            window.endMs,
          );
          activityAnalyzedThrough = window.endMs;
          for (const thumbnail of thumbnails) {
            const tick = activityGate.push(
              thumbnail.sourceTimeMs,
              thumbnail.grayscale,
            );
            if (tick.active) activeTimes.push(tick.sourceTimeMs);
          }
          const reasons: Array<"activity" | "periodic"> = [];
          const hasActivity = activeTimes.some(
            (time) => time >= window.startMs && time <= window.endMs,
          );
          if (hasActivity && window.endMs - lastActivityAdmission >= 6_000) {
            reasons.push("activity");
            lastActivityAdmission = window.endMs;
          }
          if (window.endMs >= periodicDue) {
            reasons.push("periodic");
            while (periodicDue <= window.endMs) periodicDue += 12_000;
          }
          if (!reasons.length && window.partial && window.endMs === duration)
            reasons.push("periodic");
          if (!reasons.length) continue;
          const extracted = await this.media.extractVideoFrames(
            sessionId,
            source,
            window.startMs,
            window.endMs,
          );
          await this.store.mutate(sessionId, (session) => {
            session.observedSourceMs = Math.max(
              session.observedSourceMs,
              window.endMs,
            );
            for (const frame of extracted.frames)
              if (
                !session.frames.some((item) => item.frameId === frame.frameId)
              )
                session.frames.push({
                  frameId: frame.frameId,
                  seq: frame.seq,
                  sourceTimeMs: frame.sourceTimeMs,
                  sha256: frame.sha256,
                  width: frame.width,
                  height: frame.height,
                  orientation: frame.orientation,
                });
          });
          await this.processSnapshot(
            sessionId,
            generation,
            extracted.frames,
            reasons,
            { startMs: window.startMs, endMs: window.endMs },
            signal,
          );
        }
      }
      const current = this.store.get(sessionId);
      if (current.generation === generation && !terminal(current.state))
        await this.store.mutate(sessionId, (session) => {
          session.state = "completed";
          session.counters.reviewerReservations = 0;
          if (session.sourceDurationMs !== null)
            session.observedSourceMs = session.sourceDurationMs;
        });
    } catch (error) {
      if (signal.aborted) return;
      await this.failSession(sessionId, generation, error);
    }
  }

  private async processSnapshot(
    sessionId: string,
    generation: number,
    frames: ModelFrame[],
    reasons: Array<
      "activity" | "periodic" | "uniform_evaluation" | "uploaded_image"
    >,
    interval: { startMs: number; endMs: number } | null,
    signal: AbortSignal,
  ) {
    const snapshotHash = sha256(
      JSON.stringify({
        sessionId,
        generation,
        promptVersion: PROMPT_VERSION,
        course: DISCOVERY_COURSE,
        reasons,
        frames: frames.map((frame) => ({
          frameId: frame.frameId,
          sha256: frame.sha256,
          sourceTimeMs: frame.sourceTimeMs,
        })),
      }),
    );
    const workKey = sha256(
      JSON.stringify({
        sessionId,
        generation,
        stage: "cascade",
        proposer: this.config.proposerModelId,
        reviewer: this.config.reviewerModelId,
        snapshotHash,
        promptVersion: PROMPT_VERSION,
        course: DISCOVERY_COURSE,
      }),
    );
    const current = this.store.get(sessionId);
    if (current.workCache[workKey]) return;
    const admitted = await this.reserveProposal(sessionId, generation);
    if (!admitted) return;
    const snapshotId = randomUUID();
    const candidateId = randomUUID();
    const representativeBytes = await fs.readFile(
      frames[Math.floor(frames.length / 2)].path,
    );
    const thumbnailGrayBase64 = Buffer.from(
      await this.media.grayscaleThumbnail(representativeBytes),
    ).toString("base64");
    const candidate: StoredCandidate = {
      id: candidateId,
      state: "queued",
      schedulingReasons: reasons,
      sourceInterval: interval
        ? {
            startSeconds: interval.startMs / 1000,
            endSeconds: interval.endMs / 1000,
          }
        : null,
      proposerProposalCount: null,
      reviewVerdict: null,
      reviewReason: null,
      errorCode: null,
      suppressionReason: null,
      snapshotId,
      proposerInvocationId: null,
      proposerPromptHash: null,
      reviewerInvocationId: null,
      reviewerPromptHash: null,
      contributingCandidateIds: [candidateId],
      proposerLessonVersion: this.learning.version("proposer"),
      reviewerLessonVersion: this.learning.version("reviewer"),
      reviewerModelId: this.config.reviewerModelId,
      cardKind: null,
      cardFramesKept: false,
      humanFeedback: null,
    };
    await this.store.mutate(sessionId, (session) => {
      session.snapshots.push({
        id: snapshotId,
        hash: snapshotHash,
        frameIds: frames.map((frame) => frame.frameId),
        startMs: interval?.startMs ?? null,
        endMs: interval?.endMs ?? null,
        schedulingReasons: reasons,
        promptVersion: PROMPT_VERSION,
        thumbnailGrayBase64,
      });
      session.candidates.push(candidate);
      session.workCache[workKey] = { state: "unknown", attemptId: candidateId };
    });
    const limitations = [
      "Chronological JPEGs sampled at 2 fps; audio and continuous motion are excluded.",
      ...(this.store.get(sessionId).sourceKind === "phone"
        ? [
            "Foreground phone capture may contain timing gaps and held display frames.",
          ]
        : []),
    ];
    try {
      const proposal = await this.models.propose(
        sessionId,
        generation,
        this.store.get(sessionId).sourceKind,
        snapshotHash,
        frames,
        reasons.join("+"),
        limitations,
        signal,
        this.learningContext("proposer", sessionId, []),
      );
      if (!this.canPublish(sessionId, generation)) return;
      await this.store.mutate(sessionId, (session) => {
        const item = session.candidates.find(
          (value) => value.id === candidateId,
        )!;
        item.proposerProposalCount = proposal.response.proposals.length;
        item.proposerInvocationId = proposal.attemptId;
        item.proposerPromptHash = proposal.promptHash;
        item.novaProposals = proposal.response.proposals.map((value) => ({
          kind: value.kind,
          subject: value.subject,
          observation: value.observation,
          objectiveIds: value.objectiveIds,
        }));
      });
      await this.persistStageEvidence(sessionId, candidateId, "proposer", {
        invocationId: proposal.attemptId,
        promptHash: proposal.promptHash,
        snapshotHash,
        response: proposal.response,
        rawText: proposal.rawText,
        repaired: proposal.repaired,
        usage: proposal.usage,
        latencyMs: proposal.latencyMs,
      });
      const proposals = proposal.response.proposals.map(summarizeProposal);
      // Reviewed proposals and a sample of empty windows become review cards,
      // so their frames are kept beyond live frame eviction.
      const cardFramesKept =
        (proposals.length > 0 || isAuditSample(candidateId)) &&
        (await this.keepCardFrames(sessionId, candidateId, frames));
      if (proposal.response.proposals.length === 0) {
        await this.store.mutate(sessionId, (session) => {
          const item = session.candidates.find(
            (value) => value.id === candidateId,
          )!;
          item.state = "not_teachable";
          item.suppressionReason = "proposer_returned_empty";
          if (cardFramesKept) {
            item.cardKind = "nova_empty";
            item.cardFramesKept = true;
          }
          session.counters.reviewerReservations--;
          session.workCache[workKey] = {
            state: "successful",
            attemptId: proposal.attemptId,
          };
        });
        await this.recordOutcome(sessionId, candidateId, proposals, null, null);
        return;
      }
      const reviewAdmitted = await this.admitReview(sessionId, generation);
      if (!reviewAdmitted) {
        await this.store.mutate(sessionId, (session) => {
          const item = session.candidates.find(
            (value) => value.id === candidateId,
          )!;
          item.state = "suppressed_budget";
          item.suppressionReason = "review_budget_unavailable";
        });
        return;
      }
      await this.store.mutate(sessionId, (session) => {
        session.candidates.find((value) => value.id === candidateId)!.state =
          "reviewing";
      });
      const reviewExpiresAt = Date.now() + this.config.limits.reviewExpiryMs;
      // Reviews of one session run one at a time, so this is current when the judge decides.
      const videoContext = buildVideoContext(
        this.store.get(sessionId),
        candidateId,
      );
      const videoText = renderVideoContext(videoContext);
      const review = await this.models.review(
        sessionId,
        generation,
        this.store.get(sessionId).sourceKind,
        snapshotHash,
        frames,
        reasons.join("+"),
        limitations,
        signal,
        reviewExpiresAt,
        this.learningContext(
          "reviewer",
          sessionId,
          proposals.flatMap((item) => item.objectiveIds),
        ),
        {
          text: videoText,
          refs: videoContext.covered.map((entry) => entry.ref),
        },
      );
      if (!this.canPublish(sessionId, generation)) return;
      const teachable = review.response.verdict === "teachable";
      await this.store.mutate(sessionId, (session) => {
        const item = session.candidates.find(
          (value) => value.id === candidateId,
        )!;
        item.reviewerInvocationId = review.attemptId;
        item.reviewerPromptHash = review.promptHash;
        item.reviewVerdict = review.response.verdict;
        item.reviewReason = review.response.reason;
        item.cardFramesKept = cardFramesKept;
        // A teachable card's kind waits for publishing: it may only repeat covered concepts.
        if (!teachable) {
          item.cardKind = cardKindFor(review.response.verdict, proposals.length);
          item.state = review.response.verdict as
            | "not_teachable"
            | "insufficient_evidence";
        }
        session.workCache[workKey] = {
          state: "successful",
          attemptId: review.attemptId,
        };
      });
      await this.persistStageEvidence(sessionId, candidateId, "reviewer", {
        invocationId: review.attemptId,
        promptHash: review.promptHash,
        snapshotHash,
        response: review.response,
        rawText: review.rawText,
        usage: review.usage,
        latencyMs: review.latencyMs,
        videoContext: { text: videoText, covered: videoContext.covered },
      });
      if (!teachable) {
        await this.recordOutcome(
          sessionId,
          candidateId,
          proposals,
          review.response.verdict,
          review.response.reason,
        );
        return;
      }
      // One card per physics concept per video: publish only concepts this video
      // has not covered, unless the judge rates a repeat as clearly the better card.
      const covered = new Map(
        videoContext.covered.map((entry) => [entry.ref, entry]),
      );
      const publishedConcepts = new Map<string, CoverageRef>();
      // Covered refs taken over during this review, so a second repeat of one
      // covers the new card instead of replacing it again.
      const takeovers = new Map<string, CoverageRef>();
      const judged: CandidateOpportunity[] = [];
      try {
        for (const opportunity of review.response.opportunities) {
          const concept = opportunity.concept?.trim() || null;
          const conceptKey = concept ? normalizeSubject(concept) : null;
          const ref = opportunity.coveredBy ?? null;
          const repeated = (ref && covered.get(ref)) || null;
          // A card the human already labeled is ground truth and stays.
          const upgrade = Boolean(
            opportunity.replacesCovered &&
              repeated?.coverage.eventId &&
              !repeated.labeled &&
              !takeovers.has(ref!),
          );
          let coveredBy =
            (ref && takeovers.get(ref)) ||
            (upgrade ? null : repeated?.coverage) ||
            (conceptKey && publishedConcepts.get(conceptKey)) ||
            null;
          let eventId: string | null = null;
          let replaced: CoverageRef | null = null;
          if (!coveredBy) {
            const outcome = await this.publishOpportunity(
              sessionId,
              generation,
              candidateId,
              frames,
              publicOpportunity(opportunity),
              review.response.reason,
              reasons,
              snapshotHash,
              {
                invocationId: proposal.attemptId,
                promptHash: proposal.promptHash,
              },
              {
                invocationId: review.attemptId,
                promptHash: review.promptHash,
              },
            );
            eventId = outcome.eventId;
            coveredBy = outcome.mergedInto;
            const card: CoverageRef | null = eventId
              ? {
                  candidateId,
                  eventId,
                  concept,
                  subject: opportunity.subject,
                  startSeconds: outcome.startSeconds,
                }
              : null;
            if (card && conceptKey) publishedConcepts.set(conceptKey, card);
            if (card && upgrade) {
              await this.retireCoveredCard(
                sessionId,
                generation,
                repeated!.coverage,
                card,
              );
              replaced = repeated!.coverage;
              takeovers.set(ref!, card);
            }
          }
          judged.push({
            concept,
            subject: opportunity.subject,
            observation: opportunity.observation,
            connection: opportunity.connection,
            objectiveIds: [...opportunity.objectiveIds],
            eventId,
            coveredBy,
            ...(replaced ? { replaced } : {}),
          });
        }
      } finally {
        // Also runs when a publication throws, so outcomes and concepts are never lost.
        await this.settleTeachableCard(
          sessionId,
          generation,
          candidateId,
          judged,
          review.response.opportunities.length,
          proposals,
          review.response.reason,
        );
      }
    } catch (error) {
      if (!this.canPublish(sessionId, generation)) return;
      if (error instanceof ModelOutputError)
        await this.persistStageEvidence(
          sessionId,
          candidateId,
          this.store
            .get(sessionId)
            .candidates.find((item) => item.id === candidateId)
            ?.proposerInvocationId
            ? "reviewer-invalid"
            : "proposer-invalid",
          {
            snapshotHash,
            validation: error.validation,
            rawText: error.rawText,
          },
        );
      await this.store.mutate(sessionId, (session) => {
        const item = session.candidates.find(
          (value) => value.id === candidateId,
        );
        if (item) {
          item.state =
            error instanceof DiscoveryError && error.code === "REVIEW_EXPIRED"
              ? "expired"
              : "failed";
          item.errorCode =
            error instanceof ModelOutputError
              ? "FAILED_INVALID_OUTPUT"
              : error instanceof DiscoveryError
                ? error.code
                : error instanceof Error && error.name === "ZodError"
                  ? "EVENT_VALIDATION_FAILED"
                  : "MODEL_OR_MEDIA_FAILURE";
        }
        session.counters.reviewerReservations = Math.max(
          0,
          session.counters.reviewerReservations - 1,
        );
        session.workCache[workKey] = {
          state: "failed",
          attemptId: candidateId,
        };
      });
      const name = error instanceof Error ? error.name : "UnknownError";
      if (/AccessDenied|Expired|Credentials|Unauthorized/.test(name))
        throw error;
    }
  }

  /**
   * A later card took over a covered concept: the earlier event is retired and,
   * once none of its events remain, the earlier card becomes a covered repeat.
   */
  private async retireCoveredCard(
    sessionId: string,
    generation: number,
    retired: CoverageRef,
    takeover: CoverageRef,
  ) {
    await this.store.mutate(sessionId, (session) => {
      if (session.generation !== generation || session.state === "canceled")
        return;
      const index = session.events.findIndex(
        (event) => event.id === retired.eventId,
      );
      if (index < 0) return;
      const [event] = session.events.splice(index, 1);
      (session.retiredEvents ??= []).push(event);
      const prior = session.candidates.find(
        (item) => item.id === retired.candidateId,
      );
      if (!prior) return;
      for (const item of prior.opportunities ?? [])
        if (item.eventId === retired.eventId) {
          item.eventId = null;
          item.coveredBy = takeover;
        }
      if (
        prior.cardKind === "approved" &&
        !session.events.some((item) => item.candidateId === prior.id)
      ) {
        prior.state = "suppressed_duplicate";
        prior.cardKind = "already_covered";
        prior.suppressionReason = `replaced_by_${takeover.candidateId}`;
      }
    });
  }

  /**
   * Settles a teachable card once publishing ends: approved when anything was
   * published, already covered only when every opportunity repeats a covered
   * concept, and otherwise the publication outcome (such as a capture gap) stands.
   */
  private async settleTeachableCard(
    sessionId: string,
    generation: number,
    candidateId: string,
    judged: CandidateOpportunity[],
    opportunityCount: number,
    proposals: ProposalSummary[],
    reason: string,
  ) {
    if (!this.canPublish(sessionId, generation)) return;
    const published = judged.some((item) => item.eventId);
    const allCovered =
      !published &&
      judged.length > 0 &&
      judged.length === opportunityCount &&
      judged.every((item) => item.coveredBy);
    await this.store.mutate(sessionId, (session) => {
      const item = session.candidates.find((value) => value.id === candidateId);
      if (!item) return;
      item.opportunities = judged;
      if (published) {
        item.state = "approved";
        item.cardKind = "approved";
      } else if (allCovered) {
        item.state = "suppressed_duplicate";
        item.cardKind = "already_covered";
        item.suppressionReason = `already_covered_by_${judged[0].coveredBy!.candidateId}`;
      } else if (item.state === "insufficient_evidence") {
        // The server blocked publication (a capture gap), so the card is a rejection.
        item.cardKind = "insufficient_evidence";
      }
    });
    await this.recordOutcome(
      sessionId,
      candidateId,
      proposals,
      "teachable",
      reason,
      allCovered,
    );
  }

  private learningContext(
    model: LessonModel,
    sessionId: string,
    objectives: string[],
    options: { include?: Lesson; exclude?: string; replay?: boolean } = {},
  ): LearningContext {
    const lessons = this.learning
      .listLessons()
      .filter((lesson) => lesson.id !== options.exclude);
    const examples =
      model === "reviewer"
        ? selectReviewerExamples(
            this.learning.feedbackRecords(),
            sessionId,
            objectives,
          )
        : [];
    return {
      lessons: renderLessons(lessons, model, options.include),
      examples: renderReviewerExamples(examples),
      version: `${this.learning.version(model)}${options.include ? `+${options.include.id}` : ""}|${examples
        .map((record) => record.candidateId)
        .join(",")}`,
      replay: options.replay,
    };
  }

  private cardFramesDir(sessionId: string, candidateId: string) {
    if (!/^[a-zA-Z0-9_-]{1,80}$/.test(candidateId))
      throw new DiscoveryError(
        "INVALID_CANDIDATE",
        "Invalid candidate ID.",
        400,
      );
    return path.join(
      this.store.sessionDir(sessionId),
      "candidates",
      `${candidateId}-frames`,
    );
  }

  /** Copies the exact frames the models saw; a failure never blocks the pipeline. */
  private async keepCardFrames(
    sessionId: string,
    candidateId: string,
    frames: ModelFrame[],
  ) {
    const dir = this.cardFramesDir(sessionId, candidateId);
    try {
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await Promise.all(
        frames.map((frame, index) =>
          fs.copyFile(
            frame.path,
            path.join(dir, `${String(index).padStart(2, "0")}.jpg`),
          ),
        ),
      );
      await fs.writeFile(
        path.join(dir, "frames.json"),
        JSON.stringify(frames.map(({ path: _path, ...frame }) => frame)),
        { mode: 0o600 },
      );
      return true;
    } catch {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
      return false;
    }
  }

  private async recordOutcome(
    sessionId: string,
    candidateId: string,
    proposals: ProposalSummary[],
    reviewVerdict: StoredCandidate["reviewVerdict"],
    reviewReason: string | null,
    alreadyCovered = false,
  ) {
    const candidate = this.store
      .get(sessionId)
      .candidates.find((item) => item.id === candidateId);
    await this.learning
      .appendOutcome({
        candidateId,
        sessionId,
        at: new Date().toISOString(),
        proposerLessonVersion: candidate?.proposerLessonVersion ?? "none",
        reviewerLessonVersion: candidate?.reviewerLessonVersion ?? "none",
        reviewerModelId: this.reviewerModelOf(candidate),
        proposals,
        reviewVerdict,
        reviewReason,
        alreadyCovered,
      })
      .catch(() => undefined);
  }

  private async readJson<T>(file: string): Promise<T | null> {
    try {
      return JSON.parse(await fs.readFile(file, "utf8")) as T;
    } catch {
      return null;
    }
  }

  // Candidates recorded before the judge model was stored were all reviewed by Sonnet 4.6.
  private reviewerModelOf(candidate?: StoredCandidate) {
    return candidate?.reviewerModelId ?? "us.anthropic.claude-sonnet-4-6";
  }

  private candidateCardKind(candidate: StoredCandidate): CardKind | null {
    if (candidate.cardKind) return candidate.cardKind;
    return candidate.reviewVerdict
      ? cardKindFor(candidate.reviewVerdict, candidate.proposerProposalCount)
      : null;
  }

  async candidateDetail(sessionId: string, candidateId: string) {
    const session = this.store.get(sessionId);
    const candidate = session.candidates.find(
      (item) => item.id === candidateId,
    );
    if (!candidate)
      throw new DiscoveryError(
        "NOT_FOUND",
        "Discovery candidate not found.",
        404,
      );
    const stageFile = (stage: string) =>
      path.join(
        this.store.sessionDir(sessionId),
        "candidates",
        `${candidateId}-${stage}.json`,
      );
    const proposer = await this.readJson<{
      response?: { proposals?: GroundedOpportunity[] };
    }>(stageFile("proposer"));
    const reviewer = await this.readJson<{
      response?: {
        verdict: string;
        reason: string;
        opportunities: GroundedOpportunity[];
      };
    }>(stageFile("reviewer"));
    const frames = (await this.cardFrames(session, candidate)).map(
      (item) => item.frame,
    );
    const proposals = proposer?.response?.proposals ?? [];
    const evidence = new Set(
      [...proposals, ...(reviewer?.response?.opportunities ?? [])].flatMap(
        (item) => item.evidenceFrameIds,
      ),
    );
    return {
      candidateId,
      cardKind: this.candidateCardKind(candidate),
      state: candidate.state,
      sourceKind: session.sourceKind,
      sourceInterval: candidate.sourceInterval,
      proposals,
      review: reviewer?.response ?? null,
      opportunities: candidate.opportunities ?? [],
      frames: frames.map((frame, index) => ({
        index,
        frameId: frame.frameId,
        sourceTimeMs: frame.sourceTimeMs,
        evidence: evidence.has(frame.frameId),
        url: `/api/discovery/sessions/${sessionId}/candidates/${candidateId}/frames/${index}`,
      })),
      feedback:
        candidate.humanFeedback ??
        this.learning.feedback(candidateId)?.feedback ??
        null,
    };
  }

  /**
   * Frames a card shows, in order of preference: the session card copy, the
   * durable feedback copy, then (for sessions recorded before cards kept
   * frames) the snapshot's original frames if they are still on disk.
   */
  private async cardFrames(session: StoredSession, candidate: StoredCandidate) {
    const exists = (file: string) =>
      fs.stat(file).then(
        () => true,
        () => false,
      );
    for (const dir of [
      this.cardFramesDir(session.id, candidate.id),
      this.learning.feedbackFramesDir(candidate.id),
    ]) {
      const frames = await this.readJson<DiscoveryFrame[]>(
        path.join(dir, "frames.json"),
      );
      if (frames?.length)
        return frames.map((frame, index) => ({
          frame,
          file: path.join(dir, `${String(index).padStart(2, "0")}.jpg`),
        }));
    }
    const snapshot = session.snapshots.find(
      (item) => item.id === candidate.snapshotId,
    );
    const byId = new Map(session.frames.map((frame) => [frame.frameId, frame]));
    const kept: Array<{ frame: DiscoveryFrame; file: string }> = [];
    for (const frameId of snapshot?.frameIds ?? []) {
      const frame = byId.get(frameId);
      const file = path.join(
        this.store.sessionDir(session.id),
        "frames",
        `${frameId}.jpg`,
      );
      if (frame && (await exists(file))) kept.push({ frame, file });
    }
    return kept;
  }

  async candidateFramePath(
    sessionId: string,
    candidateId: string,
    index: number,
  ) {
    const session = this.store.get(sessionId);
    const candidate = session.candidates.find(
      (item) => item.id === candidateId,
    );
    const file = candidate
      ? (await this.cardFrames(session, candidate))[index]?.file
      : undefined;
    if (!file) throw new DiscoveryError("NOT_FOUND", "Frame not found.", 404);
    return file;
  }

  async saveFeedback(
    sessionId: string,
    candidateId: string,
    body: FeedbackRequest,
  ) {
    const session = this.store.get(sessionId);
    const candidate = session.candidates.find(
      (item) => item.id === candidateId,
    );
    if (!candidate)
      throw new DiscoveryError(
        "NOT_FOUND",
        "Discovery candidate not found.",
        404,
      );
    if (candidate.state === "reviewing")
      throw new DiscoveryError(
        "CARD_NOT_READY",
        "This card is still being finalized. Try again in a moment.",
        409,
        true,
      );
    const cardKind = this.candidateCardKind(candidate);
    if (!cardKind)
      throw new DiscoveryError(
        "NOT_A_REVIEW_CARD",
        "Only reviewed proposals and sampled empty windows take feedback.",
        409,
      );
    const detail = await this.candidateDetail(sessionId, candidateId);
    const now = new Date().toISOString();
    const prior = this.learning.feedback(candidateId);
    const feedback = { ...body, updatedAt: now };
    const record = await this.learning.saveFeedback(
      {
        candidateId,
        sessionId,
        sourceKind: session.sourceKind,
        cardKind,
        proposals: detail.proposals.map(summarizeProposal),
        reviewVerdict: candidate.reviewVerdict,
        reviewReason: candidate.reviewReason,
        feedback,
        proposerPromptHash: candidate.proposerPromptHash,
        reviewerPromptHash: candidate.reviewerPromptHash,
        proposerLessonVersion: candidate.proposerLessonVersion ?? "none",
        reviewerLessonVersion: candidate.reviewerLessonVersion ?? "none",
        reviewerModelId: this.reviewerModelOf(candidate),
        holdout: isHoldoutVideo(sessionId),
        framesKept: prior?.framesKept ?? 0,
        createdAt: prior?.createdAt ?? now,
        ...(await this.judgeDetails(
          sessionId,
          candidateId,
          candidate,
          session.events,
        )),
      },
      await this.cardFrames(session, candidate),
    );
    await this.store.mutate(sessionId, (value) => {
      const item = value.candidates.find((entry) => entry.id === candidateId);
      if (!item) return;
      item.humanFeedback = feedback;
      item.cardKind = cardKind;
    });
    return { feedback, holdout: record.holdout, framesKept: record.framesKept };
  }

  private checkCases(model: LessonModel) {
    return this.learning
      .feedbackRecords()
      .filter(
        (record) =>
          record.holdout &&
          record.framesKept > 0 &&
          // Replays see one window, so repeat labels cannot be judged there.
          !isRepeatLabel(record) &&
          (model === "proposer" || record.cardKind !== "nova_empty"),
      )
      .sort((a, b) => b.feedback.updatedAt.localeCompare(a.feedback.updatedAt))
      .slice(0, MAX_CHECK_CASES);
  }

  learningOverview() {
    return {
      lessons: this.learning.listLessons(),
      versions: {
        proposer: this.learning.version("proposer"),
        reviewer: this.learning.version("reviewer"),
      },
      report: buildReport(
        this.learning.outcomeList(),
        this.learning.feedbackRecords(),
      ),
      checkCases: {
        proposer: this.checkCases("proposer").length,
        reviewer: this.checkCases("reviewer").length,
      },
    };
  }

  /** Drafting and lesson checks share the one-call-at-a-time model queue with live review. */
  private assertNoActiveSession(action: string) {
    const active = this.store
      .list()
      .some((session) =>
        ["ingesting", "paused", "draining"].includes(session.state),
      );
    if (active)
      throw new DiscoveryError(
        "SESSION_ACTIVE",
        `Stop or finish the running Discovery session before ${action}; it shares the model queue with live review and would stall it.`,
        409,
        true,
      );
  }

  async draftLessons() {
    this.assertNoActiveSession("drafting lessons");
    const records = this.learning.feedbackRecords();
    const outcomes = this.learning.outcomeList();
    const { human, imaged, judgeOnly } = selectDraftCases(records, outcomes);
    if (!human.length && !judgeOnly.length)
      throw new DiscoveryError(
        "NOTHING_TO_LEARN",
        "Label some cards or run a session before drafting lessons.",
        409,
      );
    const sheets = new Map<string, Buffer>();
    for (const record of imaged) {
      try {
        const frames = await this.feedbackFrames(record.candidateId);
        if (!frames.length) continue;
        const evidence = new Set(record.evidenceFrameIds ?? []);
        const sheet = await buildContactSheet(
          frames.map((frame) => ({
            file: frame.path,
            sourceTimeMs: frame.sourceTimeMs,
            evidence: evidence.has(frame.frameId),
          })),
        );
        sheets.set(record.candidateId, sheet.bytes);
      } catch {
        // A card whose frames cannot be read is still drafted from as text.
      }
    }
    const lessons = this.learning.listLessons();
    const liveIds = lessons
      .filter((lesson) =>
        ["active", "pending", "needs_evidence"].includes(lesson.status),
      )
      .map((lesson) => lesson.id);
    const request = buildDraftContent({
      lessons,
      report: buildReport(outcomes, records),
      human,
      imaged,
      sheets,
      judgeOnly,
      basePrompts: {
        proposer: proposerSystemPrompt,
        reviewer: reviewerSystemPrompt,
      },
    });
    const drafted = await this.models.draft({
      system: lessonDrafterSystemPrompt,
      content: request.content,
      replaceableIds: liveIds,
      retirableIds: liveIds,
    });
    const added = await this.learning.addDraftedLessons(
      drafted.response.lessons,
      request.cases,
    );
    const suggestions = await this.learning.suggestRetirements(
      (drafted.response.retire ?? []).map((item) => ({
        ...item,
        supportingIds: item.supportingIds ?? [],
      })),
      request.cases,
    );
    return {
      added,
      suggestions,
      images: request.imageCount,
      usage: drafted.usage,
    };
  }

  updateLesson(id: string, action: LessonAction, text?: string) {
    return this.learning.updateLesson(id, action, text);
  }

  private async feedbackFrames(candidateId: string): Promise<ModelFrame[]> {
    const dir = this.learning.feedbackFramesDir(candidateId);
    const frames =
      (await this.readJson<DiscoveryFrame[]>(path.join(dir, "frames.json"))) ||
      [];
    return frames.map((frame, index) => ({
      ...frame,
      path: path.join(dir, `${String(index).padStart(2, "0")}.jpg`),
    }));
  }

  /**
   * Replays held-out labeled cards with and without one lesson. Same frames,
   * same examples; only the lesson differs, so the difference is the lesson.
   */
  async checkLesson(id: string) {
    this.assertNoActiveSession("checking a lesson");
    const lesson = this.learning.listLessons().find((item) => item.id === id);
    if (!lesson)
      throw new DiscoveryError("LESSON_NOT_FOUND", "Lesson not found.", 404);
    const cases = this.checkCases(lesson.model);
    if (!cases.length)
      throw new DiscoveryError(
        "NO_HOLDOUT_CASES",
        "No held-out labeled cards with kept frames yet. Label cards from more videos first.",
        409,
      );
    const limitations = [
      "Chronological JPEGs sampled at 2 fps; audio and continuous motion are excluded.",
    ];
    let scored = 0;
    let baseline = 0;
    let withLesson = 0;
    let calls = 0;
    for (const record of cases) {
      const frames = await this.feedbackFrames(record.candidateId);
      if (!frames.length) continue;
      const truth = humanTruth(record.cardKind, record.feedback);
      const objectives = record.proposals.flatMap(
        (proposal) => proposal.objectiveIds,
      );
      const snapshotHash = sha256(`lesson-check:${record.candidateId}`);
      const judge = async (options: { include?: Lesson; exclude?: string }) => {
        calls++;
        const context = this.learningContext(
          lesson.model,
          record.sessionId,
          objectives,
          {
            ...options,
            replay: true,
          },
        );
        if (lesson.model === "reviewer") {
          const review = await this.models.review(
            "lesson-check",
            1,
            record.sourceKind,
            snapshotHash,
            frames,
            "lesson_check",
            limitations,
            undefined,
            undefined,
            context,
          );
          return (review.response.verdict === "teachable") === truth;
        }
        const proposal = await this.models.propose(
          "lesson-check",
          1,
          record.sourceKind,
          snapshotHash,
          frames,
          "lesson_check",
          limitations,
          undefined,
          context,
        );
        return proposal.response.proposals.length > 0 === truth;
      };
      try {
        const base = await judge({ exclude: lesson.id });
        const candidate = await judge({
          include: { ...lesson, status: "active" },
        });
        scored++;
        if (base) baseline++;
        if (candidate) withLesson++;
      } catch {
        // A failed replay call drops the case instead of counting as disagreement.
      }
    }
    if (!scored)
      throw new DiscoveryError(
        "LESSON_CHECK_FAILED",
        "Every check call failed; try again later.",
        502,
      );
    return this.learning.recordCheck(id, {
      at: new Date().toISOString(),
      cases: scored,
      baselineAgreement: baseline / scored,
      withLessonAgreement: withLesson / scored,
      calls,
    });
  }

  private async persistStageEvidence(
    sessionId: string,
    candidateId: string,
    stage: string,
    value: unknown,
  ) {
    const file = path.join(
      this.store.sessionDir(sessionId),
      "candidates",
      `${candidateId}-${stage}.json`,
    );
    await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
  }

  private async publishOpportunity(
    sessionId: string,
    generation: number,
    candidateId: string,
    snapshotFrames: ModelFrame[],
    opportunity: GroundedOpportunity,
    reviewReason: string,
    schedulingReasons: StoredCandidate["schedulingReasons"],
    snapshotHash: string,
    proposer: { invocationId: string; promptHash: string },
    reviewer: { invocationId: string; promptHash: string },
  ): Promise<PublishOutcome> {
    if (!this.canPublish(sessionId, generation)) return notPublished;
    const session = this.store.get(sessionId);
    const mergedInto = (event: DiscoveryEvent): CoverageRef => ({
      candidateId: event.candidateId,
      eventId: event.id,
      concept:
        session.candidates
          .find((candidate) => candidate.id === event.candidateId)
          ?.opportunities?.find((item) => item.eventId === event.id)?.concept ??
        null,
      subject: event.review.opportunity.subject,
      startSeconds: event.review.eventSourceInterval?.startSeconds ?? null,
    });
    const frameMap = new Map(
      snapshotFrames.map((frame) => [frame.frameId, frame]),
    );
    const evidenceFrames = opportunity.evidenceFrameIds.map((id) =>
      frameMap.get(id)!,
    );
    const startMs = frameMap.get(opportunity.startFrameId)!.sourceTimeMs;
    const endMs = frameMap.get(opportunity.endFrameId)!.sourceTimeMs;
    const eventInterval =
      startMs === null || endMs === null
        ? null
        : { startSeconds: startMs / 1000, endSeconds: endMs / 1000 };
    const duplicate = session.events.find((event) =>
      eventsOverlap(event, opportunity, eventInterval),
    );
    if (duplicate) {
      await this.store.mutate(sessionId, (value) => {
        const primary = value.candidates.find(
          (item) => item.id === duplicate.candidateId,
        );
        if (primary && !primary.contributingCandidateIds.includes(candidateId))
          primary.contributingCandidateIds.push(candidateId);
      });
      return { ...notPublished, mergedInto: mergedInto(duplicate) };
    }
    if (opportunity.kind === "scene_context" && eventInterval) {
      const currentSnapshot = session.snapshots.find(
        (snapshot) =>
          snapshot.id ===
          session.candidates.find((candidate) => candidate.id === candidateId)
            ?.snapshotId,
      );
      const repeated = session.events.find((event) => {
        if (
          event.review.opportunity.kind !== "scene_context" ||
          !event.review.eventSourceInterval ||
          !currentSnapshot?.thumbnailGrayBase64 ||
          normalizeSubject(event.review.opportunity.subject) !==
            normalizeSubject(opportunity.subject) ||
          !event.review.opportunity.objectiveIds.some((objective) =>
            opportunity.objectiveIds.includes(objective),
          ) ||
          Math.abs(
            event.review.eventSourceInterval.endSeconds -
              eventInterval.endSeconds,
          ) > 30
        )
          return false;
        const priorCandidate = session.candidates.find(
          (candidate) => candidate.id === event.candidateId,
        );
        const priorSnapshot = session.snapshots.find(
          (snapshot) => snapshot.id === priorCandidate?.snapshotId,
        );
        if (!priorSnapshot?.thumbnailGrayBase64) return false;
        return (
          normalizedMeanAbsoluteDifference(
            Buffer.from(priorSnapshot.thumbnailGrayBase64, "base64"),
            Buffer.from(currentSnapshot.thumbnailGrayBase64, "base64"),
          ) <= 0.02
        );
      });
      if (repeated) {
        await this.store.mutate(sessionId, (value) => {
          const primary = value.candidates.find(
            (item) => item.id === repeated.candidateId,
          );
          if (
            primary &&
            !primary.contributingCandidateIds.includes(candidateId)
          )
            primary.contributingCandidateIds.push(candidateId);
        });
        return { ...notPublished, mergedInto: mergedInto(repeated) };
      }
    }
    let asset;
    let mediaFields;
    if (session.sourceKind === "image") {
      const result = await this.media.publishStillAsset(
        sessionId,
        this.sourcePath(session),
      );
      asset = result.record;
      mediaFields = {
        width: result.width,
        height: result.height,
        fidelity: "normalized_still" as const,
        sourceInterval: null,
        durationSeconds: null,
        timingUncertaintyMs: null,
        maxCaptureGapMs: null,
      };
    } else {
      const clipStart = Math.max(0, startMs! - 2_000);
      const sourceEnd =
        session.sourceKind === "video"
          ? session.sourceDurationMs!
          : session.observedSourceMs;
      const clipEnd = Math.min(sourceEnd, endMs! + 2_000, clipStart + 10_000);
      if (session.sourceKind === "video") {
        const result = await this.media.publishVideoClip(
          sessionId,
          this.sourcePath(session),
          clipStart,
          clipEnd,
        );
        asset = result.record;
        mediaFields = {
          width: result.probe.width,
          height: result.probe.height,
          fidelity: "source_video_clip" as const,
          sourceInterval: {
            startSeconds: clipStart / 1000,
            endSeconds: clipEnd / 1000,
          },
          durationSeconds: (clipEnd - clipStart) / 1000,
          timingUncertaintyMs: 100,
          maxCaptureGapMs: null,
        };
      } else {
        const allFrames = session.frames
          .filter(
            (frame) =>
              frame.sourceTimeMs! <= clipEnd &&
              frame.sourceTimeMs! >= clipStart,
          )
          .map((frame) => ({
            ...frame,
            path: path.join(
              this.store.sessionDir(sessionId),
              "frames",
              `${frame.frameId}.jpg`,
            ),
          }));
        const gap = maximumGapMs(
          session.frames.map((frame) => frame.sourceTimeMs!),
          startMs!,
          endMs!,
        );
        if (opportunity.kind === "observed_action" && gap > 500) {
          await this.store.mutate(sessionId, (value) => {
            const candidate = value.candidates.find(
              (item) => item.id === candidateId,
            )!;
            candidate.state = "insufficient_evidence";
            candidate.errorCode = "CAPTURE_GAP";
          });
          return notPublished;
        }
        const result = await this.media.publishPhoneClip(
          sessionId,
          allFrames,
          clipStart,
          clipEnd,
        );
        asset = result.record;
        mediaFields = {
          width: result.probe.width,
          height: result.probe.height,
          fidelity: "sampled_camera_frames" as const,
          sourceInterval: {
            startSeconds: clipStart / 1000,
            endSeconds: clipEnd / 1000,
          },
          durationSeconds: (clipEnd - clipStart) / 1000,
          timingUncertaintyMs: 125,
          maxCaptureGapMs: gap,
        };
      }
    }
    let event: DiscoveryEvent;
    try {
      event = EventSchema.parse({
        schemaVersion: "2.0",
        exampleOnly: false,
        id: randomUUID(),
        sessionId,
        candidateId,
        createdAt: new Date().toISOString(),
        course: { id: DISCOVERY_COURSE.id, version: DISCOVERY_COURSE.version },
        source: { kind: session.sourceKind, sourceId: session.sourceId },
        review: {
          verdict: "teachable",
          reason: reviewReason,
          opportunity,
          eventSourceInterval: eventInterval,
          evidence: evidenceFrames.map((frame) => ({
            frameId: frame.frameId,
            sourceTimeSeconds:
              frame.sourceTimeMs === null ? null : frame.sourceTimeMs / 1000,
            clipTimeSeconds:
              frame.sourceTimeMs === null || !mediaFields.sourceInterval
                ? null
                : frame.sourceTimeMs / 1000 -
                  mediaFields.sourceInterval.startSeconds,
          })),
        },
        media: {
          assetId: asset.assetId,
          url: `/api/discovery/assets/${asset.assetId}`,
          mimeType: asset.mimeType,
          sha256: asset.sha256,
          ...mediaFields,
        },
        provenance: {
          schedulingReasons,
          proposer: {
            modelId: this.config.proposerModelId,
            promptHash: proposer.promptHash,
            invocationId: proposer.invocationId,
          },
          reviewer: {
            modelId: this.config.reviewerModelId,
            promptHash: reviewer.promptHash,
            invocationId: reviewer.invocationId,
          },
          snapshotHash,
        },
      });
    } catch (error) {
      await fs
        .unlink(this.media.assetPath(sessionId, asset))
        .catch(() => undefined);
      await this.persistStageEvidence(
        sessionId,
        candidateId,
        "publication-failed",
        {
          errorName: error instanceof Error ? error.name : "UnknownError",
          validation:
            error instanceof Error ? error.message.slice(0, 4_000) : null,
        },
      );
      throw error;
    }
    if (!this.canPublish(sessionId, generation)) return notPublished;
    await this.store.mutate(sessionId, (value) => {
      if (value.generation !== generation || value.state === "canceled") return;
      value.assets.push(asset);
      value.events.push(event);
    });
    return {
      eventId: event.id,
      startSeconds: eventInterval?.startSeconds ?? null,
      mergedInto: null,
    };
  }

  private async queuePhoneProcessing(sessionId: string, generation: number) {
    const existing = this.processing.get(sessionId);
    if (existing) return existing;
    const controller = this.controllers.get(sessionId) || new AbortController();
    this.controllers.set(sessionId, controller);
    const processedBefore = this.phoneLastProcessedEnd.get(sessionId) || 0;
    const job = this.processPhoneAvailable(
      sessionId,
      generation,
      controller.signal,
    )
      .catch(async (error) => {
        if (!controller.signal.aborted)
          await this.failSession(sessionId, generation, error);
      })
      .finally(() => {
        this.processing.delete(sessionId);
        const current = this.store.get(sessionId);
        const processedEnd = this.phoneLastProcessedEnd.get(sessionId) || 0;
        // Requeue only after progress. A pass with no ready window finishes in
        // microtasks, so requeueing it would starve the event loop; the next
        // uploaded batch schedules processing again. A drain needs one more
        // pass after its final window to mark the session completed.
        if (
          processedEnd > processedBefore &&
          current.generation === generation &&
          !terminal(current.state) &&
          (current.observedSourceMs > processedEnd + 3_000 ||
            this.phoneDrainRequested.has(sessionId))
        )
          void this.queuePhoneProcessing(sessionId, generation);
      });
    this.processing.set(sessionId, job);
    return job;
  }

  private async processPhoneAvailable(
    sessionId: string,
    generation: number,
    signal: AbortSignal,
  ) {
    const session = this.store.get(sessionId);
    const last = this.phoneLastProcessedEnd.get(sessionId) || 0;
    const windows = scheduleWindows(
      session.observedSourceMs,
      this.activityTimes.get(sessionId) || [],
      "cascade_gated",
    ).filter(
      (window) =>
        window.endMs > last &&
        (!window.partial || this.phoneDrainRequested.has(sessionId)),
    );
    if (!windows.length) {
      if (this.phoneDrainRequested.has(sessionId))
        await this.store.mutate(sessionId, (value) => {
          if (!terminal(value.state)) value.state = "completed";
        });
      return;
    }
    let chosen = windows.find((window) => window.reasons.includes("periodic"));
    chosen ||= windows.at(-1)!;
    if (windows.length > 1)
      await this.store.mutate(sessionId, (value) => {
        value.counters.replacedWindows += windows.length - 1;
      });
    const sourceFrames = session.frames
      .filter(
        (frame) =>
          frame.sourceTimeMs! >= chosen!.startMs &&
          frame.sourceTimeMs! <= chosen!.endMs,
      )
      .sort((a, b) => a.sourceTimeMs! - b.sourceTimeMs!);
    const selected: typeof sourceFrames = [];
    let next = chosen.startMs;
    for (const frame of sourceFrames) {
      if (frame.sourceTimeMs! >= next) {
        selected.push(frame);
        next += 500;
      }
      if (selected.length === 12) break;
    }
    if (selected.length >= 2) {
      const modelFrames = selected.map((frame) => ({
        ...frame,
        path: path.join(
          this.store.sessionDir(sessionId),
          "frames",
          `${frame.frameId}.jpg`,
        ),
      }));
      await this.processSnapshot(
        sessionId,
        generation,
        modelFrames,
        chosen.reasons,
        { startMs: chosen.startMs, endMs: chosen.endMs },
        signal,
      );
    }
    this.phoneLastProcessedEnd.set(sessionId, chosen.endMs);
    await this.evictOldPhoneFrames(sessionId);
  }

  private async evictOldPhoneFrames(sessionId: string) {
    const session = this.store.get(sessionId);
    const cutoff = session.observedSourceMs - 45_000;
    if (cutoff <= 0) return;
    const removable = session.frames.filter(
      (frame) => frame.sourceTimeMs !== null && frame.sourceTimeMs < cutoff,
    );
    for (const frame of removable)
      await fs
        .unlink(
          path.join(
            this.store.sessionDir(sessionId),
            "frames",
            `${frame.frameId}.jpg`,
          ),
        )
        .catch(() => undefined);
    if (removable.length)
      await this.store.mutate(sessionId, (value) => {
        const ids = new Set(removable.map((frame) => frame.frameId));
        value.frames = value.frames.filter((frame) => !ids.has(frame.frameId));
      });
  }

  private async reserveProposal(sessionId: string, generation: number) {
    let admitted = false;
    await this.store.mutate(sessionId, (session) => {
      if (session.generation !== generation || terminal(session.state)) return;
      const limits = this.config.limits;
      const combined =
        session.counters.proposerAttempts + session.counters.reviewerAttempts;
      const remainingReviews =
        limits.reviewerAttempts -
        session.counters.reviewerAttempts -
        session.counters.reviewerReservations;
      if (
        session.counters.proposerAttempts >= limits.proposerAttempts ||
        combined >= limits.combinedAttempts ||
        remainingReviews <= 0
      ) {
        session.state = "budget_exhausted";
        session.counters.skippedWindows++;
        return;
      }
      session.counters.proposerAttempts++;
      session.counters.reviewerReservations++;
      admitted = true;
    });
    return admitted;
  }

  private async admitReview(sessionId: string, generation: number) {
    let admitted = false;
    await this.store.mutate(sessionId, (session) => {
      if (session.generation !== generation || terminal(session.state)) return;
      if (session.counters.reviewerReservations <= 0) return;
      session.counters.reviewerReservations--;
      const combined =
        session.counters.proposerAttempts + session.counters.reviewerAttempts;
      if (
        session.counters.reviewerAttempts >=
          this.config.limits.reviewerAttempts ||
        combined >= this.config.limits.combinedAttempts
      ) {
        session.state = "budget_exhausted";
        return;
      }
      session.counters.reviewerAttempts++;
      admitted = true;
    });
    return admitted;
  }

  private sourcePath(session: StoredSession) {
    if (!session.sourceRelativePath)
      throw new DiscoveryError(
        "SOURCE_REQUIRED",
        "Session source is missing.",
        409,
      );
    const root = this.store.sessionDir(session.id) + path.sep;
    const resolved = path.resolve(
      this.store.sessionDir(session.id),
      session.sourceRelativePath,
    );
    if (!resolved.startsWith(root))
      throw new DiscoveryError("INVALID_SOURCE", "Invalid source path.", 500);
    return resolved;
  }

  private async waitWhilePaused(
    sessionId: string,
    generation: number,
    signal: AbortSignal,
  ) {
    while (this.store.get(sessionId).state === "paused") {
      if (signal.aborted) throw signal.reason;
      await this.requireGeneration(sessionId, generation);
      await sleep(100);
    }
  }

  private async requireGeneration(sessionId: string, generation: number) {
    if (this.store.get(sessionId).generation !== generation)
      throw new DiscoveryError(
        "GENERATION_CONFLICT",
        "The session generation has changed.",
        409,
      );
  }

  private canPublish(sessionId: string, generation: number) {
    try {
      const session = this.store.get(sessionId);
      return session.generation === generation && session.state !== "canceled";
    } catch {
      return false;
    }
  }

  private async failSession(
    sessionId: string,
    generation: number,
    error: unknown,
  ) {
    if (!this.canPublish(sessionId, generation)) return;
    const code =
      error instanceof DiscoveryError ? error.code : "SESSION_FAILED";
    const message =
      error instanceof DiscoveryError
        ? error.message
        : "Discovery stopped because a dependency or model request failed.";
    await this.store.mutate(sessionId, (session) => {
      session.state = "failed";
      session.counters.reviewerReservations = 0;
      session.errors.push({ code, message, retryable: false });
    });
  }
}
