import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  LoaderCircle,
  MessageCircle,
  RotateCcw,
  Send,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  missedAttempts,
  signalsUnderstanding,
  courseNotebookRecord,
  type DiagnosticQuestion,
} from "../shared/diagnostic";
import type { LearningRecord, Message } from "../shared/physics";
import { askRemediation } from "./api";

type Stage = "explaining" | "verifying" | "done";

export default function CourseRemediation({
  focus,
  summary,
  title,
  questions,
  answers,
  bedrockAvailable,
  onOpenSettings,
  onBack,
  onSave,
  onOpenNotebook,
}: {
  focus: string;
  summary: string;
  title: string;
  questions: DiagnosticQuestion[];
  answers: Record<string, number>;
  bedrockAvailable: boolean;
  onOpenSettings: () => void;
  onBack: () => void;
  onSave: (record: LearningRecord) => void;
  onOpenNotebook: () => void;
}) {
  const initialMissed = useMemo(
    () => missedAttempts(questions, answers),
    [answers, questions],
  );
  const [missed, setMissed] = useState(initialMissed);
  const [stage, setStage] = useState<Stage>("explaining");
  const [messages, setMessages] = useState<(Message & { mode?: string })[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [readyForCheck, setReadyForCheck] = useState(false);
  const [check, setCheck] = useState<DiagnosticQuestion[]>([]);
  const [checkIndex, setCheckIndex] = useState(0);
  const [checkAnswers, setCheckAnswers] = useState<Record<string, number>>({});
  const abort = useRef<AbortController | null>(null);
  const chat = useRef<HTMLDivElement>(null);
  const seenIds = useMemo(
    () => [...questions.map((question) => question.id), ...check.map((item) => item.id)],
    [check, questions],
  );
  const mode = bedrockAvailable ? "bedrock" : "rehearsal";
  const checkQuestion = check[checkIndex];
  const checkScore = check.filter(
    (question) => checkAnswers[question.id] === question.correctIndex,
  ).length;

  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    chat.current?.scrollTo({
      top: chat.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);
  useEffect(() => {
    void startSession(initialMissed);
  }, []);

  function payload(
    action: "open" | "chat" | "quiz",
    extras: { message?: string; history?: Message[]; nextMissed?: typeof missed } = {},
  ) {
    return {
      action,
      message: extras.message,
      history: extras.history,
      focus,
      summary,
      missed: extras.nextMissed || missed,
      seenIds,
      mode,
    };
  }

  async function startSession(nextMissed = missed) {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    setMessages([]);
    setReadyForCheck(false);
    try {
      const response = await askRemediation(
        payload("open", { nextMissed }),
        controller.signal,
      );
      setMessages([
        {
          role: "assistant",
          content: response.reply || "Let's work through the idea that still needs practice.",
          mode:
            response.mode === "bedrock" ? "Amazon Bedrock" : "Demo response",
        },
      ]);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError"))
        setError(
          caught instanceof Error
            ? caught.message
            : "The tutor could not start. Please try again.",
        );
    } finally {
      setBusy(false);
    }
  }

  async function send(text: string) {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    const history = messages.slice(-10).map(({ role, content }) => ({
      role,
      content,
    }));
    setInput("");
    setError("");
    setBusy(true);
    setMessages((current) => [...current, { role: "user", content: trimmed }]);
    if (signalsUnderstanding(trimmed)) setReadyForCheck(true);
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await askRemediation(
        payload("chat", { message: trimmed, history }),
        controller.signal,
      );
      setMessages((current) => [
        ...current,
        {
          role: "assistant",
          content: response.reply || "When you can restate the idea, start the check.",
          mode:
            response.mode === "bedrock" ? "Amazon Bedrock" : "Demo response",
        },
      ]);
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError"))
        setError(
          caught instanceof Error
            ? caught.message
            : "The tutor could not respond. Please try again.",
        );
    } finally {
      setBusy(false);
    }
  }

  async function startCheck() {
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    setBusy(true);
    setError("");
    try {
      const response = await askRemediation(payload("quiz"), controller.signal);
      const next = response.questions || [];
      if (!next.length) throw new Error("The check could not be prepared.");
      setCheck(next);
      setCheckIndex(0);
      setCheckAnswers({});
      setStage("verifying");
    } catch (caught) {
      if (!(caught instanceof DOMException && caught.name === "AbortError"))
        setError(
          caught instanceof Error
            ? caught.message
            : "The check could not start. Please try again.",
        );
    } finally {
      setBusy(false);
    }
  }

  function finishCheck() {
    onSave(
      courseNotebookRecord({
        focus,
        title,
        missed,
        check,
        checkAnswers,
        mode,
      }),
    );
    setStage("done");
  }

  function continueCoaching() {
    const nextMissed = missedAttempts(check, checkAnswers);
    setMissed(nextMissed.length ? nextMissed : missed);
    setStage("explaining");
    setCheck([]);
    setCheckAnswers({});
    void startSession(nextMissed.length ? nextMissed : missed);
  }

  if (stage === "verifying" && checkQuestion) {
    const selected = checkAnswers[checkQuestion.id];
    return (
      <section className="diagnostic-shell diagnostic-quiz remediation-shell">
        <div className="diagnostic-topline">
          <button className="text-button" onClick={() => setStage("explaining")}>
            <ArrowLeft size={14} /> Back to coaching
          </button>
          <span>
            Check {checkIndex + 1} of {check.length}
          </span>
          <span>New situation · not the original items</span>
        </div>
        <div className="diagnostic-progress" aria-hidden="true">
          {check.map((item, index) => (
            <span
              key={item.id}
              className={
                index < checkIndex || checkAnswers[item.id] !== undefined
                  ? "complete"
                  : index === checkIndex
                    ? "current"
                    : ""
              }
            />
          ))}
        </div>
        <div className="diagnostic-question">
          <div className="question-meta">
            <span>{checkQuestion.type}</span>
            <span>{checkQuestion.skill}</span>
          </div>
          <h2>{checkQuestion.prompt}</h2>
          <div className="diagnostic-options" role="radiogroup">
            {checkQuestion.options.map((option, index) => (
              <button
                key={option}
                role="radio"
                aria-checked={selected === index}
                className={selected === index ? "selected" : ""}
                onClick={() =>
                  setCheckAnswers((current) => ({
                    ...current,
                    [checkQuestion.id]: index,
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
            These items use a new setup on purpose. Matching the original
            letters would not show that the idea transferred.
          </p>
        </div>
        <div className="diagnostic-actions">
          <button
            className="button secondary"
            disabled={checkIndex === 0}
            onClick={() => setCheckIndex((index) => index - 1)}
          >
            <ArrowLeft size={15} /> Previous
          </button>
          {checkIndex === check.length - 1 ? (
            <button
              className="button primary"
              disabled={selected === undefined}
              onClick={finishCheck}
            >
              See whether it transferred <ArrowRight size={16} />
            </button>
          ) : (
            <button
              className="button primary"
              disabled={selected === undefined}
              onClick={() => setCheckIndex((index) => index + 1)}
            >
              Next question <ArrowRight size={15} />
            </button>
          )}
        </div>
      </section>
    );
  }

  if (stage === "done") {
    const passed = checkScore === check.length && check.length > 0;
    return (
      <section className="diagnostic-shell diagnostic-results remediation-shell">
        <div className="results-heading">
          <div
            className="results-score"
            aria-label={`${checkScore} of ${check.length} correct`}
          >
            <strong>{checkScore}</strong>
            <span>/ {check.length}</span>
          </div>
          <div>
            <div className="eyebrow">TRANSFER CHECK</div>
            <h2>
              {passed
                ? "The idea held up in a new situation."
                : "The idea still needs another pass."}
            </h2>
            <p>
              {passed
                ? "That is stronger evidence than saying you understand."
                : "Self-report is not the gate. Keep coaching the remaining mix-up, then try another new example."}
            </p>
          </div>
          <div className="results-heading-actions">
            <button className="text-button" onClick={onBack}>
              <ArrowLeft size={14} /> Course results
            </button>
          </div>
        </div>
        <div className="remediation-done-actions">
          {passed ? (
            <button className="button primary" onClick={onBack}>
              Back to my course <ArrowRight size={15} />
            </button>
          ) : (
            <button className="button primary" onClick={continueCoaching}>
              Keep coaching <RotateCcw size={15} />
            </button>
          )}
          <button className="button secondary" onClick={onOpenNotebook}>
            See it in my notebook
          </button>
        </div>
        <details className="answer-review" open>
          <summary>What this check asked</summary>
          <div>
            {check.map((question, index) => {
              const isCorrect =
                checkAnswers[question.id] === question.correctIndex;
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
                        Your answer: {question.options[checkAnswers[question.id]]}.
                        Correct answer: {question.options[question.correctIndex]}.
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
    <section className="diagnostic-shell remediation-shell">
      <div className="diagnostic-topline">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={14} /> Course results
        </button>
        <span>STEP 3 OF 3</span>
        <span>{missed.length ? "Coach the miss" : "Lock it in"}</span>
      </div>
      <div className="remediation-heading">
        <div className="diagnostic-title-icon">
          <MessageCircle size={22} />
        </div>
        <div>
          <div className="eyebrow">REMEDIATION TUTOR</div>
          <h2>{title}</h2>
          <p>
            {missed.length
              ? "Momentum will explain the mix-up. A new-situation check is the real gate — not “I understand.”"
              : "Your first check was strong. A transfer question still decides whether the idea holds."}
          </p>
        </div>
        <button
          className={`button ${readyForCheck ? "primary" : "secondary"}`}
          disabled={busy || messages.length === 0}
          onClick={() => void startCheck()}
        >
          Check my understanding <ArrowRight size={15} />
        </button>
      </div>
      <div className="remediation-chat" ref={chat} aria-live="polite">
        {messages.map((message, index) => (
          <div key={`${message.role}-${index}`} className={`chat-message ${message.role}`}>
            {message.role === "assistant" && (
              <span className="message-source">
                MOMENTUM
                <span>{message.mode}</span>
              </span>
            )}
            <p>{message.content.replace(/\*\*(.+?)\*\*/g, "$1")}</p>
          </div>
        ))}
        {busy && (
          <div className="thinking-indicator">
            <span />
            <span />
            <span /> Working from your answers
          </div>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
            <button
              className="text-button"
              onClick={() =>
                messages.length
                  ? send(
                      messages.filter((item) => item.role === "user").at(-1)
                        ?.content || "Please continue.",
                    )
                  : void startSession()
              }
            >
              Try again
            </button>
            {!bedrockAvailable && (
              <button className="text-button" onClick={onOpenSettings}>
                Connect Bedrock
              </button>
            )}
          </div>
        )}
      </div>
      <form
        className="chat-composer remediation-composer"
        onSubmit={(event) => {
          event.preventDefault();
          void send(input);
        }}
      >
        <textarea
          aria-label="Reply to the remediation tutor"
          value={input}
          maxLength={2500}
          placeholder="Explain the idea in your own words…"
          rows={2}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void send(input);
            }
          }}
        />
        <button disabled={busy || !input.trim()} aria-label="Send">
          {busy ? (
            <LoaderCircle size={17} className="spin" />
          ) : (
            <Send size={17} />
          )}
        </button>
      </form>
      <p className="tutor-disclaimer">
        {bedrockAvailable
          ? "Check AI explanations against your course notes. The original PDF is not sent again."
          : "Demo replies cover the missed ideas. Connect Bedrock for a live tutor."}
      </p>
    </section>
  );
}
