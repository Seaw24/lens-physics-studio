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
import { COURSE } from "../shared/physics";
import {
  analyzeCourseSources,
  buildDiagnostic,
  gradeDiagnostic,
  nextLessonFor,
  type CourseSource,
  type SkillResult,
} from "../shared/diagnostic";
import { analyzeCoursePdf } from "./api";

type Phase = "map" | "quiz" | "results";

const sourcesKey = "lens-course-sources-v1";
const diagnosticKey = "lens-course-diagnostic-v1";

const sampleSource: CourseSource = {
  id: "sample-projectile-notes",
  name: "Week 04 · Projectile motion notes",
  content: [
    COURSE.description,
    ...COURSE.objectives,
    ...COURSE.notes.map((note) => `${note.title}. ${note.body}`),
  ].join("\n"),
  addedAt: "Sample course",
  sample: true,
};

function readSources() {
  try {
    const value = JSON.parse(localStorage.getItem(sourcesKey) || "[]");
    if (!Array.isArray(value) || !value.length) return [sampleSource];
    return value.filter(
      (source): source is CourseSource =>
        source &&
        typeof source.id === "string" &&
        typeof source.name === "string" &&
        typeof source.content === "string" &&
        typeof source.addedAt === "string",
    );
  } catch {
    return [sampleSource];
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
  onStartLesson,
  bedrockAvailable,
  onOpenSettings,
}: {
  onStartLesson: () => void;
  bedrockAvailable: boolean;
  onOpenSettings: () => void;
}) {
  const [sources, setSources] = useState<CourseSource[]>(readSources);
  const [phase, setPhase] = useState<Phase>("map");
  const [showMaterials, setShowMaterials] = useState(false);
  const [draft, setDraft] = useState("");
  const [materialName, setMaterialName] = useState("My lecture notes");
  const [materialError, setMaterialError] = useState("");
  const [pdfStage, setPdfStage] = useState<"idle" | "reading" | "analyzing">(
    "idle",
  );
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
    setSources(next.length ? next : [sampleSource]);
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

  function appendSources(next: CourseSource[]) {
    const withoutSample = sources.every((source) => source.sample)
      ? []
      : sources;
    replaceSources([...withoutSample, ...next].slice(-8));
    setShowMaterials(false);
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
      appendSources([
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

  function addDraft() {
    const content = draft.trim();
    if (content.length < 80) {
      setMaterialError(
        "Paste at least a short paragraph so Lens has enough course language to map.",
      );
      return;
    }
    appendSources([
      {
        id: `pasted-${Date.now()}`,
        name: materialName.trim() || "Pasted lecture notes",
        content: content.slice(0, 120000),
        addedAt: new Date().toISOString(),
      },
    ]);
    setDraft("");
    setMaterialName("My lecture notes");
    setMaterialError("");
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
              This is evidence from one short check—not a permanent mastery
              label. Lens will update the route as you practice and explain.
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
          <aside className="next-lesson-card">
            <div className="eyebrow">RECOMMENDED NEXT · 12 MIN</div>
            <span className="route-icon">
              <Route size={21} />
            </span>
            <h3>{nextLesson.title}</h3>
            <p>{nextLesson.why}</p>
            <ol>
              {nextLesson.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <button className="button pale" onClick={onStartLesson}>
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

  return (
    <section className="diagnostic-shell">
      <div className="diagnostic-header">
        <div className="diagnostic-title-icon">
          <BrainCircuit size={24} />
        </div>
        <div>
          <div className="eyebrow">DIAGNOSE BEFORE TEACHING</div>
          <h2>Your course sets the starting line.</h2>
          <p>
            Lens maps the ideas and prerequisites in your material, then checks
            the few skills that matter for your next lesson.
          </p>
        </div>
        <button
          className="button secondary"
          onClick={() => setShowMaterials((visible) => !visible)}
        >
          {showMaterials ? <ArrowLeft size={15} /> : <Upload size={15} />}
          {showMaterials ? "Back to course map" : "Add course material"}
        </button>
      </div>

      {showMaterials ? (
        <div className="materials-workspace">
          <div className="material-upload-card">
            <input
              ref={fileInput}
              className="sr-only"
              type="file"
              accept=".pdf,application/pdf"
              disabled={!bedrockAvailable || pdfStage !== "idle"}
              onChange={(event) => {
                void addPdf(event.target.files?.[0]);
                event.target.value = "";
              }}
            />
            {pdfStage !== "idle" ? (
              <div className="pdf-analysis-progress" role="status">
                <LoaderCircle size={25} className="spin" />
                <strong>
                  {pdfStage === "reading"
                    ? "Preparing your PDF…"
                    : "Bedrock is mapping your course…"}
                </strong>
                <span>
                  {pdfStage === "reading"
                    ? "The file is still on this device"
                    : "Reading pages, topics, and prerequisites — the first run can take a minute"}
                </span>
                <button
                  className="text-button"
                  onClick={() => pdfAnalysis.current?.abort()}
                >
                  Cancel
                </button>
              </div>
            ) : bedrockAvailable ? (
              <button onClick={() => fileInput.current?.click()}>
                <Upload size={24} />
                <strong>Analyze a course PDF</strong>
                <span>PDF · one file · up to 15 MB · 10 pages with Claude</span>
              </button>
            ) : (
              <button onClick={onOpenSettings}>
                <Sparkles size={24} />
                <strong>Connect Bedrock for PDF analysis</strong>
                <span>Open Studio settings to connect the AI model</span>
              </button>
            )}
            <div className="material-privacy">
              <ShieldCheck size={16} />
              <span>
                The local server sends the PDF or in-memory rendered pages to
                Amazon Bedrock, then discards them. Only the course map and
                diagnostic are stored in this browser.
              </span>
            </div>
          </div>
          <div className="material-paste-card">
            <label htmlFor="material-name">Material name</label>
            <input
              id="material-name"
              value={materialName}
              maxLength={70}
              onChange={(event) => setMaterialName(event.target.value)}
            />
            <label htmlFor="material-text">
              Or paste notes, a syllabus, or study guide
            </label>
            <textarea
              id="material-text"
              value={draft}
              rows={6}
              placeholder="Paste the section your class is working on…"
              onChange={(event) => setDraft(event.target.value)}
            />
            <div>
              <small>{draft.trim().length.toLocaleString()} characters</small>
              <button className="button primary" onClick={addDraft}>
                Map this material <Sparkles size={15} />
              </button>
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
                <h3>Lens found in your material</h3>
              </div>
              <span>
                {sources.length} source{sources.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="course-focus">
              <span>
                {aiAnalysis
                  ? `BEDROCK COURSE MAP · ${aiAnalysis.title}`
                  : "Current focus"}
              </span>
              <strong>{courseMap.focus}</strong>
              <p>{courseMap.summary}</p>
            </div>
            <div className="detected-topics">
              {courseMap.topics.map((topic, index) => (
                <article key={topic.id}>
                  <span>0{index + 1}</span>
                  <div>
                    <strong>{topic.label}</strong>
                    <small>
                      Prerequisites: {topic.prerequisites.join(" · ")}
                    </small>
                  </div>
                  <em>
                    {aiAnalysis
                      ? "AI mapped"
                      : `${topic.evidenceCount} signals`}
                  </em>
                </article>
              ))}
            </div>
          </div>
          <aside className="diagnostic-start-card">
            <div className="eyebrow">READY FOR A QUICK CHECK</div>
            <span className="spark-orbit" aria-hidden="true">
              <Sparkles size={22} />
            </span>
            <h3>Five questions. A much better place to begin.</h3>
            <p>
              A mix of concepts, interpretation, and calculation—selected from
              the material at left.
            </p>
            <ul>
              <li>
                <Check size={13} /> About 7 minutes
              </li>
              <li>
                <Check size={13} /> No penalty for guessing
              </li>
              <li>
                <Check size={13} /> Skill-level next steps
              </li>
            </ul>
            <button className="button pale" onClick={startDiagnostic}>
              Confirm & start diagnostic <ArrowRight size={15} />
            </button>
            <small>
              {confirmed
                ? "Course context confirmed"
                : "Does this match your class? Add material to correct it."}
            </small>
          </aside>
          <div className="material-list">
            <div className="diagnostic-section-title">
              <div>
                <FileText size={17} />
                <h3>Course sources</h3>
              </div>
              <button
                className="text-button"
                onClick={() => setShowMaterials(true)}
              >
                Add another <ChevronRight size={13} />
              </button>
            </div>
            {sources.map((source) => (
              <div key={source.id}>
                <span className="file-icon">
                  <FileText size={15} />
                </span>
                <div>
                  <strong>{source.name}</strong>
                  <small>
                    {source.sample
                      ? "Prepared sample · replace with your notes"
                      : source.kind === "pdf"
                        ? `${((source.fileSize || 0) / 1024 / 1024).toFixed(1)} MB · analyzed with Bedrock · PDF not stored`
                        : `${source.content.length < 1000 ? source.content.length : `${(source.content.length / 1000).toFixed(1)}k`} characters · stored locally`}
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
          </div>
        </div>
      )}
    </section>
  );
}
