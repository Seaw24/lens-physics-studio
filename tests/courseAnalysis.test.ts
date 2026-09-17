import test from "node:test";
import assert from "node:assert/strict";
import {
  CourseModelOutputError,
  NotPhysicsCourseError,
  classifyCourseError,
  courseOutputConfig,
  parseCourseAnalysisText,
  safeCourseErrorDetails,
} from "../server/courseAnalysis";

function validAnalysis() {
  return {
    title: "Galilean transformations",
    focus: "Reference frames and classical velocity addition",
    summary:
      "The unit connects coordinates, velocity, acceleration, and Newton's laws across inertial reference frames.",
    language: "en",
    objectives: [
      "Transform a position between inertial frames",
      "Explain why acceleration is invariant classically",
    ],
    topics: [
      {
        id: "kinematics",
        label: "Galilean transformations",
        prerequisites: ["Velocity", "Basic algebra"],
      },
    ],
    questions: Array.from({ length: 5 }, (_, index) => ({
      topic: "kinematics",
      skill: `Reference-frame reasoning ${index + 1}`,
      type: index % 2 ? "concept" : "calculation",
      prompt: `Which statement correctly describes test situation ${index + 1}?`,
      options: ["Option A", "Option B", "Option C", "Option D"],
      correctIndex: index % 4,
      explanation: "The coordinate transformation determines the measured value.",
      misconception: "Changing reference frames does not erase the physical event.",
    })),
  };
}

test("course analysis accepts structured JSON and a fenced fallback", () => {
  const analysis = validAnalysis();
  assert.equal(
    parseCourseAnalysisText(JSON.stringify(analysis)).questions.length,
    5,
  );
  assert.equal(
    parseCourseAnalysisText(`Result:\n\`\`\`json\n${JSON.stringify(analysis)}\n\`\`\``)
      .title,
    analysis.title,
  );
});

test("course analysis turns malformed model output into a typed error", () => {
  const invalid = validAnalysis();
  invalid.questions = invalid.questions.slice(0, 4);
  assert.throws(
    () => parseCourseAnalysisText(JSON.stringify(invalid)),
    (error: unknown) =>
      error instanceof CourseModelOutputError &&
      error.issuePaths.includes("questions"),
  );
  assert.throws(
    () => parseCourseAnalysisText("unfinished {"),
    CourseModelOutputError,
  );
});

test("not-physics output is distinct from a malformed response", () => {
  assert.throws(
    () => parseCourseAnalysisText('{"error":"NOT_PHYSICS"}'),
    NotPhysicsCourseError,
  );
});

test("Opus 4.6 uses Bedrock structured output while Nova keeps prompt JSON", () => {
  const opus = courseOutputConfig("us.anthropic.claude-opus-4-6-v1");
  assert.equal(opus?.textFormat.type, "json_schema");
  assert.match(
    opus?.textFormat.structure.jsonSchema.schema || "",
    /physics|questions|correctIndex/,
  );
  assert.equal(courseOutputConfig("amazon.nova-lite-v1:0"), undefined);
});

test("course failures distinguish PDF rendering from Bedrock networking", () => {
  const renderError = new Error("renderer failed");
  renderError.name = "PdfRenderError";
  assert.deepEqual(classifyCourseError(renderError), {
    status: 422,
    code: "PDF_RENDER_FAILED",
    message:
      "This PDF could not be rendered. Try exporting a fresh PDF without password protection.",
  });

  const dnsCause = Object.assign(new Error("lookup failed"), {
    code: "ENOTFOUND",
  });
  const networkError = new Error("The pending stream was canceled", {
    cause: dnsCause,
  });
  const classified = classifyCourseError(networkError);
  assert.equal(classified.status, 503);
  assert.equal(classified.code, "BEDROCK_NETWORK");
  assert.equal(safeCourseErrorDetails(networkError).causeCode, "ENOTFOUND");
});
