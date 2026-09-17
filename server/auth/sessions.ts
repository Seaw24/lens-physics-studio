import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import type { PublicUser } from "../../shared/auth";
import { AuthError } from "./errors";
import type { UserStore } from "./userCredentials";

const sessionCookie = "lens_user_session";
const sessionMs = 7 * 24 * 60 * 60_000;

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function cookies(req: Request) {
  return Object.fromEntries(
    (req.get("cookie") || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter((part) => part.length === 2)
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

export class SessionService {
  private sessions = new Map<string, { userId: string; expiresAt: number }>();

  constructor(
    private users: UserStore,
    private secureCookies: boolean,
  ) {}

  private cookieOptions() {
    return {
      httpOnly: true,
      sameSite: "strict" as const,
      secure: this.secureCookies,
      path: "/api",
      maxAge: sessionMs,
    };
  }

  issue(user: PublicUser, res: Response) {
    const token = randomBytes(32).toString("base64url");
    this.sessions.set(hash(token), {
      userId: user.id,
      expiresAt: Date.now() + sessionMs,
    });
    res.cookie(sessionCookie, token, this.cookieOptions());
    return user;
  }

  logout(req: Request, res: Response) {
    const token = cookies(req)[sessionCookie];
    if (token) this.sessions.delete(hash(token));
    res.clearCookie(sessionCookie, this.cookieOptions());
  }

  async requireUser(req: Request): Promise<PublicUser> {
    const token = cookies(req)[sessionCookie];
    const grant = token ? this.sessions.get(hash(token)) : undefined;
    if (!grant || grant.expiresAt <= Date.now()) {
      if (token) this.sessions.delete(hash(token));
      throw new AuthError("AUTH_REQUIRED", "Sign in required.", 401);
    }
    const user = await this.users.findById(grant.userId);
    if (!user) {
      this.sessions.delete(hash(token!));
      throw new AuthError("AUTH_REQUIRED", "Sign in required.", 401);
    }
    return user;
  }

  async optionalUser(req: Request): Promise<PublicUser | null> {
    try {
      return await this.requireUser(req);
    } catch (error) {
      if (error instanceof AuthError && error.code === "AUTH_REQUIRED") return null;
      throw error;
    }
  }
}
