# First pretrained-vision pilot

September 16, 2026. **Actual Bedrock inference completed on both supplied recordings.** The model found useful evidence for can manipulation, three door-handle turns, and paper-plate releases. The two table pushes were only partially recognized. It also invented details and repeatedly approved weak opportunities. This supports continuing the pretrained-vision experiment; it does not establish a reliable automatic teachability filter.

The runnable harness is documented in [VISION-PILOT-RUNBOOK.md](VISION-PILOT-RUNBOOK.md). Machine-readable results: [metrics](vision-pilot/metrics.json) and [reference-event review](vision-pilot/reference-review.json). Current implementation boundaries: [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md).

## What was actually tested

- Model: `us.anthropic.claude-sonnet-4-6`, Bedrock region `us-east-1`. The model receives chronological images, not native video or audio; see [AWS's model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html).
- Source recordings: 27.38 seconds and 79.78 seconds, 107.16 seconds total. The first shows a drink can and its pull tab, rather than a bottle and screw cap.
- Evidence: 215 locally reviewed, privacy-masked JPEGs at 2 fps, 540×960. Scan windows are six seconds long with a three-second stride, up to 12 images per request. Overlap sends some frames more than once.
- Inputs: frame IDs, source times, chronological images, generic grounding instructions, and four objectives: force interactions, torque/rotation, equilibrium/support, and released-object motion. No custom model training or action-class whitelist.
- The user's timestamps and action descriptions were stored separately and **never supplied to the model**. Sampling did not target the labeled moments.
- The can recording was development material. The longer recording was held out from model-based prompt tuning. The user's descriptions and local privacy previews were available before inference, so this was not a blinded test. Two related recordings do not test generalization to unfamiliar environments or other subjects.

Prompt/config hash: `da8611cd87719bc1c536204d2b47a41477686bae008cc9e3061f0d3c998e2349`. Manifest hash: `bf3ea6ce1c1aa64b3deaf9a789e1efb7288da44769243eeb859a404c0a0d03c1`.

The baseline combines discovery and teachability judgment in each request. No independent second reviewer, cheaper proposer, or activity gate was tested. This is a deliberately bounded quality experiment, not the proposed all-day operating mode.

## Comparison with the supplied events

These assessments compare model observations with the user's approximate positive examples and locally inspected frames. “Found” means a relevant candidate was returned; it does not certify every sentence in its explanation. Candidate IDs resolve to the local normalized reports described below.

| Recording / user interval | Reference event | Assessment | Evidence and limitation |
| --- | --- | --- | --- |
| 1 / 4–8 s | Moving the can | Found | `clip-1-001-o0`: hand contact and can movement. Other candidates overinterpreted a fixed pivot or lifting. |
| 1 / 10–15 s | Manipulating the pull tab | Found, with unsupported claims elsewhere | `clip-1-003-o0`: finger/tab interaction and orientation change. Other windows incorrectly described opening or puncturing a can that was already open. |
| 2 / 3–5 s | First table push | Partial | `clip-2-000-o1`, `clip-2-001-o1`: hand/table-edge contact. Table displacement was not reliably established; a neighboring window called the tabletop a board or tray. |
| 2 / 24–26 s | First door-handle turn | Found | `clip-2-008-o0`: rotation around 25–25.5 s. The model's numerical angle estimate is not a verified measurement. |
| 2 / 33–36 s | Second door-handle turn | Found | `clip-2-010-o0`, `clip-2-011-o0`: rotation around 33–35 s. Overlapping windows duplicate this event. |
| 2 / 43–46 s | Third door-handle turn | Found | `clip-2-013-o0`, `clip-2-015-o0`: rotation around 42.5–44.5 and 45–45.5 s. A separate overlapping response failed validation and is excluded. |
| 2 / 60–61 s | Second table push | Partial | `clip-2-019-o1`, `clip-2-020-o1`: contact around 60.5–63.5 s. One description wrongly places the hand on the floor/leg. Table motion and push direction remain unverified. |
| 2 / 68 s–end | Paper-plate throws | Found, with unsupported context | `clip-2-022-o0`, `clip-2-024-o0`, `clip-2-025-o1`: airborne plate and later release/landing evidence. Frames at 69 and 77.5 s show an airborne plate. Repeated claims about a wet floor are unsupported. |

A table need not move for a push to be physically meaningful. The problem here is that these views do not reliably distinguish active pushing from hand contact, or establish the claimed movement. A cautious contact/support observation may still support a conceptual lesson, but it must not be presented as proof of a measured force or observed displacement.

The reference labels are approximate and not exhaustive. Additional model proposals are not automatically false positives. No independent human adjudication, exhaustive negative labels, or event-matching benchmark exists yet; therefore this report does not give a precision, recall, or accuracy percentage.

## Failure patterns that matter for the product

1. **Familiar object use substituted for observation.** Seeing a finger manipulate a can tab led to a claim that the can was being opened, despite the opening already being present. Detection of the right object does not establish the action.
2. **Misidentified structure produced a fabricated lesson.** At approximately 66 s, `clip-2-021-o2` described a laptop/monitor-like hinged panel at an estimated angle. Inspection of frame `clip-2-f00132` shows a diagonal metal structural brace near a window and table, without the claimed laptop or working hinge.
3. **Surface appearance became an unsupported condition.** The plate sequence produced wet-floor claims from a reflective floor. Reflection alone does not establish wetness.
4. **Generic static lessons and overlap inflated output.** Repeated table/can/plate support arrangements and repeated door events produced many proposals. They cannot all become notifications.
5. **The model rarely abstained.** Among 65 structurally valid raw proposals, it labeled 64 teachable and one not teachable, with zero insufficient-evidence verdicts. This does not measure accuracy, but alongside the inspected errors it shows why self-reported approval is not sufficient.

The model did sometimes acknowledge camera-motion ambiguity and the limits of inferring a plate trajectory. Those useful qualifications did not consistently prevent overconfident approval.

## Measured usage and latency

| Measure | Development | Longer recording | Combined |
| --- | ---: | ---: | ---: |
| Scan requests | 9 | 27 | 36 |
| Valid responses after format normalization | 9 | 26 | 35 |
| Invalid responses | 0 | 1 | 1 |
| Input tokens | 81,952 | 249,559 | 331,511 |
| Output tokens | 8,631 | 12,725 | 21,356 |
| Request latency p50 | 19.535 s | 12.472 s | 13.863 s |
| Request latency p95 | 20.740 s | 18.989 s | 20.740 s |
| Raw opportunities before grouping | 27 | 38 | 65 |

The scan used **352,867 total input/output tokens**. A separate text-only access preflight used 12 input and five output tokens, bringing the total to 37 invocations. There were no retries or model-based repairs. Token usage comes from Bedrock responses; this is not an invoice or an account billing estimate.

Combined inference latency totals 475.239 seconds, approximately 7 minutes 55 seconds, excluding preparation and other overhead. Percentiles use the nearest-rank method. Request latency is not event-to-notification latency: six-second windows, queueing, preprocessing, and any future independent review add delay. A sequential model taking a median 13.9 seconds cannot sustain this three-second scan cadence live. A cheaper proposer, scheduling, and event grouping remain necessary experiments, rather than proven optimizations.

The initial development responses wrapped JSON in one Markdown fence. The parser was updated to strip exactly one complete outer JSON fence, without modifying the content. The nine raw development records retain their original parsing failures; offline normalization validated all nine. Prompt and model inputs were not changed for the longer recording. One response there genuinely failed evidence-boundary validation: an evidence frame fell outside its declared interval. It was retained as invalid, excluded from opportunity counts, and not retried.

## What the next implementation should do

1. Tighten the separation between visible facts and physics interpretation. Require explicit temporal evidence for an action; do not infer opening, pushing, or release solely from object identity or ordinary use. Use `insufficient_evidence` when the specific claim cannot be established. Retain the distinction between an observed action and static scene context.
2. Add an independent grounding review over original frames. Test whether it rejects the errors above; another call is not automatically a reliable verifier. Record all extra tokens and latency. Keep reviewer observations separate from proposer claims.
3. Consolidate overlapping candidates into event records and suppress repeated generic static opportunities. Preserve all contributing frame references and record why candidates were merged. Do not count repeated windows as successful new discoveries.
4. Treat both supplied clips as development data for these revisions. Keep a later recording untouched for evaluation, with explicit visible-fact labels, counterexamples, and an accepted event-matching procedure. Footage across different objects/settings is still needed before claiming broad reliability.
5. Once grounding improves, compare a cheaper pretrained proposer on the same evidence. Then test local activity scheduling against uniform scanning, including what it misses. Preserve a bounded exploration allowance for subtle/static opportunities. Account for all stages when reporting savings.

Do not silently restore the rejected custom action classifier. No additional recording is required to implement the next grounding and grouping iteration, but evaluating that iteration independently will require fresh evidence.

## Reproducibility and limits

The ignored `.runtime/vision-evaluation/` directory contains source hashes, separate reference labels, reviewed masked frames, frozen plans, per-request raw responses, and local normalized reports:

- `sonnet-development-v1/` and `sonnet-holdout-v1/`: immutable invocation records.
- `sonnet-development-v1-normalized.json` and `sonnet-holdout-v1-normalized.json`: offline validated observations and candidate IDs.
- `manifest.json`, `frozen-prompt-v1.json`, and `preparation-config.json`: evidence/configuration provenance.

Raw media, personal source paths, workshop credentials, and raw responses are excluded from the distributable implementation ZIP. The public metrics and assessment files contain no credential values. See the runbook for explicit rerun commands; reading or summarizing existing records does not call a model.

Privacy masks obscure some surroundings; 2 fps sampling can miss sub-second motion; sampled image sequences omit audio and continuous movement. This pilot has two recordings, no independent adjudicator, no all-day cost measurement, no phone streaming test, no production API, and no second-stage reliability result. Existing UI functionality remains unchanged.
