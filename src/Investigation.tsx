import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  BookOpen,
  Send,
  Lightbulb,
  RotateCcw,
  Bookmark,
  ArrowUpRight,
  LoaderCircle,
  Eye,
  FlaskConical,
} from "lucide-react";
import {
  assessAnswer,
  COURSE,
  type Moment,
  type LearningRecord,
  type Message,
  type GeneratedQuestion,
} from "../shared/physics";
import { askTutor } from "./api";
import Models, { type ModelState } from "./Models";
import VideoPlayer from "./VideoPlayer";
interface Props {
  moment: Moment;
  src: string;
  mode: "rehearsal" | "bedrock";
  onBack: () => void;
  onSave: (record: LearningRecord) => void;
  onCourse: () => void;
  onNext: () => void;
  onUpdate: (m: Moment) => void;
  alreadySaved: boolean;
}
export default function Investigation({
  moment,
  src,
  mode,
  onBack,
  onSave,
  onCourse,
  onNext,
  onUpdate,
  alreadySaved,
}: Props) {
  const [tab, setTab] = useState<"replay" | "model">("replay"),
    [phase, setPhase] = useState(0),
    [prediction, setPrediction] = useState(""),
    [answer, setAnswer] = useState(""),
    [feedback, setFeedback] = useState<{
      correct: boolean;
      feedback: string;
    } | null>(null),
    [reflection, setReflection] = useState(""),
    [explainChoice, setExplainChoice] = useState<string | null>(null),
    [saved, setSaved] = useState(false),
    [state, setState] = useState<ModelState>({
      force: 10,
      radius: 0.8,
      angle: moment.concept === "projectile" ? 52 : 90,
      speed: 9.5,
      height: 2,
    }),
    [hints, setHints] = useState(0),
    [messages, setMessages] = useState<(Message & { mode?: string })[]>([
      { role: "assistant", content: moment.question, mode: "Prepared prompt" },
    ]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [rate, setRate] = useState(1),
    [seek, setSeek] = useState({ time: moment.time, nonce: 0 });
  const abort = useRef<AbortController | null>(null),
    chat = useRef<HTMLDivElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    chat.current?.scrollTo({
      top: chat.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);
  const practice =
    moment.concept === "projectile"
      ? "At the highest point of an ideal basketball shot, which way does the net force point?"
      : moment.concept === "force"
        ? "A cart moves right and slows down. Which way is the net horizontal force?"
        : moment.concept === "torque"
          ? "A 10 N perpendicular push at 0.80 m produces 8 N·m. What force gives the same torque at 0.20 m?"
          : "A 20 N load is 0.40 m left of a pivot. What downward force at 0.80 m to the right balances it?";
  // AI-generated escalating question set for this specific detected moment
  // (predict -> ... -> transfer). Falls back to the hardcoded generic
  // content above when a moment hasn't been generated with this field yet.
  const genQuestions: GeneratedQuestion[] | null =
    moment.questions && moment.questions.length > 0 ? moment.questions : null;
  const predictQuestion = genQuestions ? genQuestions[0] : null;
  const explainQuestion = genQuestions
    ? genQuestions[genQuestions.length - 1]
    : null;
  const predictOptions = predictQuestion
    ? predictQuestion.options
    : moment.concept === "projectile"
      ? ["Downward", "Upward", "Zero net force"]
      : moment.concept === "force"
        ? ["Left", "Right", "Zero net force"]
        : moment.concept === "torque"
          ? ["More force", "Less force", "The same force"]
          : ["Yes, farther away", "No, forces must be equal", "I’m not sure yet"];
  const predictHeading = predictQuestion ? predictQuestion.prompt : moment.question;
  async function send(text: string, isHint = false) {
    if (!text.trim() || busy) return;
    const nextHints = isHint ? Math.min(8, hints + 1) : hints;
    if (isHint) setHints(nextHints);
    setBusy(true);
    setError("");
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await askTutor(
        {
          message: text,
          concept: moment.concept,
          hintLevel: nextHints,
          history: messages
            .slice(-10)
            .map(({ role, content }) => ({ role, content })),
          mode,
          observation: moment.observation,
          modelState: state,
        },
        controller.signal,
      );
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: response.reply,
          mode:
            response.mode === "bedrock" ? "Amazon Bedrock" : "Demo response",
        },
      ]);
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(
          e instanceof Error
            ? e.message
            : "Could not reach the tutor. Please retry.",
        );
    } finally {
      setBusy(false);
    }
  }
  function save() {
    const record: LearningRecord = {
      id: moment.id,
      momentId: moment.id,
      title: moment.shortTitle,
      concept: moment.concept,
      answer,
      reflection: reflection.trim(),
      completedAt: new Date().toISOString(),
      hints,
      mode,
    };
    onSave(record);
    setSaved(true);
  }
  return (
    <section className="investigation page-enter">
      <button className="text-button back-button" onClick={onBack}>
        <ArrowLeft size={16} /> Back to Today
      </button>
      <div className="investigation-heading">
        <div>
          <div className="eyebrow">
            {moment.context} <span className="eyebrow-dot">·</span>{" "}
            {moment.concept}
          </div>
          <h1>{moment.title}</h1>
        </div>
        <button className="button secondary compact-button" onClick={onCourse}>
          <BookOpen size={15} /> Course connection <ArrowUpRight size={14} />
        </button>
      </div>
      <div className="learning-path" aria-label="Learning steps">
        {["Make a prediction", "Test your thinking", "Make it yours"].map(
          (label, i) => (
            <div
              key={label}
              className={phase === i ? "current" : phase > i ? "complete" : ""}
            >
              <span>{phase > i ? <Check size={13} /> : `0${i + 1}`}</span>
              {label}
              {i < 2 && <ArrowRight size={15} />}
            </div>
          ),
        )}
      </div>
      <div className="investigation-grid">
        <div className="evidence-workspace">
          <div className="workspace-tabs">
            <div role="tablist" aria-label="Evidence and model">
              <button
                role="tab"
                aria-selected={tab === "replay"}
                onClick={() => setTab("replay")}
              >
                <Eye size={16} />
                The moment
              </button>
              <button
                role="tab"
                aria-selected={tab === "model"}
                onClick={() => setTab("model")}
              >
                <FlaskConical size={16} />
                Play with the physics
              </button>
            </div>
            <span className="quiet-label">
              {tab === "replay"
                ? moment.source === "curated"
                  ? "Your video · guided lesson"
                  : "Sampled evidence"
                : "Interactive model"}
            </span>
          </div>
          {tab === "replay" ? (
            <>
              <VideoPlayer
                compact
                src={src}
                moments={[moment]}
                seek={seek}
                annotations
                onAnchors={(anchors, time) => {
                  const trace =
                    time !== undefined && moment.trace?.length && anchors[0]
                      ? [
                          ...moment.trace.filter(
                            (p) => Math.abs(p.time - time) > 0.015,
                          ),
                          { time, x: anchors[0].x, y: anchors[0].y },
                        ].sort((a, b) => a.time - b.time)
                      : moment.trace;
                  onUpdate({ ...moment, anchors, trace });
                }}
                rate={rate}
                onRateChange={setRate}
              />
              <div className="observation-note">
                <span className="eyebrow">Observation</span>
                <p>{moment.observation}</p>
                <button
                  className="text-button"
                  onClick={() =>
                    setSeek({ time: moment.time, nonce: Date.now() })
                  }
                >
                  <RotateCcw size={13} /> Replay this moment
                </button>
              </div>
              <div className="evidence-ledger">
                {moment.evidence.map((e) => (
                  <div key={e.label}>
                    <span className={`evidence-dot ${e.kind}`} />
                    <div>
                      <small>
                        {e.kind === "practice"
                          ? "Practice value"
                          : e.kind === "assumed"
                            ? "Model assumption"
                            : "Observation"}
                      </small>
                      <strong>{e.value}</strong>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <Models
              concept={moment.concept}
              state={state}
              setState={setState}
            />
          )}
          <div className="learning-task">
            {saved ? (
              <div className="saved-state">
                <span className="success-seal">
                  <Check size={21} />
                </span>
                <div>
                  <h2>Saved to notebook</h2>
                  <p>
                    Your explanation is saved. Explore another moment whenever
                    you are ready.
                  </p>
                </div>
                <button className="button primary" onClick={onNext}>
                  Find another connection <ArrowRight size={15} />
                </button>
              </div>
            ) : phase === 0 ? (
              <>
                <div className="task-label">
                  <span>01 / PREDICT</span>
                  <small>No formula needed. Trust your first thought.</small>
                </div>
                <h2>{predictHeading}</h2>
                <div className="prediction-options">
                  {predictOptions.map((option) => (
                    <button
                      key={option}
                      aria-pressed={prediction === option}
                      className={prediction === option ? "chosen" : ""}
                      onClick={() => setPrediction(option)}
                    >
                      {option}
                      {prediction === option && <Check size={14} />}
                    </button>
                  ))}
                </div>
                <button
                  className="button primary"
                  disabled={!prediction}
                  onClick={() => {
                    setPhase(1);
                    setTab("model");
                    setMessages((prev) => [
                      ...prev,
                      {
                        role: "user",
                        content: `My prediction: ${prediction}.`,
                      },
                      {
                        role: "assistant",
                        content:
                          "Keep that prediction in mind. Change the controls and watch what your model predicts. Does it support your first thought?",
                        mode: "Prepared prompt",
                      },
                    ]);
                  }}
                >
                  Let’s test that <ArrowRight size={16} />
                </button>
              </>
            ) : phase === 1 ? (
              <>
                <div className="task-label">
                  <span>02 / EXPERIMENT</span>
                  <small>Your prediction: {prediction}</small>
                </div>
                <h2>
                  {moment.concept === "projectile"
                    ? "Pause at the top. Look at what stays."
                    : moment.concept === "force"
                      ? "Make the model match the slowing cart."
                      : "Change one thing. Watch what happens."}
                </h2>
                <p>
                  {moment.concept === "projectile"
                    ? "Play the shot, then use Pause at the top. Compare horizontal velocity, vertical velocity, and downward acceleration. Change the launch angle and try again."
                    : moment.concept === "force"
                      ? "Try each force direction. Compare how the velocity changes, not just where the cart goes."
                      : moment.concept === "torque"
                        ? "Move the push point from 0.80 m to 0.20 m. Then adjust the force until you restore 8 N·m of torque."
                        : "Keep the left load fixed. Explore different right-side distances and forces that give 8 N·m of torque."}
                </p>
                <button className="button primary" onClick={() => setPhase(2)}>
                  I’m ready to explain <ArrowRight size={16} />
                </button>
              </>
            ) : (
              <>
                <div className="task-label">
                  <span>03 / EXPLAIN</span>
                  <small>A new answer means a new way of seeing.</small>
                </div>
                <h2>{explainQuestion ? explainQuestion.prompt : practice}</h2>
                <div className="answer-form">
                  {explainQuestion ? (
                    <div className="prediction-options">
                      {explainQuestion.options.map((option) => (
                        <button
                          key={option}
                          aria-pressed={explainChoice === option}
                          className={explainChoice === option ? "chosen" : ""}
                          onClick={() => {
                            setExplainChoice(option);
                            setAnswer(option);
                            setFeedback(null);
                          }}
                        >
                          {option}
                          {explainChoice === option && <Check size={14} />}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <>
                      <label className="sr-only" htmlFor="practice-answer">
                        Your answer
                      </label>
                      {moment.concept === "projectile" ? (
                        <select
                          id="practice-answer"
                          value={answer}
                          onChange={(e) => {
                            setAnswer(e.target.value);
                            setFeedback(null);
                          }}
                        >
                          <option value="">Choose a direction</option>
                          <option>Downward</option>
                          <option>Upward</option>
                          <option>Zero</option>
                        </select>
                      ) : moment.concept === "force" ? (
                        <select
                          id="practice-answer"
                          value={answer}
                          onChange={(e) => {
                            setAnswer(e.target.value);
                            setFeedback(null);
                          }}
                        >
                          <option value="">Choose a direction</option>
                          <option>Left</option>
                          <option>Right</option>
                          <option>Zero</option>
                        </select>
                      ) : (
                        <div className="unit-input">
                          <input
                            id="practice-answer"
                            inputMode="decimal"
                            value={answer}
                            onChange={(e) => {
                              setAnswer(e.target.value);
                              setFeedback(null);
                            }}
                            placeholder="Your answer"
                          />
                          <span>N</span>
                        </div>
                      )}
                    </>
                  )}
                  <button
                    className="button secondary"
                    disabled={explainQuestion ? !explainChoice : !answer}
                    onClick={() => {
                      if (explainQuestion) {
                        const chosenIndex =
                          explainQuestion.options.indexOf(explainChoice || "");
                        const correct = chosenIndex === explainQuestion.correct;
                        setFeedback({
                          correct,
                          feedback: correct
                            ? explainQuestion.explanation
                            : explainQuestion.hint,
                        });
                      } else {
                        setFeedback(assessAnswer(moment.concept, answer));
                      }
                    }}
                  >
                    Check my reasoning <ArrowRight size={15} />
                  </button>
                </div>
                {feedback && (
                  <div
                    className={`answer-feedback ${feedback.correct ? "correct" : "try-again"}`}
                    role="status"
                  >
                    {feedback.correct ? (
                      <>
                        <Check size={17} />
                        <span>{feedback.feedback}</span>
                      </>
                    ) : (
                      <>
                        <Lightbulb size={17} />
                        <span>
                          {explainQuestion
                            ? feedback.feedback
                            : "Not quite yet. " +
                              (moment.concept === "projectile"
                                ? "Pause the model at the top. Does the gravity arrow disappear when vertical velocity reaches zero?"
                                : moment.concept === "force"
                                  ? "Look at the change in velocity. Try testing the other force direction."
                                  : "Use the model to match 8 N·m at the distance in this question, then check the required force.")}
                        </span>
                      </>
                    )}
                  </div>
                )}
                {feedback?.correct && (
                  <div className="reflection-form">
                    <label htmlFor="reflection">
                      Explain it to a friend, in your own words.
                    </label>
                    <textarea
                      id="reflection"
                      rows={3}
                      value={reflection}
                      onChange={(e) => setReflection(e.target.value)}
                      placeholder={
                        moment.concept === "projectile"
                          ? "At the top, the ball still accelerates downward because…"
                          : moment.concept === "torque"
                            ? "A longer handle makes it easier because…"
                            : "What matters is…"
                      }
                      maxLength={1500}
                    />
                    <p className="microcopy">
                      Your explanation is saved as written. The prototype checks
                      the answer, not the quality of this reflection.
                    </p>
                    <button
                      className="button primary"
                      disabled={reflection.trim().length < 10}
                      onClick={save}
                    >
                      <Bookmark size={15} />{" "}
                      {alreadySaved
                        ? "Update my notebook"
                        : "Save this connection"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
        <aside className="tutor-panel">
          <div className="tutor-heading">
            <span className="lens-avatar">
              <span />
            </span>
            <div>
              <h2>Your thinking partner</h2>
              <span>
                {mode === "bedrock"
                  ? "Amazon Bedrock · course-aware"
                  : "Demo tutor · guided responses"}
              </span>
            </div>
            <span
              className={`status-dot ${mode === "bedrock" ? "live" : ""}`}
            />
          </div>
          <div className="tutor-context">
            <BookOpen size={14} />
            <span>
              Connected to lecture{" "}
              {moment.concept === "projectile"
                ? "4.2"
                : moment.concept === "force"
                  ? "4.1"
                  : moment.concept === "torque"
                    ? "4.2"
                    : "4.3"}{" "}
              · {COURSE.id}
            </span>
          </div>
          <div
            className="chat-messages"
            ref={chat}
            aria-live="polite"
            aria-relevant="additions"
          >
            {messages.map((message, i) => (
              <div className={`chat-message ${message.role}`} key={i}>
                {message.role === "assistant" && (
                  <span className="message-source">
                    MOMENTUM <span>{message.mode}</span>
                  </span>
                )}
                <p>{message.content}</p>
              </div>
            ))}
            {busy && (
              <div className="thinking-indicator">
                <span />
                <span />
                <span /> Following your thinking
              </div>
            )}
            {error && (
              <div role="alert" className="inline-error">
                {error}
                <button
                  className="text-button"
                  onClick={() =>
                    send(
                      messages.filter((m) => m.role === "user").at(-1)
                        ?.content || "Give me a hint",
                    )
                  }
                >
                  Try again
                </button>
              </div>
            )}
          </div>
          <div className="chat-bottom">
            <button
              className="hint-button"
              disabled={busy}
              onClick={() =>
                send(
                  hints >= 2
                    ? "Show me the full explanation"
                    : "Give me a hint",
                  true,
                )
              }
            >
              <Lightbulb size={14} />
              {hints >= 2 ? "Walk me through it" : "A little nudge"}
              <span>{hints > 0 ? `${hints} used` : ""}</span>
            </button>
            <form
              className="chat-composer"
              onSubmit={(e) => {
                e.preventDefault();
                send(input);
              }}
            >
              <textarea
                aria-label="Ask your tutor"
                placeholder="Tell me what you’re thinking…"
                rows={2}
                value={input}
                maxLength={2500}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send(input);
                  }
                }}
              />
              <button
                aria-label="Send message"
                disabled={!input.trim() || busy}
              >
                {busy ? (
                  <LoaderCircle size={18} className="spin" />
                ) : (
                  <Send size={18} />
                )}
              </button>
            </form>
            <span className="tutor-disclaimer">
              {mode === "bedrock"
                ? "AI suggestions can be mistaken. Check the model and course notes."
                : "Scripted coaching for this demo. Connect Bedrock for open-ended tutoring."}
            </span>
          </div>
        </aside>
      </div>
    </section>
  );
}
