# Dataset audit — September 16, 2026

> Direction update: the factual checks below remain valid, but the user has since rejected custom action training. The recommendation to proceed with a curated training pilot is superseded by [the pretrained-vision direction](VISION-FIRST-DIRECTION.md).

**Decision:** EPIC-KITCHENS contains promising source material for a curated door-opening detector pilot. Kinetics contains relevant action annotations, but its video quality has not been verified here. Neither dataset is approved as a ready-to-train Lens dataset. No model training, target-camera evaluation, or reliability measurement was performed.

The earlier recommendation was based on annotation coverage and documentation. This follow-up adds structural checks, download probes, full decoding of three EPIC originals, and visual inspection of sampled frames around three annotated actions.

## What was actually checked

| Check | EPIC-KITCHENS-100 | Kinetics-400 |
|---|---|---|
| Downloaded public annotation files | Train, validation, class mappings, video metadata | Train and validation |
| Selected target annotation counts | 2,009 opening cupboard/fridge segments | 445 shooting basketball; 773 dribbling basketball; 582 opening bottle |
| Target rows: missing required fields / invalid time ordering / duplicate IDs | 0 / 0 / 0 | Valid positive ten-second intervals and unique source IDs within each selected class |
| Target intervals outside listed video duration | 0 | Not established; ten-second annotation length does not prove playable media length |
| Target duplicate same-label intervals | 0 | One selected row per source ID within each class |
| Train/validation overlap check | No shared video IDs or narration IDs across the two full annotation files | No selected training source IDs occur in the validation CSV |
| Media access | Six selected original URLs returned HTTP 200 on HEAD after resolving storage paths | One archive URL returned HTTP 200 on HEAD; size 1,631,315,939 bytes |
| Actual original downloads | Three complete files, about 229 MB total | None |
| Full video-stream decode | Three passed FFmpeg 7.1 with `-xerror`; no decoder error output | Not checked |
| Visual inspection | 16 sampled frames around each of three target actions | Not checked |
| Trained model or accuracy | Not tested | Not tested |

Metadata results and input hashes are saved in [metadata-audit.json](data-audit/metadata-audit.json) and [sources.json](data-audit/sources.json). Safe HTTP results are in [access-checks.json](data-audit/access-checks.json). Video download/decode provenance is in [video-checks.json](data-audit/video-checks.json).

These checks do not establish perceptual duplicate freedom, accurate boundaries for every action, visual label correctness across the dataset, participant-independent generalization, or suitability for the final glasses camera. Matching ID checks are not a perceptual duplicate detector. The visual sample is small and deliberately biased toward short downloadable recordings, not random.

## EPIC results and clips to inspect yourself

Official resources:

- [Dataset overview](https://epic-kitchens.github.io/2026)
- [Annotations and documentation](https://github.com/epic-kitchens/epic-kitchens-100-annotations)
- [Training CSV](https://raw.githubusercontent.com/epic-kitchens/epic-kitchens-100-annotations/master/EPIC_100_train.csv)
- [Download scripts and current errata](https://github.com/epic-kitchens/epic-kitchens-download-scripts)
- [Published dataset license](https://github.com/epic-kitchens/epic-kitchens-100-annotations/blob/master/license.txt)

The 67,217-row training CSV contains 1,342 candidates for `verb_class=3, noun_class=3` and 667 for `verb_class=3, noun_class=12`. Together these span 402 recordings and 32 participants. The noun classes mean cupboard and fridge; they are broader taxonomy groups. For example, cupboard includes raw labels such as door, cabinet, flap, and cage. The class alone does not certify a visible hinged-opening action.

The following original files were downloaded completely and decoded successfully. The inspection used ordered frame samples, not a frame-by-frame review of the entire recordings. All three selected actions looked consistent with their broad opening labels.

| Original file / action ID | Annotated action time | Visual finding | Target-window assessment |
|---|---|---|---|
| [P26_12.MP4](https://data.bris.ac.uk/datasets/3h91syskeag572hl6tvuovwv4d/videos/train/P26/P26_12.MP4), `P26_12_3` | 9.09–10.24 s | Hand reaches to a wooden cupboard; a door opens and exposes the contents. Camera rotation and blur are present. | Plausible opening positive with surrounding footage. Raw narration says “open door”; this sample is a cupboard. |
| [P08_07.MP4](https://data.bris.ac.uk/datasets/3h91syskeag572hl6tvuovwv4d/videos/train/P08/P08_07.MP4), `P08_07_2` | 3.46–5.41 s | A white upper cupboard door opens while the camera tilts; the arm partly obscures the scene. | Plausible opening positive; precise hinge geometry is not consistently visible. |
| [P03_115.MP4](https://data.bris.ac.uk/datasets/2g1n6qdydwa9u22shpxqzp0t8m/P03/videos/P03_115.MP4), `P03_115_0` | 2.00–2.50 s | Fridge changes from closed to open, followed by reaching inside. The action is brief and the viewpoint moves. | Plausible short opening positive. Preserve the lead-in; do not train only on the already-open interior. |

These files are approximately 71, 91, and 67 MB respectively. Local originals, contact sheets, and raw logs are in the ignored `.runtime/dataset-audit/` directory. Contact sheets sample approximately four seconds at 4 fps, starting at 8.1 s, 2.5 s, and 1.0 s respectively. They provide a visual spot check, not precision boundary validation or a training acceptance rate.

### Important findings for implementation

1. **Most events are short.** Across the 2,009 candidates, median duration is 1.15 s; 1,743 (86.8%) are under two seconds and 697 are under one second. The shortest is 0.24 s. Sampling and context matter, especially at the proposed live rate of 8 fps. Do not stretch short clips to fabricate motion or assume one frame contains an action.
2. **Storage split is not the same as our learning split.** `P11_06` occurs in the EPIC-100 training annotations but is stored under the original EPIC-55 `videos/test/` path. Guessing `videos/train/` returned 404; using official EPIC-55 split metadata returned 200. This was a path-construction mistake during the audit, not a missing video or a dataset corruption finding.
3. **Interrupted files are not evidence of bad source media.** `P08_07` hit the audit's 150-second acquisition limit. Its partial download could not be decoded because its MP4 metadata was incomplete. A verified HTTP Range resume completed the file, after which full decoding passed. Production acquisition must keep incomplete files out of the training manifest.
4. **Published frame corrections exist.** The authors identify old pre-extracted RGB/flow errors for `P01_109` and `P27_103`; original videos and action annotations were unaffected. The current downloader README says it retrieves corrected files. Prefer originals with fresh decoding, or verify corrected frame versions. Do not repeat the older annotations README's stale implication that replacements are still pending.
5. **This is an action dataset.** Its labels do not say whether an event teaches the student's current physics objective. The stronger reviewer remains responsible for that decision. These samples do not support measured force magnitudes, precise lever arms, or precise torque values from video alone.

EPIC's published license is CC BY-NC 4.0. Preserve attribution and confirm the intended use fits the dataset terms before building a distributable or commercial training artifact. This audit does not resolve future product licensing.

## Kinetics results and inspection links

- [Official CVDF download repository and corruption notice](https://github.com/cvdfoundation/kinetics-dataset)
- [Training annotations](https://s3.amazonaws.com/kinetics/400/annotations/train.csv)
- [Validation annotations](https://s3.amazonaws.com/kinetics/400/annotations/val.csv)
- [Training archive links](https://s3.amazonaws.com/kinetics/400/train/k400_train_path.txt)

The downloaded training CSV has 246,534 rows. The selected classes have 445 / 773 / 582 distinct source IDs respectively, each with a valid ten-second annotated interval. No selected training ID appears in the validation CSV. These checks only validate the annotation structure.

CVDF documents roughly 1,400 corrupted Kinetics-400 files and provides replacements for most of them. That is a publisher-reported historical issue, not a corruption count measured in this audit or a count for our selected classes. A HEAD check confirmed one 1.63 GB archive is accessible; the archive was not downloaded. Individual target clips may still be missing, truncated, or unsuitable.

For our task, every selected basketball training window needs inspection and temporal labeling. A ten-second “shooting basketball” segment is not a frame-accurate release annotation. A “dribbling basketball” clip may contain a later shot and must not automatically become ten seconds of negative data. “Opening bottle” does not guarantee screw-cap rotation.

The CSV's `is_cc` flag is 1 for only 3 of the 445 shooting-basketball rows; that metadata flag is not independent verification of current rights or a blanket license for other videos. Check source media terms for the actual training subset. Do not assume annotation availability establishes video reuse rights.

## Required admission gate for the pilot

Before training, the implementer must build an accepted-window manifest, not train directly from these class counts:

1. Fetch only the chosen subset; check complete transfer, applicable source checksums, and full video-stream decoding. Record file hashes and decoder versions. Audit SHA-256 values establish what was downloaded here; they were not compared against publisher checksums.
2. Inspect every pilot window. Record `accept`, `reject`, or `uncertain`, visible action, action interval, blur/occlusion, and rejection reason. Use full-motion playback when sampled frames are ambiguous. Exclude unresolved uncertain examples from supervised positives and negatives.
3. Add same-environment negatives: closing a door, standing beside an open door, camera movement, reaching without opening, dribbling without a shot, holding/passing, and idle court scenes. Inspect for overlapping target actions.
4. Keep original recordings and near-duplicates within one split; use participant separation for the claimed unseen-person evaluation. Respect official validation/test boundaries and record any additional internal training split.
5. Train the small head and measure on separate continuous phone recordings: event recall, false proposals per minute, latency, and stronger-reviewer acceptance. A good isolated-clip score cannot establish useful all-day behavior.

Proceed with the curated EPIC pilot. Keep Kinetics acquisition and visual checks explicitly pending. Retain the small target-camera recording plan and the independent explorer path. No dataset-wide cleanliness percentage or live-detector reliability claim is justified by this audit.
