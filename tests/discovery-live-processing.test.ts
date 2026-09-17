import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { loadDiscoveryConfig } from "../server/discovery/config";
import { DiscoveryService } from "../server/discovery/service";

test("live capture past 3 s without a full window does not spin the event loop", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-live-test-"));
  const config = loadDiscoveryConfig(
    { DISCOVERY_ACCESS_CODE: "c".repeat(32) },
    path.join(root, "runtime"),
  );
  config.limits.minCloudStartSpacingMs = 0;
  const service = await DiscoveryService.create(config);
  // Count processing passes; the guard ends a runaway loop so the test cannot hang.
  let passes = 0;
  const internal = service as any;
  const original = internal.processPhoneAvailable.bind(service);
  internal.processPhoneAvailable = (...args: unknown[]) => {
    if (++passes > 20) return Promise.reject(new Error("processing loop did not yield"));
    return original(...args);
  };
  try {
    const created = await service.createSession(
      { sourceKind: "phone", mode: "live" },
      "live_processing_test_key",
    );
    const session = await service.start(created.id, created.generation);
    const jpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const sha256 = createHash("sha256").update(jpeg).digest("hex");
    // 26 frames at ~7.5 fps reach 3.4 s: past the 3 s requeue threshold, short of a 6 s window.
    for (let seq = 0; seq < 26; seq += 4) {
      const frames = [];
      for (let i = seq; i < Math.min(seq + 4, 26); i++)
        frames.push({ frameId: `usb_${i}`, seq: i, sourceTimeMs: Math.round(i * 133.6), sha256, partName: `frame_${i}` });
      await service.ingestPhoneBatch(
        {
          sessionId: session.id,
          generation: session.generation,
          batchId: `live_batch_${seq}`,
          timingMethod: "performanceNow",
          frames,
        } as any,
        frames.map((frame) => ({ partName: frame.partName, bytes: jpeg, mimeType: "image/jpeg" })),
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    assert.ok(passes <= 20, `processing ran ${passes} times without new frames`);
    assert.equal(service.captureStatus(session.id).state, "ingesting");

    // Stop drains the final partial window, then completes. Model work is stubbed
    // so the test never calls Bedrock.
    internal.processSnapshot = async () => undefined;
    await service.stop(session.id, session.generation);
    for (let i = 0; i < 20 && service.captureStatus(session.id).state === "draining"; i++)
      await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(service.captureStatus(session.id).state, "completed");
  } finally {
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
