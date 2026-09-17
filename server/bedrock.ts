import fs from "node:fs/promises";
import {
  BedrockRuntimeClient,
  ConverseCommand,
} from "@aws-sdk/client-bedrock-runtime";
import type { DiscoveryConfig } from "./discovery/config";
import { DiscoveryError } from "./discovery/errors";

export type CloudStage = "proposer" | "reviewer" | "preflight" | "learning" | "legacy";

function wait(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason || new DOMException("Aborted", "AbortError"));
      },
      { once: true },
    );
  });
}

export class GlobalCloudDispatcher {
  private chain: Promise<unknown> = Promise.resolve();
  private lastStart = 0;
  private starts: Record<"proposer" | "reviewer", number[]> = {
    proposer: [],
    reviewer: [],
  };

  constructor(private config: DiscoveryConfig) {}

  run<T>(stage: CloudStage, work: () => Promise<T>, signal?: AbortSignal) {
    const job = this.chain.then(async () => {
      if (signal?.aborted)
        throw signal.reason || new DOMException("Aborted", "AbortError");
      const now = Date.now();
      if (stage === "proposer" || stage === "reviewer") {
        const recent = this.starts[stage].filter((value) => now - value < 60_000);
        this.starts[stage] = recent;
        const limit =
          stage === "proposer"
            ? this.config.limits.proposerStartsPerMinute
            : this.config.limits.reviewerStartsPerMinute;
        if (recent.length >= limit)
          throw new DiscoveryError(
            "MODEL_RATE_LIMIT",
            `${stage} rolling start limit reached.`,
            429,
            true,
          );
      }
      const remaining =
        this.config.limits.minCloudStartSpacingMs - (Date.now() - this.lastStart);
      if (remaining > 0) await wait(remaining, signal);
      this.lastStart = Date.now();
      if (stage === "proposer" || stage === "reviewer")
        this.starts[stage].push(this.lastStart);
      return work();
    });
    this.chain = job.catch(() => undefined);
    return job;
  }
}

function toBearerJson(value: unknown): unknown {
  if (value instanceof Uint8Array || Buffer.isBuffer(value))
    return Buffer.from(value).toString("base64");
  if (Array.isArray(value)) return value.map(toBearerJson);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, toBearerJson(item)]),
    );
  return value;
}

async function credentialsFromFile(file: string | null) {
  if (!file) return undefined;
  const parsed = JSON.parse(await fs.readFile(file, "utf8"));
  const accessKeyId = parsed.AWS_ACCESS_KEY_ID;
  const secretAccessKey = parsed.AWS_SECRET_ACCESS_KEY;
  const sessionToken = parsed.AWS_SESSION_TOKEN;
  if (
    typeof accessKeyId !== "string" ||
    typeof secretAccessKey !== "string" ||
    (sessionToken !== undefined && typeof sessionToken !== "string")
  )
    throw new DiscoveryError(
      "CREDENTIALS_INVALID",
      "The configured credentials file is invalid.",
      503,
    );
  return { accessKeyId, secretAccessKey, sessionToken };
}

export class BedrockTransport {
  private clients = new Map<string, BedrockRuntimeClient>();
  private authCircuitOpen = false;

  constructor(private config: DiscoveryConfig) {}

  resetCircuit() {
    this.authCircuitOpen = false;
  }

  async converse(
    modelId: string,
    input: Record<string, any>,
    timeoutMs: number,
    signal?: AbortSignal,
  ) {
    if (this.authCircuitOpen)
      throw new DiscoveryError(
        "MODEL_AUTH_CIRCUIT_OPEN",
        "Model access is paused after an authentication failure. Run preflight after refreshing credentials.",
        503,
      );
    const timeout = AbortSignal.timeout(timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    try {
      if (process.env.AWS_BEARER_TOKEN_BEDROCK) {
        const response = await fetch(
          `https://bedrock-runtime.${this.config.region}.amazonaws.com/model/${encodeURIComponent(modelId)}/converse`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${process.env.AWS_BEARER_TOKEN_BEDROCK}`,
            },
            body: JSON.stringify(toBearerJson(input)),
            signal: combined,
          },
        );
        if (!response.ok) {
          const error = new Error("Bedrock request failed");
          error.name =
            response.status === 401 || response.status === 403
              ? "AccessDenied"
              : response.status === 429
                ? "Throttling"
                : "ServiceError";
          throw error;
        }
        return await response.json();
      }
      let client = this.clients.get(this.config.region);
      if (!client) {
        client = new BedrockRuntimeClient({
          region: this.config.region,
          maxAttempts: 1,
          credentials: await credentialsFromFile(this.config.credentialsFile),
        });
        this.clients.set(this.config.region, client);
      }
      return await client.send(new ConverseCommand({ modelId, ...input }), {
        abortSignal: combined,
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      if (/AccessDenied|Unrecognized|Expired|Credentials|Unauthorized/.test(name))
        this.authCircuitOpen = true;
      throw error;
    }
  }

  close() {
    for (const client of this.clients.values()) client.destroy();
    this.clients.clear();
  }
}

export function bedrockText(result: any) {
  return (result.output?.message?.content || [])
    .filter((content: any) => typeof content.text === "string")
    .map((content: any) => content.text)
    .join("\n");
}

export function bedrockToolUse(result: any, name: string) {
  const block = (result.output?.message?.content || []).find(
    (content: any) => content.toolUse?.name === name,
  );
  return block
    ? { toolUseId: String(block.toolUse.toolUseId), input: block.toolUse.input }
    : null;
}

export function bedrockUsage(result: any) {
  return {
    inputTokens:
      typeof result.usage?.inputTokens === "number"
        ? result.usage.inputTokens
        : null,
    outputTokens:
      typeof result.usage?.outputTokens === "number"
        ? result.usage.outputTokens
        : null,
    stopReason:
      typeof result.stopReason === "string" ? result.stopReason : null,
  };
}
