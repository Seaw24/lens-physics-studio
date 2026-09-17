import { useEffect, useRef, useState } from "react";
import type { SimEvent, SimSeries } from "../../../shared/studio/engines";
import { formatNumber, niceStep } from "./draw";

function valueAt(points: Array<[number, number]>, x: number) {
  if (!points.length) return null;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++)
    if (points[i][0] >= x) {
      const [x0, y0] = points[i - 1];
      const [x1, y1] = points[i];
      const w = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      return y0 + (y1 - y0) * w;
    }
  return points.at(-1)![1];
}

/** Live chart of one simulation series with the previous run and a playhead. */
export default function LabChart({
  series,
  ghost,
  t,
  events,
  color = "#ff7a2f",
}: {
  series: SimSeries;
  ghost: SimSeries | null;
  t: number;
  events: SimEvent[];
  color?: string;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(360);
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setWidth(Math.max(200, Math.round(entry.contentRect.width))),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = 190;
  const pad = { left: 46, right: 14, top: 14, bottom: 30 };
  const parametric = Boolean(series.xLabel);
  const all = [...series.points, ...(ghost?.points ?? [])];
  let x0 = Math.min(...all.map((p) => p[0]));
  let x1 = Math.max(...all.map((p) => p[0]));
  let y0 = Math.min(...all.map((p) => p[1]));
  let y1 = Math.max(...all.map((p) => p[1]));
  if (!parametric) x0 = Math.min(0, x0);
  if (y0 > 0 && y0 < (y1 - y0) * 0.6) y0 = 0;
  if (y1 < 0 && -y1 < (y1 - y0) * 0.6) y1 = 0;
  if (!(x1 > x0)) x1 = x0 + 1;
  if (!(y1 > y0)) {
    y1 += Math.max(1, Math.abs(y1) * 0.1);
    y0 -= Math.max(1, Math.abs(y0) * 0.1);
  }
  const span = y1 - y0;
  y1 += span * 0.08;
  if (y0 < 0) y0 -= span * 0.08;
  const sx = (x: number) => pad.left + ((x - x0) / (x1 - x0)) * (width - pad.left - pad.right);
  const sy = (y: number) => pad.top + (1 - (y - y0) / (y1 - y0)) * (height - pad.top - pad.bottom);
  const line = (points: Array<[number, number]>) =>
    points.map(([x, y], i) => `${i ? "L" : "M"}${sx(x).toFixed(1)} ${sy(y).toFixed(1)}`).join("");
  const xStep = niceStep(x1 - x0, Math.max(3, Math.floor(width / 70)));
  const yStep = niceStep(y1 - y0, 4);
  const xTicks: number[] = [];
  for (let x = Math.ceil(x0 / xStep) * xStep; x <= x1 + 1e-9; x += xStep) xTicks.push(x);
  const yTicks: number[] = [];
  for (let y = Math.ceil(y0 / yStep) * yStep; y <= y1 + 1e-9; y += yStep) yTicks.push(y);
  const visible = parametric ? series.points : series.points.filter((p) => p[0] <= t + 1e-9);
  const current = parametric ? null : valueAt(series.points, t);
  const area =
    visible.length > 1 && !parametric
      ? `${line(visible)}L${sx(visible.at(-1)![0]).toFixed(1)} ${sy(Math.max(y0, Math.min(y1, 0))).toFixed(1)}L${sx(visible[0][0]).toFixed(1)} ${sy(Math.max(y0, Math.min(y1, 0))).toFixed(1)}Z`
      : "";
  const gradientId = `lab-chart-${series.key}`;
  return (
    <div className="lab-chart" ref={host}>
      <svg width={width} height={height} role="img" aria-label={`${series.label} chart`}>
        <defs>
          <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={color} stopOpacity="0.28" />
            <stop offset="1" stopColor={color} stopOpacity="0" />
          </linearGradient>
        </defs>
        {yTicks.map((y) => (
          <g key={`y${y}`}>
            <line x1={pad.left} x2={width - pad.right} y1={sy(y)} y2={sy(y)} className={Math.abs(y) < 1e-9 ? "lab-chart-zero" : "lab-chart-grid"} />
            <text x={pad.left - 8} y={sy(y) + 3.5} textAnchor="end" className="lab-chart-tick">
              {formatNumber(y, yStep < 1 ? 2 : 0)}
            </text>
          </g>
        ))}
        {xTicks.map((x) => (
          <text key={`x${x}`} x={sx(x)} y={height - pad.bottom + 16} textAnchor="middle" className="lab-chart-tick">
            {formatNumber(x, xStep < 1 ? (xStep < 0.1 ? 2 : 1) : 0)}
          </text>
        ))}
        <text x={width - pad.right} y={height - 4} textAnchor="end" className="lab-chart-axis">
          {parametric ? `${series.xLabel} (${series.xUnit})` : "time (s)"}
        </text>
        {!parametric &&
          events.map((event) =>
            event.t >= x0 && event.t <= x1 ? (
              <g key={`${event.id}-${event.t}`}>
                <line x1={sx(event.t)} x2={sx(event.t)} y1={pad.top} y2={height - pad.bottom} className="lab-chart-event" />
                <title>{event.label}</title>
              </g>
            ) : null,
          )}
        {ghost && <path d={line(ghost.points)} className="lab-chart-ghost" />}
        {parametric ? (
          <path d={line(series.points)} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" />
        ) : (
          <>
            <path d={line(series.points)} fill="none" stroke={color} strokeOpacity="0.22" strokeWidth="2" />
            {area && <path d={area} fill={`url(#${gradientId})`} />}
            {visible.length > 1 && (
              <path d={line(visible)} fill="none" stroke={color} strokeWidth="2.6" strokeLinejoin="round" strokeLinecap="round" />
            )}
            {current !== null && (
              <g>
                <line x1={sx(t)} x2={sx(t)} y1={pad.top} y2={height - pad.bottom} className="lab-chart-playhead" />
                <circle cx={sx(t)} cy={sy(current)} r="4.5" fill={color} stroke="#fff" strokeWidth="1.5" />
                <text
                  x={Math.min(width - pad.right - 4, sx(t) + 8)}
                  y={Math.max(pad.top + 10, sy(current) - 8)}
                  textAnchor={sx(t) > width - 90 ? "end" : "start"}
                  className="lab-chart-value"
                >
                  {formatNumber(current, 2)} {series.unit}
                </text>
              </g>
            )}
          </>
        )}
      </svg>
    </div>
  );
}
