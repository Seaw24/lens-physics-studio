# One card per physics concept, and full-context lesson drafting

Date: 2026-09-16 · Status: approved (the user chose per-video scope and delegated the remaining decisions)

## Problem

**Repeats.** 8 of the 17 "not correct" labels say "already have this". The Opus 4.6 judge sees only the current 6 s window (plus lessons and up to 4 labeled examples from other videos), never the earlier cards of the same video. Windows overlap by 3 s, so the judge re-finds the same moment and words it differently. The server merge (`eventsOverlap`) needs the same normalized subject text, at least 50% time overlap and shared frames, so rewordings and same-concept-different-object repeats (pushing a can, then a table) pass. Two active judge lessons that say "reject repeats of approved cards" cannot be followed.

Those repeat labels are stored as `should_reject`, so they count as "not teachable". They can be picked as calibration examples for other videos, telling the judge that a real push is not teachable.

**Thin lesson drafting.** The drafter gets text only: recent labels (Nova's proposal summary, judge verdict and reason, human tags and note), unlabeled judge outcomes, and non-rejected lesson texts. It never sees the frames, the base rules it is told not to restate, rejected lessons, held-out check results, the judge's approved opportunity or analysis, or what the video had already covered. It can only add lessons, so overlapping and unfollowable lessons pile up.

## Decisions

- One card per physics concept **per video (session)**. Re-running a video starts fresh.
- The judge decides whether a moment repeats a covered concept; the server enforces it. Nova is unchanged.
- The public event contract (`EventSchema`, teammate handoff) is unchanged. Concepts live on candidates.

## 1. Video context for the judge

`server/discovery/videoContext.ts` (pure) builds the context from the session right before each review.

**Covered concepts** (refs `C1…Cn`, in time order): published events only, unless the event's card carries a human `should_reject` label (either the approval was not real, or it repeats another covered card). Each entry shows time range, concept, subject, observation, objectives, and the human label and note.

Human corrections are decisions, not coverage. After code review they were moved out of the covered list; otherwise a concept the human confirmed would be blocked from ever being published as an event.

**Earlier decisions** (at most 10; human-labeled first, then newest):
- rejected cards (verdict, judge reason, Nova's subject, human label and note), including human-approved ones;
- capture-gap blocks, labeled as such;
- spot-check cards the human marked `should_approve`;
- approvals the human rejected as not real (`should_reject` without the `already_covered` tag);
- already-covered cards with any not-correct human label.

The judge prompt says this list is data, not instructions.

The rendered text goes first in the user content and says it describes earlier windows, not the images that follow. It is per-call data, like frames, so it is not part of the prompt hash. The reviewer stage evidence file stores the text and the ref map.

Candidates now keep compact Nova proposal summaries (`novaProposals`) so the builder stays synchronous.

## 2. Judge output

Each opportunity adds:
- `concept`: the physics idea a teacher would teach from the moment, without naming objects, people or setting (for example "a push sets a resting object sliding").
- `coveredBy`: `"none"` or the covered ref it repeats. The tool schema makes it an enum of the supplied refs.

New judge rules:
- Two moments share a concept when the same qualitative explanation teaches both, whatever the objects.
- Report up to three distinct grounded opportunities, uncovered concepts first, each concept once per window.
- Coverage never changes the teachability verdict.
- Earlier decisions are context for consistency, not evidence about the current frames. Human notes there are ground truth about those earlier windows.
- The analysis compares each opportunity with the covered list.

Zod: `JudgedOpportunitySchema` is the grounded opportunity plus optional `concept` (at most 160 characters) and optional nullable `coveredBy`. `ReviewResponseSchema` uses it, so old fixtures stay valid. Validation rejects an unknown `coveredBy` ref and sends one repair turn. `PROMPT_VERSION` becomes v2.1.0.

## 3. Server handling of a teachable review

- An opportunity with `coveredBy` resolves to a coverage ref: `{candidateId, eventId, concept, subject, startSeconds}`.
- A new opportunity whose normalized concept equals one already published from the same response is covered by that one.
- New opportunities publish with `concept` and `coveredBy` stripped, since the public schema is strict. The existing overlap merge still runs; a merge records the merged event as `coveredBy`.
- The candidate stores `opportunities: CandidateOpportunity[]` = `{concept, subject, observation, connection, objectiveIds, eventId, coveredBy}`.
- Card kind is settled in a `finally` step after publishing, so a publication error still stores opportunities and records the outcome:
  - `approved` when at least one event was published;
  - `already_covered` (state `suppressed_duplicate`) only when every opportunity is covered;
  - otherwise the publish outcome (for example a capture gap) stands.
- `ProposerOutcome.alreadyCovered` is true only for all-covered cards.
- While a card is still publishing (state `reviewing`), it is hidden in the UI and feedback on it returns 409 `CARD_NOT_READY`.
- Drafting and lesson checks return 409 `SESSION_ACTIVE` while any session is ingesting, paused, or draining. They share the serialized model queue and would stall live review.

## 4. Human feedback and metrics

- New card kind `already_covered`. New issue tag `already_covered` ("Already covered by another card"), offered on approved cards.
- On an already-covered card: Correct means the same concept. Not correct offers three verdicts:
  - "New concept, should be its own card" (`should_approve`);
  - "Nothing teachable here" (`should_reject`);
  - "Right call, wrong details" (`wrong_details`).
- `humanTruth` asks whether the content was teachable:
  - the `already_covered` tag gives true;
  - already-covered cards count as a teachable model call.
- Repeat labels are the tag, or any label on an already-covered card except "Nothing teachable here", which is a teachability label. They are left out of cross-video judge examples and held-out lesson checks.
- Report and session scoreboard add repeats caught, missed repeats (approved card plus tag) and wrong merges (already-covered card plus `should_approve`). A missed repeat is not a false approval, and a wrong merge is not a false rejection.
- A one-time startup migration tags the 8 legacy repeat labels: approved, `should_reject`, and a note matching `duplicate`, `have this`, or `already have|has|there|approved|covered`, but not "already open". It also syncs the stored session copy of each tagged label, logs the tagged IDs, and records itself in `learning/migrations.json`.

## 5. Card UI

- Already-covered cards collapse under "N already covered" after the main cards. Each shows the covering card's subject, time and concept.
- Approved event cards show their concept.
- The feedback dialog's labels depend on the card kind.
- The learning metrics and session scoreboard show repeats caught, missed and wrongly merged.

## 6. Lesson drafter context

Feedback records gain, at label time:
- `judge`: `{analysis (≤ 2,000 chars), opportunities}`;
- `evidenceFrameIds`;
- `videoContext`: rendered text, ≤ 4,000 chars.

A startup backfill fills `judge` and `evidenceFrameIds` for older records whose session files still exist (sessions expire after 24 h).

`server/discovery/draftContext.ts` builds the draft request, and `server/discovery/contactSheet.ts` renders the images. The request has four parts:

1. **Reference**: course objectives, Nova's and the judge's base system prompts, every lesson (all statuses, IDs, support, contradictions, check results, replacement and retire info), and the latest report metrics.
2. **Human cases with a contact sheet**: at most 20, because Bedrock Converse accepts at most 20 images per request.
   - Eligible: non-holdout cards with kept frames.
   - Order: cards with a note first, then other not-correct cards, then correct ones; newest first within each group.
   - Case text: time range, card kind, Nova proposals, the judge's verdict, reason, opportunities, concepts and analysis, the human verdict, tags and note, and the video context.
   - Sheet: the kept frames tiled in time order, each labeled with tile number and time, evidence frames outlined. Sized at most 1.15 MP and 1,568 px on the long edge, about 1.5K tokens.
3. **Remaining human cases** as text, up to 60 human cases in total.
4. **Unlabeled judge outcomes** (at most 60) as text, for Nova lessons only.

A new drafter system prompt explains:
- the pipeline;
- the card kinds;
- how to read a contact sheet;
- the one-concept rule;
- what each lesson status means, including that rejected lessons are never re-proposed;
- what a repeat label means;
- that Nova never sees other cards.

Drafter output, through a forced tool:
- `analysis`;
- `lessons`, at most 6: model, text (≤ 280 chars), supportingIds, contradictingIds, and `replacesLessonIds` (an enum of existing same-model, non-rejected lessons);
- `retire`, at most 6: lessonId (an enum of active, pending and needs-evidence lessons), reason, supportingIds.

The server:
- drops exact normalized repeats of any existing lesson, rejected ones included;
- keeps only same-model, non-rejected `replaces` targets;
- stores retire suggestions on the target lesson;
- uses maxTokens 10,000 and a 240 s timeout.

## 7. Lesson actions

- Accepting a lesson with `replaces` turns the replaced lessons off. The active-lesson cap subtracts the active lessons being replaced.
- A new `dismiss_suggestion` action clears a retire suggestion. Turning off or rejecting a lesson also clears it.
- Lesson rows show "Replaces …", and the Accept button says how many lessons it turns off. They also show "Opus suggests turning this off: …" with Turn off and Keep buttons.

## Cost (Opus 4.6 on Bedrock, $5 input / $25 output per million tokens)

- **Judge review:** 1–3K more text input tokens, about $0.12 → $0.13.
- **Draft lessons:** about 6K → 70–95K input tokens (the 20 sheets are about 31K) plus about 3K output, so about $0.05 → $0.40–0.70 per click. A repair turn doubles it; long ID lists and concept names are trimmed to avoid repairs.

## Not included

- Nova does not see covered concepts.
- No deduplication across videos.
- No automatic lesson changes: replacements and retire suggestions wait for a click.

## Testing

**Unit tests:**
- video context building and rendering;
- judge tool schema and `coveredBy` validation;
- `humanTruth`, examples and report metrics for repeat labels;
- contact sheet size limits;
- draft request assembly: all lesson statuses, base prompts, at most 20 images, priority order, holdout excluded;
- lesson store: rejected-text dedup, replacements on accept and the cap, retire suggestions, dismiss;
- the migration tags labels exactly once.

**Service tests:**
- a later window that repeats a covered concept becomes an already-covered card and publishes nothing;
- a mixed window publishes only its new concept;
- the review request text contains the covered ref and its concept.

**Checks:** `npm test`, `tsc --noEmit`, `vite build`, `npm run discovery:contract`.
