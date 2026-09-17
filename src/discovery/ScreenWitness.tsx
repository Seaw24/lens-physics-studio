import { useEffect, useRef, useState } from "react";
import { CircleStop, Monitor } from "lucide-react";
import { LIVE_SESSION_MAX_MS, type SessionSnapshot } from "../../shared/discovery";
import { discoveryApi } from "./api";
import { captureJpeg, sha256Hex } from "./capture";
import { CaptureQueue } from "./captureQueue";

type Frame = {
  frameId: string;
  seq: number;
  sourceTimeMs: number;
  sha256: string;
  partName: string;
  blob: Blob;
};

/** Capture this Mac's screen (or a window/tab) and upload frames for live analysis. */
export default function ScreenWitness({
  session,
  onSession,
}: {
  session: SessionSnapshot;
  onSession: (session: SessionSnapshot) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState(
    "Choose a screen, window, or browser tab to witness. Analysis starts once sharing begins.",
  );
  const [error, setError] = useState("");
  const [drops, setDrops] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const currentSession = useRef(session);
  currentSession.current = session;
  const lifetime = useRef(0);
  const stream = useRef<MediaStream | null>(null);
  const queue = useRef<CaptureQueue<Frame[]> | null>(null);
  const abort = useRef<AbortController | null>(null);
  const callback = useRef<number | null>(null);
  const callbackType = useRef<"video" | "animation">("animation");
  const timer = useRef(0);
  const sessionTimer = useRef(0);
  const encode = useRef<Promise<void> | null>(null);
  const batch = useRef<Frame[]>([]);
  const sequence = useRef(0);
  const sourceOrigin = useRef<number | null>(null);
  const lastSample = useRef(-Infinity);
  const unreportedDrops = useRef(0);

  function stopFrames() {
    window.clearInterval(timer.current);
    window.clearTimeout(sessionTimer.current);
    if (callback.current !== null) {
      if (callbackType.current === "video")
        video.current?.cancelVideoFrameCallback(callback.current);
      else cancelAnimationFrame(callback.current);
    }
    callback.current = null;
    stream.current?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    stream.current = null;
  }

  function dispose() {
    lifetime.current++;
    stopFrames();
    abort.current?.abort();
    queue.current?.close();
    batch.current = [];
  }

  useEffect(() => () => dispose(), []);

  useEffect(() => {
    if (!["created", "ingesting", "paused"].includes(session.state)) {
      dispose();
      setRunning(false);
    }
  }, [session.state, session.generation]);

  function flush() {
    if (currentSession.current.state !== "ingesting") {
      batch.current = [];
      return;
    }
    if (batch.current.length) queue.current?.enqueue(batch.current.splice(0, 8));
  }

  function schedule() {
    if (!stream.current || !video.current) return;
    if (typeof video.current.requestVideoFrameCallback === "function") {
      callbackType.current = "video";
      callback.current = video.current.requestVideoFrameCallback(() => {
        tick();
        schedule();
      });
    } else {
      callbackType.current = "animation";
      callback.current = requestAnimationFrame(() => {
        tick();
        schedule();
      });
    }
  }

  function tick() {
    const now = performance.now();
    if (
      currentSession.current.state !== "ingesting" ||
      encode.current ||
      now - lastSample.current < 125 ||
      !video.current?.videoWidth
    )
      return;
    lastSample.current = now;
    sourceOrigin.current ??= now;
    const sourceTimeMs = Math.round(now - sourceOrigin.current);
    if (sourceTimeMs >= LIVE_SESSION_MAX_MS) {
      void finish();
      return;
    }
    const generation = lifetime.current;
    const seq = sequence.current++;
    encode.current = (async () => {
      const blob = await captureJpeg(video.current!, canvas.current!);
      if (blob.size > 250 * 1024)
        throw new Error(
          "A captured frame is too large. Share a smaller window or lower display resolution.",
        );
      const sha256 = await sha256Hex(blob);
      if (
        generation !== lifetime.current ||
        currentSession.current.state !== "ingesting"
      )
        return;
      batch.current.push({
        frameId: `screen_${seq}_${crypto.randomUUID().slice(0, 8)}`,
        seq,
        sourceTimeMs,
        sha256,
        partName: `frame_${seq}`,
        blob,
      });
      if (batch.current.length >= 8) flush();
    })()
      .catch((caught) => {
        if (generation === lifetime.current) {
          setError(String(caught instanceof Error ? caught.message : caught));
          dispose();
          setRunning(false);
        }
      })
      .finally(() => {
        encode.current = null;
      });
  }

  async function startShare() {
    if (stream.current || busy || session.state !== "ingesting") return;
    setBusy(true);
    setError("");
    const generation = lifetime.current;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia)
        throw new Error(
          "Open this page on localhost or trusted HTTPS to share your screen.",
        );
      const media = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: 30 } },
        audio: false,
      });
      if (
        generation !== lifetime.current ||
        currentSession.current.state !== "ingesting"
      ) {
        media.getTracks().forEach((t) => t.stop());
        return;
      }
      stream.current = media;
      video.current!.srcObject = media;
      await video.current!.play();
      if (generation !== lifetime.current) return;
      if (currentSession.current.state !== "ingesting") {
        stopFrames();
        return;
      }
      abort.current = new AbortController();
      const signal = abort.current.signal;
      queue.current = new CaptureQueue(
        async (frames) => {
          if (currentSession.current.state !== "ingesting") {
            unreportedDrops.current++;
            setDrops((n) => n + 1);
            return;
          }
          const count = unreportedDrops.current;
          const form = new FormData();
          form.append(
            "metadata",
            JSON.stringify({
              sessionId: session.id,
              generation: session.generation,
              batchId: `screen_batch_${crypto.randomUUID().replaceAll("-", "_")}`,
              timingMethod: "performanceNow",
              droppedBatches: count,
              frames: frames.map(({ blob: _blob, ...frame }) => frame),
            }),
          );
          frames.forEach((frame) =>
            form.append(frame.partName, frame.blob, `${frame.partName}.jpg`),
          );
          const response = await fetch(
            `/api/discovery/sessions/${session.id}/desktop-frames`,
            {
              method: "POST",
              credentials: "same-origin",
              body: form,
              signal,
            },
          );
          const result = await response.json();
          if (!response.ok) {
            if (
              response.status === 409 &&
              ["paused"].includes(currentSession.current.state)
            )
              return;
            throw new Error(result.error?.message || "Screen upload failed.");
          }
          unreportedDrops.current = Math.max(
            0,
            unreportedDrops.current - count,
          );
          if (generation === lifetime.current)
            setStatus(
              `Witnessing screen · frame ${result.ackSequence} received · ${result.captureGaps} gaps`,
            );
        },
        () => {
          unreportedDrops.current++;
          setDrops((n) => n + 1);
        },
        (caught) => {
          if (generation !== lifetime.current) return;
          setError(
            caught instanceof Error ? caught.message : "Screen upload failed.",
          );
          dispose();
          setRunning(false);
        },
      );
      media.getVideoTracks().forEach((track) => {
        track.onended = () => {
          setStatus("Screen sharing stopped.");
          void finish();
        };
      });
      setRunning(true);
      setStatus("Capturing your shared screen. Keep this analysis running.");
      schedule();
      timer.current = window.setInterval(flush, 500);
      sessionTimer.current = window.setTimeout(
        () => void finish(),
        LIVE_SESSION_MAX_MS,
      );
    } catch (caught) {
      if (generation === lifetime.current) {
        dispose();
        setRunning(false);
        setError(
          caught instanceof Error ? caught.message : "Screen share unavailable.",
        );
      }
    } finally {
      setBusy(false);
    }
  }

  async function finish() {
    if (busy) return;
    setBusy(true);
    stopFrames();
    setRunning(false);
    try {
      await encode.current;
      flush();
      await queue.current?.drain();
      queue.current?.close();
      const latest = currentSession.current;
      if (["ingesting", "paused"].includes(latest.state))
        onSession(
          await discoveryApi.action(latest.id, latest.generation, "stop"),
        );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not stop capture.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wired-camera screen-witness">
      <div>
        <Monitor size={20} />
        <strong>Witness this screen</strong>
      </div>
      <p>
        Share a screen, window, or tab that shows the motion. Frames are sampled
        here and reviewed the same way as a phone camera feed.
      </p>
      <div className="discovery-controls">
        <button
          className="button primary"
          disabled={busy || running || session.state !== "ingesting"}
          onClick={startShare}
        >
          <Monitor size={16} /> Share screen
        </button>
        {running && (
          <button
            className="button secondary"
            disabled={busy}
            onClick={finish}
          >
            <CircleStop size={16} /> Finish capture
          </button>
        )}
      </div>
      <video
        ref={video}
        muted
        playsInline
        autoPlay
        className="wired-preview"
        aria-label="Shared screen preview"
      />
      <canvas ref={canvas} hidden />
      <p role="status">
        {status}
        {session.state === "created"
          ? " Press Start above to enable capture."
          : session.state === "paused"
            ? " Session paused."
            : ""}{" "}
        · {drops} dropped batches
      </p>
      {error && (
        <p role="alert" className="discovery-error">
          {error}
        </p>
      )}
    </div>
  );
}
