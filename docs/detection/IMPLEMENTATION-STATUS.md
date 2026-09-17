# Detection implementation status

Updated September 16, 2026. The V01–V08 Discovery v2 implementation is integrated. Start with [DISCOVERY-SETUP.md](DISCOVERY-SETUP.md), use the [v2 API reference](DISCOVERY-API.md), and read [EVALUATION-V2.md](EVALUATION-V2.md) for measured model results and limitations.

## Implemented

- **V01 — foundations:** strict v2 public/model schemas and semantic checks, fixed course/objectives, typed configuration, atomic session store, recovery, revisions, private diagnostics, controller/phone authorization, structured API errors, path/body/origin limits, and persistent ledgers.
- **V02 — media and adapters:** bounded multipart upload, still normalization/metadata stripping, FFprobe validation, timestamped JPEG evidence, immutable snapshots, H.264/yuv420p/fast-start clips, held-frame phone reconstruction, authenticated `GET`/`HEAD`/Range assets, no-retry SDK/bearer Bedrock transport, global serialized dispatch, separate prompts, and explicit preflight.
- **V03 — uploaded vertical slice:** photo and video sessions, Start-gated inference, proposal reservation, independent review, candidate diagnostics, atomic event/media publication, schema-version `2.0` export, and playable result cards.
- **V04 — grounding and fault behavior:** strict frame/clock/image-action validation, temporal event grouping, near-identical static suppression, session/rate/queue budgets, cancellation generations, late-publication checks, capture-gap rejection, restart interruption, unknown attempt preservation, auth circuit breaking, storage limits, and 24-hour terminal retention.
- **V05 — scheduling:** documented exposure-corrected 64×36 grayscale activity gate at 4 fps, six-second/three-second grid, periodic inspection, activity spacing, final partial windows, scan/replay source watermarks, live coalescing, immutable work keys, and coverage counters. Explicit uniform/direct modes remain evaluation-only.
- **V06 — phone and UI:** one-time fragment pairing, scoped Secure phone cookie, foreground rear-camera capture without audio, media-clock timestamps, one canvas encode/upload in flight, two pending batches, oldest-unsent dropping, exact retry idempotency, heartbeat/stop, trusted HTTPS LAN serving, source/control/status/diagnostic UI, and cleanup on unmount/exit.
- **V07 — evaluation tooling:** local-by-default preflight, dry-by-default masked evaluation planner, explicit invocation/run directories, shared atomic 80-call ledger, no label input, no retry, and measured real-call report.
- **V08 — handoff:** setup/API/consumer docs, regression tests, TypeScript/build/contract checks, desktop browser smoke, real still/video smoke, measured evaluation report, and reproducible source archive generation.

The existing basketball lesson, course diagnostic, notebook, tutor, uploads, and prepared demo remain available. Discovery uses separate clients/types and is registered ahead of the legacy API limiter and SPA fallback. Legacy Bedrock calls share the same process-wide dispatcher.

## Verification completed

Commands used (the managed host invoked the same binaries through its bundled Node runtime):

```sh
npm run typecheck
npm test
npm run build
npm run discovery:contract
npm run discovery:preflight
npm run discovery:evaluate -- --manifest .runtime/vision-evaluation/manifest.json --mode cascade_gated --split holdout --max-calls 40
DISCOVERY_CREDENTIALS_FILE=.runtime/vision-evaluation/workshop-credentials.json npm run discovery:preflight -- --invoke
DISCOVERY_ACCESS_CODE='<local code>' npm run discovery:smoke -- --kind image --file public/demo/coaching-frame.jpg
DISCOVERY_ACCESS_CODE='<local code>' npm run discovery:smoke -- --kind video --file public/demo/basketball-event.mp4
npm run discovery:archive
```

Final deterministic results: 33/33 tests, 17/17 contract checks, clean TypeScript check (including scripts and contract sources), and successful Vite production build. The real final video session completed with one approved event and a playable 1,416,237-byte MP4; event `GET` returned 200, asset `HEAD` returned 200 with `Accept-Ranges: bytes`, and `bytes=0-99` returned 206 and 100 bytes.

Real model access succeeded for Nova Lite and Sonnet 4.6. Across implementation checks, 11/80 call slots were recorded, 71,979 input and 2,430 output tokens were reported, and no usage was unknown. See [EVALUATION-V2.md](EVALUATION-V2.md) before interpreting quality.

The signed-in desktop UI was inspected in a real browser. The original Your day page, Discovery authentication/source workspace, experimental phone tab, and `/capture` missing-token failure state all rendered with no browser-console warnings/errors; visiting and polling did not invoke inference.

## Honest remaining validation

1. **Physical phone:** transport/auth behavior is tested, but an actual trusted phone has not yet paired, granted camera permission, streamed frames, produced a real verdict, and played the generated asset. Follow [DISCOVERY-SETUP.md](DISCOVERY-SETUP.md); do not mark this complete from a mobile viewport simulation.
2. **Still-model compliance:** the real still path reports failures correctly, but Nova returned invalid strict output on all three checked attempts. It needs evaluation on new stills or a model/prompt decision before it can be called reliable.
3. **Pipeline quality:** no full v2 cloud comparison was run on the masked recordings. The implementation does not yet establish positive-event coverage, hallucination rate, strong-call savings, precision/recall, or generalization.
4. **Fresh evidence:** the successful basketball clip is development material. New settings/objects plus human-reviewed event/claim labels remain necessary for a held-out claim.

The original [pilot evaluation](EVALUATION.md), prompts, and saved raw evidence were not changed. No custom classifier, action head, numeric physical reconstruction, background phone recording, or question-generation field was added.

## Archive

`npm run discovery:archive` creates `.runtime/discovery/exports/lens-discovery-v2-source.tar.gz`. It includes tracked and untracked source/docs while excluding ignored runtime/build content, credentials, media extensions, and private data-audit/raw-pilot directories. The exact final file count, byte size, and SHA-256 are printed and written beside it as `lens-discovery-v2-source.manifest.json`.
