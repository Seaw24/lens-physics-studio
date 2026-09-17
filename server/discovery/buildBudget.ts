import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { DiscoveryConfig } from "./config";
import { DiscoveryError } from "./errors";

async function acquire(lockFile: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      await fs.writeFile(
        lockFile,
        JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }),
        { flag: "wx", mode: 0o600 },
      );
      return;
    } catch (error: any) {
      if (error?.code !== "EEXIST") throw error;
      try {
        const owner = JSON.parse(await fs.readFile(lockFile, "utf8"));
        if (Number.isInteger(owner.pid)) process.kill(owner.pid, 0);
      } catch (probe: any) {
        if (probe?.code === "ESRCH") {
          await fs.unlink(lockFile).catch(() => undefined);
          continue;
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  throw new DiscoveryError(
    "BUILD_EVALUATION_BUSY",
    "Another implementation validation run is reserving call capacity.",
    429,
    true,
  );
}

export async function reserveBuildEvaluationCalls(
  config: DiscoveryConfig,
  reasons: string[],
) {
  if (!reasons.length) return [];
  await fs.mkdir(config.runtimeRoot, { recursive: true, mode: 0o700 });
  const ledger = path.join(config.runtimeRoot, "build-evaluation-ledger.jsonl");
  const lock = path.join(config.runtimeRoot, "build-evaluation-ledger.lock");
  await acquire(lock);
  try {
    let used = 0;
    try {
      used = (await fs.readFile(ledger, "utf8")).split("\n").filter(Boolean).length;
    } catch (error: any) {
      if (error?.code !== "ENOENT") throw error;
    }
    if (used + reasons.length > config.limits.buildEvaluationCalls)
      throw new DiscoveryError(
        "BUILD_EVALUATION_BUDGET",
        `The persistent ${config.limits.buildEvaluationCalls}-call implementation ceiling has insufficient capacity.`,
        429,
      );
    const reservations = reasons.map((reason) => ({
      id: randomUUID(),
      reason,
      admittedAt: new Date().toISOString(),
    }));
    await fs.appendFile(
      ledger,
      reservations.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      { mode: 0o600 },
    );
    return reservations;
  } finally {
    await fs.unlink(lock).catch(() => undefined);
  }
}
