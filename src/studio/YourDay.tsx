import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  FlaskConical,
  LoaderCircle,
  Plus,
  RefreshCcw,
  ScanSearch,
  Sparkles,
} from "lucide-react";
import { DISCOVERY_COURSE } from "../../shared/discoveryCourse";
import { SAMPLE_SLIDE, SAMPLE_STUDIO } from "../../shared/studio/sample";
import type {
  DayRecording,
  DaySlide,
  StudioRecord,
  StudioSpec,
} from "../../shared/studio/schema";
import { StudioApiError, studioApi } from "./api";
import PhysicsLab from "./lab/PhysicsLab";
import { RichText } from "./theater/Overlays";
import EventTheater from "./theater/EventTheater";
import "./studio.css";

const SELECTED_KEY = "momentum-day-selected";

const STAGE_LABEL: Record<string, string> = {
  none: "Waiting",
  queued: "Queued",
  annotating: "Tracking motion",
  designing: "Designing quiz & lab",
  checking: "Checking physics",
  ready: "Ready",
  failed: "Needs a retry",
};

const OBJECTIVE_LABEL: Record<string, string> = {
  "force-interaction": "Forces",
  "torque-rotation": "Torque",
  "equilibrium-support": "Equilibrium",
  "released-object-motion": "Free flight",
};

function readSelected() {
  try {
    return localStorage.getItem(SELECTED_KEY);
  } catch {
    return null;
  }
}

function quizDone(eventId: string) {
  try {
    const results = JSON.parse(localStorage.getItem(`studio:${eventId}:quiz`) || "{}");
    return Object.keys(results).length;
  } catch {
    return 0;
  }
}

export default function YourDay({
  onOpenDiscovery,
  includeSample = false,
}: {
  onOpenDiscovery: () => void;
  includeSample?: boolean;
}) {
  const [recordings, setRecordings] = useState<DayRecording[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(readSelected);
  const [record, setRecord] = useState<StudioRecord | null>(null);
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const rail = useRef<HTMLDivElement>(null);

  const loadDay = useCallback(async (signal?: AbortSignal) => {
    try {
      const day = await studioApi.day(signal);
      setRecordings(day.recordings);
      setError("");
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setRecordings((current) => current ?? []);
      setError(
        caught instanceof StudioApiError && caught.status === 401
          ? "Sign in again to see today's analyzed moments."
          : caught instanceof Error
            ? caught.message
            : "Your day could not load.",
      );
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void loadDay(controller.signal);
    return () => controller.abort();
  }, [loadDay]);

  const groups = useMemo(() => {
    const list: Array<{ key: string; title: string; detail: string; slides: DaySlide[] }> = [];
    for (const recording of recordings ?? [])
      list.push({
        key: recording.sessionId,
        title: new Date(recording.createdAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }),
        detail: `${recording.sourceKind === "phone" ? "Live camera" : "Recording"}${recording.durationSeconds ? ` · ${Math.round(recording.durationSeconds)} s` : ""}`,
        slides: recording.slides,
      });
    if (includeSample)
      list.push({ key: "sample", title: "Sample", detail: "Basketball · prepared", slides: [SAMPLE_SLIDE] });
    return list;
  }, [includeSample, recordings]);
  const slides = useMemo(() => groups.flatMap((group) => group.slides), [groups]);
  const current = slides.find((slide) => slide.eventId === selected) ?? slides[0] ?? null;
  const index = current ? slides.indexOf(current) : -1;
  const userSlides = slides.filter((slide) => slide.eventId !== SAMPLE_SLIDE.eventId).length;
  // With nothing to browse yet, the rail would only repeat the one call to action.
  const showRail = slides.length > 0;

  const choose = (eventId: string) => {
    const next = slides.findIndex((slide) => slide.eventId === eventId);
    setDirection(next >= index ? "forward" : "back");
    setSelected(eventId);
    try {
      localStorage.setItem(SELECTED_KEY, eventId);
    } catch {
      // Remembering the slide is optional.
    }
  };

  // Load the selected studio and poll while its agents work.
  useEffect(() => {
    if (!current || current.eventId === SAMPLE_SLIDE.eventId) {
      setRecord(null);
      return;
    }
    let cancelled = false;
    let timer = 0;
    setRecord(null);
    const poll = async () => {
      try {
        const response = await studioApi.event(current.eventId);
        if (cancelled) return;
        setRecord(response.record);
        if (!["ready", "failed"].includes(response.record.stage)) timer = window.setTimeout(poll, 2500);
        else void loadDay();
      } catch (caught) {
        if (cancelled) return;
        setRecord({
          eventId: current.eventId,
          sessionId: current.sessionId,
          stage: "failed",
          updatedAt: new Date().toISOString(),
          startedAt: null,
          attempts: 0,
          error: { code: "LOAD_FAILED", message: caught instanceof Error ? caught.message : "The studio could not load." },
          spec: null,
        });
      }
    };
    void poll();
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [current?.eventId]);

  // Keep rail statuses fresh while anything is being built.
  useEffect(() => {
    if (!recordings?.some((recording) => recording.slides.some((slide) => ["queued", "annotating", "designing", "checking"].includes(slide.stage))))
      return;
    const timer = window.setInterval(() => void loadDay(), 5000);
    return () => window.clearInterval(timer);
  }, [recordings, loadDay]);

  // PowerPoint-style navigation.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest("input, textarea, select, [contenteditable='true']")) return;
      const inRail = rail.current?.contains(target);
      const next =
        event.key === "PageDown" || (inRail && event.key === "ArrowDown")
          ? 1
          : event.key === "PageUp" || (inRail && event.key === "ArrowUp")
            ? -1
            : 0;
      if (!next || index < 0) return;
      const slide = slides[index + next];
      if (!slide) return;
      event.preventDefault();
      choose(slide.eventId);
      rail.current?.querySelector<HTMLElement>(`[data-slide="${slide.eventId}"]`)?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function regenerate(force: boolean) {
    if (!current) return;
    setBusy(true);
    try {
      const response = await studioApi.generate(current.eventId, force);
      setRecord(response.record);
      // Restart polling by re-selecting.
      setSelected(null);
      window.setTimeout(() => setSelected(current.eventId), 0);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not start the build.");
    } finally {
      setBusy(false);
    }
  }

  const spec: StudioSpec | null =
    current?.eventId === SAMPLE_SLIDE.eventId ? SAMPLE_STUDIO : record?.stage === "ready" ? record.spec : null;

  return (
    <div className={`studio-day page-enter${showRail ? "" : " is-solo"}`}>
      {showRail && (
        <nav className="studio-rail" aria-label="Your events" ref={rail}>
          <div className="studio-rail-head">
            <span className="eyebrow">Your day</span>
            <strong>
              {recordings === null ? "Loading…" : `${userSlides} ${userSlides === 1 ? "moment" : "moments"}`}
            </strong>
          </div>
          <div className="studio-rail-scroll">
            {groups.map((group) => (
              <section key={group.key} className="studio-rail-group">
                <h3>
                  <b>{group.title}</b> {group.detail}
                </h3>
                {group.slides.map((slide) => {
                  const number = slides.indexOf(slide) + 1;
                  const active = slide.eventId === current?.eventId;
                  const answered = quizDone(slide.eventId);
                  const building = ["queued", "annotating", "designing", "checking"].includes(slide.stage);
                  return (
                    <button
                      key={slide.eventId}
                      data-slide={slide.eventId}
                      className={`studio-slide ${active ? "is-active" : ""} is-${slide.stage}`}
                      aria-current={active ? "true" : undefined}
                      onClick={() => choose(slide.eventId)}
                    >
                      <span className="studio-slide-number">{String(number).padStart(2, "0")}</span>
                      <span className="studio-slide-thumb">
                        <img src={slide.posterUrl} alt="" loading="lazy" />
                        <span className={`studio-slide-status is-${slide.stage}`} title={STAGE_LABEL[slide.stage]}>
                          {building ? (
                            <LoaderCircle size={11} className="spin" />
                          ) : slide.stage === "ready" ? (
                            answered ? <Check size={11} /> : <Sparkles size={11} />
                          ) : slide.stage === "failed" ? (
                            <AlertTriangle size={11} />
                          ) : null}
                        </span>
                      </span>
                      <span className="studio-slide-copy">
                        <b>{slide.title ?? slide.subject}</b>
                        <small>
                          {building ? STAGE_LABEL[slide.stage] : slide.objectiveIds.map((id) => OBJECTIVE_LABEL[id] ?? id).join(" · ")}
                        </small>
                      </span>
                    </button>
                  );
                })}
              </section>
            ))}
          </div>
          <button className="studio-rail-add" onClick={onOpenDiscovery}>
            <Plus size={15} /> Analyze a recording
          </button>
        </nav>
      )}

      <div className="studio-main">
        {error && <p className="studio-error">{error}</p>}

        {current && (
          <article key={current.eventId} className={`studio-stage enter-${direction}`}>
            <header className="studio-head">
              <span className="studio-count">
                {String(index + 1).padStart(2, "0")}
                <small>/{String(slides.length).padStart(2, "0")}</small>
              </span>
              <div className="studio-head-copy">
                <div className="studio-chips">
                  {spec && <span className="studio-chip is-concept">{spec.headline.concept}</span>}
                  {current.objectiveIds.map((id) => (
                    <span key={id} className="studio-chip" title={DISCOVERY_COURSE.objectives.find((o) => o.id === id)?.description}>
                      {OBJECTIVE_LABEL[id] ?? id}
                    </span>
                  ))}
                  {current.clip.durationSeconds && <span className="studio-chip is-quiet">{current.clip.durationSeconds.toFixed(1)} s clip</span>}
                </div>
                <h1>
                  <RichText text={spec?.headline.title ?? current.subject} />
                </h1>
                <p>{spec?.headline.subtitle ?? current.concept ?? "Your moment is being turned into a lesson."}</p>
              </div>
              {current.eventId !== SAMPLE_SLIDE.eventId && record?.stage === "ready" && (
                <button className="studio-rebuild" disabled={busy} onClick={() => void regenerate(true)} title="Ask the agents to build this studio again">
                  <RefreshCcw size={13} /> Rebuild
                </button>
              )}
            </header>

            {spec ? (
              <StudioBody spec={spec} slide={current} />
            ) : (
              <Building slide={current} record={record} busy={busy} onRetry={() => void regenerate(false)} />
            )}
          </article>
        )}
        {!current && recordings === null && (
          <div className="studio-empty is-loading" role="status">
            <LoaderCircle size={22} className="spin" />
            <p>Looking for today's moments…</p>
          </div>
        )}
        {!current && recordings !== null && (
          <div className="studio-empty">
            <span className="studio-empty-mark" aria-hidden="true">
              <ScanSearch size={26} />
            </span>
            <h2>Your day is waiting for its first moment.</h2>
            <p>
              Record something everyday — a door swinging, a bike braking, a ball in the air — and Momentum turns it
              into a lesson with a quiz and a lab.
            </p>
            <button className="button primary" onClick={onOpenDiscovery}>
              <Plus size={16} /> Analyze a recording
            </button>
            <ol className="studio-empty-steps">
              <li>
                <b>01</b> Upload a clip or connect your phone camera
              </li>
              <li>
                <b>02</b> Momentum finds the teachable moment
              </li>
              <li>
                <b>03</b> Predict, test and explain it
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

function StudioBody({ spec, slide }: { spec: StudioSpec; slide: DaySlide }) {
  const lab = useRef<HTMLDivElement>(null);
  const storageKey = `studio:${spec.eventId}`;
  const source =
    spec.provenance.kind === "agents"
      ? "Annotated by an agent"
      : "Prepared annotations";
  return (
    <>
      <EventTheater
        spec={spec}
        storageKey={storageKey}
        posterUrl={slide.posterUrl}
        sourceLabel={source}
        onOpenLab={() => lab.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
      />
      <section className="studio-concept">
        <div>
          <span className="eyebrow">The idea</span>
          <p>
            <RichText text={spec.headline.summary} />
          </p>
        </div>
        {spec.headline.equation && (
          <div className="studio-equation">
            <RichText text={spec.headline.equation} />
          </div>
        )}
        <ul>
          {spec.headline.keyIdeas.map((idea) => (
            <li key={idea}>
              <RichText text={idea} />
            </li>
          ))}
        </ul>
      </section>
      <div ref={lab} className="studio-lab-anchor">
        <PhysicsLab lab={spec.lab} storageKey={storageKey} />
      </div>
    </>
  );
}

function Building({
  slide,
  record,
  busy,
  onRetry,
}: {
  slide: DaySlide;
  record: StudioRecord | null;
  busy: boolean;
  onRetry: () => void;
}) {
  const stage = record?.stage ?? "queued";
  const steps = [
    { id: "annotating", title: "Tracking the motion", detail: "An agent reads the clip frame by frame and places the physics on the footage." },
    { id: "designing", title: "Writing your quiz and lab", detail: "A second agent designs questions you answer on the video and a lab of the same situation." },
    { id: "ready", title: "Checking the physics", detail: "Every experiment is simulated before you see it." },
  ];
  const position = stage === "designing" || stage === "checking" ? 1 : stage === "ready" ? 3 : stage === "annotating" ? 0 : -1;
  return (
    <div className="studio-building">
      <div className="studio-building-media" style={{ aspectRatio: `${slide.clip.width} / ${slide.clip.height}` }}>
        <video src={slide.clip.url} poster={slide.posterUrl} muted playsInline loop autoPlay />
        <span className="studio-scan" aria-hidden="true" />
      </div>
      <div className="studio-building-copy">
        {stage === "failed" ? (
          <>
            <span className="eyebrow">Studio paused</span>
            <h2>This moment needs another try.</h2>
            <p>{record?.error?.message ?? "The agents could not finish."}</p>
            <button className="button primary" disabled={busy} onClick={onRetry}>
              <RefreshCcw size={14} /> Build it again
            </button>
          </>
        ) : (
          <>
            <span className="eyebrow">
              <Sparkles size={12} /> Building your studio
            </span>
            <h2>Turning “{slide.subject}” into a lesson.</h2>
            <ol className="studio-steps">
              {steps.map((step, i) => (
                <li key={step.id} className={i < position ? "is-done" : i === position ? "is-active" : ""}>
                  <span>{i < position ? <Check size={12} /> : i === position ? <LoaderCircle size={12} className="spin" /> : i + 1}</span>
                  <div>
                    <b>{step.title}</b>
                    <small>{step.detail}</small>
                  </div>
                </li>
              ))}
            </ol>
            <p className="studio-building-note">
              <FlaskConical size={13} /> Usually one to three minutes. You can open other moments meanwhile.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
