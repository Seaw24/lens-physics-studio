import { z } from "zod";

const topicIds = [
  "vectors",
  "kinematics",
  "forces",
  "projectile",
  "energy",
  "momentum",
  "circuits",
  "waves",
  "optics",
] as const;

export const physicsTopicSchema = z.enum(topicIds);

export const aiCourseSchema = z.object({
  title: z.string().trim().min(3).max(200),
  focus: z.string().trim().min(3).max(400),
  summary: z.string().trim().min(20).max(3000),
  language: z.string().trim().min(2).max(80),
  objectives: z.array(z.string().trim().min(8).max(400)).min(2).max(6),
  topics: z
    .array(
      z.object({
        id: physicsTopicSchema,
        label: z.string().trim().min(3).max(200),
        prerequisites: z.array(z.string().trim().min(2).max(200)).min(1).max(4),
      }),
    )
    .min(1)
    .max(5),
  questions: z
    .array(
      z.object({
        topic: physicsTopicSchema,
        skill: z.string().trim().min(3).max(300),
        type: z.enum(["concept", "calculation", "interpretation"]),
        prompt: z.string().trim().min(12).max(1200),
        options: z.array(z.string().trim().min(1).max(500)).length(4),
        correctIndex: z.number().int().min(0).max(3),
        explanation: z.string().trim().min(12).max(1600),
        misconception: z.string().trim().min(12).max(1000),
      }),
    )
    .length(5),
});

export type AiCourseAnalysis = z.infer<typeof aiCourseSchema>;

export class CourseModelOutputError extends Error {
  readonly issuePaths: string[];

  constructor(message: string, issuePaths: string[] = []) {
    super(message);
    this.name = "CourseModelOutputError";
    this.issuePaths = issuePaths;
  }
}

export class NotPhysicsCourseError extends Error {
  constructor() {
    super("The model determined that the document is not physics material.");
    this.name = "NotPhysicsCourseError";
  }
}

function extractJson(text: string) {
  const trimmed = text.trim();
  if (!trimmed) throw new CourseModelOutputError("The model returned no text.");
  try {
    return JSON.parse(trimmed);
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first < 0 || last < first)
      throw new CourseModelOutputError("The model did not return a JSON object.");
    try {
      return JSON.parse(trimmed.slice(first, last + 1));
    } catch {
      throw new CourseModelOutputError("The model returned incomplete JSON.");
    }
  }
}

export function parseCourseAnalysisText(text: string): AiCourseAnalysis {
  const raw = extractJson(text);
  if (raw?.error === "NOT_PHYSICS") throw new NotPhysicsCourseError();
  const parsed = aiCourseSchema.safeParse(raw);
  if (!parsed.success) {
    throw new CourseModelOutputError(
      "The model response did not match the course-analysis contract.",
      parsed.error.issues.map((issue) => issue.path.join(".")),
    );
  }
  return parsed.data;
}

const questionJsonSchema = {
  type: "object",
  properties: {
    topic: { type: "string", enum: topicIds },
    skill: { type: "string" },
    type: {
      type: "string",
      enum: ["concept", "calculation", "interpretation"],
    },
    prompt: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    correctIndex: { type: "integer" },
    explanation: { type: "string" },
    misconception: { type: "string" },
  },
  required: [
    "topic",
    "skill",
    "type",
    "prompt",
    "options",
    "correctIndex",
    "explanation",
    "misconception",
  ],
  additionalProperties: false,
} as const;

const analysisJsonSchema = {
  type: "object",
  properties: {
    title: { type: "string" },
    focus: { type: "string" },
    summary: { type: "string" },
    language: { type: "string" },
    objectives: { type: "array", items: { type: "string" } },
    topics: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string", enum: topicIds },
          label: { type: "string" },
          prerequisites: { type: "array", items: { type: "string" } },
        },
        required: ["id", "label", "prerequisites"],
        additionalProperties: false,
      },
    },
    questions: { type: "array", items: questionJsonSchema },
  },
  required: [
    "title",
    "focus",
    "summary",
    "language",
    "objectives",
    "topics",
    "questions",
  ],
  additionalProperties: false,
} as const;

export const courseAnalysisJsonSchema = {
  anyOf: [
    analysisJsonSchema,
    {
      type: "object",
      properties: { error: { const: "NOT_PHYSICS" } },
      required: ["error"],
      additionalProperties: false,
    },
  ],
} as const;

export function supportsStructuredCourseOutput(model: string) {
  return model.includes("anthropic.claude-opus-4-6");
}

export function courseOutputConfig(model: string) {
  if (!supportsStructuredCourseOutput(model)) return undefined;
  return {
    textFormat: {
      type: "json_schema",
      structure: {
        jsonSchema: {
          schema: JSON.stringify(courseAnalysisJsonSchema),
          name: "physics_course_analysis",
          description:
            "A physics course map and exactly five original diagnostic questions, or a not-physics result.",
        },
      },
    },
  } as const;
}

