import fs from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import type { z } from "zod";
import {
  ProposerResponseSchema,
  ReviewResponseSchema,
  objectiveIds,
  parseStrictModelJson,
  validateEvidence,
  type DiscoveryFrame,
} from "../../shared/discovery";
import { DISCOVERY_COURSE } from "../../shared/discoveryCourse";
import { LessonDraftResponseSchema } from "../../shared/learning";
import {
  BedrockTransport,
  GlobalCloudDispatcher,
  bedrockText,
  bedrockToolUse,
  bedrockUsage,
} from "../bedrock";
import type { DiscoveryConfig } from "./config";
import { DiscoveryError } from "./errors";
import {
  proposerPromptHash,
  proposerSystemPrompt,
  reviewerPromptHash,
  reviewerSystemPrompt,
} from "./prompts";
import type { DiscoveryStore, LedgerEntry } from "./store";

export interface ModelFrame extends DiscoveryFrame {
  path: string;
}

export class ModelOutputError extends DiscoveryError {
  constructor(
    message: string,
    readonly rawText: string,
    readonly validation: string,
  ) {
    super("FAILED_INVALID_OUTPUT", message, 502, false);
    this.name = "ModelOutputError";
  }
}

/** Learned lessons and past examples added to a call; version feeds the prompt hash. */
export interface LearningContext {
  lessons: string | null;
  examples: string | null;
  version: string;
  /** Offline lesson checks bypass live per-minute limits but keep global spacing. */
  replay?: boolean;
}

/** What the judge is told about earlier cards of the same video. */
export interface VideoContextPrompt {
  text: string | null;
  refs: string[];
}

function learnedPromptHash(base: string, learning?: LearningContext) {
  if (!learning || (!learning.lessons && !learning.examples)) return base;
  return createHash("sha256")
    .update(JSON.stringify({ base, learning }))
    .digest("hex");
}

const PROPOSAL_TOOL = "submit_proposals";
const REVIEW_TOOL = "submit_review";
const PROPOSAL_OUTPUT_RULE = `OUTPUT CHANNEL: Submit the answer by calling the ${PROPOSAL_TOOL} tool exactly once, using the same fields as the JSON shape above. Use only supplied frame IDs. For scene_context, omit before and after. An empty proposals list is a valid answer.`;
const REVIEW_OUTPUT_RULE = `OUTPUT CHANNEL: Submit the decision by calling the ${REVIEW_TOOL} tool exactly once. Write brief reasoning in analysis first: what is and is not visible, then how each grounded opportunity's concept compares with any covered concepts listed for this video and, for a repeat, whether it would clearly make the better card. Then give verdict, reason, and opportunities using the same fields as the JSON shape above. Use only supplied frame IDs and covered refs. For scene_context, omit before and after.`;

/**
 * One grounded opportunity. The judge's version adds a curriculum connection,
 * the concept it teaches, and which covered concept of this video it repeats.
 */
function opportunityItemSchema(
  frameIds: string[],
  judge: { coveredRefs: string[] } | null,
) {
  const frameId = { type: "string", enum: frameIds };
  const fact = {
    type: "object",
    properties: {
      text: { type: "string" },
      frameIds: { type: "array", items: frameId, minItems: 1 },
    },
    required: ["text", "frameIds"],
  };
  return {
    type: "object",
    properties: {
      kind: { type: "string", enum: ["observed_action", "scene_context"] },
      subject: { type: "string" },
      startFrameId: frameId,
      endFrameId: frameId,
      observation: { type: "string" },
      before: fact,
      after: fact,
      evidenceFrameIds: { type: "array", items: frameId, minItems: 1 },
      objectiveIds: {
        type: "array",
        items: { type: "string", enum: objectiveIds },
        minItems: 1,
      },
      ...(judge
        ? {
            connection: { type: "string" },
            concept: { type: "string", maxLength: 160 },
            coveredBy: { type: "string", enum: ["none", ...judge.coveredRefs] },
            replacesCovered: { type: "boolean" },
          }
        : {}),
      limitations: { type: "array", items: { type: "string" } },
    },
    required: [
      "kind",
      "subject",
      "startFrameId",
      "endFrameId",
      "observation",
      "evidenceFrameIds",
      "objectiveIds",
      ...(judge ? ["connection", "concept", "coveredBy", "replacesCovered"] : []),
      "limitations",
    ],
  };
}

function forcedTool(
  name: string,
  description: string,
  json: Record<string, unknown>,
) {
  return {
    tools: [{ toolSpec: { name, description, inputSchema: { json } } }],
    toolChoice: { tool: { name } },
  };
}

/**
 * Models constrain output through a tool schema, so frame references are enums
 * of the supplied IDs and before/after are omitted, never null.
 */
export function proposalToolConfig(frameIds: string[]) {
  return forcedTool(
    PROPOSAL_TOOL,
    "Submit zero to three grounded proposals. Omit before and after for scene_context.",
    {
      type: "object",
      properties: {
        proposals: {
          type: "array",
          maxItems: 3,
          items: opportunityItemSchema(frameIds, null),
        },
      },
      required: ["proposals"],
    },
  );
}

/**
 * analysis comes first so the judge can reason before committing to a verdict;
 * coveredBy may name only the covered refs listed for this video.
 */
export function reviewToolConfig(frameIds: string[], coveredRefs: string[] = []) {
  return forcedTool(
    REVIEW_TOOL,
    "Submit the teachability verdict. Opportunities only for a teachable verdict.",
    {
      type: "object",
      properties: {
        analysis: { type: "string" },
        verdict: {
          type: "string",
          enum: ["teachable", "not_teachable", "insufficient_evidence"],
        },
        reason: { type: "string" },
        opportunities: {
          type: "array",
          maxItems: 3,
          items: opportunityItemSchema(frameIds, { coveredRefs }),
        },
      },
      required: ["analysis", "verdict", "reason", "opportunities"],
    },
  );
}

function parseLoose(input: unknown) {
  return typeof input === "string" ? JSON.parse(input) : input;
}

/**
 * Evidence bookkeeping only: the declared evidence must include both boundaries
 * and every before/after frame, without duplicates. Claims about which frames
 * show what, their order, and the interval are still validated, never repaired.
 */
function completeEvidence(item: any) {
  if (!Array.isArray(item.evidenceFrameIds)) return item.evidenceFrameIds;
  const ids = [
    ...item.evidenceFrameIds,
    item.startFrameId,
    item.endFrameId,
    ...(Array.isArray(item.before?.frameIds) ? item.before.frameIds : []),
    ...(Array.isArray(item.after?.frameIds) ? item.after.frameIds : []),
  ];
  return [...new Set(ids.filter((id) => typeof id === "string"))];
}

function normalizeOpportunity(item: any, withConnection: boolean) {
  if (!item || typeof item !== "object") return item;
  return {
    kind: item.kind,
    subject: item.subject,
    startFrameId: item.startFrameId,
    endFrameId: item.endFrameId,
    observation: item.observation,
    before: item.before ?? null,
    after: item.after ?? null,
    evidenceFrameIds: completeEvidence(item),
    objectiveIds: item.objectiveIds,
    ...(withConnection
      ? {
          connection: item.connection,
          // A long concept name is trimmed rather than failing the whole review.
          ...(typeof item.concept === "string" && item.concept.trim()
            ? { concept: item.concept.trim().slice(0, 160) }
            : {}),
          coveredBy:
            typeof item.coveredBy === "string" && item.coveredBy !== "none"
              ? item.coveredBy
              : null,
          // Only a repeat can replace a covered card.
          replacesCovered:
            item.replacesCovered === true &&
            typeof item.coveredBy === "string" &&
            item.coveredBy !== "none",
        }
      : {}),
    limitations: item.limitations ?? [],
  };
}

/** Maps tool input onto the strict proposal schema (omitted before/after become null). */
export function normalizeProposalInput(input: unknown) {
  let value: any = parseLoose(input);
  if (value && typeof value.proposals === "string")
    value = { proposals: JSON.parse(value.proposals) };
  if (!value || !Array.isArray(value.proposals)) return value;
  return {
    proposals: value.proposals.map((item: any) =>
      normalizeOpportunity(item, false),
    ),
  };
}

/**
 * The claimed interval is the span of every frame the model cites, so start and
 * end are set to the earliest and latest cited frames. Which frames show what,
 * and before-precedes-after, are still validated afterwards, never adjusted.
 */
export function fitCitedInterval<T extends Record<string, unknown>>(
  value: T,
  key: "proposals" | "opportunities",
  frames: Array<{ frameId: string; sourceTimeMs: number | null }>,
): T {
  const items = value?.[key];
  if (!Array.isArray(items)) return value;
  const times = new Map(
    frames.map((frame) => [frame.frameId, frame.sourceTimeMs]),
  );
  return {
    ...value,
    [key]: items.map((item: any) => {
      if (!item || !Array.isArray(item.evidenceFrameIds)) return item;
      const cited = item.evidenceFrameIds.filter(
        (id: unknown) =>
          typeof id === "string" && typeof times.get(id) === "number",
      ) as string[];
      if (cited.length !== item.evidenceFrameIds.length || !cited.length)
        return item;
      const ordered = [...cited].sort((a, b) => times.get(a)! - times.get(b)!);
      return { ...item, startFrameId: ordered[0], endFrameId: ordered.at(-1) };
    }),
  };
}

const LESSON_TOOL = "submit_lessons";
const LESSON_OUTPUT_RULE = `OUTPUT CHANNEL: Submit by calling the ${LESSON_TOOL} tool exactly once. Write your reasoning in analysis first: what the contact sheets and human notes show, and which patterns hold across videos. Keep analysis under 400 words. Then give lessons and retire suggestions using the fields described above. Empty lists are valid answers.`;

/**
 * Lessons may replace existing live lessons, and retire suggestions may target
 * them; both reference real lesson IDs through enums.
 */
export function lessonToolConfig(
  replaceableIds: string[] = [],
  retirableIds: string[] = [],
) {
  const ids = { type: "array", items: { type: "string" } };
  return forcedTool(
    LESSON_TOOL,
    "Submit zero to six general lessons with supporting and contradicting case IDs, and zero to six suggestions to turn existing lessons off.",
    {
      type: "object",
      properties: {
        analysis: { type: "string" },
        lessons: {
          type: "array",
          maxItems: 6,
          items: {
            type: "object",
            properties: {
              model: { type: "string", enum: ["proposer", "reviewer"] },
              text: { type: "string", maxLength: 280 },
              supportingIds: { ...ids, minItems: 1 },
              contradictingIds: ids,
              ...(replaceableIds.length
                ? {
                    replacesLessonIds: {
                      type: "array",
                      items: { type: "string", enum: replaceableIds },
                    },
                  }
                : {}),
            },
            required: [
              "model",
              "text",
              "supportingIds",
              "contradictingIds",
              ...(replaceableIds.length ? ["replacesLessonIds"] : []),
            ],
          },
        },
        ...(retirableIds.length
          ? {
              retire: {
                type: "array",
                maxItems: 6,
                items: {
                  type: "object",
                  properties: {
                    lessonId: { type: "string", enum: retirableIds },
                    reason: { type: "string", maxLength: 280 },
                    supportingIds: ids,
                  },
                  required: ["lessonId", "reason", "supportingIds"],
                },
              },
            }
          : {}),
      },
      required: [
        "analysis",
        "lessons",
        ...(retirableIds.length ? ["retire"] : []),
      ],
    },
  );
}

/** Maps tool input onto the strict lesson schema; the analysis field is dropped. */
export function normalizeLessonInput(input: unknown) {
  const value: any = parseLoose(input);
  if (!value || typeof value !== "object") return value;
  const list = (field: unknown) =>
    typeof field === "string" ? JSON.parse(field) : field;
  // Over-long ID lists are trimmed; re-sending ~90K tokens for a repair is not worth it.
  const ids = (field: unknown, max: number) =>
    Array.isArray(field) ? field.slice(0, max) : field;
  const lessons = list(value.lessons);
  const retire = list(value.retire) ?? [];
  return {
    lessons: Array.isArray(lessons)
      ? lessons.map((item: any) =>
          item && typeof item === "object"
            ? {
                model: item.model,
                text: item.text,
                supportingIds: ids(item.supportingIds, 20),
                contradictingIds: ids(item.contradictingIds ?? [], 20),
                replacesLessonIds: ids(item.replacesLessonIds ?? [], 10),
              }
            : item,
        )
      : lessons,
    retire: Array.isArray(retire)
      ? retire.map((item: any) =>
          item && typeof item === "object"
            ? {
                lessonId: item.lessonId,
                reason: item.reason,
                supportingIds: ids(item.supportingIds ?? [], 20),
              }
            : item,
        )
      : retire,
  };
}

/** Maps tool input onto the strict review schema; the analysis field is dropped. */
export function normalizeReviewInput(input: unknown) {
  let value: any = parseLoose(input);
  if (!value || typeof value !== "object") return value;
  let opportunities = value.opportunities;
  if (typeof opportunities === "string")
    opportunities = JSON.parse(opportunities);
  return {
    verdict: value.verdict,
    reason: value.reason,
    opportunities: Array.isArray(opportunities)
      ? opportunities.map((item: any) => normalizeOpportunity(item, true))
      : opportunities,
  };
}

function requestContent(
  sourceKind: "image" | "video" | "phone",
  frames: ModelFrame[],
  bytes: Buffer[],
  limitations: string[],
) {
  const content: any[] = [
    ...(sourceKind === "image"
      ? [
          {
            text: "SOURCE CONSTRAINT: This request contains one still image. It cannot establish a temporal action. Return only scene_context proposals with the same supplied frame as startFrameId/endFrameId and null before/after, or return an empty proposals list.",
          },
        ]
      : []),
    {
      text: JSON.stringify({
        sourceKind,
        course: DISCOVERY_COURSE,
        evidenceLimitations: limitations,
        frames: frames.map((frame) => ({
          frameId: frame.frameId,
          sourceTimeMs: frame.sourceTimeMs,
        })),
      }),
    },
  ];
  frames.forEach((frame, index) => {
    content.push(
      {
        text:
          frame.sourceTimeMs === null
            ? `Still frame ${frame.frameId}`
            : `Frame ${frame.frameId}; source time ${frame.sourceTimeMs} ms`,
      },
      { image: { format: "jpeg", source: { bytes: bytes[index] } } },
    );
  });
  return content;
}

export class DiscoveryModels {
  constructor(
    private config: DiscoveryConfig,
    private store: DiscoveryStore,
    private transport: BedrockTransport,
    private dispatcher: GlobalCloudDispatcher,
  ) {}

  private async invoke(
    options: {
      sessionId: string | null;
      generation: number | null;
      stage: "proposer" | "reviewer" | "preflight" | "learning";
      modelId: string;
      promptHash: string;
      snapshotHash: string | null;
      reason: string;
      request: Record<string, any>;
      timeoutMs: number;
      expiresAtMs?: number;
    },
    signal?: AbortSignal,
  ) {
    const attemptId = randomUUID();
    const startedAt = new Date().toISOString();
    const row: LedgerEntry = {
      attemptId,
      sessionId: options.sessionId,
      generation: options.generation,
      stage: options.stage,
      modelId: options.modelId,
      promptHash: options.promptHash,
      snapshotHash: options.snapshotHash,
      reason: options.reason,
      startedAt,
    };
    await this.store.appendLedger(row);
    const start = Date.now();
    try {
      const result = await this.dispatcher.run(
        options.stage,
        () => {
          if (options.expiresAtMs && Date.now() >= options.expiresAtMs)
            throw new DiscoveryError(
              "REVIEW_EXPIRED",
              "The preserved review waited longer than 120 seconds and expired.",
              503,
              true,
            );
          return this.transport.converse(
            options.modelId,
            options.request,
            options.timeoutMs,
            signal,
          );
        },
        signal,
      );
      const usage = bedrockUsage(result);
      const completed = {
        ...row,
        endedAt: new Date().toISOString(),
        result: "completed",
        latencyMs: Date.now() - start,
        ...usage,
        errorCategory: null,
      };
      await this.store.appendLedger(completed);
      return { result, attemptId, usage, latencyMs: completed.latencyMs };
    } catch (error) {
      const name = error instanceof Error ? error.name : "UnknownError";
      await this.store.appendLedger({
        ...row,
        endedAt: new Date().toISOString(),
        result: /Abort|Timeout/.test(name) ? "unknown" : "failed",
        latencyMs: Date.now() - start,
        inputTokens: null,
        outputTokens: null,
        errorCategory: name.slice(0, 80),
      });
      throw error;
    }
  }

  /**
   * A forced tool call validated against a strict schema, with one repair turn
   * that returns the validation error to the model.
   */
  private async structuredCall<T>(options: {
    sessionId: string | null;
    generation: number | null;
    stage: "proposer" | "reviewer" | "learning";
    label: "proposer" | "reviewer" | "lesson drafter";
    modelId: string;
    promptHash: string;
    snapshotHash: string | null;
    reason: string;
    system: Array<{ text: string }>;
    content: any[];
    toolName: string;
    toolConfig: Record<string, unknown>;
    maxTokens: number;
    timeoutMs: number;
    expiresAtMs?: number;
    emptyAnswer: string;
    parse: (input: unknown) => T;
    fallbackSchema: z.ZodType<T>;
    validate: (value: T) => void;
    signal?: AbortSignal;
  }) {
    const userMessage = { role: "user", content: options.content };
    const call = (messages: any[], callReason: string) =>
      this.invoke(
        {
          sessionId: options.sessionId,
          generation: options.generation,
          stage: options.stage,
          modelId: options.modelId,
          promptHash: options.promptHash,
          snapshotHash: options.snapshotHash,
          reason: callReason,
          request: {
            system: options.system,
            messages,
            toolConfig: options.toolConfig,
            inferenceConfig: { maxTokens: options.maxTokens, temperature: 0 },
          },
          timeoutMs: options.timeoutMs,
          expiresAtMs: options.expiresAtMs,
        },
        options.signal,
      );
    const attempt = (result: any) => {
      const toolUse = bedrockToolUse(result, options.toolName);
      const rawText = toolUse
        ? JSON.stringify(toolUse.input)
        : bedrockText(result);
      try {
        if (bedrockUsage(result).stopReason === "max_tokens")
          throw new Error(`The ${options.label} response was truncated.`);
        const parsed = toolUse
          ? options.parse(toolUse.input)
          : parseStrictModelJson(rawText, options.fallbackSchema);
        options.validate(parsed);
        return { ok: true as const, response: parsed, rawText, toolUse };
      } catch (error) {
        return {
          ok: false as const,
          rawText,
          toolUse,
          validation:
            error instanceof Error
              ? error.message.slice(0, 2_000)
              : "Unknown validation error",
        };
      }
    };
    const first = await call([userMessage], options.reason);
    const firstParse = attempt(first.result);
    if (firstParse.ok)
      return {
        ...first,
        response: firstParse.response,
        rawText: firstParse.rawText,
        repaired: false,
      };
    const feedback = `Validation failed: ${firstParse.validation.slice(0, 1_500)}\nCall ${options.toolName} again with a corrected answer${options.emptyAnswer}.`;
    const second = await call(
      [
        userMessage,
        first.result.output?.message || {
          role: "assistant",
          content: [{ text: firstParse.rawText || "(empty)" }],
        },
        {
          role: "user",
          content: firstParse.toolUse
            ? [
                {
                  toolResult: {
                    toolUseId: firstParse.toolUse.toolUseId,
                    content: [{ text: feedback }],
                    status: "error",
                  },
                },
              ]
            : [{ text: feedback }],
        },
      ],
      `${options.reason}+repair`,
    );
    const secondParse = attempt(second.result);
    if (secondParse.ok)
      return {
        ...second,
        response: secondParse.response,
        rawText: secondParse.rawText,
        repaired: true,
      };
    throw new ModelOutputError(
      `The ${options.label} returned output that failed strict schema or evidence validation after one repair.`,
      JSON.stringify({
        first: firstParse.rawText,
        repair: secondParse.rawText,
      }),
      `first: ${firstParse.validation}\nrepair: ${secondParse.validation}`.slice(
        0,
        4_000,
      ),
    );
  }

  async propose(
    sessionId: string,
    generation: number,
    sourceKind: "image" | "video" | "phone",
    snapshotHash: string,
    frames: ModelFrame[],
    reason: string,
    limitations: string[],
    signal?: AbortSignal,
    learning?: LearningContext,
  ) {
    const bytes = await Promise.all(
      frames.map((frame) => fs.readFile(frame.path)),
    );
    const promptHash = learnedPromptHash(proposerPromptHash, learning);
    const result = await this.structuredCall({
      sessionId,
      generation,
      stage: learning?.replay ? "learning" : "proposer",
      label: "proposer",
      modelId: this.config.proposerModelId,
      promptHash,
      snapshotHash,
      reason,
      system: [
        { text: proposerSystemPrompt },
        ...(learning?.lessons ? [{ text: learning.lessons }] : []),
        { text: PROPOSAL_OUTPUT_RULE },
      ],
      content: requestContent(sourceKind, frames, bytes, limitations),
      toolName: PROPOSAL_TOOL,
      toolConfig: proposalToolConfig(frames.map((frame) => frame.frameId)),
      maxTokens: this.config.limits.proposerMaxTokens,
      timeoutMs: this.config.limits.proposerTimeoutMs,
      emptyAnswer: ", or with an empty proposals list",
      parse: (input) =>
        ProposerResponseSchema.parse(
          fitCitedInterval(normalizeProposalInput(input), "proposals", frames),
        ),
      fallbackSchema: ProposerResponseSchema,
      validate: (value) => {
        for (const proposal of value.proposals)
          validateEvidence(proposal, frames, sourceKind);
      },
      signal,
    });
    return { ...result, promptHash };
  }

  async review(
    sessionId: string,
    generation: number,
    sourceKind: "image" | "video" | "phone",
    snapshotHash: string,
    frames: ModelFrame[],
    reason: string,
    limitations: string[],
    signal?: AbortSignal,
    expiresAtMs?: number,
    learning?: LearningContext,
    /** Earlier cards of this video; per-call data like frames, so outside the prompt hash. */
    video?: VideoContextPrompt,
  ) {
    const bytes = await Promise.all(
      frames.map((frame) => fs.readFile(frame.path)),
    );
    const promptHash = learnedPromptHash(reviewerPromptHash, learning);
    const coveredRefs = video?.refs ?? [];
    const result = await this.structuredCall({
      sessionId,
      generation,
      stage: learning?.replay ? "learning" : "reviewer",
      label: "reviewer",
      modelId: this.config.reviewerModelId,
      promptHash,
      snapshotHash,
      reason,
      system: [
        { text: reviewerSystemPrompt },
        ...(learning?.lessons ? [{ text: learning.lessons }] : []),
        { text: REVIEW_OUTPUT_RULE },
      ],
      // Intentionally contains no proposer response or narrative for these frames.
      content: [
        ...(video?.text ? [{ text: video.text }] : []),
        ...(learning?.examples ? [{ text: learning.examples }] : []),
        ...requestContent(sourceKind, frames, bytes, limitations),
      ],
      toolName: REVIEW_TOOL,
      toolConfig: reviewToolConfig(
        frames.map((frame) => frame.frameId),
        coveredRefs,
      ),
      maxTokens: this.config.limits.reviewerMaxTokens,
      timeoutMs: this.config.limits.reviewerTimeoutMs,
      expiresAtMs,
      emptyAnswer: "",
      parse: (input) =>
        ReviewResponseSchema.parse(
          fitCitedInterval(
            normalizeReviewInput(input),
            "opportunities",
            frames,
          ),
        ),
      fallbackSchema: ReviewResponseSchema,
      validate: (value) => {
        for (const opportunity of value.opportunities) {
          validateEvidence(opportunity, frames, sourceKind);
          if (
            opportunity.coveredBy &&
            opportunity.coveredBy !== "none" &&
            !coveredRefs.includes(opportunity.coveredBy)
          )
            throw new Error(
              `coveredBy ${opportunity.coveredBy} is not a covered concept of this video.`,
            );
        }
      },
      signal,
    });
    return { ...result, promptHash };
  }

  /**
   * Drafter-model call (Opus by default) that writes lessons and retire
   * suggestions from labeled cases, with contact-sheet images where available.
   */
  async draft(options: {
    system: string;
    content: Array<Record<string, unknown>>;
    replaceableIds: string[];
    retirableIds: string[];
    signal?: AbortSignal;
  }) {
    const { system, signal } = options;
    return this.structuredCall({
      sessionId: null,
      generation: null,
      stage: "learning",
      label: "lesson drafter",
      modelId: this.config.drafterModelId,
      promptHash: createHash("sha256").update(system).digest("hex"),
      snapshotHash: null,
      reason: "draft_lessons",
      system: [{ text: system }, { text: LESSON_OUTPUT_RULE }],
      content: options.content,
      toolName: LESSON_TOOL,
      toolConfig: lessonToolConfig(options.replaceableIds, options.retirableIds),
      // Up to 20 contact sheets plus analysis first; allow room and time.
      maxTokens: 10_000,
      timeoutMs: 240_000,
      emptyAnswer: ", or with an empty lessons list",
      parse: (input) =>
        LessonDraftResponseSchema.parse(normalizeLessonInput(input)),
      fallbackSchema: LessonDraftResponseSchema,
      validate: () => undefined,
      signal,
    });
  }
}
