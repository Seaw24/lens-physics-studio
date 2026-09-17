import fs from "node:fs/promises";
import path from "node:path";
import { reserveBuildEvaluationCalls } from "../server/discovery/buildBudget";
import { loadDiscoveryConfig } from "../server/discovery/config";

const args = process.argv.slice(2);
const value = (flag: string) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const base = (value("--base") || "http://127.0.0.1:8787").replace(/\/$/, "");
const code = process.env.DISCOVERY_ACCESS_CODE;
const sourceKind = value("--kind");
const file = value("--file");
if (!code) throw new Error("DISCOVERY_ACCESS_CODE is required.");
if (!file || !sourceKind || !["image", "video"].includes(sourceKind))
  throw new Error("Use --kind image|video and --file PATH.");

const origin = new URL(base).origin;
const login = await fetch(`${base}/api/discovery/auth`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin },
  body: JSON.stringify({ code }),
});
if (!login.ok) throw new Error(`Login failed (${login.status}).`);
const cookie = login.headers.get("set-cookie")?.split(";")[0];
if (!cookie) throw new Error("Controller cookie missing.");
const controllerCookie = cookie;
// A smoke session can make one proposer and, conditionally, one reviewer call.
// Reserve both before creating a session, but do not spend capacity if login fails.
await reserveBuildEvaluationCalls(loadDiscoveryConfig(), [
  `smoke_${sourceKind}_proposer`,
  `smoke_${sourceKind}_potential_reviewer`,
]);
async function request(route: string, options: RequestInit = {}) {
  const response = await fetch(`${base}/api/discovery${route}`, {
    ...options,
    headers: {
      Cookie: controllerCookie,
      ...(options.method && options.method !== "GET" ? { Origin: origin } : {}),
      ...(options.headers || {}),
    },
  });
  const data = response.status === 204 ? null : await response.json();
  if (!response.ok)
    throw new Error(`${data?.error?.code || response.status}: ${data?.error?.message || "request failed"}`);
  return data;
}
const session = await request("/sessions", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Idempotency-Key": `smoke_${crypto.randomUUID().replaceAll("-", "_")}`,
  },
  body: JSON.stringify({ sourceKind, mode: "scan" }),
});
const bytes = await fs.readFile(path.resolve(file));
const form = new FormData();
form.append(
  "source",
  new Blob([bytes], {
    type: sourceKind === "image" ? "image/jpeg" : "video/mp4",
  }),
  sourceKind === "image" ? "source.jpg" : "source.mp4",
);
await request(`/sessions/${session.id}/source`, { method: "POST", body: form });
await request(`/sessions/${session.id}/start`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ generation: session.generation }),
});
let final;
for (let attempt = 0; attempt < 180; attempt++) {
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  final = await request(`/sessions/${session.id}`);
  if (
    ["completed", "failed", "budget_exhausted", "canceled", "interrupted"].includes(
      final.state,
    )
  )
    break;
}
if (!final || !["completed", "failed", "budget_exhausted"].includes(final.state))
  throw new Error("Smoke session did not reach a terminal state.");
console.log(
  JSON.stringify(
    {
      sessionId: final.id,
      sourceKind: final.sourceKind,
      state: final.state,
      counters: final.counters,
      errors: final.errors,
      candidates: final.candidates.map((candidate: any) => ({
        state: candidate.state,
        reviewVerdict: candidate.reviewVerdict,
        errorCode: candidate.errorCode,
        suppressionReason: candidate.suppressionReason,
      })),
      events: final.events.map((event: any) => ({
        id: event.id,
        subject: event.review.opportunity.subject,
        kind: event.review.opportunity.kind,
        media: event.media.mimeType,
        fidelity: event.media.fidelity,
        exampleOnly: event.exampleOnly,
      })),
    },
    null,
    2,
  ),
);
