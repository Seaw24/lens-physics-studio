# Discovery v2 implementation evaluation

Updated September 16, 2026. This report records the checks run while implementing V01–V08. It does not replace the original [vision pilot report](EVALUATION.md), and it does not claim general model reliability.

## Result in brief

The complete uploaded-video cascade ran successfully on the 2.3-second bundled basketball event: local activity scheduled one window, Nova Lite proposed one grounded opportunity, Sonnet independently reviewed the original JPEG evidence, and the server published one schema-version `2.0` event with a playable H.264 MP4. Authenticated event export, `HEAD`, and a 100-byte range request returned `200`, `200`, and `206` respectively.

The uploaded-still path also made real Nova calls and returned explicit `FAILED_INVALID_OUTPUT` diagnostics. It did not reach review or publish an event because Nova failed the strict still schema in all three development attempts. That is a measured limitation, not a successful rejection.

## Inputs and isolation

- Preflight used a generated blank 96×96 JPEG solely to verify that each configured model accepted chronological image input.
- Feature smoke checks used only checked-in demo media: `public/demo/coaching-frame.jpg` and `public/demo/basketball-event.mp4`.
- The evaluation planner read the privacy-reviewed masked manifest and selected the `holdout` split without loading user reference labels. A dry gated plan contained 15 windows, including EOF partial-window flushes. Those prepared frames are 2 fps, below the runtime activity gate's 4 fps, so this was only a scheduler planning check.
- The independent reviewer request contained the server-owned course, original snapshot frames, frame IDs/times, capture limitations, and its own prompt. It did not contain proposer narrative, source filename, private path, or reference labels.

## Real calls and budget

The persistent build ledger records 11 reservations/attempts against the 80-call ceiling; 69 remain. No automatic retry, format repair, silent model promotion, or provider/region fallback occurred.

| Check | Calls | Input tokens | Output tokens | Measured latency |
| --- | ---: | ---: | ---: | --- |
| Image preflight: Nova + Sonnet | 2 | 2,043 | 75 | 0.744 s + 2.859 s |
| Three still proposer iterations | 3 | 8,596 | 359 | 1.930 s, 1.609 s, 1.481 s |
| Three video cascades | 6 | 61,340 | 1,996 | end-to-review 15.383 s, 16.532 s, 14.999 s |
| **Implementation total** | **11** | **71,979** | **2,430** | Provider latency only; no percentile inferred |

Provider usage was present for every implementation call. The ledger representation still permits null usage, and deterministic tests cover that null is not converted to zero.

The historical `direct_uniform_v1` pilot remains the only full recording scan: 36 scan calls, 331,511 input tokens, 21,356 output tokens, and 13.863-second median latency, as documented in [EVALUATION.md](EVALUATION.md). Prompt, schema, stage, and coverage changed in v2, so comparing that total directly with the short feature smoke is not an apples-to-apples savings estimate.

## Observed outcomes

### Preflight

Both configured IDs were available in `us-east-1` with the workshop credential file:

- proposer `amazon.nova-lite-v1:0`: 1,224 input / 13 output tokens, 744 ms;
- reviewer `us.anthropic.claude-sonnet-4-6`: 819 input / 62 output tokens, 2,859 ms.

### Uploaded still

Nova made three proposer attempts; Sonnet made zero reviewer calls because strict proposer validation failed first.

1. The initial prompt returned an `observed_action` from one image with missing before evidence, which the image-semantic checks rejected.
2. The first still-specific prompt returned a scene-context shape but an empty required before-frame list.
3. The revised prompt returned scene context but omitted the required `limitations` array.

No response was repaired and no public event was synthesized. This shows that the still transport/failure path works, but the current Nova prompt is not reliably schema-compliant on this example.

### Uploaded video

All three runs used the same 2.3-second checked-in basketball clip and at most one proposer plus one reviewer call.

1. Nova returned a valid release proposal. Sonnet's facts were useful, but `before` and `after` were strings rather than the required objects, so the candidate failed strict validation.
2. After making the output shape explicit, both stages validated. Publication then exposed an application defect: the public event schema incorrectly required path-safe model IDs even though Bedrock IDs contain `.` and `:`. No event was published.
3. After correcting that server-owned field constraint, local activity admitted one window. The final run used 11,631/200 Nova tokens in 3,655 ms and 8,845/462 Sonnet tokens in 11,344 ms. It published one event for the visible transition from the basketball being held to being airborne, interval 0.0–1.5 s, with `released-object-motion` and `force-interaction` objectives.

The reviewer explicitly limited the result: camera panning prevents precise trajectory reconstruction, 2 fps misses the exact release instant, and one frame's apparent location change could represent a different shot/scene. The generated evidence clip is 2.3 seconds, H.264/yuv420p/fast-start, and retained those limitations rather than claiming measured trajectory physics.

## What was not measured

No full `cascade_uniform_v2`, `cascade_gated_v2`, or comparable `direct_uniform_v2` cloud run was started on the pilot recordings. The dry gated plan added implementation confidence without enough expected decision value to justify dozens more calls after the end-to-end path worked. Therefore this report does not provide positive-reference coverage, missed-event counts, grounding-error rates, strong-call reduction, precision, recall, or a controlled comparison with v1.

The bundled clip is existing development material, not unseen evidence. Fresh settings/objects and an accepted human matching policy are still required for a generalization claim. Extra model proposals cannot be called negatives without exhaustive labels.

## Non-cloud verification

- 33 Node tests pass, including original application regression tests, contract semantics, activity/exposure/gap behavior, EOF flushing, grouping, persisted call ceilings, global dispatch, store recovery/locking, auth scopes, pairing redemption, bad frame hashes, source normalization, snapshot retention, and real FFmpeg/FFprobe clip generation.
- The v2 contract seed passes all 17 executable checks.
- TypeScript checking and the Vite production build pass.
- A signed-in desktop browser check covered the preserved Your day experience, Discovery login, source tabs, scan/replay control, and model IDs. Merely mounting the page made no model call.
- The phone transport is implemented and its auth/ingest boundaries are automated, but no physical phone paired, granted camera permission, uploaded frames, produced a real verdict, and played the result during this run. Real-phone verification remains open.
