import test from "node:test";
import assert from "node:assert/strict";
import {
  analyzeCourseSources,
  buildDiagnostic,
  gradeDiagnostic,
  nextLessonFor,
  type CourseAnalysis,
  type CourseSource,
} from "../shared/diagnostic";

function source(content: string): CourseSource {
  return {
    id: "test-notes",
    name: "Test lecture notes",
    content,
    addedAt: "now",
  };
}

test("course mapping prioritizes the specific unit and preserves prerequisites", () => {
  const map = analyzeCourseSources([
    source(
      "Geometric optics: draw a ray diagram for a converging lens. Use focal length, image distance, refraction, and the thin lens equation. Review similar triangles and the sign convention.",
    ),
  ]);
  assert.equal(map.focus, "Geometric optics");
  assert.equal(map.topics[0].id, "optics");
  assert.ok(map.topics[0].prerequisites.includes("Similar triangles"));
  const diagnostic = buildDiagnostic(map);
  assert.equal(
    diagnostic.filter((question) => question.topic === "optics").length,
    2,
  );
  assert.equal(
    diagnostic.some((question) => question.topic === "projectile"),
    false,
  );
});

test("air resistance does not get misclassified as an electric circuit topic", () => {
  const map = analyzeCourseSources([
    source(
      "Projectile motion ignores air resistance. At the apex, vertical velocity is zero while gravity produces downward acceleration.",
    ),
  ]);
  assert.equal(map.topics[0].id, "projectile");
  assert.equal(
    map.topics.some((topic) => topic.id === "circuits"),
    false,
  );
});

test("diagnostic selection and grading produce a targeted next lesson", () => {
  const map = analyzeCourseSources([
    source(
      "Projectile launch and apex. Resolve the velocity vector into horizontal and vertical components using sine and cosine.",
    ),
  ]);
  const questions = buildDiagnostic(map);
  assert.equal(questions.length, 5);
  assert.equal(questions[0].topic, "projectile");

  const answers = Object.fromEntries(
    questions.map((question) => [question.id, question.correctIndex]),
  );
  const vectorQuestions = questions.filter(
    (question) => question.topic === "vectors",
  );
  assert.ok(vectorQuestions.length > 0);
  for (const vectorQuestion of vectorQuestions)
    answers[vectorQuestion.id] =
      (vectorQuestion.correctIndex + 1) % vectorQuestion.options.length;

  const results = gradeDiagnostic(questions, answers);
  const vectors = results.find((result) => result.topic === "vectors");
  assert.equal(vectors?.status, "review");
  assert.match(vectors?.note || "", /Sine|component/i);
  assert.equal(nextLessonFor(results).topic, "vectors");
});

test("validated Bedrock analysis overrides local keyword mapping and supplies its questions", () => {
  const fallbackMap = analyzeCourseSources([
    source(
      "Projectile motion, launch angle, velocity, acceleration, and apex.",
    ),
  ]);
  const preparedQuestions = buildDiagnostic(fallbackMap);
  const analysis: CourseAnalysis = {
    title: "Instructor optics notes",
    map: {
      focus: "Thin lenses and ray diagrams",
      summary:
        "The course is currently using principal rays and the thin-lens equation to predict image formation.",
      language: "English",
      topics: [
        {
          id: "optics",
          label: "Geometric optics",
          evidenceCount: 1,
          prerequisites: ["Similar triangles", "Reciprocal equations"],
        },
      ],
    },
    objectives: ["Trace principal rays", "Apply the thin-lens equation"],
    questions: preparedQuestions,
    provider: "bedrock",
  };
  const pdfSource: CourseSource = {
    ...source("This summary contains no optics keywords."),
    kind: "pdf",
    fileSize: 1024,
    analysis,
  };
  const mapped = analyzeCourseSources([pdfSource]);
  assert.equal(mapped.focus, "Thin lenses and ray diagrams");
  assert.deepEqual(
    buildDiagnostic(mapped, 5, analysis.questions).map(({ id }) => id),
    preparedQuestions.map(({ id }) => id),
  );
});
