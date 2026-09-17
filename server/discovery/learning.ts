import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DiscoveryFrame } from "../../shared/discovery";
import {
  MAX_ACTIVE_LESSONS,
  draftStatus,
  lessonVersion,
  type FeedbackRecord,
  type Lesson,
  type LessonAction,
  type LessonCheck,
  type LessonModel,
  type ProposerOutcome,
} from "../../shared/learning";
import { DiscoveryError } from "./errors";

const safeId = /^[a-zA-Z0-9_-]{1,80}$/;

async function atomicJson(file: string, value: unknown) {
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temp, file);
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export interface DraftedLesson {
  model: LessonModel;
  text: string;
  supportingIds: string[];
  contradictingIds: string[];
  replacesLessonIds?: string[];
}

export interface RetireDraft {
  lessonId: string;
  reason: string;
  supportingIds: string[];
}

const retirable = new Set(["active", "pending", "needs_evidence"]);

/**
 * Durable learning data. Lives beside, not inside, session folders so session
 * retention never deletes labels, outcomes, or lessons.
 */
export class LearningStore {
  readonly root: string;
  private lessons: Lesson[] = [];
  private records = new Map<string, FeedbackRecord>();
  private outcomes: ProposerOutcome[] = [];
  private chain: Promise<unknown> = Promise.resolve();

  constructor(runtimeRoot: string) {
    this.root = path.join(runtimeRoot, "learning");
  }

  async initialize() {
    await fs.mkdir(path.join(this.root, "feedback"), {
      recursive: true,
      mode: 0o700,
    });
    try {
      this.lessons = JSON.parse(
        await fs.readFile(path.join(this.root, "lessons.json"), "utf8"),
      ).lessons;
    } catch {
      this.lessons = [];
    }
    for (const entry of await fs.readdir(path.join(this.root, "feedback"), {
      withFileTypes: true,
    })) {
      if (!entry.isDirectory() || !safeId.test(entry.name)) continue;
      try {
        const record = JSON.parse(
          await fs.readFile(this.recordFile(entry.name), "utf8"),
        ) as FeedbackRecord;
        this.records.set(record.candidateId, record);
      } catch {
        // A half-written label is skipped rather than blocking startup.
      }
    }
    try {
      this.outcomes = (await fs.readFile(this.outcomesFile(), "utf8"))
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    } catch {
      this.outcomes = [];
    }
  }

  private serial<T>(work: () => Promise<T>) {
    const next = this.chain.then(work);
    this.chain = next.catch(() => undefined);
    return next;
  }
  private outcomesFile() {
    return path.join(this.root, "outcomes.jsonl");
  }
  private recordDir(candidateId: string) {
    if (!safeId.test(candidateId))
      throw new DiscoveryError(
        "INVALID_CANDIDATE",
        "Invalid candidate ID.",
        400,
      );
    return path.join(this.root, "feedback", candidateId);
  }
  private recordFile(candidateId: string) {
    return path.join(this.recordDir(candidateId), "record.json");
  }
  feedbackFramesDir(candidateId: string) {
    return path.join(this.recordDir(candidateId), "frames");
  }

  listLessons() {
    return this.lessons.map((lesson) => ({ ...lesson }));
  }
  version(model: LessonModel) {
    return lessonVersion(this.lessons, model);
  }
  feedbackRecords() {
    return [...this.records.values()];
  }
  feedback(candidateId: string) {
    return this.records.get(candidateId) || null;
  }
  outcomeList() {
    return [...this.outcomes];
  }

  appendOutcome(outcome: ProposerOutcome) {
    return this.serial(async () => {
      this.outcomes.push(outcome);
      await fs.appendFile(this.outcomesFile(), `${JSON.stringify(outcome)}\n`, {
        mode: 0o600,
      });
    });
  }

  /** Saves or replaces a label; card frames are copied once so labels outlive session retention. */
  saveFeedback(
    record: FeedbackRecord,
    frames: Array<{ frame: DiscoveryFrame; file: string }>,
  ) {
    return this.serial(async () => {
      const dir = this.recordDir(record.candidateId);
      await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      const target = this.feedbackFramesDir(record.candidateId);
      let framesKept = this.records.get(record.candidateId)?.framesKept || 0;
      if (!framesKept && frames.length) {
        try {
          await fs.mkdir(target, { recursive: true, mode: 0o700 });
          for (const [index, item] of frames.entries()) {
            const name = `${String(index).padStart(2, "0")}.jpg`;
            const destination = path.join(target, name);
            if (path.resolve(item.file) !== path.resolve(destination))
              await fs.copyFile(item.file, destination);
          }
          await atomicJson(
            path.join(target, "frames.json"),
            frames.map((item) => item.frame),
          );
          framesKept = frames.length;
        } catch {
          framesKept = 0;
        }
      }
      const saved = { ...record, framesKept };
      await atomicJson(this.recordFile(record.candidateId), saved);
      this.records.set(record.candidateId, saved);
      return saved;
    });
  }

  private persistLessons() {
    return atomicJson(path.join(this.root, "lessons.json"), {
      lessons: this.lessons,
    });
  }

  /** Replaces one feedback record in place (used by one-time migrations). */
  updateRecord(
    candidateId: string,
    change: (record: FeedbackRecord) => FeedbackRecord | null,
  ) {
    return this.serial(async () => {
      const current = this.records.get(candidateId);
      if (!current) return null;
      const next = change(structuredClone(current));
      if (!next) return null;
      await atomicJson(this.recordFile(candidateId), next);
      this.records.set(candidateId, next);
      return next;
    });
  }

  /**
   * Adds drafted lessons after dedup against every lesson, rejected ones
   * included. Reviewer lessons count only human-labeled support; any human
   * label listed against a lesson holds it back.
   */
  addDraftedLessons(
    drafts: DraftedLesson[],
    cases: Map<string, { sessionId: string; human: boolean }>,
  ) {
    return this.serial(async () => {
      const seen = new Set(
        this.lessons.map(
          (lesson) => `${lesson.model}:${normalizeText(lesson.text)}`,
        ),
      );
      const added: Lesson[] = [];
      for (const draft of drafts) {
        const key = `${draft.model}:${normalizeText(draft.text)}`;
        if (seen.has(key)) continue;
        const supporting = draft.supportingIds.filter((id) => {
          const known = cases.get(id);
          return known && (draft.model === "proposer" || known.human);
        });
        if (!supporting.length) continue;
        const contradicting = draft.contradictingIds.filter((id) =>
          cases.has(id),
        );
        const supportingVideos = new Set(
          supporting.map((id) => cases.get(id)!.sessionId),
        ).size;
        const humanContradictions = contradicting.filter(
          (id) => cases.get(id)!.human,
        ).length;
        const replaces = [...new Set(draft.replacesLessonIds ?? [])].filter(
          (id) =>
            this.lessons.some(
              (lesson) =>
                lesson.id === id &&
                lesson.model === draft.model &&
                lesson.status !== "rejected",
            ),
        );
        const now = new Date().toISOString();
        const lesson: Lesson = {
          id: randomUUID(),
          model: draft.model,
          text: draft.text,
          status: draftStatus(supportingVideos, humanContradictions),
          supportingIds: supporting,
          contradictingIds: contradicting,
          supportingVideos,
          humanContradictions,
          createdAt: now,
          updatedAt: now,
          check: null,
          replaces,
          retireSuggestion: null,
        };
        seen.add(key);
        added.push(lesson);
        this.lessons.push(lesson);
      }
      if (added.length) await this.persistLessons();
      return added;
    });
  }

  /** Stores the drafter's advice to turn lessons off; nothing changes until the human decides. */
  suggestRetirements(
    items: RetireDraft[],
    cases: Map<string, unknown>,
  ) {
    return this.serial(async () => {
      const updated: Lesson[] = [];
      const at = new Date().toISOString();
      for (const item of items) {
        const lesson = this.lessons.find((value) => value.id === item.lessonId);
        if (!lesson || !retirable.has(lesson.status)) continue;
        lesson.retireSuggestion = {
          reason: item.reason,
          supportingIds: item.supportingIds.filter((id) => cases.has(id)),
          at,
        };
        lesson.updatedAt = at;
        if (!updated.includes(lesson)) updated.push(lesson);
      }
      if (updated.length) await this.persistLessons();
      return updated.map((lesson) => ({ ...lesson }));
    });
  }

  updateLesson(id: string, action: LessonAction, text?: string) {
    return this.serial(async () => {
      const lesson = this.lessons.find((item) => item.id === id);
      if (!lesson)
        throw new DiscoveryError("LESSON_NOT_FOUND", "Lesson not found.", 404);
      const now = new Date().toISOString();
      if (action === "accept") {
        const replaced = this.lessons.filter(
          (item) =>
            item.id !== lesson.id &&
            item.model === lesson.model &&
            item.status !== "rejected" &&
            (lesson.replaces ?? []).includes(item.id),
        );
        const active = this.lessons.filter(
          (item) =>
            item.model === lesson.model &&
            item.status === "active" &&
            !replaced.includes(item),
        ).length;
        if (lesson.status !== "active" && active >= MAX_ACTIVE_LESSONS)
          throw new DiscoveryError(
            "LESSON_LIMIT",
            `At most ${MAX_ACTIVE_LESSONS} active lessons per model. Disable one first.`,
            409,
          );
        lesson.status = "active";
        lesson.retireSuggestion = null;
        for (const item of replaced) {
          item.status = "disabled";
          item.retireSuggestion = null;
          item.updatedAt = now;
        }
      } else if (action === "reject") {
        lesson.status = "rejected";
        lesson.retireSuggestion = null;
      } else if (action === "disable") {
        lesson.status = "disabled";
        lesson.retireSuggestion = null;
      } else if (action === "dismiss_suggestion") {
        lesson.retireSuggestion = null;
      } else {
        lesson.text = text!;
        lesson.check = null;
        lesson.retireSuggestion = null;
      }
      lesson.updatedAt = now;
      await this.persistLessons();
      return { ...lesson };
    });
  }

  recordCheck(id: string, check: LessonCheck) {
    return this.serial(async () => {
      const lesson = this.lessons.find((item) => item.id === id);
      if (!lesson)
        throw new DiscoveryError("LESSON_NOT_FOUND", "Lesson not found.", 404);
      lesson.check = check;
      await this.persistLessons();
      return { ...lesson };
    });
  }
}
