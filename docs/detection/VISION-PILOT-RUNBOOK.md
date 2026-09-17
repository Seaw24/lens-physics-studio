# Running the first visual-understanding pilot

This is a command-line evaluation harness, not the live discovery feature. It uses actual Bedrock calls on locally reviewed, privacy-masked frames. It does not train a model, generate lessons, or expose an API to teammates.

## Files

- [Core prompt, request builder and validators](../../scripts/vision-eval-core.mjs)
- [Bounded Bedrock runner](../../scripts/vision-eval.mjs)
- [Local result revalidation and summary](../../scripts/summarize-vision-eval.mjs)
- [Local frame preparation helper](../../scripts/prepare-vision-eval.py)
- [Evaluation harness tests](../../tests/vision-eval.test.ts)

Install the repository's locked dependencies first. The scripts use its existing AWS SDK and Zod dependencies; no application routes were changed. `node` refers to the configured Node runtime. On this machine it is `/Users/u1614968/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node`.

## Actual intake

Two user-provided portrait recordings, 720×1280, nominally 30 fps, durations approximately 27.38 and 79.78 seconds. The short can recording is development material. The longer table/door/plate recording is held out from model-based prompt tuning. The user's event descriptions and local privacy previews were available at intake; this is not a blinded study or an unseen-environment benchmark.

Keep all originals, frame bytes, source paths, reference labels, credentials and raw outputs in the ignored `.runtime/vision-evaluation/` folder. Inputs remain in their original Downloads paths; preparation does not edit them. The source manifest records their SHA-256 hashes. Full videos and audio are not sent to Bedrock.

The reference labels live in `reference-events.json`, independently of `manifest.json`. Neither the runner nor the model request builder reads reference labels. The input builder only allows course objectives, evidence limitations, frame IDs, frame times and image bytes into the request. The media-time grid is uniform and not selected around the reference events.

## Frame preparation

`preparation-config.json` contains one entry per source:

```json
{"sources":[{"sourceId":"clip-1","split":"development","path":"/absolute/local/video.mp4","durationSeconds":27.38,"privacyFilter":"<locally reviewed FFmpeg drawbox filters>"}]}
```

The supplied helper is deliberately specific to these portrait recordings. Verify geometry, start time and masks before adapting it to another source. A new output folder is required to prevent stale frames from an earlier preparation being reused.

```sh
python scripts/prepare-vision-eval.py \
  --config .runtime/vision-evaluation/preparation-config.json \
  --ffmpeg /absolute/path/to/ffmpeg \
  --output .runtime/vision-evaluation-reprepared
```

It extracts JPEGs at 2 fps, scales to 540×960, hashes every image, and creates contact sheets of every planned cloud frame. `cloudFramesPrivacyReviewed` starts false. Inspect the resulting images before explicitly setting it true. That flag records a local review; it is not an automatic anonymization guarantee. Retain the mask description in the manifest and report its effect on evidence visibility.

The current pilot masks bystanders/name-badge areas in the can recording and signage/distant-person areas in the longer recording. The masks obscure some non-target surroundings and portions of some frames. Therefore performance is measured on these transformed frames, not on the unmodified videos. No universal face-removal system was implemented.

## Credentials and calls

The current workshop's temporary CLI credentials were obtained from its authorized browser UI and stored as `workshop-credentials.json` with file mode 0600. It contains the standard `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, and `AWS_SESSION_TOKEN` fields. Its values must stay out of logs, source control, fixtures and prompts. The default machine login was expired; the workshop credentials were independently verified against the expected workshop account before invocation. Temporary credentials will eventually expire.

The pilot model is `us.anthropic.claude-sonnet-4-6` in `us-east-1`. The initial preflight was a separate 17-token text invocation; successful visual invocation is recorded in actual run results. See [AWS's model card](https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-6.html). Sonnet receives ordered images, not native video or audio.

Inspect the planned scan without making any model call:

```sh
node scripts/vision-eval.mjs \
  --manifest .runtime/vision-evaluation/manifest.json \
  --split development \
  --run .runtime/vision-evaluation/new-development-run
```

Invoke only when intentionally running a new paid evaluation:

```sh
node scripts/vision-eval.mjs \
  --manifest .runtime/vision-evaluation/manifest.json \
  --credentials .runtime/vision-evaluation/workshop-credentials.json \
  --split development \
  --run .runtime/vision-evaluation/new-development-run \
  --invoke
```

Use `--split holdout` with a new directory for the longer recording. The run directory must not exist. There is no auto-resume or automatic replay of an ambiguous request. Choose a new run only deliberately; the per-run cap is not an account-wide spending limit. Do not start two copies in parallel—the 1.3-second start spacing is per process.

The runner scans six-second windows every three source seconds, using up to 12 real images per window. It allows one invocation at a time, at most 40 planned calls per run, and no SDK retries. It saves the frozen prompt/config hash and evidence hashes, writes a `started` record before each call, and records usage, latency, stop reason and raw model text afterward. A transport/account failure stops the run. Output validation failure is recorded separately from a physics verdict; it is never converted to “not teachable.”

## Revalidate results without additional model calls

```sh
node scripts/summarize-vision-eval.mjs \
  --manifest .runtime/vision-evaluation/manifest.json \
  --run .runtime/vision-evaluation/sonnet-development-v1 \
  --output .runtime/vision-evaluation/new-local-summary.json
```

The first development run emitted JSON inside one outer Markdown fence. Initial strict parsing rejected that wrapper. The parser now removes exactly one complete outer JSON fence before validation, without changing any content, extracting JSON from prose, repairing values, or calling another model. Original raw run files are preserved; a separate normalized report revalidates them. Prompt/model inputs were unchanged for the holdout. Additional prose, unknown fields/IDs, reversed intervals, non-temporal action claims and unsupported objective IDs still fail validation.

## Reading the results

Do not count every opportunity row as a distinct successful discovery. Adjacent windows overlap, the same event may support several concepts, and the model may repeatedly propose a static scene. Raw proposal counts are reported before deduplication. No production grouping or notification policy exists in this harness.

Compare event observations with the user's approximate intervals and with actual evidence. The supplied labels are positive examples and not exhaustive negatives. An extra proposal is not automatically false. Finding the right object/time does not make every claimed motion, force, or curriculum explanation correct. Human review is still needed to establish approval precision and an accepted event-level reference set.

The initial result report distinguishes labeled-event coverage, unsupported claims, repeated proposals, tokens, latency and untested live behavior. This small pilot is not proof of broad generalization, continuous mobile efficiency or reliability across subjects.
