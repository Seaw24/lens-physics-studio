import fs from "node:fs";
import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { DiscoveryError, safeError } from "../discovery/errors";
import type { StudioService } from "./service";
import { AuthError, safeAuthError } from "../auth/errors";
import type { SessionService } from "../auth/sessions";

function asyncRoute(route: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response, next: NextFunction) => {
    void route(req, res).catch(next);
  };
}

function eventId(req: Request) {
  const value = req.params.id;
  const id = Array.isArray(value) ? value[0] : value;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id ?? ""))
    throw new DiscoveryError("INVALID_ID", "Invalid event identifier.", 400);
  return id;
}

function originAllowed(req: Request, publicOrigin: string | null) {
  const raw = req.get("origin");
  if (!raw) return ["GET", "HEAD"].includes(req.method) || !req.get("cookie");
  try {
    const origin = new URL(raw);
    return (
      origin.host === req.get("host") ||
      (publicOrigin !== null && origin.origin === new URL(publicOrigin).origin) ||
      /^http:\/\/(localhost|127\.0\.0\.1):5173$/.test(origin.origin)
    );
  } catch {
    return false;
  }
}

const generateSchema = z.object({ force: z.boolean().default(false) }).strict();

export function createStudioRouter(
  studio: StudioService,
  userSessions: SessionService,
) {
  const router = express.Router();
  router.use((req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!originAllowed(req, studio.discovery.config.publicOrigin))
      return next(new DiscoveryError("ORIGIN_DENIED", "Studio accepts requests only from its own interface.", 403));
    next();
  });
  router.get(
    "/day",
    asyncRoute(async (req, res) => {
      const user = await userSessions.requireUser(req);
      res.json(await studio.day(user.id));
    }),
  );
  router.get(
    "/events/:id",
    asyncRoute(async (req, res) => {
      const user = await userSessions.requireUser(req);
      res.json(await studio.event(eventId(req), true, user.id));
    }),
  );
  router.post(
    "/events/:id/generate",
    express.json({ limit: "4kb", strict: true }),
    asyncRoute(async (req, res) => {
      const user = await userSessions.requireUser(req);
      const { force } = generateSchema.parse(req.body ?? {});
      res.json(await studio.generate(eventId(req), force, user.id));
    }),
  );
  router.get(
    "/events/:id/poster",
    asyncRoute(async (req, res) => {
      const user = await userSessions.requireUser(req);
      const file = await studio.poster(eventId(req), user.id);
      res.setHeader("Content-Type", "image/jpeg");
      res.setHeader("Cache-Control", "private, max-age=120");
      fs.createReadStream(file).pipe(res);
    }),
  );
  router.use((_req, _res, next) => next(new DiscoveryError("NOT_FOUND", "Studio API route not found.", 404)));
  router.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: { code: "INVALID_REQUEST", message: "The studio request did not match the schema.", retryable: false },
      });
      return;
    }
    const safeAuth = safeAuthError(error);
    if (error instanceof AuthError) {
      res.status(safeAuth.status).json(safeAuth.body);
      return;
    }
    const safe = safeError(error);
    if (safe.status >= 500) console.error(`Studio ${req.method} ${req.path} -> ${safe.status}`, error);
    res.status(safe.status).json(safe.body);
  });
  return router;
}
