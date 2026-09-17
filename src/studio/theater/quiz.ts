import type { Question, StudioSpec, Track } from "../../../shared/studio/schema";
import { anchorAt, trackAt, trackPath } from "./tracks";

export type QuizOutcome = "first" | "second" | "missed";

export interface QuizResult {
  outcome: QuizOutcome;
  attempts: number;
}

export interface Attempt {
  choice: number | null;
  /** Screen angle in degrees (0 = right, 90 = up). */
  angle: number | null;
  point: { x: number; y: number } | null;
  path: number | null;
  scrubT: number | null;
  attempts: number;
  /** Last check was wrong and the learner may retry. */
  wrong: boolean;
}

export const emptyAttempt = (): Attempt => ({
  choice: null,
  angle: null,
  point: null,
  path: null,
  scrubT: null,
  attempts: 0,
  wrong: false,
});

export const QUESTION_KIND: Record<Question["type"], { label: string; verb: string }> = {
  choice: { label: "Think it through", verb: "Choose an answer" },
  vector: { label: "Draw the arrow", verb: "Drag on the video to draw the arrow" },
  hotspot: { label: "Point to it", verb: "Tap the spot on the video" },
  scrub: { label: "Find the moment", verb: "Scrub the timeline, then lock it in" },
  path: { label: "Predict the path", verb: "Pick the path it will follow" },
};

export function angleDifference(a: number, b: number) {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return diff;
}

export function hasAnswer(question: Question, attempt: Attempt) {
  switch (question.type) {
    case "choice":
      return attempt.choice !== null;
    case "vector":
      return attempt.angle !== null;
    case "hotspot":
      return attempt.point !== null;
    case "path":
      return attempt.path !== null;
    case "scrub":
      return attempt.scrubT !== null;
  }
}

/** Grades an attempt; returns details used for feedback. */
export function grade(
  spec: StudioSpec,
  question: Question,
  attempt: Attempt,
  paths: CandidatePath[] | null,
) {
  const W = 1000;
  const H = (1000 * spec.clip.height) / spec.clip.width;
  const tracks = new Map(spec.annotations.tracks.map((track) => [track.id, track]));
  switch (question.type) {
    case "choice":
      return {
        correct: attempt.choice !== null && question.options[attempt.choice]?.correct === true,
        detail: attempt.choice !== null ? question.options[attempt.choice]?.feedback ?? "" : "",
      };
    case "vector": {
      const diff = attempt.angle === null ? 180 : angleDifference(attempt.angle, question.answerDeg);
      return {
        correct: diff <= question.toleranceDeg,
        detail: diff <= question.toleranceDeg ? `Within ${Math.round(diff)}° of the model.` : `Off by ${Math.round(diff)}°.`,
      };
    }
    case "hotspot": {
      const target = anchorAt(question.target, tracks, question.t);
      if (!target || !attempt.point) return { correct: false, detail: "" };
      const distance = Math.hypot((attempt.point.x - target.x) * W, (attempt.point.y - target.y) * H) / W;
      return {
        correct: distance <= question.radius,
        detail: distance <= question.radius ? "Right on it." : "Not quite there.",
      };
    }
    case "scrub": {
      const diff = attempt.scrubT === null ? Infinity : Math.abs(attempt.scrubT - question.answerT);
      return {
        correct: diff <= question.toleranceS,
        detail:
          diff <= question.toleranceS
            ? `Within ${diff.toFixed(2)} s.`
            : `${diff.toFixed(2)} s ${attempt.scrubT! < question.answerT ? "too early" : "too late"}.`,
      };
    }
    case "path": {
      const correct = paths?.findIndex((path) => path.correct) ?? -1;
      return { correct: attempt.path !== null && attempt.path === correct, detail: "" };
    }
  }
}

export interface CandidatePath {
  points: Array<{ x: number; y: number }>;
  correct: boolean;
  letter: string;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * Three candidate paths from the object's position at the question time: the
 * real continuation, a straight-line guess and a curve the other way. Built in
 * screen space so bends look right on non-square video.
 */
export function candidatePaths(spec: StudioSpec, question: Question): CandidatePath[] | null {
  if (question.type !== "path") return null;
  const track: Track | undefined = spec.annotations.tracks.find((item) => item.id === question.track);
  const W = 1000;
  const H = (1000 * spec.clip.height) / spec.clip.width;
  const real = trackPath(track, question.t, question.t + question.horizonS, 1 / 40).map((p) => ({ x: p.x * W, y: p.y * H }));
  if (real.length < 3) return null;
  const start = real[0];
  let length = 0;
  for (let i = 1; i < real.length; i++) length += Math.hypot(real[i].x - real[i - 1].x, real[i].y - real[i - 1].y);
  const at = trackAt(track, question.t);
  let dx = at ? at.vx * W : real[1].x - start.x;
  let dy = at ? at.vy * H : real[1].y - start.y;
  let norm = Math.hypot(dx, dy);
  if (norm < 1e-6) {
    dx = real.at(-1)!.x - start.x;
    dy = real.at(-1)!.y - start.y;
    norm = Math.hypot(dx, dy) || 1;
  }
  const ux = dx / norm;
  const uy = dy / norm;
  const nx = -uy;
  const ny = ux;
  const straight = real.map((_, i) => {
    const s = (length * i) / (real.length - 1);
    return { x: start.x + ux * s, y: start.y + uy * s };
  });
  const deviation = real.map((p, i) => (p.x - straight[i].x) * nx + (p.y - straight[i].y) * ny);
  const maxDeviation = Math.max(...deviation.map(Math.abs));
  const bent =
    maxDeviation > length * 0.08
      ? real.map((p, i) => ({ x: p.x - 2 * deviation[i] * nx, y: p.y - 2 * deviation[i] * ny }))
      : straight.map((p, i) => {
          const share = i / (straight.length - 1);
          const bulge = Math.sin(Math.PI * share * 0.9) * length * 0.28;
          return { x: p.x + nx * bulge, y: p.y + ny * bulge };
        });
  const alternatives =
    maxDeviation > length * 0.08
      ? [straight, bent]
      : [
          bent,
          straight.map((p, i) => {
            const share = i / (straight.length - 1);
            const bulge = -Math.sin(Math.PI * share * 0.9) * length * 0.28;
            return { x: p.x + nx * bulge, y: p.y + ny * bulge };
          }),
        ];
  const options = [
    { points: real, correct: true },
    { points: alternatives[0], correct: false },
    { points: alternatives[1], correct: false },
  ];
  const seed = hashString(question.id);
  const order = [0, 1, 2].sort((a, b) => ((seed >> (a * 3)) & 7) - ((seed >> (b * 3)) & 7) || a - b);
  return order.map((index, i) => ({ ...options[index], letter: "ABC"[i] }));
}

export function readResults(key: string): Record<string, QuizResult> {
  try {
    const raw = JSON.parse(localStorage.getItem(key) || "{}");
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

export function writeResults(key: string, value: Record<string, QuizResult>) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quiz progress is a convenience only.
  }
}
