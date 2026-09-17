import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { ActivityGate, scheduleWindows } from "../server/discovery/activity";
import { loadDiscoveryConfig } from "../server/discovery/config";
import { DiscoveryService } from "../server/discovery/service";
import { reserveBuildEvaluationCalls } from "../server/discovery/buildBudget";
import type { ModelFrame } from "../server/discovery/models";

const argv = process.argv.slice(2);
const value = (flag: string) => {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
};
const invoke = argv.includes("--invoke");
const mode = value("--mode") || "cascade_gated";
if (!['direct_uniform','cascade_uniform','cascade_gated'].includes(mode))
  throw new Error("--mode must be direct_uniform, cascade_uniform, or cascade_gated");
const manifestPath = path.resolve(
  value("--manifest") || ".runtime/vision-evaluation/manifest.json",
);
const runPath = value("--run") ? path.resolve(value("--run")!) : null;
const maxCalls = Number(value("--max-calls") || 40);
if (!Number.isInteger(maxCalls) || maxCalls < 1 || maxCalls > 80)
  throw new Error("--max-calls must be an integer from 1 to 80");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
const split = value("--split") || "holdout";
const sources = manifest.sources.filter((source: any) => source.split === split);
if (!sources.length) throw new Error(`No ${split} source exists in the manifest.`);
if (invoke && !manifest.cloudFramesPrivacyReviewed)
  throw new Error("Invocation requires cloudFramesPrivacyReviewed=true.");

const hash = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
const root = path.dirname(manifestPath);
const resolvedFrame = (relative: string) => {
  const file = path.resolve(root, relative);
  if (!file.startsWith(`${root}${path.sep}`)) throw new Error("Frame path escapes manifest root.");
  return file;
};

const plans: any[] = [];
for (const source of sources) {
  let activeTimes: number[] = [];
  if (mode === "cascade_gated") {
    const gate = new ActivityGate();
    for (const frame of source.frames) {
      const { data } = await sharp(resolvedFrame(frame.path))
        .resize(64, 36, { fit: "fill" })
        .grayscale()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const tick = gate.push(
        Math.round(frame.sourceTimeSeconds * 1000),
        Uint8Array.from(data),
      );
      if (tick.active) activeTimes.push(tick.sourceTimeMs);
    }
  }
  const windows = scheduleWindows(
    Math.round(source.durationSeconds * 1000),
    activeTimes,
    mode === "cascade_gated" ? "cascade_gated" : "cascade_uniform",
  );
  plans.push(
    ...windows.map((window, index) => ({
      id: `${source.sourceId}-${mode}-${String(index).padStart(3, "0")}`,
      sourceId: source.sourceId,
      source,
      ...window,
      frames: source.frames.filter(
        (frame: any) =>
          frame.sourceTimeSeconds * 1000 >= window.startMs &&
          frame.sourceTimeSeconds * 1000 < window.endMs,
      ),
    })).filter((window) => window.frames.length >= 2),
  );
}
const frozen = {
  version: "discovery-evaluation-v2",
  invoked: invoke,
  mode,
  split,
  maxCalls,
  manifestHash: hash(await fs.readFile(manifestPath)),
  schedulerEvidence:
    mode === "cascade_gated"
      ? "privacy-reviewed 2 fps masked pilot frames; this is below the production 4 fps activity rate and is reported as a sampling limitation"
      : "uniform six-second windows on the same privacy-reviewed evidence",
  userLabelsLoaded: false,
  windows: plans.map((plan) => ({
    id: plan.id,
    startMs: plan.startMs,
    endMs: plan.endMs,
    reasons: plan.reasons,
    frameIds: plan.frames.map((frame: any) => frame.frameId),
  })),
};
if (!invoke) {
  console.log(JSON.stringify(frozen, null, 2));
  process.exit(0);
}
if (!runPath) throw new Error("--run is required with --invoke");
await fs.mkdir(runPath, { recursive: false });
await fs.writeFile(path.join(runPath, "frozen-plan.json"), JSON.stringify(frozen, null, 2), { flag: "wx" });
const config = loadDiscoveryConfig();
const service = await DiscoveryService.create(config);
let callCount = 0;
async function reserve(reason: string) {
  if (callCount >= maxCalls)
    throw new Error("Evaluation call ceiling reached.");
  await reserveBuildEvaluationCalls(config, [reason]);
  callCount++;
}
const rows: any[] = [];
try {
  for (const plan of plans) {
    const modelFrames: ModelFrame[] = await Promise.all(
      plan.frames.slice(0, 12).map(async (frame: any, index: number) => {
        const file = resolvedFrame(frame.path);
        const bytes = await fs.readFile(file);
        if (hash(bytes) !== frame.sha256) throw new Error("Frame integrity failed.");
        const metadata = await sharp(bytes).metadata();
        return {
          frameId: frame.frameId,
          seq: index,
          sourceTimeMs: Math.round(frame.sourceTimeSeconds * 1000),
          sha256: frame.sha256,
          width: metadata.width!,
          height: metadata.height!,
          orientation: 1,
          path: file,
        };
      }),
    );
    const snapshotHash = hash(JSON.stringify(modelFrames.map((frame) => [frame.frameId, frame.sha256])));
    const row: any = { windowId: plan.id, startMs: plan.startMs, endMs: plan.endMs, reasons: plan.reasons, snapshotHash };
    try {
      if (mode === "direct_uniform") {
        await reserve(`${mode}:${plan.id}:reviewer`);
        const result = await service.models.review(
          `evaluation_${plan.sourceId}`,
          1,
          "video",
          snapshotHash,
          modelFrames,
          "uniform_evaluation",
          ["Privacy-masked JPEGs sampled at 2 fps; audio and continuous motion excluded."],
        );
        row.reviewer = { response: result.response, usage: result.usage, latencyMs: result.latencyMs };
      } else {
        await reserve(`${mode}:${plan.id}:proposer`);
        const proposal = await service.models.propose(
          `evaluation_${plan.sourceId}`,
          1,
          "video",
          snapshotHash,
          modelFrames,
          plan.reasons.join("+"),
          ["Privacy-masked JPEGs sampled at 2 fps; audio and continuous motion excluded."],
        );
        row.proposer = { response: proposal.response, usage: proposal.usage, latencyMs: proposal.latencyMs };
        if (proposal.response.proposals.length) {
          await reserve(`${mode}:${plan.id}:reviewer`);
          const review = await service.models.review(
            `evaluation_${plan.sourceId}`,
            1,
            "video",
            snapshotHash,
            modelFrames,
            plan.reasons.join("+"),
            ["Privacy-masked JPEGs sampled at 2 fps; audio and continuous motion excluded."],
          );
          row.reviewer = { response: review.response, usage: review.usage, latencyMs: review.latencyMs };
        }
      }
      row.status = "complete";
    } catch (error) {
      row.status = /ceiling/i.test(String(error)) ? "suppressed_budget" : "failed";
      row.error = error instanceof Error ? { name: error.name, message: error.message } : { name: "UnknownError" };
      rows.push(row);
      await fs.writeFile(path.join(runPath, `${plan.id}.json`), JSON.stringify(row, null, 2), { flag: "wx" });
      if (row.status === "suppressed_budget" || row.error.name !== "ZodError") break;
      continue;
    }
    rows.push(row);
    await fs.writeFile(path.join(runPath, `${plan.id}.json`), JSON.stringify(row, null, 2), { flag: "wx" });
  }
  const usage = rows.reduce(
    (total, row) => {
      for (const stage of [row.proposer, row.reviewer]) {
        if (!stage) continue;
        total.inputTokens += stage.usage.inputTokens || 0;
        total.outputTokens += stage.usage.outputTokens || 0;
        if (stage.usage.inputTokens === null || stage.usage.outputTokens === null)
          total.unknownUsage++;
      }
      return total;
    },
    { inputTokens: 0, outputTokens: 0, unknownUsage: 0 },
  );
  await fs.writeFile(
    path.join(runPath, "summary.json"),
    JSON.stringify(
      {
        ...frozen,
        calls: callCount,
        completedWindows: rows.filter((row) => row.status === "complete").length,
        failedWindows: rows.filter((row) => row.status === "failed").length,
        suppressedWindows: plans.length - rows.filter((row) => row.status === "complete").length,
        usage,
        measuredQuality: "not adjudicated by this invocation runner; compare visible facts separately without feeding labels to models",
      },
      null,
      2,
    ),
    { flag: "wx" },
  );
} finally {
  await service.close();
}
