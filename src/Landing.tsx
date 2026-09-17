import {
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  Focus,
  GraduationCap,
  Play,
  Repeat2,
  ShieldCheck,
  Upload,
} from "lucide-react";
import { DEMO_MOMENTS } from "../shared/physics";
import { MomentumMark } from "./Brand";

interface Props {
  onSample: () => void;
  onUpload: () => void;
  onEnter: () => void;
}

/* The real tracked ball positions from the sample, mapped onto the poster
 * frame (portrait 9:16). Nothing here is invented: same data the app uses. */
const TRACE = DEMO_MOMENTS[0].trace || [];
const W = 100,
  H = (100 * 16) / 9;
const PTS = TRACE.map((p) => [p.x * W, p.y * H] as [number, number]);
const PATH = PTS.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
const APEX = PTS.reduce((b, [, y], i, a) => (y < a[b][1] ? i : b), 0);

const SITUATIONS = [
  {
    name: "A door swinging shut",
    concept: "Torque",
    q: "Why is the handle so far from the hinge?",
    art: (
      <svg viewBox="0 0 120 80" aria-hidden="true">
        <path d="M22 10v60" />
        <path d="M22 12l56 10v46l-56 10z" opacity=".55" />
        <path d="M84 40a30 30 0 0 1-26 28" strokeDasharray="3 4" />
        <path d="M62 66l-6 3 2-7" />
        <circle cx="70" cy="40" r="2.6" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    name: "A swing in the park",
    concept: "Oscillation",
    q: "What stays the same, cycle after cycle?",
    art: (
      <svg viewBox="0 0 120 80" aria-hidden="true">
        <path d="M60 8v0" />
        <path d="M60 8l-30 52" opacity=".45" />
        <path d="M60 8l30 52" opacity=".45" />
        <path d="M60 8v56" />
        <circle cx="60" cy="66" r="6" />
        <path d="M30 60a36 36 0 0 0 60 0" strokeDasharray="3 4" />
      </svg>
    ),
  },
  {
    name: "A bike braking at a light",
    concept: "Net force",
    q: "Moving forward. Which way is the force?",
    art: (
      <svg viewBox="0 0 120 80" aria-hidden="true">
        <circle cx="34" cy="56" r="14" />
        <circle cx="86" cy="56" r="14" />
        <path d="M34 56l16-26h26l10 26M50 30l-8-8h12" />
        <path d="M100 18h-40" />
        <path d="M66 18l6-5M66 18l6 5" />
        <path d="M18 18h14" opacity=".55" />
      </svg>
    ),
  },
  {
    name: "A ball in the air",
    concept: "Projectile motion",
    q: "At the top, does gravity take a break?",
    art: (
      <svg viewBox="0 0 120 80" aria-hidden="true">
        <path d="M12 68q48-96 96 0" strokeDasharray="3 4" />
        <circle cx="60" cy="20" r="6" />
        <path d="M60 30v14M56 40l4 5 4-5" />
        <path d="M8 72h104" opacity=".4" />
      </svg>
    ),
  },
  {
    name: "Two kids on a seesaw",
    concept: "Equilibrium",
    q: "Can a smaller push balance a bigger one?",
    art: (
      <svg viewBox="0 0 120 80" aria-hidden="true">
        <path d="M14 52l92-16" />
        <path d="M52 62l8-16 8 16z" />
        <rect x="18" y="38" width="12" height="12" transform="rotate(-10 24 44)" />
        <rect x="90" y="20" width="9" height="9" transform="rotate(-10 94 24)" />
        <path d="M8 66h104" opacity=".4" />
      </svg>
    ),
  },
  {
    name: "A book resting on a desk",
    concept: "Balanced forces",
    q: "Nothing moves. So is anything pushing?",
    art: (
      <svg viewBox="0 0 120 80" aria-hidden="true">
        <rect x="38" y="36" width="44" height="14" />
        <path d="M14 50h92" />
        <path d="M60 34v-16M56 22l4-5 4 5" />
        <path d="M60 52v16M56 64l4 5 4-5" />
      </svg>
    ),
  },
];

export default function Landing({ onSample, onUpload, onEnter }: Props) {
  return (
    <div className="landing" role="dialog" aria-label="Welcome to Momentum">
      <div className="mesh" aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>

      <header className="landing-nav">
        <button className="landing-brand" onClick={onEnter}>
          <MomentumMark small />
          momentum<b>.</b>
        </button>
        <nav aria-label="Landing">
          <a href="#how">How it works</a>
          <a href="#moments">Any moment</a>
          <a href="#honest">Honest by design</a>
        </nav>
        <button className="landing-ghost" onClick={onEnter}>
          Open the studio <ArrowRight size={14} />
        </button>
      </header>

      {/* ---------------- HERO ---------------- */}
      <section className="hero">
        <div className="hero-copy">
          <span className="landing-kicker">AI physics tutor · Learn track</span>
          <h1>
            Point your camera
            <br />
            at the world.
            <br />
            <span className="grad">Learn the physics.</span>
          </h1>
          <p>
            Upload any clip — a door swinging, a bike braking, a ball in the
            air. Momentum finds the physics inside it and coaches you through it:
            <b> predict, test, explain.</b>
          </p>
          <div className="hero-actions">
            <button className="button primary hero-cta" onClick={onSample}>
              <Play size={16} /> Try the sample shot
            </button>
            <button className="landing-ghost big" onClick={onUpload}>
              <Upload size={16} /> Upload a recording
            </button>
          </div>
          <ul className="hero-proof">
            <li>
              <Check size={13} /> Any camera, any moment
            </li>
            <li>
              <Check size={13} /> Course-aware coaching
            </li>
            <li>
              <Check size={13} /> Frames only — video stays on your device
            </li>
          </ul>
        </div>

        <div className="hero-stage" aria-hidden="true">
          <div className="stage-3d">
            <div className="phone hero-card">
              <div className="phone-top">
                <span className="rec" /> REC · 0:14.7
                <span className="phone-tag">PROJECTILE</span>
              </div>
              <div className="phone-screen">
                <img src="/demo/shot-poster.jpg" alt="" />
                <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
                  <path className="arc" d={PATH} />
                  {PTS.map(([x, y], i) => (
                    <circle
                      key={i}
                      className="dot"
                      cx={x}
                      cy={y}
                      r={i === APEX ? 1.6 : 1}
                      style={{ animationDelay: `${0.9 + i * 0.09}s` }}
                    />
                  ))}
                  {PTS[APEX] && (
                    <circle
                      className="apex"
                      cx={PTS[APEX][0]}
                      cy={PTS[APEX][1]}
                      r={4}
                    />
                  )}
                </svg>
                <div className="hud">
                  <span>APEX · IDEAL MODEL</span>
                  <b>vy = 0 · a = 9.81 m/s² ↓</b>
                </div>
              </div>
            </div>

            <div className="float-card timeline-card hero-card">
              <div className="fc-head">
                <b>3 moments found</b>
                <span>0:00 – 0:48</span>
              </div>
              <div className="fc-track">
                <i style={{ left: "12%" }}>
                  <em>01</em>
                </i>
                <i style={{ left: "29%" }} className="on">
                  <em>02</em>
                </i>
                <i style={{ left: "71%" }}>
                  <em>03</em>
                </i>
              </div>
              <div className="fc-row">
                <span className="fc-chip">Projectile · 0:14</span>
                <span className="fc-chip dim">Net force · 0:34</span>
              </div>
            </div>

            <div className="float-card question-card hero-card">
              <span className="landing-kicker">Up next · 0:14</span>
              <h3>At the highest point, does gravity take a break?</h3>
              <div className="fc-options">
                <span>Downward</span>
                <span>Upward</span>
                <span className="picked">
                  There is no net force <Check size={12} />
                </span>
              </div>
              <div className="fc-feedback">
                <ShieldCheck size={13} /> Gravity never takes a break — the net
                force is still mg, downward.
              </div>
            </div>
          </div>
        </div>
      </section>

      <div className="trust-strip">
        <span>Built for PHYS 2010 · Mechanics</span>
        <span>Coaching by Amazon Bedrock</span>
        <span>Minds &amp; Machines Hackathon · Learn track</span>
        <span>Runs locally · frames only</span>
      </div>

      {/* ---------------- HOW IT WORKS ---------------- */}
      <section className="section" id="how">
        <div className="section-head">
          <span className="landing-kicker">How it works</span>
          <h2>
            Three steps from <span className="grad">a clip to a concept.</span>
          </h2>
        </div>
        <div className="steps">
          <article className="step-card">
            <div className="step-num">
              <Camera size={18} /> <span>01</span>
            </div>
            <h3>Record anything</h3>
            <p>
              Phone footage is enough. No setup, no markers, no lab bench. Momentum
              samples a handful of frames — the video itself never leaves your
              device.
            </p>
            <div className="mini file">
              <Upload size={14} />
              <span>
                door-swing.mov <em>· 0:12 · 20 frames sampled</em>
              </span>
            </div>
          </article>
          <article className="step-card">
            <div className="step-num">
              <Focus size={18} /> <span>02</span>
            </div>
            <h3>Momentum finds the physics</h3>
            <p>
              The model looks for a teachable moment — a hinge, a change in
              speed, a free flight — and pins it on the timeline with what it
              can honestly claim.
            </p>
            <div className="mini chips">
              <span className="on">Torque · hinge found · 0:04</span>
              <span>Observed</span>
              <span>Assumed</span>
              <span>Practice value</span>
            </div>
          </article>
          <article className="step-card">
            <div className="step-num">
              <GraduationCap size={18} /> <span>03</span>
            </div>
            <h3>Predict, test, explain</h3>
            <p>
              A short coached sequence written for that exact moment: guess
              first, test it in a live model, then explain it in your own words
              and save it to your notebook.
            </p>
            <div className="mini q">
              <b>Push closer to the hinge — more force or less?</b>
              <span className="picked">More force</span>
            </div>
          </article>
        </div>
      </section>

      {/* ---------------- ANY MOMENT ---------------- */}
      <section className="section" id="moments">
        <div className="section-head">
          <span className="landing-kicker">Any moment is a lesson</span>
          <h2>
            Not a basketball app.
            <br />
            <span className="grad">A world-is-your-lab app.</span>
          </h2>
          <p>
            The sample happens to be a jump shot. The same loop works on
            whatever your camera sees.
          </p>
        </div>
        <div className="sit-grid">
          {SITUATIONS.map((s) => (
            <article className="sit-card" key={s.name}>
              <div className="sit-art">{s.art}</div>
              <span className="sit-concept">{s.concept}</span>
              <h3>{s.name}</h3>
              <p>“{s.q}”</p>
            </article>
          ))}
        </div>
      </section>

      {/* ---------------- HONEST ---------------- */}
      <section className="section honest" id="honest">
        <div className="section-head">
          <span className="landing-kicker">Honest by design</span>
          <h2>
            Momentum never invents <span className="grad">a measurement.</span>
          </h2>
          <p>
            A phone camera can't measure force or temperature. So every fact in
            a lesson wears a label, and the tutor is told which is which.
          </p>
        </div>
        <div className="labels">
          <div className="label-card">
            <span className="lab observed">Observed</span>
            <h3>What the camera saw</h3>
            <p>“The ball rises, then falls.” Image positions, timestamps, a pivot on screen.</p>
          </div>
          <div className="label-card">
            <span className="lab assumed">Assumed</span>
            <h3>What the model assumes</h3>
            <p>“Air resistance ignored. Ground frame treated as inertial.” Stated, never hidden.</p>
          </div>
          <div className="label-card">
            <span className="lab practice">Practice value</span>
            <h3>Hypothetical numbers</h3>
            <p>“10 N at 0.80 m.” Teaching values you can change — never presented as recovered from footage.</p>
          </div>
        </div>
      </section>

      {/* ---------------- FOR THE COURSE ---------------- */}
      <section className="section tiles-section">
        <div className="tiles">
          <div className="tile">
            <Repeat2 size={20} />
            <b>Predict → Test → Explain</b>
            <span>Every lesson runs the same research-backed loop, so the habit transfers.</span>
          </div>
          <div className="tile">
            <BookOpen size={20} />
            <b>Course-aware</b>
            <span>Coaching cites the week's lecture notes; questions map to the objectives.</span>
          </div>
          <div className="tile">
            <GraduationCap size={20} />
            <b>Recall that sticks</b>
            <span>Transfer questions days later, in a new setting — not the same clip again.</span>
          </div>
        </div>
      </section>

      {/* ---------------- FINAL CTA ---------------- */}
      <section className="final">
        <h2>
          Your next physics lesson is
          <br />
          <span className="grad">already on your camera roll.</span>
        </h2>
        <div className="hero-actions center">
          <button className="button primary hero-cta" onClick={onSample}>
            <Play size={16} /> Try the sample shot
          </button>
          <button className="landing-ghost big" onClick={onUpload}>
            <Upload size={16} /> Upload a recording
          </button>
        </div>
        <footer>
          <span>Momentum · a prototype for Minds &amp; Machines: AI in Education</span>
          <button className="text-button" onClick={onEnter}>
            Skip to the studio <ArrowRight size={13} />
          </button>
        </footer>
      </section>
    </div>
  );
}
