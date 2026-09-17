import { randomBytes, randomUUID, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { PublicUser } from "../../shared/auth";
import { AuthError } from "./errors";

const scryptAsync = promisify(scrypt);

export interface StoredUser {
  id: string;
  email: string;
  displayName: string;
  passwordHash: string;
  passwordSalt: string;
  createdAt: string;
}

export interface UserStore {
  register(input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<PublicUser>;
  verifyLogin(email: string, password: string): Promise<PublicUser>;
  findById(id: string): Promise<PublicUser | null>;
}

export function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

export function displayNameFromEmail(email: string) {
  const local = email.split("@")[0] || "Learner";
  return local.slice(0, 1).toUpperCase() + local.slice(1, 80);
}

export function toPublicUser(user: StoredUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

export async function hashPassword(password: string, salt: string) {
  const derived = (await scryptAsync(password, salt, 64)) as Buffer;
  return derived.toString("hex");
}

export async function createStoredUser(input: {
  email: string;
  password: string;
  displayName?: string;
}): Promise<StoredUser> {
  const email = normalizeEmail(input.email);
  const salt = randomBytes(16).toString("hex");
  const passwordHash = await hashPassword(input.password, salt);
  return {
    id: randomUUID(),
    email,
    displayName: input.displayName?.trim() || displayNameFromEmail(email),
    passwordHash,
    passwordSalt: salt,
    createdAt: new Date().toISOString(),
  };
}

export async function verifyStoredUserPassword(
  user: StoredUser,
  password: string,
): Promise<PublicUser> {
  const hash = await hashPassword(password, user.passwordSalt);
  const valid =
    hash.length === user.passwordHash.length &&
    timingSafeEqual(Buffer.from(hash), Buffer.from(user.passwordHash));
  if (!valid)
    throw new AuthError(
      "INVALID_CREDENTIALS",
      "Email or password is incorrect.",
      401,
    );
  return toPublicUser(user);
}
