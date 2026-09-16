import {
  ArrowRight,
  Eye,
  Pause,
  FlaskConical,
  Bookmark,
  MessageCircle,
  Play,
  ChevronDown,
} from "lucide-react";
export default function Guide({
  onStart,
  onCourse,
  mode,
}: {
  onStart: () => void;
  onCourse: () => void;
  mode: string;
}) {
  const steps = [
    {
      title: "Watch the event",
      body: "On Today, select the basketball shot and press Explore this event.",
      icon: Eye,
    },
    {
      title: "Answer guided questions",
      body: "The full shot plays first. Then the coach pauses at key frames and asks questions with physics arrows on the video.",
      icon: Pause,
    },
    {
      title: "Test in the lab",
      body: "Open Play with physics to change launch angle, speed, and height. Compare what changes at the apex.",
      icon: FlaskConical,
    },
    {
      title: "Save and practice",
      body: "Write your explanation, save it to the notebook, then try transfer questions in Practice.",
      icon: Bookmark,
    },
  ];
  return (
    <div className="guide-page page-enter">
      <div className="guide-hero">
        <div>
          <h1>How Lens works</h1>
          <p>
            A real video becomes a short guided lesson — watch, think, test,
            explain.
          </p>
          <div className="guide-hero-actions">
            <button className="button primary" onClick={onStart}>
              <Play size={15} /> Try the basketball event
            </button>
            <span>About 3 minutes</span>
          </div>
        </div>
        <div className="guide-preview">
          <img
            src="/demo/coaching-frame.jpg"
            alt="The basketball near the apparent top of its arc"
          />
          <div className="guide-preview-arrow" aria-hidden="true">
            <span>Fɢ = mg</span>
            <span>↓</span>
          </div>
          <div className="guide-preview-caption">
            <p>“What changes at the top? What keeps acting?”</p>
            <small>Real frame · conceptual annotation</small>
          </div>
        </div>
      </div>
      <div className="guide-body">
        <section className="guide-walkthrough">
          <div className="section-heading">
            <h2>Four steps</h2>
          </div>
          {steps.map(({ title, body, icon: Icon }, i) => (
            <article className="guide-step" key={title}>
              <span className="guide-step-number">0{i + 1}</span>
              <div>
                <span className="guide-step-icon">
                  <Icon size={20} strokeWidth={1.4} />
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
              </div>
            </article>
          ))}
        </section>
        <aside className="guide-companion">
          <h2>Coach vs lounge</h2>
          <div>
            <Pause size={19} />
            <p>
              <strong>Event coach</strong> — prepared questions about the video
              frame, with diagrams and explanations.
            </p>
          </div>
          <div>
            <MessageCircle size={19} />
            <p>
              <strong>Physics lounge</strong> — open-ended discussion about
              forces, energy, or your coursework.
            </p>
          </div>
          <div className="guide-mode-note">
            <span className="status-dot" />
            <p>
              {mode === "bedrock"
                ? "Connected to Amazon Bedrock for live tutoring."
                : "Demo mode — prepared responses. Connect Bedrock in Settings for live tutoring."}
            </p>
          </div>
          <button className="text-button" onClick={onCourse}>
            Open course <ArrowRight size={14} />
          </button>
        </aside>
      </div>
      <section className="guide-faq">
        <details>
          <summary>
            Can I replay the event or change speed?
            <ChevronDown size={16} />
          </summary>
          <p>
            Yes. Use Watch the event again inside the player. Speed controls
            include 0.25× through normal speed. Your question progress is
            preserved.
          </p>
        </details>
        <details>
          <summary>
            Will switching to the lab lose my answers?
            <ChevronDown size={16} />
          </summary>
          <p>
            No. Switching between Watch & wonder and Play with physics keeps
            your progress. Save to the notebook before leaving the page.
          </p>
        </details>
        <details>
          <summary>
            What&apos;s real vs modeled?
            <ChevronDown size={16} />
          </summary>
          <p>
            The video is real footage. Overlay arrows are conceptual teaching
            aids. The physics lab uses hypothetical values with an ideal
            projectile model (no air resistance).
          </p>
        </details>
      </section>
    </div>
  );
}
