import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { DISCOVERY_COURSE } from "../../shared/discoveryCourse";
import { engineCatalogText } from "../../shared/studio/engines";
import {
  AnnotationsSchema,
  STUDIO_VERSION,
  StudioSpecSchema,
  type Annotations,
  type StudioSpec,
} from "../../shared/studio/schema";
import {
  normalizeStudioSpec,
  validateAnnotations,
  validateStudioSpec,
} from "../../shared/studio/validate";
import { bedrockText, bedrockToolUse, bedrockUsage, type BedrockTransport } from "../bedrock";
import { DiscoveryError } from "../discovery/errors";
import type { DiscoveryStore } from "../discovery/store";
import type { StudioFrame } from "./frames";
import { annotatorSystemPrompt, designerSystemPrompt, studioPromptHash } from "./prompts";
import {
  ANNOTATION_TOOL,
  LESSON_TOOL,
  annotationToolConfig,
  fitText,
  lessonToolConfig,
  normalizeLab,
  normalizeOverlay,
  normalizeQuestion,
  normalizeTracks,
} from "./tools";

export interface StudioFacts {
  subject: string;
  kind: "observed_action" | "scene_context";
  observation: string;
  before: string | null;
  after: string | null;
  connection: string;
  concept: string | null;
  objectives: Array<{ id: string; description: string }>;
  limitations: string[];
  reviewerReason: string;
  sourceKind: "image" | "video" | "phone";
}

export interface StudioClip {
  url: string;
  durationSeconds: number;
  width: number;
  height: number;
  eventFrom: number;
  eventTo: number;
}

export class StudioOutputError extends DiscoveryError {
  constructor(
    message: string,
    readonly problems: string,
  ) {
    super("STUDIO_INVALID_OUTPUT", message, 502, true);
    this.name = "StudioOutputError";
  }
}

function describeError(error: unknown) {
  if (error instanceof ZodError)
    return error.issues
      .slice(0, 30)
      .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
  return error instanceof Error ? error.message : String(error);
}

export class StudioAgents {
  constructor(
    private store: DiscoveryStore,
    private transport: BedrockTransport,
    readonly modelId: string,
  ) {}

  private async invoke(request: Record<string, unknown>, reason: string, timeoutMs: number, signal?: AbortSignal) {
    const attemptId = randomUUID();
    const row = {
      attemptId,
      sessionId: null,
      generation: null,
      stage: "studio" as const,
      modelId: this.modelId,
      promptHash: studioPromptHash,
      snapshotHash: null,
      reason,
      startedAt: new Date().toISOString(),
    };
    await this.store.appendLedger(row);
    const started = Date.now();
    try {
      const result = await this.transport.converse(this.modelId, request, timeoutMs, signal);
      await this.store.appendLedger({
        ...row,
        endedAt: new Date().toISOString(),
        result: "completed",
        latencyMs: Date.now() - started,
        ...bedrockUsage(result),
        errorCategory: null,
      });
      return { result, attemptId, latencyMs: Date.now() - started };
    } catch (error) {
      await this.store.appendLedger({
        ...row,
        endedAt: new Date().toISOString(),
        result: "failed",
        latencyMs: Date.now() - started,
        inputTokens: null,
        outputTokens: null,
        errorCategory: error instanceof Error ? error.name.slice(0, 80) : "UnknownError",
      });
      throw error;
    }
  }

  /** Forced tool call, validated; up to `repairs` turns send the problems back. */
  private async structured<T>(options: {
    label: string;
    system: string;
    content: unknown[];
    toolName: string;
    toolConfig: Record<string, unknown>;
    maxTokens: number;
    temperature: number;
    timeoutMs: number;
    repairs: number;
    build: (input: unknown) => T;
    signal?: AbortSignal;
  }) {
    const messages: any[] = [{ role: "user", content: options.content }];
    let latencyMs = 0;
    let lastProblems = "";
    for (let turn = 0; turn <= options.repairs; turn++) {
      const { result, attemptId, latencyMs: took } = await this.invoke(
        {
          system: [{ text: options.system }],
          messages,
          toolConfig: options.toolConfig,
          inferenceConfig: { maxTokens: options.maxTokens, temperature: options.temperature },
        },
        `${options.label}${turn ? `+repair${turn}` : ""}`,
        options.timeoutMs,
        options.signal,
      );
      latencyMs += took;
      const toolUse = bedrockToolUse(result, options.toolName);
      try {
        if (bedrockUsage(result).stopReason === "max_tokens")
          throw new Error(`The ${options.label} answer was cut off; keep analysis shorter and overlays fewer.`);
        if (!toolUse) throw new Error(`Call ${options.toolName} with the answer.`);
        const value = options.build(toolUse.input);
        return { value, attemptId, latencyMs, repaired: turn > 0 };
      } catch (error) {
        lastProblems = describeError(error).slice(0, 4000);
        if (turn === options.repairs) break;
        messages.push(
          result.output?.message ?? { role: "assistant", content: [{ text: bedrockText(result) || "(empty)" }] },
          {
            role: "user",
            content: toolUse
              ? [
                  {
                    toolResult: {
                      toolUseId: toolUse.toolUseId,
                      content: [
                        {
                          text: `Validation failed. Fix every problem and call ${options.toolName} again with the complete corrected answer:\n${lastProblems}`,
                        },
                      ],
                      status: "error",
                    },
                  },
                ]
              : [{ text: `Validation failed: ${lastProblems}\nCall ${options.toolName} with the complete answer.` }],
          },
        );
      }
    }
    throw new StudioOutputError(`The ${options.label} could not produce a valid answer.`, lastProblems);
  }

  async annotate(facts: StudioFacts, clip: StudioClip, frames: StudioFrame[], signal?: AbortSignal) {
    const frameTimes = new Map(frames.map((frame) => [frame.label, frame.t]));
    const content: unknown[] = [
      {
        text: JSON.stringify({
          clip: {
            durationSeconds: round(clip.durationSeconds),
            width: clip.width,
            height: clip.height,
            orientation: clip.height > clip.width ? "portrait" : "landscape",
            eventWindow: { from: round(clip.eventFrom), to: round(clip.eventTo) },
          },
          event: facts,
          frames: frames.map((frame) => ({ label: frame.label, t: round(frame.t) })),
        }),
      },
    ];
    for (const frame of frames)
      content.push(
        { text: `${frame.label} · t = ${frame.t.toFixed(2)} s` },
        { image: { format: "jpeg", source: { bytes: frame.grid } } },
      );
    const call = await this.structured({
      label: "annotator",
      system: annotatorSystemPrompt,
      content,
      toolName: ANNOTATION_TOOL,
      toolConfig: annotationToolConfig(frames.map((frame) => frame.label)),
      maxTokens: 14_000,
      temperature: 0,
      timeoutMs: 300_000,
      repairs: 1,
      signal,
      build: (input) => {
        const raw: any = typeof input === "string" ? JSON.parse(input) : input;
        const annotations: Annotations = AnnotationsSchema.parse({
          tracks: normalizeTracks(raw?.tracks, frameTimes),
          overlays: (Array.isArray(raw?.overlays) ? raw.overlays : []).map(normalizeOverlay),
          chapters: (Array.isArray(raw?.chapters) ? raw.chapters : []).map((item: any) => ({
            t: Number(item?.t) || 0,
            title: fitText(item?.title, 28),
            caption: fitText(item?.caption, 120),
          })),
          freezes: (Array.isArray(raw?.freezes) ? raw.freezes : []).slice(0, 3).map((item: any) => ({
            t: Number(item?.t) || 0,
            holdSeconds: Math.min(3.5, Math.max(0.5, Number(item?.holdSeconds) || 1.5)),
            caption: fitText(item?.caption, 90),
          })),
          slowmo: (Array.isArray(raw?.slowmo) ? raw.slowmo : []).slice(0, 2).map((item: any) => ({
            from: Number(item?.from) || 0,
            to: Number(item?.to) || 0,
            rate: Math.min(0.9, Math.max(0.2, Number(item?.rate) || 0.5)),
          })),
          focusT: Number(raw?.focusT) || (clip.eventFrom + clip.eventTo) / 2,
        });
        const problems = validateAnnotations(annotations, [], clip.durationSeconds);
        if (annotations.overlays.length < 3) problems.push("Give at least 3 overlays.");
        if (!annotations.tracks.length) problems.push("Track at least one object.");
        if (problems.length) throw new Error(problems.join("\n"));
        return { annotations, raw };
      },
    });
    return call;
  }

  async design(
    eventId: string,
    facts: StudioFacts,
    clip: StudioClip,
    frames: StudioFrame[],
    annotation: { annotations: Annotations; raw: any },
    annotatorInfo: { attemptId: string; latencyMs: number; repaired: boolean },
    signal?: AbortSignal,
  ) {
    const { annotations, raw } = annotation;
    const keyFrames = pickKeyFrames(frames, clip);
    const content: unknown[] = [
      { text: `ENGINE CATALOG\n${engineCatalogText()}` },
      {
        text: JSON.stringify({
          clip: {
            durationSeconds: round(clip.durationSeconds),
            width: clip.width,
            height: clip.height,
            eventWindow: { from: round(clip.eventFrom), to: round(clip.eventTo) },
          },
          event: facts,
          course: DISCOVERY_COURSE.objectives,
          annotations: {
            note: "Positions in percent of the frame; frame labels map to times in frameTimes.",
            frameTimes: Object.fromEntries(frames.map((frame) => [frame.label, round(frame.t)])),
            tracks: raw?.tracks,
            overlays: raw?.overlays,
            chapters: raw?.chapters,
            freezes: raw?.freezes,
          },
        }),
      },
    ];
    for (const frame of keyFrames)
      content.push(
        { text: `${frame.label} · t = ${frame.t.toFixed(2)} s` },
        { image: { format: "jpeg", source: { bytes: frame.clean } } },
      );
    return await this.structured({
      label: "lesson designer",
      system: designerSystemPrompt,
      content,
      toolName: LESSON_TOOL,
      toolConfig: lessonToolConfig(annotations.tracks.map((track) => track.id)),
      maxTokens: 12_000,
      temperature: 0.4,
      timeoutMs: 300_000,
      repairs: 2,
      signal,
      build: (input): StudioSpec => {
        const lesson: any = typeof input === "string" ? JSON.parse(input) : input;
        const headline = lesson?.headline ?? {};
        const draft = {
          version: STUDIO_VERSION,
          eventId,
          generatedAt: new Date().toISOString(),
          clip: {
            url: clip.url,
            durationSeconds: clip.durationSeconds,
            width: clip.width,
            height: clip.height,
            eventFrom: clip.eventFrom,
            eventTo: clip.eventTo,
          },
          headline: {
            title: String(headline.title ?? "").trim(),
            subtitle: String(headline.subtitle ?? "").trim(),
            concept: String(headline.concept ?? "").trim(),
            summary: String(headline.summary ?? "").trim(),
            equation: typeof headline.equation === "string" && headline.equation.trim() ? headline.equation.trim().slice(0, 60) : null,
            keyIdeas: (Array.isArray(headline.keyIdeas) ? headline.keyIdeas : []).map((idea: unknown) => String(idea).trim()).slice(0, 3),
          },
          annotations,
          revealOverlays: (Array.isArray(lesson?.revealOverlays) ? lesson.revealOverlays : []).map((item: any, index: number) =>
            normalizeOverlay(item, annotations.overlays.length + index),
          ),
          quiz: (Array.isArray(lesson?.quiz) ? lesson.quiz : []).map(normalizeQuestion),
          lab: normalizeLab(lesson?.lab),
          provenance: {
            kind: "agents",
            annotator: { modelId: this.modelId, invocationId: annotatorInfo.attemptId, latencyMs: annotatorInfo.latencyMs, repaired: annotatorInfo.repaired },
            designer: { modelId: this.modelId, invocationId: "pending", latencyMs: 0, repaired: false },
          },
        };
        const spec = normalizeStudioSpec(StudioSpecSchema.parse(draft));
        const problems = validateStudioSpec(spec);
        if (problems.length) throw new Error(problems.join("\n"));
        return spec;
      },
    });
  }
}

function round(value: number) {
  return Math.round(value * 1000) / 1000;
}

/** Four clean frames: the start, the event start, its middle and its end. */
function pickKeyFrames(frames: StudioFrame[], clip: StudioClip) {
  const targets = [0, clip.eventFrom, (clip.eventFrom + clip.eventTo) / 2, clip.eventTo];
  const picked = new Map<string, StudioFrame>();
  for (const target of targets) {
    const nearest = frames.reduce((best, frame) =>
      Math.abs(frame.t - target) < Math.abs(best.t - target) ? frame : best,
    );
    picked.set(nearest.label, nearest);
  }
  return [...picked.values()].sort((a, b) => a.t - b.t);
}
