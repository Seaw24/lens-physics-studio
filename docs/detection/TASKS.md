# Ordered implementation tickets

> Superseded architecture (September 16, 2026): read [VISION-FIRST-DIRECTION.md](VISION-FIRST-DIRECTION.md) first. The custom action-training requirement and mandatory two-detector design are withdrawn. This document retains historical details; do not execute its old training plan or copy its detector schema as the new design.

Execute these tickets against the existing repository. The estimates are planning timeboxes, not guarantees. Preserve existing functionality and user changes. Update `IMPLEMENTATION-STATUS.md` after each ticket with actual commands/results; do not premark a task completed because its file exists.

The target is 24 hours total. Start model/data access checks early. Independent downloads or feature extraction may run while application work continues, but keep resource usage visible. A blocked training ticket is not permission to present a pretrained baseline as trained.

## D00 — Establish a reproducible environment and access checks

**Timebox:** 45 minutes. **Depends on:** none.

Actions:

- Read the repository instructions, this spec pack, package scripts, and current Git status.
- Confirm Node >=22 and a supported Python 3.11 environment. If `npm` is not on PATH, locate the configured runtime; do not scatter unrelated system installations.
- Install the current locked Node dependencies and run the existing test/build commands once. Record pre-existing failures separately.
- Verify FFmpeg and FFprobe availability and H.264 encoding on a tiny local fixture.
- Check whether workshop credentials are configured without printing their values. Do not assume the browser session is already an SDK credential.
- Resolve dataset access/terms and model-weight downloads. Apply the 60-minute initial data-access limit from MODELS-AND-DATA.md.
- Create the implementation status log, with unverified Bedrock invocation and real-phone testing explicitly pending.

**Acceptance:** reproducible executable paths and baseline test/build results recorded; no credentials committed; precise blockers identified. Do not create GPU infrastructure solely because SageMaker appears in the workshop list.

## D01 — Implement shared schemas and fixture validation

**Timebox:** 45 minutes. **Depends on:** D00.

Files: `shared/discovery.ts`, `shared/discoveryCourse.ts`, `tests/discovery-contract.test.ts`.

Actions:

- Implement types and strict Zod schemas matching `contracts.ts`.
- Implement semantic validation in functions accepting the trusted frame index and course.
- Add the fixed objective IDs and versioned mapping.
- Copy/adapt the approved/rejected/insufficient/photo model fixtures into tests with `exampleOnly:true` where applicable.
- Document contract 1.1 as the teammate boundary. Do not modify the legacy `Moment` requirements.

**Tests:** approved video validates; approved photo requires scene context/null times; unknown frame/objective IDs fail; NaN/infinite/negative times fail; evidence beyond clip duration fails; both-detectors fusion cannot contain only one detector; teachable with no objective/evidence fails; malformed/trailing JSON fails; rejected model verdict differs from infrastructure failure.

**Acceptance:** fixtures validate through actual runtime schemas and semantic checks, not only TypeScript compilation.

## D02 — Session persistence, authorization, and API shell

**Timebox:** 90 minutes. **Depends on:** D01.

Files: `server/discovery/{config,auth,store,router,service}.ts`, `server/index.ts`, API integration tests.

Actions:

- Implement one active ingest session, lifecycle records, generated paths, atomic writes, and revision numbers.
- Implement controller authentication and session-scoped phone pairing token redemption.
- Add session create/read/control/export routes and structured errors; initially return unavailable detector status instead of pretending inference works.
- Place new routes before the old 40/minute limiter and SPA fallback. Add explicit API 404 behavior.
- Implement separate HTTP rate buckets and idempotency-key storage. Do not log payload media or tokens.
- Persist active sessions as interrupted after a simulated restart; never restart paid jobs automatically.

**Tests:** unauthorized control/asset access fails; phone scope cannot list/read another session; expired/reused pair token fails; concurrent redemption succeeds exactly once; controller mutation retry is idempotent; invalid Origin yields 403; malformed path cannot escape storage root; API typo returns JSON 404; >40 valid frame/read requests do not hit the legacy bucket.

**Acceptance:** routes are real and state persists safely. Test with an HTTP server on an ephemeral port using Node fetch; no external database required.

## D03 — Uploads, frame timelines, and event media

**Timebox:** 2 hours. **Depends on:** D02.

Files: `server/discovery/{media,frames}.ts`, media tests.

Actions:

- Stream bounded multipart input; normalize images and probe videos.
- Implement sampled video decoding with source-time normalization and bounded backpressure.
- Implement frame records, content hashes, ring retention, immutable snapshots, and pin/release behavior.
- Implement silent uploaded-video clip extraction and live-frame MP4 reconstruction.
- Validate/probe output before asset publication; implement authenticated byte-range serving.
- Implement cancellation/cleanup when upload disconnects or source validation fails.

**Tests:** timestamped fixture yields the expected source segment within one frame; portrait orientation remains correct; real media duration matches handoff fields; Range returns 206 and valid bounds; event crossing the ring boundary retains lead-up; repeated/missing live frames preserve elapsed time; >500-ms body gap never manufactures motion; rejected/partial uploads leave no usable public asset; queued evidence survives ring eviction.

**Acceptance:** a teammate can retrieve and seek a correctly bounded playable clip. Synthetic timestamp fixtures verify mechanics only, not AI performance.

## D04 — Real Bedrock explorer and reviewer adapters

**Timebox:** 90 minutes. **Depends on:** D01–D03.

Files: `server/bedrock.ts`, `server/discovery/{explorer,reviewer}.ts`, prompt constants, transport tests.

Actions:

- Extract shared Converse transport and support per-call model IDs/timeouts without breaking `/api/tutor`.
- Implement SDK/REST image-byte conversion correctly; no raw video is sent to Sonnet.
- Add versioned prompts, strict output parsing, frame/objective validation, and server-added provenance.
- Add explicit model-preflight API/script that invokes an image-capable check only when requested.
- Record usage and safe errors. Return unavailable/failed states if access is missing.

**Tests:** SDK receives byte arrays and REST receives base64; malformed JSON and fake IDs are rejected; image input cannot produce observed action; reviewer can downgrade action to scene context; no empty approval; injected transport errors remain failures; old tutor path remains functional in rehearsal.

**Real check:** run one permitted explorer and reviewer request with real imagery appropriate to the workshop restrictions, record actual model IDs/latency/usage, and verify configured access rather than merely listing models.

**Acceptance:** real verified results work with a selected image or clip snapshot. No generated questions/annotations in the discovery output.

## D05 — Persistent temporal action baseline

**Timebox:** 90 minutes. **Depends on:** D01/D03; ML environment from D00.

Files: `ml/{requirements,preprocess,worker}.py` (requirements is `.txt`), `server/discovery/worker.ts`, worker tests.

Actions:

- Load the documented MC3-18 weights once and use exact shared preprocessing.
- Resolve the basketball class by metadata string, preserve the original head for baseline mode.
- Implement the JSON-lines protocol with safe paths, timeouts, request identity, and stderr logs.
- Handle worker crash/timeouts and model-mode visibility. Images must not call the action worker.
- Benchmark 20 consecutive windows after warmup on the laptop; record p50/p95, device, and memory observations.

**Tests:** request/response IDs remain paired; bad paths/frame counts fail; stdout logging cannot corrupt protocol; stale responses after timeout are ignored; a missing custom model never reports custom mode; a phone gap invalidates the window; preprocessing shape is exactly `[1,3,16,112,112]` for this backbone.

**Acceptance:** a real temporal model returns measured scores and its provenance. This ticket alone is not completion of custom training.

## D06 — Train and package the custom action head

**Timebox:** 3 hours initially; revisit remaining training work after independent tickets if data access blocks it. **Depends on:** D00/D05.

Files: `ml/{manifest,extract_features,train_head,evaluate}.py`, ignored artifacts, provenance/metrics summaries.

Actions:

- Validate official training sources and selected rights/access conditions.
- Read DATASET-AUDIT.md. Fully decode acquired videos, apply publisher corrections, and record visual acceptance/rejection for every pilot training window. Add real temporal context around short EPIC actions and locate shots inside coarse Kinetics intervals. Do not treat a dribbling clip as entirely negative without inspecting it.
- Create group-separated manifests with target positives and matched negatives from both kitchen and sports domains.
- Extract frozen features once; train the three-class head with the specified recipe.
- Select checkpoint/thresholds from validation only; save a full real model manifest.
- Run custom inference through the same persistent worker and compare to baseline on development footage.
- If a class lacks data, request targeted footage and leave that training capability explicitly incomplete.

**Tests/checks:** no recording/participant leakage across splits; no duplicate hashes across splits; class order/preprocessing hashes match runtime; saved checkpoint reload reproduces logits within numeric tolerance; reported counts come from the actual manifest; `other` examples exist in both source domains.

**Acceptance:** custom-head artifacts, provenance, and validation results exist. Accuracy may still be poor; record it. Checkpoint existence or lower training loss is not evidence of reliable live detection.

## D07 — Temporal grouping, fusion, scheduling, and budgets

**Timebox:** 2 hours. **Depends on:** D03–D05. Custom weights can be connected after D06.

Files: `server/discovery/{action,fusion,scheduler,service}.ts`, deterministic reducer/queue tests.

Actions:

- Implement local episode grouping with manifest thresholds, gap resets, end-of-input flush, and bounded duration.
- Schedule explorer windows independently on source time; keep live and offline backpressure policies distinct.
- Implement temporal/family fusion, priority, weak/moderate/strong handling, and the bounded grace period.
- Pin/freeze candidate media, run review, and atomically publish completed events.
- Implement one global cloud invocation, start-spacing, retries, circuit breakers, call reservations, and usage ledger.
- Implement cancellation generations, late-result discard, queue limits, and exact cache keys.

**Tests with fake clocks/transport:**

1. Local-only qualifying signal reaches review once.
2. Explorer-only moderate signal reaches review once.
3. Compatible agreement promotes one candidate and generates one review.
4. Static context is not treated as independent action confirmation.
5. Two distinct throws remain separate after an exit/onset gap.
6. Empty/weak-only exploration makes no reviewer call.
7. Scheduled exploration happens when the action detector finds nothing.
8. Video end/Stop completes truncated post-roll without waiting forever.
9. Global spacing/concurrency and per-session/minute budgets hold under simultaneous proposals.
10. Retries consume attempts; unknown timeout is not automatically retried.
11. Queue saturation releases dropped snapshots and records suppression.
12. Cancel/delete during inference never resurrects an approved event.
13. Replaying an approved event does not invoke a model.
14. A delayed queue reads pinned media, not evicted/reused frame paths.

**Acceptance:** end-to-end orchestration is deterministic under injected scores/replies and functional with real adapters.

## D08 — Desktop discovery workspace and uploaded inputs

**Timebox:** 90 minutes. **Depends on:** D07.

Files: `src/discovery/{DiscoveryWorkspace,DiscoveryEventCard,useSession,api}`, scoped CSS, small `App.tsx` integration.

Actions:

- Add Discovery navigation and isolated state; retain existing coach/lab behavior.
- Implement uploaded photo/video flows, scan/replay mode, controls, and combined polling.
- Show real model/connection states, verdicts, media, limits, and Download JSON/media actions.
- Show approved-event notifications exactly once. Keep rejected/failed candidates in diagnostics.
- Make model preflight an explicit user action, never a mount side effect.
- Keep a stable event handler/poll cleanup so StrictMode/remount does not double-start work.

**Checks:** real photo and video upload work; replay never analyzes future source frames; pause freezes source progression; toggling tabs/playback does not generate model calls; empty results are acceptable; aborting an upload cleans up; narrow layout and keyboard interaction work; no fabricated legacy question fields are inserted.

**Acceptance:** user can inspect a real verdict and export the teammate handoff from the desktop UI.

## D09 — Same-Wi-Fi phone capture

**Timebox:** 3 hours including actual-device setup. **Depends on:** D02/D03/D07/D08.

Files: `src/discovery/{PhoneCapture,capture}`, app bootstrap route, Node HTTPS startup, setup instructions.

Actions:

- Serve built app/API on one configured trusted HTTPS origin; retain local HTTP development.
- Add QR pairing/redeem flow with scoped cookie, expiration, and fragment removal.
- Implement rear-camera preview, 8-fps timestamped JPEG sampling, bounded batches, retries, backpressure, and heartbeat.
- Pause hidden pages, stop tracks on exit, handle permission/network failures, and expose gaps.
- Generate event MP4s from captured frames with disclosed sampled-frame fidelity.
- Provide precise device trust/network instructions; the user performs required phone steps. Do not bypass browser warnings or silently use a third-party tunnel.

**Automated checks:** duplicate/reordered batch handling, changed bytes under same sequence conflict, rate-limit separation, stale pair token rejection, bounded capture queue, cancellation while uploads are in flight.

**Actual-device check:** phone pairs, previews, uploads, detects at least one real interaction or explorer context, receives a real reviewer verdict, and laptop can play/download the resulting media. Record phone/browser, observed fps, gap behavior, and latency. Lock/background the phone and verify the UI reports interruption honestly.

**Acceptance:** real device validation recorded. Simulating a phone viewport alone does not complete this ticket.

## D10 — Failure paths, data boundaries, and regression pass

**Timebox:** 2 hours. **Depends on:** D01–D09, with explicit exceptions for external blockers.

Actions:

- Exercise the failure table from IMPLEMENTATION.md.
- Verify no credential, local absolute path, raw model payload, or other session's media appears in user-facing errors/log exports.
- Ensure expired/auth failures stop repeated paid calls; missing usage stays null.
- Check source-length, pixel-count, file-size, queue, and disk caps using bounded fixtures.
- Check restart/interrupt semantics and late-result discard.
- Run all existing and new tests, TypeScript/build, and desktop/phone smoke checks.

**Acceptance:** material failure cases have meaningful tests or recorded manual evidence; existing teaching demo still works.

## D11 — Held-out evaluation and cost comparison

**Timebox:** 2 hours initially. **Depends on:** D06/D07/D09; partial results must be labeled.

Actions:

- Collect/identify continuous test recordings not used for training or threshold tuning.
- Human-label event intervals and teachability; do not use reviewer output as its own ground truth.
- Run action-only and dual-detector modes under the same stated budget.
- Run a small budgeted periodic-review baseline if resources permit; mark it unrun if not.
- Produce `EVALUATION.md` with per-action recall, false triggers/hour, duplicates, approved precision, coverage gaps, latency, usage, and cost availability.
- Include representative misses, false positives, rejected candidates, and untrained explorer discoveries.

**Acceptance:** measured tables link to provenance/configuration and distinguish dataset size, train/validation/test, cache hits, and paid calls. No invented success percentage.

## D12 — Deliver runbook and teammate integration

**Timebox:** 1 hour. **Depends on:** completed functional tickets.

Actions:

- Update `.env.example` with safe discovery settings and comments; no secrets.
- Add scripts such as `discovery:preflight`, `discovery:evaluate`, and documented ML setup commands as implemented.
- Write exact local/HTTPS start commands, phone pairing steps, credential refresh instructions, and model-data setup.
- Verify the exported contract against an approved real event and give a short teammate fetch/download example.
- Update implementation status and list any incomplete capability separately from working features.
- Provide the user a concise outcome: working inputs, model modes, measured results, required run commands, and known limits. Do not push/deploy/send to teammates unless separately requested.

**Acceptance:** another developer can start the system and consume a real handoff using the documentation. Completion does not depend on unmentioned local files or a hidden manually started process.

## Completion checklist

- [ ] D00 environment and access evidence
- [ ] D01 schemas and semantic checks
- [ ] D02 sessions/auth/API
- [ ] D03 media and timestamp preservation
- [ ] D04 real Bedrock explorer/reviewer
- [ ] D05 real local temporal baseline
- [ ] D06 custom training and provenance
- [ ] D07 fusion/scheduling/budgets
- [ ] D08 upload/desktop flow
- [ ] D09 real phone flow
- [ ] D10 failures/regressions
- [ ] D11 held-out evaluation
- [ ] D12 runbook/teammate handoff

Unchecked external dependencies remain unchecked in the final report. Do not relabel a partial baseline as completion of all 13 tickets.
