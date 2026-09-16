import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  ChevronRight,
  CircleHelp,
  Clock3,
  Eye,
  Film,
  FlaskConical,
  Layers3,
  LoaderCircle,
  Plus,
  RotateCcw,
  Settings2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  COURSE,
  DEMO_MOMENTS,
  formatTime,
  type LearningRecord,
  type Moment,
} from "../shared/physics";
import {
  analyzeFrames,
  getStatus,
  sampleVideo,
  type ServiceStatus,
} from "./api";
import Investigation from "./CoachedInvestigation";
import CourseDiagnostic from "./CourseDiagnostic";
import Guide from "./Guide";
import VideoPlayer from "./VideoPlayer";
import { BasketballArt } from "./Projectile";

type Page = "today" | "course" | "moments" | "review" | "investigate" | "guide";
type Modal = "settings" | "upload" | null;
const notebookKey = "lens-notebook-v1";
function readRecords(): LearningRecord[] {
  try {
    const raw = JSON.parse(localStorage.getItem(notebookKey) || "[]");
    return Array.isArray(raw)
      ? raw.filter(
          (r) =>
            r &&
            typeof r.id === "string" &&
            ["force", "torque", "equilibrium", "projectile"].includes(
              r.concept,
            ) &&
            typeof r.reflection === "string" &&
            typeof r.title === "string" &&
            typeof r.completedAt === "string",
        )
      : [];
  } catch {
    return [];
  }
}
function LensMark({ small = false }: { small?: boolean }) {
  return (
    <span className={`lens-mark ${small ? "small" : ""}`}>
      <span />
      <span />
      <span />
    </span>
  );
}
function Pill({ children }: { children: ReactNode }) {
  return <span className="pill">{children}</span>;
}
export default function App() {
  const [page, setPage] = useState<Page>("today"),
    [modal, setModal] = useState<Modal>(null),
    [status, setStatus] = useState<ServiceStatus | null>(null),
    [connectionError, setConnectionError] = useState(""),
    [mode, setMode] = useState<"bedrock" | "rehearsal">("rehearsal"),
    [moments, setMoments] = useState<Moment[]>(DEMO_MOMENTS),
    [selected, setSelected] = useState("shot"),
    [src, setSrc] = useState("/demo/basketball-shot.mp4"),
    [fileName, setFileName] = useState("A shot on the court"),
    [isDemo, setIsDemo] = useState(true),
    [seek, setSeek] = useState({ time: 14.2, nonce: 0 }),
    [rate, setRate] = useState(1),
    [autoPlay, setAutoPlay] = useState(false),
    [records, setRecords] = useState<LearningRecord[]>(readRecords),
    [toast, setToast] = useState(""),
    [available, setAvailable] = useState(true),
    [discovery, setDiscovery] = useState(false),
    [invitation, setInvitation] = useState<Moment | null>(null),
    [deferred, setDeferred] = useState<string[]>([]),
    [stage, setStage] = useState<"idle" | "sampling" | "analyzing" | "done">(
      "idle",
    ),
    [progress, setProgress] = useState(0),
    [uploadError, setUploadError] = useState(""),
    [sampleCount, setSampleCount] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null),
    objectUrl = useRef(""),
    analysis = useRef<AbortController | null>(null),
    seen = useRef(new Set<string>()),
    modalRef = useRef<HTMLDivElement>(null),
    lastFocus = useRef<HTMLElement | null>(null);
  const moment = moments.find((m) => m.id === selected) || moments[0];
  async function refreshStatus() {
    try {
      const next = await getStatus();
      setStatus(next);
      setConnectionError("");
      if (next.configured) setMode("bedrock");
    } catch {
      setConnectionError(
        "The local API is unavailable. Start it with npm run dev, then retry.",
      );
    }
  }
  useEffect(() => {
    refreshStatus();
    return () => {
      analysis.current?.abort();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    if (!modal) return;
    lastFocus.current = document.activeElement as HTMLElement;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    modalRef.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") setModal(null);
      if (e.key === "Tab") {
        const targets = modalRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
        );
        if (!targets?.length) return;
        const first = targets[0],
          last = targets[targets.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === modalRef.current)
        ) {
          e.preventDefault();
          last.focus();
        } else if (
          !e.shiftKey &&
          (document.activeElement === last ||
            document.activeElement === modalRef.current)
        ) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", key);
      lastFocus.current?.focus();
    };
  }, [modal]);
  function navigate(next: Page) {
    setPage(next);
    setAutoPlay(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  function investigate(m: Moment) {
    setSelected(m.id);
    setInvitation(null);
    setDiscovery(false);
    navigate("investigate");
  }
  function selectMoment(m: Moment) {
    setSelected(m.id);
    setSeek({ time: m.time, nonce: Date.now() });
    setAutoPlay(false);
  }
  function saveRecord(record: LearningRecord) {
    const next = [record, ...records.filter((r) => r.id !== record.id)];
    try {
      localStorage.setItem(notebookKey, JSON.stringify(next));
      setRecords(next);
      setToast("Connection saved to your notebook.");
    } catch {
      setRecords(next);
      setToast(
        "Saved for this session. Browser storage is full or unavailable.",
      );
    }
  }
  function removeRecord(id: string) {
    const next = records.filter((r) => r.id !== id);
    setRecords(next);
    try {
      localStorage.setItem(notebookKey, JSON.stringify(next));
      setToast("Connection removed from this notebook.");
    } catch {
      setToast("Removed for this session. Browser storage is unavailable.");
    }
  }
  function exportNotebook() {
    const text = `# My Lens notebook\n\n${records.map((r) => `## ${r.title}\n${r.concept} · ${new Date(r.completedAt).toLocaleDateString()}\n\nAnswer: ${r.answer}\n\n${r.reflection}\n\nHints used: ${r.hints}. Tutor mode: ${r.mode}.\n`).join("\n")}`;
    const url = URL.createObjectURL(
      new Blob([text], { type: "text/markdown" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "my-lens-notebook.md";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function useDemo() {
    analysis.current?.abort();
    if (objectUrl.current) {
      URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = "";
    }
    setSrc("/demo/basketball-shot.mp4");
    setFileName("A shot on the court");
    setIsDemo(true);
    setMoments(DEMO_MOMENTS);
    setSelected("shot");
    setSeek({ time: 14.2, nonce: Date.now() });
    setStage("idle");
    setUploadError("");
    setAutoPlay(false);
    setDiscovery(false);
    setInvitation(null);
  }
  function replayDiscovery() {
    if (!isDemo) useDemo();
    seen.current.clear();
    setDeferred([]);
    setAvailable(true);
    setInvitation(null);
    setDiscovery(true);
    setSeek({ time: 0, nonce: Date.now() });
    setRate(1);
    setAutoPlay(true);
    navigate("today");
    setAutoPlay(true);
    setModal(null);
  }
  function onTime(time: number) {
    if (!discovery) return;
    for (const m of moments) {
      if (time >= m.end && !seen.current.has(m.id)) {
        seen.current.add(m.id);
        if (available) {
          setInvitation(m);
          setSelected(m.id);
        } else
          setDeferred((prev) => (prev.includes(m.id) ? prev : [...prev, m.id]));
      }
    }
  }
  function openFile(file?: File) {
    if (!file) return;
    if (file.size > 500 * 1024 * 1024) {
      setUploadError("Choose a recording smaller than 500 MB.");
      setModal("upload");
      return;
    }
    if (
      !file.type.startsWith("video/") &&
      !/\.(mp4|webm|mov|m4v)$/i.test(file.name)
    ) {
      setUploadError("Choose a video file such as MP4 or WebM.");
      setModal("upload");
      return;
    }
    analysis.current?.abort();
    if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
    const url = URL.createObjectURL(file);
    objectUrl.current = url;
    setSrc(url);
    setFileName(file.name);
    setIsDemo(false);
    setMoments([]);
    setSeek({ time: 0, nonce: Date.now() });
    setAutoPlay(false);
    setDiscovery(false);
    setInvitation(null);
    setDeferred([]);
    setUploadError("");
    setStage("idle");
    setSampleCount(0);
    setModal("upload");
    navigate("today");
  }
  async function runAnalysis() {
    if (stage === "sampling" || stage === "analyzing") return;
    const controller = new AbortController();
    analysis.current = controller;
    setUploadError("");
    setProgress(0);
    setStage("sampling");
    try {
      const sample = await sampleVideo(src, setProgress, controller.signal);
      setSampleCount(sample.frames.length);
      setStage("analyzing");
      const result = await analyzeFrames(
        sample.frames,
        sample.duration,
        controller.signal,
      );
      setMoments(result.moments);
      setSelected(result.moments[0]?.id || "");
      setStage("done");
      if (result.moments[0])
        setSeek({ time: result.moments[0].time, nonce: Date.now() });
      setToast(
        result.moments.length
          ? `${result.moments.length} physics opportunities ready to review.`
          : "No supported physics moments found in these frames.",
      );
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setUploadError(
          e instanceof Error ? e.message : "Analysis failed. Please try again.",
        );
      setStage("idle");
    }
  }
  const navItems = [
    { id: "today", label: "Today", icon: Eye },
    { id: "course", label: "Course", icon: BookOpen },
    { id: "moments", label: "Notebook", icon: Bookmark },
    { id: "review", label: "Practice", icon: Layers3 },
    { id: "guide", label: "Guide", icon: CircleHelp },
  ] as const;
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <aside className="sidebar">
        <button
          className="brand"
          onClick={() => navigate("today")}
          aria-label="Lens home"
        >
          <LensMark />
          <span>
            lens<span className="brand-period">.</span>
          </span>
        </button>
        <nav aria-label="Main navigation">
          {navItems.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              aria-label={label}
              aria-current={
                page === id || (page === "investigate" && id === "today")
                  ? "page"
                  : undefined
              }
              className={
                page === id || (page === "investigate" && id === "today")
                  ? "active"
                  : ""
              }
              onClick={() => navigate(id)}
            >
              <Icon size={19} strokeWidth={1.65} />
              <span>{label}</span>
              {id === "moments" && records.length > 0 && (
                <span className="nav-count">{records.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-course">
          <div className="mini-book">
            <BookOpen size={19} />
          </div>
          <strong>Week 04</strong>
          <p>Projectile motion</p>
          <button className="text-button" onClick={() => navigate("course")}>
            Open course <ArrowUpRight size={14} />
          </button>
        </div>
        <div className="sidebar-bottom">
          <button
            onClick={() => setModal("settings")}
            className="settings-button"
          >
            <Settings2 size={18} /> Studio settings
          </button>
          <div className="student-profile">
            <span className="avatar">N</span>
            <div>
              <strong>Nam’s learning space</strong>
              <small>Student · sample course</small>
            </div>
            <span className="profile-dot" />
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <span>{COURSE.id}</span>
            <ChevronRight size={13} />
            <span>Projectile motion</span>
            <span className="week-badge">Week 04</span>
          </div>
          <div className="header-actions">
            <button
              className="connection-status"
              onClick={() => setModal("settings")}
            >
              <span
                className={`status-dot ${mode === "bedrock" ? "live" : ""}`}
              />
              {mode === "bedrock" ? "Bedrock connected" : "Demo mode"}
            </button>
          </div>
        </header>
        <main id="main-content" tabIndex={-1}>
          {page === "today" && (
            <div className="day-page page-enter">
              <div className="page-heading">
                <div>
                  <h1>Basketball shot</h1>
                  <p>
                    Watch the event, answer guided questions, then test the
                    physics in the lab.
                  </p>
                </div>
                <button
                  className="button secondary upload-button"
                  onClick={() => setModal("upload")}
                >
                  <Plus size={16} /> Add a recording
                </button>
              </div>
              <div className="daily-layout">
                <section className="day-recording">
                  <div className="section-topline">
                    <div>
                      <span className="record-dot" />
                      <strong>{fileName}</strong>
                      <span className="quiet-label">
                        {isDemo
                          ? "Your basketball clip · 49 seconds"
                          : "Local recording"}
                      </span>
                    </div>
                    <span className="source-tag">
                      {isDemo
                        ? "1 guided investigation"
                        : `${moments.length} AI suggestions`}
                    </span>
                  </div>
                  <VideoPlayer
                    src={src}
                    moments={moments}
                    seek={seek}
                    rate={rate}
                    onRateChange={setRate}
                    autoPlay={autoPlay}
                    onTime={onTime}
                    onEnded={() => {
                      setAutoPlay(false);
                      setDiscovery(false);
                    }}
                  />
                  <div className="recording-caption">
                    <span>
                      <ShieldCheck size={14} />
                      {isDemo
                        ? "Real footage. Guided physics questions."
                        : "Your full recording stays in this browser."}
                    </span>
                    <button
                      className="text-button"
                      onClick={
                        isDemo ? replayDiscovery : () => setModal("upload")
                      }
                    >
                      {isDemo ? "Replay discovery" : "Analyze recording"}{" "}
                      <ArrowUpRight size={13} />
                    </button>
                  </div>
                  {discovery && (
                    <div className="discovery-bar">
                      <span className="pulse-dot" />
                      <div>
                        <strong>Discovery replay</strong>
                        <small>
                          Invitations appear after each event
                        </small>
                      </div>
                      <button
                        className={`availability-button ${available ? "available" : ""}`}
                        onClick={() => setAvailable(!available)}
                      >
                        {available ? "I’m available" : "I’m busy"}
                        <span />
                      </button>
                    </div>
                  )}
                  {deferred.length > 0 && (
                    <div className="deferred-note">
                      <Clock3 size={15} />
                      {deferred.length}{" "}
                      {deferred.length === 1 ? "question is" : "questions are"}{" "}
                      waiting for your next break.
                      <button
                        className="text-button"
                        onClick={() => {
                          const next = moments.find(
                            (m) => m.id === deferred[0],
                          );
                          if (next) {
                            setInvitation(next);
                            setSelected(next.id);
                          }
                          setDeferred((prev) => prev.slice(1));
                          setAvailable(true);
                        }}
                      >
                        I have a moment <ArrowRight size={13} />
                      </button>
                    </div>
                  )}
                  <div className="moments-section">
                    <div className="section-heading">
                      <h2>Events</h2>
                      <span>
                        {isDemo ? "Demo clip" : "Your recording"}
                      </span>
                    </div>
                    <div className="moment-list">
                      {moments.map((m, i) => (
                        <button
                          className={`moment-row ${selected === m.id ? "selected" : ""}`}
                          key={m.id}
                          onClick={() => selectMoment(m)}
                        >
                          <span className="moment-number">0{i + 1}</span>
                          <span className="moment-thumbnail">
                            {isDemo ? (
                              <img src="/demo/shot-poster.jpg" alt="" />
                            ) : (
                              <Film size={22} />
                            )}
                          </span>
                          <span className="moment-row-copy">
                            <strong>{m.shortTitle}</strong>
                            <small>
                              {m.context.split(" · ")[0]} <span>·</span>{" "}
                              {m.concept === "projectile"
                                ? "Projectile motion"
                                : m.concept === "force"
                                  ? "Net force"
                                  : m.concept === "torque"
                                    ? "Torque"
                                    : "Equilibrium"}
                            </small>
                          </span>
                          <span className="moment-timestamp">
                            {formatTime(m.time)}
                          </span>
                          {records.some((r) => r.id === m.id) ? (
                            <Check size={16} />
                          ) : (
                            <ArrowUpRight size={17} />
                          )}
                        </button>
                      ))}
                      {!moments.length && (
                        <div className="empty-moments">
                          <Film size={22} />
                          <p>
                            {stage === "done"
                              ? "No supported opportunities found. Try a clearer scene with a door, lever, or visible change in motion."
                              : "Your recording is ready. Analyze sampled frames to discover course connections."}
                          </p>
                          <button
                            className="text-button"
                            onClick={() => setModal("upload")}
                          >
                            Review analysis options <ArrowRight size={14} />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </section>
                <aside className="day-rail">
                  {moment ? (
                    <>
                      <div
                        className={`moment-invitation ${invitation ? "just-noticed" : ""}`}
                      >
                        <div className="invitation-eyebrow">
                          <LensMark small />
                          <span>
                            {invitation ? "Ready to explore" : "Projectile motion"}
                          </span>
                        </div>
                        <h2>
                          {moment.concept === "projectile"
                            ? "At the highest point, does gravity take a break?"
                            : moment.concept === "torque"
                              ? "Why is the handle so far from the hinge?"
                              : moment.concept === "force"
                                ? "Moving right. But which way is the force?"
                                : "Could a smaller force do just as much?"}
                        </h2>
                        <p>{moment.subtitle}</p>
                        <div className="invitation-sketch" aria-hidden="true">
                          {moment.concept === "projectile" ? (
                            <BasketballArt />
                          ) : moment.concept === "torque" ? (
                            <svg viewBox="0 0 250 126">
                              <path
                                d="M38 18L194 34V105L38 88Z"
                                fill="#5a765233"
                                stroke="#b6c799"
                                strokeWidth="1.4"
                              />
                              <path
                                d="M38 18V88"
                                stroke="#d9e4bc"
                                strokeWidth="4"
                              />
                              <circle cx="38" cy="89" r="5" fill="#e2e9b9" />
                              <path
                                d="M173 48V82"
                                stroke="#dfdfb0"
                                strokeWidth="3"
                              />
                              <path
                                d="M139 63H207M200 57L207 63L200 69"
                                stroke="#dae3ad"
                                fill="none"
                              />
                              <path
                                d="M47 100Q97 122 145 108"
                                fill="none"
                                stroke="#a6bd87"
                                strokeDasharray="3 4"
                              />
                              <text x="37" y="120" fill="#bfcda9" fontSize="10">
                                pivot
                              </text>
                            </svg>
                          ) : (
                            <svg viewBox="0 0 250 126">
                              <line
                                x1="25"
                                y1="95"
                                x2="224"
                                y2="95"
                                stroke="#75915f"
                              />
                              <rect
                                x="86"
                                y="39"
                                width="72"
                                height="37"
                                rx="6"
                                fill="#6c875d"
                              />
                              <circle cx="101" cy="83" r="9" fill="#c8d6a8" />
                              <circle cx="145" cy="83" r="9" fill="#c8d6a8" />
                              <path
                                d="M117 23H185M179 17L186 23L179 29"
                                stroke="#d8dfaa"
                                fill="none"
                              />
                              <path
                                d="M100 58H44M51 51L44 58L51 65"
                                stroke="#d8dfaa"
                                fill="none"
                              />
                            </svg>
                          )}
                        </div>
                        <button
                          className="button pale"
                          onClick={() => investigate(moment)}
                        >
                          Explore this event <ArrowRight size={17} />
                        </button>
                        <button
                          className="save-later"
                          onClick={() => {
                            setDeferred((prev) =>
                              prev.includes(moment.id)
                                ? prev
                                : [...prev, moment.id],
                            );
                            setInvitation(null);
                            setToast("Saved for later.");
                          }}
                        >
                          <Clock3 size={13} /> Save for later
                        </button>
                      </div>
                      <div className="course-connection">
                        <span className="eyebrow">Course connection</span>
                        <div>
                          <BookOpen size={21} />
                          <h3>
                            {moment.concept === "projectile"
                              ? "Gravity throughout free flight"
                              : moment.concept === "force"
                                ? "Newton’s second law"
                                : moment.concept === "torque"
                                  ? "The turning effect of a force"
                                  : "When forces find balance"}
                          </h3>
                        </div>
                        <p>{moment.principle}</p>
                        <button
                          className="text-button"
                          onClick={() => navigate("course")}
                        >
                          Open course <ArrowUpRight size={14} />
                        </button>
                      </div>
                    </>
                  ) : (
                    <div className="moment-invitation">
                      <LensMark small />
                      <h2>No events yet</h2>
                      <p>
                        Add a recording or use the demo clip to get started.
                      </p>
                      <button
                        className="button pale"
                        onClick={() => setModal("upload")}
                      >
                        Find a connection <ArrowRight size={16} />
                      </button>
                    </div>
                  )}
                </aside>
              </div>
            </div>
          )}
          {page === "investigate" && moment && (
            <Investigation
              key={moment.id}
              moment={moment}
              src={src}
              mode={mode}
              onBack={() => navigate("today")}
              onSave={saveRecord}
              onCourse={() => navigate("course")}
              onGuide={() => navigate("guide")}
              alreadySaved={records.some((r) => r.id === moment.id)}
              onUpdate={(updated) =>
                setMoments((prev) =>
                  prev.map((m) => (m.id === updated.id ? updated : m)),
                )
              }
              onNext={() => navigate("review")}
            />
          )}
          {page === "course" && (
            <div className="course-page page-enter">
              <div className="eyebrow">Week 04</div>
              <h1>Projectile motion</h1>
              <p className="page-intro">
                Map your material, check your starting point, then practice with
                the basketball demo.
              </p>
              <div className="course-banner">
                <div className="course-book">
                  <BookOpen size={42} strokeWidth={1} />
                </div>
                <div>
                  <Pill>Sample course</Pill>
                  <h2>{COURSE.title}</h2>
                  <p>
                    {COURSE.id} · {COURSE.instructor}
                  </p>
                </div>
                <span className="course-week">04</span>
              </div>
              <CourseDiagnostic
                bedrockAvailable={Boolean(status?.configured)}
                onOpenSettings={() => setModal("settings")}
                onStartLesson={() => {
                  if (!isDemo) useDemo();
                  setSelected("shot");
                  navigate("investigate");
                }}
              />
            </div>
          )}
          {page === "moments" && (
            <div className="notebook-page page-enter">
              <div className="page-heading">
                <div>
                  <h1>Notebook</h1>
                  <p>Saved reflections from your investigations.</p>
                </div>
                {records.length > 0 && (
                  <button className="button secondary" onClick={exportNotebook}>
                    <ArrowDownToLine size={15} /> Export notebook
                  </button>
                )}
              </div>
              {records.length === 0 ? (
                <div className="notebook-empty">
                  <div className="empty-illustration">
                    <BookOpen size={66} strokeWidth={0.9} />
                    <span>✳</span>
                  </div>
                  <h2>Nothing saved yet</h2>
                  <p>
                    Complete an investigation and your explanation will appear
                    here.
                  </p>
                  <button
                    className="button primary"
                    onClick={() => {
                      if (!moment) {
                        useDemo();
                        navigate("today");
                      } else investigate(moment);
                    }}
                  >
                    Explore a moment <ArrowRight size={16} />
                  </button>
                </div>
              ) : (
                <>
                  <div className="notebook-meta">
                    <span>
                      {records.length}{" "}
                      {records.length === 1 ? "connection" : "connections"}{" "}
                      collected
                    </span>
                    <span>Stored on this device</span>
                  </div>
                  {records.map((r, i) => (
                    <article className="notebook-entry" key={r.id}>
                      <span className="entry-number">
                        0{records.length - i}
                      </span>
                      <div>
                        <div className="eyebrow">
                          {r.concept} ·{" "}
                          {new Date(r.completedAt).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </div>
                        <h2>{r.title}</h2>
                        <blockquote>“{r.reflection}”</blockquote>
                        <div className="entry-details">
                          <span>
                            <Check size={13} /> Practice answer: {r.answer}
                            {r.concept !== "force" && r.concept !== "projectile"
                              ? " N"
                              : ""}
                          </span>
                          <span>
                            {r.hints} {r.hints === 1 ? "hint" : "hints"} used
                          </span>
                          <span>
                            {r.mode === "bedrock"
                              ? "Bedrock tutor"
                              : "Demo tutor"}
                          </span>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => {
                            const m = moments.find((m) => m.id === r.id);
                            if (m) investigate(m);
                            else {
                              useDemo();
                              setSelected(
                                DEMO_MOMENTS.find(
                                  (d) => d.concept === r.concept,
                                )!.id,
                              );
                              navigate("investigate");
                            }
                          }}
                        >
                          Revisit the model <ArrowUpRight size={14} />
                        </button>
                      </div>
                      <button
                        className="icon-button remove-entry"
                        aria-label={`Remove ${r.title} from notebook`}
                        onClick={() => removeRecord(r.id)}
                      >
                        <Trash2 size={17} />
                      </button>
                    </article>
                  ))}
                  <button
                    className="button primary"
                    onClick={() => navigate("review")}
                  >
                    Try it in a different setting <ArrowRight size={16} />
                  </button>
                </>
              )}
            </div>
          )}
          {page === "review" && (
            <Review records={records} onExplore={() => navigate("today")} />
          )}
          {page === "guide" && (
            <Guide
              mode={mode}
              onCourse={() => navigate("course")}
              onStart={() => {
                useDemo();
                setSelected("shot");
                navigate("investigate");
              }}
            />
          )}
        </main>
      </div>
      <input
        ref={fileInput}
        type="file"
        className="sr-only"
        tabIndex={-1}
        accept="video/*,.mp4,.webm,.mov"
        onChange={(e) => {
          openFile(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {modal && (
        <div
          className="modal-scrim"
          onClick={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div
            className={`modal ${modal === "settings" ? "settings-modal" : ""}`}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            ref={modalRef}
            tabIndex={-1}
          >
            <button
              className="modal-close icon-button"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <X size={20} />
            </button>
            {modal === "settings" && (
              <>
                <h2 id="modal-title">Settings</h2>
                <p className="modal-intro">
                  Tutor mode and data handling for this prototype.
                </p>
                <div className="settings-block">
                  <h3>Tutor connection</h3>
                  <div className="mode-options">
                    <button
                      className={mode === "rehearsal" ? "selected" : ""}
                      onClick={() => setMode("rehearsal")}
                    >
                      <span>
                        <FlaskConical size={18} /> Demo tutor
                      </span>
                      <p>
                        Prepared coaching for basketball projectile motion. No
                        AI service required.
                      </p>
                      {mode === "rehearsal" && <Check size={16} />}
                    </button>
                    <button
                      disabled={!status?.configured}
                      className={mode === "bedrock" ? "selected" : ""}
                      onClick={() => setMode("bedrock")}
                    >
                      <span>
                        <Sparkles size={18} /> Amazon Bedrock
                      </span>
                      <p>
                        {status?.configured
                          ? `${status.model} · ${status.region}`
                          : "Not configured yet. Add workshop credentials on the server to enable open-ended tutoring."}
                      </p>
                      {mode === "bedrock" && <Check size={16} />}
                    </button>
                  </div>
                  {connectionError && (
                    <p className="inline-error">{connectionError}</p>
                  )}
                  <button className="text-button" onClick={refreshStatus}>
                    <RotateCcw size={13} /> Check connection again
                  </button>
                  <details className="setup-details">
                    <summary>How to connect Bedrock</summary>
                    <p>
                      Copy <code>.env.example</code> to <code>.env</code> in the
                      project. Add your temporary AWS workshop credentials,
                      including the session token, or set an existing AWS
                      profile. Restart with <code>npm run dev</code>.
                    </p>
                    <p>
                      Credentials stay on the local server. Use a vision-capable
                      Nova model for video analysis. No credentials belong in
                      this browser.
                    </p>
                  </details>
                </div>
                <div className="settings-block">
                  <h3>Your data</h3>
                  <div className="privacy-row">
                    <ShieldCheck size={19} />
                    <p>
                      Video stays local. Choosing AI analysis sends up to 20
                      sampled frames to Bedrock. Tutor messages include the
                      current observation, model values, and recent chat.
                    </p>
                  </div>
                  <div className="privacy-row">
                    <Bookmark size={19} />
                    <p>
                      Your notebook is stored in this browser. The prototype has
                      no account system or cross-device sync.
                    </p>
                  </div>
                  <div className="privacy-row">
                    <BookOpen size={19} />
                    <p>
                      Course PDFs are processed by this local server, then sent
                      to Bedrock as a document or in-memory rendered pages and
                      discarded after analysis. The resulting course map and
                      diagnostic are stored in this browser; the PDF is not.
                    </p>
                  </div>
                </div>
              </>
            )}
            {modal === "upload" && (
              <>
                <h2 id="modal-title">Add a recording</h2>
                <p className="modal-intro">
                  Side-view basketball shots work best. MP4 or WebM, up to 500
                  MB.
                </p>
                <button
                  className="upload-zone"
                  onClick={() => fileInput.current?.click()}
                >
                  <Upload size={29} strokeWidth={1.4} />
                  <strong>{isDemo ? "Choose a video" : fileName}</strong>
                  <span>MP4 or WebM · up to 500 MB · max 30 minutes</span>
                  <span className="text-button">
                    {isDemo ? "Browse files" : "Choose a different file"}{" "}
                    <ArrowUpRight size={14} />
                  </span>
                </button>
                {!isDemo && (
                  <div className="analysis-section">
                    <button
                      className="button primary full-width"
                      onClick={() => {
                        setMoments([
                          {
                            ...DEMO_MOMENTS[0],
                            id: "local-shot",
                            time: 0,
                            end: 3,
                            trace: [],
                            anchors: [],
                            context: "Your clip · Guided lesson",
                            observation:
                              "Use this recording as the context for a projectile-motion question. The model uses hypothetical values, not measurements of this clip.",
                            evidence: [
                              {
                                label: "Source",
                                value: "Your local video",
                                kind: "observed",
                              },
                              {
                                label: "Model",
                                value: "Ideal free flight",
                                kind: "assumed",
                              },
                              {
                                label: "Values",
                                value: "Hypothetical launch conditions",
                                kind: "practice",
                              },
                            ],
                          },
                        ]);
                        setSelected("local-shot");
                        setModal(null);
                      }}
                    >
                      Use this clip for the guided lesson{" "}
                      <ArrowRight size={15} />
                    </button>
                    <div className="privacy-row">
                      <ShieldCheck size={19} />
                      <p>
                        The full video stays on your device. Analysis sends up
                        to 20 small frames to Amazon Bedrock. Only analyze
                        recordings you are comfortable sharing with that
                        service.
                      </p>
                    </div>
                    {!status?.configured ? (
                      <div className="analysis-notice">
                        <strong>Bedrock is not connected yet.</strong>
                        <p>
                          Your video can play locally. Connect the server in
                          settings to find physics opportunities in it.
                        </p>
                        <button
                          className="text-button"
                          onClick={() => setModal("settings")}
                        >
                          Open connection settings <ArrowRight size={14} />
                        </button>
                      </div>
                    ) : stage === "sampling" || stage === "analyzing" ? (
                      <div className="analysis-progress" role="status">
                        <LoaderCircle size={19} className="spin" />
                        <div>
                          <strong>
                            {stage === "sampling"
                              ? `Sampling your video · ${Math.round(progress * 100)}%`
                              : "Finding connections to your course…"}
                          </strong>
                          <small>
                            {stage === "sampling"
                              ? "Selecting coverage and scene-change frames locally"
                              : `${sampleCount} frames sent · no audio or full video`}
                          </small>
                          <progress
                            max="1"
                            value={stage === "sampling" ? progress : undefined}
                          />
                        </div>
                        <button
                          className="text-button"
                          onClick={() => {
                            analysis.current?.abort();
                            setStage("idle");
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : stage === "done" ? (
                      <div className="analysis-complete">
                        <Check size={19} />
                        <div>
                          <strong>
                            {moments.length} physics opportunities to review
                          </strong>
                          <p>
                            Annotations are suggestions. Check them against the
                            recording before building a model.
                          </p>
                        </div>
                        <button
                          className="button primary"
                          onClick={() => setModal(null)}
                        >
                          View recording <ArrowRight size={14} />
                        </button>
                      </div>
                    ) : (
                      <button
                        className="button primary full-width"
                        onClick={runAnalysis}
                      >
                        <Sparkles size={16} /> Analyze sampled frames with
                        Bedrock
                      </button>
                    )}
                  </div>
                )}
                {uploadError && (
                  <p className="inline-error" role="alert">
                    {uploadError}
                  </p>
                )}
                <div className="upload-or">
                  <span />
                  or use your provided basketball clip
                  <span />
                </div>
                <button
                  className="demo-file"
                  onClick={() => {
                    useDemo();
                    setModal(null);
                    navigate("today");
                  }}
                >
                  <img
                    src="/demo/shot-poster.jpg"
                    alt="Basketball shot from your recording"
                  />
                  <div>
                    <strong>A shot on the court</strong>
                    <span>49 sec · basketball · guided investigation</span>
                  </div>
                  <ArrowRight size={19} />
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Review({
  records,
  onExplore,
}: {
  records: LearningRecord[];
  onExplore: () => void;
}) {
  const questions = [
    {
      id: "apex",
      concept: "Gravity",
      title: "A volleyball reaches its peak.",
      context:
        "A volleyball has left the player’s hand and reached the highest point of its flight. Ignore air resistance.",
      question: "What is its acceleration at this instant?",
      options: ["Zero", "9.81 m/s² down", "9.81 m/s² up"],
      answer: "9.81 m/s² down",
      explanation:
        "Gravity acts throughout free flight. Vertical velocity is zero at the peak, but the acceleration is still 9.81 m/s² downward.",
    },
    {
      id: "horizontal",
      concept: "Components",
      title: "The ball keeps travelling.",
      context:
        "A basketball travels through the air after release. Gravity is the only force in our ideal model.",
      question: "What happens to its horizontal velocity?",
      options: ["It increases", "It stays constant", "It becomes zero"],
      answer: "It stays constant",
      explanation:
        "With zero horizontal net force, horizontal acceleration is zero. Gravity changes the vertical component, while horizontal velocity stays constant.",
    },
    {
      id: "mass",
      concept: "Transfer",
      title: "A heavier ball. A different path?",
      context:
        "Two balls have different masses but the same launch speed, angle, and height. Ignore air resistance.",
      question: "Which ball lands first?",
      options: ["The heavier ball", "The lighter ball", "They land together"],
      answer: "They land together",
      explanation:
        "Both have the same gravitational acceleration and identical launch conditions. Their ideal trajectories and flight times are the same, regardless of mass.",
    },
  ];
  const [index, setIndex] = useState(0),
    [choice, setChoice] = useState(""),
    [checked, setChecked] = useState(false),
    [results, setResults] = useState<Record<string, boolean>>({});
  const q = questions[index],
    correct = choice === q.answer;
  return (
    <div className="review-page page-enter">
      <h1>Practice</h1>
      <p className="page-intro">
        Apply projectile motion to new scenarios.
      </p>
      <div className="review-layout">
        <section className="review-card">
          <div className="review-progress">
            <span>{q.concept}</span>
            <span>{index + 1} / 3</span>
          </div>
          <div className="wrench-art" aria-hidden="true">
            <BasketballArt />
          </div>
          <h2>{q.title}</h2>
          <p>{q.context}</p>
          <h3>{q.question}</h3>
          <div className="review-options">
            {q.options.map((option) => (
              <button
                key={option}
                disabled={checked}
                className={`${choice === option ? "selected" : ""} ${checked && option === q.answer ? "correct" : ""}`}
                aria-pressed={choice === option}
                onClick={() => setChoice(option)}
              >
                <span>{option}</span>
                {checked && option === q.answer && <Check size={17} />}
              </button>
            ))}
          </div>
          {checked ? (
            <>
              <div
                className={`answer-feedback ${correct ? "correct" : "try-again"}`}
                role="status"
              >
                <div>
                  <strong>{correct ? "Correct" : "Not quite"}</strong>
                  <p>{q.explanation}</p>
                </div>
              </div>
              <button
                className="button primary"
                onClick={() => {
                  setIndex((index + 1) % 3);
                  setChoice("");
                  setChecked(false);
                }}
              >
                Try another connection <ArrowRight size={15} />
              </button>
            </>
          ) : (
            <button
              className="button primary"
              disabled={!choice}
              onClick={() => {
                setChecked(true);
                setResults((prev) => ({ ...prev, [q.id]: correct }));
              }}
            >
              Check my answer <ArrowRight size={15} />
            </button>
          )}
        </section>
        <aside className="review-aside">
          <h2>Transfer check</h2>
          <p>
            Same physics, different context — can you recognize the pattern?
          </p>
          <div className="review-stats">
            <span>
              {Object.keys(results).length}
              <small>attempted this session</small>
            </span>
            <span>
              {Object.values(results).filter(Boolean).length}
              <small>correct on latest attempt</small>
            </span>
          </div>
          {records.find((r) => r.concept === "projectile") ? (
            <div className="past-reflection">
              <Bookmark size={17} />
              <span className="eyebrow">Your reflection</span>
              <details>
                <summary>Look back after you try</summary>
                <p>
                  “{records.find((r) => r.concept === "projectile")?.reflection}
                  ”
                </p>
              </details>
            </div>
          ) : (
            <button className="text-button" onClick={onExplore}>
              Explore the original moment <ArrowUpRight size={15} />
            </button>
          )}
        </aside>
      </div>
    </div>
  );
}
