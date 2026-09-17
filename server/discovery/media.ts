import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import sharp from "sharp";
import type { DiscoveryFrame } from "../../shared/discovery";
import type { DiscoveryConfig } from "./config";
import { DiscoveryError } from "./errors";
import type { DiscoveryStore, StoredAsset } from "./store";

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}

async function run(
  executable: string,
  args: string[],
  options: { timeoutMs: number; maxStdout?: number },
) {
  return await new Promise<{ stdout: Buffer; stderr: string }>((resolve, reject) => {
    const child = spawn(executable, args, {
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    const timer = setTimeout(() => child.kill("SIGKILL"), options.timeoutMs);
    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > (options.maxStdout || 32 * 1024 * 1024)) {
        child.kill("SIGKILL");
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.reduce((sum, item) => sum + item.length, 0) < 32_000)
        stderr.push(chunk);
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      clearTimeout(timer);
      if (code === 0)
        resolve({
          stdout: Buffer.concat(stdout),
          stderr: Buffer.concat(stderr).toString("utf8"),
        });
      else
        reject(
          new DiscoveryError(
            "MEDIA_PROCESSING_FAILED",
            `Media tool failed (${signal || code}).`,
            415,
          ),
        );
    });
  });
}

export interface ProbeResult {
  durationMs: number;
  width: number;
  height: number;
  fps: number;
}

export class DiscoveryMedia {
  constructor(
    private config: DiscoveryConfig,
    private store: DiscoveryStore,
  ) {}

  private requireTools() {
    if (!this.config.ffmpegPath || !this.config.ffprobePath)
      throw new DiscoveryError(
        "MEDIA_DEPENDENCY_UNAVAILABLE",
        "FFmpeg and FFprobe are required for video Discovery.",
        503,
      );
    return {
      ffmpeg: this.config.ffmpegPath,
      ffprobe: this.config.ffprobePath,
    };
  }

  async normalizeStill(input: string, output: string) {
    const metadata = await sharp(input, { limitInputPixels: false }).metadata();
    const pixels = (metadata.width || 0) * (metadata.height || 0);
    if (!metadata.width || !metadata.height || pixels > this.config.limits.stillPixels)
      throw new DiscoveryError(
        "INVALID_IMAGE",
        "The still image is undecodable or exceeds 40 megapixels.",
        415,
      );
    const buffer = await sharp(input)
      .rotate()
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();
    await fs.writeFile(output, buffer, { flag: "wx", mode: 0o600 });
    const normalized = await sharp(buffer).metadata();
    return {
      sha256: sha256(buffer),
      size: buffer.length,
      width: normalized.width!,
      height: normalized.height!,
    };
  }

  async normalizePhoneFrame(input: Buffer) {
    let quality = 82;
    let output = await sharp(input, { limitInputPixels: 20_000_000 })
      .rotate()
      .resize({
        width: 1280,
        height: 1280,
        fit: "inside",
        withoutEnlargement: true,
      })
      .jpeg({ quality })
      .toBuffer();
    while (output.length > 250 * 1024 && quality > 46) {
      quality -= 8;
      output = await sharp(input)
        .rotate()
        .resize({ width: 1280, height: 1280, fit: "inside" })
        .jpeg({ quality })
        .toBuffer();
    }
    if (output.length > 250 * 1024)
      throw new DiscoveryError(
        "FRAME_TOO_LARGE",
        "A captured frame could not be normalized below 250 KiB.",
        413,
      );
    const metadata = await sharp(output).metadata();
    return {
      bytes: output,
      sha256: sha256(output),
      width: metadata.width!,
      height: metadata.height!,
    };
  }

  async probeVideo(file: string): Promise<ProbeResult> {
    const { ffprobe } = this.requireTools();
    const result = await run(
      ffprobe,
      [
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=width,height,avg_frame_rate:format=duration",
        "-of",
        "json",
        file,
      ],
      { timeoutMs: 30_000, maxStdout: 1_000_000 },
    );
    const data = JSON.parse(result.stdout.toString("utf8"));
    const stream = data.streams?.[0];
    const duration = Number(data.format?.duration);
    const [numerator, denominator] = String(stream?.avg_frame_rate || "0/1")
      .split("/")
      .map(Number);
    const fps = denominator ? numerator / denominator : 0;
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration * 1000 > this.config.limits.recordingMs ||
      !Number.isInteger(stream?.width) ||
      !Number.isInteger(stream?.height)
    )
      throw new DiscoveryError(
        "INVALID_VIDEO",
        "The recording is undecodable or exceeds 30 minutes.",
        415,
      );
    return {
      durationMs: Math.round(duration * 1000),
      width: stream.width,
      height: stream.height,
      fps: Number.isFinite(fps) ? fps : 0,
    };
  }

  async extractActivityThumbnails(
    source: string,
    startMs: number,
    endMs: number,
  ) {
    const { ffmpeg } = this.requireTools();
    if (endMs <= startMs) return [];
    const width = 64;
    const height = 36;
    const frameBytes = width * height;
    const result = await run(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        (startMs / 1000).toFixed(3),
        "-t",
        ((endMs - startMs) / 1000).toFixed(3),
        "-i",
        source,
        "-vf",
        "fps=4,scale=64:36,format=gray",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "gray",
        "pipe:1",
      ],
      { timeoutMs: 30_000, maxStdout: 256 * 1024 },
    );
    const frames: Array<{ sourceTimeMs: number; grayscale: Uint8Array }> = [];
    const count = Math.floor(result.stdout.length / frameBytes);
    for (let index = 0; index < count; index++) {
      const offset = index * frameBytes;
      frames.push({
        sourceTimeMs: Math.min(endMs, startMs + Math.round(index * 250)),
        grayscale: Uint8Array.from(result.stdout.subarray(offset, offset + frameBytes)),
      });
    }
    return frames;
  }

  async extractVideoFrames(
    sessionId: string,
    source: string,
    startMs: number,
    endMs: number,
  ) {
    const { ffmpeg } = this.requireTools();
    const snapshotId = randomUUID();
    const folder = path.join(this.store.sessionDir(sessionId), "snapshots", snapshotId);
    await fs.mkdir(folder, { recursive: false, mode: 0o700 });
    const pattern = path.join(folder, "%03d.jpg");
    await run(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-ss",
        (startMs / 1000).toFixed(3),
        "-t",
        ((endMs - startMs) / 1000).toFixed(3),
        "-i",
        source,
        "-vf",
        "fps=2,scale='min(960,iw)':-2",
        "-frames:v",
        "12",
        "-q:v",
        "3",
        "-start_number",
        "0",
        pattern,
      ],
      { timeoutMs: 60_000 },
    );
    const files = (await fs.readdir(folder)).filter((name) => name.endsWith(".jpg")).sort();
    if (files.length < 2)
      throw new DiscoveryError(
        "INSUFFICIENT_MEDIA",
        "The selected video interval did not decode enough distinct frames.",
        415,
      );
    const frames: Array<DiscoveryFrame & { path: string }> = [];
    for (let index = 0; index < files.length; index++) {
      const file = path.join(folder, files[index]);
      const bytes = await fs.readFile(file);
      const metadata = await sharp(bytes).metadata();
      const sourceTimeMs = Math.min(endMs, startMs + index * 500);
      frames.push({
        frameId: `f_${String(sourceTimeMs).padStart(9, "0")}`,
        seq: Math.round(sourceTimeMs / 500),
        sourceTimeMs,
        sha256: sha256(bytes),
        width: metadata.width!,
        height: metadata.height!,
        orientation: 1,
        path: file,
      });
    }
    return { snapshotId, frames };
  }

  async extractActivity(source: string, durationMs: number) {
    const { ffmpeg } = this.requireTools();
    const result = await run(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        source,
        "-vf",
        "fps=4,scale=64:36,format=gray",
        "-f",
        "rawvideo",
        "-",
      ],
      {
        timeoutMs: Math.max(60_000, Math.ceil(durationMs / 4)),
        maxStdout: Math.ceil((durationMs / 1000) * 4 * 64 * 36 + 64 * 36),
      },
    );
    const frameSize = 64 * 36;
    const frames: Array<{ sourceTimeMs: number; grayscale: Uint8Array }> = [];
    for (
      let offset = 0, index = 0;
      offset + frameSize <= result.stdout.length;
      offset += frameSize, index++
    )
      frames.push({
        sourceTimeMs: index * 250,
        grayscale: Uint8Array.from(result.stdout.subarray(offset, offset + frameSize)),
      });
    return frames;
  }

  async grayscaleThumbnail(bytes: Buffer) {
    const { data } = await sharp(bytes)
      .rotate()
      .resize(64, 36, { fit: "fill" })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return Uint8Array.from(data);
  }

  async publishStillAsset(sessionId: string, normalizedSource: string) {
    const assetId = randomUUID();
    const relativePath = path.join("assets", `${assetId}.jpg`);
    const destination = path.join(this.store.sessionDir(sessionId), relativePath);
    await fs.copyFile(normalizedSource, destination, fs.constants.COPYFILE_EXCL);
    const bytes = await fs.readFile(destination);
    const metadata = await sharp(bytes).metadata();
    return {
      record: {
        assetId,
        relativePath,
        mimeType: "image/jpeg" as const,
        size: bytes.length,
        sha256: sha256(bytes),
      },
      width: metadata.width!,
      height: metadata.height!,
    };
  }

  async publishVideoClip(
    sessionId: string,
    source: string,
    startMs: number,
    endMs: number,
  ) {
    const { ffmpeg } = this.requireTools();
    const assetId = randomUUID();
    const relativePath = path.join("assets", `${assetId}.mp4`);
    const destination = path.join(this.store.sessionDir(sessionId), relativePath);
    const temp = `${destination}.tmp.mp4`;
    await run(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        source,
        "-ss",
        (startMs / 1000).toFixed(3),
        "-t",
        ((endMs - startMs) / 1000).toFixed(3),
        "-an",
        "-vf",
        "fps=30",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        temp,
      ],
      { timeoutMs: 90_000 },
    );
    await fs.rename(temp, destination);
    const probe = await this.probeVideo(destination);
    const bytes = await fs.readFile(destination);
    const expected = endMs - startMs;
    if (Math.abs(probe.durationMs - expected) > 180)
      throw new DiscoveryError(
        "MEDIA_CLOCK_MISMATCH",
        "Generated clip timing did not match its source interval.",
        500,
      );
    return {
      record: {
        assetId,
        relativePath,
        mimeType: "video/mp4" as const,
        size: bytes.length,
        sha256: sha256(bytes),
      },
      probe,
    };
  }

  async publishPhoneClip(
    sessionId: string,
    frames: Array<DiscoveryFrame & { path: string }>,
    startMs: number,
    endMs: number,
  ) {
    const { ffmpeg } = this.requireTools();
    const assetId = randomUUID();
    const relativePath = path.join("assets", `${assetId}.mp4`);
    const destination = path.join(this.store.sessionDir(sessionId), relativePath);
    const sequence = path.join(
      this.store.sessionDir(sessionId),
      "snapshots",
      `clip_${assetId}`,
    );
    await fs.mkdir(sequence, { recursive: false, mode: 0o700 });
    const ordered = [...frames].sort(
      (a, b) => a.sourceTimeMs! - b.sourceTimeMs!,
    );
    let current = ordered[0];
    let index = 0;
    for (let tick = startMs; tick < endMs; tick += 125) {
      while (
        ordered[index + 1] &&
        ordered[index + 1].sourceTimeMs! <= tick
      )
        current = ordered[++index];
      await fs.copyFile(
        current.path,
        path.join(sequence, `${String(Math.round((tick - startMs) / 125)).padStart(5, "0")}.jpg`),
      );
    }
    const temp = `${destination}.tmp.mp4`;
    await run(
      ffmpeg,
      [
        "-hide_banner",
        "-loglevel",
        "error",
        "-framerate",
        "8",
        "-start_number",
        "0",
        "-i",
        path.join(sequence, "%05d.jpg"),
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        temp,
      ],
      { timeoutMs: 90_000 },
    );
    await fs.rename(temp, destination);
    const probe = await this.probeVideo(destination);
    const bytes = await fs.readFile(destination);
    return {
      record: {
        assetId,
        relativePath,
        mimeType: "video/mp4" as const,
        size: bytes.length,
        sha256: sha256(bytes),
      },
      probe,
    };
  }

  assetPath(sessionId: string, asset: StoredAsset) {
    const root = path.join(this.store.sessionDir(sessionId), "assets") + path.sep;
    const resolved = path.resolve(this.store.sessionDir(sessionId), asset.relativePath);
    if (!resolved.startsWith(root))
      throw new DiscoveryError("INVALID_ASSET", "Invalid asset path.", 404);
    return resolved;
  }
}
