import {
  ArrowLeft,
  ArrowRight,
  BookOpenCheck,
  BrainCircuit,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  FileText,
  Gauge,
  LoaderCircle,
  RotateCcw,
  Route,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  analyzeCourseSources,
  buildDiagnostic,
  gradeDiagnostic,
  nextLessonFor,
  type CourseSource,
  type SkillResult,
} from "../shared/diagnostic";
import { analyzeCoursePdf } from "./api";
import CourseRemediation from "./CourseRemediation";
import type { LearningRecord } from "../shared/physics";

type Phase = "map" | "quiz" | "results" | "remediate";

const sourcesKey = "lens-course-sources-v1";
const diagnosticKey = "lens-course-diagnostic-v1";

function readSources() {
  try {
    const value = JSON.parse(localStorage.getItem(sourcesKey) || "[]");
    if (!Array.isArray(value)) return [];
    return value.filter(
      (source): source is CourseSource =>
        source &&
        !source.sample &&
        typeof source.id === "string" &&
        typeof source.name === "string" &&
        typeof source.content === "string" &&
        typeof source.addedAt === "string",
    );
  } catch {
    return [];
  }
}

function sourceSignature(sources: CourseSource[]) {
  return sources
    .map((source) => `${source.id}:${source.content.length}`)
    .join("|");
}

function statusLabel(status: SkillResult["status"]) {
  if (status === "strong") return "Strong evidence";
  if (status === "developing") return "Developing";
  return "Review first";
}

export default function CourseDiagnostic({
  bedrockAvailable,
  onOpenSettings,
  onSave,
  onOpenNotebook,
}: {
  bedrockAvailable: boolean;
  onOpenSettings: () => void;
  onSave: (record: LearningRecord) => void;
  onOpenNotebook: () => void;
}) {
  const [sources, setSources] = useState<CourseSource[]>(readSources);
  const [phase, setPhase] = useState<Phase>("map");
  const [showMaterials, setShowMaterials] = useState(false);
  const [materialError, setMaterialError] = useState("");
  const [pdfStage, setPdfStage] = useState<"idle" | "reading" | "analyzing">(
    "idle",
  );
  const [draggingPdf, setDraggingPdf] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const pdfAnalysis = useRef<AbortController | null>(null);
  const courseMap = useMemo(() => analyzeCourseSources(sources), [sources]);
  const aiAnalysis = useMemo(
    () => [...sources].reverse().find((source) => source.analysis)?.analysis,
    [sources],
  );
  const questions = useMemo(
    () => buildDiagnostic(courseMap, 5, aiAnalysis?.questions),
    [aiAnalysis, courseMap],
  );
  const results = useMemo(
    () => gradeDiagnostic(questions, answers),
    [answers, questions],
  );
  const nextLesson = useMemo(() => nextLessonFor(results), [results]);
  const pdfEvidence = useMemo(
    () =>
      courseMap.topics
        .flatMap((topic) =>
          (topic.evidence || []).map((evidence) => ({
            ...evidence,
            topic: topic.label,
          })),
        )
        .slice(0, 2),
    [courseMap.topics],
  );
  const signature = sourceSignature(sources);

  useEffect(() => {
    try {
      localStorage.setItem(sourcesKey, JSON.stringify(sources));
    } catch {
      // The feature remains usable for the current session when storage is unavailable.
    }
  }, [sources]);

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(diagnosticKey) || "null");
      if (
        saved?.signature === signature &&
        saved.answers &&
        questions.every((question) =>
          Number.isInteger(saved.answers[question.id]),
        )
      ) {
        setAnswers(saved.answers);
        setPhase("results");
        setConfirmed(true);
      }
    } catch {
      // A malformed or unavailable local result should simply start a new check.
    }
  }, []); // Restore only on mount; changing material intentionally resets the check.

  useEffect(
    () => () => {
      pdfAnalysis.current?.abort();
    },
    [],
  );

  function replaceSources(next: CourseSource[]) {
    setSources(next);
    setAnswers({});
    setQuestionIndex(0);
    setPhase("map");
    setConfirmed(false);
    try {
      localStorage.removeItem(diagnosticKey);
    } catch {
      // Ignore unavailable storage.
    }
  }

  async function addPdf(file?: File) {
    if (!file) return;
    setMaterialError("");
    if (!bedrockAvailable) {
      setMaterialError(
        "Connect Amazon Bedrock in Studio settings before analyzing a PDF.",
      );
      return;
    }
    if (
      file.size > 15 * 1024 * 1024 ||
      (!file.type.includes("pdf") && !/\.pdf$/i.test(file.name))
    ) {
      setMaterialError("Choose one PDF no larger than 15 MB.");
      return;
    }
    pdfAnalysis.current?.abort();
    const controller = new AbortController();
    pdfAnalysis.current = controller;
    try {
      setPdfStage("reading");
      const bytes = new Uint8Array(await file.arrayBuffer());
      let binary = "";
      for (let offset = 0; offset < bytes.length; offset += 32768)
        binary += String.fromCharCode(
          ...bytes.subarray(offset, offset + 32768),
        );
      setPdfStage("analyzing");
      const result = await analyzeCoursePdf(btoa(binary), controller.signal);
      replaceSources([
        {
          id: `pdf-${Date.now()}`,
          name: file.name,
          content: result.analysis.map.summary,
          addedAt: new Date().toISOString(),
          kind: "pdf",
          fileSize: file.size,
          analysis: result.analysis,
        },
      ]);
      setShowMaterials(false);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setMaterialError(
          error instanceof Error
            ? error.message
            : "The PDF analysis could not finish. Please try again.",
        );
    } finally {
      setPdfStage("idle");
      if (pdfAnalysis.current === controller) pdfAnalysis.current = null;
    }
  }

  function pdfFileFromList(files?: FileList | null) {
    return files?.[0];
  }

  function startDiagnostic() {
    setConfirmed(true);
    setAnswers({});
    setQuestionIndex(0);
    setPhase("quiz");
  }

  function finishDiagnostic() {
    setPhase("results");
    try {
      localStorage.setItem(
        diagnosticKey,
        JSON.stringify({ signature, answers, completedAt: new Date() }),
      );
    } catch {
      // Keep the result in memory when storage is unavailable.
    }
  }

  if (phase === "remediate") {
    return (
      <CourseRemediation
        focus={courseMap.focus}
        summary={courseMap.summary}
        title={nextLesson.title}
        questions={questions}
        answers={answers}
        bedrockAvailable={bedrockAvailable}
        onOpenSettings={onOpenSettings}
        onBack={() => setPhase("results")}
        onSave={onSave}
        onOpenNotebook={onOpenNotebook}
      />
    );
  }

  if (phase === "quiz") {
    const question = questions[questionIndex];
    const selected = answers[question.id];
    return (
      <section className="diagnostic-shell diagnostic-quiz" aria-live="polite">
        <div className="diagnostic-topline">
          <button className="text-button" onClick={() => setPhase("map")}>
            <ArrowLeft size={14} /> Course map
          </button>
          <span>
            Question {questionIndex + 1} of {questions.length}
          </span>
          <span>
            {aiAnalysis ? "AI-generated from your PDF" : "About 7 minutes"}
          </span>
        </div>
        <div className="diagnostic-progress" aria-hidden="true">
          {questions.map((item, index) => (
            <span
              key={item.id}
              className={
                index < questionIndex || answers[item.id] !== undefined
                  ? "complete"
                  : index === questionIndex
                    ? "current"
                    : ""
              }
            />
          ))}
        </div>
        <div className="diagnostic-question">
          <div className="question-meta">
            <span>{question.type}</span>
            <span>{question.skill}</span>
          </div>
          <h2>{question.prompt}</h2>
          <div className="diagnostic-options" role="radiogroup">
            {question.options.map((option, index) => (
              <button
                key={option}
                role="radio"
                aria-checked={selected === index}
                className={selected === index ? "selected" : ""}
                onClick={() =>
                  setAnswers((current) => ({
                    ...current,
                    [question.id]: index,
                  }))
                }
              >
                <span>{String.fromCharCode(65 + index)}</span>
                <strong>{option}</strong>
                {selected === index && <Check size={17} />}
              </button>
            ))}
          </div>
          <p className="diagnostic-no-feedback">
            Choose your best answer. Explanations appear after the check so this
            result reflects your starting point.
          </p>
        </div>
        <div className="diagnostic-actions">
          <button
            className="button secondary"
            disabled={questionIndex === 0}
            onClick={() => setQuestionIndex((index) => index - 1)}
          >
            <ArrowLeft size={15} /> Previous
          </button>
          {questionIndex === questions.length - 1 ? (
            <button
              className="button primary"
              disabled={selected === undefined}
              onClick={finishDiagnostic}
            >
              See my learning route <Route size={16} />
            </button>
          ) : (
            <button
              className="button primary"
              disabled={selected === undefined}
              onClick={() => setQuestionIndex((index) => index + 1)}
            >
              Next question <ArrowRight size={15} />
            </button>
          )}
        </div>
      </section>
    );
  }

  if (phase === "results") {
    const correct = questions.filter(
      (question) => answers[question.id] === question.correctIndex,
    ).length;
    return (
      <section className="diagnostic-shell diagnostic-results">
        <div className="results-heading">
          <div
            className="results-score"
            aria-label={`${correct} of ${questions.length} correct`}
          >
            <strong>{correct}</strong>
            <span>/ {questions.length}</span>
          </div>
          <div>
            <div className="eyebrow">YOUR STARTING POINT</div>
            <h2>A route built around what you need next.</h2>
            <p>
              Based on one short check — not a permanent mastery score.
            </p>
          </div>
          <div className="results-heading-actions">
            <button className="text-button" onClick={() => setPhase("map")}>
              <ArrowLeft size={14} /> Course map
            </button>
            <button className="text-button" onClick={startDiagnostic}>
              <RotateCcw size={14} /> Retake
            </button>
          </div>
        </div>
        <div className="results-grid">
          <div className="skill-results">
            <div className="diagnostic-section-title">
              <div>
                <Gauge size={18} />
                <h3>Skill signals</h3>
              </div>
              <span>From this check</span>
            </div>
            <div className="skill-result-grid">
              {results.map((result) => (
                <article
                  className={`skill-result ${result.status}`}
                  key={result.topic}
                >
                  <span className="skill-status-icon">
                    {result.status === "strong" ? (
                      <CheckCircle2 size={18} />
                    ) : result.status === "developing" ? (
                      <Target size={18} />
                    ) : (
                      <CircleAlert size={18} />
                    )}
                  </span>
                  <div>
                    <div>
                      <strong>{result.label}</strong>
                      <span>{statusLabel(result.status)}</span>
                    </div>
                    <p>{result.note}</p>
                  </div>
                  <small>
                    {result.correct}/{result.total}
                  </small>
                </article>
              ))}
            </div>
          </div>
          <aside className="next-lesson-card">
            <div className="eyebrow">NEXT · COACHING SESSION</div>
            <span className="route-icon">
              <Route size={21} />
            </span>
            <h3>{nextLesson.title}</h3>
            <p>
              A tutor will work the mix-up with you. A new-situation check
              decides whether it transferred — not “I understand.”
            </p>
            <ol>
              {nextLesson.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <button className="button pale" onClick={() => setPhase("remediate")}>
              Start my next lesson <ArrowRight size={15} />
            </button>
          </aside>
        </div>
        <details className="answer-review">
          <summary>Review answers and explanations</summary>
          <div>
            {questions.map((question, index) => {
              const isCorrect = answers[question.id] === question.correctIndex;
              return (
                <article key={question.id}>
                  <span className={isCorrect ? "correct" : "incorrect"}>
                    {isCorrect ? (
                      <Check size={14} />
                    ) : (
                      <CircleAlert size={14} />
                    )}
                  </span>
                  <div>
                    <strong>
                      {index + 1}. {question.skill}
                    </strong>
                    <p>{question.explanation}</p>
                    {!isCorrect && (
                      <small>
                        Your answer: {question.options[answers[question.id]]}.
                        Correct answer:{" "}
                        {question.options[question.correctIndex]}.
                      </small>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </details>
      </section>
    );
  }

  const showingUpload = showMaterials || !sources.length;

  return (
    <section
      className={`diagnostic-shell${showingUpload ? " diagnostic-upload" : ""}`}
    >
      <div className="diagnostic-header">
        <div className="diagnostic-title-icon">
          <BrainCircuit size={24} />
        </div>
        <div>
          <div className="eyebrow">STEP 1 OF 3</div>
          <h2>{sources.length ? "Here’s what we found." : "Add your course PDF."}</h2>
          <p>
            {sources.length
              ? "Confirm your current unit, then start a short skills check."
              : "Momentum uses your PDF to create a focused starting point."}
          </p>
        </div>
        {sources.length > 0 && (
          <button
            className="button secondary"
            onClick={() => setShowMaterials((visible) => !visible)}
          >
            {showMaterials ? <ArrowLeft size={15} /> : <Upload size={15} />}
            {showMaterials ? "Back to my course" : "Replace course PDF"}
          </button>
        )}
      </div>

      {showingUpload ? (
        <div className="materials-workspace">
          <div
            className={`material-upload-card${draggingPdf ? " is-dragging" : ""}`}
            onDragEnter={(event) => {
              event.preventDefault();
              if (bedrockAvailable && pdfStage === "idle") setDraggingPdf(true);
            }}
            onDragOver={(event) => {
              event.preventDefault();
              if (bedrockAvailable && pdfStage === "idle") setDraggingPdf(true);
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node))
                setDraggingPdf(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDraggingPdf(false);
              void addPdf(pdfFileFromList(event.dataTransfer.files));
            }}
          >
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept=".pdf,application/pdf"
              disabled={!bedrockAvailable || pdfStage !== "idle"}
              onChange={(event) => {
                void addPdf(pdfFileFromList(event.target.files));
                event.target.value = "";
              }}
            />
            {pdfStage !== "idle" ? (
              <div className="pdf-analysis-progress" role="status">
                <span className="material-upload-icon">
                  <LoaderCircle size={28} className="spin" />
                </span>
                <strong>
                  {pdfStage === "reading"
                    ? "Preparing your PDF…"
                    : "Bedrock is mapping your course…"}
                </strong>
                <span>
                  {pdfStage === "reading"
                    ? "The file is still on this device"
                    : "Reading text, diagrams, topics, and prerequisites"}
                </span>
                <button
                  className="text-button"
                  onClick={() => pdfAnalysis.current?.abort()}
                >
                  Cancel
                </button>
              </div>
            ) : bedrockAvailable ? (
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
              >
                <span className="material-upload-icon">
                  <Upload size={28} />
                </span>
                <strong>Analyze a course PDF</strong>
                <span>Drag and drop, or click to browse · one PDF · up to 15 MB</span>
              </button>
            ) : (
              <button type="button" onClick={onOpenSettings}>
                <span className="material-upload-icon">
                  <Sparkles size={28} />
                </span>
                <strong>Upload your notes to get started</strong>
                <span>Open Studio settings to connect the AI model</span>
              </button>
            )}
            <div className="material-privacy">
              <ShieldCheck size={16} />
              <span>
                PDF bytes are sent through the local server to Amazon Bedrock,
                then discarded. Only the course map and diagnostic are stored in
                this browser.
              </span>
            </div>
          </div>
          {materialError && (
            <p className="inline-error materials-error" role="alert">
              {materialError}
            </p>
          )}
        </div>
      ) : (
        <div className="course-map-grid">
          <div className="course-map-card">
            <div className="diagnostic-section-title">
              <div>
                <BookOpenCheck size={18} />
                <h3>Your current unit</h3>
              </div>
              <span>
                {sources.length} source{sources.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="course-analysis-card">
              <span className="analysis-label">Focus for this check</span>
              <h4>{courseMap.focus}</h4>
              <p>{courseMap.summary}</p>
              <div className="course-topic-summary">
                <span>Key ideas</span>
                <div>
                  {courseMap.topics.slice(0, 3).map((topic) => (
                    <span key={topic.id}>{topic.label}</span>
                  ))}
                </div>
              </div>
              {pdfEvidence.length > 0 && (
                <details className="pdf-evidence">
                  <summary>
                    <span>Why Momentum mapped this</span>
                    <small>
                      {pdfEvidence.length} PDF reference
                      {pdfEvidence.length === 1 ? "" : "s"}
                    </small>
                    <ChevronRight size={13} />
                  </summary>
                  <div>
                    {pdfEvidence.map((evidence) => (
                      <article
                        key={`${evidence.topic}-${evidence.page}-${evidence.excerpt}`}
                      >
                        <div>
                          <strong>{evidence.topic}</strong>
                          <small>Page {evidence.page}</small>
                        </div>
                        <p>{evidence.excerpt}</p>
                      </article>
                    ))}
                  </div>
                </details>
              )}
            </div>
          </div>
          <aside className="diagnostic-start-card">
            <div className="eyebrow">YOUR NEXT STEP</div>
            <h3>Find your best place to begin.</h3>
            <p>
              Five questions from this unit give Momentum the signal it needs to
              guide your first lesson.
            </p>
            <button className="button pale" onClick={startDiagnostic}>
              Start my 5-question check <ArrowRight size={15} />
            </button>
            <small>
              {confirmed
                ? "Course context confirmed"
                : "Not your unit? Change the PDF before you begin."}
            </small>
          </aside>
          <div className="material-list">
            <details>
              <summary>
                <FileText size={15} /> {sources.length} course source
                {sources.length === 1 ? "" : "s"} connected
                <ChevronRight size={13} />
              </summary>
              {sources.map((source) => (
                <div key={source.id}>
                  <span className="file-icon">
                    <FileText size={15} />
                  </span>
                  <div>
                    <strong>{source.name}</strong>
                    <small>
                      {`${((source.fileSize || 0) / 1024 / 1024).toFixed(1)} MB · analyzed with Bedrock · PDF not stored`}
                    </small>
                  </div>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${source.name}`}
                    onClick={() =>
                      replaceSources(
                        sources.filter((item) => item.id !== source.id),
                      )
                    }
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              ))}
            </details>
          </div>
        </div>
      )}
    </section>
  );
}
