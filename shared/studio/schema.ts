import { z } from "zod";
import { ENGINE_IDS } from "./engines/types";

// The event studio contract: what the annotator and lesson designer produce for
// one accepted event. Coordinates are normalized image space of the event clip
// (x right, y down, 0–1). Times are clip seconds. Angles are degrees on screen:
// 0 points right, 90 points up (counter-clockwise positive).

export const STUDIO_VERSION = "studio-1" as const;

const slug = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .regex(/^[a-z0-9][a-z0-9_-]*$/);
const unit = z.number().finite().min(0).max(1);
const seconds = z.number().finite().min(0).max(600);
const text = (min: number, max: number) => z.string().trim().min(min).max(max);
const degrees = z.number().finite().min(-720).max(720);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const quantities = [
  "force",
  "weight",
  "normal",
  "friction",
  "tension",
  "buoyancy",
  "velocity",
  "acceleration",
  "momentum",
  "displacement",
] as const;
export type Quantity = (typeof quantities)[number];

export const AnchorSchema = z.union([
  z.object({ track: slug }).strict(),
  z.object({ x: unit, y: unit }).strict(),
]);
export type Anchor = z.infer<typeof AnchorSchema>;

export const TrackSampleSchema = z
  .object({
    t: seconds,
    x: unit,
    y: unit,
    w: unit,
    h: unit,
    visible: z.boolean(),
  })
  .strict();

export const TrackSchema = z
  .object({
    id: slug,
    label: text(1, 40),
    role: z.enum(["body", "agent", "pivot", "contact", "support", "marker"]),
    samples: z.array(TrackSampleSchema).min(1).max(48),
  })
  .strict();
export type Track = z.infer<typeof TrackSchema>;

const overlayBase = {
  id: slug,
  from: seconds,
  to: seconds,
};

export const DirectionSchema = z.union([
  z.object({ mode: z.literal("angle"), deg: degrees }).strict(),
  z.object({ mode: z.literal("motion") }).strict(),
  z.object({ mode: z.literal("toward"), anchor: AnchorSchema }).strict(),
]);

export const OverlaySchema = z.discriminatedUnion("type", [
  z
    .object({
      ...overlayBase,
      type: z.literal("trail"),
      track: slug,
      style: z.enum(["comet", "strobe"]),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal("halo"),
      track: slug,
      tone: z.enum(["focus", "hot"]),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal("vector"),
      anchor: AnchorSchema,
      quantity: z.enum(quantities),
      direction: DirectionSchema,
      /** Relative arrow length, 0.2–1. */
      magnitude: z.number().finite().min(0.15).max(1),
      /** "speed" shrinks and grows the arrow with the tracked speed. */
      scale: z.enum(["fixed", "speed"]),
      label: text(1, 18),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal("label"),
      anchor: AnchorSchema,
      text: text(1, 48),
      tone: z.enum(["neutral", "hot", "blue"]),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal("pivot"),
      anchor: AnchorSchema,
      label: text(1, 24),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal("arc"),
      anchor: AnchorSchema,
      /** Fraction of the frame width. */
      radius: z.number().finite().min(0.02).max(0.45),
      startDeg: degrees,
      sweepDeg: z.number().finite().min(-340).max(340),
      label: text(1, 18),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal("angle"),
      anchor: AnchorSchema,
      fromDeg: degrees,
      toDeg: degrees,
      label: text(1, 18),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal("dimension"),
      a: AnchorSchema,
      b: AnchorSchema,
      label: text(1, 28),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal("zone"),
      box: z.object({ x: unit, y: unit, w: unit, h: unit }).strict(),
      label: text(1, 28),
    })
    .strict(),
  z
    .object({
      ...overlayBase,
      type: z.literal("ghosts"),
      track: slug,
      times: z.array(seconds).min(2).max(8),
    })
    .strict(),
]);
export type Overlay = z.infer<typeof OverlaySchema>;
export type OverlayType = Overlay["type"];

export const AnnotationsSchema = z
  .object({
    tracks: z.array(TrackSchema).max(4),
    overlays: z.array(OverlaySchema).max(18),
    chapters: z
      .array(
        z
          .object({ t: seconds, title: text(1, 28), caption: text(1, 120) })
          .strict(),
      )
      .min(1)
      .max(6),
    freezes: z
      .array(
        z
          .object({
            t: seconds,
            holdSeconds: z.number().finite().min(0.5).max(3.5),
            caption: text(1, 90),
          })
          .strict(),
      )
      .max(3),
    slowmo: z
      .array(
        z
          .object({
            from: seconds,
            to: seconds,
            rate: z.number().finite().min(0.2).max(0.9),
          })
          .strict(),
      )
      .max(2),
    focusT: seconds,
  })
  .strict();
export type Annotations = z.infer<typeof AnnotationsSchema>;

const questionBase = {
  id: slug,
  /** Where the video pauses for this question. */
  t: seconds,
  kicker: text(1, 32),
  prompt: text(4, 180),
  hint: text(4, 180),
  explanation: text(8, 320),
  /** Overlay ids revealed after answering (from annotations or extraOverlays). */
  reveal: z.array(slug).max(6),
};

export const QuestionSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...questionBase,
      type: z.literal("choice"),
      options: z
        .array(
          z
            .object({
              text: text(1, 90),
              correct: z.boolean(),
              feedback: text(4, 180),
            })
            .strict(),
        )
        .min(2)
        .max(4),
    })
    .strict(),
  z
    .object({
      ...questionBase,
      type: z.literal("vector"),
      anchor: AnchorSchema,
      quantity: z.enum(quantities),
      answerDeg: degrees,
      toleranceDeg: z.number().finite().min(10).max(60),
    })
    .strict(),
  z
    .object({
      ...questionBase,
      type: z.literal("hotspot"),
      target: AnchorSchema,
      /** Fraction of the frame width counted as a hit. */
      radius: z.number().finite().min(0.025).max(0.22),
    })
    .strict(),
  z
    .object({
      ...questionBase,
      type: z.literal("scrub"),
      answerT: seconds,
      toleranceS: z.number().finite().min(0.08).max(1.2),
    })
    .strict(),
  z
    .object({
      ...questionBase,
      type: z.literal("path"),
      track: slug,
      horizonS: z.number().finite().min(0.25).max(4),
    })
    .strict(),
]);
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionType = Question["type"];

export const shapes = [
  "ball",
  "box",
  "can",
  "bottle",
  "cup",
  "disc",
  "plate",
  "cap",
  "wheel",
  "door",
  "bar",
  "person",
  "boat",
  "bag",
  "book",
  "phone",
  "block",
] as const;
export type Shape = (typeof shapes)[number];

export const materials = [
  "wood",
  "metal",
  "stone",
  "ice",
  "water",
  "sand",
  "grass",
  "carpet",
  "plastic",
  "glass",
  "concrete",
  "fabric",
] as const;

const SkinItemSchema = z
  .object({ name: text(1, 28), shape: z.enum(shapes), color: hex })
  .strict();

export const LabSchema = z
  .object({
    engine: z.enum(ENGINE_IDS),
    title: text(4, 70),
    goal: text(8, 180),
    skin: z
      .object({
        body: SkinItemSchema,
        other: SkinItemSchema.nullable(),
        surface: z
          .object({ name: text(1, 28), material: z.enum(materials) })
          .strict()
          .nullable(),
        agent: text(1, 28).nullable(),
      })
      .strict(),
    params: z.record(
      z.string().regex(/^[a-zA-Z0-9]+$/),
      z
        .object({
          value: z.number().finite(),
          min: z.number().finite().nullable(),
          max: z.number().finite().nullable(),
        })
        .strict(),
    ),
    /** Parameters worth a slider; the rest stay under "More settings". */
    featured: z.array(z.string().regex(/^[a-zA-Z0-9]+$/)).min(1).max(5),
    /** Metrics shown as live tiles, most important first. */
    readouts: z.array(z.string().regex(/^[a-zA-Z0-9]+$/)).min(2).max(4),
    experiments: z
      .array(
        z
          .object({
            id: slug,
            title: text(4, 56),
            question: text(8, 160),
            change: z.record(
              z.string().regex(/^[a-zA-Z0-9]+$/),
              z.number().finite(),
            ),
            metric: z.string().regex(/^[a-zA-Z0-9]+$/),
            expect: z.enum(["increase", "decrease", "same"]),
            explanation: text(8, 280),
          })
          .strict(),
      )
      .min(2)
      .max(4),
    challenge: z
      .object({
        title: text(4, 56),
        prompt: text(8, 180),
        metric: z.string().regex(/^[a-zA-Z0-9]+$/),
        target: z.number().finite(),
        tolerance: z.number().finite().positive(),
        hint: text(4, 180),
      })
      .strict()
      .nullable(),
    takeaway: text(8, 220),
  })
  .strict();
export type Lab = z.infer<typeof LabSchema>;
export type Experiment = Lab["experiments"][number];

const ModelInfoSchema = z
  .object({
    modelId: z.string().max(240),
    invocationId: z.string().max(80),
    latencyMs: z.number().finite().nonnegative(),
    repaired: z.boolean(),
  })
  .strict();

export const StudioSpecSchema = z
  .object({
    version: z.literal(STUDIO_VERSION),
    eventId: z.string().min(1).max(160),
    generatedAt: z.string().datetime(),
    clip: z
      .object({
        url: z.string().min(1).max(300),
        durationSeconds: z.number().finite().positive().max(600),
        width: z.number().int().positive(),
        height: z.number().int().positive(),
        eventFrom: seconds,
        eventTo: seconds,
      })
      .strict(),
    headline: z
      .object({
        title: text(4, 80),
        subtitle: text(8, 220),
        concept: text(2, 60),
        summary: text(8, 260),
        equation: z.string().trim().max(60).nullable(),
        keyIdeas: z.array(text(4, 140)).min(2).max(3),
      })
      .strict(),
    annotations: AnnotationsSchema,
    /** Overlays the lesson designer added for quiz reveals. */
    revealOverlays: z.array(OverlaySchema).max(10),
    quiz: z.array(QuestionSchema).min(2).max(5),
    lab: LabSchema,
    provenance: z.union([
      z
        .object({
          kind: z.literal("agents"),
          annotator: ModelInfoSchema,
          designer: ModelInfoSchema,
        })
        .strict(),
      z.object({ kind: z.literal("prepared"), note: text(4, 200) }).strict(),
    ]),
  })
  .strict();
export type StudioSpec = z.infer<typeof StudioSpecSchema>;

export const studioStages = [
  "queued",
  "annotating",
  "designing",
  "checking",
  "ready",
  "failed",
] as const;
export type StudioStage = (typeof studioStages)[number];

export interface StudioRecord {
  eventId: string;
  sessionId: string;
  stage: StudioStage;
  updatedAt: string;
  startedAt: string | null;
  attempts: number;
  error: { code: string; message: string } | null;
  spec: StudioSpec | null;
  /** The event this studio was copied from when a re-run reused it. */
  reusedFrom?: string | null;
}

export interface DaySlide {
  eventId: string;
  sessionId: string;
  subject: string;
  concept: string | null;
  objectiveIds: string[];
  kind: "observed_action" | "scene_context";
  sourceInterval: { startSeconds: number; endSeconds: number } | null;
  clip: {
    url: string;
    mimeType: "image/jpeg" | "video/mp4";
    durationSeconds: number | null;
    width: number;
    height: number;
  };
  posterUrl: string;
  stage: StudioStage | "none";
  title: string | null;
  engine: string | null;
  error: string | null;
}

export interface DayRecording {
  sessionId: string;
  sourceKind: "image" | "video" | "phone";
  createdAt: string;
  durationSeconds: number | null;
  slides: DaySlide[];
}

export interface DayResponse {
  recordings: DayRecording[];
  model: string;
}

export interface StudioEventResponse {
  slide: DaySlide;
  record: StudioRecord;
}
