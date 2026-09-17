import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import type { DiscoveryConfig } from "./config";
import { DiscoveryError } from "./errors";

type PhoneGrant = { sessionId: string; generation: number; expiresAt: number };
const controllerCookie = "lens_discovery_controller";
const phoneCookie = "lens_discovery_phone";

function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function equalSecret(actual: string, expected: string) {
  const a = Buffer.from(actual);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
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

export class DiscoveryAuth {
  private controllers = new Map<string, number>();
  private pairing = new Map<string, PhoneGrant>();
  private phones = new Map<string, PhoneGrant>();

  constructor(private config: DiscoveryConfig) {}

  login(code: string, res: Response) {
    if (!equalSecret(code, this.config.accessCode))
      throw new DiscoveryError("AUTH_FAILED", "Invalid access code.", 401);
    const token = randomBytes(32).toString("base64url");
    this.controllers.set(hash(token), Date.now() + 8 * 60 * 60_000);
    res.cookie(controllerCookie, token, {
      httpOnly: true,
      sameSite: "strict",
      secure: this.config.secureCookies,
      path: "/api/discovery",
      maxAge: 8 * 60 * 60_000,
    });
  }

  logout(req: Request, res: Response) {
    const token = cookies(req)[controllerCookie];
    if (token) this.controllers.delete(hash(token));
    res.clearCookie(controllerCookie, {
      httpOnly: true,
      sameSite: "strict",
      secure: this.config.secureCookies,
      path: "/api/discovery",
    });
  }

  requireController(req: Request) {
    const bearer = /^Bearer\s+(.+)$/i.exec(req.get("authorization") || "")?.[1];
    if (
      bearer &&
      this.config.controllerBearerToken &&
      equalSecret(bearer, this.config.controllerBearerToken)
    )
      return;
    const token = cookies(req)[controllerCookie];
    const expires = token ? this.controllers.get(hash(token)) : undefined;
    if (!expires || expires <= Date.now()) {
      if (token) this.controllers.delete(hash(token));
      throw new DiscoveryError("AUTH_REQUIRED", "Controller login required.", 401);
    }
  }

  issuePairing(sessionId: string, generation: number) {
    const token = randomBytes(32).toString("base64url");
    const grant = { sessionId, generation, expiresAt: Date.now() + 120_000 };
    this.pairing.set(hash(token), grant);
    const origin = this.config.publicOrigin || "https://localhost";
    return {
      token,
      expiresAt: new Date(grant.expiresAt).toISOString(),
      url: `${origin.replace(/\/$/, "")}/capture#pair=${encodeURIComponent(token)}`,
    };
  }

  redeemPairing(token: string, res: Response) {
    const key = hash(token);
    const grant = this.pairing.get(key);
    this.pairing.delete(key);
    if (!grant || grant.expiresAt <= Date.now())
      throw new DiscoveryError(
        "PAIR_TOKEN_INVALID",
        "The pairing link is invalid or expired.",
        401,
      );
    const phoneToken = randomBytes(32).toString("base64url");
    this.phones.set(hash(phoneToken), {
      ...grant,
      expiresAt: Date.now() + this.config.limits.phoneSessionMs + 120_000,
    });
    res.cookie(phoneCookie, phoneToken, {
      httpOnly: true,
      sameSite: "strict",
      secure: true,
      path: "/api/discovery",
      maxAge: this.config.limits.phoneSessionMs + 120_000,
    });
    return grant;
  }

  requirePhone(req: Request, sessionId: string, generation?: number) {
    const token = cookies(req)[phoneCookie];
    const grant = token ? this.phones.get(hash(token)) : undefined;
    if (
      !grant ||
      grant.expiresAt <= Date.now() ||
      grant.sessionId !== sessionId ||
      (generation !== undefined && grant.generation !== generation)
    )
      throw new DiscoveryError(
        "PHONE_SCOPE_DENIED",
        "Phone capture authorization is missing or expired.",
        403,
      );
    return grant;
  }

  revokeSession(sessionId: string) {
    for (const [key, grant] of this.pairing)
      if (grant.sessionId === sessionId) this.pairing.delete(key);
    for (const [key, grant] of this.phones)
      if (grant.sessionId === sessionId) this.phones.delete(key);
  }
}
