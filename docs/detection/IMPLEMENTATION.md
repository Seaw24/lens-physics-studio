# Lens discovery implementation specification

> Superseded architecture (September 16, 2026): read [VISION-FIRST-DIRECTION.md](VISION-FIRST-DIRECTION.md) first. The custom action-training requirement and mandatory two-detector design are withdrawn. This document retains historical details; do not execute its old training plan or copy its detector schema as the new design.

Version: 1.1. Scope approved through the product interview. This is a build specification; numerical settings below are initial engineering defaults, not measured performance claims.

## 1. Outcome and exclusions

Implement a functioning input-to-verdict pipeline in the existing repository:

1. Ingest an uploaded image/video or the phone's live camera frames.
2. Produce candidates through a local temporal action recognizer and an independently scheduled inexpensive vision model.
3. Merge duplicate evidence and prioritize agreement while permitting either detector to propose independently.
4. Preserve a playable event clip/image.
5. Ask a stronger model whether that evidence supports the fixed mechanics module.
6. Display a notification for approved events and expose the media plus versioned JSON for teammates.

Do not implement new coaching questions, annotations, simulations, AR, glasses integration, attention inference, social accounts, or all-day mobile background capture. Keep the existing prepared teaching demo usable and distinctly labeled.

## 2. Repository integration

### Existing code that matters

| Existing file | Current behavior | Required integration |
| --- | --- | --- |
| `src/App.tsx` | Large state-driven navigation; video uploads; prepared discovery | Add a Discovery entry. Mount an isolated workspace; do not expand the legacy lesson state with discovery internals. |
| `src/api.ts` | Legacy tutor/analysis client; whole-file sparse frame sampling | Keep legacy functions; put the new client in `src/discovery/api.ts`. |
| `server/index.ts` | Express app, hardcoded shared model ID, 40 requests/minute/IP, 18 MB JSON parser | Extract Bedrock transport, register discovery routes before legacy limiter and SPA fallback, add startup options. |
| `shared/physics.ts` | `Moment` requires questions and annotations | Do not reuse `Moment` for discovery. Add `shared/discovery.ts`. |
| `vite.config.ts` | Local HTTP, `/api` proxy | Preserve normal local development; serve phone demo from the built app through the HTTPS server. |
| `scripts/dev.mjs` | Starts Vite and Express | Let Express own Python-worker lifecycle; no third development command required. |
| `tests/*.test.ts` | Node test runner via `tsx` | Add meaningful state/API/media tests using the same runner. |
| `.gitignore` | `.runtime/` already ignored | Store media, weights, credentials, TLS keys, and training data under ignored paths. |

The present upload handler is video-only. Photos and phone capture are new work. The current `/api/analyze` asks for a basketball lesson and returns questions/anchors; it is not the new verifier.

### Files to create

```text
shared/discovery.ts                    types + Zod schemas + semantic validators
shared/discoveryCourse.ts              fixed mechanics objectives/version
server/bedrock.ts                      configurable shared Converse transport
server/discovery/config.ts             environment/default validation
server/discovery/auth.ts               controller + scoped phone access
server/discovery/router.ts             HTTP endpoint definitions
server/discovery/store.ts              atomic JSON persistence/revisions
server/discovery/media.ts              file validation, decode, clip generation
server/discovery/frames.ts             frame indexing, deduplication, pinning
server/discovery/worker.ts             persistent Python JSON-lines client
server/discovery/action.ts             temporal grouping/hysteresis
server/discovery/explorer.ts           independent exploration scheduling
server/discovery/fusion.ts             pure candidate fusion and priorities
server/discovery/scheduler.ts          queues, budgets, cancellation, ledger
server/discovery/reviewer.ts           prompt, parsing, evidence validation
server/discovery/service.ts            orchestrates session lifecycle
src/discovery/DiscoveryWorkspace.tsx   desktop capture/upload/results UI
src/discovery/PhoneCapture.tsx         paired phone camera page
src/discovery/DiscoveryEventCard.tsx   media + verdict + export
src/discovery/api.ts                   typed client + structured errors
src/discovery/useSession.ts            polling, cleanup, revision handling
src/discovery/capture.ts               camera sampling/backpressure
src/discovery/discovery.css            existing visual language, scoped styles
ml/requirements.txt                   compatible pinned dependencies
ml/preprocess.py                      shared sampling/transforms
ml/worker.py                          pretrained/custom action inference
ml/manifest.py                        dataset manifest validation/splitting
ml/extract_features.py                frozen-backbone feature extraction
ml/train_head.py                      custom action-head training
ml/evaluate.py                        held-out continuous evaluation
scripts/discovery-preflight.ts        explicit dependency/model checks
scripts/discovery-evaluate.ts         pipeline ablations/report generation
tests/discovery-*.test.ts              pure, HTTP, scheduler, media checks
```

Keep files focused. No new framework is needed. Use the existing Express/React/Zod/Node stack, a persistent Python subprocess, local disk, FFmpeg, and the existing AWS SDK.

Add `busboy` for bounded streaming multipart uploads, `sharp` for JPEG/image inspection and normalization, and `qrcode` for the pairing QR. Add their TypeScript declarations where needed. Keep FFmpeg executable selection explicit; `ffmpeg-static` already exists as a development dependency, but runtime media work must not accidentally depend on a dev-only installation. Prefer a verified system `ffmpeg`/`ffprobe` pair or explicit executable paths. Lock resolved dependency versions; do not upgrade unrelated packages.

## 3. Process and storage topology

```text
Phone browser -- HTTPS multipart frame batches --> Express on laptop
Laptop browser -- uploads/control/polling --------> Express on laptop
                                                   |
                                      persistent Python worker
                                      (local action recognition)
                                                   |
                                     shared Bedrock call scheduler
                                      explorer / stronger reviewer
                                                   |
                                     local event assets + JSON
```

Only Express is externally reachable for this demo. Python has no listening port and accepts only server-generated work. One active ingest session at a time; retain completed sessions for viewing until cleanup. One action inference and one Bedrock invocation may be in flight independently.

Disk layout:

```text
.runtime/discovery/
  sessions/<uuid>/session.json
  sessions/<uuid>/source/<generated-name>
  sessions/<uuid>/frames/<zero-padded-seq>.jpg
  sessions/<uuid>/candidates/<uuid>.json
  sessions/<uuid>/events/<uuid>.json
  sessions/<uuid>/assets/<uuid>.mp4|jpg
  sessions/<uuid>/ledger.jsonl
  sessions/<uuid>/diagnostics.jsonl
  models/<model-version>/manifest.json
  models/<model-version>/head.pt
  models/<model-version>/metrics.json
  datasets/...
  tls/...
```

Use generated UUID paths, never a client filename as a path. Serialize mutations through one session lock. Write JSON to a temporary file and rename atomically. Append ledger entries with a serialized writer. On restart, preserve finished events; mark previously active sessions `interrupted`, and unfinished model attempts `unknown`. Do not silently replay paid calls after restart.

Default retention: completed sessions 24 hours; explicit Delete session removes only that session after canceling work. Combined session-media storage cap is 2 GiB. Models, venv, and training datasets have separate monitored storage; use a 10-GiB initial dataset-download cap, check free disk space, and never start an unbounded dataset download. Maximum source upload is 500 MiB and duration 1,800 seconds. Never delete pinned evidence or approved assets merely to meet a cap; pause ingestion with `STORAGE_LIMIT` and offer cleanup.

## 4. Configuration and fixed course

These defaults must appear in one validated configuration module and in the runbook. Browser clients receive safe settings from `/config`; clients do not control budgets or model IDs.

| Setting | Initial value |
| --- | --- |
| `DISCOVERY_ENABLED` | `true` |
| `AWS_REGION` | `us-east-1` |
| `DISCOVERY_EXPLORER_MODEL_ID` | `amazon.nova-lite-v1:0` |
| `DISCOVERY_REVIEWER_MODEL_ID` | `us.anthropic.claude-sonnet-4-6` |
| `DISCOVERY_ACCESS_CODE` | Required unpredictable controller secret, at least 32 characters; `.env` only |
| `DISCOVERY_BIND_HOST` | `127.0.0.1`; set `0.0.0.0` explicitly for LAN HTTPS |
| `DISCOVERY_PUBLIC_ORIGIN` | Required HTTPS origin for phone mode, e.g. the configured LAN host and port |
| `DISCOVERY_TLS_CERT`, `DISCOVERY_TLS_KEY` | Local paths; both required for direct LAN HTTPS |
| `DISCOVERY_PYTHON` | Venv Python executable |
| `FFMPEG_PATH`, `FFPROBE_PATH` | Verified executable paths or PATH-resolved executables |
| `DISCOVERY_ACTION_MODE` | `custom_head` when valid weights exist, otherwise explicitly `pretrained_baseline` |
| `DISCOVERY_MODEL_DIR` | Ignored model-version directory |
| Capture / decoded analysis fps | 8 |
| Capture frame long side / JPEG quality | 1,280 pixels / 0.75, reduced if needed to meet byte cap |
| Action window / stride | 16 frames over 2 seconds / 1 second |
| Action high / low / exit score | 0.65 / 0.45 / 0.30, overridden by validated model manifest |
| Action exit persistence | 2 consecutive windows below exit threshold |
| Explorer interval / observed span / frames | 10 source seconds / latest 8 seconds / up to 6 |
| Review frames / maximum long side | Up to 12 / 960 pixels |
| Pre-roll / post-roll | 2 seconds / 2 seconds |
| Maximum event body / resulting clip | 12 seconds / 16 seconds |
| Unpinned live frame retention | 45 seconds; also enforce storage cap |
| Bedrock minimum start interval / concurrency | 1,200 ms / 1 globally |
| Explorer/reviewer timeout | 20 seconds / 45 seconds |
| Explorer output / reviewer output cap | 650 / 1,000 tokens |
| Explorer/reviewer attempts per session | 120 / 30, including retries |
| Reviewer attempts per rolling minute | 4 |
| Queued reviews / pending explorer snapshots | 8 / 1 |
| Queue wait deadline for preserved reviews | 120 wall-clock seconds |
| Desktop active-session poll | One request per second, stop when hidden or terminal |
| Maximum still image | 10 MiB, 40 megapixels, one image per image session |

The `us.` Sonnet identifier is a cross-region inference profile. Workshop policies may restrict it. Preflight must verify it; do not silently switch regions or providers. If an allowed in-region ID works, record that configured ID. See [AWS model identifiers](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html).

Create `shared/discoveryCourse.ts` with these objectives:

- `force-direction`: distinguish velocity direction from acceleration and net-force direction when evidence supports that comparison.
- `torque-moment-arm`: explain how force direction and perpendicular moment arm affect torque about a pivot.
- `projectile-free-flight`: distinguish velocity and gravitational acceleration in an explicitly stated ideal projectile model.
- `force-interaction`: identify a visible push/pull/contact as context for a conceptual force question without inventing force magnitude.

Module ID is `intro-mechanics-forces-torque`, version `1`. The new workspace uses this context; leave the old prepared projectile course UI intact.

## 5. Source adapters and timebase

### 5.1 Common rules

Internally use finite integer milliseconds relative to the source media beginning. Wall-clock time is only for timeouts, request budgets, and latency. Convert to seconds at the handoff boundary. Never use arrival time as the physical event time.

Every frame has a stable ID, sequence number, source timestamp, normalized orientation, dimensions, SHA-256, and server-relative file path. Decode and validate bytes before acknowledging a batch. Do not trust MIME type, extension, caller timestamps outside the allowed timeline, or client filesystem paths.

Maintain a source watermark: the latest accepted timestamp the detectors may inspect. In replay/live mode, no stage may inspect or extract future evidence beyond this watermark. An uploaded original may already be on disk; that is not permission for a replay detector to look ahead.

### 5.2 Uploaded images

Stream the original upload to a generated temporary path. Use `sharp` to inspect dimensions, apply EXIF rotation, reject decode failures/excessive pixel counts, convert transparency against a neutral background, and create a JPEG capped at 1,280 pixels on the long side. Remove metadata from the delivered image.

Create exactly one explorer job containing this image. If it produces a supported proposal, create one review job; merge multiple proposals into one image review to prevent duplicate charges. The action detector is `not applicable` in UI and creates no fake score. Review output must use `scene_context`, with null temporal fields.

### 5.3 Uploaded videos

Use streaming multipart upload, 500 MiB maximum, with one file part. Probe the completed file with `ffprobe -v error -show_streams -show_format -of json <server-path>`. Require a decodable video stream, finite duration in (0, 1,800], and dimensions below the configured pixel limit.

Normalize the analysis timeline to source playback time zero. Decode sampled frames using FFmpeg's timestamp-normalized 8-fps filter; index sampled frame `n` at `n * 125 ms`. These are analysis sample positions, not claims of original exposure times. Do not decode the full movie into RAM.

Illustrative argument array, not a shell-interpolated command:

```text
ffmpeg -nostdin -i <source>
  -vf setpts=PTS-STARTPTS,fps=8,scale=w='min(1280,iw)':h='min(1280,ih)':force_original_aspect_ratio=decrease
  -q:v 3 <generated-output-directory>/%08d.jpg
```

Treat quoting in this illustration as documentation; when using `spawn`, pass the filter string as one argument without shell quoting. Validate the decoded orientation and first/last frame against the original. Keep at most two seconds of unscheduled decoded frames ahead of the watermark; pause the child stream/process when the consumer applies backpressure or decode in bounded windows. Do not run an unbounded extraction into disk and discover the size cap only afterward.

`scan` mode advances source time as quickly as local inference and bounded queues permit. When the explorer/reviewer queue is full, apply backpressure; do not skip the entire file to satisfy wall-clock deadlines. `replay` advances at 1x monotonic elapsed time; Pause freezes the source watermark. Restart/seek creates a fresh processing generation and resets temporal history; ordinary result-video playback does not start another detection run.

Backpressure must not deadlock post-roll: continue source ingestion far enough to finish an already collecting candidate's bounded snapshot before waiting on the review queue. New independent windows can wait once that snapshot is complete. The queue scheduler continues running while source ingestion waits.

### 5.4 Phone frames

Use a top-level `/capture` page with `getUserMedia({video:{facingMode:{ideal:"environment"},width:{ideal:1280},height:{ideal:720}},audio:false})`. Call only from an explicit Start camera gesture. The `<video>` is `muted`, `playsInline`, and has the local preview. Do not mirror the actual captured image.

Use `requestVideoFrameCallback` when available; sample at most once per 125 ms. Use its media timestamp, normalized to the first frame. Fallback to a monotonic `performance.now()` clock and record that timing method. Preserve actual timestamps; do not calculate time as `frameCount / 8` on a real camera.

Capture with canvas and asynchronous `toBlob('image/jpeg', quality)`. Keep only one encode in flight. Fit within 1,280 pixels on the long side. If a frame exceeds 250 KiB, lower JPEG quality/size to fit or drop it with a counter. Orientation changes start a new session rather than silently mixing geometries/timestamps.

Batch up to 8 JPEGs in `FormData`, normally every 500 ms. Include the metadata specified in `FrameBatchMetadata`. Only one upload request is in flight. Keep at most two pending batches; if behind, drop the oldest unsent batch, record a visible capture gap, and keep the current scene. Do not let browser memory grow with network delay.

Server acknowledgement is idempotent by `(sessionId, seq)` and frame hash. Same sequence plus different bytes is a conflict. Monotonic timestamps are required for new frames. Exact retry of a batch is allowed. Reconnect after a camera stream/timestamp reset creates a new session; never reuse old timestamps in an existing timeline.

Pause sampling if the page becomes hidden, capture ends, or the session is stopped. Stop all tracks and timers on unmount. Show that the phone screen must remain on and the page foregrounded. This version does not promise mobile background recording.

For camera security requirements see [getUserMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia). The JPEG transport intentionally avoids relying on `MediaRecorder` timeslices as independent clips or accurate clocks; [timeslice delivery can be delayed](https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder/dataavailable_event).

## 6. Media snapshots and playable event clips

Immediately pin a candidate's relevant frames and pre-roll while it is collecting. At finalization copy/hardlink its complete bounded evidence into a candidate-owned snapshot, including frame index and hashes. A Bedrock queue must hold references to this immutable snapshot, not the moving ring buffer.

For uploaded videos, transcode the bounded source interval to silent H.264 MP4, `yuv420p`, fast-start, preserving aspect ratio, with zero-based output timestamps. Use an accurate trim/re-encode, not arbitrary stream-copy keyframe seeking. Preserve source motion detail; source fps can remain up to 30. Strip audio. Probe the result before publishing it.

For live frames:

1. Let `startMs` be the first preserved frame's source timestamp. Let `endMs` be the selected last timestamp plus one 125-ms display interval.
2. Build an 8-fps output grid over that interval, choosing the most recent actual frame at or before each grid time. This preserves elapsed time when samples are missing instead of accelerating the event.
3. Only create an observed-action review if the event body has no gap larger than 500 ms and has sufficient distinct frames. Record shorter gaps. If the body crosses a larger gap, resolve `insufficient_evidence` locally with a diagnostic reason; do not manufacture interpolated motion.
4. Encode the chosen real frames to silent H.264 MP4; probe output duration/dimensions. Repeated frames are display holds, not recovered measurements.
5. Set `fidelity: sampled_camera_frames`, `nominalFps: 8`, and timing uncertainty to at least one 125-ms sample interval; increase it for recorded clock or gap uncertainty.

Use a generated temporary image sequence and `ffmpeg -framerate 8 -i %08d.jpg -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart <output.mp4>`, with an even-dimension scale/pad filter as needed. The sequence is bounded to at most 16 seconds. Shell interpolation is forbidden; use executable/argument arrays. Verify codec support during preflight. See [FFmpeg image sequences and formats](https://ffmpeg.org/ffmpeg-formats.html).

Derive the published clip duration from the probed output. Source bounds represent the corresponding source interval, not independently rounded guesses. Allow at most one output-frame interval of rounding discrepancy and disclose it as timing uncertainty. Evidence time is `(sourceFrameTimeMs - sourceStartMs)/1000`, checked against the actual clip.

Frame IDs supplied to the reviewer are server-created. The reviewer refers to IDs, never invents timestamps. The server maps IDs into clip-relative times. If the requested review frame was not delivered, fail validation.

Assets become visible only after encoding, probing, hashing, and atomically renaming the final file. A review may be ready before encoding finishes, but no approved-event notification may be issued until both steps succeed. Asset routes support byte ranges for video seeking.

## 7. Action recognition and temporal grouping

The model implementation is in [MODELS-AND-DATA.md](MODELS-AND-DATA.md). The Node scheduler hands the persistent Python worker 16 server-owned frame paths and timestamps. The worker returns per-class scores plus actual model/version metadata. It never returns a teaching verdict.

For each supported class maintain `idle` or `active`, an earliest supporting window start, last supporting end, peak score, consecutive-low-support count, and consecutive-exit count. Pure reducer logic is unit-testable.

Initial trigger rules:

```text
high = class score >= manifest.highThreshold
moderate = class score >= manifest.lowThreshold
idle -> active if high OR moderate on two consecutive valid windows
active -> update lastSupportEnd whenever moderate
active -> close after two consecutive windows below manifest.exitThreshold
active -> force a bounded close when event body reaches 12 seconds
stop/end-of-input -> close any active event using available evidence
```

Windows that are missing, invalid, or skipped due to overload do not count as negative evidence. On a gap >500 ms, reset local temporal history and close/flag the incomplete candidate. For a target run longer than 12 seconds, mark continuation; do not repeatedly charge for adjacent parts of one sustained interaction without a meaningful new onset.

Raw softmax scores are uncalibrated. Thresholds are initial values and must be recorded in the model manifest. Do not reuse a threshold tuned for the custom 3-class head without evaluation on a 400-class pretrained baseline. Suggested baseline high/low defaults are 0.30/0.15 for `shooting basketball`, clearly labeled provisional.

The earliest supporting window start is an approximate event start, not contact/release localization. Preserve this uncertainty. No tracking/bounding boxes are required for this deliverable.

Worker throughput policy: one active inference. For live/replay, keep only the newest pending window and count skipped windows; never grow an infinite backlog. For offline scan, wait for every requested window. If p95 local inference exceeds the 1-second stride, expose degraded processing and increase stride to the next whole second, up to 4 seconds, recording it in evaluation. Do not claim uninterrupted event coverage.

## 8. Explorer scheduling

Explorer inputs are up to six chronological frames spanning the latest eight source seconds. Schedule the first video check once enough source evidence exists (at 8 seconds), then every 10 source seconds. A still image gets one check immediately. Finalize an upload with one remaining unsampled tail check if useful and within budget.

Independence is mandatory: no action-model trigger is required. The baseline does not need scene-change detection; add it only after the interval path is proven, and count extra calls against the same budget.

Snapshot/pin frames before enqueueing. In live mode retain only the newest unsent explorer snapshot, releasing the previous snapshot. Do not enqueue catch-up checks for every missed timer tick. Offline scan applies backpressure instead of dropping scheduled exploration windows.

Model output is `ExplorerModelOutput`, maximum two proposals. Convert frame-ID boundaries to source timestamps only after all IDs pass validation. `weak` proposals remain diagnostic-only unless another signal upgrades the same candidate. `moderate` and `strong` proposals can independently reach the reviewer; they need not be supported by the local recognizer.

Explorer self-reported support is qualitative, not calibrated probability. Store `rawScore: null` and `scoreMeaning: self_reported_support`.

## 9. Fusion, finalization, and duplicate prevention

Only merge candidates in the same session/generation, with the same opportunity kind and compatible family:

- `opening_hinged_door` and rotation interactions map to `rotation`.
- `basketball_shot` and visible throws map to `projectile`.
- Other push/pull interactions map to `force_interaction`.
- Still/static scene context maps to `static_context`.

Temporal condition: interval intersection-over-union >=0.30, or an endpoint gap <=500 ms **while the same local action episode remains active**. Do not merge separate throws just because their labels match. For images, merge within the same source image hash; one image leads to one review.

Do not merge a static-door context proposal into an action candidate and call that action agreement. It is related context, not confirmation of motion. Separate simultaneous actors may remain ambiguous because v1 has no identity tracker; the reviewer must be able to reject such evidence.

Priority (lower number dispatches first):

1. Both detectors support the same event with compatible observations.
2. One strong detection, or a moderate explorer proposal.
3. A local moderate episode that passed the persistence rule.

Within each priority use earliest queued time. Promote a candidate after 30 seconds of waiting to avoid starvation. A candidate does not wait indefinitely for the other detector; post-roll and a maximum 2-second fusion grace period are sufficient. Late evidence may be attached to an existing result's diagnostics, but does not automatically cause another paid review.

Once an event ends, await post-roll up to `end + 2 seconds`, bounded by source end/Stop. Freeze the snapshot, create a clip, and enqueue review. At end-of-input truncate post-roll honestly. Never require nonexistent future frames to finish a session.

Deduplication layers:

1. Frame retry identity: session + sequence + content hash.
2. Candidate episode identity: session + generation + family + overlapping active episode.
3. Review identity: snapshot hash + course version + reviewer model ID + prompt version + frame-selection version.
4. Notification identity: approved event ID (only once per client).

For a static scene repeated by the explorer, suppress near-identical context for 60 source seconds when the normalized frame's perceptual difference is below a configured threshold. Log this heuristic; it is not physics inference. A new image upload gets a new session but may reuse an exact-hash cached verdict with its provenance. No approximate global cache across unrelated videos.

Make that initial static heuristic concrete: fit each representative frame into a 16×16 grayscale canvas preserving aspect ratio with neutral padding; divide pixels by 255; calculate mean absolute difference. Treat <=0.04 as near-identical only for the same static family in the same session. This is a tuning default and may suppress subtle opportunities; record its effect during evaluation. Do not use it to declare action agreement or reject all motion candidates.

## 10. Bedrock transport, budgets, and validation

Extract `converse` from `server/index.ts` into `server/bedrock.ts` and accept `modelId`, `timeoutMs`, and normalized messages per call. Preserve the existing AWS SDK and bearer-token options. AWS SDK image bytes are `Uint8Array`; the direct REST path base64-encodes bytes. A shared converter must avoid encoding bytes twice.

Use Nova Lite for the explorer and Sonnet for review initially. Send timestamp-labeled JPEG frames to both. Sonnet's documented input includes images but not raw video, so do not attach a video blob to its Converse request. AWS limits image counts/sizes; this spec's 6/12 frames and normalized dimensions stay below the documented 20-image ceiling. [Converse documentation](https://docs.aws.amazon.com/boto3/latest/reference/services/bedrock-runtime/client/converse.html)

Use the exact instructions in [PROMPTS.md](PROMPTS.md), `temperature: 0`, and bounded output lengths. Do not enable extended thinking or tool use for these classification calls. Nova Lite structured-output support must not be assumed; parse JSON and validate locally.

### Scheduler rules

- One global Bedrock invocation at a time, minimum 1,200 ms between starts, including legacy tutor calls if they use the same process/account.
- Disable invisible SDK retries (`maxAttempts: 1`); the application owns the single allowed retry and its accounting.
- Reserve a budget unit and write `started` to the ledger before dispatch. Every attempt consumes a unit, including failures and retries.
- Retry only clear throttling/transient server failures, once, with jittered backoff and remaining budget. A timeout or broken connection after dispatch has unknown billing/result status: mark `unknown`, do not automatically replay it.
- No retry for invalid credentials, forbidden model/profile, invalid model JSON, or semantic validation failure. Show actionable errors; do not switch to fabricated success.
- On credential/access failures, trip a circuit breaker for the affected model until explicit retry/reconfiguration. Capture/local action detection may continue with bounded storage.
- Every session has 120 explorer-attempt and 30 reviewer-attempt caps; reviewer rolling-minute cap is 4. Exceeding caps stops new work of that type and records `budget_exhausted`; it does not cancel approved events.
- Review queue capacity 8. Live mode suppresses the lowest-priority new candidate when full, preserving the reason/counter. Offline scan waits for capacity.
- Keep only the latest queued explorer snapshot in live mode. Between review jobs, dispatch an explorer waiting over 20 seconds so the exploratory path is not permanently starved.
- A persisted candidate may wait at most 120 wall-clock seconds; on expiry mark failed with `REVIEW_QUEUE_TIMEOUT`, not `not_teachable`.

Accumulate actual returned usage. Missing token counts are null, not zero. Compute estimated cost only if a dated per-model price configuration exists; otherwise show calls/tokens and `cost unavailable`. Reduced expensive-call count alone does not establish total cost savings: the explorer also costs money.

### Parsing and semantic validation

Allow a JSON object or a single enclosing JSON Markdown fence. Reject leading/trailing prose, multiple JSON objects, truncated output, and oversized text. Do not recover arbitrary substrings by taking the first `{` and last `}` as the current legacy endpoint does.

Implement strict Zod objects with no unknown keys. Enforce all enums, finite numbers, maximum lengths, list bounds, unique frame IDs, allowed objective IDs, and source-boundary constraints. The model never chooses IDs, URLs, file paths, model provenance, or usage numbers.

Additional review rules:

- All referenced frame IDs must come from the exact request snapshot.
- `teachable` requires at least one valid objective, concept, and evidence item.
- `observed_action` requires video input and evidence from at least two distinct times. A photo can only be `scene_context`.
- Concept/objective mappings must agree with the fixed course.
- Reviewer may downgrade an action candidate to scene context. It must explain that change.
- Invalid model output is `MODEL_OUTPUT_INVALID` and a failed review, never a scientific rejection.
- Transient infrastructure failure is not a verdict. Do not export an approved event without validated review and retrievable media.

## 11. State machines and cancellation

Session transitions:

```text
created -> waiting_for_input -> running
running <-> paused
running/paused -> draining -> completed
running/paused -> draining -> stopped   (explicit user Stop)
any nonterminal -> failed              (fatal source/storage error)
active at process restart -> interrupted
```

Stop means stop ingest and finish already captured candidates, including truncated post-roll. Cancel means stop ingest and cancel pending/in-flight processing, after which terminal state is `stopped`. The API distinguishes them. A separate Delete operation cancels first and removes session assets.

Each asynchronous task captures `(sessionId, processingGeneration, candidateRevision)`. Before storing a result, recheck that the session still exists and generation is current. Cancel increments generation and aborts work where possible. A late model response from a deleted/restarted session must not resurrect a result.

Candidate path:

```text
collecting -> awaiting_media -> queued -> reviewing
                                      -> approved/rejected/insufficient_evidence
pre-review -> suppressed/budget_exhausted/cancelled/failed
reviewing -> failed/cancelled
```

`not_teachable` maps to candidate `rejected`. Preserve both the transport state and the scientific verdict so UI never confuses failure with rejection. Local evidence-quality failure may mark candidate `insufficient_evidence`, but has no fabricated Bedrock `ReviewResult` and produces no completed `DiscoveryEvent`.

## 12. HTTP API and authorization

### Authorization

Use a controller login for the laptop: `POST /api/discovery/auth` with `{accessCode}`. Compare against the configured secret with timing-safe comparison. Issue a random server-held session cookie, HttpOnly, SameSite=Strict, Secure in HTTPS mode. Never bake the access code into Vite environment variables. Logout revokes the cookie. For the teammate's local server-to-server integration, permit the same controller secret as an Authorization Bearer credential over HTTPS/loopback; never put it into a URL.

Controller credentials can manage/read sessions and assets. Phone credentials can ingest, heartbeat, and start/pause/resume/stop their one paired live session. They cannot create other sessions, cancel/delete stored media, list events, call Bedrock directly, or retrieve other media. Phone control responses contain only that session's safe state/configuration.

Pairing: the controller creates a cryptographically random, single-use token (32 bytes), expires after 10 minutes. QR URL is `<publicOrigin>/capture#pair=<token>`. The phone POSTs it to `/pairings/redeem`; the server atomically consumes it and issues a scoped HttpOnly phone cookie. Remove the fragment with `history.replaceState`. Do not log tokens or include third-party assets on the capture page.

Require an exact configured Origin for browser mutation requests; same-origin assets and controller calls are allowed. Handle invalid Origin headers with a structured 403, not an uncaught `new URL()` error. Do not set wildcard CORS. Validate auth before accepting large request bodies.

### Routes

All routes below are under `/api/discovery`. JSON error shape is `DiscoveryError` from `contracts.ts`. Inputs use strict Zod validation. Creation/upload returns 201/202 as indicated. Every mutation takes an `Idempotency-Key` except camera batches, which use batch/sequence identity; cache successful mutation responses for the session lifetime.

| Method/path | Request | Response / semantics |
| --- | --- | --- |
| `GET /config` | Controller auth | Safe defaults, course, model IDs/status, frame caps, public origin; no secrets |
| `POST /auth` | `{accessCode:string}` | 204 + controller cookie; login rate limit |
| `DELETE /auth` | Controller cookie | 204, revoke cookie |
| `POST /preflight/models` | Controller, `{}` | 202 job ID; explicitly starts bounded real image-capable checks, charged/logged as preflight |
| `GET /preflight/:jobId` | Controller | Status and per-model errors/usage, no credential values |
| `POST /sessions` | `CreateSessionRequest` | 201 `SessionSnapshot`; one active ingest session |
| `GET /sessions/:id` | Controller | `{session, candidates, events, nextRevision}`; full compact snapshot, no image bytes |
| `POST /sessions/:id/source` | Controller, multipart `file` | 202 `{assetId,status:"validating"}`; one source per upload session |
| `POST /sessions/:id/start` | Controller or paired live phone, `{}` | 202 snapshot; phone calls after camera permission succeeds |
| `POST /sessions/:id/pause` | Controller or paired live phone, `{}` | 200 snapshot; replay/live capture ingestion paused; settle in-flight jobs |
| `POST /sessions/:id/resume` | Controller or paired live phone, `{}` | 200 snapshot; maintain source timeline; new camera stream requires new session |
| `POST /sessions/:id/stop` | Controller or paired phone, `{}` | 202 snapshot, drain captured evidence |
| `POST /sessions/:id/cancel` | Controller, `{}` | 202 snapshot, invalidate processing generation |
| `DELETE /sessions/:id` | Controller | 204 once tasks are cancelled and owned assets removed |
| `POST /sessions/:id/pairings` | Controller, `{}` | 201 `{pairingUrl,expiresAt}`; only live-phone sessions |
| `POST /pairings/redeem` | `{token:string}` | 201 `{sessionId,config}` + scoped phone cookie |
| `POST /sessions/:id/frames` | Phone cookie; multipart metadata + JPEG parts | 202 `FrameBatchResponse` |
| `POST /sessions/:id/heartbeat` | Phone cookie, `{lastSeq,visibility,cameraState}` | 200 `{acceptingFrames,state}`; every 5 seconds |
| `GET /sessions/:id/events` | Controller, optional `verdict`, `afterEventId`, `limit<=50` | `{events:DiscoveryEvent[],nextCursor}` ordered by created sequence |
| `GET /events/:eventId` | Controller | `DiscoveryEvent` including non-approved model verdicts for diagnostics |
| `GET /assets/:assetId` | Controller/session ownership | JPEG/MP4 with Content-Type, byte-range support, no directory browsing |
| `GET /sessions/:id/export` | Controller | Download JSON containing session metadata, event records, and redacted counters |

`processingMode` compatibility: image→image; uploaded_video→scan or replay; live_phone→live. Reject incompatible combinations with 422. Before adding a second source to a session, return 409; do not mutate a running source.

Frame multipart metadata is `FrameBatchMetadata`: one JSON `metadata` part (<=16 KiB), 1–8 distinct named JPEG parts, each <=250 KiB, entire request <=2.2 MiB. Reject mismatched metadata/parts, timestamps >5 seconds beyond the last accepted live timestamp without a visible gap record, or sequence reuse with changed bytes. First accepted live timestamp must be approximately zero; normalize on the client.

The metadata's `gaps` array explicitly reports intervals skipped since the previous acknowledged batch; the server independently detects timestamp gaps as well. Gaps use source milliseconds, must be monotonic/in bounds, and cannot erase an independently detected gap. After Pause/Resume, keep the same camera clock and report the paused interval. If the underlying camera stream restarted, require a new session instead.

Validate the entire batch before mutation. Within a batch, sequence numbers and times must increase. Already accepted exact duplicates may precede new frames; they never move the watermark backward. Every new frame must follow the last accepted sequence/time. Reject a conflicting/reordered batch atomically with 409/422. At source time 1,800 seconds, stop ingestion and drain instead of accepting an unbounded live session.

`/sessions/:id` returns at most 100 compact candidate summaries and event summaries; full event detail is fetched separately. Return HTTP 304 if `If-None-Match` matches the session revision. Browser polling is one combined request per second, with exponential backoff on network errors. Polling itself never schedules model work.

### Middleware changes

The legacy 40/minute IP bucket would reject live capture and polling. Register authenticated discovery routes before it. Apply separate bounds: frame batches <=180/minute/session, controller reads <=180/minute/controller, control writes <=30/minute/controller, pairing redemption <=10/minute/IP, auth attempts <=5/minute/IP. Use rolling windows and structured 429 plus Retry-After. These HTTP limits do not replace the model scheduler.

Keep JSON small per route; do not globally raise `express.json` to hundreds of megabytes. Multipart uploads stream to disk with disconnect cleanup, per-part caps, total caps, and timeouts. Register an explicit JSON 404 for `/api/*` before the SPA fallback, so a typo cannot return HTML with status 200.

## 13. HTTPS setup and phone connection

Phone mode serves the built React app and API from **one HTTPS origin** on the laptop. Use Node HTTPS around the Express app, reading configured certificate/key paths. Normal Vite development stays on loopback HTTP. The operator opens the laptop console at the same configured HTTPS origin before generating the QR.

Provide a runbook for a locally trusted certificate with LAN hostname/IP SANs. `mkcert` is one documented option; phone trust is a separate device setup step. Never commit the root private key, distribute it to a phone, or recommend bypassing a browser warning. The user must perform device trust/permission steps when needed. [mkcert mobile instructions](https://github.com/FiloSottile/mkcert#mobile-devices)

Check these in order:

1. Laptop and phone can reach each other; guest Wi-Fi client isolation may prevent it.
2. Leaf certificate covers the exact host/IP in the QR.
3. Phone trusts the issuing certificate and the page is a secure context.
4. Pair token redeems once and captures are scoped to that session.
5. Camera permission is accepted by the user and rear-camera preview appears.
6. Frames reach the desktop and a short real event produces a retrievable MP4.

If networking/certificate setup is blocked, retain working uploads and report live mode as unverified/blocked. Do not silently route private footage through a public tunnel or deploy a service to a new host. Those would be separate infrastructure choices.

## 14. Minimal UI

Add a `Discovery` navigation item without altering the current coach/lab UI. At application bootstrap, route pathname `/capture` to `PhoneCapture` before rendering the desktop app. No router dependency is necessary for these two entrypoints.

Desktop workspace:

- Input cards: Upload video, Upload photo, Connect phone.
- Input notice: uploads/camera frames are stored on this laptop server; selected evidence frames go to the configured AWS models. Live event clips are sampled at 8 fps and silent. Original uploaded recordings are handled differently from the legacy frame-only analysis flow, so describe the new data flow accurately.
- Uploaded video choice: Scan recording or Replay as live (1x). Plain explanation of each.
- Fixed course summary: Forces and torque, including projectile motion.
- Start/Pause/Resume/Stop controls appropriate to the mode; Cancel available in diagnostic actions.
- Status: receiving frames, recognizing actions, exploring, reviewing, ready, or degraded/error.
- Approved cards: playable event clip/image, concise observation, concept tags, verdict reason, limitations, Download JSON, Download media.
- In-page notification: “A physics moment is ready” with Open. Only after valid approved media and verdict; exactly once per event ID. No automatic browser push permission.
- Diagnostics disclosure: individual detector evidence, actual model versions/modes, candidate state/rejection reason, queue depth, real calls/tokens/cost availability, dropped frames, current sampling/stride.
- Model connection/preflight control explicitly invokes the test; mounting the page does not consume tokens.

Phone page: paired session label, local preview, Start camera, Pause/Resume, Stop, upload/connection indicator, dropped-frame warning. No course editor, lesson UI, or AWS settings. Preserve frontend accessiblity: keyboard controls, labels, status regions, readable narrow layout.

Preserve the old demo's prepared labels. The new Discovery area must not automatically turn a `DiscoveryEvent` into a legacy `Moment` by filling in fake question/anchor fields.

## 15. Failure behavior

| Failure | Required behavior |
| --- | --- |
| No AWS credentials | Local detection works if available; explorer/reviewer show unavailable; no fake verdict |
| Reviewer denied/profile restricted | Trip reviewer circuit breaker; bounded pending candidates; show exact stage and safe error |
| Action weights absent | Explicit pretrained basketball baseline or disabled action detector; no invented door classifier |
| Python crashes | Mark unavailable; fail active inference; restart once with bounded backoff; explorer still independent |
| Phone goes background/disconnects | Gap/connection warning; do not claim continuous observation; end incomplete event honestly |
| Capture gap crosses event | Insufficient-evidence diagnostic; no invented motion |
| Empty explorer result | Normal “nothing proposed”; no review call |
| Invalid model JSON/frame IDs | Failed stage and usage recorded; no lesson notification |
| Queue full/budget cap | Suppression reason/counters, continue bounded capture/local inference |
| Media encode fails | Candidate failure; never publish an unusable media URL |
| Session cancelled/deleted during review | Abort if possible; charge ledger retained where appropriate; discard late response |
| Identical HTTP retry | Same mutation result/frame acknowledgement; no duplicate call or event |
| Server restart | Finished media/results survive; active sessions interrupted; no surprise paid resume |

## 16. Verification and completion

Use deterministic pure tests and an injectable fake Bedrock transport for orchestration tests; production mode never falls back to fake responses. Media integration tests use a tiny synthetic timestamped video only to verify frame/clip timing, explicitly separate from real detector-quality evaluation.

Required checks are assigned per ticket in [TASKS.md](TASKS.md). Final completion requires:

- Existing tests and production build pass.
- Runtime contracts reject invalid evidence and distinguish verdicts from failures.
- Actual uploaded image/video calls work on allowed models, with real usage records.
- Both detection paths can nominate independently and agreement is observable without double reviewing.
- Custom training artifacts/provenance exist if claiming custom training.
- At least one actual phone-to-laptop event passes end-to-end, or live support is explicitly reported incomplete.
- Teammates can retrieve the exported media and JSON with documented authorization.
- A held-out evaluation report shows misses, false candidates, approved-event quality, latency, and total model cost/usage. No accuracy or savings claim is inferred from mocks.

Numeric recognition quality is not guaranteed by architecture. The implementation must report the measured result and remaining work rather than declare success merely because the UI is polished.
