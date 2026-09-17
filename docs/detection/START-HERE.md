# Lens discovery v2

The V01–V08 feature is implemented. Use [DISCOVERY-SETUP.md](DISCOVERY-SETUP.md) to run it, [DISCOVERY-API.md](DISCOVERY-API.md) for integration, [IMPLEMENTATION-STATUS.md](IMPLEMENTATION-STATUS.md) for exact completion status, and [EVALUATION-V2.md](EVALUATION-V2.md) for measured model results.

The user rejected topic-specific custom action training. The current design uses buffered media, bounded activity/periodic scheduling, an inexpensive pretrained visual proposer, and independent stronger visual review. It returns playable media and a teaching verdict; teammates own questions, annotation, and the lab.

## Historical implementation launcher

```text
Read docs/detection/FINAL-IMPLEMENTER-PROMPT.md and execute its instructions.
Implement all V01–V08 work packages in docs/detection/IMPLEMENTATION-V2.md in
this repository. Preserve existing work and the teaching demo. Use the v2
contracts and prompts, not the superseded custom-training plan. Finish the
working feature, tests, real checks available with current access, setup,
and teammate handoff. Do not stop at another plan. Report external device or
credential checks honestly if they cannot be completed.
```

## Files to use

| File | Purpose |
| --- | --- |
| [Final implementer prompt](FINAL-IMPLEMENTER-PROMPT.md) | Complete instructions for the implementation model. |
| [Version 2 build specification](IMPLEMENTATION-V2.md) | Source adapters, scheduling, models, API, security, budgets, work order, and acceptance. |
| [Version 2 model prompts](V2-MODEL-PROMPTS.md) | Separate candidate finding and independent visual review; grounding and abstention rules. |
| [Contract seed](v2/contracts.ts) / [executable checks](v2/check-contract.ts) | Structured model outputs and public media/verdict contract with semantic validation. |
| [Original pilot results](EVALUATION.md) | Real observations, known hallucinations, usage, and latency; preserve as historical evidence. |
| [Implementation status](IMPLEMENTATION-STATUS.md) | Completed functionality, checks, and remaining external validation. |
| [Discovery setup](DISCOVERY-SETUP.md) | Local, cloud, evaluation, and trusted same-Wi-Fi phone operation. |
| [Discovery API](DISCOVERY-API.md) | Authenticated v2 routes and teammate consumption. |
| [V2 evaluation](EVALUATION-V2.md) | Real implementation calls, outcomes, usage, and limitations. |
| [Pilot runbook](VISION-PILOT-RUNBOOK.md) | Existing CLI evaluation and saved evidence; not live-feature setup. |
| [Research direction](VISION-FIRST-DIRECTION.md) | Motivation and experiment order; V2 now resolves build defaults. |

The earlier `IMPLEMENTATION.md`, `TASKS.md`, `RUNBOOK.md`, `PROMPTS.md`, root `contracts.ts`, and `examples/` are historical version 1.1 material. Do not execute their training plan or mix their schema with version 2.0. The original dataset audit remains factual evidence about inspected data, not a mandate to train.

The runtime, UI, bounded cascade, and phone transport are implemented. Automated checks and real uploaded-media calls have run. A physical-phone end-to-end check, full masked-pilot comparison, fresh-data evaluation, and broad reliability claim remain outstanding.
