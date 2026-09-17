import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { DiscoveryEvent } from "../../shared/discovery";
import { DISCOVERY_COURSE } from "../../shared/discoveryCourse";
import type {
  DayRecording,
  DayResponse,
  DaySlide,
  StudioEventResponse,
  StudioRecord,
} from "../../shared/studio/schema";
import { DiscoveryError } from "../discovery/errors";
import type { DiscoveryService } from "../discovery/service";
import type { StoredSession } from "../discovery/store";
import { StudioAgents, type StudioClip, type StudioFacts } from "./agents";
import { extractStudioFrames, studioFrameTimes, writePoster } from "./frames";

const TERMINAL = new Set(["completed", "budget_exhausted", "interrupted", "failed", "canceled"]);
const CONCURRENCY = 2;
const MAX_RECORDINGS = 8;

/** Explicit rebuilds outrank everything; otherwise the most recently wanted studio goes first. */
const PRIORITY = { automatic: 5, viewed: 5, requested: 10 } as const;

interface QueueItem {
  eventId: string;
  priority: number;
  force: boolean;
  /** Refreshed whenever the studio is asked for again, so stale requests sink. */
  wantedAt: number;
}

/**
 * Builds an event studio (annotations, quiz and lab) for every accepted
 * Discovery event. It only reads the Discovery store, runs on its own lane so
 * proposer and judge calls are never delayed, and persists results next to
 * each session so they share its retention.
 */
export class StudioService {
  readonly agents: StudioAgents;
  readonly modelId: string;
  private records = new Map<string, StudioRecord>();
  private queue: QueueItem[] = [];
  private running = new Map<string, Promise<void>>();
  private activeSeen = new Set<string>();
  private queuedSessions = new Set<string>();
  private fingerprints = new Map<string, string | null>();
  private timer: NodeJS.Timeout | null = null;
  private controller = new AbortController();

  constructor(readonly discovery: DiscoveryService) {
    this.modelId = process.env.STUDIO_MODEL_ID || "us.anthropic.claude-opus-4-6-v1";
    this.agents = new StudioAgents(discovery.store, discovery.transport, this.modelId);
  }

  start() {
    this.timer = setInterval(() => void this.sweep().catch(() => undefined), 4_000);
    this.timer.unref();
    void this.sweep().catch(() => undefined);
  }

  close() {
    if (this.timer) clearInterval(this.timer);
    this.controller.abort();
  }

  /** Sessions that finish while this server runs get all their events queued. */
  private async sweep() {
    for (const summary of this.discovery.store.list()) {
      if (!TERMINAL.has(summary.state)) {
        this.activeSeen.add(summary.id);
        continue;
      }
      if (!this.activeSeen.has(summary.id) || this.queuedSessions.has(summary.id)) continue;
      this.queuedSessions.add(summary.id);
      const session = this.discovery.store.get(summary.id);
      for (const event of this.visibleEvents(session)) {
        const record = await this.record(session.id, event.id);
        if (!record || (record.stage === "failed" && record.attempts < 2)) this.enqueue(event.id, PRIORITY.automatic);
      }
    }
  }

  private visibleEvents(session: StoredSession) {
    return session.events.filter((event) => {
      if (event.media.mimeType !== "video/mp4") return false;
      const feedback = session.candidates.find((candidate) => candidate.id === event.candidateId)?.humanFeedback;
      return !(feedback && !feedback.correct && feedback.verdictTag === "should_reject");
    });
  }

  private locate(eventId: string) {
    if (!/^[a-zA-Z0-9_-]{1,160}$/.test(eventId)) return null;
    for (const summary of this.discovery.store.list()) {
      if (!summary.eventCount) continue;
      const session = this.discovery.store.get(summary.id);
      const event = session.events.find((item) => item.id === eventId);
      if (event) return { session, event };
    }
    return null;
  }

  private dir(sessionId: string) {
    return path.join(this.discovery.store.sessionDir(sessionId), "studio");
  }

  private recordFile(sessionId: string, eventId: string) {
    return path.join(this.dir(sessionId), `${eventId}.json`);
  }

  private posterFile(sessionId: string, eventId: string) {
    return path.join(this.dir(sessionId), `${eventId}-poster.jpg`);
  }

  private async record(sessionId: string, eventId: string): Promise<StudioRecord | null> {
    const cached = this.records.get(eventId);
    if (cached) return cached;
    try {
      const value = JSON.parse(await fs.readFile(this.recordFile(sessionId, eventId), "utf8")) as StudioRecord;
      // A build interrupted by a restart is retried rather than shown as stuck.
      const stuck = !["ready", "failed"].includes(value.stage) && !this.running.has(eventId);
      const record = stuck ? { ...value, stage: "failed" as const, error: { code: "INTERRUPTED", message: "The studio build was interrupted." } } : value;
      this.records.set(eventId, record);
      return record;
    } catch {
      return null;
    }
  }

  private async save(record: StudioRecord) {
    this.records.set(record.eventId, record);
    const file = this.recordFile(record.sessionId, record.eventId);
    await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
    const temp = `${file}.${randomUUID()}.tmp`;
    await fs.writeFile(temp, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    await fs.rename(temp, file);
  }

  enqueue(eventId: string, priority: number, force = false) {
    if (this.running.has(eventId)) return;
    const existing = this.queue.find((item) => item.eventId === eventId);
    if (existing) {
      existing.priority = Math.max(existing.priority, priority);
      existing.force ||= force;
      existing.wantedAt = Date.now();
    } else this.queue.push({ eventId, priority, force, wantedAt: Date.now() });
    this.pump();
  }

  private pump() {
    while (this.running.size < CONCURRENCY && this.queue.length) {
      this.queue.sort((a, b) => b.priority - a.priority || b.wantedAt - a.wantedAt);
      const item = this.queue.shift()!;
      const job = this.build(item.eventId, item.force)
        .catch((error) => console.warn("Studio build failed", item.eventId, error instanceof Error ? error.message : error))
        .finally(() => {
          this.running.delete(item.eventId);
          this.pump();
        });
      this.running.set(item.eventId, job);
    }
  }

  private async fingerprint(session: StoredSession) {
    if (this.fingerprints.has(session.id)) return this.fingerprints.get(session.id)!;
    let value: string | null = null;
    if (session.sourceKind === "video" && session.sourceRelativePath) {
      try {
        const file = path.resolve(this.discovery.store.sessionDir(session.id), session.sourceRelativePath);
        const handle = await fs.open(file, "r");
        try {
          const { size } = await handle.stat();
          const head = Buffer.alloc(Math.min(size, 256 * 1024));
          const tail = Buffer.alloc(Math.min(size, 256 * 1024));
          await handle.read(head, 0, head.length, 0);
          await handle.read(tail, 0, tail.length, Math.max(0, size - tail.length));
          value = createHash("sha256").update(String(size)).update(head).update(tail).digest("hex");
        } finally {
          await handle.close();
        }
      } catch {
        value = null;
      }
    }
    this.fingerprints.set(session.id, value);
    return value;
  }

  /** A finished studio for the same source video and clip interval, from another run. */
  private async reusable(session: StoredSession, event: DiscoveryEvent) {
    const fingerprint = await this.fingerprint(session);
    const interval = event.media.sourceInterval;
    if (!fingerprint || !interval) return null;
    for (const summary of this.discovery.store.list()) {
      if (summary.id === session.id || !summary.eventCount) continue;
      const other = this.discovery.store.get(summary.id);
      if ((await this.fingerprint(other)) !== fingerprint) continue;
      for (const candidate of [...other.events, ...(other.retiredEvents ?? [])]) {
        const range = candidate.media.sourceInterval;
        if (
          !range ||
          Math.abs(range.startSeconds - interval.startSeconds) > 0.05 ||
          Math.abs(range.endSeconds - interval.endSeconds) > 0.05
        )
          continue;
        const record = await this.record(other.id, candidate.id);
        if (record?.stage === "ready" && record.spec) return record;
      }
    }
    return null;
  }

  private clip(event: DiscoveryEvent): StudioClip {
    const media = event.media;
    const duration = media.durationSeconds ?? 0;
    const start = media.sourceInterval?.startSeconds ?? 0;
    const interval = event.review.eventSourceInterval;
    const eventFrom = interval ? Math.min(duration, Math.max(0, interval.startSeconds - start)) : 0;
    const eventTo = interval ? Math.min(duration, Math.max(eventFrom, interval.endSeconds - start)) : duration;
    return { url: media.url, durationSeconds: duration, width: media.width, height: media.height, eventFrom, eventTo };
  }

  private facts(session: StoredSession, event: DiscoveryEvent): StudioFacts {
    const opportunity = event.review.opportunity;
    const concept =
      session.candidates
        .find((candidate) => candidate.id === event.candidateId)
        ?.opportunities?.find((item) => item.eventId === event.id)?.concept ?? null;
    return {
      subject: opportunity.subject,
      kind: opportunity.kind,
      observation: opportunity.observation,
      before: opportunity.before?.text ?? null,
      after: opportunity.after?.text ?? null,
      connection: opportunity.connection,
      concept,
      objectives: DISCOVERY_COURSE.objectives
        .filter((objective) => (opportunity.objectiveIds as string[]).includes(objective.id))
        .map((objective) => ({ id: objective.id, description: objective.description })),
      limitations: opportunity.limitations,
      reviewerReason: event.review.reason,
      sourceKind: session.sourceKind,
    };
  }

  private async build(eventId: string, force: boolean) {
    const located = this.locate(eventId);
    if (!located) return;
    const { session, event } = located;
    const existing = await this.record(session.id, eventId);
    if (existing?.stage === "ready" && !force) return;
    if (!force) {
      const reuse = await this.reusable(session, event);
      if (reuse?.spec) {
        await this.save({
          eventId,
          sessionId: session.id,
          stage: "ready",
          updatedAt: new Date().toISOString(),
          startedAt: null,
          attempts: existing?.attempts ?? 0,
          error: null,
          reusedFrom: reuse.eventId,
          spec: { ...reuse.spec, eventId, clip: { ...reuse.spec.clip, url: event.media.url } },
        });
        return;
      }
    }
    const startedAt = new Date().toISOString();
    let record: StudioRecord = {
      eventId,
      sessionId: session.id,
      stage: "annotating",
      updatedAt: startedAt,
      startedAt,
      attempts: (existing?.attempts ?? 0) + 1,
      error: null,
      spec: null,
    };
    await this.save(record);
    try {
      const ffmpeg = this.discovery.config.ffmpegPath;
      if (!ffmpeg)
        throw new DiscoveryError("MEDIA_DEPENDENCY_UNAVAILABLE", "FFmpeg is required to build event studios.", 503);
      const clip = this.clip(event);
      if (!(clip.durationSeconds > 0))
        throw new DiscoveryError("STUDIO_NO_CLIP", "This event has no video clip to annotate.", 422);
      const { path: clipPath } = this.discovery.findAsset(event.media.assetId);
      const facts = this.facts(session, event);
      const frames = await extractStudioFrames(ffmpeg, clipPath, studioFrameTimes(clip.durationSeconds, clip.eventFrom, clip.eventTo));
      const annotation = await this.agents.annotate(facts, clip, frames, this.controller.signal);
      record = { ...record, stage: "designing", updatedAt: new Date().toISOString() };
      await this.save(record);
      const lesson = await this.agents.design(
        eventId,
        facts,
        clip,
        frames,
        annotation.value,
        { attemptId: annotation.attemptId, latencyMs: annotation.latencyMs, repaired: annotation.repaired },
        this.controller.signal,
      );
      const spec = lesson.value;
      if (spec.provenance.kind === "agents")
        spec.provenance.designer = {
          modelId: this.modelId,
          invocationId: lesson.attemptId,
          latencyMs: lesson.latencyMs,
          repaired: lesson.repaired,
        };
      record = { ...record, stage: "ready", spec, updatedAt: new Date().toISOString(), error: null };
      await this.save(record);
      // Refresh the poster at the annotator's chosen moment.
      await fs.rm(this.posterFile(session.id, eventId), { force: true });
    } catch (error) {
      const code = error instanceof DiscoveryError ? error.code : "STUDIO_BUILD_FAILED";
      const message =
        error instanceof DiscoveryError
          ? error.message
          : /AccessDenied|Unrecognized|Expired|Credentials|Unauthorized/.test(error instanceof Error ? error.name : "")
            ? "Model access is unavailable or has expired."
            : /Abort|Timeout/.test(error instanceof Error ? error.name : "")
              ? "The model took too long. Try again."
              : "The studio could not be built. Try again.";
      if ((error as any)?.problems) console.warn("Studio output problems", eventId, (error as any).problems);
      record = { ...record, stage: "failed", updatedAt: new Date().toISOString(), error: { code, message } };
      await this.save(record);
    }
  }

  private async slide(session: StoredSession, event: DiscoveryEvent): Promise<DaySlide> {
    const record = await this.record(session.id, event.id);
    const concept =
      session.candidates
        .find((candidate) => candidate.id === event.candidateId)
        ?.opportunities?.find((item) => item.eventId === event.id)?.concept ?? null;
    const running = this.running.has(event.id);
    const queued = this.queue.some((item) => item.eventId === event.id);
    return {
      eventId: event.id,
      sessionId: session.id,
      subject: event.review.opportunity.subject,
      concept,
      objectiveIds: [...event.review.opportunity.objectiveIds],
      kind: event.review.opportunity.kind,
      sourceInterval: event.review.eventSourceInterval,
      clip: {
        url: event.media.url,
        mimeType: event.media.mimeType,
        durationSeconds: event.media.durationSeconds,
        width: event.media.width,
        height: event.media.height,
      },
      posterUrl: `/api/discovery/studio/events/${event.id}/poster`,
      stage: record ? (record.stage === "failed" && (running || queued) ? "queued" : record.stage) : queued ? "queued" : "none",
      title: record?.spec?.headline.title ?? null,
      engine: record?.spec?.lab.engine ?? null,
      error: record?.stage === "failed" ? record.error?.message ?? null : null,
    };
  }

  async day(): Promise<DayResponse> {
    const recordings: DayRecording[] = [];
    const seen = new Set<string>();
    for (const summary of this.discovery.store.list()) {
      if (!summary.eventCount) continue;
      const session = this.discovery.store.get(summary.id);
      const events = this.visibleEvents(session);
      if (!events.length) continue;
      const fingerprint = await this.fingerprint(session);
      if (fingerprint) {
        if (seen.has(fingerprint)) continue;
        seen.add(fingerprint);
      }
      const ordered = [...events].sort(
        (a, b) => (a.review.eventSourceInterval?.startSeconds ?? 0) - (b.review.eventSourceInterval?.startSeconds ?? 0),
      );
      recordings.push({
        sessionId: session.id,
        sourceKind: session.sourceKind,
        createdAt: session.createdAt,
        durationSeconds: session.sourceDurationMs !== null ? session.sourceDurationMs / 1000 : session.observedSourceMs / 1000,
        slides: await Promise.all(ordered.map((event) => this.slide(session, event))),
      });
      if (recordings.length >= MAX_RECORDINGS) break;
    }
    return { recordings, model: this.modelId };
  }

  async event(eventId: string, enqueue = true): Promise<StudioEventResponse> {
    const located = this.locate(eventId);
    if (!located) throw new DiscoveryError("NOT_FOUND", "This event is no longer available.", 404);
    const { session, event } = located;
    if (event.media.mimeType !== "video/mp4")
      throw new DiscoveryError("STUDIO_NO_CLIP", "Studios are built for video events.", 422);
    let record = await this.record(session.id, eventId);
    if (enqueue && (!record || (record.stage === "failed" && record.error?.code === "INTERRUPTED"))) this.enqueue(eventId, PRIORITY.viewed);
    if (!record || (record.stage === "failed" && this.queue.some((item) => item.eventId === eventId)))
      record = {
        eventId,
        sessionId: session.id,
        stage: this.running.has(eventId) || this.queue.some((item) => item.eventId === eventId) ? "queued" : "failed",
        updatedAt: new Date().toISOString(),
        startedAt: null,
        attempts: record?.attempts ?? 0,
        error: null,
        spec: null,
      };
    return { slide: await this.slide(session, event), record };
  }

  async generate(eventId: string, force: boolean) {
    const located = this.locate(eventId);
    if (!located) throw new DiscoveryError("NOT_FOUND", "This event is no longer available.", 404);
    if (this.running.has(eventId))
      throw new DiscoveryError("STUDIO_BUSY", "This studio is already being built.", 409, true);
    if (force) this.records.delete(eventId);
    this.enqueue(eventId, PRIORITY.requested, force);
    return this.event(eventId, false);
  }

  async poster(eventId: string) {
    const located = this.locate(eventId);
    if (!located) throw new DiscoveryError("NOT_FOUND", "This event is no longer available.", 404);
    const { session, event } = located;
    const file = this.posterFile(session.id, eventId);
    if (fsSync.existsSync(file)) return file;
    const ffmpeg = this.discovery.config.ffmpegPath;
    if (!ffmpeg) throw new DiscoveryError("MEDIA_DEPENDENCY_UNAVAILABLE", "FFmpeg is required for posters.", 503);
    const record = await this.record(session.id, eventId);
    const clip = this.clip(event);
    const focus = record?.spec?.annotations.focusT ?? (clip.eventFrom + clip.eventTo) / 2;
    const { path: clipPath } = this.discovery.findAsset(event.media.assetId);
    await writePoster(ffmpeg, clipPath, Math.min(Math.max(0, clip.durationSeconds - 0.05), focus), file);
    return file;
  }
}
