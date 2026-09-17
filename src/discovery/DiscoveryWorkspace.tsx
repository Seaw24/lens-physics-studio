import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  Cable,
  Camera,
  FileImage,
  Film,
  LoaderCircle,
  LockKeyhole,
  LogIn,
  Radar,
  ShieldCheck,
  Smartphone,
  Sparkles,
  UploadCloud,
} from "lucide-react";
import type { SessionSnapshot } from "../../shared/discovery";
import { discoveryApi, type DiscoveryClientConfig } from "./api";
import DiscoveryEventCard from "./DiscoveryEventCard";
import LiveAnalysis, { isTerminal, type LaunchSource } from "./LiveAnalysis";
import { useDiscoverySession } from "./useSession";
import "./discovery.css";

function idempotencyKey() {
  return `ui_${crypto.randomUUID().replaceAll("-", "_")}`;
}

/** The run on screen, so a page refresh can reattach to it on the server. */
const ACTIVE_KEY = "momentum-discovery-active";
type ActiveRun = { id: string; kind: LaunchSource["kind"]; startedAt: number };

function readActiveRun(): ActiveRun | null {
  try {
    const value = JSON.parse(localStorage.getItem(ACTIVE_KEY) || "null");
    return typeof value?.id === "string" &&
      ["image", "video", "phone", "wired"].includes(value.kind) &&
      typeof value.startedAt === "number"
      ? value
      : null;
  } catch {
    return null;
  }
}

function writeActiveRun(run: ActiveRun | null) {
  try {
    if (run) localStorage.setItem(ACTIVE_KEY, JSON.stringify(run));
    else localStorage.removeItem(ACTIVE_KEY);
  } catch {
    // Reattaching after a refresh is optional.
  }
}

function shortModelName(modelId?: string) {
  if (!modelId) return "Connecting";
  if (modelId.includes("nova")) return "Amazon Nova";
  if (modelId.includes("opus")) return "Claude Opus";
  if (modelId.includes("sonnet")) return "Claude Sonnet";
  return modelId.split(".").at(-1)?.split("-v1")[0] || modelId;
}

export default function DiscoveryWorkspace() {
  const [authenticated, setAuthenticated] = useState<boolean | null>(null);
  const [accessCode, setAccessCode] = useState("");
  const [config, setConfig] = useState<DiscoveryClientConfig | null>(null);
  const [initialSession, setInitialSession] = useState<SessionSnapshot | null>(
    null,
  );
  const [sourceKind, setSourceKind] = useState<
    "image" | "video" | "phone" | "wired"
  >("video");
  const [mode, setMode] = useState<"scan" | "replay">("scan");
  const [launch, setLaunch] = useState<LaunchSource | null>(null);
  const [dragging, setDragging] = useState(false);
  const [pairing, setPairing] = useState<{
    url: string;
    qrDataUrl: string;
    expiresAt: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const { session, setSession } = useDiscoverySession(initialSession, setError);

  const acceptedEvents = useMemo(
    () =>
      [...(session?.events ?? [])].sort(
        (a, b) =>
          (a.media.sourceInterval?.startSeconds ?? 0) -
          (b.media.sourceInterval?.startSeconds ?? 0),
      ),
    [session?.events],
  );

  async function loadConfig() {
    try {
      const next = await discoveryApi.config();
      setConfig(next);
      setAuthenticated(true);
      setError("");
    } catch (caught: any) {
      if (caught?.status === 401) setAuthenticated(false);
      else
        setError(
          caught instanceof Error
            ? caught.message
            : "Discovery is unavailable.",
        );
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    discoveryApi
      .config(controller.signal)
      .then((next) => {
        setConfig(next);
        setAuthenticated(true);
      })
      .catch((caught: any) => {
        if (caught?.status === 401) setAuthenticated(false);
        else if (!(
          caught instanceof DOMException && caught.name === "AbortError"
        ))
          setError(
            caught instanceof Error
              ? caught.message
              : "Discovery is unavailable.",
          );
      });
    return () => controller.abort();
  }, []);

  // After a refresh, pick the last run back up from the server.
  useEffect(() => {
    const saved = readActiveRun();
    if (!authenticated || !saved) return;
    let cancelled = false;
    discoveryApi
      .session(saved.id)
      .then(async (snapshot) => {
        if (cancelled || "unchanged" in snapshot) return;
        // The upload or start never finished, so there is nothing to resume.
        if (snapshot.state === "created") {
          writeActiveRun(null);
          await discoveryApi
            .action(snapshot.id, snapshot.generation, "cancel")
            .catch(() => undefined);
          return;
        }
        setInitialSession(snapshot);
        setSession(snapshot);
        setSourceKind(saved.kind);
        setLaunch({
          kind: saved.kind,
          file: null,
          startedAt: saved.startedAt,
          uploadProgress: null,
        });
        // The QR code lived only in memory; issue a fresh one if the phone is not connected.
        if (
          saved.kind === "phone" &&
          ["ingesting", "paused"].includes(snapshot.state) &&
          snapshot.connection !== "connected"
        ) {
          const next = await discoveryApi
            .pair(snapshot.id, snapshot.generation)
            .catch(() => null);
          if (!cancelled) setPairing(next);
        }
      })
      .catch((caught: any) => {
        if (caught?.status === 404) writeActiveRun(null);
      });
    return () => {
      cancelled = true;
    };
  }, [authenticated]);

  async function login(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      await discoveryApi.login(accessCode);
      await loadConfig();
      setAccessCode("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Login failed.");
    } finally {
      setBusy(false);
    }
  }

  /** One step from source to running analysis: create, upload, start. */
  async function run(kind: LaunchSource["kind"], file: File | null) {
    if (launch) return;
    const live = kind === "phone" || kind === "wired";
    if (!live && !file) return;
    if (file?.type && kind === "video" && !file.type.startsWith("video/")) {
      setError("That file is not a video. Choose an MP4, MOV, or WebM.");
      return;
    }
    if (file?.type && kind === "image" && !file.type.startsWith("image/")) {
      setError("That file is not a photo. Choose a JPEG, PNG, or HEIC.");
      return;
    }
    setBusy(true);
    setError("");
    setPairing(null);
    const startedAt = Date.now();
    setLaunch({
      kind,
      file,
      startedAt,
      uploadProgress: live ? null : 0,
    });
    let created: SessionSnapshot | null = null;
    try {
      created = await discoveryApi.createSession(
        kind === "wired" ? "phone" : kind,
        live ? "live" : kind === "image" ? "scan" : mode,
        idempotencyKey(),
      );
      writeActiveRun({ id: created.id, kind, startedAt });
      setInitialSession(created);
      setSession(created);
      let next = created;
      if (!live) {
        next = await discoveryApi.uploadSource(created.id, file!, (fraction) =>
          setLaunch((current) =>
            current ? { ...current, uploadProgress: fraction } : current,
          ),
        );
        setLaunch((current) =>
          current ? { ...current, uploadProgress: null } : current,
        );
        setSession(next);
      }
      next = await discoveryApi.action(next.id, next.generation, "start");
      setSession(next);
      if (kind === "phone")
        setPairing(await discoveryApi.pair(next.id, next.generation));
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The analysis could not start.",
      );
      // A session that never started would otherwise sit in "created".
      if (created)
        void discoveryApi
          .action(created.id, created.generation, "cancel")
          .catch(() => undefined);
      reset();
    } finally {
      setBusy(false);
    }
  }

  async function action(value: "pause" | "resume" | "stop" | "cancel") {
    if (!session) return;
    setBusy(true);
    setError("");
    try {
      setSession(
        await discoveryApi.action(session.id, session.generation, value),
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Control request failed.",
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    writeActiveRun(null);
    setLaunch(null);
    setPairing(null);
    setInitialSession(null);
    setSession(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  if (authenticated === false)
    return (
      <section className="discovery-page page-enter">
        <div className="discovery-auth-card">
          <span className="discovery-auth-icon">
            <LockKeyhole size={24} />
          </span>
          <span className="eyebrow">PRIVATE ANALYSIS STUDIO</span>
          <h1>Unlock Discovery.</h1>
          <p>
            Enter the access code shown by the local server. Your credentials
            and source media remain server-side.
          </p>
          <form onSubmit={login}>
            <label>
              Access code
              <input
                type="password"
                autoComplete="current-password"
                value={accessCode}
                onChange={(event) => setAccessCode(event.target.value)}
              />
            </label>
            <button className="button primary" disabled={busy || !accessCode}>
              {busy ? (
                <LoaderCircle className="spin" size={16} />
              ) : (
                <LogIn size={16} />
              )}
              Enter studio
            </button>
          </form>
          {error && <p className="discovery-error">{error}</p>}
        </div>
      </section>
    );

  const active = Boolean(launch);
  const done = isTerminal(session?.state);
  const live = sourceKind === "phone" || sourceKind === "wired";

  return (
    <section className="discovery-page page-enter">
      <header className={`discovery-heading ${active ? "is-compact" : ""}`}>
        <div>
          <span className="eyebrow">MOMENTUM DISCOVERY · PRIVATE BETA</span>
          <h1>
            Find the moment.
            {!active && <br />}
            {!active && <em>Keep only what matters.</em>}
          </h1>
          {!active && (
            <p>
              Drop in a recording. A visual scout finds candidate moments, an
              independent reviewer checks the evidence, and only what passes
              shows up below.
            </p>
          )}
        </div>
        {!active && (
          <div className="discovery-privacy">
            <ShieldCheck size={18} />
            <span>
              <strong>Evidence first</strong>
              Media is bounded, reviewed, and never treated as a measurement.
            </span>
          </div>
        )}
      </header>

      {!active && (
        <>
          <section className="model-orchestra" aria-label="Two-model analysis">
            <div className="model-stage">
              <span className="model-stage-number">01</span>
              <span className="model-stage-icon">
                <Radar size={21} />
              </span>
              <div>
                <span className="model-stage-kicker">Visual scout</span>
                <strong>{shortModelName(config?.proposerModelId)}</strong>
                <p>
                  Scans the timeline and nominates moments worth a closer look.
                </p>
              </div>
            </div>
            <div className="model-handoff">
              <span />
              <ArrowRight size={18} />
              <small>Evidence handoff</small>
            </div>
            <div className="model-stage">
              <span className="model-stage-number">02</span>
              <span className="model-stage-icon">
                <BrainCircuit size={21} />
              </span>
              <div>
                <span className="model-stage-kicker">Independent reviewer</span>
                <strong>{shortModelName(config?.reviewerModelId)}</strong>
                <p>
                  Checks visible evidence and approves only teachable moments.
                </p>
              </div>
            </div>
          </section>

          <div className="discovery-source-card">
            <div className="source-card-heading">
              <div>
                <span className="eyebrow">NEW ANALYSIS</span>
                <h2>Choose your source</h2>
              </div>
              <span>Starts as soon as you add it</span>
            </div>
            <div
              className="source-tabs"
              role="tablist"
              aria-label="Discovery source"
            >
              {(
                [
                  ["video", "Video", Film],
                  ["image", "Photo", FileImage],
                  ["wired", "iPhone USB", Cable],
                  ["phone", "Phone Wi-Fi", Smartphone],
                ] as const
              ).map(([kind, label, Icon]) => (
                <button
                  key={kind}
                  role="tab"
                  aria-selected={sourceKind === kind}
                  className={sourceKind === kind ? "active" : ""}
                  onClick={() => {
                    setSourceKind(kind);
                    setError("");
                  }}
                >
                  <Icon size={17} />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            {!live ? (
              <>
                <button
                  className={`discovery-file ${dragging ? "is-dragging" : ""}`}
                  disabled={busy || !config}
                  onClick={() => fileInput.current?.click()}
                  onDragOver={(event) => {
                    event.preventDefault();
                    setDragging(true);
                  }}
                  onDragLeave={() => setDragging(false)}
                  onDrop={(event) => {
                    event.preventDefault();
                    setDragging(false);
                    const dropped = event.dataTransfer.files?.[0];
                    if (dropped) void run(sourceKind, dropped);
                  }}
                >
                  <span className="discovery-file-icon">
                    <UploadCloud size={24} />
                  </span>
                  <strong>
                    {dragging
                      ? "Release to start"
                      : `Drop a ${sourceKind === "image" ? "photo" : "video"} here, or click to choose`}
                  </strong>
                  <span>
                    {sourceKind === "image"
                      ? "JPEG, PNG, HEIC · up to 10 MB · analysis starts right away"
                      : "MP4, MOV, WebM · up to 30 minutes · analysis starts right away"}
                  </span>
                </button>
                <input
                  ref={fileInput}
                  hidden
                  type="file"
                  accept={sourceKind === "image" ? "image/*" : "video/*"}
                  onChange={(event) => {
                    const chosen = event.target.files?.[0];
                    if (chosen) void run(sourceKind, chosen);
                  }}
                />
                {sourceKind === "video" && (
                  <div className="discovery-mode">
                    <span>
                      <strong>Analysis pace</strong>
                      <small>
                        Focused scan is fastest. Replay follows the video clock.
                      </small>
                    </span>
                    <select
                      value={mode}
                      onChange={(event) =>
                        setMode(event.target.value as "scan" | "replay")
                      }
                    >
                      <option value="scan">Focused scan · recommended</option>
                      <option value="replay">Replay at source speed</option>
                    </select>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="phone-note">
                  <span>
                    <Camera size={22} />
                  </span>
                  <div>
                    <strong>
                      {sourceKind === "wired"
                        ? "Use your iPhone as a wired camera"
                        : "Pair a phone camera"}
                    </strong>
                    <p>
                      {sourceKind === "wired"
                        ? "Connect by USB and enable Continuity Camera. After you start, pick your iPhone and the models begin watching."
                        : "You will get a QR code. Keep the phone page open on the same trusted HTTPS connection."}
                    </p>
                  </div>
                </div>
                <button
                  className="button primary discovery-prepare"
                  disabled={busy || !config}
                  onClick={() => void run(sourceKind, null)}
                >
                  <Sparkles size={16} /> Start live analysis
                </button>
              </>
            )}
            {!config && !error && (
              <p className="discovery-connecting">
                <LoaderCircle className="spin" size={14} /> Connecting to
                Discovery…
              </p>
            )}
          </div>
        </>
      )}

      {error && <p className="discovery-error">{error}</p>}
      {session?.errors.map((item, index) => (
        <p className="discovery-error" key={`${item.code}-${index}`}>
          {item.message}
        </p>
      ))}

      {launch && (
        <LiveAnalysis
          session={session}
          launch={launch}
          config={config}
          pairing={pairing}
          busy={busy}
          onAction={(value) => void action(value)}
          onSession={setSession}
          onReset={reset}
        />
      )}

      {session && (acceptedEvents.length > 0 || done) && (
        <section className="discovery-results">
          <div className="section-topline">
            <div>
              <span className="eyebrow">PASSED INDEPENDENT REVIEW</span>
              <h2>Accepted moments</h2>
            </div>
            <span>
              {acceptedEvents.length} ready for learning
              {!done && " · more may arrive"}
            </span>
          </div>
          {acceptedEvents.length ? (
            acceptedEvents.map((event) => (
              <div
                key={event.id}
                id={`moment-${event.id}`}
                className="moment-reveal"
              >
                <DiscoveryEventCard event={event} />
              </div>
            ))
          ) : (
            <div className="discovery-empty">
              <ShieldCheck size={24} />
              <strong>No moment passed review.</strong>
              <p>
                Nothing unsupported is promoted. Try a clearer angle or a longer
                recording.
              </p>
            </div>
          )}
        </section>
      )}
    </section>
  );
}
