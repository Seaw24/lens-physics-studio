# Synthetic fixtures

> These are historical 1.1 fixtures. Detector provenance and related schemas must be revised for [the new direction](../VISION-FIRST-DIRECTION.md); they do not describe a working or newly approved detector.

These files describe interfaces and test cases. They contain no real media, trained-model output, token measurements, or accuracy results. Placeholder asset URLs do not exist yet.

| File | Purpose |
| --- | --- |
| `approved-video.json` | Complete contract 1.1 handoff for a hypothetical approved video event |
| `approved-image.json` | Complete scene-context image handoff with null temporal fields |
| `evidence-index.json` | Trusted frame IDs/source times corresponding to the examples |
| `explorer-rotation.json` | Raw candidate-finder JSON, before server-added provenance |
| `explorer-empty.json` | Normal no-candidate result |
| `reviewer-teachable.json` | Raw teachability approval, before server-added timestamps/provenance |
| `reviewer-not-teachable.json` | Valid scientific rejection, distinct from a transport failure |
| `reviewer-insufficient-evidence.json` | Valid uncertainty verdict |

During implementation, validate through shared Zod schemas and frame-aware semantic validators. Keep these available for teammate development and automated tests; do not automatically return them when credentials or model weights are missing.
