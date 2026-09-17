import fs from "node:fs/promises";
import path from "node:path";
import type { PublicUser } from "../../shared/auth";
import { AuthError } from "./errors";
import {
  createStoredUser,
  toPublicUser,
  type StoredUser,
  type UserStore,
  verifyStoredUserPassword,
} from "./userCredentials";

interface UserDatabase {
  users: StoredUser[];
}

export class FileUserStore implements UserStore {
  private filePath: string;
  private cache: UserDatabase | null = null;

  constructor(root = path.resolve(".runtime/users")) {
    this.filePath = path.join(root, "users.json");
  }

  private async read(): Promise<UserDatabase> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = JSON.parse(raw) as UserDatabase;
      this.cache = { users: Array.isArray(parsed.users) ? parsed.users : [] };
    } catch (error: any) {
      if (error?.code === "ENOENT") this.cache = { users: [] };
      else throw error;
    }
    return this.cache!;
  }

  private async write(db: UserDatabase) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(db, null, 2), "utf8");
    this.cache = db;
  }

  async register(input: {
    email: string;
    password: string;
    displayName?: string;
  }): Promise<PublicUser> {
    const user = await createStoredUser(input);
    const db = await this.read();
    if (db.users.some((entry) => entry.email === user.email))
      throw new AuthError(
        "EMAIL_IN_USE",
        "An account with this email already exists.",
        409,
      );
    db.users.push(user);
    await this.write(db);
    return toPublicUser(user);
  }

  async verifyLogin(email: string, password: string): Promise<PublicUser> {
    const db = await this.read();
    const user = db.users.find(
      (entry) => entry.email === email.trim().toLowerCase(),
    );
    if (!user)
      throw new AuthError(
        "INVALID_CREDENTIALS",
        "Email or password is incorrect.",
        401,
      );
    return verifyStoredUserPassword(user, password);
  }

  async findById(id: string): Promise<PublicUser | null> {
    const db = await this.read();
    const user = db.users.find((entry) => entry.id === id);
    return user ? toPublicUser(user) : null;
  }
}
