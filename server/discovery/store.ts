import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  CandidateSummary,
  DiscoveryEvent,
  DiscoveryFrame,
  SessionSnapshot,
} from "../../shared/discovery";
import type { ProposalSummary } from "../../shared/learning";
import type { DiscoveryConfig } from "./config";
import { DiscoveryError } from "./errors";

export interface StoredAsset {
  assetId: string;
  relativePath: string;
  mimeType: "image/jpeg" | "video/mp4";
  size: number;
  sha256: string;
}

export interface StoredSnapshot {
  id: string;
  hash: string;
  frameIds: string[];
  startMs: number | null;
  endMs: number | null;
  schedulingReasons: CandidateSummary["schedulingReasons"];
  promptVersion: string;
  thumbnailGrayBase64?: string;
}

export interface StoredCandidate extends CandidateSummary {
  snapshotId: string;
  proposerInvocationId: string | null;
  proposerPromptHash: string | null;
  reviewerInvocationId: string | null;
  reviewerPromptHash: string | null;
  contributingCandidateIds: string[];
  proposerLessonVersion?: string;
  reviewerLessonVersion?: string;
  reviewerModelId?: string;
  /** Compact Nova proposals, so later windows can describe this card without stage files. */
  novaProposals?: Array<
    Pick<ProposalSummary, "kind" | "subject" | "observation" | "objectiveIds">
  >;
}

export interface StoredSession extends SessionSnapshot {
  ownerUserId?: string;
  sourceId: string;
  sourceRelativePath: string | null;
  sourceMimeType: string | null;
  frames: DiscoveryFrame[];
  snapshots: StoredSnapshot[];
  candidates: StoredCandidate[];
  assets: StoredAsset[];
  /** Events taken over by a better card for the same concept; kept so their links still resolve. */
  retiredEvents?: DiscoveryEvent[];
  workCache: Record<
    string,
    { state: "successful" | "failed" | "unknown"; attemptId: string }
  >;
  idempotency: Record<string, { hash: string; response: unknown }>;
  phone: {
    ackSequence: number;
    batchIds: Record<string, string>;
    sequenceHashes: Record<string, string>;
    lastHeartbeatAt: string | null;
    timingMethod: string | null;
  };
}

export interface LedgerEntry {
  attemptId: string;
  sessionId: string | null;
  generation: number | null;
  stage: "proposer" | "reviewer" | "preflight" | "learning" | "legacy" | "studio";
  modelId: string;
  promptHash: string | null;
  snapshotHash: string | null;
  reason: string;
  startedAt: string;
  endedAt?: string;
  result?: string;
  stopReason?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  latencyMs?: number;
  errorCategory?: string | null;
}

const activeStates = new Set(["created", "ingesting", "paused", "draining"]);
const safeId = /^[a-zA-Z0-9_-]+$/;

async function atomicJson(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temp, file);
}

export class DiscoveryStore {
  private sessions = new Map<string, StoredSession>();
  private mutationChains = new Map<string, Promise<unknown>>();
  private ledgerChain: Promise<unknown> = Promise.resolve();
  private lockPath: string;
  private closed = false;

  constructor(private config: DiscoveryConfig) {
    this.lockPath = path.join(config.runtimeRoot, "store.lock");
  }

  async initialize() {
    await fs.mkdir(path.join(this.config.runtimeRoot, "sessions"), {
      recursive: true,
      mode: 0o700,
    });
    await this.acquireLock();
    const folders = await fs.readdir(
      path.join(this.config.runtimeRoot, "sessions"),
      {
        withFileTypes: true,
      },
    );
    for (const folder of folders) {
      if (!folder.isDirectory() || !safeId.test(folder.name)) continue;
      const file = this.sessionFile(folder.name);
      try {
        const value = JSON.parse(
          await fs.readFile(file, "utf8"),
        ) as StoredSession;
        const expired =
          !activeStates.has(value.state) &&
          Date.now() - Date.parse(value.updatedAt) >
            this.config.limits.retentionMs;
        if (expired) {
          await fs.rm(this.sessionDir(folder.name), {
            recursive: true,
            force: false,
          });
          continue;
        }
        if (activeStates.has(value.state)) {
          value.state = "interrupted";
          value.updatedAt = new Date().toISOString();
          value.revision++;
          value.counters.reviewerReservations = 0;
          for (const cache of Object.values(value.workCache))
            if (cache.state !== "successful") cache.state = "unknown";
          await atomicJson(file, value);
        }
        this.sessions.set(value.id, value);
      } catch {
        // A malformed session is isolated; it cannot become a source path.
      }
    }
  }

  private async acquireLock() {
    try {
      await fs.writeFile(
        this.lockPath,
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString(),
        }),
        { flag: "wx", mode: 0o600 },
      );
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const prior = JSON.parse(await fs.readFile(this.lockPath, "utf8"));
        if (Number.isInteger(prior.pid)) process.kill(prior.pid, 0);
        throw new DiscoveryError(
          "STORE_IN_USE",
          "Another Discovery process owns this store.",
          503,
        );
      } catch (probe: any) {
        if (probe instanceof DiscoveryError) throw probe;
        if (probe?.code !== "ESRCH")
          throw new DiscoveryError(
            "STORE_IN_USE",
            "The Discovery store lock cannot be verified.",
            503,
          );
        await fs.unlink(this.lockPath);
        await fs.writeFile(
          this.lockPath,
          JSON.stringify({
            pid: process.pid,
            createdAt: new Date().toISOString(),
          }),
          { flag: "wx", mode: 0o600 },
        );
      }
    }
  }

  async close() {
    if (this.closed) return;
    this.closed = true;
    try {
      const lock = JSON.parse(await fs.readFile(this.lockPath, "utf8"));
      if (lock.pid === process.pid) await fs.unlink(this.lockPath);
    } catch {
      // Best effort during process shutdown.
    }
  }

  sessionDir(id: string) {
    if (!safeId.test(id))
      throw new DiscoveryError("INVALID_ID", "Invalid session identifier.");
    return path.join(this.config.runtimeRoot, "sessions", id);
  }

  private sessionFile(id: string) {
    return path.join(this.sessionDir(id), "session.json");
  }

  async create(
    sourceKind: StoredSession["sourceKind"],
    mode: StoredSession["mode"],
    ownerUserId?: string,
  ) {
    const active = [...this.sessions.values()].find(
      (session) =>
        ["created", "ingesting", "paused", "draining"].includes(session.state) &&
        session.ownerUserId === ownerUserId,
    );
    if (active)
      throw new DiscoveryError(
        "ACTIVE_SESSION_LIMIT",
        "Finish or cancel the active ingest session first.",
        429,
        true,
      );
    const id = randomUUID();
    const now = new Date().toISOString();
    const session: StoredSession = {
      id,
      generation: 1,
      revision: 1,
      ownerUserId,
      sourceKind,
      mode,
      state: "created",
      createdAt: now,
      updatedAt: now,
      sourceId: randomUUID(),
      sourceRelativePath: null,
      sourceMimeType: null,
      sourceDurationMs: null,
      observedSourceMs: 0,
      connection: sourceKind === "phone" ? "waiting" : "not_applicable",
      counters: {
        proposerAttempts: 0,
        reviewerAttempts: 0,
        reviewerReservations: 0,
        skippedWindows: 0,
        replacedWindows: 0,
        droppedFrameBatches: 0,
        captureGaps: 0,
      },
      events: [],
      candidates: [],
      errors: [],
      frames: [],
      snapshots: [],
      assets: [],
      workCache: {},
      idempotency: {},
      phone: {
        ackSequence: -1,
        batchIds: {},
        sequenceHashes: {},
        lastHeartbeatAt: null,
        timingMethod: null,
      },
    };
    const dir = this.sessionDir(id);
    await Promise.all(
      ["source", "frames", "snapshots", "candidates", "events", "assets"].map(
        (part) =>
          fs.mkdir(path.join(dir, part), { recursive: true, mode: 0o700 }),
      ),
    );
    this.sessions.set(id, session);
    await atomicJson(this.sessionFile(id), session);
    return structuredClone(session);
  }

  get(id: string) {
    if (!safeId.test(id))
      throw new DiscoveryError("INVALID_ID", "Invalid session identifier.");
    const session = this.sessions.get(id);
    if (!session)
      throw new DiscoveryError(
        "NOT_FOUND",
        "Discovery session not found.",
        404,
      );
    return structuredClone(session);
  }

  list() {
    return [...this.sessions.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((session) => ({
        id: session.id,
        sourceKind: session.sourceKind,
        mode: session.mode,
        state: session.state,
        createdAt: session.createdAt,
        updatedAt: session.updatedAt,
        revision: session.revision,
        eventCount: session.events.length,
      }));
  }

  async mutate<T>(id: string, fn: (session: StoredSession) => T | Promise<T>) {
    const previous = this.mutationChains.get(id) || Promise.resolve();
    let result!: T;
    const next = previous.then(async () => {
      const session = this.sessions.get(id);
      if (!session)
        throw new DiscoveryError(
          "NOT_FOUND",
          "Discovery session not found.",
          404,
        );
      result = await fn(session);
      session.revision++;
      session.updatedAt = new Date().toISOString();
      await atomicJson(this.sessionFile(id), session);
    });
    this.mutationChains.set(
      id,
      next.catch(() => undefined),
    );
    await next;
    return result;
  }

  async appendLedger(entry: LedgerEntry) {
    const line = `${JSON.stringify(entry)}\n`;
    this.ledgerChain = this.ledgerChain.then(() =>
      fs.appendFile(path.join(this.config.runtimeRoot, "ledger.jsonl"), line, {
        mode: 0o600,
      }),
    );
    await this.ledgerChain;
  }

  async appendDiagnostic(sessionId: string, value: Record<string, unknown>) {
    const file = path.join(this.sessionDir(sessionId), "diagnostics.jsonl");
    this.ledgerChain = this.ledgerChain.then(() =>
      fs.appendFile(file, `${JSON.stringify(value)}\n`, { mode: 0o600 }),
    );
    await this.ledgerChain;
  }

  async delete(id: string) {
    const dir = this.sessionDir(id);
    if (!this.sessions.has(id))
      throw new DiscoveryError(
        "NOT_FOUND",
        "Discovery session not found.",
        404,
      );
    this.sessions.delete(id);
    await fs.rm(dir, { recursive: true, force: false });
  }

  async usedBytes() {
    let total = 0;
    const walk = async (folder: string): Promise<void> => {
      for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
        if (entry.name === "store.lock") continue;
        const item = path.join(folder, entry.name);
        if (entry.isDirectory()) await walk(item);
        else total += (await fs.stat(item)).size;
      }
    };
    if (fsSync.existsSync(this.config.runtimeRoot))
      await walk(this.config.runtimeRoot);
    return total;
  }

  async assertStorageCapacity(incomingBytes: number) {
    if (
      (await this.usedBytes()) + incomingBytes >
      this.config.limits.storageBytes
    )
      throw new DiscoveryError(
        "STORAGE_LIMIT",
        "Discovery storage is full. Delete an old completed session.",
        507,
      );
  }
}
