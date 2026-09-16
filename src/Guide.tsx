import {
  ArrowRight,
  ArrowDownToLine,
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
      title: "Find a moment worth a second look.",
      body: "Your day shows the recording and the selected event. Explore this event opens only the basketball shot, with its own short timeline.",
      icon: Eye,
      detail: "Start on Your day → Explore this event",
    },
    {
      title: "Watch once. Then think with your coach.",
      body: "The whole shot plays first. Lens returns to a teaching frame and asks a question inside the player. Choose an answer, check it, and see physics arrows appear on the real footage.",
      icon: Pause,
      detail: "Use Replay whenever you want to see the full event again",
    },
    {
      title: "Change the conditions. Test the idea.",
      body: "Open Play with physics to change the launch angle, speed, and height. Pause at the top to compare velocity and acceleration. Your coaching progress stays where you left it.",
      icon: FlaskConical,
      detail: "The lab uses hypothetical values, separate from the video",
    },
    {
      title: "Leave with an explanation of your own.",
      body: "After the coach’s questions, explain the idea in your own words. Save it to your notebook, then try a different context in Practice & recall.",
      icon: Bookmark,
      detail: "Your notebook stays in this browser and can be exported",
    },
  ];
  return (
    <div className="guide-page page-enter">
      <div className="guide-hero">
        <div>
          <span className="eyebrow">A QUICK INTRODUCTION TO LENS</span>
          <h1>
            See a moment.
            <br />
            <em>Keep the understanding.</em>
          </h1>
          <p>
            Lens connects the physics in your course to the world in front of
            you. A real video becomes a small, guided lesson—with a pause, a
            question, and an experiment you can make your own.
          </p>
          <div className="guide-hero-actions">
            <button className="button primary" onClick={onStart}>
              <Play size={15} /> Try the basketball event
            </button>
            <span>About 3 minutes to explore</span>
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
            <span>THE MOMENT BECOMES THE LESSON</span>
            <p>
              “What changes at the top?
              <br />
              What keeps acting?”
            </p>
            <small>Real frame · conceptual annotation</small>
          </div>
        </div>
      </div>
      <div className="guide-purpose">
        <span>THE IDEA</span>
        <p>
          Knowing the equation is one thing.
          <br />
          <strong>Recognizing when it matters is the next.</strong>
        </p>
        <span className="guide-purpose-mark">✳</span>
      </div>
      <div className="guide-body">
        <section className="guide-walkthrough">
          <div className="section-heading">
            <h2>
              Your first connection, <em>step by step.</em>
            </h2>
            <span>THE ESSENTIALS</span>
          </div>
          {steps.map(({ title, body, icon: Icon, detail }, i) => (
            <article className="guide-step" key={title}>
              <span className="guide-step-number">0{i + 1}</span>
              <div>
                <span className="guide-step-icon">
                  <Icon size={20} strokeWidth={1.4} />
                </span>
                <h3>{title}</h3>
                <p>{body}</p>
                <small>{detail}</small>
              </div>
            </article>
          ))}
        </section>
        <aside className="guide-companion">
          <span className="eyebrow">TWO SPACES, TWO DIFFERENT JOBS</span>
          <h2>
            A coach for the moment.
            <br />
            <em>Room for your curiosity.</em>
          </h2>
          <div>
            <Pause size={19} />
            <p>
              <strong>Inside the video</strong>The coach asks prepared questions
              about the frame you’re looking at. Answers reveal diagrams and
              explanations.
            </p>
          </div>
          <div>
            <MessageCircle size={19} />
            <p>
              <strong>Physics lounge</strong>Open the lounge for broader physics
              discussion. Ask about energy, forces, torque, or what you’re
              learning in class.
            </p>
          </div>
          <div className="guide-mode-note">
            <span className="status-dot" />
            <p>
              {mode === "bedrock"
                ? "Your lounge is connected to Amazon Bedrock. Check AI explanations against your course notes."
                : "This prototype is in demo mode. The lounge has prepared responses; live, open-ended discussion is available when Bedrock is connected."}
            </p>
          </div>
          <button className="text-button" onClick={onCourse}>
            See the sample course <ArrowRight size={14} />
          </button>
        </aside>
      </div>
      <section className="guide-honesty">
        <div>
          <span className="eyebrow">WHAT YOU’RE SEEING</span>
          <h2>Clear about the evidence.</h2>
          <p>
            The video is real. The overlay explains a simplified model. That
            distinction is part of learning physics well.
          </p>
        </div>
        <dl>
          <div>
            <dt>The recording</dt>
            <dd>
              Your original basketball clip, with a 2.3-second event extracted
              for coaching.
            </dd>
          </div>
          <div>
            <dt>The pause & arrows</dt>
            <dd>
              Prepared teaching frames near the apparent apex and during
              descent. Camera movement prevents an exact apex measurement; the
              arrows are conceptual.
            </dd>
          </div>
          <div>
            <dt>The sandbox</dt>
            <dd>
              Analytical projectile motion, ignoring air resistance, spin, and
              collisions. Launch controls are practice values.
            </dd>
          </div>
          <div>
            <dt>Your notebook</dt>
            <dd>
              Your own explanation, stored locally. Answer checks don’t claim to
              grade the quality of your reflection.
            </dd>
          </div>
        </dl>
      </section>
      <section className="guide-faq">
        <span className="eyebrow">A FEW USEFUL DETAILS</span>
        <details>
          <summary>
            Can I replay the event or change the speed?
            <ChevronDown size={16} />
          </summary>
          <p>
            Yes. Use Watch the event again inside the stage. The bottom controls
            offer 0.25×, 0.5×, 0.75×, and normal speed. Replaying preserves your
            question progress.
          </p>
        </details>
        <details>
          <summary>
            Will leaving for the lab lose my answers?
            <ChevronDown size={16} />
          </summary>
          <p>
            No. Switching between Watch & wonder and Play with physics keeps
            your answers and explanation in this open session. Save to the
            notebook before leaving the event or refreshing the page.
          </p>
        </details>
        <details>
          <summary>
            Can I bring another video?
            <ChevronDown size={16} />
          </summary>
          <p>
            Add a recording from Your day. It plays locally. The polished,
            frame-specific coaching sequence is prepared for this basketball
            shot; new recordings use a simpler guided question. Bedrock can
            propose learning opportunities from sampled frames when connected.
          </p>
        </details>
        <details>
          <summary>
            How does Lens know when to ask?
            <ChevronDown size={16} />
          </summary>
          <p>
            In this prototype, the event and teaching timestamps are prepared.
            The question appears after you have watched the complete event. The
            discovery replay also lets you mark yourself busy and defer an
            invitation. The app does not infer your attention.
          </p>
        </details>
      </section>
      <footer className="guide-download">
        <div>
          <span className="eyebrow">THE WEBSITE, IN ONE PAGE</span>
          <h2>Something to share with your team.</h2>
          <p>
            A short product brief covering the idea, the learning loop, and what
            the prototype demonstrates.
          </p>
        </div>
        <a className="button secondary" href="/lens-product-brief.md" download>
          <ArrowDownToLine size={16} /> Download the brief
        </a>
      </footer>
    </div>
  );
}
