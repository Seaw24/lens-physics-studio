# Revised direction: pretrained visual understanding

Date: September 16, 2026. Status: the user has rejected the topic-specific action-training direction. This document records the replacement architecture and experiment order. A first two-recording direct-vision pilot has now completed; read [its measured results and limitations](EVALUATION.md). Scheduling and a cheaper proposer remain untested. This direction supersedes the custom MC3-18 training requirement, fixed trained action families, and mandatory two-detector agreement design in the earlier 1.1 pack.

The complete build handoff is now [FINAL-IMPLEMENTER-PROMPT.md](FINAL-IMPLEMENTER-PROMPT.md) and [IMPLEMENTATION-V2.md](IMPLEMENTATION-V2.md). Use those for implementation defaults and work order; this document records the architectural reasoning.

## Product requirement

Discover potentially teachable situations across different everyday objects and settings, given the student's current module. Preserve evidence and return a grounded teachability verdict. Phone/live input, uploads, still-image semantics, and the teammate boundary remain as agreed. Questions, annotations, and the physics lab belong to teammates.

Do not acquire more EPIC/Kinetics training data, train a custom action head, or build physical trajectory reconstruction as a prerequisite. Existing samples are useful development examples; they are not representative evaluation evidence. No detector has yet demonstrated generalization.

## Why change

A classifier trained on cupboard opening and basketball shots can learn those labels without learning the broader relationship between an unfamiliar visible interaction and a physics objective. It could generalize to some new examples, but that is weaker than the product requirement. Dataset cleanliness cannot resolve this mismatch. The previous plan overemphasized training before establishing whether general visual understanding solves the intended task.

The replacement uses the broad prior knowledge of a pretrained model that accepts video or chronological images. Module-specific behavior comes from course objectives and instructions. Changing subject initially changes those inputs and the evaluation set; it does not require a new classifier for each topic. This is an architectural advantage to test, not proof that arbitrary subjects or motions will work.

## Representation: visible relationships before physics

The model describes observable changes and relationships, with frame references and uncertainty. Illustrative observations:

- A panel changes angle relative to its frame while a hand contacts its edge.
- An object moves across a surface while a hand remains in contact.
- An object separates from a hand and occupies different positions in later frames.
- A stationary arrangement has a visible support point and an off-center load.

These can apply to unfamiliar objects without a new named-action class. Examples guide the model; they are not an exhaustive event whitelist. A separate course-conditioned judgment determines whether the visible relationship supports a lesson.

Do not invent force, mass, acceleration, friction, torque, depth, or precise trajectories. A qualitative observation is enough to propose a conceptual lesson. Physical measurements and 3D reconstruction are separate future capabilities. The user does not need a manually engineered numeric “motion language” for this version.

## Build order: verify understanding before restricting access to evidence

### Experiment 1 — A bounded direct visual-review baseline

Initial pilot completed: [results](EVALUATION.md), [harness/runbook](VISION-PILOT-RUNBOOK.md). It covers two supplied recordings, not the broader proposed evaluation set below. Improve grounding and repeated-proposal handling before treating model approval as reliable.

Use the existing stronger Bedrock model, with verified image capability, on a small set of short clips represented by timestamped frames. Supply the module and permit zero, one, or multiple opportunities. Ask for visible observations, evidence frame IDs, objective IDs, verdict, and limitations. Reuse the existing reviewer grounding rules but add an outer opportunities array for discovery. An empty array is a valid result. Do not require an action-detector proposal or show an expected action label.

The independent variable is whether the general visual model can recognize teachable evidence across objects, not whether a cheap model can imitate an unvalidated stronger model. The direct baseline is an explicitly capped evaluation run, not an all-day deployment mode. Log every invocation and actual usage; there is no automatic background run implied by this document.

Proposed initial evaluation: 24 clips in four groups of six—clear actions across varied objects, confusing non-actions/camera movement, ambiguous or occluded scenes, and potentially useful static arrangements. Include doors, lids, levers, pushing different objects, and throwing different objects where the fixed module supports them. Use half for prompt development and keep half untouched for the first holdout. These are pilot sizes, not statistical certification. Obtain a separate continuous recording for measuring discovery frequency and duplicate notifications.

Hold out whole objects/settings/recordings from prompt development where feasible. Establish expected visible facts and acceptable curriculum connections through human review. Record label disagreements; a model's own verdict is not ground truth. Once the holdout is used to tune prompts, it becomes development data and needs replacement.

Include counterexamples: an already-open door, an object carried with the camera, a hand near an object without visible interaction, a pan across a static scene, and release occurring between selected frames. Reject unsupported action claims while still allowing grounded static-context opportunities.

### Experiment 2 — Compare less expensive perception on the same evidence

Once the direct baseline is useful, try the existing inexpensive image-capable Bedrock explorer as the proposer. Give it the same chronological evidence and broader visible-relationship instructions. It returns short structured observations and candidate intervals. The stronger reviewer independently sees original evidence; it must not judge solely from the cheaper model's summary.

The pipeline is:

```text
Buffered phone frames / uploaded media
              |
    Bounded clip scheduling
              |
Pretrained general visual proposer + course context
              |
  Evidence-backed candidate or no candidate
              |
Stronger independent visual teachability review
              |
       Media + verdict to teammates
```

Start with the already integrated Bedrock path to avoid making new local inference infrastructure the demo dependency. A local video-capable VLM such as [Qwen3-VL-4B-Instruct](https://huggingface.co/Qwen/Qwen3-VL-4B-Instruct) is a later comparison if measured RAM, latency, and power are suitable. Its published support for video is not a demonstrated Lens result. Local execution avoids per-call cloud billing but still consumes compute and energy.

Only retain the proposer if its measured reduction in stronger calls justifies its misses, latency, and own inference cost. If it fails, keep the direct baseline available for explicit short evaluation sessions and report that low-cost live discovery remains unresolved. Do not restore the rejected custom classifier silently.

### Experiment 3 — Reduce how often visual understanding runs

Add a cheap local visual-change/activity signal to propose times worth inspecting. It observes changes, not physics or teachability. Retain a rolling buffer so an activation includes footage before the change. Batch overlapping activations, suppress repeated views of the same event, limit queue size, and enforce invocation budgets. The earlier retention, pinning, cancellation, authorization, and media-fidelity requirements remain useful.

A motion signal alone is not sufficient: walking with the phone creates global movement; small interactions can be subtle; some useful arrangements are static. Reserve a small, explicitly budgeted periodic exploration allowance independent of that signal. Record which events were found by activity-driven versus periodic inspection. Camera movement suppression must be measured for lost object interactions rather than used as an absolute rule.

Some observation continues during a live session—the camera buffer and inexpensive local change processing. The language model is invoked in bounded jobs. A local watcher is not free in battery or compute. During sustained activity it can still request many jobs, so a hard call budget and honest reporting of skipped footage are necessary. Scheduled exploration also still costs tokens when hosted remotely. This design does not yet establish economical all-day operation.

Do not specify a universal “significant change” threshold from intuition. Tune on continuous development footage and report how much recall the gate loses compared with the same proposer on uniform overlapping windows. Deploy the gate only after that comparison.

## Optional later trigger: pretrained video/text embeddings

If ordinary change detection is too noisy, evaluate a pretrained video/text encoder to rank buffered windows against descriptions of relevant interactions. Existing models already produce numerical representations; building a hand-designed physics coordinate system is unnecessary for semantic retrieval. [Meta Perception Encoder](https://github.com/facebookresearch/perception_models) provides image/video-to-text matching, and [Qwen3-VL-Embedding-2B](https://huggingface.co/Qwen/Qwen3-VL-Embedding-2B) supports video/text representations.

These are possible experiments, not selected deployment dependencies. An embedding similarity score is neither a calibrated probability nor evidence of an actual force or action. Some video representations depend heavily on scene appearance and may not distinguish temporal order. Test reversed/shuffled frames, same objects with different actions, and unrelated moving backgrounds before using scores to suppress model calls. Retain a bounded independent exploration path. Do not add an encoder, reranker, local VLM, and hosted VLM simultaneously before proving that each improves the cost/recall tradeoff.

## Preserve temporal evidence

The existing proposal of six images spread across eight seconds is not a proven adequate representation of sub-second actions. Use short chronological windows and test denser frame selection, while respecting actual model input limits and the available camera frames. Compare sampling variants using the same original clips and record failures when release/opening occurs between samples. An image sequence is still sampled evidence, not perfect continuous motion perception.

One verified constraint: [Amazon Nova v1 video documentation](https://docs.aws.amazon.com/nova/latest/userguide/modalities-video.html) specifies 1 fps sampling for short videos with Nova Lite/Pro. Sending a higher-fps MP4 does not override that behavior. For fast actions, compare explicit timestamped image inputs at higher temporal density, subject to the selected model's image limits. Recheck any Nova 2 or other model independently; do not transfer Nova v1 limits by name.

Actual workshop invocation of Sonnet with ordered frames is now verified in the pilot. It does not use native video. Recheck access when temporary credentials expire or the deployment changes. A still photo can support scene context only.

## What happens to the earlier implementation pack

- Keep media capture, same-Wi-Fi HTTPS/pairing, source timestamps, rolling storage, immutable evidence, authorized asset access, bounded scheduling, notification, and teammate handoff requirements.
- Withdraw custom MC3-18 training, `opening_hinged_door|basketball_shot` as a detector vocabulary, and model agreement as a required ranking mechanism.
- Replace D05/D06 with the perception experiments above. Revise D07 around one semantic proposer plus scheduling signals; a change detector is not an independent semantic vote.
- Adapt explorer prompts toward broad observable relationships; preserve the reviewer distinction between observed action, static context, and insufficient evidence.
- The old 1.1 TypeScript contracts and example fixtures remain historical references, not a current schema for this direction. Before coding the revised runtime, update provenance, discovery response, detector status, score semantics, counters, and fixtures together. Preserve the media/verdict semantics useful to teammates and version the changed contract explicitly. Do not disguise a scheduler activation as an action-model result.
- The dataset audit remains valid evidence about the inspected data. Its recommendation to proceed with custom training has been superseded by this user decision.

## Evidence needed before calling the new approach successful

Report held-out opportunity recall against human annotation, approval precision, unsupported-motion claims, insufficient-evidence rate, duplicates, missed subtle events, calls and token usage per observed minute, and end-to-verdict latency. Break results out by unfamiliar object/setting and by camera motion. Compare direct review, cheaper-proposer review, and gated-proposer review on the same source recordings; charge all model stages and retries in the cost comparison.

The first limited result is available in [EVALUATION.md](EVALUATION.md). The next deliverable is an improved grounding/grouping iteration and a broader independent evaluation. A broad pretrained model is a better-matched starting hypothesis; reliability and low-cost continuous observation still have to be demonstrated.
