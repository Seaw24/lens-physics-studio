# Lens discovery implementation specification, version 2.0

Status: implementation handoff, September 16, 2026. This is a specification for work still to build, except where explicitly labeled existing. Start the implementer with [FINAL-IMPLEMENTER-PROMPT.md](FINAL-IMPLEMENTER-PROMPT.md). This document supersedes the earlier training architecture, contracts, tickets, and runbook for new implementation.

## 1. Finish line

A user opens Discovery, supplies a photo/video or pairs a phone, starts a bounded session, and sees genuinely returned teachability verdicts with playable evidence. Approved events expose versioned JSON plus authenticated media for teammates. Rejected, uncertain, unavailable, and failed candidates remain inspectable in diagnostics. Existing lessons and their upload flow keep working.

The feature stops at media plus a grounded verdict. Teammates generate questions, annotate, and render the lab. Do not implement custom action training, numeric physical reconstruction, notifications outside the webpage, deployment to a new provider, glasses, or background phone capture.

The replacement architecture is:

```text
Uploaded video / phone frames → retained evidence + local activity score
                                          ↓
                         bounded window scheduling + periodic inspection
                                          ↓
                           inexpensive pretrained visual proposer
                                          ↓
                    immutable candidate snapshot, grouped overlapping work
                                          ↓
                  independent stronger visual review of original image evidence
                                          ↓
                   schema + evidence checks + event deduplication + media probe
                                          ↓
                      approved event / diagnostic rejection or uncertainty

Uploaded still → one proposer call → at most one review call → scene context only
```

An activity score is a scheduling hint, never a semantic detector score. The two models are stages, not votes. No claim of reliability follows merely from agreement.

## 2. Existing code and integration map

The application is React/Vite/TypeScript with an Express server and AWS SDK. The CLI vision pilot exists; the discovery runtime does not. Inspect current files before editing:

| Current code | Integration |
| --- | --- |
| `server/index.ts` | Express startup; 24 MB JSON parser, same-origin check, 40 API requests/minute/IP, one legacy model ID, SDK/bearer transports. Register discovery with its own limits before the legacy limiter and SPA fallback. Handle malformed origins safely. |
| `src/App.tsx` | State-driven navigation and a prepared teaching demo. Add a `discovery` page mounting an isolated component. Existing `discovery` boolean is legacy demo state; use an unambiguous new name. |
| `src/main.tsx` | Route `/capture` to the phone page before mounting the desktop app. No new routing framework required. |
| `src/api.ts`, `shared/physics.ts` | Legacy lesson API and `Moment` include teaching content. Leave those interfaces intact; use separate discovery types/client. |
| `scripts/vision-eval-core.mjs`, `vision-eval.mjs`, `summarize-vision-eval.mjs` | Real uniform-window baseline, bounded invocation, original outputs. Preserve prompt/version/results; new behavior gets new versions. |
| `scripts/prepare-vision-eval.py` | Existing source-specific offline masking/preparation helper, not a production decoder. |
| `vite.config.ts`, `scripts/dev.mjs` | Retain ordinary localhost development. Phone mode serves the built UI and API from one laptop HTTPS origin. |
| `tests/*.test.ts` | Node test runner via `tsx`; keep existing tests and add meaningful boundary tests. |

Recommended new layout:

```text
shared/discovery.ts                     v2 schemas, types, semantic validation
shared/discoveryCourse.ts               fixed objective IDs and descriptions
server/bedrock.ts                       configurable transport, existing auth methods
server/discovery/config.ts              validated config and safe client projection
server/discovery/auth.ts                controller cookie/bearer and phone pairing
server/discovery/router.ts              routes and bounded multipart handling
server/discovery/store.ts               atomic state, revisions, ledger, recovery
server/discovery/media.ts               decode/probe/clip creation and asset access
server/discovery/frames.ts              indexing, watermark, retention and snapshots
server/discovery/activity.ts            cheap grayscale change scheduling signal
server/discovery/scheduler.ts           queues, global dispatch, caps and cancellation
server/discovery/proposer.ts            versioned inexpensive-model requests
server/discovery/reviewer.ts            independent evidence review and validation
server/discovery/grouping.ts            work coalescing and event deduplication
server/discovery/service.ts             source/session orchestration
src/discovery/DiscoveryWorkspace.tsx    capture/upload, controls, results
src/discovery/PhoneCapture.tsx          paired foreground camera
src/discovery/capture.ts                bounded image sampling and upload
src/discovery/DiscoveryEventCard.tsx    clip/image + verdict + export
src/discovery/{api,useSession}.ts       typed API and cleanup-safe polling
src/discovery/discovery.css             scoped styling using existing visual language
scripts/discovery-preflight.ts          local checks; explicit image invocation
scripts/discovery-evaluate.ts           explicit bounded comparison modes
```

No Python model worker, GPU, training environment, database, or new framework is required. Add streaming multipart handling, image decoding, and QR generation only as needed: `busboy`, `sharp`, and `qrcode` are suitable choices. Add corresponding type packages if required and lock resolved versions. FFmpeg and ffprobe must work in the runtime installation; the existing dev dependency is not proof. Use verified executables via config, spawn argument arrays without a shell, and avoid unrelated upgrades.

## 3. Fixed course and model selection

Use module `intro-mechanics-forces-torque`, version `2`, with these immutable server-owned objectives:

| ID | Meaning |
| --- | --- |
| `force-interaction` | Visible contact, push, or pull as context for qualitative force reasoning; no force magnitude or acceleration inferred from mere contact. |
| `torque-rotation` | Visible rotation or a clearly supported lever/pivot arrangement; distinguish observation from hypothetical torque. |
| `equilibrium-support` | A specific visible support/load arrangement supporting a concrete qualitative explanation. |
| `released-object-motion` | Evidence of release and later motion; state idealizations and avoid measured trajectory claims. |

Use [V2-MODEL-PROMPTS.md](V2-MODEL-PROMPTS.md) and [the contract seed](v2/contracts.ts). Changing a module later changes objectives and evaluation examples; no per-subject training requirement is introduced.

The current cheap-model candidate is `amazon.nova-lite-v1:0`, already named by the legacy app. Verify its availability and chronological image behavior in this account. The stronger model `us.anthropic.claude-sonnet-4-6` worked in the initial pilot. Configure IDs separately. Do not silently promote every proposer job to Sonnet when the inexpensive model fails. Expose `unavailable`; direct strong review is an explicitly capped evaluation mode only.

Use the existing SDK credential chain or the existing server-only Bedrock bearer mode. Permit an optional local `DISCOVERY_CREDENTIALS_FILE` for the current workshop JSON, parsed without logging contents. Never overwrite the user's AWS config or embed credentials in frontend code. A successful past call does not prove current temporary credentials still work. Preflight must distinguish local configuration, authentication, model availability, and actual successful image invocation.

Reference checks: [Nova Converse support](https://docs.aws.amazon.com/bedrock/latest/userguide/model-parameters-nova.html), [Bedrock image blocks](https://docs.aws.amazon.com/bedrock/latest/APIReference/API_runtime_ImageBlock.html), and [Sonnet model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html). This implementation sends JPEG image sequences, not native video. Check provider limits during preflight; no assumption about accepting every possible image count is sufficient.

## 4. Default configuration

These are explicit engineering starting values, not measured optimum thresholds. Keep one typed configuration source and report effective settings in evaluations. Clients cannot override model IDs, rate ceilings, or budgets.

| Setting | Default |
| --- | --- |
| Discovery enabled / bind host | Enabled / `127.0.0.1`; LAN binding explicitly `0.0.0.0` with HTTPS and auth |
| Region / proposer / reviewer | `us-east-1` / `amazon.nova-lite-v1:0` / `us.anthropic.claude-sonnet-4-6` |
| Controller secret | Required generated secret with at least 32 random bytes; server only |
| Active ingest sessions | One; previous completed sessions remain readable |
| Capture and local analysis sampling | 8 fps, long side ≤1,280 px, JPEG ≤250 KiB |
| Local activity computation | 4 fps on 64×36 grayscale thumbnails |
| Model evidence sampling | 2 fps, long side ≤960 px, ≤12 JPEGs/window |
| Window length / grid stride | 6 source seconds / 3 seconds |
| Activity-mode proposer minimum spacing | 6 source seconds |
| Independent exploration cadence | Every 12 source seconds, first opportunity after 6 seconds |
| Event clip pre/post context | Up to 2 seconds each; maximum 10 seconds for one 6-second window |
| Live unpinned retention | 45 source seconds, also subject to storage cap |
| Cloud dispatch | One in-flight call globally across app Bedrock consumers; ≥1,300 ms between starts |
| Model timeouts / output caps | Proposer 30 s / 1,200 tokens; reviewer 60 s / 1,800 tokens |
| SDK and application retries | None automatically; timeouts can have unknown billing outcomes |
| Session cloud budgets | 30 proposer attempts, 10 reviewer attempts; ≤40 combined |
| Rolling wall-clock minute limits | ≤6 proposer and ≤3 reviewer starts; legacy calls also consume the global slot |
| Queues | One pending proposer window, four queued review snapshots, plus one running cloud call |
| Review queue expiry | 120 wall-clock seconds, explicit diagnostic on expiry |
| Pilot phone session limit | 5 minutes, then drain captured work and require explicit new session |
| Recording limit | 500 MiB, 30 minutes; budget exhaustion still stops scanning |
| Still limit | 10 MiB, 40 megapixels before normalized output |
| Stored media cap / retention | 2 GiB / 24 hours for completed sessions |
| Phone capture gap limit for action | 500 ms within the claimed event interval |
| Desktop polling | Once/second while visible and active; stop when terminal/unmounted |

Add these names to `.env.example` with no secrets: `DISCOVERY_ENABLED`, `DISCOVERY_PROPOSER_MODEL_ID`, `DISCOVERY_REVIEWER_MODEL_ID`, `DISCOVERY_ACCESS_CODE`, `DISCOVERY_CREDENTIALS_FILE`, `DISCOVERY_BIND_HOST`, `DISCOVERY_PUBLIC_ORIGIN`, `DISCOVERY_TLS_CERT`, `DISCOVERY_TLS_KEY`, `FFMPEG_PATH`, `FFPROBE_PATH`. Other settings may use typed defaults with documented server-side overrides. Discovery scripts must be included in an appropriate TypeScript check, unlike the current app-only tsconfig scope.

Budget admission happens atomically before dispatch. Reserve a potential reviewer slot when admitting a proposer job; release it when the proposer returns empty/invalid or work is canceled. Once no reviewer capacity remains, do not continue paying for proposals that cannot be reviewed. Record reservations separately from actual starts. The reservation guarantees only count capacity; queue/time failures remain possible and must be reported.

For automated implementation validation, default to a persistent **80-call aggregate ceiling** across preflights and evaluation runs, recorded under `.runtime/discovery/build-evaluation-ledger.jsonl`. Never reset it automatically, parallelize runners to evade it, or silently raise it. Explicit human-started UI demo sessions use their own disclosed session caps. A cap is an upper limit, not a target. Run deterministic tests without cloud calls and stop paid experiments when no new decision is being tested.

## 5. Media and clocks

Use finite integer source milliseconds internally, source seconds in exported JSON, and wall time only for dispatch, expiration, and measured latency. Every frame has stable ID, sequence, timestamp, orientation, dimensions, SHA-256, and server-only path. Client filenames and source paths never become public asset paths.

### Uploaded still

Stream one file into a generated temporary path; reject multipart/file/size/decode/pixel errors. Apply EXIF orientation and normalize to JPEG with metadata removed. One proposer request, and at most one reviewer request containing the same image. Multiple proposals share that review. Empty is valid. All approved image opportunities are `scene_context`, with null times and no before/after transition. Photo input has no local activity stage.

### Uploaded video

Validate the file with ffprobe and decode real video; do not trust extension/MIME. Normalize timeline origin to zero, respect rotation, and sample 8 fps without holding the entire recording in memory. The frame sample time is its analysis-grid position; retain original timing information needed for accurate media extraction. Reject undecodable/oversized sources and clean temporary files.

Support `scan` and `replay`. Scan advances as work and storage allow; replay advances a source watermark at 1× monotonic elapsed time. No model or clip extractor can inspect future frames beyond the watermark, even when the original file is present. Pause freezes replay source progression; resume is explicit. Ordinary playback/seek of results does not analyze again. Rerun creates a new session/generation, never hidden paid work on seek.

Decode in bounded chunks (at most two seconds beyond current consumption) or use streaming backpressure. Do not extract a whole half-hour video before checking disk limits. Offline scan waits for capacity instead of silently skipping footage. Continue sufficient ingestion to finish a pinned candidate's bounded post-roll before applying that wait, avoiding deadlock.

### Phone

Use rear-facing `getUserMedia` from a Start camera gesture, audio false, `muted`/`playsInline` local preview. Sample via `requestVideoFrameCallback` when available, with source times based on its media clock. Fallback to monotonic `performance.now()` and record the timing method. Never assign times as received frame count divided by nominal fps. Normalize the first capture timestamp to zero; maintain that origin across ordinary pauses.

Keep one canvas encode in flight. Upload batches of up to eight JPEGs every approximately 500 ms, one upload in flight and at most two pending batches. If behind, drop the oldest unsent batch and count the gap. Each multipart batch has metadata `{sessionId,generation,batchId,frames:[{frameId,seq,sourceTimeMs,sha256,partName}]}`; server verifies bytes/hash, bounds, and session scope before acknowledging. Client hashes are integrity assertions, not trusted facts. Exact retries are idempotent; same sequence with different content conflicts. Monotonicity applies to new frames; exact duplicates may be acknowledged again.

Rotate/reset/reconnect with a reset timestamp clock into a new session, rather than mixing timelines. Pause when hidden and show the interruption; resuming after a long gap clears temporal history. Stop camera tracks, uploads, timers, and callbacks on exit. The phone must remain foregrounded; locking it is not supported background recording.

### Preserved evidence and playable output

Pin the core window and available pre-roll before queueing. Collect up to two seconds post-roll independently of cloud completion. Freeze a snapshot with frame IDs, times, hashes, prompt version, and a snapshot hash. Model jobs read that snapshot, never the moving ring buffer. Eviction cannot delete queued evidence. Release pins on every terminal path.

For uploaded video, accurately trim and re-encode silent H.264/yuv420p/fast-start MP4 from original media; preserve source motion detail up to 30 fps. Avoid stream-copy keyframe imprecision. For live capture, reconstruct an 8 fps display timeline by holding the latest actual frame at each display tick; never interpolate invented motion or compress gaps out of time. Report `sampled_camera_frames`, actual gaps and timing uncertainty. A gap >500 ms inside an action interval yields local `insufficient_evidence`; a supported static context may still be independently reviewed.

Probe every generated asset, validate clocks/dimensions/duration, and publish only after atomic file finalization. Short post-roll at source end is valid and recorded; do not wait indefinitely. Event intervals describe the observation, while media intervals include context. Derive clip-relative evidence time as `sourceTime - mediaStart`. The maximum capture gap in the export is measured within the claimed event interval; source-video exports may use null because it is a phone-ingest diagnostic. Timing uncertainty reports sampling/encode limitations, never precision invented by the model.

Original pilot footage contains incidental personal surroundings. Reuse the locally reviewed masked evidence for cloud regression runs; do not automatically substitute unmasked original frames. Carry source-specific masking instructions into preparation and report their effect on results. Follow the actual workshop's usage restrictions. Phone rehearsal should use a deliberately framed scene meeting those restrictions; the existing manual masks are not a general live anonymization system.

## 6. Activity and scheduling algorithm

Implement a simple deterministic starter signal, not optical physics estimation:

1. At 4 fps, decode a 64×36 grayscale thumbnail from available frames. For each corresponding pixel compute current minus previous intensity; subtract the median difference to reduce uniform exposure changes.
2. `activityScore = fraction(abs(correctedDifference) > 12)` for byte intensities 0–255. This is an uncalibrated score, not confidence.
3. Enter active state when score ≥0.04 on two of the last three valid ticks. Exit after eight consecutive valid ticks below 0.02. Reset temporal history after a gap >500 ms. Broad camera motion remains a known source of activation; do not claim this algorithm removes it.
4. The window grid remains six seconds long with a three-second stride. When a window closes, consider it if activity occurred inside it and six source seconds have elapsed since the last admitted activity-mode proposal.
5. Independently make periodic opportunities due at source time 6, 18, 30, ... seconds, using the most recent complete window. A coincident activity job satisfies both reasons with one request. Pending periodic work cannot be starved by activity; coalesce and retain its reason. This periodic allowance is part of the same hard budget.
6. An activity/window job is admitted only if count/rate/queue reservations allow it. Live mode keeps the newest pending window and logs replaced source intervals; offline scan pauses when capacity is occupied. Give admitted reviews priority so proposals do not create unbounded backlog. Every cloud dispatch passes the one global slot and rate checks.
7. At EOF/Stop, process a final partial window only if it has at least two distinct source times and no identical work key already ran. Clip duration may be less than six seconds. An image uses its separate path.

The gate is **experimental until evaluated**. Provide evaluation modes `direct_uniform`, `cascade_uniform`, and `cascade_gated`; expose the live mode as an explicitly labeled experimental demo with measured skipped intervals. Do not portray these thresholds as validated or replace the independent exploration allowance with a claim that motion catches everything.

The strongest baseline uses uniform six-second windows every three seconds. The cascade's uniform evaluation must use the same window list and image evidence; only the added proposer differs. Gated comparison changes scheduling, retaining the same selected-window representation. Separate media sampling variants from scheduling comparisons.

## 7. Proposer, independent reviewer, and grouping

Use strict JSON from [the supplied prompts](V2-MODEL-PROMPTS.md). Accept exactly one outer JSON Markdown fence, matching the tested harness behavior. Do not extract a JSON-looking substring from arbitrary prose, silently repair fields, or spend extra calls on format repair. Validate before/after frames, objective IDs, known boundaries, interval inclusion, and action-versus-image semantics. An invalid response is `failed_invalid_output`, never a physics rejection.

The proposer returns zero to three evidence-backed proposals. Empty releases its review reservation. All proposals from one window share one independent review request. The reviewer receives the original chronological frames, course objectives, and evidence limitations; **do not give it the proposer's narrative, confidence, or proposed answers**. It returns an overall verdict plus zero to three independently grounded opportunities. Only `teachable` may contain opportunities. No fixed object/action whitelist and no invented numerical confidence.

On `teachable`, match and record overlap with proposals locally for diagnostics. A grounded reviewer opportunity may differ from a proposer; it is not described as model agreement. Each validated opportunity becomes at most one event, after media readiness and deduplication. Rejections/uncertainty remain candidate-level records accessible to the controller.

Use two distinct safeguards against repeats:

- **Exact work cache:** key over session/generation, stage/model ID, prompt/config/course versions, ordered frame IDs/hashes, and masks. One invocation per identical key. Do not reuse across changed prompts/evidence. Persist successful/failed/unknown state; replayed UI requests do not dispatch again.
- **Temporal event grouping:** merge only when kind matches, objective IDs intersect, normalized free-text subject matches, source intervals have IoU ≥0.5, and at least two action evidence frame IDs are shared (one for static). Keep the contributing candidates and evidence, retain one event ID, and do not send a second notification. Do not use a blanket cooldown for actions: two plate releases at different times remain two events. Conservative missed merges are preferable to collapsing distinct actions; report remaining duplicates. Keep one complete validated review as the public event payload; store other contributing candidate/review IDs internally. Do not concatenate model observations or union frame lists into an unvalidated hybrid opportunity. A revision may replace the primary review only with another complete validated payload, preserving the event ID.

Before review, apply the same overlap rule to queued proposals and reuse an already preserved covering snapshot only if it actually contains their declared frames. Otherwise retain separate jobs. Never merge solely because both say “door” or “force.” For static-context notifications, allow additional 30-source-second suppression only when subject and objective match and evidence thumbnails are nearly identical (normalized mean absolute grayscale difference ≤0.02); retain the suppression reason. This is a prototype heuristic to evaluate, not object tracking.

No string rule about “can,” “door,” “wet,” or the supplied timestamps may substitute for general grounding. Improve prompts using those error cases; demonstrate changes on fresh evidence later. Structural validation proves valid references, not visual truth.

## 8. State, storage, dispatch, and cancellation

Persist under ignored `.runtime/discovery/`: `sessions/<uuid>/session.json`, source, frames, snapshots, candidates, events, assets, and ledger/diagnostics JSONL. Only generated IDs form paths. One process owns the store; fail cleanly if a second writer starts on the same store. New invocation-capable CLI commands acquire the same store/dispatch ownership or submit through the running server; they may not run a separate uncounted cloud loop alongside it. Local read-only checks can run independently. Do not invoke the old pilot runner to bypass the new build-evaluation ledger. Serialize each session's mutations; atomic temporary-file + rename for JSON, serialized append for ledger. Keep revision numbers for polling and a generation integer for invalidating asynchronous work.

Session states: `created → ingesting → draining → completed`. Also permit `paused`, `budget_exhausted`, `interrupted`, `failed`, and `canceled`. Starting is explicit and idempotent. Pause stops new source progression/scheduling; already dispatched inference may finish and be recorded. Stop ends capture and drains preserved work, flushing available post-roll. Cancel increments generation, aborts jobs best-effort, rejects new frames, and prevents late results publishing. Delete cancels before removing the session. Budget exhaustion stops new paid admissions; already reserved work may drain, then show a terminal budget state with skipped intervals. Never restart scanning automatically after a timer reset.

Candidate states: `proposed`, `collecting`, `queued`, `reviewing`, then `approved`, `not_teachable`, `insufficient_evidence`, `suppressed_duplicate`, `suppressed_budget`, `expired`, `failed`, or `canceled`. Nonterminal state names reflect actual work. Every path releases reservations/pins, including invalid model output, media failure, and exceptions.

Each dispatch ledger entry records attempt ID, session/generation, stage, model/prompt IDs, snapshot hash, reason, start/end wall time, result/stop reason, provider usage if present, latency, and safe error category. Write `started` before sending. Unknown usage remains null, never zero. Disable retries in the SDK and outer transport. Auth/access errors open a circuit breaker, stopping repeated calls until explicit refresh/preflight. Do not include credentials, raw image bytes, or personal paths in public errors.

On restart, preserve completed assets/events, mark prior active sessions interrupted and unfinished attempts unknown, and release stale reservations without automatically replaying paid calls. A manual retry is a new counted attempt with an explicit reason. Existing legacy model calls must acquire the same global dispatcher slot when Discovery is active; preserve legacy response behavior and record their separate stage so discovery cannot quietly violate process-wide concurrency.

Enforce disk cap before admission/large writes and during decode. Evict expired completed sessions or unpinned frames only; never discard queued/approved evidence to hide pressure. Pause with `STORAGE_LIMIT` and provide cleanup when no safe space is available. Retention cleanup and deletion use session-scoped paths, never arbitrary paths supplied over HTTP.

## 9. API and authorization

Base `/api/discovery`. Use strict Zod request schemas and structured failures `{error:{code,message,retryable}}`. Auth, limits, origin checking, generation validation, and existence checks precede side effects. API misses must return JSON 404 before the SPA fallback.

Controller login exchanges a server-configured access code for a short-lived HttpOnly SameSite=Strict cookie. Secure is required on LAN HTTPS; loopback-only HTTP development may use a non-Secure cookie. A server-to-server controller bearer token is allowed but never embedded into frontend code. Validate exact allowed origin/host and make cookie-authenticated mutations require a matching Origin. No wildcard CORS. Rate-limit login/redeem separately, and never trust arbitrary forwarded headers.

Pairing returns a one-time random token with two-minute TTL in a QR URL fragment, not a query parameter. `/capture` removes the fragment after redemption. Redemption gives an HttpOnly Secure SameSite=Strict phone cookie scoped to the one session/generation. A phone can upload, heartbeat, read its capture status, and stop its own stream; it cannot read events/assets, list sessions, initiate model calls directly, or delete sessions. Tokens are server-hashed, rotated/revoked on session termination, and excluded from logs/referrers. Display a fallback link without exposing the controller secret.

| Method / path | Role and behavior |
| --- | --- |
| `POST /auth` | Code → controller cookie; bounded body and login rate. |
| `DELETE /auth` | Logout/revoke controller cookie. |
| `GET /config` | Controller; safe effective config, model states, capabilities, no secret paths. |
| `POST /preflight` | Controller; local-only by default, body `{invoke:true}` explicitly requests counted image checks. |
| `POST /sessions` | Controller; `{sourceKind,mode:'scan'|'replay'|'live'}` with compatible combinations; idempotency key. |
| `POST /sessions/:id/source` | Controller; one bounded streamed image/video file before Start. |
| `POST /sessions/:id/start` | Controller; freezes config/course, validates input, reserves lifecycle; idempotent. |
| `POST /sessions/:id/pause`, `/resume`, `/stop`, `/cancel` | Controller; documented transitions, idempotent, generation-safe. |
| `GET /sessions/:id?afterRevision=N` | Controller; consistent snapshot/deltas of progress, events, candidates, counters, errors. No new model calls. |
| `GET /sessions` | Controller; paginated stored session summaries. |
| `DELETE /sessions/:id` | Controller; cancel then delete that session and revoke its phone credentials. |
| `POST /sessions/:id/pair` | Controller; create one-time capture link/QR only for live session. |
| `POST /pair/redeem` | Token → scoped phone cookie; no token in URL logs. |
| `POST /sessions/:id/frames` | Scoped phone; multipart batch, bounded count/bytes, idempotent by seq/hash. |
| `POST /sessions/:id/heartbeat`, `/capture-stop` | Scoped phone; update connection / end source only. |
| `GET /sessions/:id/capture-status` | Scoped phone; its state, ack sequence, gap counts, no events or secrets. |
| `GET /events/:id` | Controller; approved v2 event; rejected reviews live in candidate diagnostics. |
| `GET /assets/:id` | Controller; authenticated bytes with Range/HEAD support, generated asset IDs only. |

A POST idempotency key reused with different input returns 409. Session/generation mismatch returns 409; auth 401/403, too large 413, unsupported source 415, invalid request 400, unavailable model/dependency 503, and capacity limit 429 with safe retry details. Capturing/polling uses dedicated budgets sufficient for normal traffic (e.g. four frame batches/second and two polls/second), outside the legacy 40/minute limiter. Bound every body before reading it; multipart bytes must not pass through a permissive JSON decoder.

## 10. Public teammate contract

[contracts.ts](v2/contracts.ts) is a runnable seed for `shared/discovery.ts`. Complete API/session schemas around it. `EventSchema` is only for approved events, version `2.0`; preserve candidate failures separately. [check-contract.ts](v2/check-contract.ts) builds synthetic image/video examples and verifies invariants. They are fixtures, never evidence of a model call.

An event contains identity/course/source, a `teachable` verdict with independently observed opportunity, source and clip times, authenticated media metadata, and server-added model/snapshot provenance. `exampleOnly` must be false for real outputs and true for fixtures. No question, annotation, physical measurement, calibrated probability, client secret, local path, or raw model output belongs in that event.

Server owns IDs, URLs, hashes, times, provenance, usage and state. Models supply only the documented response fields. All frame references must be in the actual request snapshot; the declared interval's boundary IDs must also be in its evidence list. Before/after evidence must be chronologically separated. For images, all timing fields are null. For videos, clip-relative times are derived, never model-generated. `provenance.proposer` may be null only in explicit direct-review evaluation.

Expose a teammate consumer example that validates schemaVersion and EventSchema, rejects `exampleOnly`, fetches only an authenticated same-origin media path, and does not assume an action from a static context. Browser use relies on the controller cookie. A teammate backend uses its configured server-side credential. Download/export never triggers inference. File paths in developer documentation are repository-relative; runtime exported media references are the authenticated API paths above.

## 11. UI and same-Wi-Fi setup

Add a Discovery navigation entry. Show upload photo/video, scan/replay selection, phone pairing, explicit Start/Pause/Stop/Cancel, current connection/model status, observed source progress, budget use, and dropped/skipped coverage. Default live mode is the labeled experimental gated cascade; uniform direct review stays in evaluation tooling. Show approved events once, with playable image/clip, observed facts, curriculum connection, limitations, and JSON/media downloads. Diagnostics can expand rejected/uncertain/failed work. Technical internals stay in diagnostics rather than the primary learning flow.

Mounting, polling, rendering, or playing media must never start a session or model call. React StrictMode/remount cannot duplicate starts; abort pending fetches and clean timers on unmount. Reconcile event revisions by ID and maintain an acknowledged-notification set so merged events do not notify again. Preserve existing keyboard behavior, responsive styling, course/coach/lab pages, and legacy uploads.

For phone mode, serve the built UI/API on one trusted HTTPS LAN origin. [Browser camera capture requires a secure context](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). Generate/configure a certificate with the right hostname/IP SAN, document device-specific trust steps, and require actual camera permission from the user. Do not bypass browser certificate checks or silently introduce a public tunnel. Configure both cert and key or fail clearly. Keep ordinary localhost development working.

Provide exact commands used to build/start, how to find the laptop LAN address, how the phone trusts the certificate, how to pair, and how to stop/revoke. Do not mark phone support verified until an actual phone pairs, sends frames, produces a real verdict, and the laptop plays the resulting asset. If the user is unavailable, finish the path and document that one manual test as outstanding.

## 12. Ordered work packages and acceptance

### V01 — Types, configuration, source validation, and state foundations

Copy/adapt v2 contract seed; add session/candidate/API schemas, typed config, course, atomic store, and ledger. Implement authenticatable routes and startup integration without changing legacy behavior. Create status fields for unavailable dependencies.

Acceptance: contract fixtures validate; invalid image-action/time references fail; auth/session scope/path traversal/body limits have meaningful tests; TypeScript includes new scripts and app code. No cloud calls needed.

### V02 — Media, snapshots, and real cloud adapters

Implement upload decode/probe, sampled frames, immutable snapshots, clip generation and authorized Range serving. Implement shared configurable Bedrock transport and global dispatch hook, independent prompt builders, strict parsing/validation, explicit preflight. Preserve legacy SDK/bearer behavior without double base64 encoding; SDK gets bytes, REST gets base64. Keep original pilot outputs immutable.

Acceptance: real timestamped fixture preserves trim/time/orientation; snapshot survives ring eviction; ranges work; image invocation succeeds when credentials permit; unknown access stays unavailable. Test fake responses separately from real-call evidence.

### V03 — Working uploaded-media vertical slice

Implement cascade_uniform for explicit evaluation and connect image/video sources, proposal review reservation, independent review, approved event output, diagnostics, and basic Discovery cards. Wire finite sessions, atomic asset publication, and export.

Acceptance: a real uploaded clip/photo can produce its actual model verdict and playable asset, or a clear real error/empty result. No generated teaching content. Repeated clicks, polling, downloads, and playback make no extra calls. This is the first functional milestone, not the whole task.

### V04 — Grounding, grouping, budgets, and fault behavior

Implement before/after checks, image restrictions, event grouping, queue policies, global/call-rate/count limits, source clocks, restart recovery, cancellation and late-result discard. Compare the can-opening/structural-brace/wet-floor failure cases using general prompts; don't introduce bespoke labels. Implement local gaps and media-readiness checks.

Acceptance: two temporally separate throws remain separate; overlapping copies merge; no approval appears after cancel; no failed call becomes rejection; unknown usage remains null; all terminal paths release resources; cap holds across simultaneous user actions and legacy traffic.

### V05 — Experimental activity scheduling and bounded replay

Implement the specified cheap activity signal, periodic allowance, scan/replay semantics, live coalescing, explicit coverage accounting, EOF flushing, and immutable work keys. Keep identical sampled evidence for uniform comparisons.

Acceptance: activity fires without periodic dependence; periodic exploration fires on an otherwise idle source; camera motion can produce a logged noisy activation; gaps reset history; queue saturation remains bounded; replay never reads the future; offline post-roll cannot deadlock.

### V06 — Phone transport, HTTPS, and complete UI

Implement pairing/scoped capture auth, foreground rear-camera capture, upload backpressure, disconnect/gap reporting, secure LAN serving, controls, and UI cleanup. Produce phone event media with disclosed sampled fidelity. Finish original demo regression checks.

Acceptance: capture batches are idempotent, bad hashes/sequence conflicts fail, the phone cannot read controller resources, expiry/revocation works, no unbounded canvas/network queue, no hidden background-capture claim. Record actual-device status separately from automated transport tests.

### V07 — Bounded real evaluation and failure review

Add `discovery:preflight` (local by default, `--invoke` explicit), `discovery:evaluate` (dry-run by default, `--invoke` explicit), and contract/test/typecheck scripts. Evaluation uses a new run directory, frozen configs, existing masked inputs, no user labels in prompts, no automatic paid retries, and the persistent implementation ceiling.

Suggested budget allocation, not a mandate to spend: at most two image preflights; the longer recording's 27 uniform proposer windows plus at most ten admitted reviews; at most 14 gated proposals plus ten reviews; up to eight selected direct-review regression windows chosen by a declared development protocol. Total maximum 71 calls, leaving nine for necessary explicit checks. Record any deviation within the 80-call ceiling. Budget-suppressed windows remain missed coverage, not successful rejection. If fewer windows are eligible, spend less.

Compare available real runs: saved pilot `direct_uniform_v1`; new `cascade_uniform_v2`; new `cascade_gated_v2`. Prompt/schema changes mean the old direct run is a historical reference, not a controlled estimate of savings from the proposer alone. A strictly comparable direct v2 run needs identical prompt/evidence/coverage and must fit the remaining budget or be explicitly marked unrun. Do not claim an apples-to-apples reduction when stages or coverage differ.

Report positive-reference coverage event by event, grounding errors, abstention, duplicates, skipped intervals, both stages' actual tokens/calls, unknown usage, request and end-to-verdict latency. Match approved intervals to reference events by temporal overlap plus manually reviewed visible facts, allowing the supplied approximate ranges. Extra proposals are not automatically negatives. Precision/recall needs an accepted exhaustive reference set and matching policy. Never claim a held-out result after tuning on these clips.

An experimental demo is acceptable with honest limitations; automatic approval is not established merely by shipping. A useful local target is retaining all previously recognizable reference interactions while rejecting the observed unsupported claims and reducing strong calls. Record failures against that target instead of forcing a pass. Fresh settings/objects and human adjudication remain prerequisites for broad quality claims.

### V08 — Delivery and operational handoff

Run appropriate tests, TypeScript, production build, desktop browser smoke checks, real upload/still flow, and available real-phone checks. Update setup/API/status docs and produce `EVALUATION-V2.md` with measured results. Refresh the implementation archive excluding credentials/media/private paths. Preserve the original pilot report.

Final delivery states actual functionality, exact commands, test/build outcomes, model access, measured performance, and remaining external device/fresh-evidence checks. Do not mark real-phone or generalization validation complete from mocks. Missing fresh footage must not stop implementation of the rest.

## 13. Minimum meaningful regression matrix

| Boundary | Required evidence |
| --- | --- |
| Model input isolation | Reference labels, filenames, private paths, and proposer narrative cannot reach independent reviewer input. |
| Grounding structure | Unknown IDs/objectives, evidence outside interval, nonchronological before/after, image-action claim, wrong clock offsets, and extra JSON fields fail. |
| Failure distinction | Invalid/truncated output, credentials, timeouts, media errors and insufficient evidence remain distinct states. |
| Budget and concurrency | Fake-clock tests enforce global slot/spacing, rolling limits, reservation release, persisted build ceiling, and no implicit retry. |
| Cancellation/restart | Delayed completion after cancel/delete cannot publish; unfinished restart calls remain unknown, never auto-replayed. |
| Media fidelity | Bounded trim orientation/duration, source-to-clip time mapping, gaps/display holds, EOF truncation, ranges, and snapshot pinning. |
| Scheduling | Periodic path without movement, activity path, live dropping with coverage counters, offline backpressure/post-roll, no replay future leakage. |
| Deduplication | Same overlapping event once; separated actions twice; repeated static view suppressed with reason; changed evidence not exact-cache hit. |
| Auth and ingest | Phone scopes, expired/redeemed token, seq/hash conflict, retry idempotency, traversal, limits, same-origin requests. |
| UI | No model calls on mount/playback/export/poll; start idempotency; controls/cleanup; legacy demo and upload still function. |

Tests should verify behavior under these failure conditions, not just mirror helper implementation. Real inference and physical-phone checks are separate recorded evidence. No synthetic fixture may be displayed as a live approved opportunity.
