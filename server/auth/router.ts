import express, {
  type NextFunction,
  type Request,
  type Response,
} from "express";
import {
  LoginRequestSchema,
  PublicUserSchema,
  RegisterRequestSchema,
} from "../../shared/auth";
import { AuthError, safeAuthError } from "./errors";
import type { SessionService } from "./sessions";
import type { UserStore } from "./userCredentials";

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
        new AuthError(
          "REQUEST_RATE_LIMIT",
          "Too many attempts; retry shortly.",
          429,
        ),
      );
    next();
  };
}

export function createAuthRouter(
  users: UserStore,
  sessions: SessionService,
) {
  const router = express.Router();
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });

  router.post(
    "/register",
    limiter(12, 60_000),
    asyncRoute(async (req, res) => {
      const body = RegisterRequestSchema.parse(req.body);
      const user = await users.register(body);
      res
        .status(201)
        .json({ user: PublicUserSchema.parse(sessions.issue(user, res)) });
    }),
  );

  router.post(
    "/login",
    limiter(12, 60_000),
    asyncRoute(async (req, res) => {
      const body = LoginRequestSchema.parse(req.body);
      const user = await users.verifyLogin(body.email, body.password);
      res.json({ user: PublicUserSchema.parse(sessions.issue(user, res)) });
    }),
  );

  router.delete(
    "/logout",
    asyncRoute(async (req, res) => {
      sessions.logout(req, res);
      res.status(204).end();
    }),
  );

  router.get(
    "/me",
    asyncRoute(async (req, res) => {
      const user = await sessions.requireUser(req);
      res.json({ user: PublicUserSchema.parse(user) });
    }),
  );

  router.use(
    (
      error: unknown,
      _req: Request,
      res: Response,
      next: NextFunction,
    ) => {
      if (res.headersSent) return next(error);
      const safe = safeAuthError(error);
      res.status(safe.status).json(safe.body);
    },
  );

  return router;
}
