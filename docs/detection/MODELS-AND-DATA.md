# Action model, training data, and evaluation

> Superseded architecture (September 16, 2026): read [VISION-FIRST-DIRECTION.md](VISION-FIRST-DIRECTION.md) first. The custom action-training requirement and mandatory two-detector design are withdrawn. This document retains historical details; do not execute its old training plan or copy its detector schema as the new design.

This document selects a reproducible starting implementation. It does not claim this model is the best available or that benchmark accuracy transfers to phone footage. Prove the whole pipeline with a real pretrained baseline, then train the custom head and measure the change.

## 1. Initial local model

Use `torchvision.models.video.mc3_18` with `MC3_18_Weights.KINETICS400_V1` as the frozen video feature extractor. It is an approximately 11.7-million-parameter temporal model, with a published preprocessing transform. It is substantially smaller in weight storage than R3D-18, but the published FLOP figures do not establish that it will be faster on this laptop. Benchmark it. [Torchvision MC3-18](https://docs.pytorch.org/vision/stable/models/generated/torchvision.models.video.mc3_18.html)

Why this default: an existing temporal backbone, a simple Python API, a small trainable head, reproducible checkpoints, and no custom browser model conversion on the critical path. MoViNet remains a possible later optimization; do not spend the first 24 hours comparing many architectures.

Start with Python 3.11, `torch==2.8.0`, and `torchvision==0.23.0`, plus Pillow and NumPy versions resolved in a clean venv and pinned after a smoke test. This Torch/Torchvision pairing is documented as compatible. Do not assume a bundled Python of a different minor version has compatible wheels. [Compatibility table](https://github.com/pytorch/vision#installation)

Use CPU as the reproducible baseline. Probe CUDA or MPS explicitly if present and compare an actual forward pass before enabling it. Do not silently enable CPU fallbacks that make a reported GPU benchmark meaningless. Limit CPU threads to `min(4, os.cpu_count())` initially to leave room for media encoding and the server.

### Two honest operating modes

**Pretrained baseline:** use the original Kinetics-400 head. Resolve `shooting basketball` by string lookup in `weights.meta['categories']`; never hardcode a numeric index. If that label is absent, fail that capability check. Return only the supported basketball signal; do not substitute an unrelated door label or pretend this baseline was trained on our data.

**Custom head:** freeze the pretrained backbone and replace its final classifier with a trained three-class head:

```text
class 0: other
class 1: opening_hinged_door
class 2: basketball_shot
```

Load custom weights only if architecture, feature dimension, preprocessing, class order, hashes, and manifest version match. A file named `head.pt` is not sufficient evidence of a valid model.

## 2. Preprocessing — identical in training and serving

Input is 16 chronological RGB frames covering 2 source seconds. Sampling positions are 0, 125, ..., 1,875 milliseconds within the window. For native footage, decode the closest preceding frame to each target timestamp. For the phone, use available timestamped frames; reject an action window with fewer than 12 distinct frames, missing coverage, or a gap over 500 ms. A held frame is not a new independent observation.

Convert each frame to the same spatial size before stacking if the decoder returns variable geometry. Orientation changes should normally begin a new session. Apply `weights.transforms()` to a uint8 tensor shaped `[T,C,H,W]`, obtaining `[C,T,H,W]`; add a batch dimension to get `[1,C,T,H,W]`. Do not divide by 255 or normalize a second time. Use `model.eval()` and `torch.inference_mode()` for the frozen backbone.

The published weights' benchmark uses a different sampling rate and multi-clip evaluation. Our 8-fps/two-second window is a deliberate demo setting and requires target-footage evaluation; do not quote published top-1 accuracy as Lens accuracy.

The official transform center-crops. Test off-center actions and portrait footage; record misses. If changing to another spatial transform, version it and regenerate both training features and evaluation results. Do not change only runtime preprocessing.

Feature extraction pattern:

```python
weights = MC3_18_Weights.KINETICS400_V1
model = mc3_18(weights=weights)
original_head = model.fc
feature_dim = original_head.in_features
model.fc = torch.nn.Identity()
model.eval()
for p in model.parameters():
    p.requires_grad_(False)
with torch.inference_mode():
    features = model(weights.transforms(frames).unsqueeze(0))
# features: [1, feature_dim]; normally 512, assert rather than assume
```

For baseline prediction, apply `original_head(features)` and softmax. For custom prediction, apply the trained head. Keep the two model modes distinct in responses.

## 3. Persistent worker protocol

Node starts one worker with `spawn(pythonExecutable, ['-u','ml/worker.py',...], {shell:false})`. Load weights once. stdout is JSON lines only; logs and download progress go to stderr. Never spawn Python per frame or inference.

On successful startup:

```json
{"type":"ready","protocolVersion":1,"modelId":"mc3_18","modelVersion":"<manifest hash>","mode":"custom_head","classNames":["other","opening_hinged_door","basketball_shot"],"featureDim":512,"device":"cpu"}
```

Inference request:

```json
{"type":"infer","requestId":"<uuid>","sessionId":"<uuid>","windowStartMs":1000,"windowEndMs":3000,"frames":[{"path":"<server-owned absolute path>","sourceTimeMs":1000}]}
```

The example frame array is abbreviated; real requests require 16 validated samples. Node alone selects paths. Worker enforces an allowed runtime root and file-size/dimension caps as defense against accidental misuse. Client-supplied paths never reach it.

Successful response:

```json
{"type":"result","requestId":"<uuid>","mode":"custom_head","modelVersion":"<manifest hash>","scores":{"other":0.08,"opening_hinged_door":0.86,"basketball_shot":0.06},"inferenceMs":220,"distinctFrames":16}
```

Those numbers are illustrative. Failed requests return `{type:'error',requestId,code,message}` with safe text. Worker startup failure must not emit `ready`.

Node uses a line-buffered parser with maximum line size 64 KiB, a 60-second startup timeout (weights should be downloaded during setup), and a 20-second inference timeout. A timeout kills/restarts the worker once with backoff; stale responses cannot be matched to a later request. Keep a single in-flight inference, then the latest pending live window or awaited offline window as specified in IMPLEMENTATION.md.

## 4. Dataset manifest

Store datasets under `.runtime/discovery/datasets/`. Commit only scripts, manifest schema, small permitted fixtures, and provenance summaries, never bulk video or model weights.

Create JSONL rows with this exact shape:

```json
{
  "sampleId":"epic-example-window-001",
  "dataset":"epic-kitchens-100",
  "sourceVideoId":"<official video ID>",
  "sourceUri":"<public source or local source identifier>",
  "localPath":"<relative path inside dataset root>",
  "sha256":"<downloaded-file SHA-256>",
  "participantGroup":"<participant ID when available>",
  "recordingGroup":"<original continuous recording ID>",
  "environmentGroup":"<known location/domain group, else unknown>",
  "startMs":1000,
  "endMs":3000,
  "label":"opening_hinged_door",
  "split":"train",
  "annotationSource":"official_action_interval+human_clip_review",
  "licenseId":"<verified applicable terms>",
  "reviewed":true
}
```

`label` is `other|opening_hinged_door|basketball_shot`; `split` is `train|validation|test`. All records need a recording group; participant/environment unknowns are explicit. Relative paths must remain within the dataset root. Reject zero-length/out-of-bounds intervals, duplicate content across splits, unknown labels, unreadable files, or unverified license/provenance fields.

No official validation/test media is silently moved into training. Do not split consecutive frames or overlapping clips from the same recording across splits. If a recording has several people, group it conservatively so none leaks through another sample.

## 5. Acquisition plan with time limits

Read the [September 16 dataset audit](DATASET-AUDIT.md) before acquiring media. Annotation counts below are candidate counts, not counts of visually accepted training windows. The audit includes original-video spot checks, structural checks, access results, and known publisher corrections; no detector has been trained or evaluated by that audit.

### First choice: EPIC opening interactions

Use official EPIC training annotations. Previously counted coverage:

- Opening cupboard class: 1,342 segments, 338 recordings, 28 participants.
- Opening fridge: 667 segments, 277 recordings, 32 participants.
- Combined: 2,009 segments, 402 recordings, 32 participants.
- Unscrewing lid/cap: 9 segments. Pushing/sliding bottle: 2 segments.

These counts are from annotations and can be reproduced by the manifest script. They do not guarantee accessible files, visible hinges, or room-door examples. Inspect downloaded clips. Fridge/cupboard closed-to-open rotation is the target; unrelated “open” labels, drawers, and screw caps are not that target.

The audited 2,009 candidates have a median labeled action duration of 1.15 seconds; 1,743 are shorter than two seconds. Decode a two-second window from the original recording around each short action, retaining real pre/post context. Do not discard all short events or stretch/repeat a short trimmed action to fill two seconds. Mark boundary clipping and reject windows where insufficient real footage remains. Resolve overlapping/conflicting actions during visual review.

Use the original EPIC-55 storage split when locating its video files; an EPIC-100 training annotation can refer to an original EPIC-55 `test` storage path. This is a storage-layout issue, not permission to mix our evaluation split into training. Use the supplied split metadata rather than constructing paths from EPIC-100 train/validation names. Prefer original MP4s and fresh decoding; if using pre-extracted frames, apply the publisher's corrections for `P01_109` and `P27_103`. Current downloader documentation says corrected versions are available.

Sources: [training CSV](https://raw.githubusercontent.com/epic-kitchens/epic-kitchens-100-annotations/master/EPIC_100_train.csv), [verb mapping](https://raw.githubusercontent.com/epic-kitchens/epic-kitchens-100-annotations/master/EPIC_100_verb_classes.csv), [noun mapping](https://raw.githubusercontent.com/epic-kitchens/epic-kitchens-100-annotations/master/EPIC_100_noun_classes.csv), [downloader](https://github.com/epic-kitchens/epic-kitchens-download-scripts).

Select a pilot subset of roughly 100–200 visually checked positive windows from at least eight recording groups, preferably several people. This is an acquisition cap for a first experiment, not a sufficient-data claim. Obtain matched negatives from the same kitchens: carrying objects, walking past doors, closing doors, opening drawers, idle footage, and camera movement.

### Second family: basketball

First verify the pretrained basketball class on target footage. Acquire permitted basketball shots for a custom head where available. The inspected Kinetics-400 train annotations contain 445 shooting-basketball source IDs and 773 dribbling-basketball IDs. Media accessibility must be checked separately. Do not make downloading large multi-class archive shards the critical path.

Use dribbling, holding, passing, and empty-court/camera-pan footage as inspected negatives for the specific `basketball_shot` target. A pass can still be teachable and proposed by the explorer; its training label describes the narrow recognizer target, not whether physics exists.

Kinetics labels cover ten-second clips rather than precise shot onset/release intervals. Locate the actual action before assigning two-second training windows. A clip labeled dribbling can also contain a shot; never automatically mark its entire duration negative. CVDF documents corrupted files and a replacement archive. Require complete video-stream decoding before manifest admission; a successful download or HTTP response is insufficient. This audit did not download or visually inspect Kinetics clips.

[Kinetics source](https://github.com/cvdfoundation/kinetics-dataset). UCF download access was not established in the interview; do not assume it works. Ego-Exo4D's approval delay makes it unsuitable as a 24-hour dependency. Dataset use conditions and pretrained-weight terms must be checked before the relevant use.

### Avoid a source-domain shortcut

If every kitchen clip is positive door-opening, every sports clip is positive basketball, and every negative is filmed elsewhere, a head may learn “kitchen/court” rather than the action. Require positive and negative windows in each domain. Include both classes' confusing alternatives. Report per-domain metrics, not just one aggregate score.

Give dataset access/download attempts a 60-minute initial limit. If access fails, keep the trained-head ticket open and request a small targeted recording session while implementing the independent inference pipeline. Do not silently replace training with hardcoded thresholds on orange pixels or stock results.

### Small recording plan

Ask the user for a modest pilot, not hundreds of clips before testing:

- 8–12 opening examples across at least two hinged doors, several distances, and both landscape/portrait viewpoints.
- 8–12 basketball shots with the intended phone position; include misses and different throws.
- A similar amount of confusing/idle footage in those same surroundings.
- Preserve 2 seconds before and after each action; no cuts inside the action.
- Separately record 2–3 continuous 5–10 minute evaluation sessions with events among ordinary inactivity. Keep whole evaluation recordings out of training and threshold tuning.

These are practical starting amounts only. If the model fails, use its error examples to request targeted additions. Respect the workshop's restriction on personal data in material sent to AWS; avoid identifying faces, screens, speech, or personal surroundings where applicable.

## 6. Training recipe

1. Validate manifests, inspect representative clips, and freeze train/validation/test group assignments with seed 42. Keep all augmented versions in their source split.
2. Decode 16 frames per two-second window using the exact runtime sampling/preprocessing. For long positive action intervals, choose windows centered within the action and inspect transitions; do not label pre-action windows positive by association.
3. Run the frozen backbone once per training window and cache features with the source hash, window, preprocessing version, and backbone hash. Keep validation features separate. Feature extraction is the expensive step.
4. Train `Linear(feature_dim, 3)` on cached features using AdamW, learning rate `1e-3`, weight decay `1e-4`, batch size 32, maximum 30 epochs, early stopping patience 5 on validation macro F1. Set random seeds and record software versions.
5. Use class-weighted cross-entropy with weights calculated from the training split only. Do not also oversample heavily without reporting why. Ensure the `other` class includes both source domains.
6. Select the checkpoint by validation results, then tune event thresholds on continuous validation recordings. Threshold tuning must run the temporal grouping logic, not only isolated-clip classification.
7. Evaluate once on held-out continuous test recordings. If changes are made after examining test failures, label that dataset development data and obtain a fresh final holdout.
8. Save the head, backbone identity, preprocessing configuration, class mapping, thresholds, manifests/checksums, training command, seed, and metrics.

Do not unfreeze the backbone until the frozen-head experiment is evaluated and compute/time remains. Full video-network fine-tuning is a stretch task, not necessary to call a trained linear action head custom training—describe exactly what was trained.

If one class lacks training examples, do not claim a valid three-class model. Keep pretrained basketball plus an independently trained door head only if their separate outputs/thresholds are implemented and documented, or keep that capability disabled. Do not merge unrelated logits into a fake normalized three-class distribution.

Suggested script interfaces to implement:

```text
python ml/manifest.py validate --manifest <jsonl>
python ml/manifest.py summarize --manifest <jsonl>
python ml/extract_features.py --manifest <jsonl> --output <feature-dir> --device cpu
python ml/train_head.py --features <feature-dir> --output <model-dir> --seed 42
python ml/evaluate.py --model <model-dir> --manifest <test-jsonl> --output <report-dir>
python ml/worker.py --mode custom_head --model-dir <model-dir> --runtime-root <runtime-dir>
```

An installed Python/FFmpeg pair must be checked before running those commands. Document actual executable paths in the implementation log.

## 7. Model manifest

Required fields in `manifest.json`:

```text
schemaVersion: 1
modelVersion: stable version string plus artifact hash
mode: custom_head
backbone: torchvision.mc3_18
backboneWeights: KINETICS400_V1
backboneSha256: verified checkpoint hash
headSha256: local head hash
classNames: [other, opening_hinged_door, basketball_shot]
featureDim: actual validated dimension
preprocessingVersion: mc3-official-transform-window2s-fps8-v1
sampleCount: 16
windowMs: 2000
sampleFps: 8
thresholds: per-class high, low, exit, persistence settings
trainedAt: ISO timestamp
trainManifestSha256 / validationManifestSha256
trainingSeed / command / Python / torch / torchvision versions
datasetSources / applicableTerms / classCounts / groupCounts
validationMetricsPath
knownLimitations
```

Training must write these from real artifacts. Do not copy illustrative counts into a model manifest. Load state dictionaries using a safe weights-only path supported by the pinned PyTorch version, not arbitrary pickled executable objects from untrusted sources.

## 8. Evaluation beyond clip accuracy

Annotate held-out recordings with source-time intervals and action labels. Separately have a human label whether each interval can support the fixed course, and what evidence is sufficient. A model's own review cannot serve as the sole ground truth for reviewing that same model.

### Event matching

Use one-to-one matching by action family and temporal intersection-over-union >=0.30; report a secondary onset-tolerance match if needed, labeled separately. One real event matched to five triggers is one true positive and four duplicate false triggers, not five successes. Report uncertain boundaries and small sample sizes.

### Required metrics

- Event recall per supported action; false candidate triggers per observation hour.
- Duplicate trigger rate and missed-event examples.
- Precision of approved teaching moments against human review, plus insufficient-evidence frequency.
- Media-boundary correctness and whether lead-up/action/end are actually preserved.
- p50/p95 local inference time, event-end-to-verdict latency, skipped windows, and dropped-frame gaps.
- Explorer/reviewer attempts, token usage, failures, and estimated total cloud cost where prices are configured.

Run these three modes on the same held-out sources:

1. Action detector only → reviewer.
2. Action detector + independent explorer → reviewer.
3. Periodic stronger-model review of uniformly sampled windows (a small, explicitly budgeted comparison baseline).

Use the same reviewer, prompt, course, evidence-frame limits, and documented call/cost budget. The full mode has to justify the explorer's extra expense; agreement is not an accuracy result by itself. Count candidates dropped by budget separately from detector misses. Cache repeated identical review requests during experiment development, and report cache hits separately from paid invocations.

The output report is `docs/detection/EVALUATION.md` with data versions, split policy, tables, representative errors, and explicitly untested claims. Never prefill performance numbers from synthetic fixtures.
