# Copy this prompt into the implementation model

You are implementing Lens's event-discovery feature in the existing `lens-physics-studio` repository. Complete the working feature, integration, tests, and handoff described below. Do not stop after a plan or another specification. Work in this repository; preserve unrelated work and the existing teaching demo. Do not create additional agents or tasks unless the user asks.

## Read these sources in order

1. `docs/detection/IMPLEMENTATION-V2.md` — authoritative implementation specification and ordered work packages.
2. `docs/detection/V2-MODEL-PROMPTS.md` — current model responsibilities and grounding requirements.
3. `docs/detection/v2/contracts.ts` and `v2/check-contract.ts` — executable contract seed and semantic checks. Copy/adapt into the runtime, retaining the specified wire shapes and invariants.
4. `docs/detection/EVALUATION.md` and `vision-pilot/reference-review.json` — actual first-pilot findings and known errors.
5. `docs/detection/IMPLEMENTATION-STATUS.md` and `VISION-PILOT-RUNBOOK.md` — existing code, evidence, commands, and limits.
6. Inspect the actual application and harness code before changing it: `server/index.ts`, `src/App.tsx`, `src/api.ts`, `shared/physics.ts`, `scripts/vision-eval*.mjs`, `scripts/summarize-vision-eval.mjs`, `scripts/prepare-vision-eval.py`, tests, package/lock files, and environment template.

The older `IMPLEMENTATION.md`, `TASKS.md`, `RUNBOOK.md`, `PROMPTS.md`, root `contracts.ts`, and `examples/` describe a superseded architecture. Do not execute their training instructions or combine their 1.1 API with this 2.0 API. V2 is self-contained for the required build. The research direction document explains motivation; V2 resolves implementation defaults.

## Product decisions already made

- Discover everyday situations relevant to a fixed intro-mechanics module: forces, torque, support/equilibrium, and released-object motion.
- Use pretrained general visual understanding; no custom CNN/action-head training, EPIC/Kinetics acquisition, physics reconstruction, or fixed action whitelist.
- Pipeline: buffered media → bounded scheduling → inexpensive visual proposer → independent stronger visual review of original evidence → playable media plus verdict.
- A local activity signal only schedules inspection; it does not understand physics. Include budgeted periodic inspection for subtle or static opportunities. Neither model runs continuously.
- Support uploaded video, uploaded still images, and a phone camera on the same Wi-Fi as the laptop. Keep the phone page foregrounded. Glasses and all-day background capture are future work.
- Still images can support scene context, never an observed temporal action.
- Teammates own questions, annotation, simulations, and the lab. Do not generate those fields or invent placeholders to satisfy the old `Moment` type.
- Keep the existing website and prepared teaching experience usable. Add an isolated Discovery workspace and phone capture route.

## What exists and what is still unproven

The command-line pilot made real Sonnet calls on two recordings. It recognized can/tab interactions, three handle turns, and paper-plate release; table pushes were partial. It also invented opening an already-open can, a hinged device, and a wet floor. Across 36 scan calls it consumed 331,511 input and 21,356 output tokens, with 13.863-second median request latency. This is evidence for further development, not proof of a reliable or inexpensive live system.

The CLI harness is implemented. Live capture, activity scheduling, independent review, cheaper-model quality, revised API, and event grouping are not implemented. Do not describe them as working until exercised.

Both supplied recordings are now development material. Keep their original raw results unchanged. The user's action timestamps are review labels; never put them into discovery inputs or select evaluation windows around them. Local originals and temporary credentials may be available under `.runtime/vision-evaluation/`; inspect manifests, not secret values. Do not print credentials, commit recordings, or publish local personal paths. If absent on another machine, build with clearly labeled synthetic mechanics fixtures and report real-media checks as outstanding.

## Execution contract

Implement work packages V01–V08 in order, with a functional vertical slice after V03. Use the concrete defaults and state transitions in V2; do not ask the user to choose routine implementation details again. Start by checking repository status, installed dependencies, and actual source code. Preserve existing uncommitted work.

Use existing AWS access through server-side credentials. Preflight does not make model calls unless explicitly invoked. The user's existing authorization covers bounded development calls for this feature; honor the implementation-run ceiling and ledger in V2. Temporary credentials may be expired: if so, finish all independent implementation and state exactly what real verification remains. Do not silently switch provider/region, impersonate successful calls, start unlimited retries, or fall back from the inexpensive proposer to repeated strong-model scanning.

Verify the configured inexpensive model with real chronological image input before selecting it. The current application names `amazon.nova-lite-v1:0`; it is a candidate, not a proven detector. Sonnet `us.anthropic.claude-sonnet-4-6` was invoked successfully in this workshop for the first pilot. Recheck access as needed. Model IDs, usage, latency, and failure states must be visible in diagnostics.

Implement automatic schema validation, grounding checks, separate proposer/reviewer evidence, immutable snapshots, event deduplication, hard budgets, safe cancellation, and honest unavailable/insufficient states. Do not use object-specific rules to make the supplied recordings pass. Do not treat repeated model agreement or a schema-valid response as verified truth.

Run meaningful automated tests and build checks as you finish each boundary. Then exercise real uploaded video and still-image flows and the browser interface. Implement the phone path fully. A real phone test needs the user's device, certificate trust, and camera permission; prepare exact setup steps first and ask only for that unavoidable interaction if needed. Continue other work while waiting. Never mark a mobile viewport simulation as a real phone test.

Evaluate bounded pipeline runs against the preserved baseline and source labels; charge both model stages and report missed opportunities, unsupported claims, duplicates, tokens, and latency. Do not invent precision/recall from incomplete labels. New unseen footage is needed for an independent generalization claim, but its absence is not a reason to leave code unfinished.

## Required final delivery

- Working Discovery UI, authenticated source adapters, scheduling/proposer/reviewer pipeline, playable evidence, and version-2.0 media/verdict API.
- Real session and event states, call/usage ledger, bounded storage, cancellation, failure handling, and export.
- Updated `.env.example`, lockfile if needed, verified npm commands, setup and teammate API documentation with runnable examples.
- Meaningful tests, TypeScript/build results, recorded browser checks, and a separate real-phone check status.
- A new evaluation report; preserve the original pilot report and raw records.
- Updated `IMPLEMENTATION-STATUS.md`: completed functionality, exact commands used, actual model access/results, and concrete remaining external dependencies.

Do not stop at another plan. Finish all work that can be completed with available access. In the final response distinguish implemented functionality, measured model quality, and outstanding real-device or fresh-data validation. Never claim the whole system is done because mocked tests passed.
