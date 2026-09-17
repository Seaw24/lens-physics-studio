# Lens detection — agreed build scope

> Later user decision (September 16, 2026): custom action training and the mandatory dual-detector architecture below are superseded. Read [the pretrained-vision direction](detection/VISION-FIRST-DIRECTION.md). Input, media preservation, and teammate boundaries remain relevant.

Status: interview complete; implementation brief. This document describes the next build, not capabilities already implemented.

The detailed [implementation pack](detection/START-HERE.md) is the next implementation entry point. It supplies exact interfaces, defaults, model/data steps, prompts, and ordered tickets. Its contract version 1.1 supersedes the preliminary 1.0 example below; the product scope remains the same.

## Product and delivery boundary

Lens helps a student understand physics through situations from their own life. Automatic discovery is essential: the student does not need to identify or trim teaching moments manually.

The demo assumes the student is taking introductory mechanics, covering Newton's laws and torque. The eventual observation device is camera glasses. The demo uses uploaded media and a phone camera, with the learning experience displayed on the laptop website.

The requested implementation window is **24 hours**. Our deliverable ends at preserved event media and a teachability verdict. Teammates own lesson generation, video annotations, coaching questions, physics labs, and the subsequent learning experience.

## Confirmed decisions

- Accept uploaded video, uploaded still images, and a live phone-camera session.
- The phone and laptop may use the same Wi-Fi network.
- Keep both detection paths: a trained action recognizer and a cheaper exploratory vision-language model.
- Either path may propose an event independently. Agreement is additional supporting evidence and can increase priority.
- A stronger vision-language model reviews candidates and decides whether the visible evidence supports a teaching opportunity.
- Candidates may be observed actions or static scene context. A still photo cannot establish that an action occurred.
- Notify the webpage when an approved event is ready. Attention inference and sophisticated notification timing are deferred.
- A session producing no useful discoveries is an acceptable result. Prepared practice remains a separate product feature.
- Prioritize cupboard/fridge-door opening and basketball shooting. Other actions, including cap opening and pushing, may be proposed by the explorer or added after the main path works.
- Deliver approved media, timestamps, detector evidence, and the verdict through a documented interface. Teammates handle all teaching content generation.

## Processing flow

```text
Uploaded image/video or phone camera
                |
      Timestamped media and context
                |
        +-------+--------+
        |                |
  Action recognizer   Exploratory vision model
  (video sequences)  (budgeted independent checks)
        |                |
        +-------+--------+
                |
  Merge overlapping candidates; preserve media;
  prioritize; deduplicate; enforce request budget
                |
       Stronger model reviews evidence
                |
       +--------+------------------------+
       |                                 |
   Teachable                    Not teachable / insufficient evidence
       |                                 |
  Event available + notification      Evaluation record
       |
  Clip/image + structured teammate handoff
```

For still images, the action recognizer is explicitly not applicable. The explorer can nominate a scene-based opportunity for stronger review.

The exploratory path must occasionally inspect material independently of action-detector triggers. Otherwise it cannot recover events that the action detector misses entirely.

## Detection and review behavior

### Candidate production

Start with pretrained temporal video features and adapt a compact recognizer using available training data. The selected architecture must be benchmarked on the actual laptop. No architecture, inference speed, battery performance, or accuracy is established by this brief.

Each detection records its model version, label, temporal window, and any available raw score. An action label describes what may be visible; it does not establish forces, measurements, or teaching value.

The explorer uses a bounded cadence and selected scene changes. Its observations remain independent of the trained model's class list. The initial cadence, thresholds, and per-session call limits are implementation settings to tune from evaluation, not agreed performance guarantees.

### Combining signals

- Match candidates using overlapping time windows and compatible observations, not only identical label strings.
- Merge repeated proposals about one interaction before stronger review.
- Preserve provenance and disagreements between the detectors.
- Do not average unrelated model scores or label agreement as a calibrated probability.
- Permit a sufficiently supported proposal from either detector alone, subject to budget.
- Cache reviewed events by media identity, event window, course context, and relevant model/prompt versions. Replaying a reviewed event should not itself cause another discovery call.

Agreement may reflect correlated errors. Evaluate whether combining the detectors actually improves recall or reduces unnecessary reviews.

### Stronger review

The reviewer receives a bounded evidence window, timestamps, course objectives, and detector observations. Detector observations and visible text are untrusted evidence, not instructions.

Return one of:

1. `teachable`: the evidence supports a course-relevant opportunity.
2. `not_teachable`: sufficient evidence is present, but it does not support a suitable opportunity for the current course.
3. `insufficient_evidence`: ambiguity, visibility, or missing context prevents a supported judgment.

The output contains visible observations, relevant concepts, the reason for the verdict, and limitations. It does not contain generated coaching questions, lesson scripts, annotations, or simulation code.

The model's verdict is a decision to evaluate, not proof of scientific correctness. In particular, seeing an action does not reveal an object's mass, measured force, friction coefficient, or other hidden quantities.

## Inputs and media preservation

### Uploaded recordings

Keep the existing video-upload experience and add still images. Uploaded recordings may be scanned as files; also support progressive replay for demonstrating the live pipeline. Label the operating mode clearly. A progressive replay must not consume future frames or use the prepared basketball timestamps as detections.

### Live phone session

Provide a reachable HTTPS camera page and a session-pairing flow. Same Wi-Fi is sufficient for the requested demo, but does not remove the browser's secure-context and camera-permission requirements. Keep model credentials on the server.

Preserve a bounded rolling media buffer so a triggered event includes its lead-up. Save the completed event window before releasing it downstream. A retrievable asset must remain available to the laptop and teammate pipeline; a phone-local `blob:` URL is insufficient.

Keep capture running while analysis is pending. Expose connection loss, processing delay, and analysis failure honestly. Camera capture and actual phone compatibility require device testing.

## Teammate contract

The adjacent [example JSON](detection-handoff.example.json) is a **synthetic contract fixture**, not a real model result. The interface must be implemented and validated before teammates can call it.

### Event record

| Field | Meaning |
| --- | --- |
| `schemaVersion` | Version of this shared contract |
| `eventId`, `sessionId` | Stable server-assigned identifiers |
| `inputMode` | Uploaded video, uploaded image, or live phone |
| `media` | Retrievable clip/image asset and its source bounds |
| `course` | Fixed module and relevant learning objectives |
| `detections` | Individual detector provenance, observations, and scores |
| `fusion` | Whether one or both paths supported the candidate |
| `review` | Verdict, opportunity type, concepts, evidence, rationale, and limitations |

For video, source bounds refer to seconds in the original uploaded recording or the live session's media timeline. Evidence timestamps refer to seconds in the delivered clip, whose first frame is zero. For an image, temporal fields are null. This distinction must stay explicit when clips are extracted.

`rawScore` may be null. Where supplied, `scoreMeaning` identifies what it represents; it is not necessarily an event probability. Model and prompt versions are included for reproducibility.

### Proposed delivery interface

- `GET /api/discovery/sessions/:sessionId/events` — list event records and their status.
- `GET /api/discovery/events/:eventId` — retrieve a completed record.
- `GET /api/discovery/assets/:assetId` — retrieve the event media within the authorized session.
- Session status updates announce that an approved event is ready; the frontend and teammates retrieve its record by ID.

These paths are proposed, not existing endpoints. Implement the contract independently of the existing `Moment` type, which currently combines discovery with lesson questions and anchors.

Rejected and insufficient-evidence results remain available in diagnostics. They do not generate practice notifications. Downstream teaching generation begins only for approved events.

## Training-data decision

Counts below were obtained from public training annotation files. They exclude official validation/test annotations. They are not counts of successfully downloaded, visually verified, or legally cleared media.

| Dataset / target | Training segments | Distinct recordings | Distinct participants |
| --- | ---: | ---: | ---: |
| EPIC: opening cupboard class | 1,342 | 338 | 28 |
| EPIC: opening fridge | 667 | 277 | 32 |
| EPIC: union of those classes | 2,009 | 402 | 32 |
| EPIC: unscrewing lid/cap classes | 9 | 6 | 5 |
| EPIC: pushing/sliding a bottle | 2 | 2 | 1 |
| Kinetics-400: shooting basketball | 445 | 445 source IDs | Not established |

EPIC's cupboard class groups door aliases together; it is not verified room-door coverage. Kinetics shooting clips may differ substantially from the phone viewpoint. Inspect clips before use.

Use pretrained features and public data where accessible and permitted. Collect a small targeted adaptation set if the baseline fails on the intended viewpoint. Reserve separate continuous recordings, people, and environments for evaluation. The amount of new footage needed depends on observed failures; these dataset counts cannot establish a sufficient sample size.

Include held objects, carrying, camera pans, walking past doors, dribbling, and idle footage. A dataset of only trimmed positive actions cannot establish a useful live trigger rate.

EPIC publishes CC BY-NC 4.0 terms. Other datasets have their own access and use conditions. Verify applicability before media acquisition or training; do not silently accept dataset agreements. Do not make access requiring approximately 48 hours a dependency of the 24-hour build.

## AWS findings and remaining checks

The user's workshop and signed-in AWS console were inspected in Chrome on September 16, 2026. The workshop lists Amazon models, Claude Sonnet 4.6, Claude Opus 4.6, and SageMaker, among other services. The workshop is in `us-east-1`; at inspection the event had roughly two days remaining.

Candidate model pairing: a Nova vision model for exploratory checks and Sonnet for stronger review. This is provisional pending real invocation, latency, cost, and evidence-quality checks. SageMaker is a possible training environment; GPU quotas and training access are unverified.

The workshop setup says participants incur no workshop cost, recommends fewer than one generative-AI request per second, and excludes personal/regulated data. Use footage appropriate to these stated constraints. Do not provision unrelated infrastructure or assume that workshop access authorizes spending in a separate account.

No credentials belong in this document, the handoff JSON, browser code, or Git.

## Implementation order within the 24-hour target

1. Implement and validate the event contract, media preservation, and real Bedrock teachability review. Verify credentials/model invocation without coupling review to lesson generation.
2. Establish a pretrained action baseline and the independently scheduled explorer. Add fusion, deduplication, caching, budgets, and diagnostics.
3. Adapt the action recognizer to the selected data where access and compute permit. Record training provenance and evaluate on separate footage.
4. Connect phone capture and still-image input to the same pipeline. Test on the actual phone and laptop.
5. Run held-out continuous recordings, fix material failures, and deliver the API example, run instructions, model/data provenance, and measured results to the user for teammate use.

If a dependency blocks custom training, report that plainly and preserve a separately labeled pretrained baseline. A working pretrained demonstration is not evidence that a custom detector was trained.

## Acceptance and measurement

Functional acceptance:

- Uploaded video and image inputs reach the teachability gate.
- The phone can send a live camera session to the laptop through a secure origin.
- Both detectors can independently nominate candidates; overlapping candidates are combined.
- A stronger model returns validated teachability decisions with reasons and limitations.
- Approved event media is retrievable with the correct timestamps and contract version.
- The webpage announces approved events; teammates can consume the documented handoff.
- Replays do not create redundant analysis calls; failures and budget exhaustion are visible.
- No prepared timestamps, synthetic predictions, or canned approvals are presented as measured detection.

Report on held-out continuous footage:

- Supported-action recall and missed-event examples.
- False candidate triggers per observation hour.
- Human-reviewed quality of approved teaching opportunities.
- Calls, input/output usage where available, and estimated cost for both cloud stages.
- Event-to-verdict latency and capture/processing gaps.
- Performance of action detector alone versus both detection paths, using the same footage and a stated comparison budget.

No numerical accuracy or savings target has been validated or promised. Report observed results and remaining limitations rather than filling in estimates as measurements.

## Sources

- [EPIC training annotations](https://raw.githubusercontent.com/epic-kitchens/epic-kitchens-100-annotations/master/EPIC_100_train.csv)
- [EPIC verb classes](https://raw.githubusercontent.com/epic-kitchens/epic-kitchens-100-annotations/master/EPIC_100_verb_classes.csv) and [noun classes](https://raw.githubusercontent.com/epic-kitchens/epic-kitchens-100-annotations/master/EPIC_100_noun_classes.csv)
- [EPIC downloader](https://github.com/epic-kitchens/epic-kitchens-download-scripts) and [published license](https://raw.githubusercontent.com/epic-kitchens/epic-kitchens-100-annotations/master/license.txt)
- [Kinetics archives and annotations](https://github.com/cvdfoundation/kinetics-dataset)
- [MoViNet transfer-learning example](https://www.tensorflow.org/tutorials/video/transfer_learning_with_movinet)
- [AWS workshop services](https://catalog.us-east-1.prod.workshops.aws/event/dashboard/en-US/workshop/30-aws-services) and [setup constraints](https://catalog.us-east-1.prod.workshops.aws/event/dashboard/en-US/workshop/20-environment-setup)
- [Nova model modalities](https://docs.aws.amazon.com/nova/latest/userguide/what-is-nova.html)
- [W3C Media Capture](https://w3c.github.io/mediacapture-main/) and [Secure Contexts](https://w3c.github.io/webappsec-secure-contexts/#is-origin-trustworthy)
