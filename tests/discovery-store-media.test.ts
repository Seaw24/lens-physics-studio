import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import sharp from "sharp";
import { loadDiscoveryConfig } from "../server/discovery/config";
import { DiscoveryStore } from "../server/discovery/store";
import { DiscoveryMedia } from "../server/discovery/media";
import { reserveBuildEvaluationCalls } from "../server/discovery/buildBudget";

async function fixture() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-discovery-test-"));
  const config = loadDiscoveryConfig(
    { DISCOVERY_ACCESS_CODE: "b".repeat(32) },
    path.join(root, "runtime"),
  );
  config.limits.minCloudStartSpacingMs = 0;
  const store = new DiscoveryStore(config);
  await store.initialize();
  return { root, config, store, media: new DiscoveryMedia(config, store) };
}

async function run(executable: string, args: string[]) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(stderr || `exit ${code}`)),
    );
  });
}

test("atomic store rejects traversal and recovers active sessions as interrupted", async () => {
  const { root, config, store } = await fixture();
  try {
    const session = await store.create("video", "scan");
    await store.mutate(session.id, (value) => {
      value.state = "ingesting";
      value.counters.reviewerReservations = 1;
      value.workCache.pending = { state: "unknown", attemptId: "attempt" };
    });
    assert.throws(() => store.sessionDir("../escape"), /Invalid session identifier/);
    await store.close();
    const recovered = new DiscoveryStore(config);
    await recovered.initialize();
    assert.equal(recovered.get(session.id).state, "interrupted");
    assert.equal(recovered.get(session.id).counters.reviewerReservations, 0);
    await recovered.close();
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("second writer cannot acquire an active discovery store", async () => {
  const { root, config, store } = await fixture();
  try {
    const second = new DiscoveryStore(config);
    await assert.rejects(() => second.initialize(), /Another Discovery process owns this store/);
  } finally {
    await store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("the persisted implementation-call ceiling is enforced before admission", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-build-budget-"));
  try {
    const config = loadDiscoveryConfig(
      { DISCOVERY_ACCESS_CODE: "b".repeat(32) },
      root,
    );
    config.limits.buildEvaluationCalls = 2;
    await reserveBuildEvaluationCalls(config, ["first", "second"]);
    await assert.rejects(
      reserveBuildEvaluationCalls(config, ["third"]),
      (error: any) => error?.code === "BUILD_EVALUATION_BUDGET",
    );
    const rows = (
      await fs.readFile(path.join(root, "build-evaluation-ledger.jsonl"), "utf8")
    )
      .trim()
      .split("\n");
    assert.equal(rows.length, 2);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("still normalization strips metadata, bounds dimensions, and publishes an immutable asset", async () => {
  const { root, store, media } = await fixture();
  try {
    const session = await store.create("image", "scan");
    const input = path.join(root, "oriented.jpg");
    await sharp({
      create: { width: 120, height: 60, channels: 3, background: "#ccb899" },
    })
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toFile(input);
    const normalized = path.join(store.sessionDir(session.id), "source", "normalized.jpg");
    const result = await media.normalizeStill(input, normalized);
    assert.equal(result.width, 60);
    assert.equal(result.height, 120);
    const metadata = await sharp(normalized).metadata();
    assert.equal(metadata.orientation, undefined);
    const asset = await media.publishStillAsset(session.id, normalized);
    assert.equal(asset.record.mimeType, "image/jpeg");
    assert.notEqual(asset.record.relativePath, input);
  } finally {
    await store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("timestamped video fixture probes, freezes frames, and produces an accurately bounded H.264 clip", async (t) => {
  const { root, config, store, media } = await fixture();
  if (!config.ffmpegPath || !config.ffprobePath) {
    await store.close();
    await fs.rm(root, { recursive: true, force: true });
    t.skip("FFmpeg runtime unavailable");
    return;
  }
  try {
    const session = await store.create("video", "scan");
    const input = path.join(root, "fixture.mp4");
    await run(config.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=3",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      input,
    ]);
    const probe = await media.probeVideo(input);
    assert.ok(Math.abs(probe.durationMs - 3000) < 100);
    const snapshot = await media.extractVideoFrames(session.id, input, 500, 2500);
    assert.equal(snapshot.frames.length, 4);
    const firstPath = snapshot.frames[0].path;
    await fs.unlink(input);
    assert.equal((await fs.stat(firstPath)).isFile(), true, "snapshot survives source/ring removal");
    await run(config.ffmpegPath, [
      "-hide_banner",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=320x180:rate=30:duration=3",
      "-an",
      "-c:v",
      "libx264",
      "-pix_fmt",
      "yuv420p",
      input,
    ]);
    const clip = await media.publishVideoClip(session.id, input, 400, 2100);
    assert.ok(Math.abs(clip.probe.durationMs - 1700) <= 180);
    assert.equal(clip.probe.width, 320);
    assert.equal(clip.record.mimeType, "video/mp4");
  } finally {
    await store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
