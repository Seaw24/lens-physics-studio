import { useEffect, useRef, useState } from "react";
import { Pause, Play, RotateCcw, Crosshair, ArrowDown } from "lucide-react";
import { flightTime, projectileAt } from "../shared/physics";
import type { ModelState } from "./Models";
export function BasketballArt() {
  return (
    <svg
      viewBox="0 0 640 360"
      className="basketball-art"
      role="img"
      aria-label="Diagram of a basketball following a curved path toward a hoop"
    >
      <defs>
        <pattern
          id="court-grid"
          width="40"
          height="40"
          patternUnits="userSpaceOnUse"
        >
          <path d="M40 0H0V40" fill="none" stroke="#d8dfc9" strokeWidth=".7" />
        </pattern>
      </defs>
      <rect width="640" height="360" fill="#e9eddf" />
      <rect width="640" height="360" fill="url(#court-grid)" />
      <path d="M0 282H640V360H0Z" fill="#dfe5cd" />
      <path
        d="M42 314H594M481 282V340H548V282M205 314Q215 355 229 314"
        fill="none"
        stroke="#c4cfaf"
      />
      <path
        d="M85 253Q230 12 513 201"
        fill="none"
        stroke="#91a575"
        strokeDasharray="4 8"
        strokeWidth="2"
      />
      {[
        [85, 253],
        [158, 158],
        [244, 107],
        [339, 113],
        [432, 154],
      ].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r="5" fill="#a9b98e" />
      ))}
      <g transform="translate(294 106)">
        <circle r="22" fill="#ba8248" stroke="#876235" strokeWidth="1.5" />
        <path
          d="M-22 0H22M0-22V22M-16-16Q3 0-16 16M16-16Q-3 0 16 16"
          fill="none"
          stroke="#876235"
          strokeWidth="1.4"
        />
      </g>
      <path d="M552 123V284" stroke="#71855a" strokeWidth="5" />
      <rect x="539" y="132" width="6" height="66" rx="2" fill="#b5c3a0" />
      <path
        d="M504 204H543M507 204L513 230H532L537 204M516 204L521 230M529 204L525 230"
        fill="none"
        stroke="#9da889"
        strokeWidth="2"
      />
      <path
        d="M70 240V283M70 262L53 303M70 262L88 303M70 246L87 229M70 245L53 228"
        fill="none"
        stroke="#87976e"
        strokeWidth="7"
        strokeLinecap="round"
      />
      <circle cx="70" cy="226" r="10" fill="#b0ba98" />
      <text
        x="26"
        y="36"
        fontFamily="Source Code Pro,monospace"
        fontSize="10"
        letterSpacing="1.5"
        fill="#6e8550"
      >
        PROJECTILE MOTION / DIAGRAM
      </text>
    </svg>
  );
}
export default function Projectile({
  state,
  setState,
}: {
  state: ModelState;
  setState: (state: ModelState) => void;
}) {
  const speed = state.speed ?? 9.5,
    height = state.height ?? 2,
    angle = state.angle;
  const duration = flightTime(speed, angle, height),
    apex = (speed * Math.sin((angle * Math.PI) / 180)) / 9.81;
  const [time, setTime] = useState(0),
    [playing, setPlaying] = useState(false),
    [vectors, setVectors] = useState(true);
  const origin = useRef<{ stamp: number; time: number } | null>(null);
  useEffect(() => {
    setTime(0);
    setPlaying(false);
    origin.current = null;
  }, [speed, height, angle]);
  useEffect(() => {
    if (!playing) return;
    let id: number;
    const tick = (stamp: number) => {
      if (!origin.current) origin.current = { stamp, time };
      const next = Math.min(
        duration,
        origin.current.time + ((stamp - origin.current.stamp) / 1000) * 0.65,
      );
      setTime(next);
      if (next < duration) id = requestAnimationFrame(tick);
      else {
        setPlaying(false);
        origin.current = null;
      }
    };
    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [playing, duration]);
  const p = projectileAt(time, speed, angle, height),
    maxY =
      height + (speed * Math.sin((angle * Math.PI) / 180)) ** 2 / (2 * 9.81),
    range = projectileAt(duration, speed, angle, height).x;
  const xmax = Math.max(13, range + 1),
    ymax = Math.max(7, maxY + 1.6),
    sx = (v: number) => 56 + (v / xmax) * 546,
    sy = (v: number) => 302 - (v / ymax) * 255;
  const path = Array.from({ length: 61 }, (_, i) => {
    const point = projectileAt((i / 60) * duration, speed, angle, height);
    return `${i ? "L" : "M"}${sx(point.x)} ${sy(point.y)}`;
  }).join(" ");
  const atTop = Math.abs(time - apex) < 0.04;
  function change(key: "speed" | "height" | "angle", value: number) {
    setState({ ...state, [key]: value });
  }
  return (
    <div className="model-lab projectile-lab">
      <div className="lab-meta">
        <span className="eyebrow">Projectile model</span>
        <span className="source-tag">Practice values</span>
      </div>
      <svg
        viewBox="0 0 640 340"
        className="projectile-diagram"
        role="img"
        aria-label={`Basketball projectile at ${time.toFixed(2)} seconds. Horizontal velocity ${p.vx.toFixed(2)} metres per second. Vertical velocity ${p.vy.toFixed(2)} metres per second. Acceleration 9.81 metres per second squared downward.`}
      >
        <defs>
          <marker
            id="p-gravity"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0L10 5L0 10" fill="#527e48" />
          </marker>
          <marker
            id="p-velocity"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 0L10 5L0 10" fill="#bd894f" />
          </marker>
        </defs>
        {[1, 2, 3, 4, 5, 6].map((y) => (
          <g key={y}>
            <line
              x1="56"
              y1={sy((y * ymax) / 7)}
              x2="602"
              y2={sy((y * ymax) / 7)}
              stroke="#e2e8d5"
            />
            <text x="31" y={sy((y * ymax) / 7) + 4} className="svg-small">
              {((y * ymax) / 7).toFixed(1)}
            </text>
          </g>
        ))}
        <line x1="56" y1="302" x2="605" y2="302" stroke="#adbca0" />
        <line x1="56" y1="37" x2="56" y2="302" stroke="#adbca0" />
        <text x="17" y="22" className="svg-small">
          height (m)
        </text>
        <text x="514" y="329" className="svg-small">
          distance (m)
        </text>
        {[0, 1, 2, 3, 4].map((i) => (
          <text
            key={i}
            x={sx((i * xmax) / 4)}
            y="320"
            className="svg-small"
            textAnchor="middle"
          >
            {((i * xmax) / 4).toFixed(1)}
          </text>
        ))}
        <path
          d={path}
          fill="none"
          stroke="#acbf93"
          strokeWidth="1.7"
          strokeDasharray="4 5"
        />
        {Array.from({ length: 13 }, (_, i) => {
          const point = projectileAt((i / 12) * duration, speed, angle, height);
          return (
            <circle
              key={i}
              cx={sx(point.x)}
              cy={sy(point.y)}
              r="2.5"
              fill="#9daf82"
            />
          );
        })}
        <path
          d={`M${sx(10.2)} ${sy(4)}V302 M${sx(10)} ${sy(3.5)}V${sy(2.9)} M${sx(9.7)} ${sy(3.05)}H${sx(10)}`}
          fill="none"
          stroke="#a9b995"
          strokeWidth="3"
        />
        <text x={sx(9.1)} y={sy(3.05) + 19} className="svg-small">
          hoop 3.05 m
        </text>
        {atTop && (
          <g>
            <line
              x1={sx(p.x)}
              y1={sy(p.y) - 37}
              x2={sx(p.x)}
              y2="302"
              stroke="#bbcda1"
              strokeDasharray="3 5"
            />
            <rect
              x={sx(p.x) - 33}
              y={sy(p.y) - 51}
              width="66"
              height="22"
              rx="4"
              fill="#e8f0d8"
            />
            <text
              x={sx(p.x)}
              y={sy(p.y) - 36}
              textAnchor="middle"
              className="svg-small"
            >
              THE APEX
            </text>
          </g>
        )}
        <g transform={`translate(${sx(p.x)},${sy(Math.max(0, p.y))})`}>
          <circle r="12" fill="#c48a4a" stroke="#926b39" strokeWidth="1.3" />
          <path
            d="M-12 0H12M0-12V12M-9-8Q3 0-9 8M9-8Q-3 0 9 8"
            fill="none"
            stroke="#936c3e"
            strokeWidth=".8"
          />
          {vectors && (
            <>
              <line
                x1="0"
                y1="15"
                x2="0"
                y2="61"
                stroke="#527e48"
                strokeWidth="2.5"
                markerEnd="url(#p-gravity)"
              />
              <text
                x="9"
                y="58"
                className="svg-small"
                style={{ fill: "#527e48" }}
              >
                gravity
              </text>
              <line
                x1="15"
                y1="0"
                x2={15 + p.vx * 6}
                y2="0"
                stroke="#bd894f"
                strokeWidth="2.5"
                markerEnd="url(#p-velocity)"
              />
              {Math.abs(p.vy) > 0.1 && (
                <line
                  x1="-17"
                  y1="0"
                  x2="-17"
                  y2={-p.vy * 6}
                  stroke="#bd894f"
                  strokeWidth="2.5"
                  markerEnd="url(#p-velocity)"
                />
              )}
            </>
          )}
        </g>
      </svg>
      <div className="flight-controls">
        <button
          className="button secondary"
          onClick={() => {
            origin.current = null;
            if (time >= duration) setTime(0);
            setPlaying(!playing);
          }}
        >
          {playing ? <Pause size={15} /> : <Play size={15} />}{" "}
          {playing ? "Pause" : "Play shot"}
        </button>
        <button
          className={`button secondary ${atTop ? "apex-active" : ""}`}
          onClick={() => {
            setPlaying(false);
            origin.current = null;
            setTime(apex);
          }}
        >
          <Crosshair size={15} /> Pause at the top
        </button>
        <button
          className="icon-button"
          aria-label="Reset shot"
          onClick={() => {
            setPlaying(false);
            origin.current = null;
            setTime(0);
          }}
        >
          <RotateCcw size={16} />
        </button>
      </div>
      <label className="flight-scrubber">
        <span>
          Flight time <strong>{time.toFixed(2)} s</strong>
        </span>
        <input
          aria-label="Flight time"
          type="range"
          min="0"
          max={duration}
          step=".005"
          value={time}
          onChange={(e) => {
            setPlaying(false);
            origin.current = null;
            setTime(Number(e.target.value));
          }}
        />
      </label>
      <div className="projectile-readouts">
        <div>
          <small>Horizontal velocity</small>
          <strong>
            {p.vx.toFixed(2)} <span>m/s →</span>
          </strong>
          <em>Stays constant</em>
        </div>
        <div className={atTop ? "apex-readout" : ""}>
          <small>Vertical velocity</small>
          <strong>
            {Math.abs(p.vy) < 0.005 ? "0.00" : p.vy.toFixed(2)} <span>m/s</span>
          </strong>
          <em>
            {atTop
              ? "Zero at the top"
              : p.vy > 0
                ? "Upward, decreasing"
                : "Downward"}
          </em>
        </div>
        <div>
          <small>Acceleration</small>
          <strong>
            9.81 <span>m/s² ↓</span>
          </strong>
          <em>Always downward</em>
        </div>
      </div>
      <div className="shot-sliders">
        {[
          {
            key: "speed",
            label: "Launch speed",
            value: speed,
            min: 4,
            max: 14,
            step: 0.1,
            unit: "m/s",
          },
          {
            key: "angle",
            label: "Launch angle",
            value: angle,
            min: 15,
            max: 80,
            step: 1,
            unit: "°",
          },
          {
            key: "height",
            label: "Release height",
            value: height,
            min: 0.5,
            max: 3,
            step: 0.1,
            unit: "m",
          },
        ].map((s) => (
          <label className="model-slider" key={s.key}>
            <span>
              {s.label}
              <strong>
                {s.value.toFixed(s.key === "angle" ? 0 : 1)}{" "}
                <small>{s.unit}</small>
              </strong>
            </span>
            <input
              aria-label={s.label}
              type="range"
              value={s.value}
              min={s.min}
              max={s.max}
              step={s.step}
              onChange={(e) =>
                change(
                  s.key as "speed" | "height" | "angle",
                  Number(e.target.value),
                )
              }
            />
          </label>
        ))}
      </div>
      <div className="vector-toggle">
        <button aria-pressed={vectors} onClick={() => setVectors(!vectors)}>
          <span className={vectors ? "checked" : ""}>{vectors ? "✓" : ""}</span>{" "}
          Show velocity & gravity arrows
        </button>
        <span>
          <ArrowDown size={12} /> g = 9.81 m/s²
        </span>
      </div>
      <p className="lab-footnote">
        No air resistance, spin, or collisions. The trajectory continues through
        the drawn hoop and ends at the floor. These values are not measurements
        from your recording.
      </p>
    </div>
  );
}
