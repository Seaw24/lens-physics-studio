import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Check,
  Equal,
  Eye,
  EyeOff,
  FlaskConical,
  GitCompareArrows,
  Lightbulb,
  Pause,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Target,
  Trophy,
  X,
} from "lucide-react";
import {
  compareMetric,
  getEngine,
  resolveParams,
  runEngine,
  type Direction,
  type Engine,
  type MetricSpec,
  type ParamSpec,
  type Params,
  type Simulation,
} from "../../../shared/studio/engines";
import type { Experiment, Lab } from "../../../shared/studio/schema";
import { labBaseParams, labRanges } from "../../../shared/studio/validate";
import { LAB, formatQuantity } from "./draw";
import LabCanvas from "./LabCanvas";
import LabChart from "./LabChart";
import { LAB_VIEWS } from "./views";
import type { EngineView } from "./types";

const BOOLEAN_METRICS = new Set([
  "startsMoving",
  "startsTurning",
  "balanced",
  "collides",
  "yielded",
  "floats",
]);

function metricText(spec: MetricSpec | undefined, value: number | null | undefined) {
  if (!spec) return "—";
  if (BOOLEAN_METRICS.has(spec.key)) return value === null || value === undefined ? "—" : value >= 0.5 ? "Yes" : "No";
  if (spec.key === "tipDirection")
    return value === null || value === undefined ? "—" : value > 0 ? "Right" : value < 0 ? "Left" : "Stays";
  return formatQuantity(value, spec.unit, spec.digits);
}

const DIRECTION_LABEL: Record<Direction, string> = {
  increase: "Goes up",
  decrease: "Goes down",
  same: "Stays the same",
};

const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);

function readStorage(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStorage(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Progress is a convenience; the lab works without storage.
  }
}

interface ExperimentRun {
  id: string;
  phase: "predict" | "running" | "result";
  prediction: Direction | null;
  before: number | null;
  after: number | null;
  direction: Direction | null;
}

export default function PhysicsLab({ lab, storageKey }: { lab: Lab; storageKey: string }) {
  const engine = getEngine(lab.engine);
  const view = engine ? LAB_VIEWS[engine.id] : null;
  if (!engine || !view) return null;
  return <LabBody key={`${storageKey}:${lab.engine}`} lab={lab} engine={engine} view={view} storageKey={storageKey} />;
}

function LabBody({
  lab,
  engine,
  view,
  storageKey,
}: {
  lab: Lab;
  engine: Engine<any>;
  view: EngineView;
  storageKey: string;
}) {
  const ranges = useMemo(() => labRanges(engine, lab), [engine, lab]);
  const base = useMemo(() => labBaseParams(engine, lab), [engine, lab]);
  const [params, setParams] = useState<Params>(base);
  const sim = useMemo(() => runEngine(engine, params), [engine, params]);
  const [ghost, setGhost] = useState<{ params: Params; sim: Simulation<any> } | null>(null);
  const [t, setT] = useState(0);
  const tRef = useRef(0);
  const setTime = (value: number) => {
    tRef.current = value;
    setT(value);
  };
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(() => (sim.duration < 0.5 ? 0.25 : sim.duration < 1.6 ? 0.5 : 1));
  const [showVectors, setShowVectors] = useState(true);
  const [compare, setCompare] = useState(true);
  const [run, setRun] = useState<ExperimentRun | null>(null);
  const [solved, setSolved] = useState(() => readStorage(`${storageKey}:challenge`) === "solved");
  const [celebrate, setCelebrate] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [chartKey, setChartKey] = useState(() => view.charts.find((key) => sim.series.some((s) => s.key === key)) ?? sim.series[0]?.key);
  const [completedExperiments, setCompletedExperiments] = useState<string[]>(() => {
    try {
      return JSON.parse(readStorage(`${storageKey}:experiments`) || "[]");
    } catch {
      return [];
    }
  });
  const ghostTaken = useRef(false);
  const autoplay = useRef<number | null>(null);
  const tween = useRef<number | null>(null);
  const runRef = useRef(run);
  runRef.current = run;
  const simRef = useRef(sim);
  simRef.current = sim;

  const clampToRange = (key: string, value: number) => {
    const range = ranges[key];
    return range ? Math.min(range.max, Math.max(range.min, value)) : value;
  };

  useEffect(
    () => () => {
      if (autoplay.current) window.clearTimeout(autoplay.current);
      if (tween.current) cancelAnimationFrame(tween.current);
    },
    [],
  );

  // Playback clock.
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let id = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const next = tRef.current + dt * speed;
      if (next >= simRef.current.duration) {
        setTime(simRef.current.duration);
        setPlaying(false);
        onRunComplete();
        return;
      }
      setTime(next);
      id = requestAnimationFrame(tick);
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, speed]);

  function onRunComplete() {
    const current = runRef.current;
    if (current?.phase === "running") {
      setRun({ ...current, phase: "result" });
      setCompletedExperiments((list) => {
        const next = list.includes(current.id) ? list : [...list, current.id];
        writeStorage(`${storageKey}:experiments`, JSON.stringify(next));
        return next;
      });
    }
    if (lab.challenge && !runRef.current) {
      const value = simRef.current.metrics[lab.challenge.metric];
      if (value !== null && value !== undefined && Math.abs(value - lab.challenge.target) <= lab.challenge.tolerance) {
        setSolved(true);
        setCelebrate(true);
        writeStorage(`${storageKey}:challenge`, "solved");
        window.setTimeout(() => setCelebrate(false), 2600);
      }
    }
  }

  function scheduleAutoplay(delay = 380) {
    if (autoplay.current) window.clearTimeout(autoplay.current);
    autoplay.current = window.setTimeout(() => {
      autoplay.current = null;
      ghostTaken.current = false;
      setTime(0);
      setPlaying(true);
    }, delay);
  }

  function changeParams(changes: Params, options: { autoplay?: boolean } = {}) {
    if (run) setRun(null);
    if (compare && !ghostTaken.current) {
      setGhost({ params, sim });
      ghostTaken.current = true;
    }
    if (!compare) setGhost(null);
    setParams((previous) => {
      const merged = { ...previous };
      for (const [key, value] of Object.entries(changes)) merged[key] = clampToRange(key, value);
      return resolveParams(engine, merged);
    });
    setPlaying(false);
    setTime(0);
    if (options.autoplay !== false) scheduleAutoplay();
  }

  function animateParams(target: Params, done: () => void) {
    if (tween.current) cancelAnimationFrame(tween.current);
    const from = { ...params };
    const started = performance.now();
    const step = (now: number) => {
      const share = Math.min(1, (now - started) / 650);
      const eased = easeInOut(share);
      const next: Params = {};
      for (const spec of engine.params) {
        const a = from[spec.key];
        const b = target[spec.key];
        next[spec.key] = spec.options && spec.step >= 1 ? (share < 0.5 ? a : b) : a + (b - a) * eased;
      }
      setParams(share >= 1 ? target : resolveParams(engine, next));
      if (share < 1) tween.current = requestAnimationFrame(step);
      else {
        tween.current = null;
        done();
      }
    };
    tween.current = requestAnimationFrame(step);
  }

  function resetScene() {
    if (autoplay.current) window.clearTimeout(autoplay.current);
    setRun(null);
    setGhost(null);
    ghostTaken.current = false;
    setPlaying(false);
    setTime(0);
    animateParams(base, () => undefined);
  }

  function openExperiment(experiment: Experiment) {
    if (autoplay.current) window.clearTimeout(autoplay.current);
    setPlaying(false);
    setGhost(null);
    setTime(0);
    setRun({ id: experiment.id, phase: "predict", prediction: null, before: null, after: null, direction: null });
    animateParams(base, () => undefined);
  }

  function predict(experiment: Experiment, prediction: Direction) {
    const baseline = runEngine(engine, base);
    const changed = resolveParams(engine, {
      ...base,
      ...Object.fromEntries(Object.entries(experiment.change).map(([key, value]) => [key, clampToRange(key, value)])),
    });
    const after = runEngine(engine, changed);
    const comparison = compareMetric(baseline.metrics[experiment.metric], after.metrics[experiment.metric]);
    setGhost({ params: base, sim: baseline });
    setTime(0);
    setPlaying(false);
    setRun({
      id: experiment.id,
      phase: "running",
      prediction,
      before: comparison.before,
      after: comparison.after,
      direction: comparison.direction,
    });
    animateParams(changed, () => {
      setTime(0);
      setPlaying(true);
    });
  }

  const state = sim.sample(t);
  const ghostState = ghost ? ghost.sim.sample(Math.min(t, ghost.sim.duration)) : null;
  const metricSpec = (key: string) => engine.metrics.find((spec) => spec.key === key);
  const activeExperiment = run ? lab.experiments.find((experiment) => experiment.id === run.id) ?? null : null;
  const visibleParams = engine.params.filter((spec) => !spec.visibleWhen || spec.visibleWhen(params));
  const featured = lab.featured
    .map((key) => visibleParams.find((spec) => spec.key === key))
    .filter((spec): spec is ParamSpec => Boolean(spec));
  const others = visibleParams.filter((spec) => !lab.featured.includes(spec.key));
  const series = sim.series.find((item) => item.key === chartKey) ?? sim.series[0];
  const ghostSeries = ghost?.sim.series.find((item) => item.key === series?.key) ?? null;
  const challenge = lab.challenge;
  const challengeValue = challenge ? sim.metrics[challenge.metric] : null;
  const challengeSpec = challenge ? metricSpec(challenge.metric) : undefined;
  const closeness =
    challenge && challengeValue !== null && challengeValue !== undefined
      ? 1 -
        Math.min(
          1,
          Math.abs(challengeValue - challenge.target) /
            Math.max(Math.abs(challenge.target) * 0.9, challenge.tolerance * 8, 1e-6),
        )
      : 0;
  const onTarget =
    challenge && challengeValue !== null && challengeValue !== undefined
      ? Math.abs(challengeValue - challenge.target) <= challenge.tolerance
      : false;

  return (
    <section className="lab" aria-labelledby={`${storageKey}-lab-title`}>
      <header className="lab-head">
        <div>
          <span className="lab-eyebrow">
            <FlaskConical size={14} /> Physics lab · {engine.name}
          </span>
          <h2 id={`${storageKey}-lab-title`}>{lab.title}</h2>
          <p>{lab.goal}</p>
        </div>
        <div className="lab-badges">
          <span>Ideal model</span>
          <span>Values are hypothetical, scaled to the scene</span>
        </div>
      </header>

      <div className="lab-grid">
        <div className="lab-stage">
          <div className={`lab-canvas-wrap ${run?.phase === "running" ? "is-experiment" : ""}`}>
            <LabCanvas
              view={view}
              label={`${engine.name} simulation of ${lab.skin.body.name}`}
              scene={{
                t,
                sim,
                state,
                params,
                ghost: ghost && ghostState ? { sim: ghost.sim, params: ghost.params, state: ghostState } : null,
                skin: lab.skin,
                engine,
                showVectors,
              }}
              onParams={(changes) => changeParams(changes, { autoplay: false })}
              onDragStart={() => {
                if (autoplay.current) window.clearTimeout(autoplay.current);
              }}
              onDragEnd={() => scheduleAutoplay(250)}
            />
            <div className="lab-hud" aria-live="off">
              {view.hud({ t, sim, state, params }).map((item) => (
                <span key={item.label}>
                  <small>{item.label}</small>
                  <b style={item.color ? { color: item.color } : undefined}>{item.value}</b>
                </span>
              ))}
            </div>
            {run?.phase === "running" && activeExperiment && (
              <div className="lab-stage-banner">
                <GitCompareArrows size={14} /> {activeExperiment.title}
                <span>faint = before · bright = after</span>
              </div>
            )}
            {celebrate && (
              <div className="lab-celebrate" aria-hidden="true">
                {Array.from({ length: 18 }, (_, i) => (
                  <i key={i} style={{ "--i": i } as React.CSSProperties} />
                ))}
              </div>
            )}
          </div>
          <div className="lab-transport">
            <button
              className="lab-play"
              aria-label={playing ? "Pause simulation" : "Play simulation"}
              onClick={() => {
                if (playing) setPlaying(false);
                else {
                  if (t >= sim.duration - 1e-6) setTime(0);
                  setPlaying(true);
                }
              }}
            >
              {playing ? <Pause size={17} /> : <Play size={17} />}
            </button>
            <button
              className="lab-icon"
              aria-label="Restart"
              onClick={() => {
                setTime(0);
                setPlaying(true);
              }}
            >
              <RotateCcw size={15} />
            </button>
            <input
              className="lab-scrub"
              type="range"
              aria-label="Simulation time"
              min={0}
              max={sim.duration}
              step={0.001}
              value={Math.min(t, sim.duration)}
              style={{ "--fill": `${(Math.min(t, sim.duration) / Math.max(1e-6, sim.duration)) * 100}%` } as React.CSSProperties}
              onChange={(event) => {
                setPlaying(false);
                setTime(Number(event.target.value));
              }}
            />
            <span className="lab-time">
              {t.toFixed(2)}
              <small> / {sim.duration.toFixed(2)} s</small>
            </span>
            <div className="lab-speed" role="group" aria-label="Playback speed">
              {[0.25, 0.5, 1].map((value) => (
                <button key={value} aria-pressed={speed === value} onClick={() => setSpeed(value)}>
                  {value}×
                </button>
              ))}
            </div>
            <button className="lab-toggle" aria-pressed={showVectors} onClick={() => setShowVectors(!showVectors)}>
              {showVectors ? <Eye size={14} /> : <EyeOff size={14} />} Vectors
            </button>
            <button
              className="lab-toggle"
              aria-pressed={compare}
              onClick={() => {
                setCompare(!compare);
                if (compare) setGhost(null);
              }}
            >
              <GitCompareArrows size={14} /> Compare
            </button>
          </div>
          <div className="lab-readouts">
            {lab.readouts.map((key) => {
              const spec = metricSpec(key);
              const value = sim.metrics[key];
              const previous = ghost?.sim.metrics[key];
              const comparison = ghost ? compareMetric(previous, value) : null;
              const highlighted = activeExperiment?.metric === key || challenge?.metric === key;
              return (
                <div key={key} className={`lab-tile ${highlighted ? "is-focus" : ""}`}>
                  <small>{spec?.label ?? key}</small>
                  <b key={`${value}`}>{metricText(spec, value)}</b>
                  {comparison?.direction && comparison.direction !== "same" && !BOOLEAN_METRICS.has(key) ? (
                    <span className={`lab-delta is-${comparison.direction}`}>
                      {comparison.direction === "increase" ? <ArrowUp size={11} /> : <ArrowDown size={11} />}
                      {comparison.ratio !== null && Number.isFinite(comparison.ratio)
                        ? `${Math.abs((comparison.ratio - 1) * 100) >= 999 ? "×" + comparison.ratio.toFixed(0) : `${Math.round(Math.abs(comparison.ratio - 1) * 100)}%`}`
                        : "changed"}
                      <em>vs before</em>
                    </span>
                  ) : ghost ? (
                    <span className="lab-delta is-same">
                      <Equal size={11} /> same as before
                    </span>
                  ) : (
                    <span className="lab-delta" title={spec?.description}>
                      {spec?.description}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <aside className="lab-controls" aria-label="Lab controls">
          <div className="lab-controls-head">
            <SlidersHorizontal size={15} />
            <strong>Change the scene</strong>
            <button className="lab-link" onClick={resetScene}>
              <RotateCcw size={12} /> Reset
            </button>
          </div>
          <div className="lab-skin">
            <span className="lab-swatch" style={{ background: lab.skin.body.color }} />
            <span>
              <b>{lab.skin.body.name}</b>
              {lab.skin.surface && <small>on {lab.skin.surface.name}</small>}
              {lab.skin.agent && <small>moved by {lab.skin.agent}</small>}
            </span>
          </div>
          {featured.map((spec) => (
            <ParamControl
              key={spec.key}
              spec={spec}
              value={params[spec.key]}
              range={ranges[spec.key]}
              changed={Math.abs(params[spec.key] - base[spec.key]) > 1e-9}
              onChange={(value) => changeParams({ [spec.key]: value })}
            />
          ))}
          {others.length > 0 && (
            <details className="lab-more">
              <summary>More settings ({others.length})</summary>
              {others.map((spec) => (
                <ParamControl
                  key={spec.key}
                  spec={spec}
                  value={params[spec.key]}
                  range={ranges[spec.key]}
                  changed={Math.abs(params[spec.key] - base[spec.key]) > 1e-9}
                  onChange={(value) => changeParams({ [spec.key]: value })}
                />
              ))}
            </details>
          )}
          <p className="lab-ignores">
            <b>This model ignores:</b> {engine.ignores}
          </p>
        </aside>
      </div>

      <div className="lab-lower">
        <section className="lab-experiments" aria-label="Experiments">
          <div className="lab-section-head">
            <Lightbulb size={15} />
            <h3>What if…?</h3>
            <span>
              {completedExperiments.filter((id) => lab.experiments.some((e) => e.id === id)).length}/{lab.experiments.length} tried
            </span>
          </div>
          <div className="lab-experiment-list">
            {lab.experiments.map((experiment, index) => {
              const open = run?.id === experiment.id;
              const done = completedExperiments.includes(experiment.id);
              const spec = metricSpec(experiment.metric);
              return (
                <article key={experiment.id} className={`lab-experiment ${open ? "is-open" : ""} ${done ? "is-done" : ""}`}>
                  <button
                    className="lab-experiment-head"
                    aria-expanded={open}
                    onClick={() => (open ? setRun(null) : openExperiment(experiment))}
                  >
                    <span className="lab-experiment-index">{done ? <Check size={13} /> : index + 1}</span>
                    <span>
                      <b>{experiment.title}</b>
                      <small>{changeSummary(engine, experiment, base)}</small>
                    </span>
                    {open ? <X size={15} /> : <ArrowRight size={15} />}
                  </button>
                  {open && run && (
                    <div className="lab-experiment-body">
                      <p className="lab-experiment-question">{experiment.question}</p>
                      {run.phase === "predict" && (
                        <>
                          <span className="lab-predict-label">
                            Predict first — what happens to <b>{spec?.label.toLowerCase() ?? experiment.metric}</b>?
                          </span>
                          <div className="lab-predict" role="group" aria-label="Your prediction">
                            {(["increase", "same", "decrease"] as Direction[]).map((direction) => (
                              <button key={direction} onClick={() => predict(experiment, direction)}>
                                {direction === "increase" ? <ArrowUp size={16} /> : direction === "decrease" ? <ArrowDown size={16} /> : <Equal size={16} />}
                                {DIRECTION_LABEL[direction]}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                      {run.phase === "running" && (
                        <p className="lab-running">
                          <span className="lab-pulse" /> Running the experiment… you predicted <b>{DIRECTION_LABEL[run.prediction!].toLowerCase()}</b>.
                        </p>
                      )}
                      {run.phase === "result" && (
                        <div className={`lab-result ${run.prediction === run.direction ? "is-right" : "is-wrong"}`} role="status">
                          <div className="lab-result-verdict">
                            {run.prediction === run.direction ? <Check size={16} /> : <X size={16} />}
                            <b>
                              {run.prediction === run.direction
                                ? "Your prediction held up."
                                : `Surprise — it ${run.direction === "same" ? "stayed the same" : run.direction === "increase" ? "went up" : "went down"}.`}
                            </b>
                          </div>
                          <div className="lab-result-numbers">
                            <span>
                              <small>before</small>
                              {metricText(spec, run.before)}
                            </span>
                            <ArrowRight size={16} />
                            <span className="is-after">
                              <small>after</small>
                              {metricText(spec, run.after)}
                            </span>
                            {run.before !== null && run.after !== null && Math.abs(run.before) > 1e-9 && !BOOLEAN_METRICS.has(experiment.metric) && (
                              <em>
                                {run.after >= run.before ? "+" : "−"}
                                {Math.abs(((run.after - run.before) / run.before) * 100).toFixed(0)}%
                              </em>
                            )}
                          </div>
                          <p>{experiment.explanation}</p>
                          <div className="lab-result-actions">
                            <button
                              className="lab-link"
                              onClick={() => {
                                setTime(0);
                                setPlaying(true);
                              }}
                            >
                              <Play size={12} /> Watch again
                            </button>
                            <button className="lab-link" onClick={resetScene}>
                              <RotateCcw size={12} /> Back to the scene
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>

        <div className="lab-side">
          {challenge && (
            <section className={`lab-challenge ${solved ? "is-solved" : ""} ${onTarget ? "is-on-target" : ""}`}>
              <div className="lab-section-head">
                {solved ? <Trophy size={15} /> : <Target size={15} />}
                <h3>{challenge.title}</h3>
                {solved && <span className="lab-solved">Solved</span>}
              </div>
              <p>{challenge.prompt}</p>
              <div className="lab-gauge">
                <div className="lab-gauge-track">
                  <span style={{ width: `${Math.round(closeness * 100)}%` }} />
                </div>
                <div className="lab-gauge-values">
                  <span>
                    <small>now</small>
                    {metricText(challengeSpec, challengeValue)}
                  </span>
                  <span>
                    <small>goal</small>
                    {metricText(challengeSpec, challenge.target)}
                    <em> ± {formatQuantity(challenge.tolerance, challengeSpec?.unit ?? "", challengeSpec?.digits ?? 2)}</em>
                  </span>
                </div>
              </div>
              <p className="lab-challenge-status">
                {onTarget
                  ? solved
                    ? "On target. Nicely done."
                    : "On target — press play to lock it in."
                  : "Move the sliders, then run it."}
              </p>
              <button className="lab-link" onClick={() => setShowHint(!showHint)}>
                <Lightbulb size={12} /> {showHint ? "Hide hint" : "Hint"}
              </button>
              {showHint && <p className="lab-hint">{challenge.hint}</p>}
            </section>
          )}
          {series && (
            <section className="lab-chart-card">
              <div className="lab-chart-tabs" role="tablist" aria-label="Chart">
                {sim.series.map((item) => (
                  <button key={item.key} role="tab" aria-selected={item.key === series.key} onClick={() => setChartKey(item.key)}>
                    {item.label}
                  </button>
                ))}
              </div>
              <LabChart series={series} ghost={ghostSeries} t={t} events={sim.events} color={LAB.hot} />
            </section>
          )}
        </div>
      </div>
      <p className="lab-takeaway">
        <Lightbulb size={16} />
        <span>{lab.takeaway}</span>
      </p>
    </section>
  );
}

function changeSummary(engine: Engine<any>, experiment: Experiment, base: Params) {
  return Object.entries(experiment.change)
    .map(([key, value]) => {
      const spec = engine.params.find((item) => item.key === key);
      if (!spec) return null;
      const option = spec.options?.find((item) => Math.abs(item.value - value) < 1e-9);
      const before = spec.options?.find((item) => Math.abs(item.value - base[key]) < 1e-9);
      if (option) return `${spec.label}: ${before?.label ?? base[key]} → ${option.label}`;
      return `${spec.label}: ${formatQuantity(base[key], spec.unit, 2)} → ${formatQuantity(value, spec.unit, 2)}`;
    })
    .filter(Boolean)
    .join(" · ");
}

function ParamControl({
  spec,
  value,
  range,
  changed,
  onChange,
}: {
  spec: ParamSpec;
  value: number;
  range: { min: number; max: number } | undefined;
  changed: boolean;
  onChange: (value: number) => void;
}) {
  const min = range?.min ?? spec.min;
  const max = range?.max ?? spec.max;
  const id = `param-${spec.key}`;
  if (spec.options && spec.step >= 1)
    return (
      <div className="lab-param">
        <div className="lab-param-head">
          <label htmlFor={id}>{spec.label}</label>
        </div>
        <div className="lab-segmented" role="radiogroup" id={id} aria-label={spec.label}>
          {spec.options.map((option) => (
            <button
              key={option.value}
              role="radio"
              aria-checked={Math.abs(option.value - value) < 1e-9}
              onClick={() => onChange(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  const share = ((value - min) / Math.max(1e-9, max - min)) * 100;
  const digits = spec.step >= 1 ? 0 : spec.step >= 0.1 ? 1 : spec.step >= 0.01 ? 2 : 3;
  return (
    <div className={`lab-param ${changed ? "is-changed" : ""}`}>
      <div className="lab-param-head">
        <label htmlFor={id} title={spec.description}>
          {spec.label}
        </label>
        <output htmlFor={id}>
          {formatQuantity(value, spec.unit, digits)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={spec.step}
        value={value}
        style={{ "--fill": `${Math.max(0, Math.min(100, share))}%` } as React.CSSProperties}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      {spec.options && (
        <div className="lab-presets">
          {spec.options.map((option) => (
            <button key={option.value} aria-pressed={Math.abs(option.value - value) < 1e-9} onClick={() => onChange(option.value)}>
              {option.label}
            </button>
          ))}
        </div>
      )}
      <small className="lab-param-help">{spec.description}</small>
    </div>
  );
}
