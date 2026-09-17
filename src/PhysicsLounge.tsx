import { useEffect, useRef, useState } from "react";
import {
  MessageCircle,
  X,
  Send,
  LoaderCircle,
  ArrowUpRight,
} from "lucide-react";
import type { Message, Moment } from "../shared/physics";
import type { ModelState } from "./Models";
import { askTutor } from "./api";
export default function PhysicsLounge({
  mode,
  moment,
  state,
  onClose,
}: {
  mode: "rehearsal" | "bedrock";
  moment: Moment;
  state: ModelState;
  onClose: () => void;
}) {
  const [messages, setMessages] = useState<(Message & { mode?: string })[]>([]),
    [input, setInput] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null),
    chat = useRef<HTMLDivElement>(null);
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    chat.current?.scrollTo({
      top: chat.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, busy]);
  async function send(text: string) {
    if (!text.trim() || busy) return;
    const history = messages
      .slice(-10)
      .map(({ role, content }) => ({ role, content }));
    setInput("");
    setError("");
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content: text }]);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const response = await askTutor(
        {
          message: text,
          concept: moment.concept,
          scope: "general",
          hintLevel: 0,
          history,
          mode,
          observation: moment.observation,
          modelState: state,
        },
        controller.signal,
      );
      setMessages((m) => [
        ...m,
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
            : "The tutor could not respond. Please try again.",
        );
    } finally {
      setBusy(false);
    }
  }
  return (
    <aside className="physics-lounge">
      <div className="lounge-header">
        <MessageCircle size={19} />
        <div>
          <h2>Physics lounge</h2>
          <span>
            {mode === "bedrock"
              ? "Open-ended · Amazon Bedrock"
              : "Demo conversations"}
          </span>
        </div>
        <button
          className="icon-button"
          onClick={onClose}
          aria-label="Close physics lounge"
        >
          <X size={16} />
        </button>
      </div>
      <div className="lounge-scope">
        Open-ended physics questions — separate from the event coach.
      </div>
      <div
        className="lounge-conversation"
        ref={chat}
        aria-live="polite"
        aria-relevant="additions"
      >
        {messages.length === 0 ? (
          <div className="lounge-welcome">
            <h3>Ask anything</h3>
            <p>Forces, energy, motion, or your coursework.</p>
            {[
              "How are force and motion different?",
              "Where does the ball’s energy go?",
              "How is torque different from force?",
            ].map((text) => (
              <button key={text} onClick={() => send(text)}>
                {text}
                <ArrowUpRight size={13} />
              </button>
            ))}
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`chat-message ${m.role}`}>
              {m.role === "assistant" && (
                <span className="message-source">
                  MOMENTUM<span>{m.mode}</span>
                </span>
              )}
              <p>{m.content}</p>
            </div>
          ))
        )}
        {busy && (
          <div className="thinking-indicator">
            <span />
            <span />
            <span /> Thinking it through
          </div>
        )}
        {error && (
          <div className="inline-error" role="alert">
            {error}
            <button
              className="text-button"
              onClick={() =>
                send(
                  messages.filter((m) => m.role === "user").at(-1)?.content ||
                    "Explain force",
                )
              }
            >
              Try again
            </button>
          </div>
        )}
      </div>
      <div className="lounge-compose">
        <form
          className="chat-composer"
          onSubmit={(e) => {
            e.preventDefault();
            send(input);
          }}
        >
          <textarea
            aria-label="Ask a general physics question"
            value={input}
            maxLength={2500}
            placeholder="Ask anything physics…"
            rows={2}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                send(input);
              }
            }}
          />
          <button
            disabled={busy || !input.trim()}
            aria-label="Send physics question"
          >
            {busy ? (
              <LoaderCircle size={17} className="spin" />
            ) : (
              <Send size={17} />
            )}
          </button>
        </form>
        <p>
          {mode === "bedrock"
            ? "Check AI explanations against your course notes."
            : "Prepared answers cover a few core topics. Connect Bedrock for open-ended discussion."}
        </p>
      </div>
    </aside>
  );
}
