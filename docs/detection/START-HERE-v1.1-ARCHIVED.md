# Implementation pack: Lens discovery

> Superseded architecture (September 16, 2026): read [VISION-FIRST-DIRECTION.md](VISION-FIRST-DIRECTION.md) first. The custom action-training requirement and mandatory two-detector design are withdrawn. This document retains historical details; do not execute its old training plan or copy its detector schema as the new design.

This pack turns the completed product interview into an implementation assignment. It is a specification, not a claim that discovery has been implemented. The existing app is a React/Express teaching demo.

## Read in this order

1. [Implementation specification](IMPLEMENTATION.md): architecture, media, scheduling, API, UI, failures, and integration.
2. [Reference contracts](contracts.ts): exact TypeScript shapes to implement with runtime Zod validation.
3. [Model and data instructions](MODELS-AND-DATA.md) and [dataset audit](DATASET-AUDIT.md): baseline, actual data checks, custom training, data splits, and evaluation.
4. [Model prompts](PROMPTS.md): explorer and reviewer instructions and output schemas.
5. [Implementation tickets](TASKS.md): ordered, independently verifiable work units.
6. [Examples](examples/): synthetic API/model fixtures. Never display them as real model results.
7. [Runbook and teammate integration](RUNBOOK.md): intended setup commands, phone checks, and a read-only consumer example.

The [earlier brief](../DETECTION-BUILD-BRIEF.md) records product decisions. This pack supplies concrete engineering defaults where that brief left choices open. These defaults can be tuned from measured performance without reopening the agreed product scope.

## Copy this prompt into the implementation task

```text
Implement Lens discovery in this existing repository using docs/detection/START-HERE.md.

Read IMPLEMENTATION.md, contracts.ts, MODELS-AND-DATA.md, DATASET-AUDIT.md,
PROMPTS.md, and TASKS.md.
Treat the product scope as settled. Do not redesign the teaching experience.

Build uploaded photo/video and same-Wi-Fi phone-camera input, a local temporal
action recognizer, an independently scheduled cheap vision explorer, candidate
fusion, and a stronger Bedrock teachability reviewer. Preserve event media and
export the documented verdict contract. Teammates own questions, annotations,
tutoring changes, and simulations.

Execute tickets D00–D12 in dependency order. Maintain an implementation log at
docs/detection/IMPLEMENTATION-STATUS.md with completed ticket IDs, validation,
measured behavior, commands needed to resume, and concrete blockers. Do not
overwrite user or teammate changes. Follow applicable AGENTS.md instructions.

Use reference contracts and examples; implement real runtime validation and
the specified semantic checks. Keep model calls injectable for deterministic
tests. Keep fixtures confined to tests and explicit demo fixtures. Never use
prepared basketball timestamps, object-color heuristics, or canned verdicts
as if they were trained action recognition.

The deadline target is 24 hours. Prefer the specified simple architecture.
Do not spend the time budget adding databases, agent frameworks, unrelated
cloud infrastructure, or lesson generation. Test each ticket, then continue.

Model and data access may fail. Report the exact blocker, preserve working
independent paths, and label degraded behavior. Missing trained weights must
not become a hidden fake detector; a pretrained baseline is not custom training.
Do not claim live-phone success without a real device test. Ask for user action
only when access, phone permission/trust, or unavailable footage requires it.

Deliver working code, run instructions, model/data provenance, retrievable
event clips, the teammate API contract, and an honest measured evaluation.
Do not stop after scaffolding or mocked tests. Distinguish functional pipeline
completion from detector quality and from pending external dependencies.
```

## Fixed boundary

The deliverable is **input → candidate → preserved evidence → teachability verdict → handoff**. An approved event contains a clip/image, detector provenance, observations, concepts, and limitations. It contains no generated lesson question, annotation, or physics-lab code.

The initial trained action families are opening hinged cupboard/fridge doors and shooting/throwing a basketball. The explorer may discover other force/torque contexts independently. Still images can yield scene-context opportunities but never action recognition from a nonexistent sequence.

## Important engineering choices

- One Express server and one persistent Python worker on the laptop. No separate Python HTTP service.
- Bedrock Nova Lite is the initial explorer; Sonnet 4.6 is the initial reviewer. Verify invocation access, and keep IDs configurable.
- Version 1 phone capture transmits timestamped JPEG frames at a target of 8 fps. It produces silent event MP4s from those real frames. This is explicitly a sampled camera recording, not original 30-fps capture. Uploaded-video event clips retain the source's motion detail through normal transcoding.
- Phone capture uses a trusted HTTPS origin. Same Wi-Fi alone does not grant camera access.
- Results use contract `1.1`, which expands the earlier draft `1.0` with media fidelity, lifecycle, and reproducibility fields. No running API currently depends on either draft.
- Defaults in this pack are initial tuning values, not validated accuracy or cost claims.

## What is still an external dependency

Actual Bedrock permission, usable training-media access and terms, compute performance, compatible FFmpeg/Python installations, and the user's phone test must be checked during implementation. The workshop's service list is not proof that any particular invocation or GPU job will succeed.

## Minimal handoff to teammates

Share [contracts.ts](contracts.ts), [the approved example](examples/approved-video.json), and the API section of [IMPLEMENTATION.md](IMPLEMENTATION.md). Teammates can develop against these fixtures immediately; live endpoints arrive with the implementation. Do not send these files to other people automatically.
