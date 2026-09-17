import { useEffect, useRef, useState } from "react";
import { Cable, Camera, CircleStop } from "lucide-react";
import { LIVE_SESSION_MAX_MS, type SessionSnapshot } from "../../shared/discovery";
import { discoveryApi } from "./api";
import { captureJpeg, sha256Hex } from "./capture";
import { CaptureQueue } from "./captureQueue";

type Frame = { frameId: string; seq: number; sourceTimeMs: number; sha256: string; partName: string; blob: Blob };

export default function WiredCamera({ session, onSession }: {
  session: SessionSnapshot; onSession: (session: SessionSnapshot) => void;
}) {
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Connect the USB cable, then find and select your iPhone camera.");
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
  const timingMethod = useRef("requestVideoFrameCallback");
  const visible = useRef(document.visibilityState === "visible");

  function stopFrames() {
    window.clearInterval(timer.current);
    window.clearTimeout(sessionTimer.current);
    if (callback.current !== null) {
      if (callbackType.current === "video") video.current?.cancelVideoFrameCallback(callback.current);
      else cancelAnimationFrame(callback.current);
    }
    callback.current = null;
    stream.current?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    stream.current = null;
  }
  function dispose() {
    lifetime.current++;
    stopFrames();
    abort.current?.abort();
    queue.current?.close();
    batch.current = [];
  }
  useEffect(() => {
    const visibility = () => {
      visible.current = document.visibilityState === "visible";
      if (!visible.current) batch.current = [];
    };
    document.addEventListener("visibilitychange", visibility);
    return () => { dispose(); document.removeEventListener("visibilitychange", visibility); };
  }, []);
  useEffect(() => {
    if (!["created", "ingesting", "paused"].includes(session.state)) {
      dispose(); setRunning(false);
    }
  }, [session.state, session.generation]);

  async function findCameras() {
    setBusy(true); setError("");
    const generation = lifetime.current;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia)
        throw new Error("Open this page on localhost or trusted HTTPS to access the camera.");
      // Explicit user gesture grants device-label access; this preview never uploads.
      const permission = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      permission.getTracks().forEach(track => track.stop());
      if (generation !== lifetime.current) return;
      const found = (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === "videoinput");
      setCameras(found);
      setDeviceId(found.find(d => /iphone|continuity/i.test(d.label))?.deviceId || "");
      setStatus(found.some(d => /iphone|continuity/i.test(d.label))
        ? "iPhone camera found. Keep the USB cable connected and your iPhone locked."
        : "Select your iPhone if listed. If missing, enable Continuity Camera, trust this Mac, lock the iPhone, then find cameras again.");
    } catch (caught) { if (generation === lifetime.current) setError(String(caught instanceof Error ? caught.message : caught)); }
    finally { if (generation === lifetime.current) setBusy(false); }
  }

  function flush() {
    if (!visible.current || currentSession.current.state !== "ingesting") { batch.current = []; return; }
    if (batch.current.length) queue.current?.enqueue(batch.current.splice(0, 8));
  }
  function schedule() {
    if (!stream.current || !video.current) return;
    if (typeof video.current.requestVideoFrameCallback === "function") {
      callbackType.current = "video";
      callback.current = video.current.requestVideoFrameCallback(() => { tick(); schedule(); });
    } else {
      callbackType.current = "animation";
      callback.current = requestAnimationFrame(() => { tick(); schedule(); });
    }
  }
  function tick() {
    // One monotonic clock across pauses/restarts preserves real gaps instead of
    // resetting timestamps when macOS restarts an external camera stream.
    const now = performance.now();
    if (!visible.current || currentSession.current.state !== "ingesting" || encode.current || now - lastSample.current < 125 || !video.current?.videoWidth) return;
    lastSample.current = now;
    sourceOrigin.current ??= now;
    const sourceTimeMs = Math.round(now - sourceOrigin.current);
    if (sourceTimeMs >= LIVE_SESSION_MAX_MS) { void finish(); return; }
    const generation = lifetime.current;
    const seq = sequence.current++;
    encode.current = (async () => {
      const blob = await captureJpeg(video.current!, canvas.current!);
      if (blob.size > 250 * 1024) throw new Error("A captured frame is too large. Select a lower-resolution camera.");
      const sha256 = await sha256Hex(blob);
      if (generation !== lifetime.current || !visible.current || currentSession.current.state !== "ingesting") return;
      batch.current.push({ frameId: `usb_${seq}_${crypto.randomUUID().slice(0,8)}`, seq, sourceTimeMs, sha256, partName: `frame_${seq}`, blob });
      if (batch.current.length >= 8) flush();
    })().catch(caught => { if (generation === lifetime.current) { setError(String(caught)); dispose(); setRunning(false); } })
      .finally(() => { encode.current = null; });
  }

  async function startCamera() {
    if (!deviceId || stream.current || busy || session.state !== "ingesting") return;
    setBusy(true); setError("");
    const generation = lifetime.current;
    try {
      const media = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: deviceId }, width: { ideal:1280 }, frameRate: { ideal:30 } }, audio:false });
      if (generation !== lifetime.current || currentSession.current.state !== "ingesting") { media.getTracks().forEach(t => t.stop()); return; }
      stream.current = media;
      video.current!.srcObject = media;
      await video.current!.play();
      if (generation !== lifetime.current) return;
      if (currentSession.current.state !== "ingesting") { stopFrames(); return; }
      abort.current = new AbortController();
      const signal = abort.current.signal;
      timingMethod.current = "performanceNow";
      queue.current = new CaptureQueue(async frames => {
        if (currentSession.current.state !== "ingesting" || !visible.current) { unreportedDrops.current++; setDrops(n=>n+1); return; }
        const count = unreportedDrops.current;
        const form = new FormData();
        form.append("metadata", JSON.stringify({ sessionId:session.id, generation:session.generation, batchId:`usb_batch_${crypto.randomUUID().replaceAll('-','_')}`, timingMethod:timingMethod.current, droppedBatches:count, frames:frames.map(({blob:_blob,...frame}) => frame) }));
        frames.forEach(frame => form.append(frame.partName, frame.blob, `${frame.partName}.jpg`));
        const response = await fetch(`/api/discovery/sessions/${session.id}/desktop-frames`, { method:"POST", credentials:"same-origin", body:form, signal });
        const result = await response.json();
        if (!response.ok) {
          if (response.status === 409 && ["paused"].includes(currentSession.current.state)) return;
          throw new Error(result.error?.message || "Camera upload failed.");
        }
        unreportedDrops.current = Math.max(0, unreportedDrops.current-count);
        if (generation === lifetime.current) setStatus(`Camera connected · frame ${result.ackSequence} received · ${result.captureGaps} gaps`);
      }, () => { unreportedDrops.current++; setDrops(n=>n+1); }, caught => {
        if (generation !== lifetime.current) return;
        setError(caught instanceof Error ? caught.message : "Camera upload failed.");
        dispose(); setRunning(false);
      });
      media.getVideoTracks().forEach(track => { track.onended = () => {
        setError("Camera disconnected. Reconnect the cable, then start the camera again. The interruption is retained as a capture gap.");
        dispose(); setRunning(false);
      }; });
      setRunning(true); setStatus("Capturing on this Mac. Keep this window visible and the USB cable connected.");
      schedule(); timer.current = window.setInterval(flush, 500);
      sessionTimer.current = window.setTimeout(() => void finish(), LIVE_SESSION_MAX_MS);
    } catch (caught) {
      if (generation === lifetime.current) { dispose(); setRunning(false); setError(caught instanceof Error ? caught.message : "Camera unavailable."); }
    } finally { setBusy(false); }
  }
  async function finish() {
    if (busy) return;
    setBusy(true); stopFrames(); setRunning(false);
    try {
      await encode.current;
      flush(); await queue.current?.drain();
      queue.current?.close();
      const latest = currentSession.current;
      if (["ingesting","paused"].includes(latest.state)) onSession(await discoveryApi.action(latest.id,latest.generation,"stop"));
    } catch(caught) { setError(caught instanceof Error ? caught.message : "Could not stop capture."); }
    finally { setBusy(false); }
  }

  return <div className="wired-camera">
    <div><Cable size={20}/><strong>iPhone over USB</strong></div>
    <p>Use a USB data cable and Apple Continuity Camera. Choose your iPhone below; the browser cannot verify whether macOS selected USB or wireless transport. No phone pairing page is needed.</p>
    <div className="discovery-controls">
      <button className="button secondary" disabled={busy || running} onClick={findCameras}>Find cameras</button>
      <label>Camera <select aria-label="USB camera" value={deviceId} disabled={running || busy} onChange={event=>setDeviceId(event.target.value)}>
        <option value="">Select your iPhone camera</option>
        {cameras.map((camera,i)=><option key={camera.deviceId} value={camera.deviceId}>{camera.label || `Camera ${i+1}`}</option>)}
      </select></label>
      <button className="button primary" disabled={busy || running || !deviceId || session.state !== "ingesting"} onClick={startCamera}><Camera size={16}/> Start camera</button>
      {running && <button className="button secondary" disabled={busy} onClick={finish}><CircleStop size={16}/> Finish capture</button>}
    </div>
    <video ref={video} muted playsInline autoPlay className="wired-preview" aria-label="Selected camera preview"/>
    <canvas ref={canvas} hidden/>
    <p role="status">{status}{session.state === "created" ? " Press Start above to enable capture." : session.state === "paused" ? " Session paused." : ""} · {drops} dropped batches</p>
    {error && <p role="alert" className="discovery-error">{error}</p>}
  </div>;
}
