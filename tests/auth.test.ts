import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import { FileUserStore } from "../server/auth/fileStore";
import { SessionService } from "../server/auth/sessions";
import { createAuthRouter } from "../server/auth/router";

test("register, login, me, and logout use scoped session cookies", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-auth-test-"));
  const users = new FileUserStore(root);
  const sessions = new SessionService(users, false);
  const app = express();
  app.use(express.json({ limit: "32kb", strict: true }));
  app.use("/api/auth", createAuthRouter(users, sessions));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const call = (url: string, init: RequestInit = {}) =>
    fetch(`${origin}/api/auth${url}`, {
      ...init,
      headers: { Origin: origin, ...(init.headers || {}) },
    });
  try {
    const anonymous = await call("/me");
    assert.equal(anonymous.status, 401);

    const register = await call("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "learner@example.com",
        password: "secret-pass",
        displayName: "Learner",
      }),
    });
    assert.equal(register.status, 201);
    const registerCookie = register.headers.get("set-cookie")!.split(";")[0];
    const registered = await register.json();
    assert.equal(registered.user.email, "learner@example.com");

    const me = await call("/me", { headers: { Cookie: registerCookie } });
    assert.equal(me.status, 200);
    assert.equal((await me.json()).user.displayName, "Learner");

    await call("/logout", {
      method: "DELETE",
      headers: { Cookie: registerCookie },
    });
    const afterLogout = await call("/me", { headers: { Cookie: registerCookie } });
    assert.equal(afterLogout.status, 401);

    const duplicate = await call("/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "learner@example.com",
        password: "another-pass",
      }),
    });
    assert.equal(duplicate.status, 409);

    const login = await call("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "learner@example.com",
        password: "secret-pass",
      }),
    });
    assert.equal(login.status, 200);
    const loginCookie = login.headers.get("set-cookie")!.split(";")[0];
    const badLogin = await call("/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "learner@example.com",
        password: "wrong-pass",
      }),
    });
    assert.equal(badLogin.status, 401);

    const authed = await call("/me", { headers: { Cookie: loginCookie } });
    assert.equal(authed.status, 200);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await fs.rm(root, { recursive: true, force: true });
  }
});
