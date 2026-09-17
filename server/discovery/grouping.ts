import type { DiscoveryEvent, GroundedOpportunity } from "../../shared/discovery";

export function normalizeSubject(value: string) {
  return value
    .toLocaleLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizedMeanAbsoluteDifference(
  left: Uint8Array,
  right: Uint8Array,
) {
  if (left.length !== right.length || left.length === 0) return Infinity;
  let difference = 0;
  for (let index = 0; index < left.length; index++)
    difference += Math.abs(left[index] - right[index]);
  return difference / (left.length * 255);
}

export function intervalIoU(
  a: { startSeconds: number; endSeconds: number } | null,
  b: { startSeconds: number; endSeconds: number } | null,
) {
  if (!a || !b) return a === b ? 1 : 0;
  const intersection = Math.max(
    0,
    Math.min(a.endSeconds, b.endSeconds) -
      Math.max(a.startSeconds, b.startSeconds),
  );
  const union =
    Math.max(a.endSeconds, b.endSeconds) -
    Math.min(a.startSeconds, b.startSeconds);
  return union === 0 ? (a.startSeconds === b.startSeconds ? 1 : 0) : intersection / union;
}

function shared<T>(a: T[], b: T[]) {
  const right = new Set(b);
  return a.filter((value) => right.has(value));
}

export function eventsOverlap(
  existing: DiscoveryEvent,
  opportunity: GroundedOpportunity,
  interval: { startSeconds: number; endSeconds: number } | null,
) {
  return (
    existing.review.opportunity.kind === opportunity.kind &&
    shared(
      existing.review.opportunity.objectiveIds,
      opportunity.objectiveIds,
    ).length > 0 &&
    normalizeSubject(existing.review.opportunity.subject) ===
      normalizeSubject(opportunity.subject) &&
    intervalIoU(existing.review.eventSourceInterval, interval) >= 0.5 &&
    shared(
      existing.review.opportunity.evidenceFrameIds,
      opportunity.evidenceFrameIds,
    ).length >= (opportunity.kind === "observed_action" ? 2 : 1)
  );
}

export function maximumGapMs(
  frameTimes: number[],
  startMs: number,
  endMs: number,
) {
  const within = frameTimes
    .filter((time) => time >= startMs && time <= endMs)
    .sort((a, b) => a - b);
  if (within.length < 2) return endMs - startMs;
  let maximum = 0;
  for (let index = 1; index < within.length; index++)
    maximum = Math.max(maximum, within[index] - within[index - 1]);
  return maximum;
}
