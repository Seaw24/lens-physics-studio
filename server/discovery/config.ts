import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ffmpegStatic from "ffmpeg-static";
import { LIVE_SESSION_MAX_MS } from "../../shared/discovery";

const require = createRequire(import.meta.url);
const bundledFfprobe = (require("ffprobe-static") as { path?: string }).path;

export interface DiscoveryConfig {
  enabled: boolean;
  region: string;
  proposerModelId: string;
  reviewerModelId: string;
  /** Writes learned lessons; a different model from the reviewer so Sonnet does not write its own rules. */
  drafterModelId: string;
  accessCode: string;
  accessCodeGenerated: boolean;
  controllerBearerToken: string | null;
  credentialsFile: string | null;
  bindHost: string;
  publicOrigin: string | null;
  tlsCert: string | null;
  tlsKey: string | null;
  secureCookies: boolean;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  runtimeRoot: string;
  limits: {
    captureFps: number;
    activityFps: number;
    modelFps: number;
    windowMs: number;
    strideMs: number;
    periodicMs: number;
    minActivityProposalSpacingMs: number;
    minCloudStartSpacingMs: number;
    proposerTimeoutMs: number;
    reviewerTimeoutMs: number;
    proposerMaxTokens: number;
    reviewerMaxTokens: number;
    proposerAttempts: number;
    reviewerAttempts: number;
    combinedAttempts: number;
    proposerStartsPerMinute: number;
    reviewerStartsPerMinute: number;
    reviewQueue: number;
    reviewExpiryMs: number;
    phoneSessionMs: number;
    recordingBytes: number;
    recordingMs: number;
    stillBytes: number;
    stillPixels: number;
    storageBytes: number;
    retentionMs: number;
    maxCaptureGapMs: number;
    buildEvaluationCalls: number;
  };
}

function configuredExecutable(
  value: string | undefined,
  fallback?: string | null,
) {
  const candidate = value ? path.resolve(value) : fallback;
  if (!candidate) return null;
  try {
    fs.accessSync(candidate, fs.constants.X_OK);
    return candidate;
  } catch {
    return null;
  }
}

export function loadDiscoveryConfig(
  env: NodeJS.ProcessEnv = process.env,
  root = path.resolve(".runtime/discovery"),
): DiscoveryConfig {
  const configuredCode = env.DISCOVERY_ACCESS_CODE?.trim();
  const accessCode = configuredCode || randomBytes(32).toString("base64url");
  // A short shared code is allowed for team demos; login stays rate-limited to 6 tries a minute.
  if (Buffer.byteLength(accessCode) < 4)
    throw new Error("DISCOVERY_ACCESS_CODE must contain at least 4 characters.");
  const bindHost = env.DISCOVERY_BIND_HOST || "127.0.0.1";
  const tlsCert = env.DISCOVERY_TLS_CERT
    ? path.resolve(env.DISCOVERY_TLS_CERT)
    : null;
  const tlsKey = env.DISCOVERY_TLS_KEY
    ? path.resolve(env.DISCOVERY_TLS_KEY)
    : null;
  if (Boolean(tlsCert) !== Boolean(tlsKey))
    throw new Error(
      "DISCOVERY_TLS_CERT and DISCOVERY_TLS_KEY must be set together.",
    );
  if (bindHost === "0.0.0.0" && (!tlsCert || !tlsKey))
    throw new Error(
      "LAN Discovery binding requires both TLS certificate and key.",
    );
  return {
    enabled: env.DISCOVERY_ENABLED !== "false",
    region: env.AWS_REGION || "us-east-1",
    proposerModelId: env.DISCOVERY_PROPOSER_MODEL_ID || "amazon.nova-lite-v1:0",
    reviewerModelId:
      env.DISCOVERY_REVIEWER_MODEL_ID || "us.anthropic.claude-opus-4-6-v1",
    drafterModelId:
      env.DISCOVERY_DRAFTER_MODEL_ID || "us.anthropic.claude-opus-4-6-v1",
    accessCode,
    accessCodeGenerated: !configuredCode,
    controllerBearerToken: env.DISCOVERY_CONTROLLER_BEARER_TOKEN || null,
    credentialsFile: env.DISCOVERY_CREDENTIALS_FILE
      ? path.resolve(env.DISCOVERY_CREDENTIALS_FILE)
      : null,
    bindHost,
    publicOrigin: env.DISCOVERY_PUBLIC_ORIGIN || null,
    tlsCert,
    tlsKey,
    secureCookies: bindHost !== "127.0.0.1" && bindHost !== "localhost",
    ffmpegPath: configuredExecutable(env.FFMPEG_PATH, ffmpegStatic),
    ffprobePath: configuredExecutable(env.FFPROBE_PATH, bundledFfprobe),
    runtimeRoot: path.resolve(env.DISCOVERY_RUNTIME_ROOT || root),
    limits: {
      captureFps: 8,
      activityFps: 4,
      modelFps: 2,
      windowMs: 6_000,
      strideMs: 3_000,
      periodicMs: 12_000,
      minActivityProposalSpacingMs: 6_000,
      minCloudStartSpacingMs: 1_300,
      proposerTimeoutMs: 30_000,
      // Opus judging with written analysis takes ~30 s and ~1.2k output tokens.
      reviewerTimeoutMs: 90_000,
      proposerMaxTokens: 1_200,
      reviewerMaxTokens: 3_000,
      // Per-session call budgets are effectively unlimited while tuning;
      // cost is bounded by session length and one-call-at-a-time dispatch.
      proposerAttempts: 10_000,
      reviewerAttempts: 10_000,
      combinedAttempts: 20_000,
      proposerStartsPerMinute: 30,
      reviewerStartsPerMinute: 30,
      reviewQueue: 4,
      reviewExpiryMs: 120_000,
      phoneSessionMs: LIVE_SESSION_MAX_MS,
      recordingBytes: 500 * 1024 * 1024,
      recordingMs: 30 * 60_000,
      stillBytes: 10 * 1024 * 1024,
      stillPixels: 40_000_000,
      storageBytes: 2 * 1024 * 1024 * 1024,
      retentionMs: 24 * 60 * 60_000,
      maxCaptureGapMs: 500,
      buildEvaluationCalls: 80,
    },
  };
}

export function safeDiscoveryConfig(config: DiscoveryConfig) {
  return {
    enabled: config.enabled,
    region: config.region,
    proposerModelId: config.proposerModelId,
    reviewerModelId: config.reviewerModelId,
    drafterModelId: config.drafterModelId,
    bindHost: config.bindHost,
    publicOrigin: config.publicOrigin,
    secureContextRequired: config.bindHost === "0.0.0.0",
    accessCodeGenerated: config.accessCodeGenerated,
    dependencies: {
      ffmpeg: Boolean(config.ffmpegPath),
      ffprobe: Boolean(config.ffprobePath),
      credentials: Boolean(
        config.credentialsFile ||
        process.env.AWS_ACCESS_KEY_ID ||
        process.env.AWS_PROFILE ||
        process.env.AWS_BEARER_TOKEN_BEDROCK ||
        process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI ||
        process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI ||
        process.env.AWS_WEB_IDENTITY_TOKEN_FILE,
      ),
    },
    limits: config.limits,
  };
}
