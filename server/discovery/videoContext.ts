import type { CoverageRef } from "../../shared/discovery";
import {
  candidateCardKind,
  issueTagLabels,
  verdictLabel,
  type CardKind,
  type HumanFeedback,
} from "../../shared/learning";
import type { StoredSession } from "./store";

// What the judge knows about earlier windows of the same video: the concepts
// already published as events (one card per physics concept per video) and
// recent decisions with the human's labels. Pure, so it is built fresh per review.

const MAX_DECISIONS = 10;
const MAX_FIELD = 300;

export interface CoveredEntry {
  ref: string;
  coverage: CoverageRef;
  endSeconds: number | null;
  kind: "observed_action" | "scene_context" | null;
  observation: string | null;
  limitations: string[];
  objectiveIds: string[];
  /** A human already labeled this card, so a later card cannot replace it. */
  labeled: boolean;
  human: string | null;
}

export interface DecisionEntry {
  candidateId: string;
  startSeconds: number | null;
  endSeconds: number | null;
  summary: string;
  human: string | null;
  labeled: boolean;
}

export interface VideoContext {
  covered: CoveredEntry[];
  decisions: DecisionEntry[];
}

function clip(value: string, max = MAX_FIELD) {
  const text = value.replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function humanNote(feedback: HumanFeedback | null, cardKind: CardKind) {
  if (!feedback) return null;
  if (feedback.correct) return "human: confirmed";
  const verdict = feedback.verdictTag
    ? verdictLabel(cardKind, feedback.verdictTag)
    : "not correct";
  const tags = feedback.issueTags.length
    ? ` [${feedback.issueTags.map((tag) => issueTagLabels[tag]).join("; ")}]`
    : "";
  const note = feedback.note ? `: "${clip(feedback.note)}"` : "";
  return `human: not correct, ${verdict}${tags}${note}`;
}

const rejectedByHuman = (feedback: HumanFeedback | null) =>
  Boolean(
    feedback && !feedback.correct && feedback.verdictTag === "should_reject",
  );
const approvedByHuman = (feedback: HumanFeedback | null) =>
  Boolean(
    feedback && !feedback.correct && feedback.verdictTag === "should_approve",
  );

export function buildVideoContext(
  session: Pick<StoredSession, "events" | "candidates">,
  excludeCandidateId?: string,
): VideoContext {
  const candidates = new Map(
    session.candidates.map((candidate) => [candidate.id, candidate]),
  );
  const covered: Array<Omit<CoveredEntry, "ref">> = [];
  const decisions: DecisionEntry[] = [];
  const decided = new Set<string>();

  for (const event of session.events) {
    if (event.candidateId === excludeCandidateId) continue;
    const candidate = candidates.get(event.candidateId);
    const feedback = candidate?.humanFeedback ?? null;
    const interval = event.review.eventSourceInterval;
    const opportunity = event.review.opportunity;
    if (rejectedByHuman(feedback)) {
      // A repeat is covered by its original card; anything else was not real.
      if (
        !feedback!.issueTags.includes("already_covered") &&
        !decided.has(event.candidateId)
      ) {
        decided.add(event.candidateId);
        decisions.push({
          candidateId: event.candidateId,
          startSeconds: interval?.startSeconds ?? null,
          endSeconds: interval?.endSeconds ?? null,
          summary: `approved "${clip(opportunity.subject)}": ${clip(event.review.reason)}`,
          human: humanNote(feedback, "approved"),
          labeled: true,
        });
      }
      continue;
    }
    covered.push({
      coverage: {
        candidateId: event.candidateId,
        eventId: event.id,
        concept:
          candidate?.opportunities?.find((item) => item.eventId === event.id)
            ?.concept ?? null,
        subject: opportunity.subject,
        startSeconds: interval?.startSeconds ?? null,
      },
      endSeconds: interval?.endSeconds ?? null,
      kind: opportunity.kind ?? null,
      observation: opportunity.observation,
      limitations: [...(opportunity.limitations ?? [])],
      objectiveIds: [...opportunity.objectiveIds],
      labeled: Boolean(feedback),
      human: humanNote(feedback, "approved"),
    });
  }

  for (const candidate of session.candidates) {
    if (candidate.id === excludeCandidateId) continue;
    const kind = candidateCardKind(candidate);
    if (!kind) continue;
    const feedback = candidate.humanFeedback ?? null;
    const nova = candidate.novaProposals?.[0];
    const proposed = nova ? ` (Nova proposed "${clip(nova.subject)}")` : "";
    const reason = clip(candidate.reviewReason ?? "no reason recorded");
    // Human corrections stay decisions rather than covered concepts, so a
    // concept the human wanted as a card is published the next time it is found.
    let summary: string | null = null;
    if (kind === "nova_empty") {
      if (approvedByHuman(feedback)) summary = "Nova proposed nothing";
    } else if (kind === "not_teachable" || kind === "insufficient_evidence") {
      summary =
        candidate.errorCode === "CAPTURE_GAP"
          ? `a capture gap blocked publication${proposed}; the judge had found: ${reason}`
          : `${kind === "not_teachable" ? "not teachable" : "insufficient evidence"}${proposed}: ${reason}`;
    } else if (kind === "already_covered" && feedback && !feedback.correct) {
      const repeated = candidate.opportunities?.find((item) => item.coveredBy);
      summary = `judged a repeat${repeated?.coveredBy ? ` of "${clip(repeated.coveredBy.subject)}"` : ""}${repeated?.concept ? ` (concept: ${clip(repeated.concept)})` : ""}: ${reason}`;
    }
    if (!summary) continue;
    decisions.push({
      candidateId: candidate.id,
      startSeconds: candidate.sourceInterval?.startSeconds ?? null,
      endSeconds: candidate.sourceInterval?.endSeconds ?? null,
      summary,
      human: humanNote(feedback, kind),
      labeled: Boolean(feedback),
    });
  }

  const time = (value: number | null) => value ?? 0;
  return {
    covered: covered
      .sort(
        (a, b) => time(a.coverage.startSeconds) - time(b.coverage.startSeconds),
      )
      .map((entry, index) => ({ ...entry, ref: `C${index + 1}` })),
    decisions: decisions
      .sort(
        (a, b) =>
          Number(b.labeled) - Number(a.labeled) ||
          time(b.startSeconds) - time(a.startSeconds),
      )
      .slice(0, MAX_DECISIONS)
      .sort((a, b) => time(a.startSeconds) - time(b.startSeconds)),
  };
}

function span(start: number | null, end: number | null) {
  if (start === null) return "still image";
  if (end === null || end === start) return `${start.toFixed(1)} s`;
  return `${start.toFixed(1)}–${end.toFixed(1)} s`;
}

export function renderVideoContext(context: VideoContext) {
  if (!context.covered.length && !context.decisions.length) return null;
  const lines = [
    "THIS VIDEO SO FAR: earlier windows of the same video. Text only; it does not describe the images below.",
    "COVERED CONCEPTS (one card per physics concept per video):",
  ];
  if (!context.covered.length) lines.push("(none yet)");
  for (const entry of context.covered)
    lines.push(
      [
        `${entry.ref} · ${span(entry.coverage.startSeconds, entry.endSeconds)} · concept: ${entry.coverage.concept ? clip(entry.coverage.concept) : "not named"} · subject: ${clip(entry.coverage.subject)}`,
        entry.kind ? entry.kind.replace("_", " ") : null,
        entry.observation ? `observed: ${clip(entry.observation)}` : null,
        entry.limitations.length
          ? `limits: ${clip(entry.limitations.join(" "))}`
          : null,
        entry.objectiveIds.length
          ? `objectives: ${entry.objectiveIds.join(", ")}`
          : null,
        entry.human,
      ]
        .filter(Boolean)
        .join(" · "),
    );
  if (context.decisions.length) {
    lines.push(
      "EARLIER DECISIONS (context for consistency, not evidence about the images below):",
    );
    for (const decision of context.decisions)
      lines.push(
        `- ${span(decision.startSeconds, decision.endSeconds)} · ${decision.summary}${decision.human ? ` · ${decision.human}` : ""}`,
      );
  }
  return lines.join("\n");
}
