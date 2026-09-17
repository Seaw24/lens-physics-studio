import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  BrainCircuit,
  Cable,
  LoaderCircle,
  Monitor,
  QrCode,
  Radar,
  ShieldCheck,
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
      ["image", "video", "phone", "wired", "screen"].includes(value.kind) &&
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

export default function DiscoveryWorkspace() {
  const [ready, setReady] = useState(false);
  const [config, setConfig] = useState<DiscoveryClientConfig | null>(null);
  const [initialSession, setInitialSession] = useState<SessionSnapshot | null>(
    null,
  );
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

  useEffect(() => {
    const controller = new AbortController();
    discoveryApi
      .config(controller.signal)
      .then((next) => {
        setConfig(next);
        setReady(true);
        setError("");
      })
      .catch((caught: any) => {
        if (caught instanceof DOMException && caught.name === "AbortError")
          return;
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
    if (!ready || !saved) return;
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
  }, [ready]);

  /** One step from source to running analysis: create, upload, start. */
  async function run(kind: LaunchSource["kind"], file: File | null) {
    if (launch) return;
    const live =
      kind === "phone" || kind === "wired" || kind === "screen";
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
        kind === "wired" || kind === "screen" ? "phone" : kind,
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

  const active = Boolean(launch);
  const done = isTerminal(session?.state);

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
                <strong>{config ? "Scout agent" : "Connecting"}</strong>
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
                <strong>{config ? "Reviewer agent" : "Connecting"}</strong>
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
                <h2>Add a video</h2>
              </div>
              <span>Starts as soon as you add it</span>
            </div>
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
                if (dropped) void run("video", dropped);
              }}
            >
              <span className="discovery-file-icon">
                <UploadCloud size={24} />
              </span>
              <strong>
                {dragging
                  ? "Release to start"
                  : "Drop a video here, or click to choose"}
              </strong>
              <span>
                MP4, MOV, WebM · up to 30 minutes · analysis starts right away
              </span>
            </button>
            <input
              ref={fileInput}
              hidden
              type="file"
              accept="video/*"
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                if (chosen) void run("video", chosen);
              }}
            />
            <div className="discovery-live-sources" aria-label="Live capture">
              <div className="discovery-live-divider">
                <span>Or capture live</span>
              </div>
              <div className="discovery-live-buttons">
                <button
                  type="button"
                  className="discovery-live-button"
                  disabled={busy || !config}
                  onClick={() => void run("wired", null)}
                >
                  <span className="discovery-file-icon">
                    <Cable size={22} />
                  </span>
                  <strong>iPhone USB</strong>
                  <span>Continuity Camera on this Mac — live video here</span>
                </button>
                <button
                  type="button"
                  className="discovery-live-button"
                  disabled={busy || !config}
                  onClick={() => void run("phone", null)}
                >
                  <span className="discovery-file-icon">
                    <QrCode size={22} />
                  </span>
                  <strong>Phone Wi‑Fi</strong>
                  <span>Scan a QR code and stream from your iPhone camera</span>
                </button>
                <button
                  type="button"
                  className="discovery-live-button"
                  disabled={busy || !config}
                  onClick={() => void run("screen", null)}
                >
                  <span className="discovery-file-icon">
                    <Monitor size={22} />
                  </span>
                  <strong>Witness this screen</strong>
                  <span>Share a screen or window and analyze what happens on it</span>
                </button>
              </div>
            </div>
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
