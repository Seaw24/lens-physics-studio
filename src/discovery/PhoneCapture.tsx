import { useEffect, useRef, useState } from "react";
import { Camera, CircleStop, LoaderCircle, WifiOff } from "lucide-react";
import { LIVE_SESSION_MAX_MS } from "../../shared/discovery";
import { captureJpeg, sha256Hex } from "./capture";
import "./discovery.css";

interface PairedSession {
  sessionId: string;
  generation: number;
  phoneToken: string;
}

interface QueuedFrame {
  frameId: string;
  seq: number;
  sourceTimeMs: number;
  sha256: string;
  blob: Blob;
  partName: string;
}

/** Survive React StrictMode double-mount so the one-time pair token is only redeemed once. */
const redeemInflight = new Map<string, Promise<PairedSession>>();

function redeemPairToken(token: string) {
  const existing = redeemInflight.get(token);
  if (existing) return existing;
  const request = fetch("/api/discovery/pair/redeem", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  }).then(async (response) => {
    const data = await response.json();
    if (!response.ok)
      throw new Error(data.error?.message || "Pairing failed.");
    if (!data.phoneToken)
      throw new Error("Pairing succeeded but no phone token was returned.");
    return {
      sessionId: data.sessionId as string,
      generation: data.generation as number,
      phoneToken: data.phoneToken as string,
    };
  });
  redeemInflight.set(token, request);
  request.catch(() => redeemInflight.delete(token));
  return request;
}

export default function PhoneCapture() {
  const [paired, setPaired] = useState<PairedSession | null>(null);
  const [status, setStatus] = useState("Redeeming one-time pairing link…");
  const [error, setError] = useState("");
  const [running, setRunning] = useState(false);
  const [acked, setAcked] = useState(-1);
  const [dropped, setDropped] = useState(0);
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const pairedRef = useRef<PairedSession | null>(null);
  const callbackId = useRef<number | null>(null);
  const timer = useRef(0);
  const sessionTimer = useRef(0);
  const encodeBusy = useRef(false);
  const uploadBusy = useRef(false);
  const seq = useRef(0);
  const originMs = useRef<number | null>(null);
  const lastSampleMs = useRef(-Infinity);
  const pending = useRef<QueuedFrame[][]>([]);
  const current = useRef<QueuedFrame[]>([]);
  const droppedUnreported = useRef(0);

  useEffect(() => {
    pairedRef.current = paired;
  }, [paired]);

  useEffect(() => {
    const hash = new URLSearchParams(location.hash.slice(1));
    const token = hash.get("pair");
    if (!token) {
      setError("This pairing link is missing its one-time token.");
      return;
    }
    // Keep the hash until redeem succeeds so a StrictMode remount can reuse it.
    let cancelled = false;
    redeemPairToken(token)
      .then(async (next) => {
        if (cancelled) return;
        history.replaceState(null, "", `${location.pathname}${location.search}`);
        pairedRef.current = next;
        setPaired(next);
        setStatus("Paired. Starting the rear camera…");
        await startCamera(next);
      })
      .catch((caught) => {
        if (!cancelled)
          setError(
            caught instanceof Error ? caught.message : "Pairing failed.",
          );
      });
    return () => {
      cancelled = true;
      stopLocal();
    };
  }, []);

  function phoneHeaders(extra: HeadersInit = {}): HeadersInit {
    const token = pairedRef.current?.phoneToken;
    return {
      ...(token ? { "X-Discovery-Phone-Token": token } : {}),
      ...extra,
    };
  }

  async function postJson(path: string, body: unknown) {
    const response = await fetch(`/api/discovery${path}`, {
      method: "POST",
      credentials: "include",
      headers: phoneHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response.json().catch(() => null);
      throw new Error(data?.error?.message || "Capture request failed.");
    }
    return response.json();
  }

  async function startCamera(session = pairedRef.current) {
    if (!session || stream.current) return;
    setError("");
    try {
      if (!window.isSecureContext)
        throw new Error(
          "This page must be opened over trusted HTTPS for camera access.",
        );
      const media = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: "environment" },
          width: { ideal: 1280 },
          frameRate: { ideal: 30 },
        },
        audio: false,
      });
      stream.current = media;
      if (video.current) {
        video.current.srcObject = media;
        await video.current.play();
      }
      setRunning(true);
      setStatus("Streaming to your laptop. Keep this page open and unlocked.");
      scheduleCapture();
      startUploadTimer();
      sessionTimer.current = window.setTimeout(
        () => void stopCapture(),
        LIVE_SESSION_MAX_MS,
      );
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Camera permission failed.",
      );
      setStatus("Paired, but the camera did not start. Tap Start camera.");
    }
  }

  function scheduleCapture() {
    const element = video.current as
      | (HTMLVideoElement & {
          requestVideoFrameCallback?: (
            callback: (now: number, metadata: { mediaTime: number }) => void,
          ) => number;
        })
      | null;
    if (!element || !stream.current) return;
    if (element.requestVideoFrameCallback) {
      callbackId.current = element.requestVideoFrameCallback(
        (_now, metadata) => {
          void maybeCapture(
            metadata.mediaTime * 1000,
            "requestVideoFrameCallback",
          );
          if (stream.current) scheduleCapture();
        },
      );
    } else {
      const loop = () => {
        void maybeCapture(performance.now(), "performanceNow");
        if (stream.current) callbackId.current = requestAnimationFrame(loop);
      };
      callbackId.current = requestAnimationFrame(loop);
    }
  }

  async function maybeCapture(clockMs: number, timingMethod: string) {
    if (
      !stream.current ||
      document.visibilityState !== "visible" ||
      encodeBusy.current ||
      !video.current?.videoWidth
    )
      return;
    if (clockMs - lastSampleMs.current < 120) return;
    lastSampleMs.current = clockMs;
    originMs.current ??= clockMs;
    encodeBusy.current = true;
    try {
      const blob = await captureJpeg(video.current!, canvas.current!);
      const frameSeq = seq.current++;
      const partName = `frame_${frameSeq}`;
      current.current.push({
        frameId: `phone_${frameSeq}_${crypto.randomUUID().slice(0, 8)}`,
        seq: frameSeq,
        sourceTimeMs: Math.max(0, Math.round(clockMs - originMs.current)),
        sha256: await sha256Hex(blob),
        blob,
        partName,
      });
      if (current.current.length >= 4) await queueCurrent(timingMethod);
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Frame capture failed.",
      );
    } finally {
      encodeBusy.current = false;
    }
  }

  async function queueCurrent(_timingMethod = "requestVideoFrameCallback") {
    if (!current.current.length) return;
    pending.current.push(current.current.splice(0, 8));
    if (pending.current.length > 3) {
      pending.current.shift();
      droppedUnreported.current++;
      setDropped((value) => value + 1);
    }
    await uploadNext();
  }

  async function flushBatch() {
    await queueCurrent(
      "requestVideoFrameCallback" in HTMLVideoElement.prototype
        ? "requestVideoFrameCallback"
        : "performanceNow",
    );
  }

  async function uploadNext() {
    const session = pairedRef.current;
    if (uploadBusy.current || !session || !pending.current.length) return;
    uploadBusy.current = true;
    const batch = pending.current[0];
    const reportedDrops = droppedUnreported.current;
    const form = new FormData();
    const metadata = {
      sessionId: session.sessionId,
      generation: session.generation,
      batchId: `batch_${crypto.randomUUID().replaceAll("-", "_")}`,
      timingMethod:
        "requestVideoFrameCallback" in HTMLVideoElement.prototype
          ? "requestVideoFrameCallback"
          : "performanceNow",
      droppedBatches: reportedDrops,
      frames: batch.map(({ blob: _blob, ...frame }) => frame),
    };
    form.append("metadata", JSON.stringify(metadata));
    for (const frame of batch)
      form.append(frame.partName, frame.blob, `${frame.partName}.jpg`);
    try {
      const response = await fetch(
        `/api/discovery/sessions/${session.sessionId}/frames`,
        {
          method: "POST",
          credentials: "include",
          headers: phoneHeaders(),
          body: form,
        },
      );
      const data = await response.json().catch(() => null);
      if (!response.ok)
        throw new Error(data?.error?.message || "Frame upload failed.");
      pending.current.shift();
      droppedUnreported.current = Math.max(
        0,
        droppedUnreported.current - reportedDrops,
      );
      setAcked(data.ackSequence ?? -1);
      setError("");
      setStatus(
        `Streaming · frame ${data.ackSequence} on laptop · ${data.captureGaps} gaps`,
      );
    } catch (caught) {
      // Keep the batch and retry on the next timer tick.
      setError(
        caught instanceof Error
          ? `Upload paused: ${caught.message}`
          : "Upload paused.",
      );
      await new Promise((resolve) => setTimeout(resolve, 400));
    } finally {
      uploadBusy.current = false;
      if (pending.current.length) void uploadNext();
    }
  }

  function stopLocal() {
    window.clearInterval(timer.current);
    window.clearTimeout(sessionTimer.current);
    const element = video.current as
      | (HTMLVideoElement & {
          cancelVideoFrameCallback?: (id: number) => void;
        })
      | null;
    if (callbackId.current !== null) {
      if (element?.cancelVideoFrameCallback)
        element.cancelVideoFrameCallback(callbackId.current);
      else cancelAnimationFrame(callbackId.current);
    }
    callbackId.current = null;
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    if (video.current) video.current.srcObject = null;
    setRunning(false);
  }

  async function stopCapture() {
    const session = pairedRef.current;
    if (!session) return;
    await flushBatch();
    while (uploadBusy.current || pending.current.length)
      await new Promise((resolve) => setTimeout(resolve, 50));
    stopLocal();
    try {
      await postJson(`/sessions/${session.sessionId}/capture-stop`, {
        generation: session.generation,
      });
      setStatus("Capture stopped. The laptop is draining preserved work.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Stop failed.");
    }
  }

  function startUploadTimer() {
    const session = pairedRef.current;
    if (!session) return;
    window.clearInterval(timer.current);
    timer.current = window.setInterval(() => {
      void flushBatch();
      void postJson(`/sessions/${session.sessionId}/heartbeat`, {
        generation: session.generation,
      }).catch(() =>
        setStatus("Connection interrupted; keep this page open."),
      );
    }, 400);
  }

  useEffect(() => {
    const visibility = () => {
      if (document.visibilityState === "hidden" && stream.current) {
        setStatus("Capture paused while this page is hidden.");
        window.clearInterval(timer.current);
      } else if (
        document.visibilityState === "visible" &&
        stream.current &&
        pairedRef.current
      ) {
        setStatus("Capture resumed; timing gaps will be disclosed.");
        startUploadTimer();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    return () => document.removeEventListener("visibilitychange", visibility);
  }, []);

  return (
    <main className="phone-capture-page">
      <div className="phone-capture-card">
        <span className="eyebrow">LENS PHONE CAPTURE</span>
        <h1>Foreground mechanics camera</h1>
        <p>{status}</p>
        <div className="phone-preview">
          <video ref={video} muted playsInline autoPlay />
          {!running && <Camera size={42} />}
        </div>
        <canvas ref={canvas} hidden />
        {!running ? (
          <button
            className="button primary"
            disabled={!paired}
            onClick={() => void startCamera()}
          >
            {!paired ? (
              <LoaderCircle className="spin" size={17} />
            ) : (
              <Camera size={17} />
            )}
            Start camera
          </button>
        ) : (
          <button className="button primary" onClick={() => void stopCapture()}>
            <CircleStop size={17} /> Stop and drain
          </button>
        )}
        <small>
          Rear camera · no audio · max {LIVE_SESSION_MAX_MS / 60_000} min · ack{" "}
          {acked} · {dropped} dropped batches · keep unlocked and this page
          visible
        </small>
        {error && (
          <p className="discovery-error">
            <WifiOff size={16} /> {error}
          </p>
        )}
      </div>
    </main>
  );
}
