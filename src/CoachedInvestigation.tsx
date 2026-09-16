import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  Eye,
  FlaskConical,
  MessageCircle,
  CircleHelp,
} from "lucide-react";
import type { Moment, LearningRecord } from "../shared/physics";
import Models, { type ModelState } from "./Models";
import EventCoach from "./EventCoach";
import PhysicsLounge from "./PhysicsLounge";
import LegacyInvestigation from "./Investigation";
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
  onGuide: () => void;
}
export default function CoachedInvestigation({
  moment,
  src,
  mode,
  onBack,
  onSave,
  onCourse,
  onNext,
  onUpdate,
  alreadySaved,
  onGuide,
}: Props) {
  const [view, setView] = useState<"coach" | "lab">("coach"),
    [progress, setProgress] = useState(0),
    [lounge, setLounge] = useState(false),
    [state, setState] = useState<ModelState>({
      force: 10,
      radius: 0.8,
      angle: 52,
      speed: 9.5,
      height: 2,
    });
  const loungeSlot = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (lounge)
      loungeSlot.current?.scrollIntoView({
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
          ? "instant"
          : "smooth",
        block: "nearest",
      });
  }, [lounge]);
  if (moment.id !== "shot" || src !== "/demo/basketball-shot.mp4")
    return (
      <LegacyInvestigation
        {...{
          moment,
          src,
          mode,
          onBack,
          onSave,
          onCourse,
          onNext,
          onUpdate,
          alreadySaved,
        }}
      />
    );
  return (
    <section
      className={`coaching-workspace page-enter ${lounge ? "lounge-open" : ""}`}
    >
      <div className="event-breadcrumb">
        <button className="text-button" onClick={onBack}>
          <ArrowLeft size={14} /> Your day
        </button>
        <span>/</span>
        <span>Basketball</span>
        <span>/</span>
        <strong>Guided event</strong>
        <button className="event-help" onClick={onGuide}>
          <CircleHelp size={14} /> How this works
        </button>
      </div>
      <div className="event-heading">
        <div>
          <span className="eyebrow">
            AN EVERYDAY MOMENT. YOUR NEXT CONNECTION.
          </span>
          <h1>
            There’s more to <em>this shot.</em>
          </h1>
        </div>
        <button
          className={`lounge-launch ${lounge ? "is-open" : ""}`}
          aria-expanded={lounge}
          aria-controls="physics-lounge"
          aria-label="Physics lounge"
          onClick={() => setLounge(!lounge)}
        >
          <MessageCircle size={17} />
          <span>
            Physics lounge<small>Ask about anything physics</small>
          </span>
          <span className="lounge-launch-plus">{lounge ? "−" : "+"}</span>
        </button>
      </div>
      <div className="event-workbar">
        <div
          className="event-view-tabs"
          role="tablist"
          aria-label="Event workspace"
        >
          <button
            role="tab"
            aria-selected={view === "coach"}
            onClick={() => setView("coach")}
          >
            <Eye size={16} /> Watch & wonder
          </button>
          <button
            role="tab"
            aria-selected={view === "lab"}
            onClick={() => setView("lab")}
          >
            <FlaskConical size={16} /> Play with physics <span>LAB</span>
          </button>
        </div>
        <div className="event-mini-progress" aria-label="Learning progress">
          {["Watch", "Think", "Explain"].map((label, i) => (
            <span key={label} className={progress >= i ? "reached" : ""}>
              <span>{progress > i ? <Check size={9} /> : i + 1}</span>
              {label}
            </span>
          ))}
        </div>
      </div>
      <div className="coach-workspace-grid">
        <div className="coaching-main">
          <div hidden={view !== "coach"}>
            <EventCoach
              moment={moment}
              src={src}
              active={view === "coach"}
              mode={mode}
              onLab={() => setView("lab")}
              onSave={onSave}
              onReview={onNext}
              onProgress={setProgress}
              alreadySaved={alreadySaved}
            />
          </div>
          {view === "lab" && (
            <div className="event-lab-view">
              <div className="lab-brief">
                <span className="eyebrow">
                  FROM THE REAL SHOT TO A TESTABLE IDEA
                </span>
                <h2>
                  Change the shot.
                  <br />
                  <em>Keep asking why.</em>
                </h2>
                <p>
                  Try a different launch angle. Pause at the top. Notice what
                  changes—and what gravity keeps doing.
                </p>
                <div className="lab-brief-insight">
                  <span>Try this</span>
                  <strong>Make the arc higher.</strong>
                  <p>
                    At the same launch speed, does a steeper angle give the ball
                    more time in the air?
                  </p>
                </div>
                <button
                  className="button primary"
                  onClick={() => setView("coach")}
                >
                  Back to your coaching pause <ArrowRight size={15} />
                </button>
                <span className="lab-brief-footnote">
                  These controls are hypothetical. They don’t estimate the
                  player’s actual shot.
                </span>
              </div>
              <Models
                concept={moment.concept}
                state={state}
                setState={setState}
              />
            </div>
          )}
          <div className="event-afterword">
            <div>
              <span className="afterword-number">04.2</span>
              <p>
                <strong>Velocity tells us how it moves.</strong>
                <br />
                Acceleration tells us how that motion changes.
              </p>
            </div>
            <button className="text-button" onClick={onCourse}>
              <BookOpen size={15} /> Connect it to class{" "}
              <ArrowRight size={13} />
            </button>
          </div>
        </div>
        <div
          className="lounge-slot"
          id="physics-lounge"
          ref={loungeSlot}
          hidden={!lounge}
        >
          <PhysicsLounge
            mode={mode}
            moment={moment}
            state={state}
            onClose={() => setLounge(false)}
          />
        </div>
      </div>
    </section>
  );
}
