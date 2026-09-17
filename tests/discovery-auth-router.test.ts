import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import express from "express";
import sharp from "sharp";
import { createHash } from "node:crypto";
import { loadDiscoveryConfig } from "../server/discovery/config";
import { DiscoveryService } from "../server/discovery/service";
import { createDiscoveryRouter } from "../server/discovery/router";

test("controller and phone scopes, one-time pairing, idempotency, and frame integrity are enforced", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lens-router-test-"));
  const accessCode = "controller-access-code-32-bytes-minimum";
  const config = loadDiscoveryConfig(
    {
      DISCOVERY_ACCESS_CODE: accessCode,
      DISCOVERY_PUBLIC_ORIGIN: "https://192.168.1.20:8787",
    },
    path.join(root, "runtime"),
  );
  config.limits.minCloudStartSpacingMs = 0;
  const service = await DiscoveryService.create(config);
  const app = express();
  app.use("/api/discovery", createDiscoveryRouter(service));
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const origin = `http://127.0.0.1:${address.port}`;
  const call = (url: string, init: RequestInit = {}) =>
    fetch(`${origin}/api/discovery${url}`, {
      ...init,
      headers: { Origin: origin, ...(init.headers || {}) },
    });
  try {
    const unauthenticated = await call("/sessions");
    assert.equal(unauthenticated.status, 401);
    const login = await call("/auth", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: accessCode }),
    });
    assert.equal(login.status, 200);
    const controllerCookie = login.headers.get("set-cookie")!.split(";")[0];
    const createBody = JSON.stringify({ sourceKind: "phone", mode: "live" });
    const created = await call("/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: controllerCookie,
        "Idempotency-Key": "router_test_key_123",
      },
      body: createBody,
    });
    assert.equal(created.status, 201);
    const session = await created.json();
    const replay = await call("/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: controllerCookie,
        "Idempotency-Key": "router_test_key_123",
      },
      body: createBody,
    });
    assert.equal((await replay.json()).id, session.id);
    const conflict = await call("/sessions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: controllerCookie,
        "Idempotency-Key": "router_test_key_123",
      },
      body: JSON.stringify({ sourceKind: "video", mode: "scan" }),
    });
    assert.equal(conflict.status, 409);
    await call(`/sessions/${session.id}/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: controllerCookie },
      body: JSON.stringify({ generation: session.generation }),
    });
    const pairResponse = await call(`/sessions/${session.id}/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: controllerCookie },
      body: JSON.stringify({ generation: session.generation }),
    });
    const pair = await pairResponse.json();
    const token = new URL(pair.url).hash.match(/pair=([^&]+)/)![1];
    const redeem = await call("/pair/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: decodeURIComponent(token) }),
    });
    assert.equal(redeem.status, 200);
    const phoneCookie = redeem.headers.get("set-cookie")!.split(";")[0];
    const reused = await call("/pair/redeem", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: decodeURIComponent(token) }),
    });
    assert.equal(reused.status, 401);
    const phoneReadsController = await call("/sessions", {
      headers: { Cookie: phoneCookie },
    });
    assert.equal(phoneReadsController.status, 401);

    const jpeg = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "white" },
    })
      .jpeg()
      .toBuffer();
    const form = new FormData();
    form.append(
      "metadata",
      JSON.stringify({
        sessionId: session.id,
        generation: session.generation,
        batchId: "batch_integrity_test",
        timingMethod: "performanceNow",
        frames: [
          {
            frameId: "phone_frame_0",
            seq: 0,
            sourceTimeMs: 0,
            sha256: "0".repeat(64),
            partName: "frame_0",
          },
        ],
      }),
    );
    form.append("frame_0", new Blob([jpeg], { type: "image/jpeg" }), "frame.jpg");
    const badHash = await call(`/sessions/${session.id}/frames`, {
      method: "POST",
      headers: { Cookie: phoneCookie },
      body: form,
    });
    assert.equal(badHash.status, 400);
    assert.equal((await badHash.json()).error.code, "FRAME_INTEGRITY_FAILED");
    assert.notEqual(createHash("sha256").update(jpeg).digest("hex"), "0".repeat(64));

    // USB cameras on the Mac use a separate controller route; phone permissions
    // are not broadened, and the same frame/generation validation still applies.
    const desktopPath = `/sessions/${session.id}/desktop-frames`;
    assert.equal((await call(desktopPath, { method: "POST" })).status, 401);
    assert.equal((await call(desktopPath, { method: "POST", headers: { Cookie: phoneCookie } })).status, 401);
    const desktopBatch = (generation = session.generation, batchId = "usb_test_batch") => {
      const body = new FormData();
      body.append("metadata", JSON.stringify({
        sessionId:session.id, generation, batchId, timingMethod:"performanceNow",
        frames:[{frameId:"usb_frame_0",seq:0,sourceTimeMs:0,sha256:createHash("sha256").update(jpeg).digest("hex"),partName:"frame_0"}],
      }));
      body.append("frame_0",new Blob([jpeg],{type:"image/jpeg"}),"frame.jpg");
      return body;
    };
    const stale = await call(desktopPath,{method:"POST",headers:{Cookie:controllerCookie},body:desktopBatch(session.generation+1)});
    assert.equal(stale.status,409);
    const received = await call(desktopPath,{method:"POST",headers:{Cookie:controllerCookie},body:desktopBatch()});
    assert.equal(received.status,200);
    assert.equal((await received.json()).ackSequence,0);
    const repeated = await call(desktopPath,{method:"POST",headers:{Cookie:controllerCookie},body:desktopBatch()});
    assert.equal(repeated.status,200);
    assert.equal((await repeated.json()).ackSequence,0);
    const phoneOnly = await call(`/sessions/${session.id}/frames`,{method:"POST",headers:{Cookie:controllerCookie},body:desktopBatch()});
    assert.equal(phoneOnly.status,403);

  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await service.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
