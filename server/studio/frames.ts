import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { DiscoveryError } from "../discovery/errors";

export interface StudioFrame {
  label: string;
  t: number;
  /** Clean JPEG for designers and posters. */
  clean: Buffer;
  /** JPEG with the labeled coordinate grid the annotator reads positions from. */
  grid: Buffer;
  width: number;
  height: number;
}

function run(executable: string, args: string[], timeoutMs = 30_000) {
  return new Promise<Buffer>((resolve, reject) => {
    const child = spawn(executable, args, { shell: false, stdio: ["ignore", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > 24 * 1024 * 1024) child.kill("SIGKILL");
      else chunks.push(chunk);
    });
    child.stderr.resume();
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(chunks));
      else reject(new DiscoveryError("MEDIA_PROCESSING_FAILED", "Could not read frames from the event clip.", 500));
    });
  });
}

/**
 * Frame times for the annotator: a few before the event, most inside it, a few
 * after, never closer than 1/15 s.
 */
export function studioFrameTimes(duration: number, eventFrom: number, eventTo: number) {
  const end = Math.max(0, duration - 0.04);
  const clampTime = (t: number) => Math.min(end, Math.max(0, t));
  let times: number[];
  if (eventTo - eventFrom < 0.3) {
    const center = (eventFrom + eventTo) / 2;
    const from = clampTime(center - 2);
    const to = clampTime(center + 2);
    times = Array.from({ length: 12 }, (_, i) => from + ((to - from) * i) / 11);
  } else {
    const before = clampTime(eventFrom - 1.2);
    const after = clampTime(eventTo + 1.2);
    times = [
      ...Array.from({ length: 3 }, (_, i) => before + ((eventFrom - before) * i) / 3),
      ...Array.from({ length: 12 }, (_, i) => eventFrom + ((eventTo - eventFrom) * i) / 11),
      ...Array.from({ length: 3 }, (_, i) => eventTo + ((after - eventTo) * (i + 1)) / 3),
    ].map(clampTime);
  }
  const sorted = [...times].sort((a, b) => a - b);
  const kept: number[] = [];
  for (const t of sorted) if (!kept.length || t - kept[kept.length - 1] >= 1 / 15) kept.push(Math.round(t * 1000) / 1000);
  return kept;
}

async function extractFrame(ffmpeg: string, clip: string, t: number, maxSide: number) {
  return await run(ffmpeg, [
    "-hide_banner",
    "-loglevel",
    "error",
    "-ss",
    t.toFixed(3),
    "-i",
    clip,
    "-frames:v",
    "1",
    "-vf",
    `scale='if(gt(iw,ih),min(${maxSide},iw),-2)':'if(gt(iw,ih),-2,min(${maxSide},ih))'`,
    "-q:v",
    "3",
    "-f",
    "image2",
    "-c:v",
    "mjpeg",
    "pipe:1",
  ]);
}

function gridSvg(width: number, height: number) {
  const lines: string[] = [];
  const text: string[] = [];
  const font = Math.max(11, Math.round(Math.min(width, height) / 42));
  for (let i = 1; i < 10; i++) {
    const x = (width * i) / 10;
    const y = (height * i) / 10;
    const major = i === 5;
    const stroke = major ? "rgba(255,255,255,0.55)" : "rgba(255,255,255,0.32)";
    lines.push(
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="rgba(0,0,0,0.35)" stroke-width="3"/>`,
      `<line x1="${x}" y1="0" x2="${x}" y2="${height}" stroke="${stroke}" stroke-width="1"/>`,
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="rgba(0,0,0,0.35)" stroke-width="3"/>`,
      `<line x1="0" y1="${y}" x2="${width}" y2="${y}" stroke="${stroke}" stroke-width="1"/>`,
    );
    for (const [tx, ty, anchor] of [
      [x, font + 2, "middle"],
      [x, height - 5, "middle"],
    ] as const)
      text.push(`<text x="${tx}" y="${ty}" text-anchor="${anchor}" class="t">${i * 10}</text>`);
    for (const [tx, ty, anchor] of [
      [4, y + font / 3, "start"],
      [width - 4, y + font / 3, "end"],
    ] as const)
      text.push(`<text x="${tx}" y="${ty}" text-anchor="${anchor}" class="t">${i * 10}</text>`);
  }
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
      <style>.t{font:700 ${font}px sans-serif;fill:#fff;paint-order:stroke;stroke:#000;stroke-width:3px}</style>
      ${lines.join("")}
      ${text.join("")}
    </svg>`,
  );
}

export async function extractStudioFrames(
  ffmpeg: string,
  clip: string,
  times: number[],
  maxSide = 896,
): Promise<StudioFrame[]> {
  const frames: StudioFrame[] = [];
  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    const raw = await extractFrame(ffmpeg, clip, t, maxSide);
    if (!raw.length) continue;
    const image = sharp(raw);
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;
    if (!width || !height) continue;
    const label = `F${String(frames.length + 1).padStart(2, "0")}`;
    const clean = await sharp(raw).jpeg({ quality: 84 }).toBuffer();
    const grid = await sharp(raw)
      .composite([{ input: gridSvg(width, height), top: 0, left: 0 }])
      .jpeg({ quality: 84 })
      .toBuffer();
    frames.push({ label, t, clean, grid, width, height });
  }
  if (frames.length < 2)
    throw new DiscoveryError("INSUFFICIENT_MEDIA", "The event clip did not decode enough frames for annotation.", 500);
  return frames;
}

/** A single poster frame, saved as JPEG. */
export async function writePoster(ffmpeg: string, clip: string, t: number, destination: string) {
  const raw = await extractFrame(ffmpeg, clip, t, 640);
  const jpeg = await sharp(raw).jpeg({ quality: 80 }).toBuffer();
  await fs.mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temp = `${destination}.${process.pid}.tmp`;
  await fs.writeFile(temp, jpeg, { mode: 0o600 });
  await fs.rename(temp, destination);
}
