import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowDown,
  ArrowUp,
  Check,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Lightbulb,
  Bookmark,
  FlaskConical,
  Eye,
  Maximize,
  ChevronRight,
} from "lucide-react";
import {
  SHOT_EVENT,
  SHOT_QUESTIONS,
  eventTime,
  type CoachQuestion,
} from "../shared/coaching";
import type { Moment, LearningRecord } from "../shared/physics";
interface Props {
  moment: Moment;
  src: string;
  active: boolean;
  mode: string;
  onLab: () => void;
  onSave: (record: LearningRecord) => void;
  onReview: () => void;
  onProgress: (step: number) => void;
  alreadySaved: boolean;
}
export default function EventCoach({
  moment,
  src,
  active,
  mode,
  onLab,
  onSave,
  onReview,
  onProgress,
  alreadySaved,
}: Props) {
  const prepared = moment.id === "shot" && src === "/demo/basketball-shot.mp4";
  const media = prepared ? SHOT_EVENT.src : src,
    sourceStart = prepared ? 0 : moment.time,
    sourceEnd = prepared ? SHOT_EVENT.end - SHOT_EVENT.start : moment.end;
  const video = useRef<HTMLVideoElement>(null),
    stage = useRef<HTMLDivElement>(null),
    questionHeading = useRef<HTMLHeadingElement>(null),
    previousActive = useRef(active),
    replayDestination = useRef<"question" | "reflection" | "saved">("question");
  const [phase, setPhase] = useState<
      "watch" | "question" | "reflection" | "saved"
    >("watch"),
    [questionIndex, setQuestionIndex] = useState(0),
    [choice, setChoice] = useState<number | null>(null),
    [checked, setChecked] = useState(false),
    [showHint, setShowHint] = useState(false),
    [hints, setHints] = useState(0),
    [reflection, setReflection] = useState(""),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(sourceEnd - sourceStart),
    [playing, setPlaying] = useState(false),
    [muted, setMuted] = useState(true),
    [speed, setSpeed] = useState(0.75),
    [error, setError] = useState(""),
    [showDiagram, setShowDiagram] = useState(true),
    [showNotes, setShowNotes] = useState(false),
    [viewed, setViewed] = useState(false),
    [transitioning, setTransitioning] = useState(false),
    [aspect, setAspect] = useState(9 / 16);
  const generic: CoachQuestion = {
    ...SHOT_QUESTIONS[0],
    time: (moment.time + moment.end) / 2,
    chapter: "YOUR EVENT · GUIDED QUESTION",
    title: "Pause here.\nWhat do you notice?",
    prompt: moment.question,
    position: {
      x: moment.anchors[0]?.x ?? 0.5,
      y: moment.anchors[0]?.y ?? 0.25,
    },
  };
  const questions = prepared ? SHOT_QUESTIONS : [generic],
    q = questions[questionIndex],
    correct = checked && choice === q.correct;
  const diagramQuestion =
    phase === "reflection" || phase === "saved" ? SHOT_QUESTIONS[1] : q;
  const localFocus = prepared
    ? eventTime(q.time, SHOT_EVENT.start, SHOT_EVENT.end)
    : q.time;
  const showArrows =
    phase !== "watch" &&
    showDiagram &&
    (checked || showHint || phase === "reflection" || phase === "saved");
  function seekTo(value: number) {
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(sourceStart, Math.min(sourceEnd, value));
    setTime(v.currentTime - sourceStart);
  }
  function pauseForQuestion(index = questionIndex, focus = false) {
    const v = video.current;
    if (!v) return;
    v.pause();
    const target = questions[index];
    setQuestionIndex(index);
    setPhase("question");
    setViewed(true);
    setTransitioning(true);
    seekTo(
      prepared
        ? eventTime(target.time, SHOT_EVENT.start, SHOT_EVENT.end)
        : target.time,
    );
    onProgress(1);
    if (focus) window.setTimeout(() => questionHeading.current?.focus(), 100);
  }
  function watch() {
    setError("");
    if (phase !== "watch") replayDestination.current = phase;
    setPhase("watch");
    seekTo(sourceStart);
    video.current
      ?.play()
      .catch(() => setError("Press Play event to start the shot."));
  }
  function finishWatch() {
    if (replayDestination.current === "question") pauseForQuestion();
    else {
      video.current?.pause();
      setPhase(replayDestination.current);
      seekTo(
        prepared
          ? eventTime(SHOT_QUESTIONS[1].time, SHOT_EVENT.start, SHOT_EVENT.end)
          : localFocus,
      );
    }
  }
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const ready = () => {
      const end = Math.min(sourceEnd, v.duration);
      setDuration(Math.max(0, end - sourceStart));
      setAspect(v.videoWidth / v.videoHeight);
      v.currentTime = sourceStart;
      v.playbackRate = speed;
      if (active) v.play().catch(() => setPlaying(false));
    };
    if (v.readyState >= 1) ready();
    else v.addEventListener("loadedmetadata", ready, { once: true });
    return () => v.removeEventListener("loadedmetadata", ready);
  }, [media]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = speed;
  }, [speed]);
  useEffect(() => {
    if (!active) video.current?.pause();
    else if (!previousActive.current && phase === "watch") setPlaying(false);
    previousActive.current = active;
  }, [active, phase]);
  useEffect(() => {
    if (!active || phase !== "watch") return;
    const v = video.current;
    if (!v) return;
    let frame: number;
    const tick = () => {
      setTime(Math.max(0, v.currentTime - sourceStart));
      if (v.currentTime >= sourceEnd - 0.025 && !v.paused) {
        finishWatch();
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [active, phase, sourceEnd, sourceStart, questionIndex]);
  function next() {
    replayDestination.current = "question";
    setChoice(null);
    setChecked(false);
    setShowHint(false);
    if (questionIndex < questions.length - 1)
      pauseForQuestion(questionIndex + 1, true);
    else {
      setPhase("reflection");
      replayDestination.current = "reflection";
      onProgress(2);
      seekTo(prepared ? 1.2 : localFocus);
    }
  }
  function save() {
    onSave({
      id: moment.id,
      momentId: moment.id,
      title: moment.shortTitle,
      concept: moment.concept,
      answer:
        "Downward; vertical velocity is zero at the apex; horizontal velocity is constant",
      reflection: reflection.trim(),
      completedAt: new Date().toISOString(),
      hints,
      mode: prepared ? "rehearsal" : mode,
    });
    setPhase("saved");
    replayDestination.current = "saved";
    onProgress(3);
  }
  const absoluteTime = prepared ? SHOT_EVENT.start + time : sourceStart + time;
  return (
    <div className={`event-coach phase-${phase}`} ref={stage}>
      <div className="coach-stage-top">
        <div>
          <span className={`coach-status-dot ${playing ? "playing" : ""}`} />
          <span>
            {phase === "watch"
              ? "WATCH THE WHOLE EVENT"
              : phase === "saved"
                ? "A CONNECTION, MADE"
                : phase === "reflection"
                  ? "MAKE IT YOURS"
                  : "COACH’S PAUSE"}
          </span>
        </div>
        <span className="coach-event-length">
          {duration.toFixed(1)}s event <span>·</span> Basketball
        </span>
        <button
          className="icon-button"
          aria-label="Full screen coaching stage"
          onClick={() =>
            stage.current
              ?.requestFullscreen()
              .catch(() =>
                setError("Full screen is not available in this browser."),
              )
          }
        >
          <Maximize size={15} />
        </button>
      </div>
      <div className="coach-screen">
        <div
          className={`coach-footage ${phase !== "watch" ? "paused-for-coaching" : ""}`}
        >
          <div className="coach-frame" style={{ aspectRatio: String(aspect) }}>
            <video
              ref={video}
              src={media}
              muted={muted}
              playsInline
              preload="auto"
              poster={prepared ? "/demo/shot-poster.jpg" : undefined}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onEnded={finishWatch}
              onSeeked={() => setTransitioning(false)}
              onError={() =>
                setError(
                  "The event could not load. Replay it, or return to your recording.",
                )
              }
              onTimeUpdate={() => {
                if (video.current)
                  setTime(Math.max(0, video.current.currentTime - sourceStart));
              }}
            />
            {phase !== "watch" && prepared && showDiagram && !transitioning && (
              <svg
                className="coach-physics-overlay"
                viewBox="0 0 1080 1920"
                role="img"
                aria-label={
                  showArrows
                    ? "Ideal physics arrows anchored to the basketball: downward gravity and horizontal velocity. Arrows are conceptual, not measured."
                    : "Highlighted basketball in the paused teaching frame."
                }
              >
                <defs>
                  <marker
                    id="coach-force-tip"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M0 0L10 5L0 10" fill="#d6edb1" />
                  </marker>
                  <marker
                    id="coach-velocity-tip"
                    viewBox="0 0 10 10"
                    refX="8"
                    refY="5"
                    markerWidth="6"
                    markerHeight="6"
                    orient="auto"
                  >
                    <path d="M0 0L10 5L0 10" fill="#f1ba74" />
                  </marker>
                </defs>
                <g
                  transform={`translate(${diagramQuestion.position.x * 1080},${diagramQuestion.position.y * 1920})`}
                >
                  <circle r="79" fill="none" stroke="#f6f5dc" strokeWidth="5" />
                  <circle
                    r="92"
                    fill="none"
                    stroke="#f6f5dc66"
                    strokeWidth="2"
                    strokeDasharray="8 10"
                  />
                  {!showArrows && (
                    <g>
                      <path
                        d="M90 38L190 108H314"
                        stroke="#faf6dc"
                        strokeWidth="3"
                        fill="none"
                      />
                      <rect
                        x="185"
                        y="116"
                        width="265"
                        height="65"
                        rx="10"
                        fill="#203b2fed"
                      />
                      <text x="208" y="159" className="coach-svg-label">
                        Focus here
                      </text>
                    </g>
                  )}
                  {showArrows && (
                    <g className="physics-reveal">
                      <line
                        x1="0"
                        y1="91"
                        x2="0"
                        y2="390"
                        stroke="#d6edb1"
                        strokeWidth="11"
                        markerEnd="url(#coach-force-tip)"
                      />
                      <rect
                        x="29"
                        y="265"
                        width="257"
                        height="120"
                        rx="11"
                        fill="#1d392dec"
                      />
                      <text
                        x="52"
                        y="312"
                        className="coach-svg-label force-label"
                      >
                        Fɢ = mg
                      </text>
                      <text x="52" y="354" className="coach-svg-small">
                        gravity ↓
                      </text>
                      {(q.overlay !== "force" ||
                        phase === "reflection" ||
                        phase === "saved") && (
                        <>
                          <line
                            x1="-90"
                            y1="0"
                            x2="-365"
                            y2="0"
                            stroke="#f1ba74"
                            strokeWidth="10"
                            markerEnd="url(#coach-velocity-tip)"
                          />
                          <rect
                            x="-370"
                            y="40"
                            width="290"
                            height="84"
                            rx="9"
                            fill="#342b21ed"
                          />
                          <text
                            x="-350"
                            y="95"
                            className="coach-svg-label velocity-label"
                          >
                            vₓ = constant
                          </text>
                          {q.overlay === "apex" ||
                          phase === "reflection" ||
                          phase === "saved" ? (
                            <>
                              <path
                                d="M105-25V45M84 10H126"
                                stroke="#faf4df"
                                strokeWidth="5"
                              />
                              <rect
                                x="146"
                                y="-30"
                                width="280"
                                height="78"
                                rx="9"
                                fill="#243b30ed"
                              />
                              <text x="170" y="22" className="coach-svg-label">
                                vᵧ = 0
                              </text>
                            </>
                          ) : (
                            <>
                              <line
                                x1="-115"
                                y1="145"
                                x2="-115"
                                y2="380"
                                stroke="#f1ba74"
                                strokeWidth="9"
                                markerEnd="url(#coach-velocity-tip)"
                              />
                              <rect
                                x="-322"
                                y="250"
                                width="176"
                                height="74"
                                rx="9"
                                fill="#342b21ed"
                              />
                              <text
                                x="-290"
                                y="300"
                                className="coach-svg-label velocity-label"
                              >
                                vᵧ ↓
                              </text>
                            </>
                          )}
                        </>
                      )}
                    </g>
                  )}
                </g>
              </svg>
            )}
          </div>
          <div className="footage-caption">
            <span>
              {phase === "watch"
                ? "THE SHOT · UNINTERRUPTED"
                : "REAL FRAME · DETAIL VIEW"}
            </span>
            <span>
              {prepared
                ? `${absoluteTime.toFixed(2)}s in original`
                : "Selected event"}
            </span>
          </div>
          {phase !== "watch" && (
            <button className="frame-replay" onClick={watch}>
              <RotateCcw size={13} /> Watch the event again
            </button>
          )}
        </div>
        <section className="onscreen-coach" aria-label="Coach inside the video">
          <div className="onscreen-coach-identity">
            <span className="coach-signature">
              l<span>•</span>
            </span>
            <div>
              <strong>Momentum coach</strong>
              <span>
                {phase === "watch"
                  ? "Watch first"
                  : phase === "saved"
                    ? "Saved"
                    : "Question"}
              </span>
            </div>
            <span className="prepared-label">Guided demo</span>
          </div>
          {phase === "watch" ? (
            <div className="watch-introduction">
              <h2>Watch the full shot</h2>
              <p>
                Follow the ball from release to basket. Questions come after the
                complete event.
              </p>
              <div className="watch-sequence">
                <span>Release</span>
                <span className="sequence-line" />
                <span>Flight</span>
                <span className="sequence-line" />
                <span>Basket</span>
              </div>
              <button
                className="coach-cta"
                onClick={() => {
                  if (playing) video.current?.pause();
                  else
                    video.current
                      ?.play()
                      .catch(() => setError("Press Play event again."));
                }}
              >
                {playing ? <Pause size={15} /> : <Play size={15} />}{" "}
                {playing ? "Pause event" : "Play event"}
              </button>
              {viewed && (
                <button className="coach-text-button" onClick={finishWatch}>
                  Back to the coaching pause <ArrowRight size={13} />
                </button>
              )}
              <p className="coach-small-note">
                Only this {duration.toFixed(1)}-second event plays here.
              </p>
            </div>
          ) : phase === "question" ? (
            <div className="coach-question-body" key={q.id}>
              <div className="coach-question-kicker">
                <span>{q.chapter}</span>
                <span>
                  0{questionIndex + 1} / 0{questions.length}
                </span>
              </div>
              <h2 ref={questionHeading} tabIndex={-1}>
                {q.title.split("\n").map((line, i) => (
                  <span key={line}>{i === 1 ? <em>{line}</em> : line}</span>
                ))}
              </h2>
              <p className="coach-prompt">{q.prompt}</p>
              <div
                className="coach-answers"
                role="group"
                aria-label="Your prediction"
              >
                {q.options.map((option, i) => (
                  <button
                    key={option}
                    disabled={checked}
                    className={`${choice === i ? "is-chosen" : ""} ${checked && i === q.correct ? "is-correct" : ""} ${checked && choice === i && i !== q.correct ? "is-incorrect" : ""}`}
                    aria-pressed={choice === i}
                    onClick={() => setChoice(i)}
                  >
                    <span className="answer-letter">
                      {String.fromCharCode(65 + i)}
                    </span>
                    <span>{option}</span>
                    {checked && i === q.correct ? (
                      <Check size={17} />
                    ) : i === 0 && q.overlay === "force" ? (
                      <ArrowDown size={16} />
                    ) : i === 1 && q.overlay === "force" ? (
                      <ArrowUp size={16} />
                    ) : null}
                  </button>
                ))}
              </div>
              {checked ? (
                <div
                  className={`coach-feedback ${correct ? "correct" : "reconsider"}`}
                  role="status"
                >
                  <strong>
                    {correct
                      ? "Exactly. Here’s the connection."
                      : "A useful first thought. Look again."}
                  </strong>
                  <p>{q.explanation}</p>
                </div>
              ) : showHint ? (
                <div className="coach-hint" role="status">
                  <Lightbulb size={16} />
                  <p>{q.hint}</p>
                </div>
              ) : null}
              <div className="coach-answer-actions">
                {checked ? (
                  <button
                    className="coach-cta"
                    onClick={
                      correct
                        ? next
                        : () => {
                            setChecked(false);
                            setChoice(null);
                          }
                    }
                  >
                    {correct
                      ? questionIndex < questions.length - 1
                        ? "Next coaching pause"
                        : "Make this idea yours"
                      : "Try that again"}{" "}
                    <ArrowRight size={16} />
                  </button>
                ) : (
                  <button
                    className="coach-cta"
                    disabled={choice === null}
                    onClick={() => setChecked(true)}
                  >
                    Check my thinking <ArrowRight size={16} />
                  </button>
                )}
                {!checked && (
                  <button
                    className="coach-text-button"
                    disabled={showHint}
                    onClick={() => {
                      setShowHint(true);
                      setHints((h) => h + 1);
                    }}
                  >
                    <Lightbulb size={13} /> A small hint
                  </button>
                )}
              </div>
            </div>
          ) : phase === "reflection" ? (
            <div className="coach-reflection">
              <span className="coach-question-kicker">
                YOUR TURN TO TEACH IT BACK
              </span>
              <h2>
                One sentence.
                <br />
                <em>In your own words.</em>
              </h2>
              <p>Why does gravity still act when the ball stops rising?</p>
              <label className="sr-only" htmlFor="coach-reflection">
                Your explanation
              </label>
              <textarea
                id="coach-reflection"
                value={reflection}
                onChange={(e) => setReflection(e.target.value)}
                maxLength={1500}
                rows={4}
                placeholder="At the top, the ball still accelerates downward because…"
              />
              <button
                className="coach-cta"
                disabled={reflection.trim().length < 10}
                onClick={save}
              >
                <Bookmark size={16} />
                {alreadySaved ? "Update my notebook" : "Save my connection"}
              </button>
              <button className="coach-text-button" onClick={onLab}>
                <FlaskConical size={14} /> Experiment before you explain{" "}
                <ArrowRight size={13} />
              </button>
              <p className="coach-small-note">
                Saved as written. Your explanation isn’t automatically graded.
              </p>
            </div>
          ) : (
            <div className="coach-saved">
              <span className="coach-success-mark">
                <Check size={25} />
              </span>
              <span className="coach-question-kicker">
                ONE EVENT. A LASTING CONNECTION.
              </span>
              <h2>
                Now you see
                <br />
                <em>more than a shot.</em>
              </h2>
              <p>
                Your explanation is in your notebook. Carry the idea into
                another situation.
              </p>
              <button className="coach-cta" onClick={onReview}>
                Try a new setting <ArrowRight size={16} />
              </button>
              <button className="coach-text-button" onClick={onLab}>
                <FlaskConical size={14} /> Keep playing with the physics
              </button>
            </div>
          )}
        </section>
      </div>
      <div className="coach-transport">
        <button
          className="icon-button"
          aria-label={playing ? "Pause event" : "Play event"}
          onClick={() => {
            if (playing) video.current?.pause();
            else if (phase === "watch")
              video.current
                ?.play()
                .catch(() => setError("Press Play event again."));
            else watch();
          }}
        >
          {playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
        <span className="coach-time">
          {Math.min(duration, time).toFixed(1)}{" "}
          <span>/ {duration.toFixed(1)} s</span>
        </span>
        <div className="event-scrubber">
          <input
            aria-label="Event time"
            type="range"
            min="0"
            max={duration || 0.1}
            step=".01"
            value={Math.min(duration, time)}
            onChange={(e) => {
              video.current?.pause();
              seekTo(sourceStart + Number(e.target.value));
              if (phase !== "watch") setPhase("watch");
            }}
          />
          <div className="event-checkpoint-pins">
            {prepared &&
              [0.7, 1.2, 1.5].map((t, i) => (
                <span key={i} style={{ left: `${(t / duration) * 100}%` }} />
              ))}
          </div>
        </div>
        <select
          aria-label="Event playback speed"
          value={speed}
          onChange={(e) => setSpeed(Number(e.target.value))}
        >
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="0.75">0.75×</option>
          <option value="1">1×</option>
        </select>
        <button
          className="icon-button"
          aria-label={muted ? "Turn event sound on" : "Mute event sound"}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
        </button>
        {phase !== "watch" && (
          <button
            className="diagram-toggle"
            aria-label="Annotations"
            aria-pressed={showDiagram}
            onClick={() => setShowDiagram(!showDiagram)}
          >
            <Eye size={14} />
            <span>Annotations</span>
          </button>
        )}
      </div>
      {error && (
        <div className="coach-error" role="alert">
          {error}
          <button onClick={watch}>Replay</button>
        </div>
      )}
      <div className="coach-evidence-bar">
        <span>
          <span className="evidence-key footage-key" /> Real video
        </span>
        <span>
          <span className="evidence-key model-key" />{" "}
          {showArrows
            ? "Ideal-model arrows"
            : "Model arrows appear with feedback"}
        </span>
        <button
          onClick={() => setShowNotes(!showNotes)}
          aria-expanded={showNotes}
        >
          About this frame <ChevronRight size={12} />
        </button>
      </div>
      {showNotes && (
        <div className="coach-evidence-notes">
          The detail view enlarges the ball and its surroundings. Replay shows
          the full frame. The first teaching frame is near the apparent top of
          the arc, not a calibrated measurement of the exact apex. Camera motion
          changes screen coordinates. The arrows explain an ideal, ground-based
          physics model and do not show forces or speeds measured from this
          clip. Prepared questions are part of the demo.
        </div>
      )}
    </div>
  );
}
