import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowRight,
  Check,
  Crosshair,
  Eye,
  EyeOff,
  FlaskConical,
  Lightbulb,
  MousePointerClick,
  MoveUpRight,
  Pause,
  Play,
  RotateCcw,
  Route,
  Sparkles,
  Timer,
  X,
} from "lucide-react";
import type { Question, StudioSpec } from "../../../shared/studio/schema";
import { QUANTITY_COLORS } from "../lab/draw";
import Overlays, { RichText, type ClearSpot, type GhostImage } from "./Overlays";
import {
  QUESTION_KIND,
  angleDifference,
  candidatePaths,
  emptyAttempt,
  grade,
  hasAnswer,
  readResults,
  writeResults,
  type Attempt,
  type QuizResult,
} from "./quiz";
import { anchorAt, trackAt, trackPath } from "./tracks";

type Phase = "intro" | "watch" | "question" | "feedback" | "done";

const TYPE_ICONS: Record<Question["type"], typeof Crosshair> = {
  choice: Lightbulb,
  vector: MoveUpRight,
  hotspot: Crosshair,
  scrub: Timer,
  path: Route,
};

/** Studios built before captions were fitted server-side can end mid-word; end them cleanly. */
function tidyCaption(text: string, limit: number) {
  if (text.length < limit || /[.!?…]$/.test(text)) return text;
  const sentence = Math.max(text.lastIndexOf(". "), text.lastIndexOf("! "), text.lastIndexOf("? "));
  if (sentence > limit * 0.4) return text.slice(0, sentence + 1);
  return `${text.slice(0, text.lastIndexOf(" ")).replace(/[\s,;:—-]+$/, "")}…`;
}

function formatClock(seconds: number) {
  return `${Math.max(0, seconds).toFixed(1)}`;
}

export default function EventTheater({
  spec,
  storageKey,
  posterUrl,
  sourceLabel,
  onOpenLab,
}: {
  spec: StudioSpec;
  storageKey: string;
  posterUrl: string | null;
  sourceLabel: string;
  onOpenLab: () => void;
}) {
  const duration = spec.clip.durationSeconds;
  const W = 1000;
  const H = (1000 * spec.clip.height) / spec.clip.width;
  const tracks = useMemo(() => new Map(spec.annotations.tracks.map((track) => [track.id, track])), [spec]);
  const quiz = spec.quiz;
  const resultsKey = `${storageKey}:quiz`;

  const video = useRef<HTMLVideoElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  // Quiz marks keep a constant on-screen size however small the frame renders.
  const [frameWidth, setFrameWidth] = useState(700);
  useEffect(() => {
    const element = frame.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width > 0) setFrameWidth(entry.contentRect.width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const mark = 700 / Math.max(240, frameWidth);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [rate, setRate] = useState(1);
  const [annotations, setAnnotations] = useState(true);
  const [phase, setPhase] = useState<Phase>("intro");
  const [qIndex, setQIndex] = useState(0);
  const [results, setResults] = useState<Record<string, QuizResult>>(() => readResults(resultsKey));
  const [attempt, setAttempt] = useState<Attempt>(emptyAttempt);
  const [reveal, setReveal] = useState<{ ids: string[]; startedAt: number } | null>(null);
  const [freeze, setFreeze] = useState<{ caption: string; startedAt: number; hold: number } | null>(null);
  const [now, setNow] = useState(() => performance.now());
  const [ghosts, setGhosts] = useState<Record<string, GhostImage[]>>({});
  const [answerRun, setAnswerRun] = useState<{ from: number; to: number } | null>(null);
  const [error, setError] = useState("");

  const refs = useRef({ phase, results, annotations, rate, freeze, reveal, answerRun, lastTime: 0 });
  refs.current = { ...refs.current, phase, results, annotations, rate, freeze, reveal, answerRun };
  const fired = useRef(new Set<number>());

  const question = phase === "question" || phase === "feedback" ? quiz[qIndex] : null;
  const paths = useMemo(() => (question?.type === "path" ? candidatePaths(spec, question) : null), [spec, question]);
  const answered = quiz.filter((item) => results[item.id]).length;
  const firstTry = quiz.filter((item) => results[item.id]?.outcome === "first").length;

  const seek = (time: number) => {
    const element = video.current;
    const clamped = Math.min(duration, Math.max(0, time));
    if (element) element.currentTime = clamped;
    refs.current.lastTime = clamped;
    setT(clamped);
  };

  const play = () => {
    const element = video.current;
    if (!element) return;
    if (element.currentTime >= duration - 0.05) seek(0);
    // A refused autoplay just leaves the clip paused; the play button shows that.
    element.play().catch(() => undefined);
  };

  const pause = () => video.current?.pause();

  function openQuestion(index: number) {
    const target = quiz[index];
    if (!target) return;
    pause();
    seek(target.t);
    setQIndex(index);
    setAttempt({ ...emptyAttempt(), scrubT: target.type === "scrub" ? null : null });
    setReveal(null);
    setAnswerRun(null);
    setFreeze(null);
    setPhase("question");
  }

  function finish(correct: boolean, attempts: number) {
    const target = quiz[qIndex];
    const outcome = correct ? (attempts === 1 ? "first" : "second") : "missed";
    const next = { ...refs.current.results, [target.id]: { outcome, attempts } as QuizResult };
    setResults(next);
    writeResults(resultsKey, next);
    setReveal({ ids: target.reveal, startedAt: performance.now() });
    setPhase("feedback");
    if (target.type === "scrub") seek(target.answerT);
    if (target.type === "path") {
      seek(target.t);
      setAnswerRun({ from: target.t, to: Math.min(duration, target.t + target.horizonS) });
      const element = video.current;
      if (element) {
        element.playbackRate = 0.5;
        element.play().catch(() => undefined);
      }
    }
  }

  function check() {
    if (!question) return;
    const result = grade(spec, question, attempt, paths);
    const attempts = attempt.attempts + 1;
    if (result.correct || attempts >= 2) finish(result.correct, attempts);
    else setAttempt({ ...attempt, attempts, wrong: true });
  }

  function continueQuiz() {
    setReveal(null);
    setAnswerRun(null);
    const remaining = quiz.findIndex((item) => !refs.current.results[item.id]);
    if (remaining < 0) {
      setPhase("done");
      play();
      return;
    }
    setPhase("watch");
    const target = quiz[remaining];
    if (target.t < (video.current?.currentTime ?? 0) - 0.05) openQuestion(remaining);
    else play();
  }

  function start() {
    setError("");
    fired.current.clear();
    if (answered === quiz.length) setPhase("done");
    else setPhase("watch");
    seek(0);
    play();
  }

  function retake() {
    setResults({});
    writeResults(resultsKey, {});
    refs.current.results = {};
    setReveal(null);
    setPhase("watch");
    fired.current.clear();
    seek(0);
    play();
  }

  // One animation loop drives the clock, guided pauses, slow motion and freezes.
  useEffect(() => {
    let id = 0;
    const loop = () => {
      const element = video.current;
      const current = performance.now();
      const state = refs.current;
      if (element) {
        const time = element.currentTime;
        setT((previous) => (Math.abs(previous - time) > 1e-4 ? time : previous));
        if (!element.paused) {
          const segment = state.annotations
            ? spec.annotations.slowmo.find((item) => time >= item.from && time < item.to)
            : undefined;
          const desired = state.answerRun ? 0.5 : state.rate * (segment ? segment.rate : 1);
          if (Math.abs(element.playbackRate - desired) > 0.001) element.playbackRate = desired;
          const last = state.lastTime;
          if (state.phase === "watch") {
            const index = quiz.findIndex(
              (item) => !state.results[item.id] && time >= item.t - 0.03 && last <= item.t + 0.06,
            );
            if (index >= 0) {
              openQuestion(index);
              state.lastTime = element.currentTime;
              id = requestAnimationFrame(loop);
              return;
            }
          }
          if (state.phase === "feedback" && state.answerRun && time >= state.answerRun.to) {
            element.pause();
            setAnswerRun({ ...state.answerRun, to: -1 });
          }
          if ((state.phase === "watch" || state.phase === "done") && state.annotations && !state.freeze) {
            spec.annotations.freezes.forEach((item, index) => {
              if (!fired.current.has(index) && last < item.t && time >= item.t) {
                fired.current.add(index);
                element.pause();
                element.currentTime = item.t;
                setFreeze({ caption: item.caption, startedAt: current, hold: item.holdSeconds });
              }
            });
          }
          state.lastTime = time;
        }
      }
      if (state.freeze) {
        setNow(current);
        if (current - state.freeze.startedAt >= state.freeze.hold * 1000) {
          setFreeze(null);
          refs.current.freeze = null;
          if (state.phase === "watch" || state.phase === "done") element?.play().catch(() => undefined);
        }
      } else if (state.reveal && current - state.reveal.startedAt < 2400) setNow(current);
      id = requestAnimationFrame(loop);
    };
    id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, [spec]);

  // Strobe "ghosts": real pixels of the moving object cut from earlier frames.
  useEffect(() => {
    const wanted = [...spec.annotations.overlays, ...spec.revealOverlays].filter(
      (overlay): overlay is Extract<typeof overlay, { type: "ghosts" }> => overlay.type === "ghosts",
    );
    if (!wanted.length) return;
    let cancelled = false;
    const source = document.createElement("video");
    source.muted = true;
    source.playsInline = true;
    source.preload = "auto";
    source.src = spec.clip.url;
    const ready = () =>
      new Promise<void>((resolve) => {
        if (source.readyState >= 2) resolve();
        else source.addEventListener("loadeddata", () => resolve(), { once: true });
      });
    const seekTo = (time: number) =>
      new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 2500);
        source.addEventListener(
          "seeked",
          () => {
            window.clearTimeout(timer);
            resolve();
          },
          { once: true },
        );
        source.currentTime = time;
      });
    (async () => {
      await ready();
      const output: Record<string, GhostImage[]> = {};
      for (const overlay of wanted) {
        const track = tracks.get(overlay.track);
        const images: GhostImage[] = [];
        for (const time of overlay.times) {
          const p = trackAt(track, time);
          if (!p || cancelled) continue;
          await seekTo(time);
          const vw = source.videoWidth;
          const vh = source.videoHeight;
          const size = Math.max(p.w * vw, p.h * vh) * 1.6;
          const edge = Math.max(24, Math.min(220, Math.round(size)));
          const canvas = document.createElement("canvas");
          canvas.width = edge;
          canvas.height = edge;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          ctx.drawImage(source, p.x * vw - size / 2, p.y * vh - size / 2, size, size, 0, 0, edge, edge);
          ctx.globalCompositeOperation = "destination-in";
          const mask = ctx.createRadialGradient(edge / 2, edge / 2, edge * 0.2, edge / 2, edge / 2, edge / 2);
          mask.addColorStop(0, "rgba(0,0,0,1)");
          mask.addColorStop(1, "rgba(0,0,0,0)");
          ctx.fillStyle = mask;
          ctx.fillRect(0, 0, edge, edge);
          try {
            images.push({ t: time, url: canvas.toDataURL("image/png"), x: p.x, y: p.y, w: size / vw, h: size / vh });
          } catch {
            // A tainted canvas (cross-origin media) simply skips ghosts.
          }
        }
        output[overlay.id] = images;
      }
      if (!cancelled) setGhosts(output);
    })().catch(() => undefined);
    return () => {
      cancelled = true;
      source.removeAttribute("src");
      source.load();
    };
  }, [spec, tracks]);

  useEffect(() => {
    const element = video.current;
    if (element) element.playbackRate = rate;
  }, [rate]);

  const pointer = (event: React.PointerEvent) => {
    const rect = frame.current!.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const interactive = phase === "question" && question && ["vector", "hotspot", "path"].includes(question.type);

  function handlePointer(event: React.PointerEvent, down: boolean) {
    if (!question || phase !== "question") return;
    if (!down && event.buttons === 0) return;
    const p = pointer(event);
    if (question.type === "vector") {
      const origin = anchorAt(question.anchor, tracks, question.t);
      if (!origin) return;
      const dx = (p.x - origin.x) * W;
      const dy = (p.y - origin.y) * H;
      if (Math.hypot(dx, dy) < 8) return;
      setAttempt((current) => ({ ...current, angle: (Math.atan2(-dy, dx) * 180) / Math.PI, wrong: false }));
    } else if (question.type === "hotspot" && down) {
      setAttempt((current) => ({ ...current, point: p, wrong: false }));
    } else if (question.type === "path" && down && paths) {
      let best = -1;
      let bestDistance = Infinity;
      paths.forEach((candidate, index) => {
        for (const point of candidate.points) {
          const distance = Math.hypot(point.x - p.x * W, point.y - p.y * H);
          if (distance < bestDistance) {
            bestDistance = distance;
            best = index;
          }
        }
      });
      if (best >= 0 && bestDistance < 60) setAttempt((current) => ({ ...current, path: best, wrong: false }));
    }
  }

  // Quiz drawings on top of the telestration.
  let extra: ReactNode = null;
  if (question) {
    const revealed = phase === "feedback";
    if (question.type === "vector") {
      const origin = anchorAt(question.anchor, tracks, question.t);
      if (origin) {
        const x0 = origin.x * W;
        const y0 = origin.y * H;
        const ray = (deg: number, length: number) => {
          const rad = (deg * Math.PI) / 180;
          return [x0 + Math.cos(rad) * length, y0 - Math.sin(rad) * length];
        };
        const color = QUANTITY_COLORS[question.quantity];
        const reveal = revealed ? Math.min(1, (now - (refs.current.reveal?.startedAt ?? now)) / 600) : 0;
        extra = (
          <g className="qz-vector">
            <circle cx={x0} cy={y0} r={26 * mark} className="qz-anchor-pulse" />
            <circle cx={x0} cy={y0} r={8 * mark} className="qz-anchor" />
            {attempt.angle !== null && (
              <g className={revealed ? (results[question.id]?.outcome === "missed" ? "qz-user is-wrong" : "qz-user is-right") : "qz-user"}>
                <line x1={x0} y1={y0} x2={ray(attempt.angle, 150 * mark)[0]} y2={ray(attempt.angle, 150 * mark)[1]} />
                <circle cx={ray(attempt.angle, 150 * mark)[0]} cy={ray(attempt.angle, 150 * mark)[1]} r={9 * mark} />
              </g>
            )}
            {revealed && (
              <g opacity={reveal}>
                <line x1={x0} y1={y0} x2={ray(question.answerDeg, 170 * mark * reveal)[0]} y2={ray(question.answerDeg, 170 * mark * reveal)[1]} stroke={color} strokeWidth={7 * mark} strokeLinecap="round" />
                <circle cx={ray(question.answerDeg, 170 * mark * reveal)[0]} cy={ray(question.answerDeg, 170 * mark * reveal)[1]} r={9 * mark} fill={color} />
              </g>
            )}
          </g>
        );
      }
    } else if (question.type === "hotspot") {
      const target = anchorAt(question.target, tracks, question.t);
      extra = (
        <g className="qz-hotspot">
          {attempt.point && (
            <g transform={`translate(${attempt.point.x * W} ${attempt.point.y * H}) scale(${mark})`} className="qz-mark">
              <circle r={18} />
              <path d="M-30 0H-10M10 0H30M0-30V-10M0 10V30" />
            </g>
          )}
          {revealed && target && (
            <g transform={`translate(${target.x * W} ${target.y * H})`} className="qz-target">
              <circle r={question.radius * W} />
              <circle r={8 * mark} className="qz-target-dot" />
            </g>
          )}
        </g>
      );
    } else if (question.type === "path" && paths) {
      const trail = answerRun ? trackPath(tracks.get(question.track), answerRun.from, Math.max(answerRun.from, t), 1 / 60) : [];
      extra = (
        <g className="qz-paths">
          {paths.map((candidate, index) => {
            const state = revealed
              ? candidate.correct
                ? "is-right"
                : attempt.path === index
                  ? "is-wrong"
                  : "is-dim"
              : attempt.path === index
                ? "is-chosen"
                : "";
            const end = candidate.points.at(-1)!;
            return (
              <g key={candidate.letter} className={`qz-path ${state}`}>
                <polyline points={candidate.points.map((p) => `${p.x},${p.y}`).join(" ")} />
                <circle cx={end.x} cy={end.y} r={17} />
                <text x={end.x} y={end.y + 6}>
                  {candidate.letter}
                </text>
              </g>
            );
          })}
          {trail.length > 1 && (
            <polyline className="qz-real-trail" points={trail.map((p) => `${p.x * W},${p.y * H}`).join(" ")} filter="url(#ov-glow)" />
          )}
        </g>
      );
    }
  }

  const chapter = [...spec.annotations.chapters].reverse().find((item) => t >= item.t - 0.01) ?? null;
  const slowmo = annotations && spec.annotations.slowmo.find((item) => t >= item.from && t < item.to);
  const overlayMode = !annotations ? "hidden" : phase === "question" ? "question" : phase === "feedback" ? "reveal" : "timeline";
  // While an answer is revealed, labels keep clear of the spot the question was about.
  const clear: ClearSpot[] = [];
  if (question && phase === "feedback") {
    const spot =
      question.type === "vector"
        ? anchorAt(question.anchor, tracks, question.t)
        : question.type === "hotspot"
          ? anchorAt(question.target, tracks, question.t)
          : null;
    if (spot) clear.push({ x: spot.x, y: spot.y, radius: question.type === "hotspot" ? question.radius : (170 * mark + 24) / W });
  }
  const strip: "instruction" | "freeze" | "chapter" | null =
    phase === "question" ? "instruction" : freeze ? "freeze" : chapter && (phase === "watch" || phase === "done") ? "chapter" : null;
  const feedback = question && phase === "feedback" ? grade(spec, question, attempt, paths) : null;
  const wrongDetail = question && attempt.wrong ? grade(spec, question, attempt, paths) : null;

  return (
    <section className={`theater phase-${phase}`} aria-label="Annotated event video with quiz">
      <div className="theater-stage">
        {posterUrl && <div className="theater-backdrop" style={{ backgroundImage: `url(${posterUrl})` }} aria-hidden="true" />}
        <div
          className={`theater-frame ${interactive ? `is-${question!.type}` : ""}`}
          ref={frame}
          style={{ "--aspect": spec.clip.width / spec.clip.height } as React.CSSProperties}
          onPointerDown={(event) => {
            if (!interactive) return;
            (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
            handlePointer(event, true);
          }}
          onPointerMove={(event) => interactive && handlePointer(event, false)}
        >
          <video
            ref={video}
            src={spec.clip.url}
            poster={posterUrl ?? undefined}
            muted
            playsInline
            preload="auto"
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onSeeked={() => {
              const time = video.current?.currentTime ?? 0;
              refs.current.lastTime = time;
              spec.annotations.freezes.forEach((item, index) => {
                if (item.t > time + 0.02) fired.current.delete(index);
              });
            }}
            onEnded={() => {
              if (refs.current.phase === "watch") {
                const remaining = quiz.findIndex((item) => !refs.current.results[item.id]);
                if (remaining >= 0) openQuestion(remaining);
                else setPhase("done");
              }
            }}
            onError={() => setError("This clip could not load. It may have expired with its analysis session.")}
          />
          <Overlays
            spec={spec}
            t={t}
            mode={overlayMode}
            reveal={reveal}
            now={now}
            ghosts={ghosts}
            clear={clear}
            extra={extra}
          />

          {phase === "intro" && (
            <button className="theater-intro" onClick={start}>
              <span className="theater-intro-play">
                <Play size={30} fill="currentColor" />
              </span>
              <span className="theater-intro-copy">
                <b>{answered === quiz.length && quiz.length ? "Watch again" : "Watch the moment"}</b>
                <small>
                  {duration.toFixed(1)} s · pauses {quiz.length} {quiz.length === 1 ? "time" : "times"} for you to answer
                </small>
              </span>
            </button>
          )}
          {error && (
            <div className="theater-error" role="alert">
              {error}
            </div>
          )}
        </div>

        {/* Narration lives under the picture, never on top of it. */}
        <div className={`theater-strip ${strip ? `is-${strip}` : ""}`}>
          <div
            className="theater-strip-main"
            role="status"
            key={strip === "chapter" ? `c${chapter?.t}` : strip === "freeze" ? `f${freeze?.startedAt}` : `${strip}-${question?.id ?? ""}`}
          >
            {strip === "instruction" && question && (
              <>
                <span className="strip-kicker">
                  {(() => {
                    const Icon = question.type === "hotspot" ? MousePointerClick : TYPE_ICONS[question.type];
                    return <Icon size={12} />;
                  })()}
                  Your turn
                </span>
                <span className="strip-text">
                  {QUESTION_KIND[question.type].verb}
                  {question.type === "vector" && attempt.angle !== null && <b>{Math.round(((attempt.angle % 360) + 360) % 360)}°</b>}
                </span>
              </>
            )}
            {strip === "freeze" && freeze && (
              <>
                <span className="strip-kicker">
                  <Pause size={11} /> Freeze frame
                </span>
                <span className="strip-text">
                  <RichText text={tidyCaption(freeze.caption, 90)} />
                </span>
                <span className="theater-freeze-bar">
                  <i style={{ width: `${Math.min(100, ((now - freeze.startedAt) / (freeze.hold * 1000)) * 100)}%` }} />
                </span>
              </>
            )}
            {strip === "chapter" && chapter && (
              <>
                <span className="strip-kicker">
                  {chapter.title}
                  {slowmo && <span className="strip-slow">{slowmo.rate}× slow motion</span>}
                </span>
                <span className="strip-text">
                  <RichText text={tidyCaption(chapter.caption, 120)} />
                </span>
              </>
            )}
          </div>
          <div className="theater-strip-meta">
            <span className="theater-chip">
              <span className="theater-rec" /> Real footage
            </span>
            {annotations && (
              <span className="theater-chip is-ai">
                <Sparkles size={11} /> {sourceLabel}
              </span>
            )}
          </div>
        </div>
      </div>

      <Transport
        spec={spec}
        t={t}
        playing={playing}
        rate={rate}
        annotations={annotations}
        results={results}
        phase={phase}
        questionIndex={qIndex}
        scrubbing={question?.type === "scrub" && phase === "question"}
        scrubAnswer={question?.type === "scrub" && phase === "feedback" ? { user: attempt.scrubT, answer: question.answerT } : null}
        onToggle={() => {
          if (playing) pause();
          else if (phase === "intro") start();
          else if (phase === "question") return;
          else play();
        }}
        onSeek={(time) => {
          if (phase === "question" && question?.type !== "scrub") return;
          pause();
          seek(time);
          if (question?.type === "scrub" && phase === "question")
            setAttempt((current) => ({ ...current, scrubT: time, wrong: false }));
        }}
        onRestart={() => {
          fired.current.clear();
          if (phase === "intro") start();
          else {
            seek(0);
            if (phase !== "question") play();
          }
        }}
        onRate={setRate}
        onAnnotations={() => setAnnotations(!annotations)}
        onJump={(index) => openQuestion(index)}
      />

      <aside className={`quiz-dock phase-${phase}`} aria-live="polite">
        <div className="quiz-dock-head">
          <span className="quiz-dock-title">In-video quiz</span>
          <div className="quiz-dots" role="list">
            {quiz.map((item, index) => {
              const result = results[item.id];
              const current = question && index === qIndex;
              return (
                <button
                  key={item.id}
                  role="listitem"
                  aria-label={`Question ${index + 1}${result ? `, ${result.outcome === "missed" ? "missed" : "answered"}` : ""}`}
                  className={`quiz-dot ${result ? `is-${result.outcome}` : ""} ${current ? "is-current" : ""}`}
                  onClick={() => openQuestion(index)}
                >
                  {result && result.outcome !== "missed" ? <Check size={10} /> : index + 1}
                </button>
              );
            })}
          </div>
        </div>

        {(phase === "intro" || (phase === "watch" && !question)) && (
          <div className="quiz-intro">
            <h3>{phase === "intro" ? "Watch first. Then think with your eyes." : "Keep watching…"}</h3>
            <p>
              {phase === "intro"
                ? "The clip pauses at the key instants. Answer right on the video — draw the arrow, tap the point, find the moment."
                : "The next pause is coming up. Watch what the object does."}
            </p>
            <ol className="quiz-outline">
              {quiz.map((item, index) => {
                const Icon = TYPE_ICONS[item.type];
                const result = results[item.id];
                return (
                  <li key={item.id} className={result ? `is-${result.outcome}` : ""}>
                    <span className="quiz-outline-icon">
                      <Icon size={13} />
                    </span>
                    <span>
                      <b>{item.kicker}</b>
                      <small>
                        {QUESTION_KIND[item.type].label} · {item.t.toFixed(1)} s
                      </small>
                    </span>
                    {result && (result.outcome === "missed" ? <X size={13} /> : <Check size={13} />)}
                  </li>
                );
              })}
            </ol>
            {phase === "intro" && (
              <button className="quiz-cta" onClick={start}>
                <Play size={15} /> {answered === quiz.length && quiz.length ? "Watch with annotations" : "Start the clip"}
              </button>
            )}
          </div>
        )}

        {question && phase === "question" && (
          <div className="quiz-question" key={`${question.id}-${attempt.attempts}`}>
            <span className="quiz-kicker">
              {(() => {
                const Icon = TYPE_ICONS[question.type];
                return <Icon size={12} />;
              })()}
              {question.kicker} · {qIndex + 1}/{quiz.length}
            </span>
            <h3>
              <RichText text={question.prompt} />
            </h3>
            {question.type === "choice" && (
              <div className="quiz-options" role="radiogroup" aria-label="Answers">
                {question.options.map((option, index) => (
                  <button
                    key={option.text}
                    role="radio"
                    aria-checked={attempt.choice === index}
                    className={attempt.wrong && attempt.choice === index ? "is-wrong" : ""}
                    onClick={() => setAttempt({ ...attempt, choice: index, wrong: false })}
                  >
                    <span className="quiz-letter">{String.fromCharCode(65 + index)}</span>
                    <RichText text={option.text} />
                  </button>
                ))}
              </div>
            )}
            {question.type === "path" && paths && (
              <div className="quiz-options is-compact" role="radiogroup" aria-label="Paths">
                {paths.map((candidate, index) => (
                  <button
                    key={candidate.letter}
                    role="radio"
                    aria-checked={attempt.path === index}
                    className={attempt.wrong && attempt.path === index ? "is-wrong" : ""}
                    onClick={() => setAttempt({ ...attempt, path: index, wrong: false })}
                  >
                    <span className="quiz-letter">{candidate.letter}</span>
                    Path {candidate.letter}
                  </button>
                ))}
              </div>
            )}
            {question.type === "vector" && (
              <p className="quiz-interaction-note">
                <MoveUpRight size={14} /> Drag anywhere on the video to aim the arrow from the glowing dot.
                {attempt.angle !== null && <b> Your arrow points {describeAngle(attempt.angle)}.</b>}
              </p>
            )}
            {question.type === "hotspot" && (
              <p className="quiz-interaction-note">
                <Crosshair size={14} /> Tap the video where you think it is.
                {attempt.point && <b> Marked.</b>}
              </p>
            )}
            {question.type === "scrub" && (
              <p className="quiz-interaction-note">
                <Timer size={14} /> Drag the timeline under the video, frame by frame if you like.
                {attempt.scrubT !== null && <b> Selected {attempt.scrubT.toFixed(2)} s.</b>}
              </p>
            )}
            {attempt.wrong && (
              <div className="quiz-nudge" role="status">
                <b>Not quite.</b>
                <span>
                  <RichText text={wrongDetail?.detail || question.hint} />
                </span>
                {wrongDetail?.detail && (
                  <span className="quiz-hint">
                    <Lightbulb size={12} /> <RichText text={question.hint} />
                  </span>
                )}
              </div>
            )}
            <div className="quiz-actions">
              <button className="quiz-cta" disabled={!hasAnswer(question, attempt)} onClick={check}>
                {question.type === "scrub" ? "Lock in this moment" : attempt.wrong ? "Check again" : "Check"} <ArrowRight size={15} />
              </button>
              {attempt.wrong && (
                <button className="quiz-link" onClick={() => finish(false, attempt.attempts)}>
                  Show me
                </button>
              )}
            </div>
          </div>
        )}

        {question && phase === "feedback" && feedback && (
          <div className={`quiz-feedback ${results[question.id]?.outcome === "missed" ? "is-missed" : "is-correct"}`} role="status">
            <span className="quiz-verdict">
              {results[question.id]?.outcome === "missed" ? <Eye size={15} /> : <Check size={15} />}
              {results[question.id]?.outcome === "first"
                ? "Exactly right."
                : results[question.id]?.outcome === "second"
                  ? "Got it on the second try."
                  : "Here's what happens."}
            </span>
            {feedback.detail && question.type !== "choice" && <p className="quiz-detail">{feedback.detail}</p>}
            {question.type === "choice" && attempt.choice !== null && !question.options[attempt.choice]?.correct && (
              <p className="quiz-detail">
                <RichText text={question.options[attempt.choice].feedback} />
              </p>
            )}
            <p>
              <RichText text={question.explanation} />
            </p>
            {question.type === "vector" && attempt.angle !== null && (
              <p className="quiz-detail">
                The model's arrow points {describeAngle(question.answerDeg)}; yours was {Math.round(angleDifference(attempt.angle, question.answerDeg))}° away.
              </p>
            )}
            <div className="quiz-actions">
              <button className="quiz-cta" onClick={continueQuiz}>
                {answered === quiz.length ? "Finish the clip" : "Keep watching"} <ArrowRight size={15} />
              </button>
              {question.type === "path" && (
                <button
                  className="quiz-link"
                  onClick={() => {
                    seek(question.t);
                    setAnswerRun({ from: question.t, to: Math.min(duration, question.t + question.horizonS) });
                    video.current?.play().catch(() => undefined);
                  }}
                >
                  <RotateCcw size={12} /> Replay
                </button>
              )}
            </div>
          </div>
        )}

        {phase === "done" && (
          <div className="quiz-done">
            <div className="quiz-score" style={{ "--score": `${quiz.length ? (firstTry / quiz.length) * 100 : 0}%` } as React.CSSProperties}>
              <b>{firstTry}</b>
              <small>of {quiz.length} first try</small>
            </div>
            <h3>{firstTry === quiz.length ? "You saw the physics." : firstTry >= quiz.length / 2 ? "Solid instincts." : "Now you know where to look."}</h3>
            <p>Keep the annotations on and replay it, or change the physics yourself in the lab below.</p>
            <div className="quiz-actions is-stacked">
              <button className="quiz-cta" onClick={onOpenLab}>
                <FlaskConical size={15} /> Experiment in the lab
              </button>
              <button className="quiz-link" onClick={retake}>
                <RotateCcw size={12} /> Retake the quiz
              </button>
            </div>
          </div>
        )}
      </aside>
    </section>
  );
}

function describeAngle(deg: number) {
  const normalized = ((deg % 360) + 360) % 360;
  const names = ["right", "up and to the right", "straight up", "up and to the left", "left", "down and to the left", "straight down", "down and to the right"];
  return names[Math.round(normalized / 45) % 8];
}

function Transport({
  spec,
  t,
  playing,
  rate,
  annotations,
  results,
  phase,
  questionIndex,
  scrubbing,
  scrubAnswer,
  onToggle,
  onSeek,
  onRestart,
  onRate,
  onAnnotations,
  onJump,
}: {
  spec: StudioSpec;
  t: number;
  playing: boolean;
  rate: number;
  annotations: boolean;
  results: Record<string, QuizResult>;
  phase: Phase;
  questionIndex: number;
  scrubbing: boolean;
  scrubAnswer: { user: number | null; answer: number } | null;
  onToggle: () => void;
  onSeek: (time: number) => void;
  onRestart: () => void;
  onRate: (rate: number) => void;
  onAnnotations: () => void;
  onJump: (index: number) => void;
}) {
  const duration = spec.clip.durationSeconds;
  const pct = (value: number) => `${Math.min(100, Math.max(0, (value / duration) * 100))}%`;
  const locked = phase === "question" && !scrubbing;
  return (
    <div className={`theater-transport ${scrubbing ? "is-scrubbing" : ""}`}>
      <button className="transport-play" onClick={onToggle} aria-label={playing ? "Pause" : "Play"} disabled={phase === "question"}>
        {playing ? <Pause size={16} /> : <Play size={16} />}
      </button>
      <button className="transport-icon" onClick={onRestart} aria-label="Replay from the start" disabled={phase === "question"}>
        <RotateCcw size={14} />
      </button>
      <span className="transport-time">
        {formatClock(t)}
        <small> / {formatClock(duration)} s</small>
      </span>
      <div className="transport-track">
        <div className="transport-rail">
          <span className="transport-event" style={{ left: pct(spec.clip.eventFrom), width: `calc(${pct(spec.clip.eventTo)} - ${pct(spec.clip.eventFrom)})` }} />
          <span className="transport-fill" style={{ width: pct(t) }} />
          {spec.annotations.chapters.map((chapter) => (
            <span key={`c${chapter.t}`} className="transport-chapter" style={{ left: pct(chapter.t) }} title={chapter.title} />
          ))}
          {spec.annotations.freezes.map((item) => (
            <span key={`f${item.t}`} className="transport-freeze" style={{ left: pct(item.t) }} title="Freeze frame" />
          ))}
          {scrubAnswer && (
            <>
              {scrubAnswer.user !== null && <span className="transport-mark is-user" style={{ left: pct(scrubAnswer.user) }} title="Your moment" />}
              <span className="transport-mark is-answer" style={{ left: pct(scrubAnswer.answer) }} title="The moment" />
            </>
          )}
          <span className="transport-head" style={{ left: pct(t) }} />
        </div>
        <input
          type="range"
          min={0}
          max={duration}
          step={1 / 60}
          value={Math.min(duration, t)}
          aria-label={scrubbing ? "Scrub to find the moment" : "Clip time"}
          disabled={locked}
          onChange={(event) => onSeek(Number(event.target.value))}
        />
        <div className="transport-pins">
          {spec.quiz.map((question, index) => {
            const result = results[question.id];
            return (
              <button
                key={question.id}
                className={`transport-pin ${result ? `is-${result.outcome}` : ""} ${(phase === "question" || phase === "feedback") && index === questionIndex ? "is-current" : ""}`}
                style={{ left: pct(question.t) }}
                aria-label={`Jump to question ${index + 1}`}
                onClick={() => onJump(index)}
              />
            );
          })}
        </div>
      </div>
      <div className="transport-rates" role="group" aria-label="Playback speed">
        {[1, 0.5, 0.25].map((value) => (
          <button key={value} aria-pressed={rate === value} onClick={() => onRate(value)}>
            {value}×
          </button>
        ))}
      </div>
      <button className="transport-toggle" aria-pressed={annotations} onClick={onAnnotations}>
        {annotations ? <Eye size={14} /> : <EyeOff size={14} />}
        <span>Annotations</span>
      </button>
    </div>
  );
}
