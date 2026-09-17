import { DISCOVERY_COURSE } from "../../shared/discoveryCourse";
import {
  humanTruth,
  isHoldoutVideo,
  isRepeatLabel,
  type FeedbackRecord,
  type LearningReport,
  type Lesson,
  type ProposerOutcome,
} from "../../shared/learning";

// Everything the lesson drafter reads: the rules the models already follow,
// every lesson and how it fared, and the labeled cases — the most informative
// ones with a contact sheet of the frames the models saw.

export const MAX_HUMAN_CASES = 60;
/** Bedrock Converse accepts at most 20 images in one request. */
export const MAX_IMAGED_CASES = 20;
export const MAX_JUDGE_ONLY_CASES = 60;
const ANALYSIS_CHARS = 1_500;
const CONTEXT_CHARS = 1_500;

function clip(value: string | null | undefined, max: number) {
  if (!value) return null;
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

/** A note or a disagreement teaches the most; newest first within each group. */
export function selectDraftCases(
  records: FeedbackRecord[],
  outcomes: ProposerOutcome[],
) {
  const eligible = records.filter((record) => !record.holdout);
  const weight = (record: FeedbackRecord) =>
    (record.feedback.note ? 2 : 0) + (record.feedback.correct ? 0 : 1);
  const human = [...eligible]
    .sort(
      (a, b) =>
        weight(b) - weight(a) ||
        b.feedback.updatedAt.localeCompare(a.feedback.updatedAt),
    )
    .slice(0, MAX_HUMAN_CASES);
  const imaged = human
    .filter((record) => record.framesKept > 0)
    .slice(0, MAX_IMAGED_CASES);
  const labeled = new Set(eligible.map((record) => record.candidateId));
  const judgeOnly = outcomes
    .filter(
      (outcome) =>
        outcome.reviewVerdict &&
        outcome.proposals.length &&
        !isHoldoutVideo(outcome.sessionId) &&
        !labeled.has(outcome.candidateId),
    )
    .slice(-MAX_JUDGE_ONLY_CASES);
  return { human, imaged, judgeOnly };
}

export interface DraftContentInput {
  lessons: Lesson[];
  report: LearningReport;
  human: FeedbackRecord[];
  imaged: FeedbackRecord[];
  /** Contact sheet JPEG per candidate ID; a case without one goes as text. */
  sheets: Map<string, Buffer>;
  judgeOnly: ProposerOutcome[];
  basePrompts: { proposer: string; reviewer: string };
}

export function buildDraftContent(input: DraftContentInput) {
  // Videos are pseudonymized so drafted lessons cannot name a session.
  const videos = new Map<string, string>();
  const video = (sessionId: string) => {
    if (!videos.has(sessionId)) videos.set(sessionId, `video_${videos.size + 1}`);
    return videos.get(sessionId)!;
  };
  const cases = new Map<string, { sessionId: string; human: boolean }>();

  const humanCase = (record: FeedbackRecord, detailed: boolean) => {
    cases.set(record.candidateId, { sessionId: record.sessionId, human: true });
    return {
      id: record.candidateId,
      video: video(record.sessionId),
      card: record.cardKind,
      novaProposals: record.proposals,
      judge: {
        verdict: record.reviewVerdict,
        reason: record.reviewReason,
        opportunities: (record.judge?.opportunities ?? []).map((item) => ({
          concept: item.concept,
          subject: item.subject,
          observation: item.observation,
          connection: item.connection,
          objectiveIds: item.objectiveIds,
          published: Boolean(item.eventId),
          repeats: item.coveredBy
            ? `${item.coveredBy.subject}${item.coveredBy.concept ? ` (concept: ${item.coveredBy.concept})` : ""}`
            : null,
          ...(item.replaced
            ? { replacedAsBetterCard: item.replaced.subject }
            : {}),
        })),
        ...(detailed
          ? { analysis: clip(record.judge?.analysis, ANALYSIS_CHARS) }
          : {}),
      },
      human: {
        verdict: record.feedback.correct ? "correct" : record.feedback.verdictTag,
        issueTags: record.feedback.issueTags,
        note: record.feedback.note || null,
        contentTeachable: humanTruth(record.cardKind, record.feedback),
        repeatLabel: isRepeatLabel(record),
      },
      ...(detailed || isRepeatLabel(record)
        ? { videoSoFar: clip(record.videoContext, CONTEXT_CHARS) }
        : {}),
    };
  };

  const [latest] = input.report.groups.slice(-1);
  const reference = {
    courseObjectives: DISCOVERY_COURSE.objectives,
    baseRules: input.basePrompts,
    lessons: input.lessons.map((lesson) => ({
      id: lesson.id,
      model: lesson.model,
      status: lesson.status,
      text: lesson.text,
      supportingVideos: lesson.supportingVideos,
      humanContradictions: lesson.humanContradictions,
      heldOutCheck: lesson.check
        ? {
            cases: lesson.check.cases,
            agreementWithout: lesson.check.baselineAgreement,
            agreementWith: lesson.check.withLessonAgreement,
          }
        : null,
      replaces: lesson.replaces ?? [],
      retireSuggestion: lesson.retireSuggestion?.reason ?? null,
    })),
    metrics: { latestLessonVersions: latest ?? null, totals: input.report.totals },
  };

  const content: Array<Record<string, unknown>> = [
    { text: `REFERENCE (JSON)\n${JSON.stringify(reference)}` },
  ];
  const withSheet = input.imaged.filter((record) =>
    input.sheets.has(record.candidateId),
  );
  if (withSheet.length)
    content.push({
      text: "HUMAN CASES WITH CONTACT SHEETS: each case's JSON is followed by one image of the frames the models saw. Tiles run left to right, top to bottom in time order; each label gives the tile number and source time; outlined tiles were cited as evidence.",
    });
  for (const record of withSheet) {
    content.push(
      { text: `CASE ${JSON.stringify(humanCase(record, true))}` },
      {
        image: {
          format: "jpeg",
          source: { bytes: input.sheets.get(record.candidateId)! },
        },
      },
    );
  }
  const imagedIds = new Set(withSheet.map((record) => record.candidateId));
  const textOnly = input.human
    .filter((record) => !imagedIds.has(record.candidateId))
    .map((record) => humanCase(record, false));
  if (textOnly.length)
    content.push({
      text: `HUMAN CASES WITHOUT IMAGES (JSON)\n${JSON.stringify(textOnly)}`,
    });
  const judgeOnly = input.judgeOnly.map((outcome) => {
    cases.set(outcome.candidateId, { sessionId: outcome.sessionId, human: false });
    return {
      id: outcome.candidateId,
      video: video(outcome.sessionId),
      novaProposals: outcome.proposals,
      judgeVerdict: outcome.reviewVerdict,
      judgeReason: outcome.reviewReason,
      alreadyCovered: outcome.alreadyCovered ?? false,
    };
  });
  if (judgeOnly.length)
    content.push({
      text: `JUDGE-ONLY OUTCOMES, no human label; use for Nova lessons only (JSON)\n${JSON.stringify(judgeOnly)}`,
    });
  return { content, cases, imageCount: withSheet.length };
}
