import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { LearningStore } from "./learning";

// One-time fixes to stored learning data. Each runs once; its ID is recorded
// in learning/migrations.json so a human's later edits are never overwritten.

const TAG_REPEAT_NOTES = "2026-09-16-tag-repeat-notes";
/**
 * Notes that explain a rejection as a repeat of an earlier card ("have this
 * already", "already has a card like this"), not "the door was already open".
 */
export const REPEAT_NOTE =
  /\bduplicate\b|\bhave this\b|\balready (?:have|has|there|approved|covered)\b/i;

async function appliedMigrations(root: string): Promise<string[]> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(path.join(root, "migrations.json"), "utf8"),
    );
    return Array.isArray(parsed.applied) ? parsed.applied : [];
  } catch {
    return [];
  }
}

async function recordMigration(root: string, id: string) {
  const file = path.join(root, "migrations.json");
  const applied = [...(await appliedMigrations(root)), id];
  const temp = `${file}.${randomUUID()}.tmp`;
  await fs.writeFile(temp, `${JSON.stringify({ applied }, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(temp, file);
}

/**
 * Before repeats had their own tag, "already have this" labels were saved as
 * plain rejections of approved cards, which reads as "not teachable".
 */
export async function tagRepeatNotes(learning: LearningStore) {
  const tagged: string[] = [];
  if ((await appliedMigrations(learning.root)).includes(TAG_REPEAT_NOTES))
    return tagged;
  for (const record of learning.feedbackRecords()) {
    const { feedback } = record;
    if (
      record.cardKind !== "approved" ||
      feedback.correct ||
      feedback.verdictTag !== "should_reject" ||
      feedback.issueTags.includes("already_covered") ||
      !REPEAT_NOTE.test(feedback.note)
    )
      continue;
    await learning.updateRecord(record.candidateId, (value) => ({
      ...value,
      feedback: {
        ...value.feedback,
        issueTags: [...value.feedback.issueTags, "already_covered"],
      },
    }));
    tagged.push(record.candidateId);
  }
  await recordMigration(learning.root, TAG_REPEAT_NOTES);
  return tagged;
}
