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

const pdfEvidenceSchema = z.object({
  page: z.number().int().min(1).max(10),
  excerpt: z.string().trim().min(8).max(220),
});

export const aiCourseSchema = z.object({
  title: z.string().trim().min(3).max(120),
  focus: z.string().trim().min(3).max(120),
  summary: z.string().trim().min(20).max(700),
  language: z.string().trim().min(2).max(80),
  objectives: z.array(z.string().trim().min(8).max(400)).min(2).max(6),
  topics: z
    .array(
      z.object({
        id: physicsTopicSchema,
        label: z.string().trim().min(3).max(100),
        prerequisites: z.array(z.string().trim().min(2).max(200)).min(1).max(4),
        evidence: z.array(pdfEvidenceSchema).min(1).max(2),
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

export function validateEvidencePageReferences(
  analysis: AiCourseAnalysis,
  pageCount: number,
) {
  const issuePaths = analysis.topics.flatMap((topic, topicIndex) =>
    topic.evidence.flatMap((evidence, evidenceIndex) =>
      evidence.page <= pageCount
        ? []
        : [`topics.${topicIndex}.evidence.${evidenceIndex}.page`],
    ),
  );
  if (issuePaths.length)
    throw new CourseModelOutputError(
      "The model cited a page outside this PDF.",
      issuePaths,
    );
  return analysis;
}

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

type ErrorLike = Error & {
  code?: string;
  killed?: boolean;
  signal?: string;
  cause?: unknown;
  $metadata?: { requestId?: string };
};

function errorLike(value: unknown): ErrorLike | undefined {
  return value instanceof Error ? (value as ErrorLike) : undefined;
}

export function safeCourseErrorDetails(error: unknown) {
  const outer = errorLike(error);
  const cause = errorLike(outer?.cause);
  return {
    name: outer?.name || "UnknownError",
    message: (outer?.message || "Unknown failure").slice(0, 240),
    code: outer?.code,
    causeCode: cause?.code,
    killed: outer?.killed,
    signal: outer?.signal,
    requestId: outer?.$metadata?.requestId,
    issuePaths:
      error instanceof CourseModelOutputError ? error.issuePaths : [],
  };
}

export function classifyCourseError(error: unknown) {
  const details = safeCourseErrorDetails(error);
  const codeText = `${details.code || ""} ${details.causeCode || ""} ${details.message}`;
  if (/PdfTooManyPages/.test(details.name))
    return {
      status: 422,
      code: "PDF_TOO_MANY_PAGES",
      message: "Choose a PDF with 10 pages or fewer for this model.",
    };
  if (/PdfTooLarge/.test(details.name))
    return {
      status: 422,
      code: "PDF_RENDER_TOO_LARGE",
      message:
        "This PDF is too detailed to prepare for the selected model. Try a shorter or lower-resolution file.",
    };
  if (/PdfRender/.test(details.name))
    return {
      status: 422,
      code: "PDF_RENDER_FAILED",
      message:
        "This PDF could not be rendered. Try exporting a fresh PDF without password protection.",
    };
  if (error instanceof CourseModelOutputError)
    return {
      status: 502,
      code: "MODEL_OUTPUT_INVALID",
      message:
        "Bedrock returned an incomplete course map. Please try the PDF once more.",
    };
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ENETUNREACH/.test(codeText))
    return {
      status: 503,
      code: "BEDROCK_NETWORK",
      message:
        "The local server could not reach Amazon Bedrock. Check the network or DNS connection, then try again.",
    };
  if (/Timeout|Abort|ETIMEDOUT/.test(`${details.name} ${codeText}`))
    return {
      status: 504,
      code: "BEDROCK_TIMEOUT",
      message:
        "Bedrock took too long to analyze this PDF. Please try again shortly.",
    };
  if (/Throttl/.test(details.name))
    return {
      status: 503,
      code: "BEDROCK_BUSY",
      message: "Bedrock is busy. Please try again shortly.",
    };
  if (/AccessDenied|Unrecognized|Expired|Credentials|Unauthorized/.test(details.name))
    return {
      status: 503,
      code: "BEDROCK_AUTH",
      message:
        "AWS access is unavailable or has expired. Refresh the workshop credentials, then restart the server.",
    };
  if (/Validation|ResourceNotFound/.test(details.name))
    return {
      status: 502,
      code: "BEDROCK_MODEL",
      message:
        "This model is not available with the current account or region. Check BEDROCK_MODEL_ID.",
    };
  return {
    status: 502,
    code: "BEDROCK_ERROR",
    message: "The AI request could not finish. Please try again.",
  };
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
          evidence: {
            type: "array",
            items: {
              type: "object",
              properties: {
                // Bedrock structured output accepts the integer type but not
                // JSON Schema numeric bounds. The server validates the page
                // range against the uploaded PDF after the response arrives.
                page: { type: "integer" },
                excerpt: { type: "string" },
              },
              required: ["page", "excerpt"],
              additionalProperties: false,
            },
          },
        },
        required: ["id", "label", "prerequisites", "evidence"],
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
  return /anthropic\.claude-(opus|sonnet)-4-6/.test(model);
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
