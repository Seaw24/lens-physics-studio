import { useEffect, useRef, useState } from "react";
import {
  Play,
  Pause,
  Maximize,
  Pencil,
  Check,
  RotateCcw,
  Volume2,
  VolumeX,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { formatTime, type Moment, type Anchor } from "../shared/physics";
export default function VideoPlayer({
  src,
  moments,
  seek,
  onTime,
  annotations = false,
  onAnchors,
  onEnded,
  rate = 1,
  onRateChange,
  autoPlay = false,
  compact = false,
}: {
  src: string;
  moments: Moment[];
  seek: { time: number; nonce: number };
  onTime?: (time: number) => void;
  annotations?: boolean;
  onAnchors?: (anchors: Anchor[], time?: number) => void;
  onEnded?: () => void;
  rate?: number;
  onRateChange?: (rate: number) => void;
  autoPlay?: boolean;
  compact?: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null),
    container = useRef<HTMLDivElement>(null),
    svg = useRef<SVGSVGElement>(null);
  const [playing, setPlaying] = useState(false),
    [time, setTime] = useState(0),
    [duration, setDuration] = useState(0),
    [editing, setEditing] = useState(false),
    [active, setActive] = useState(0),
    [error, setError] = useState("");
  const drag = useRef<number | null>(null);
  const [aspect, setAspect] = useState(9 / 16),
    [muted, setMuted] = useState(true);
  const trace = moments[0]?.trace || [];
  const before = [...trace].reverse().find((p) => p.time <= time),
    after = trace.find((p) => p.time >= time);
  const weight =
    before && after && after.time !== before.time
      ? (time - before.time) / (after.time - before.time)
      : 0;
  const tracked =
    before && after
      ? {
          x: before.x + (after.x - before.x) * weight,
          y: before.y + (after.y - before.y) * weight,
          label: "Ball",
          type: "point" as const,
        }
      : null;
  const anchors =
    trace.length && !editing
      ? tracked
        ? [tracked]
        : []
      : moments[0]?.anchors || [];
  const imageWidth = Math.min(960, 540 * aspect),
    imageHeight = Math.min(540, 960 / aspect),
    offsetX = (960 - imageWidth) / 2,
    offsetY = (540 - imageHeight) / 2;
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const go = () => {
      v.currentTime = Math.min(seek.time, v.duration || seek.time);
      if (autoPlay)
        v.play().catch(() => setError("Press play to start this recording."));
    };
    if (v.readyState >= 1) go();
    else v.addEventListener("loadedmetadata", go, { once: true });
    return () => v.removeEventListener("loadedmetadata", go);
  }, [seek, src, autoPlay]);
  useEffect(() => {
    if (video.current) video.current.playbackRate = rate;
  }, [rate, src]);
  useEffect(() => {
    setEditing(false);
    setActive(0);
  }, [moments[0]?.id]);
  useEffect(() => {
    const element = video.current;
    if (!annotations || !element?.requestVideoFrameCallback) return;
    let frame: number;
    const update = (_now: number, metadata: VideoFrameCallbackMetadata) => {
      setTime(metadata.mediaTime);
      frame = element.requestVideoFrameCallback(update);
    };
    frame = element.requestVideoFrameCallback(update);
    return () => element.cancelVideoFrameCallback(frame);
  }, [annotations, src]);
  const go = (value: number) => {
    if (video.current) {
      video.current.currentTime = value;
      setTime(value);
      onTime?.(value);
    }
  };
  const patch = (i: number, point: Partial<Anchor>) =>
    onAnchors?.(
      anchors.map((a, index) => (index === i ? { ...a, ...point } : a)),
      time,
    );
  return (
    <div
      className={`video-player ${compact ? "compact-player" : ""}`}
      ref={container}
    >
      <div
        className={`video-surface ${aspect < 1 ? "portrait-video" : ""}`}
        style={
          src.includes("basketball-shot")
            ? { backgroundImage: "url(/demo/shot-poster.jpg)" }
            : undefined
        }
      >
        <video
          ref={video}
          src={src}
          poster={src.startsWith("/demo") ? "/demo/shot-poster.jpg" : undefined}
          playsInline
          muted={muted}
          preload="metadata"
          onLoadedMetadata={() => {
            if (video.current) {
              setDuration(video.current.duration);
              setAspect(video.current.videoWidth / video.current.videoHeight);
              setError("");
            }
          }}
          onTimeUpdate={() => {
            const t = video.current?.currentTime || 0;
            setTime(t);
            onTime?.(t);
            if (
              annotations &&
              video.current &&
              !video.current.paused &&
              t >= moments[0]?.end
            ) {
              video.current.pause();
            }
          }}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => {
            setPlaying(false);
            onEnded?.();
          }}
          onError={() =>
            setError(
              "This recording could not be played. Try an MP4 (H.264) file.",
            )
          }
        />
        {annotations && (
          <svg
            ref={svg}
            className={`annotation-layer ${editing ? "editing" : ""}`}
            viewBox="0 0 960 540"
            aria-label="Editable video annotations"
            onPointerMove={(e) => {
              if (drag.current === null || !svg.current) return;
              const box = svg.current.getBoundingClientRect();
              patch(drag.current, {
                x: Math.max(
                  0.03,
                  Math.min(
                    0.97,
                    (((e.clientX - box.left) / box.width) * 960 - offsetX) /
                      imageWidth,
                  ),
                ),
                y: Math.max(
                  0.02,
                  Math.min(
                    0.98,
                    (((e.clientY - box.top) / box.height) * 540 - offsetY) /
                      imageHeight,
                  ),
                ),
              });
            }}
            onPointerUp={() => (drag.current = null)}
            onPointerCancel={() => (drag.current = null)}
          >
            <defs>
              <marker
                id="annotation-arrow"
                viewBox="0 0 10 10"
                refX="8"
                refY="5"
                markerWidth="6"
                markerHeight="6"
                orient="auto"
              >
                <path d="M0 0L10 5L0 10" fill="#eff5ae" />
              </marker>
            </defs>
            {anchors.map((a, i) => (
              <g
                key={i}
                className="annotation-anchor"
                transform={`translate(${offsetX + a.x * imageWidth},${offsetY + a.y * imageHeight})`}
                onPointerDown={(e) => {
                  if (!editing) return;
                  drag.current = i;
                  setActive(i);
                  e.currentTarget.setPointerCapture(e.pointerId);
                  e.preventDefault();
                }}
              >
                {(a.type === "force" || a.type === "motion") && (
                  <line
                    x1="0"
                    y1="0"
                    x2={(a.dx || 0.1) * 960}
                    y2={(a.dy || 0) * 540}
                    stroke="#eff5ae"
                    strokeWidth="4"
                    markerEnd="url(#annotation-arrow)"
                  />
                )}
                <circle
                  r="15"
                  fill="#264a3899"
                  stroke="#f3f6c5"
                  strokeWidth="2"
                />
                <circle r="4" fill="#f3f6c5" />
                <rect
                  x="18"
                  y={a.y < 0.12 ? 20 : -38}
                  width={Math.max(76, a.label.length * 8 + 20)}
                  height="29"
                  rx="5"
                  fill="#203d31ed"
                />
                <text
                  x="28"
                  y={a.y < 0.12 ? 39 : -19}
                  fill="#f7f7e7"
                  fontSize="14"
                  fontFamily="DM Sans,sans-serif"
                >
                  {a.label}
                </text>
                {editing && active === i && (
                  <circle
                    r="23"
                    fill="none"
                    stroke="#f3f6c5"
                    strokeDasharray="3 4"
                  />
                )}
              </g>
            ))}
          </svg>
        )}
        {annotations && (
          <div className="annotation-tools">
            <span>
              {trace.length
                ? "Prepared ball markers · editable"
                : "Position annotations"}
            </span>
            <button
              onClick={() => {
                if (video.current) video.current.pause();
                if (!editing && tracked) onAnchors?.([tracked]);
                setEditing(!editing);
              }}
              aria-pressed={editing}
            >
              {editing ? <Check size={13} /> : <Pencil size={13} />}{" "}
              {editing ? "Done" : "Adjust"}
            </button>
          </div>
        )}
        {!playing && !annotations && (
          <button
            className="center-play"
            aria-label="Play recording"
            onClick={() =>
              video.current
                ?.play()
                .catch(() => setError("The video is not ready yet. Try again."))
            }
          >
            <Play size={25} fill="currentColor" />
          </button>
        )}
        {error && (
          <div className="video-error" role="alert">
            {error}
          </div>
        )}
      </div>
      <div className="player-controls">
        <button
          className="icon-button"
          aria-label={playing ? "Pause recording" : "Play recording"}
          onClick={() => {
            const v = video.current;
            if (v) {
              if (v.paused)
                v.play().catch(() =>
                  setError("Press play again once the recording is loaded."),
                );
              else v.pause();
            }
          }}
        >
          {playing ? (
            <Pause size={17} />
          ) : (
            <Play size={17} fill="currentColor" />
          )}
        </button>
        <span className="time-readout">
          {formatTime(time)} <span>/ {formatTime(duration)}</span>
        </span>
        <div className="scrubber">
          <input
            aria-label="Video time"
            type="range"
            min="0"
            max={duration || 360}
            step=".1"
            value={time}
            onChange={(e) => go(Number(e.target.value))}
          />
          <div className="timeline-pins">
            {moments.map((m) => (
              <button
                key={m.id}
                style={{ left: `${duration ? (m.time / duration) * 100 : 0}%` }}
                aria-label={`Jump to ${m.shortTitle} at ${formatTime(m.time)}`}
                title={m.shortTitle}
                onClick={() => go(m.time)}
              />
            ))}
          </div>
        </div>
        <select
          aria-label="Playback speed"
          value={rate}
          onChange={(e) => onRateChange?.(Number(e.target.value))}
        >
          <option value="0.25">0.25×</option>
          <option value="0.5">0.5×</option>
          <option value="1">1×</option>
          <option value="2">2×</option>
          <option value="4">4×</option>
          <option value="12">12×</option>
        </select>
        <button
          className="icon-button"
          aria-label="Restart recording"
          onClick={() => go(0)}
        >
          <RotateCcw size={15} />
        </button>
        <button
          className="icon-button"
          aria-label={muted ? "Turn sound on" : "Mute sound"}
          onClick={() => setMuted(!muted)}
        >
          {muted ? <VolumeX size={15} /> : <Volume2 size={15} />}
        </button>
        <button
          className="icon-button fullscreen-control"
          aria-label="Full screen video"
          onClick={() =>
            container.current
              ?.requestFullscreen()
              .catch(() =>
                setError("Full screen is not available in this browser."),
              )
          }
        >
          <Maximize size={16} />
        </button>
      </div>
      {annotations && (
        <div className="frame-controls">
          <span>
            {trace.length
              ? "Prepared position tracking. Camera motion is not corrected."
              : "Use a paused frame to inspect the ball."}
          </span>
          <button
            aria-label="Back 0.1 seconds"
            onClick={() => {
              video.current?.pause();
              go(Math.max(0, time - 0.1));
            }}
          >
            <ChevronLeft size={13} /> 0.1s
          </button>
          <button
            aria-label="Forward 0.1 seconds"
            onClick={() => {
              video.current?.pause();
              go(Math.min(duration, time + 0.1));
            }}
          >
            0.1s <ChevronRight size={13} />
          </button>
        </div>
      )}
      {editing && (
        <div className="annotation-editor">
          <label>
            Annotation
            <select
              value={active}
              onChange={(e) => setActive(Number(e.target.value))}
            >
              {anchors.map((a, i) => (
                <option key={i} value={i}>
                  {a.label}
                </option>
              ))}
            </select>
          </label>
          {anchors[active] && (
            <>
              <label>
                Horizontal position
                <input
                  type="range"
                  min=".03"
                  max=".97"
                  step=".01"
                  value={anchors[active].x}
                  onChange={(e) => patch(active, { x: Number(e.target.value) })}
                />
              </label>
              <label>
                Vertical position
                <input
                  type="range"
                  min=".02"
                  max=".98"
                  step=".01"
                  value={anchors[active].y}
                  onChange={(e) => patch(active, { y: Number(e.target.value) })}
                />
              </label>
            </>
          )}
          <small>
            Drag markers or use these controls. Edits adjust this frame’s
            marker. Corrections are saved for this time in the clip.
          </small>
        </div>
      )}
    </div>
  );
}
