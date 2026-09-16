import { useEffect, useRef, useState } from "react";
import {
  Play,
  RotateCcw,
  ArrowLeft,
  ArrowRight,
  Minus,
  ChevronDown,
} from "lucide-react";
import { motionAt, torque, type Concept } from "../shared/physics";
import Projectile from "./Projectile";
export interface ModelState {
  force: number;
  radius: number;
  angle: number;
  speed?: number;
  height?: number;
}
export default function Models({
  concept,
  state,
  setState,
}: {
  concept: Concept;
  state: ModelState;
  setState: (s: ModelState) => void;
}) {
  const [direction, setDirection] = useState(-1),
    [elapsed, setElapsed] = useState(0),
    [running, setRunning] = useState(false),
    [equation, setEquation] = useState(false);
  const start = useRef(0);
  useEffect(() => {
    if (!running) return;
    let id: number;
    const tick = (now: number) => {
      if (!start.current) start.current = now;
      const time = Math.min(2, (now - start.current) / 1000);
      setElapsed(time);
      if (time < 2) id = requestAnimationFrame(tick);
      else {
        setRunning(false);
        start.current = 0;
      }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [running]);
  const current = motionAt(elapsed, direction),
    x = 140 + current.position * 48,
    turning = torque(state.force, state.radius, state.angle),
    match = Math.abs(turning - 8) < 0.15;
  function slider(
    key: keyof ModelState,
    label: string,
    min: number,
    max: number,
    step: number,
    unit: string,
  ) {
    return (
      <label className="model-slider">
        <span>
          {label}
          <strong>
            {key === "radius" ? state[key].toFixed(2) : state[key]}{" "}
            <small>{unit}</small>
          </strong>
        </span>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={state[key]}
          onChange={(e) =>
            setState({ ...state, [key]: Number(e.target.value) })
          }
        />
        <span className="range-extents">
          <span>
            {min} {unit}
          </span>
          <span>
            {max} {unit}
          </span>
        </span>
      </label>
    );
  }
  if (concept === "projectile")
    return <Projectile state={state} setState={setState} />;
  return (
    <div className="model-lab">
      <div className="lab-meta">
        <span className="eyebrow">Physics lab</span>
        <span className="source-tag">Hypothetical values</span>
      </div>
      {concept === "force" ? (
        <>
          <svg
            viewBox="0 0 640 265"
            role="img"
            aria-label={`Cart moving right with ${direction === -1 ? "leftward" : direction === 1 ? "rightward" : "zero"} net horizontal force. Velocity ${current.velocity.toFixed(2)} metres per second.`}
            className="physics-diagram"
          >
            <defs>
              <marker
                id="arrow-velocity"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0 0L10 5L0 10" fill="#a4894f" />
              </marker>
              <marker
                id="arrow-net"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0 0L10 5L0 10" fill="#315e48" />
              </marker>
            </defs>
            <line x1="40" y1="184" x2="600" y2="184" stroke="#c8cdbb" />
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => (
              <line
                key={i}
                x1={40 + i * 56}
                y1="185"
                x2={40 + i * 56}
                y2="193"
                stroke="#c8cdbb"
              />
            ))}
            <g transform={`translate(${x},150)`}>
              <rect
                x="-40"
                y="-23"
                width="80"
                height="42"
                rx="7"
                fill="#6c8664"
              />
              <rect
                x="-23"
                y="-44"
                width="34"
                height="20"
                rx="2"
                fill="#ccb57c"
              />
              <circle cx="-24" cy="24" r="10" fill="#244435" />
              <circle cx="25" cy="24" r="10" fill="#244435" />
              <line
                x1="-40"
                y1="-8"
                x2="-51"
                y2="-36"
                stroke="#244435"
                strokeWidth="4"
              />
              <line
                x1="0"
                y1="-84"
                x2={current.velocity * 39}
                y2="-84"
                stroke="#a4894f"
                strokeWidth="3"
                markerEnd="url(#arrow-velocity)"
              />
              <text x="0" y="-101" className="svg-small">
                velocity →
              </text>
              {direction !== 0 && (
                <>
                  <line
                    x1="0"
                    y1="-5"
                    x2={direction * 102}
                    y2="-5"
                    stroke="#315e48"
                    strokeWidth="4"
                    markerEnd="url(#arrow-net)"
                  />
                  <text
                    x={direction === -1 ? -128 : 49}
                    y="-21"
                    className="svg-label"
                  >
                    F net
                  </text>
                </>
              )}
            </g>
            <text x="40" y="239" className="svg-small">
              Ground reference frame · horizontal motion only
            </text>
            <text x="521" y="239" className="svg-label">
              {elapsed.toFixed(1)} s
            </text>
          </svg>
          <div className="direction-control">
            <span>Choose the net force</span>
            <div className="segmented">
              {[
                [-1, "Left", ArrowLeft],
                [0, "Zero", Minus],
                [1, "Right", ArrowRight],
              ].map(([d, label, Icon]: any) => (
                <button
                  key={d}
                  className={direction === d ? "selected" : ""}
                  onClick={() => {
                    setRunning(false);
                    start.current = 0;
                    setElapsed(0);
                    setDirection(d);
                  }}
                >
                  <Icon size={15} />
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="simulation-result">
            <div>
              <small>Velocity after {elapsed.toFixed(1)} s</small>
              <strong>
                {current.velocity.toFixed(2)} <span>m/s →</span>
              </strong>
            </div>
            <button
              className="button secondary"
              disabled={running}
              onClick={() => {
                setElapsed(0);
                start.current = 0;
                setRunning(true);
              }}
            >
              {elapsed === 2 ? <RotateCcw size={15} /> : <Play size={15} />}{" "}
              {running ? "Testing…" : "Test this force"}
            </button>
          </div>
          <div className="mini-graph">
            <svg
              viewBox="0 0 600 95"
              role="img"
              aria-label="Velocity against time for the selected force"
            >
              <line x1="65" y1="70" x2="564" y2="70" stroke="#cad0bc" />
              <line x1="65" y1="12" x2="65" y2="70" stroke="#cad0bc" />
              <text x="5" y="19" className="svg-small">
                v (m/s)
              </text>
              <text x="540" y="91" className="svg-small">
                t (s)
              </text>
              <text x="49" y="48" className="svg-small">
                2
              </text>
              <text x="60" y="87" className="svg-small">
                0
              </text>
              <text x="552" y="87" className="svg-small">
                2
              </text>
              <path
                d={`M65 42 L${65 + elapsed * 249} ${42 - direction * elapsed * 14}`}
                stroke="#426c4a"
                strokeWidth="3"
                fill="none"
              />
            </svg>
          </div>
          <p className="lab-footnote">
            Starts at 2 m/s to the right. Selected nonzero acceleration: ±0.65
            m/s². Mass and resistance are not estimated from the replay.
          </p>
        </>
      ) : (
        <>
          <svg
            viewBox="0 0 640 290"
            role="img"
            aria-label={
              concept === "torque"
                ? `Door model. ${state.force} newtons at ${state.radius} metres, ${state.angle} degrees. Torque ${turning.toFixed(2)} newton metres.`
                : `Lever model. Left torque 8 newton metres. Right torque ${turning.toFixed(2)} newton metres.`
            }
            className="physics-diagram"
          >
            <defs>
              <marker
                id="force-tip"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="7"
                markerHeight="7"
                orient="auto"
              >
                <path d="M0 0L10 5L0 10" fill="#456a4e" />
              </marker>
            </defs>
            {concept === "torque" ? (
              <>
                <rect
                  x="80"
                  y="58"
                  width="20"
                  height="152"
                  rx="2"
                  fill="#d3d5c5"
                />
                {[0, 1, 2, 3, 4, 5, 6, 7].map((i) => (
                  <line
                    key={i}
                    x1="80"
                    y1={66 + i * 19}
                    x2="98"
                    y2={57 + i * 19}
                    stroke="#a9b19d"
                  />
                ))}
                <rect
                  x="100"
                  y="117"
                  width="419"
                  height="28"
                  rx="6"
                  fill="#adc29f"
                  stroke="#6c8863"
                />
                <circle cx="109" cy="131" r="9" fill="#2d533f" />
                <text x="84" y="237" className="svg-small">
                  hinge / axis
                </text>
                <line
                  x1="109"
                  y1="151"
                  x2="109"
                  y2="219"
                  stroke="#9aa88a"
                  strokeDasharray="3 4"
                />
                <circle
                  cx={109 + state.radius * 400}
                  cy="131"
                  r="8"
                  fill="#f5f3e7"
                  stroke="#315b40"
                  strokeWidth="2"
                />
                <g
                  transform={`translate(${109 + state.radius * 400},131) rotate(${90 - state.angle})`}
                >
                  <line
                    x1="0"
                    y1={-35 - Math.min(70, state.force * 1.2)}
                    x2="0"
                    y2="-10"
                    stroke="#456a4e"
                    strokeWidth="4"
                    markerEnd="url(#force-tip)"
                  />
                  <text x="13" y="-53" className="svg-label">
                    {state.force} N
                  </text>
                </g>
                <line
                  x1="109"
                  y1="184"
                  x2={109 + state.radius * 400}
                  y2="184"
                  stroke="#a58c4c"
                />
                <line x1="109" y1="178" x2="109" y2="190" stroke="#a58c4c" />
                <line
                  x1={109 + state.radius * 400}
                  y1="178"
                  x2={109 + state.radius * 400}
                  y2="190"
                  stroke="#a58c4c"
                />
                <text
                  x={109 + state.radius * 200}
                  y="205"
                  textAnchor="middle"
                  className="svg-label"
                >
                  r = {state.radius.toFixed(2)} m
                </text>
                <text x="415" y="254" className="svg-small">
                  Top view · ideal door
                </text>
              </>
            ) : (
              <>
                <line
                  x1="60"
                  y1="150"
                  x2="591"
                  y2="150"
                  stroke="#aec29c"
                  strokeWidth="16"
                  strokeLinecap="round"
                />
                <path d="M310 155 L289 200 L331 200Z" fill="#738562" />
                <circle cx="310" cy="150" r="6" fill="#284a35" />
                <line
                  x1="202"
                  y1="53"
                  x2="202"
                  y2="138"
                  stroke="#a88e4d"
                  strokeWidth="4"
                  markerEnd="url(#force-tip)"
                />
                <text x="179" y="36" className="svg-label">
                  20 N
                </text>
                <line
                  x1={310 + state.radius * 270}
                  y1={124 - Math.min(100, state.force * 2.7)}
                  x2={310 + state.radius * 270}
                  y2="138"
                  stroke="#456a4e"
                  strokeWidth="4"
                  markerEnd="url(#force-tip)"
                />
                <text
                  x={291 + state.radius * 270}
                  y={108 - Math.min(100, state.force * 2.7)}
                  className="svg-label"
                >
                  {state.force} N
                </text>
                <line x1="202" y1="224" x2="310" y2="224" stroke="#a58c4c" />
                <line
                  x1="310"
                  y1="224"
                  x2={310 + state.radius * 270}
                  y2="224"
                  stroke="#6d895d"
                />
                <text x="231" y="248" className="svg-small">
                  0.40 m
                </text>
                <text
                  x={304 + state.radius * 135}
                  y="248"
                  className="svg-small"
                >
                  {state.radius.toFixed(2)} m
                </text>
              </>
            )}
          </svg>
          <div className={`torque-readout ${match ? "matched" : ""}`}>
            <div>
              <span>
                {concept === "torque" ? "Turning effect" : "Right-side torque"}
              </span>
              <strong>
                {turning.toFixed(2)} <small>N·m</small>
              </strong>
            </div>
            <div className="target-note">
              <span>{match ? "Target matched" : "Match the target"}</span>
              <strong>8.00 N·m</strong>
            </div>
          </div>
          <div className="sliders">
            {slider(
              "radius",
              concept === "torque" ? "Distance from hinge" : "Right moment arm",
              0.1,
              1,
              0.05,
              "m",
            )}
            {slider("force", "Applied force", 0, 60, 1, "N")}
            {concept === "torque" &&
              slider("angle", "Angle between radius & force", 0, 180, 5, "°")}
          </div>
          <button
            className="equation-toggle"
            onClick={() => setEquation(!equation)}
            aria-expanded={equation}
          >
            See the relationship{" "}
            <ChevronDown size={14} className={equation ? "rotated" : ""} />
          </button>
          {equation && (
            <div className="equation">
              τ = r × F × sin θ{" "}
              <span>
                {state.radius.toFixed(2)} × {state.force} × sin({state.angle}°)
                = {turning.toFixed(2)} N·m
              </span>
            </div>
          )}
          <p className="lab-footnote">
            {concept === "torque"
              ? "The footage supplies the context. All forces and distances here are practice values. Door inertia and friction are omitted."
              : "Ideal, massless lever with vertical loads. The pivot supplies the upward support force; torque balance is the focus."}
          </p>
        </>
      )}
    </div>
  );
}
