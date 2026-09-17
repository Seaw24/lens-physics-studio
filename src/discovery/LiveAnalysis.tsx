import { useEffect, useMemo, useRef, useState } from "react";
import {
  BrainCircuit,
  Check,
  CircleStop,
  Clock3,
  Film,
  LoaderCircle,
  Pause,
  Play,
  Radar,
  RotateCcw,
  ScanLine,
  UploadCloud,
  X,
} from "lucide-react";
import type { CandidateSummary, SessionSnapshot } from "../../shared/discovery";
import {
  learningApi,
  type CandidateDetail,
  type DiscoveryClientConfig,
} from "./api";
import WiredCamera from "./WiredCamera";

export type LaunchSource = {
  kind: "image" | "video" | "phone" | "wired";
  file: File | null;
  startedAt: number;
  /** 0..1 while the file uploads; null once it is on the server. */
  uploadProgress: number | null;
};

type Action = "pause" | "resume" | "stop" | "cancel";

const TERMINAL = new Set([
  "completed",
  "failed",
  "canceled",
  "budget_exhausted",
  "interrupted",
]);

export function isTerminal(state?: SessionSnapshot["state"]) {
  return Boolean(state && TERMINAL.has(state));
}

function clock(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
}

function span(candidate: CandidateSummary) {
  const interval = candidate.sourceInterval;
  return interval
    ? `${clock(interval.startSeconds)}–${clock(interval.endSeconds)}`
    : "this frame";
}

type WindowStatus =
  | "scanning"
  | "empty"
  | "judging"
  | "accepted"
  | "passed"
  | "duplicate"
  | "skipped";

function windowStatus(candidate: CandidateSummary): WindowStatus {
  switch (candidate.state) {
    case "approved":
      return "accepted";
    case "reviewing":
    case "queued":
      return "judging";
    case "suppressed_duplicate":
      return "duplicate";
    case "not_teachable":
      return candidate.suppressionReason === "proposer_returned_empty"
        ? "empty"
        : "passed";
    case "insufficient_evidence":
      return "passed";
    case "proposed":
    case "collecting":
      return candidate.proposerProposalCount === null ? "scanning" : "judging";
    default:
      return "skipped";
  }
}

function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [active]);
  return now;
}

export default function LiveAnalysis({
  session,
  launch,
  config,
  pairing,
  busy,
  onAction,
  onSession,
  onReset,
}: {
  session: SessionSnapshot | null;
  launch: LaunchSource;
  config: DiscoveryClientConfig | null;
  pairing: { url: string; qrDataUrl: string } | null;
  busy: boolean;
  onAction: (action: Action) => void;
  onSession: (session: SessionSnapshot) => void;
  onReset: () => void;
}) {
  const scout = "Scout agent";
  const judge = "Reviewer agent";
  const done = isTerminal(session?.state);
  const now = useNow(!done);
  const live = launch.kind === "phone" || launch.kind === "wired";
  const uploading = launch.uploadProgress !== null;

  // Created in the effect, not useMemo: StrictMode's extra cleanup would revoke a memoized URL.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!launch.file) return setPreviewUrl(null);
    const url = URL.createObjectURL(launch.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [launch.file]);

  const candidates = useMemo(
    () =>
      [...(session?.candidates ?? [])].sort(
        (a, b) =>
          (a.sourceInterval?.startSeconds ?? 0) -
          (b.sourceInterval?.startSeconds ?? 0),
      ),
    [session?.candidates],
  );
  const focus = useMemo(() => {
    if (done) return null;
    return (
      [...candidates].reverse().find((c) => windowStatus(c) === "judging") ??
      [...candidates].reverse().find((c) => windowStatus(c) === "scanning") ??
      null
    );
  }, [candidates, done]);
  const focusStatus = focus ? windowStatus(focus) : null;

  const scanned = candidates.filter(
    (c) => c.proposerProposalCount !== null,
  ).length;
  const nominated = candidates.filter(
    (c) => (c.proposerProposalCount ?? 0) > 0,
  ).length;
  const judged = candidates.filter((c) => c.reviewVerdict !== null).length;
  const accepted = session?.events.length ?? 0;

  const observed = (session?.observedSourceMs ?? 0) / 1000;
  const lastEnd = Math.max(
    0,
    ...candidates.map((c) => c.sourceInterval?.endSeconds ?? 0),
  );
  const duration = session?.sourceDurationMs
    ? session.sourceDurationMs / 1000
    : Math.max(observed, lastEnd, 1) * (done ? 1 : 1.15);
  const scanFraction = Math.min(1, observed / duration);
  const elapsed = (now - launch.startedAt) / 1000;
  const remaining =
    !live && !done && !uploading && scanFraction > 0.08 && scanFraction < 1
      ? (elapsed * (1 - scanFraction)) / scanFraction
      : null;

  // The overall bar blends upload, scanning, and outstanding reviews.
  const pending = candidates.filter((c) =>
    ["scanning", "judging"].includes(windowStatus(c)),
  ).length;
  const overall = done
    ? 1
    : uploading
      ? 0.12 * (launch.uploadProgress ?? 0)
      : live
        ? null
        : 0.12 +
          0.8 *
            scanFraction *
            (candidates.length
              ? 1 - pending / Math.max(candidates.length, 4)
              : 0.3) +
          (session?.state === "draining" ? 0.04 : 0);

  const headline = (() => {
    if (uploading)
      return `Uploading ${launch.file?.name ?? "your file"} · ${Math.round((launch.uploadProgress ?? 0) * 100)}%`;
    if (!session || session.state === "created")
      return "Starting the analysis…";
    switch (session.state) {
      case "completed":
        return accepted
          ? `Done · ${accepted} moment${accepted === 1 ? "" : "s"} passed review`
          : "Done · no moment was strong enough to keep";
      case "budget_exhausted":
        return "Stopped at the model budget · showing what passed so far";
      case "failed":
        return "The analysis stopped with an error";
      case "canceled":
        return "Analysis canceled";
      case "interrupted":
        return "The analysis was interrupted";
      case "paused":
        return "Paused";
      case "draining":
        return `${judge} is finishing the last reviews…`;
    }
    if (focus && focusStatus === "judging")
      return `${judge} is checking a nominated moment at ${span(focus)}`;
    if (focus) return `${scout} is scanning ${span(focus)}`;
    if (live)
      return session.connection === "connected" || observed > 0
        ? "Watching the camera for physics…"
        : "Waiting for the camera to connect…";
    return "Decoding the video and sampling frames…";
  })();

  const steps = live
    ? [
        {
          label: "Camera",
          detail:
            observed > 0 ? `${clock(observed)} captured` : "Waiting for frames",
          state: observed > 0 ? "done" : "active",
        },
      ]
    : [
        {
          label: "Upload",
          detail: uploading
            ? `${Math.round((launch.uploadProgress ?? 0) * 100)}%`
            : launch.file
              ? launch.file.name
              : "Received",
          state: uploading ? "active" : "done",
        },
        {
          label: "Sample frames",
          detail:
            session?.sourceDurationMs != null
              ? `${clock(session.sourceDurationMs / 1000)} of footage`
              : "2 frames per second",
          state: uploading
            ? "waiting"
            : candidates.length || done
              ? "done"
              : "active",
        },
      ];
  steps.push(
    {
      label: `${scout} scans`,
      detail: `${scanned} window${scanned === 1 ? "" : "s"} · ${nominated} nominated`,
      state: done
        ? "done"
        : candidates.some((c) => windowStatus(c) === "scanning")
          ? "active"
          : candidates.length
            ? "done"
            : "waiting",
    },
    {
      label: `${judge} reviews`,
      detail: `${judged} judged · ${accepted} accepted`,
      state: done
        ? "done"
        : candidates.some((c) => windowStatus(c) === "judging")
          ? "active"
          : judged
            ? "done"
            : "waiting",
    },
  );

  const feed = useMemo(
    () =>
      [...candidates]
        .filter((c) => c.sourceInterval || session?.sourceKind === "image")
        .reverse()
        .slice(0, 7),
    [candidates, session?.sourceKind],
  );

  return (
    <section
      className={`live-analysis ${done ? "is-done" : "is-running"}`}
      aria-live="polite"
    >
      <header className="live-head">
        <div className="live-title">
          <span className={`live-pulse ${done ? "is-done" : ""}`}>
            {done ? <Check size={14} /> : <span />}
          </span>
          <div>
            <span className="eyebrow">
              {done
                ? "ANALYSIS COMPLETE"
                : live
                  ? "LIVE ANALYSIS"
                  : "ANALYZING"}
            </span>
            <h2 key={uploading ? "uploading" : headline}>{headline}</h2>
          </div>
        </div>
        <div className="live-meta">
          <span>
            <Clock3 size={13} /> {clock(elapsed)}
            {remaining !== null && remaining > 3 && (
              <em> · about {clock(remaining)} left</em>
            )}
          </span>
          {session && !done && (
            <div className="live-controls">
              {session.state === "ingesting" && !live && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => onAction("pause")}
                >
                  <Pause size={14} /> Pause
                </button>
              )}
              {session.state === "paused" && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => onAction("resume")}
                >
                  <Play size={14} /> Resume
                </button>
              )}
              {["ingesting", "paused"].includes(session.state) && (
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => onAction("stop")}
                >
                  <CircleStop size={14} /> {live ? "Finish" : "Stop early"}
                </button>
              )}
              <button
                className="button text-danger"
                disabled={busy}
                onClick={() => onAction("cancel")}
              >
                <X size={14} /> Cancel
              </button>
            </div>
          )}
          {(done || (!session && !uploading)) && (
            <button className="button primary" onClick={onReset}>
              <RotateCcw size={14} /> Analyze another
            </button>
          )}
        </div>
      </header>

      <div
        className={`live-bar ${overall === null ? "is-indeterminate" : ""}`}
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={overall === null ? undefined : Math.round(overall * 100)}
      >
        <span style={{ width: `${Math.round((overall ?? 1) * 100)}%` }} />
      </div>

      {!done && (
        <div className="live-grid">
          <div className="live-stage">
            {live &&
            session &&
            !["created", "ingesting", "paused"].includes(session.state) ? (
              // Capture is over: show the sampled frames the models are judging.
              <FrameStage
                sessionId={session.id}
                target={focus ?? candidates.at(-1) ?? null}
                focusStatus={focusStatus}
              />
            ) : launch.kind === "wired" && session ? (
              <WiredCamera
                key={session.id}
                session={session}
                onSession={onSession}
              />
            ) : launch.kind === "phone" ? (
              <div className="live-pairing">
                {pairing ? (
                  <>
                    <img
                      src={pairing.qrDataUrl}
                      alt="One-time phone pairing QR code"
                    />
                    <div>
                      <strong>Scan with your phone</strong>
                      <p>
                        Open within two minutes and keep the page in the
                        foreground. The one-time token is removed after it
                        connects.
                      </p>
                      <a href={pairing.url}>{pairing.url}</a>
                    </div>
                  </>
                ) : (
                  <p>
                    <LoaderCircle className="spin" size={16} /> Creating a
                    pairing code…
                  </p>
                )}
              </div>
            ) : (
              <StagePreview
                url={previewUrl}
                kind={launch.kind}
                focus={focus}
                focusStatus={focusStatus}
                uploading={uploading}
                observed={observed}
              />
            )}
          </div>

          <aside className="live-side">
            <ol className="live-steps">
              {steps.map((step) => (
                <li key={step.label} className={`is-${step.state}`}>
                  <span className="live-step-dot">
                    {step.state === "done" ? (
                      <Check size={12} />
                    ) : step.state === "active" ? (
                      <LoaderCircle className="spin" size={12} />
                    ) : null}
                  </span>
                  <div>
                    <strong>{step.label}</strong>
                    <small>{step.detail}</small>
                  </div>
                </li>
              ))}
            </ol>

            <div className="live-feed">
              <span className="live-feed-title">Model activity</span>
              {feed.length ? (
                <ul>
                  {feed.map((candidate) => (
                    <FeedItem
                      key={`${candidate.id}-${candidate.state}-${candidate.proposerProposalCount}`}
                      candidate={candidate}
                      scout={scout}
                      judge={judge}
                    />
                  ))}
                </ul>
              ) : (
                <p className="live-feed-empty">
                  {uploading
                    ? "Models start as soon as the upload finishes."
                    : "The first window will appear here in a few seconds."}
                </p>
              )}
            </div>
          </aside>
        </div>
      )}

      {session && session.sourceKind !== "image" && (
        <Timeline
          candidates={candidates}
          session={session}
          duration={duration}
          observed={observed}
          done={done}
        />
      )}

      {session && (
        <div className="live-stats">
          <span>
            <ScanLine size={13} /> <b>{scanned}</b> windows scanned
          </span>
          <span>
            <Radar size={13} /> <b>{nominated}</b> nominated
          </span>
          <span>
            <BrainCircuit size={13} /> <b>{judged}</b> judged
          </span>
          <span className="is-accepted">
            <Check size={13} /> <b>{accepted}</b> accepted
          </span>
        </div>
      )}
    </section>
  );
}

function StagePreview({
  url,
  kind,
  focus,
  focusStatus,
  uploading,
  observed,
}: {
  url: string | null;
  kind: LaunchSource["kind"];
  focus: CandidateSummary | null;
  focusStatus: WindowStatus | null;
  uploading: boolean;
  observed: number;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);
  const start = focus?.sourceInterval?.startSeconds ?? null;
  const end = focus?.sourceInterval?.endSeconds ?? null;
  const observedRef = useRef(observed);
  observedRef.current = observed;

  useEffect(() => setFailed(false), [url]);

  // Loop the window the models are looking at; otherwise rest on the scan head.
  useEffect(() => {
    const element = video.current;
    if (!element || !url) return;
    const apply = () => {
      if (start === null || end === null) {
        element.pause();
        element.currentTime = Math.min(
          observedRef.current,
          Number.isFinite(element.duration) ? element.duration : Infinity,
        );
        return;
      }
      element.currentTime = start;
      void element.play().catch(() => undefined);
    };
    const loop = () => {
      if (start === null || end === null) return;
      if (element.currentTime >= end || element.currentTime < start - 0.25)
        element.currentTime = start;
    };
    if (element.readyState >= 1) apply();
    element.addEventListener("loadedmetadata", apply);
    element.addEventListener("timeupdate", loop);
    return () => {
      element.removeEventListener("loadedmetadata", apply);
      element.removeEventListener("timeupdate", loop);
    };
  }, [url, start, end]);

  const label = uploading
    ? "Uploading"
    : focusStatus === "judging"
      ? "Reviewer checking"
      : focusStatus === "scanning"
        ? "Scout scanning"
        : "Reading frames";

  return (
    <div className={`stage-preview ${focusStatus ? `is-${focusStatus}` : ""}`}>
      {url && kind === "video" && (
        <video
          ref={video}
          src={url}
          muted
          playsInline
          preload="auto"
          onError={() => setFailed(true)}
          aria-label="The part of your video being analyzed"
        />
      )}
      {failed && (
        <div className="stage-empty">
          <Film size={28} />
          <small>
            This browser cannot preview the video. Analysis continues.
          </small>
        </div>
      )}
      {url && kind === "image" && <img src={url} alt="Your uploaded photo" />}
      {!url && (
        <div className="stage-empty">
          <UploadCloud size={28} />
        </div>
      )}
      <span className="stage-beam" aria-hidden="true" />
      <span className="stage-corners" aria-hidden="true" />
      <div className="stage-chip">
        <span className="stage-chip-dot" />
        {label}
        {focus?.sourceInterval && <b>{span(focus)}</b>}
      </div>
    </div>
  );
}

function FrameStage({
  sessionId,
  target,
  focusStatus,
}: {
  sessionId: string;
  target: CandidateSummary | null;
  focusStatus: WindowStatus | null;
}) {
  const [frames, setFrames] = useState<CandidateDetail["frames"]>([]);
  const [index, setIndex] = useState(0);

  // Frames are copied when a window is nominated, so refetch as its state moves on.
  useEffect(() => {
    if (!target) return;
    let current = true;
    learningApi
      .candidate(sessionId, target.id)
      .then((detail) => {
        if (!current) return;
        setFrames(detail.frames);
        setIndex(0);
      })
      .catch(() => current && setFrames([]));
    return () => {
      current = false;
    };
  }, [sessionId, target?.id, target?.state]);

  // Flip through the window like the models read it, lingering on evidence frames.
  useEffect(() => {
    if (frames.length < 2) return;
    const timer = window.setTimeout(
      () => setIndex((value) => (value + 1) % frames.length),
      frames[index]?.evidence ? 700 : 380,
    );
    return () => window.clearTimeout(timer);
  }, [frames, index]);

  const frame = frames[index];
  const label =
    focusStatus === "judging"
      ? "Reviewer checking"
      : focusStatus === "scanning"
        ? "Scout scanning"
        : "Last reviewed window";

  return (
    <div
      className={`stage-preview frame-stage ${focusStatus ? `is-${focusStatus}` : ""}`}
    >
      {frames.map((item, position) => (
        <img
          key={item.url}
          src={item.url}
          alt={position === index ? "Frame the models are reviewing" : ""}
          className={position === index ? "is-current" : ""}
        />
      ))}
      {!frames.length && (
        <div className="stage-empty">
          <LoaderCircle className="spin" size={26} />
          <small>
            {target
              ? "Loading the frames for this window…"
              : "Waiting for the first window to review…"}
          </small>
        </div>
      )}
      {focusStatus && <span className="stage-beam" aria-hidden="true" />}
      <span className="stage-corners" aria-hidden="true" />
      <div className="stage-chip">
        <span className="stage-chip-dot" />
        {label}
        {target?.sourceInterval && <b>{span(target)}</b>}
      </div>
      {frame && (
        <div className="frame-strip" aria-hidden="true">
          {frames.map((item, position) => (
            <span
              key={item.url}
              className={`${position === index ? "is-current" : ""} ${item.evidence ? "is-evidence" : ""}`}
            />
          ))}
          <b>
            {frame.sourceTimeMs !== null
              ? clock(frame.sourceTimeMs / 1000)
              : `${index + 1}/${frames.length}`}
          </b>
        </div>
      )}
    </div>
  );
}

function FeedItem({
  candidate,
  scout,
  judge,
}: {
  candidate: CandidateSummary;
  scout: string;
  judge: string;
}) {
  const status = windowStatus(candidate);
  const count = candidate.proposerProposalCount ?? 0;
  const copy: Record<WindowStatus, { who: string; text: string }> = {
    scanning: { who: scout, text: "Looking for physics in this window…" },
    empty: { who: scout, text: "Nothing teachable here. Moving on." },
    judging: {
      who: judge,
      text: `Checking ${count > 1 ? `${count} nominated moments` : "a nominated moment"} against the frames…`,
    },
    accepted: {
      who: judge,
      text: candidate.reviewReason || "Accepted as a teachable moment.",
    },
    passed: {
      who: judge,
      text: candidate.reviewReason || "Not strong enough to keep.",
    },
    duplicate: {
      who: judge,
      text: "Same concept as an earlier moment. Kept the better one.",
    },
    skipped: { who: "Discovery", text: "Window skipped." },
  };
  const { who, text } = copy[status];
  return (
    <li className={`feed-item is-${status}`}>
      <span className="feed-icon">
        {status === "scanning" || status === "judging" ? (
          <LoaderCircle className="spin" size={13} />
        ) : status === "accepted" ? (
          <Check size={13} />
        ) : status === "empty" ? (
          <Radar size={13} />
        ) : (
          <BrainCircuit size={13} />
        )}
      </span>
      <div>
        <span className="feed-meta">
          <b>{who}</b> · {span(candidate)}
        </span>
        <p>{text}</p>
      </div>
    </li>
  );
}

function Timeline({
  candidates,
  session,
  duration,
  observed,
  done,
}: {
  candidates: CandidateSummary[];
  session: SessionSnapshot;
  duration: number;
  observed: number;
  done: boolean;
}) {
  const pct = (seconds: number) =>
    `${Math.min(100, Math.max(0, (seconds / duration) * 100))}%`;
  return (
    <div className="live-timeline">
      <div className="timeline-track">
        <span
          className="timeline-scanned"
          style={{ width: pct(done ? duration : observed) }}
        />
        {candidates.map((candidate) =>
          candidate.sourceInterval ? (
            <span
              key={candidate.id}
              className={`timeline-window is-${windowStatus(candidate)}`}
              style={{
                left: pct(candidate.sourceInterval.startSeconds),
                width: `max(3px, ${pct(
                  candidate.sourceInterval.endSeconds -
                    candidate.sourceInterval.startSeconds,
                )})`,
              }}
            />
          ) : null,
        )}
        {session.events.map((event) => {
          const interval = event.review.eventSourceInterval;
          if (!interval) return null;
          return (
            <a
              key={event.id}
              href={`#moment-${event.id}`}
              className="timeline-flag"
              style={{ left: pct(interval.startSeconds) }}
              title={event.review.opportunity.subject}
            >
              <Check size={10} />
            </a>
          );
        })}
        {!done && (
          <span className="timeline-head" style={{ left: pct(observed) }} />
        )}
      </div>
      <div className="timeline-scale">
        <span>0:00</span>
        <span className="timeline-legend">
          <i className="is-scanning" /> scanning
          <i className="is-judging" /> reviewing
          <i className="is-accepted" /> accepted
        </span>
        <span>
          {session.sourceDurationMs ? clock(duration) : clock(observed)}
        </span>
      </div>
    </div>
  );
}
