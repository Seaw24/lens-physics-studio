import type { Moment, Message, Concept, TutorReply } from "../shared/physics";
import type { CourseAnalysis } from "../shared/diagnostic";
export interface ServiceStatus {
  configured: boolean;
  mode: "bedrock" | "rehearsal";
  model: string | null;
  region: string;
}
async function request<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const data = await res.json();
  if (!res.ok)
    throw new Error(
      data.error || "The request could not finish. Please try again.",
    );
  return data;
}
export const getStatus = () => request<ServiceStatus>("/api/status");
export const askTutor = (
  body: {
    message: string;
    concept: Concept;
    scope?: "event" | "general";
    hintLevel: number;
    history: Message[];
    mode: string;
    observation: string;
    modelState: { force: number; radius: number; angle: number };
  },
  signal?: AbortSignal,
) => request<TutorReply>("/api/tutor", body, signal);
export const analyzeFrames = (
  frames: { time: number; data: string }[],
  duration: number,
  signal: AbortSignal,
) =>
  request<{ moments: Moment[]; sampleCount: number }>(
    "/api/analyze",
    { frames, duration },
    signal,
  );

export const analyzeCoursePdf = (data: string, signal?: AbortSignal) =>
  request<{
    analysis: CourseAnalysis;
    mode: "bedrock";
    model: string;
  }>("/api/analyze-course", { data }, signal);
// Select low-resolution, chronological evidence from a local file. No audio or full video is uploaded.
export async function sampleVideo(
  url: string,
  onProgress: (progress: number) => void,
  signal: AbortSignal,
) {
  const video = document.createElement("video");
  video.preload = "auto";
  video.muted = true;
  video.src = url;
  const wait = (event: string) =>
    new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(
        () =>
          finish(
            new Error(
              "This video could not be decoded. Try an MP4 (H.264) recording.",
            ),
          ),
        15000,
      );
      const ok = () => finish();
      const fail = () =>
        finish(
          new Error(
            "This video could not be decoded. Try an MP4 (H.264) recording.",
          ),
        );
      const abort = () => finish(new DOMException("Cancelled", "AbortError"));
      const finish = (error?: Error) => {
        clearTimeout(timeout);
        video.removeEventListener(event, ok);
        video.removeEventListener("error", fail);
        signal.removeEventListener("abort", abort);
        error ? reject(error) : resolve();
      };
      video.addEventListener(event, ok, { once: true });
      video.addEventListener("error", fail, { once: true });
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
  try {
    await wait("loadedmetadata");
    const duration = video.duration;
    if (!Number.isFinite(duration) || duration < 2 || duration > 1800)
      throw new Error(
        "Choose a video between 2 seconds and 30 minutes. Five to ten minutes works well for the demo.",
      );
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = Math.round((640 * video.videoHeight) / video.videoWidth);
    const ctx = canvas.getContext("2d")!;
    const small = document.createElement("canvas");
    small.width = 32;
    small.height = 18;
    const sc = small.getContext("2d", { willReadFrequently: true })!;
    const candidates: { time: number; data: string; change: number }[] = [];
    let previous: Uint8ClampedArray | undefined;
    const count = Math.min(90, Math.max(20, Math.ceil(duration / 4)));
    for (let i = 0; i < count; i++) {
      if (signal.aborted) throw new DOMException("Cancelled", "AbortError");
      const time = 0.05 + ((duration - 0.15) * i) / (count - 1);
      const ready = wait("seeked");
      video.currentTime = time;
      await ready;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      sc.drawImage(video, 0, 0, 32, 18);
      const pixels = sc.getImageData(0, 0, 32, 18).data;
      let change = 0;
      if (previous)
        for (let p = 0; p < pixels.length; p += 4)
          change +=
            Math.abs(pixels[p] - previous[p]) +
            Math.abs(pixels[p + 1] - previous[p + 1]) +
            Math.abs(pixels[p + 2] - previous[p + 2]);
      previous = pixels;
      candidates.push({
        time,
        data: canvas.toDataURL("image/jpeg", 0.64),
        change,
      });
      onProgress((i + 1) / count);
    }
    // Ten evenly spaced frames plus ten scene-change candidates. Change is a sampling cue, never a physics inference.
    const selected = new Set<number>();
    for (let i = 0; i < 10; i++)
      selected.add(Math.round((i * (count - 1)) / 9));
    const ranked = candidates
      .map((f, i) => ({ i, change: f.change }))
      .sort((a, b) => b.change - a.change);
    for (const { i } of ranked) {
      if (selected.size >= 20) break;
      selected.add(i);
    }
    return {
      duration,
      frames: [...selected]
        .sort((a, b) => a - b)
        .map((i) => ({ time: candidates[i].time, data: candidates[i].data })),
    };
  } finally {
    video.removeAttribute("src");
    video.load();
  }
}
