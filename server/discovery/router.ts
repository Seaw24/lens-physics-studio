import fs from "node:fs";
import fsPromises from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import Busboy from "busboy";
import { z } from "zod";
import {
  CreateSessionRequestSchema,
  GenerationRequestSchema,
  LIVE_SESSION_MAX_MS,
  PreflightRequestSchema,
} from "../../shared/discovery";
import {
  FeedbackRequestSchema,
  LessonUpdateSchema,
} from "../../shared/learning";
import { DiscoveryError, safeError } from "./errors";
import type { DiscoveryService } from "./service";

const authSchema = z.object({ code: z.string().min(1).max(512) }).strict();
const redeemSchema = z.object({ token: z.string().min(32).max(512) }).strict();
const listSessionsSchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(20),
  })
  .strict();
const phoneMetadataSchema = z
  .object({
    sessionId: z.string().uuid(),
    generation: z.number().int().positive(),
    batchId: z
      .string()
      .min(1)
      .max(160)
      .regex(/^[a-zA-Z0-9_-]+$/),
    timingMethod: z
      .enum(["requestVideoFrameCallback", "performanceNow"])
      .optional(),
    droppedBatches: z.number().int().min(0).max(1000).optional(),
    frames: z
      .array(
        z
          .object({
            frameId: z
              .string()
              .min(1)
              .max(160)
              .regex(/^[a-zA-Z0-9_-]+$/),
            seq: z.number().int().nonnegative(),
            sourceTimeMs: z
              .number()
              .int()
              .nonnegative()
              .max(LIVE_SESSION_MAX_MS),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
            partName: z
              .string()
              .min(1)
              .max(80)
              .regex(/^[a-zA-Z0-9_-]+$/),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict();

function asyncRoute(
  route: (req: Request, res: Response, next: NextFunction) => Promise<void>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    void route(req, res, next).catch(next);
  };
}

function limiter(limit: number, windowMs: number) {
  const buckets = new Map<string, { count: number; started: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    const key = req.ip || "local";
    const now = Date.now();
    let bucket = buckets.get(key);
    if (!bucket || now - bucket.started >= windowMs) {
      bucket = { count: 0, started: now };
      buckets.set(key, bucket);
    }
    bucket.count++;
    if (bucket.count > limit)
      return next(
        new DiscoveryError(
          "REQUEST_RATE_LIMIT",
          "Too many Discovery requests; retry shortly.",
          429,
          true,
        ),
      );
    next();
  };
}

function originAllowed(req: Request, service: DiscoveryService) {
  const raw = req.get("origin");
  if (!raw)
    return (
      ["GET", "HEAD", "OPTIONS"].includes(req.method) || !req.get("cookie")
    );
  try {
    const origin = new URL(raw);
    const allowed = service.config.publicOrigin
      ? new URL(service.config.publicOrigin)
      : null;
    return (
      origin.host === req.get("host") ||
      (allowed && origin.origin === allowed.origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin.origin)
    );
  } catch {
    return false;
  }
}

function requireIdempotency(req: Request) {
  const value = req.get("idempotency-key") || "";
  if (!/^[a-zA-Z0-9_-]{8,160}$/.test(value))
    throw new DiscoveryError(
      "IDEMPOTENCY_KEY_REQUIRED",
      "Provide an Idempotency-Key header (8–160 safe characters).",
      400,
    );
  return value;
}

function routeId(req: Request) {
  const value = req.params.id;
  return Array.isArray(value) ? value[0] : value;
}
function routeParam(req: Request, name: string) {
  const value = req.params[name];
  return Array.isArray(value) ? value[0] : value;
}

async function parseSourceUpload(req: Request, service: DiscoveryService) {
  if (!/^multipart\/form-data\b/i.test(req.get("content-type") || ""))
    throw new DiscoveryError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Source upload requires multipart/form-data.",
      415,
    );
  const session = service.store.get(routeId(req));
  const limit =
    session.sourceKind === "image"
      ? service.config.limits.stillBytes
      : service.config.limits.recordingBytes;
  const folder = path.join(service.store.sessionDir(session.id), "source");
  const tempPath = path.join(folder, `upload_${randomUUID()}.tmp`);
  return await new Promise<{
    tempPath: string;
    size: number;
    mimeType: string;
  }>((resolve, reject) => {
    let fileSeen = false;
    let size = 0;
    let mimeType = "application/octet-stream";
    let output: fs.WriteStream | null = null;
    let settled = false;
    const finish = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) {
        output?.destroy();
        void fsPromises.unlink(tempPath).catch(() => undefined);
        reject(error);
      } else if (!fileSeen) {
        reject(
          new DiscoveryError("SOURCE_REQUIRED", "One source file is required."),
        );
      } else resolve({ tempPath, size, mimeType });
    };
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: { files: 1, fields: 0, fileSize: limit, parts: 1 },
      });
    } catch {
      finish(
        new DiscoveryError(
          "INVALID_MULTIPART",
          "The multipart source upload is invalid.",
        ),
      );
      return;
    }
    parser.on("file", (_name, stream, info) => {
      if (fileSeen) {
        stream.resume();
        return;
      }
      fileSeen = true;
      mimeType = info.mimeType;
      output = fs.createWriteStream(tempPath, { flags: "wx", mode: 0o600 });
      stream.on("data", (chunk: Buffer) => (size += chunk.length));
      stream.on("limit", () =>
        finish(
          new DiscoveryError(
            "SOURCE_TOO_LARGE",
            "The uploaded source exceeds its configured limit.",
            413,
          ),
        ),
      );
      stream.pipe(output);
      output.on("error", finish);
    });
    parser.on("filesLimit", () =>
      finish(
        new DiscoveryError("TOO_MANY_FILES", "Upload exactly one file.", 413),
      ),
    );
    parser.on("error", finish);
    parser.on("finish", () => {
      if (!output || output.closed) finish();
      else output.once("close", () => finish());
    });
    req.on("aborted", () => finish(new Error("Upload aborted")));
    req.pipe(parser);
  });
}

async function parsePhoneBatch(req: Request) {
  if (!/^multipart\/form-data\b/i.test(req.get("content-type") || ""))
    throw new DiscoveryError(
      "UNSUPPORTED_MEDIA_TYPE",
      "Phone frame upload requires multipart/form-data.",
      415,
    );
  return await new Promise<{
    metadata: z.infer<typeof phoneMetadataSchema>;
    parts: Array<{ partName: string; bytes: Buffer; mimeType: string }>;
  }>((resolve, reject) => {
    const parts: Array<{ partName: string; bytes: Buffer; mimeType: string }> =
      [];
    let metadataText = "";
    let total = 0;
    let settled = false;
    const done = (error?: unknown) => {
      if (settled) return;
      settled = true;
      if (error) return reject(error);
      try {
        resolve({
          metadata: phoneMetadataSchema.parse(JSON.parse(metadataText)),
          parts,
        });
      } catch {
        reject(
          new DiscoveryError(
            "INVALID_FRAME_METADATA",
            "Phone frame metadata is invalid.",
          ),
        );
      }
    };
    let parser: ReturnType<typeof Busboy>;
    try {
      parser = Busboy({
        headers: req.headers,
        limits: {
          files: 8,
          fields: 1,
          fileSize: 300 * 1024,
          fieldSize: 16 * 1024,
          parts: 9,
        },
      });
    } catch {
      done(new DiscoveryError("INVALID_MULTIPART", "Invalid phone batch."));
      return;
    }
    parser.on("field", (name, value) => {
      if (name === "metadata") metadataText = value;
    });
    parser.on("file", (partName, stream, info) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      stream.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        total += chunk.length;
        chunks.push(chunk);
        if (total > 2_500_000)
          done(
            new DiscoveryError(
              "FRAME_BATCH_TOO_LARGE",
              "Phone batch exceeds 2.5 MB.",
              413,
            ),
          );
      });
      stream.on("limit", () =>
        done(
          new DiscoveryError(
            "FRAME_TOO_LARGE",
            "One phone frame exceeds 300 KiB.",
            413,
          ),
        ),
      );
      stream.on("end", () =>
        parts.push({
          partName,
          bytes: Buffer.concat(chunks, bytes),
          mimeType: info.mimeType,
        }),
      );
    });
    parser.on("error", done);
    parser.on("finish", () => done());
    req.pipe(parser);
  });
}

export function createDiscoveryRouter(service: DiscoveryService) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!originAllowed(req, service))
      return next(
        new DiscoveryError(
          "ORIGIN_DENIED",
          "Discovery accepts requests only from its configured origin.",
          403,
        ),
      );
    next();
  });

  const smallJson = express.json({ limit: "32kb", strict: true });
  router.post(
    "/auth",
    limiter(6, 60_000),
    smallJson,
    asyncRoute(async (req, res) => {
      const body = authSchema.parse(req.body);
      service.auth.login(body.code, res);
      res.json({ authenticated: true });
    }),
  );
  router.delete(
    "/auth",
    asyncRoute(async (req, res) => {
      service.auth.logout(req, res);
      res.status(204).end();
    }),
  );
  router.post(
    "/pair/redeem",
    limiter(10, 60_000),
    smallJson,
    asyncRoute(async (req, res) => {
      const { token } = redeemSchema.parse(req.body);
      const grant = service.auth.redeemPairing(token, res);
      res.json({
        paired: true,
        sessionId: grant.sessionId,
        generation: grant.generation,
      });
    }),
  );

  router.post(
    "/sessions/:id/frames",
    limiter(300, 60_000),
    asyncRoute(async (req, res) => {
      service.auth.requirePhone(req, routeId(req));
      const parsed = await parsePhoneBatch(req);
      if (parsed.metadata.sessionId !== routeId(req))
        throw new DiscoveryError(
          "PHONE_SCOPE_DENIED",
          "Batch session does not match the request path.",
          403,
        );
      service.auth.requirePhone(req, routeId(req), parsed.metadata.generation);
      res.json(await service.ingestPhoneBatch(parsed.metadata, parsed.parts));
    }),
  );
  router.post(
    "/sessions/:id/heartbeat",
    limiter(180, 60_000),
    smallJson,
    asyncRoute(async (req, res) => {
      const { generation } = GenerationRequestSchema.parse(req.body);
      service.auth.requirePhone(req, routeId(req), generation);
      res.json(await service.heartbeat(routeId(req), generation));
    }),
  );
  router.post(
    "/sessions/:id/capture-stop",
    limiter(30, 60_000),
    smallJson,
    asyncRoute(async (req, res) => {
      const { generation } = GenerationRequestSchema.parse(req.body);
      service.auth.requirePhone(req, routeId(req), generation);
      res.json(await service.stop(routeId(req), generation));
    }),
  );
  router.get(
    "/sessions/:id/capture-status",
    limiter(180, 60_000),
    asyncRoute(async (req, res) => {
      service.auth.requirePhone(req, routeId(req));
      res.json(service.captureStatus(routeId(req)));
    }),
  );

  router.use((req, _res, next) => {
    service.auth.requireController(req);
    next();
  });
  // A camera attached to the laptop uses controller auth; phone cookies stay scoped.
  // This shares the existing frame validation and pipeline without relaxing /frames.
  router.post(
    "/sessions/:id/desktop-frames",
    limiter(300, 60_000),
    asyncRoute(async (req, res) => {
      const parsed = await parsePhoneBatch(req);
      if (parsed.metadata.sessionId !== routeId(req))
        throw new DiscoveryError(
          "CAPTURE_SCOPE_DENIED",
          "Batch session does not match the request path.",
          403,
        );
      res.json(await service.ingestPhoneBatch(parsed.metadata, parsed.parts));
    }),
  );
  router.get("/config", (_req, res) => res.json(service.getConfig()));
  router.post(
    "/preflight",
    smallJson,
    asyncRoute(async (req, res) => {
      const { invoke } = PreflightRequestSchema.parse(req.body);
      res.json(await service.preflight(invoke));
    }),
  );
  router.post(
    "/sessions",
    smallJson,
    asyncRoute(async (req, res) => {
      const body = CreateSessionRequestSchema.parse(req.body);
      res
        .status(201)
        .json(await service.createSession(body, requireIdempotency(req)));
    }),
  );
  router.get("/sessions", (req, res) => {
    const query = listSessionsSchema.parse(req.query);
    res.json(service.listSessions(query.cursor, query.limit));
  });
  router.get(
    "/sessions/:id",
    asyncRoute(async (req, res) => {
      const after = req.query.afterRevision;
      const revision =
        typeof after === "string" && /^\d+$/.test(after)
          ? Number(after)
          : undefined;
      res.json(service.getSession(routeId(req), revision));
    }),
  );
  router.post(
    "/sessions/:id/source",
    asyncRoute(async (req, res) => {
      const upload = await parseSourceUpload(req, service);
      res.json(await service.uploadSource(routeId(req), upload));
    }),
  );
  for (const action of ["start", "pause", "resume", "stop", "cancel"] as const)
    router.post(
      `/sessions/:id/${action}`,
      smallJson,
      asyncRoute(async (req, res) => {
        const { generation } = GenerationRequestSchema.parse(req.body);
        res.json(await service[action](routeId(req), generation));
      }),
    );
  router.post(
    "/sessions/:id/pair",
    smallJson,
    asyncRoute(async (req, res) => {
      const { generation } = GenerationRequestSchema.parse(req.body);
      const session = service.store.get(routeId(req));
      if (session.generation !== generation)
        throw new DiscoveryError(
          "GENERATION_CONFLICT",
          "The session generation has changed.",
          409,
        );
      res.json(await service.pair(routeId(req)));
    }),
  );
  router.delete(
    "/sessions/:id",
    asyncRoute(async (req, res) => {
      await service.delete(routeId(req));
      res.status(204).end();
    }),
  );
  router.get(
    "/events/:id",
    asyncRoute(async (req, res) => {
      res.json(await service.getEvent(routeId(req)));
    }),
  );
  const sendAsset = asyncRoute(async (req, res) => {
    const { asset, path: file } = service.findAsset(routeId(req));
    const stat = await fsPromises.stat(file);
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("ETag", `"${asset.sha256}"`);
    res.setHeader("Content-Disposition", "inline");
    const range = req.get("range");
    if (!range) {
      res.setHeader("Content-Length", stat.size);
      if (req.method === "HEAD") return void res.end();
      fs.createReadStream(file).pipe(res);
      return;
    }
    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match)
      throw new DiscoveryError("INVALID_RANGE", "Invalid byte range.", 416);
    let start = match[1] ? Number(match[1]) : 0;
    let end = match[2] ? Number(match[2]) : stat.size - 1;
    if (!match[1] && match[2]) {
      const suffix = Number(match[2]);
      start = Math.max(0, stat.size - suffix);
      end = stat.size - 1;
    }
    if (
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      start >= stat.size
    )
      throw new DiscoveryError("INVALID_RANGE", "Invalid byte range.", 416);
    end = Math.min(end, stat.size - 1);
    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${stat.size}`);
    res.setHeader("Content-Length", end - start + 1);
    if (req.method === "HEAD") return void res.end();
    fs.createReadStream(file, { start, end }).pipe(res);
  });
  // Review cards: what Nova proposed, what Sonnet decided, and the frames both saw.
  router.get(
    "/sessions/:id/candidates/:candidateId",
    asyncRoute(async (req, res) => {
      res.json(
        await service.candidateDetail(
          routeId(req),
          routeParam(req, "candidateId"),
        ),
      );
    }),
  );
  router.get(
    "/sessions/:id/candidates/:candidateId/frames/:index",
    asyncRoute(async (req, res) => {
      const file = await service.candidateFramePath(
        routeId(req),
        routeParam(req, "candidateId"),
        Number(routeParam(req, "index")),
      );
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      fs.createReadStream(file).pipe(res);
    }),
  );
  router.post(
    "/sessions/:id/candidates/:candidateId/feedback",
    limiter(120, 60_000),
    smallJson,
    asyncRoute(async (req, res) => {
      const body = FeedbackRequestSchema.parse(req.body);
      res.json(
        await service.saveFeedback(
          routeId(req),
          routeParam(req, "candidateId"),
          body,
        ),
      );
    }),
  );
  router.get("/learning", (_req, res) => res.json(service.learningOverview()));
  router.post(
    "/learning/lessons/draft",
    limiter(6, 60_000),
    asyncRoute(async (_req, res) => {
      res.json(await service.draftLessons());
    }),
  );
  router.post(
    "/learning/lessons/:id",
    smallJson,
    asyncRoute(async (req, res) => {
      const body = LessonUpdateSchema.parse(req.body);
      res.json(
        await service.updateLesson(routeId(req), body.action, body.text),
      );
    }),
  );
  router.post(
    "/learning/lessons/:id/check",
    limiter(3, 60_000),
    asyncRoute(async (req, res) => {
      res.json(await service.checkLesson(routeId(req)));
    }),
  );
  router.get("/assets/:id", sendAsset);
  router.head("/assets/:id", sendAsset);
  router.use((_req, _res, next) =>
    next(
      new DiscoveryError("NOT_FOUND", "Discovery API route not found.", 404),
    ),
  );
  router.use(
    (error: unknown, req: Request, res: Response, _next: NextFunction) => {
      if (error instanceof z.ZodError) {
        res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "The Discovery request did not match the required schema.",
            retryable: false,
          },
        });
        return;
      }
      const safe = safeError(error);
      // Clients only see a generic message for unexpected failures; keep the cause in the server log.
      if (safe.status >= 500)
        console.error(
          `Discovery ${req.method} ${req.path} -> ${safe.status}`,
          error,
        );
      res.status(safe.status).json(safe.body);
    },
  );
  return router;
}
