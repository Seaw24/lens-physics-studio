# One Card per Concept + Full-Context Lesson Drafting: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Opus judge sees this video's earlier cards and marks repeated physics concepts, so each video shows one card per concept. The lesson drafter gets every lesson, the base rules, contact-sheet images of labeled cards, and the full judge and human context, and can suggest replacing or retiring lessons.

**Architecture:**
- A pure `videoContext` module turns session state into a text block of covered concepts and earlier decisions for the judge.
- The judge's tool output gains `concept` and `coveredBy` for each opportunity. The service publishes only uncovered concepts; otherwise the card becomes `already_covered`.
- Drafting is assembled by `draftContext`, with images from `contactSheet`. Lesson replacement and retire suggestions live in `LearningStore`.

**Tech Stack:** TypeScript (ESM), Node 24 test runner through tsx, zod 3, sharp 0.35, AWS Bedrock Converse (Nova Lite proposer, Opus 4.6 judge and drafter), React 19 and Vite.

Spec: `docs/superpowers/specs/2026-09-16-concept-dedup-and-lesson-context-design.md`

## Global Constraints

- Node binary: `/Users/u1614968/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin` must be on PATH. Run tests with `node --import tsx --test tests/*.test.ts` and typecheck with `./node_modules/.bin/tsc --noEmit`.
- The public `EventSchema` and `GroundedOpportunitySchema` stay unchanged. Judge-only fields (`concept`, `coveredBy`) are stripped before publishing.
- Bedrock Converse allows at most 20 images per request.
- Contact sheet: at most 1,150,000 px total and at most 1,568 px on the long edge.
- Dedup scope is one session (video). Nova's prompt and inputs are unchanged.
- `PROMPT_VERSION` becomes `discovery-v2.1.0-2026-09-16`; `REQUEST_CONSTRUCTION_VERSION` becomes `chronological-image-request-v2.1.0`.
- Drafter call: maxTokens 10,000, timeout 240,000 ms. At most 80 human cases, 20 with images, and 60 judge-only outcomes.
- Judge context: at most 10 earlier decisions; covered refs are `C1…Cn` in time order.
- No git commits (the user has not asked). Checkpoints are full test runs instead.
- Existing 43 tests must keep passing; update only tests whose asserted API intentionally changed (the `draft()` signature).

## File Map

| File | Responsibility |
|---|---|
| `shared/discovery.ts` (modify) | `JudgedOpportunitySchema`, `publicOpportunity`, `CoverageRef`, `CandidateOpportunity`, `CandidateSummary.opportunities` |
| `shared/learning.ts` (modify) | card kind and issue tag `already_covered`, `humanTruth`, `isRepeatLabel`, `judgeLabelOutcome`, `verdictLabel`, repeat metrics, record, outcome and lesson fields, draft and update schemas |
| `server/discovery/videoContext.ts` (create) | `buildVideoContext`, `renderVideoContext` |
| `server/discovery/prompts.ts` (modify) | judge concept rules, version bump, new drafter prompt |
| `server/discovery/models.ts` (modify) | judge tool schema and validation, `review(..., video)`, lesson tool schema, multimodal `draft()` |
| `server/discovery/store.ts` (modify) | `StoredCandidate.novaProposals` |
| `server/discovery/service.ts` (modify) | publishing loop, card kinds, outcome flag, feedback enrichment, check exclusion, `draftLessons` |
| `server/discovery/contactSheet.ts` (create) | `buildContactSheet` |
| `server/discovery/draftContext.ts` (create) | `selectDraftCases`, `buildDraftContent` |
| `server/discovery/learning.ts` (modify) | rejected-text dedup, `replaces`, `suggestRetirements`, accept replacement, `dismiss_suggestion`, `updateRecord`, migrations marker |
| `server/discovery/migrations.ts` (create) | tag legacy repeat notes once; backfill judge details |
| `src/discovery/*` (modify) | already-covered group, concept chips, kind-aware feedback labels, repeat metrics, replace and retire UI |
| `tests/discovery-concepts.test.ts` (create) | Tasks 1–4 tests |
| `tests/discovery-drafting.test.ts` (create) | Tasks 5–8 tests |

---

### Task 1: Shared judge types and repeat-label semantics

**Files:** Modify `shared/discovery.ts` and `shared/learning.ts`. Test: `tests/discovery-concepts.test.ts`.

**Produces:**
- `JudgedOpportunitySchema` (grounded opportunity + optional `concept` of 1–160 chars + optional nullable `coveredBy`). `ReviewResponseSchema.opportunities` uses it.
- `type JudgedOpportunity`
- `publicOpportunity(o: JudgedOpportunity): GroundedOpportunity`
- `interface CoverageRef { candidateId; eventId: string|null; concept: string|null; subject; startSeconds: number|null }`
- `interface CandidateOpportunity { concept: string|null; subject; observation; connection; objectiveIds: string[]; eventId: string|null; coveredBy: CoverageRef|null }`
- `CandidateSummary.opportunities?: CandidateOpportunity[]`
- `CardKind` adds `"already_covered"`; `issueTags` adds `"already_covered"` ("Already covered by another card").
- `verdictLabel(cardKind, tag)`: already-covered wording is "New concept — should be its own card", "Nothing teachable here", "Right call, wrong details".
- `humanTruth`: the tag gives true; `already_covered` counts as a teachable model call.
- `isRepeatLabel(record)`
- `judgeLabelOutcome(cardKind, feedback)` returns `agreement | false_approval | false_rejection | missed_repeat | wrong_merge | other`.
- `ReportGroup` and `sessionScore` add `repeatsCaught`, `missedRepeats`, `wrongMerges`, `alreadyCovered`.
- `FeedbackRecord` adds `judge?`, `evidenceFrameIds?`, `videoContext?`.
- `ProposerOutcome` adds `alreadyCovered?`.
- `selectReviewerExamples` skips repeat labels.

- [ ] Write failing tests:
  - humanTruth: `approved` + should_reject + tag is true; `already_covered` + correct is true; `already_covered` + should_reject is false.
  - judgeLabelOutcome:
    - `approved` + should_reject + tag → missed_repeat
    - `already_covered` + should_approve → wrong_merge
    - `already_covered` + should_reject → false_approval
    - `not_teachable` + should_approve → false_rejection
    - `approved` + should_reject without the tag → false_approval
  - Examples skip an `already_covered` record and a tagged record.
  - buildReport counts missedRepeats, wrongMerges, repeatsCaught and alreadyCovered (from outcomes), and a missed repeat is not a false approval.
  - sessionScore counts alreadyCovered.
  - ReviewResponseSchema accepts `concept` and `coveredBy`; `publicOpportunity` output passes `GroundedOpportunitySchema`.
- [ ] Run `node --import tsx --test tests/discovery-concepts.test.ts`; expect failures on the missing exports.
- [ ] Implement the changes above.
- [ ] Run the full suite; expect all tests to pass.

### Task 2: Video context builder

**Files:** Create `server/discovery/videoContext.ts`. Modify `server/discovery/store.ts` (`StoredCandidate.novaProposals?: Array<{kind; subject; observation; objectiveIds}>`). Test: `tests/discovery-concepts.test.ts`.

**Produces:**
- `buildVideoContext(session: Pick<StoredSession,"events"|"candidates">, excludeCandidateId?: string): VideoContext`
- `interface VideoContext { covered: CoveredEntry[]; decisions: DecisionEntry[] }`
- `CoveredEntry { ref; coverage: CoverageRef; endSeconds; observation; objectiveIds; human }`
- `DecisionEntry { candidateId; startSeconds; endSeconds; summary; human; labeled }`
- `renderVideoContext(ctx): string | null`

**Rules:**
- **Covered:**
  - Published events, unless their card has human should_reject; with no tag that becomes a decision "approved … human: …".
  - `not_teachable`, `insufficient_evidence` and `nova_empty` cards with human should_approve. Concept is null; show Nova's subject and the human note.
  - `already_covered` cards with human should_approve. Take the concept from the first covered opportunity.
- **Decisions:**
  - `not_teachable` and `insufficient_evidence` cards.
  - Human-rejected approvals without the tag.
  - `already_covered` cards with should_reject or wrong_details.
  - Human-labeled first, then newest; cap at 10; render in time order.
- Covered entries are sorted by start time and get refs C1…
- Text is clipped at 300 chars per field.

- [ ] Write failing tests:
  - A session with 2 events, one event human-rejected without the tag, a human-approved rejected card, 12 rejected cards and one already-covered card with should_approve.
  - Assert covered refs and order, exclusions, a cap of 10 decisions with labeled ones kept, render containing `C1`, concepts, notes, and "does not describe the images below".
  - Empty context renders null.
- [ ] Run and see the failures.
- [ ] Implement.
- [ ] Run the full suite; expect all tests to pass.

### Task 3: Judge prompt, tool schema, and `review()` with video context

**Files:** Modify `server/discovery/prompts.ts` and `server/discovery/models.ts`. Test: `tests/discovery-concepts.test.ts`.

**Produces:**
- `reviewToolConfig(frameIds, coveredRefs = [])`: the opportunity item requires `concept` (string, maxLength 160) and `coveredBy` (enum `["none", ...coveredRefs]`).
- `normalizeReviewInput` maps `"none"` to null and drops a blank concept.
- `models.review(...existing params, video?: { text: string|null; refs: string[] })`:
  - puts the context text first in content;
  - validation throws `coveredBy <ref> is not a covered concept of this video.` for unknown refs, which triggers one repair turn.
- The reviewer prompt adds the concept and coverage rules; JSON shape adds `"concept"` and `"coveredBy"`; versions are bumped.

- [ ] Write failing tests:
  - The review request with video `{text:"THIS VIDEO…C1…", refs:["C1"]}`: content[0] is the text; tool enum is `["none","C1"]`; required includes concept and coveredBy.
  - The first reply cites `C9`, gets a repair message mentioning coveredBy, then a valid reply `coveredBy:"C1"`, `concept:"a push sets a resting object sliding"`. The response keeps the concept, and a second valid reply with `"none"` gives `coveredBy === null`.
- [ ] Run and see the failures.
- [ ] Implement.
- [ ] Run the full suite; the existing judge test still passes.

### Task 4: Service publishes only uncovered concepts

**Files:** Modify `server/discovery/service.ts`. Test: `tests/discovery-concepts.test.ts`.

**Consumes:** Tasks 1–3.

**Behavior:**
- After the proposer, store `novaProposals`.
- Before review, `buildVideoContext(session, candidateId)` and pass `{text, refs}`.
- A non-teachable verdict sets state and cardKind as before, and the outcome is recorded right away.
- A teachable verdict leaves state `reviewing` and cardKind null until publishing finishes. For each judged opportunity:
  - it is covered by its `coveredBy` ref, or by a concept already published from this same response (normalized with `normalizeSubject`);
  - otherwise it is published through `publishOpportunity(... publicOpportunity(o) ...)`, which now returns `{eventId, startSeconds, mergedInto}` and no longer sets the candidate's state on merge;
  - a server merge sets `coveredBy` from the merged event.
- Store `candidate.opportunities`, then set the card:
  - something published: `approved` / `approved`;
  - nothing published but something covered: `suppressed_duplicate` / `already_covered`, with `suppressionReason = already_covered_by_<candidateId>`;
  - state `insufficient_evidence` after a capture gap: cardKind `insufficient_evidence`.
- `recordOutcome(..., alreadyCovered)`.
- The reviewer stage file stores `videoContext: {text, covered}`.
- `candidateDetail` returns `opportunities`.
- `checkCases` excludes `isRepeatLabel`.

- [ ] Write failing tests with a phone session, stubbed `media.publishPhoneClip`, stubbed propose and review, and frames written to the session:
  - The first window approves "hand pushes a can" with concept X and `coveredBy:null`, and publishes 1 event.
  - The second window, "hand pushes a table" with `coveredBy:"C1"`, publishes no new event. Its card is `already_covered` with `coveredBy.eventId` equal to the first event, and the video text passed to review contains `C1` and concept X.
  - A third window has two opportunities (covered C1 plus new concept Y) and publishes 1 event with cardKind `approved`.
  - Outcomes record `alreadyCovered` true for window 2.
- [ ] Run and see the failures.
- [ ] Implement.
- [ ] Run the full suite; expect all tests to pass.

### Task 5: Lesson store: rejected-text dedup, replacements, retire suggestions

**Files:** Modify `shared/learning.ts`, `server/discovery/learning.ts` and `server/discovery/router.ts` (schema only). Test: `tests/discovery-drafting.test.ts`.

**Produces:**
- `Lesson.replaces?: string[]`
- `Lesson.retireSuggestion?: { reason; supportingIds: string[]; at } | null`
- `DraftedLesson.replacesLessonIds?: string[]`
- `LessonUpdateSchema.action` adds `"dismiss_suggestion"`.
- `LessonDraftResponseSchema`:
  - `lessons[].replacesLessonIds` (default `[]`);
  - `retire: [{lessonId, reason (8–280 chars), supportingIds}]` (at most 6, default `[]`).
- `LearningStore.addDraftedLessons(drafts, cases)`:
  - dedups against all lessons, rejected ones included;
  - keeps only same-model, non-rejected, existing `replaces` targets.
- `LearningStore.suggestRetirements(items, cases): Promise<Lesson[]>` targets active, pending and needs_evidence lessons, and keeps only known case IDs.
- `updateLesson`:
  - accept with `replaces` disables the replaced lessons and clears their suggestions; the cap subtracts the active lessons being replaced;
  - disable and reject clear the suggestion;
  - `dismiss_suggestion` clears it.
- `LearningStore.updateRecord(candidateId, fn)` persists a changed feedback record, for use by migrations.

- [ ] Failing tests:
  - A re-draft identical to a rejected lesson is dropped.
  - Replaces filters a wrong-model ID.
  - Accepting at the 15-active cap succeeds when it replaces an active lesson, and the replaced lesson becomes disabled.
  - A retire suggestion is stored, then dismiss clears it.
  - Disabling clears a suggestion.
- [ ] Implement.
- [ ] Run the full suite; expect all tests to pass.

### Task 6: Feedback enrichment and migrations

**Files:**
- Create `server/discovery/migrations.ts`.
- Modify `server/discovery/service.ts` (`saveFeedback`, `create`).
- Test: `tests/discovery-drafting.test.ts`.

**Produces:**
- `service.saveFeedback` writes `judge {analysis (≤2,000 chars, from the reviewer stage rawText), opportunities}`, `evidenceFrameIds` and `videoContext` (≤4,000 chars).
- `migrateLearning(learning: LearningStore, sessionDir: (id) => string): Promise<{ taggedRepeats: number; backfilled: number }>`:
  - Migration `2026-09-16-tag-repeat-notes`, run once and recorded in `learning/migrations.json`: approved + should_reject + a note matching `/\balready\b|\bduplicate\b|\bhave this\b/i` + no tag → add the `already_covered` tag.
  - Backfill, idempotent: for records without `judge`, read `<session>/candidates/<id>-reviewer.json` and `-proposer.json` when present.
- `DiscoveryService.create` runs it after both stores initialize.

- [ ] Failing tests:
  - The migration tags only the matching record, a second run tags 0, and a manually removed tag stays removed.
  - The backfill fills `judge.analysis` and `evidenceFrameIds` from stage files.
- [ ] Implement.
- [ ] Run the full suite; expect all tests to pass.

### Task 7: Contact sheet

**Files:** Create `server/discovery/contactSheet.ts`. Test: `tests/discovery-drafting.test.ts`.

**Produces:** `buildContactSheet(frames: Array<{file; sourceTimeMs: number|null; evidence: boolean}>): Promise<{ bytes: Buffer; width; height; columns; rows }>`.
- Choose the column count that maximizes tile size within 1,150,000 px and 1,568 px on the long edge.
- Each tile gets a 22 px label strip "n · t s".
- Evidence tiles get a 4 px amber outline. Background #111. JPEG quality 80.

- [ ] Failing tests:
  - 12 portrait frames (72×128) give a sheet within the limits in a 4×3 grid.
  - 12 landscape frames fit within the limits.
  - 1 frame works.
  - A still frame (null time) is labeled "still".
- [ ] Implement.
- [ ] Run the full suite; expect all tests to pass.

### Task 8: Drafter context, prompt, tool, and service

**Files:**
- Create `server/discovery/draftContext.ts`.
- Modify `server/discovery/prompts.ts`, `server/discovery/models.ts` and `server/discovery/service.ts`.
- Update `tests/discovery-learning.test.ts` (new `draft()` signature).
- Test: `tests/discovery-drafting.test.ts`.

**Produces:**
- `selectDraftCases(records, outcomes)` returns `{ human: FeedbackRecord[] (≤80, non-holdout), imaged: FeedbackRecord[] (≤20, framesKept>0; order: note, then not correct, then correct; newest first), judgeOnly: ProposerOutcome[] (≤60) }`.
- `buildDraftContent({ lessons, report, human, imaged, sheets: Map<id, Buffer>, judgeOnly, videoName })` returns Converse content blocks:
  - a reference text (course, base prompts, lessons with every field, metrics);
  - for each imaged case, a text block followed by an `{image:{format:"jpeg",source:{bytes}}}` block;
  - the remaining human cases as a JSON text block;
  - the judge-only outcomes as a JSON text block.
- `lessonToolConfig(replaceableIds, retirableIds)`
- `normalizeLessonInput`
- `models.draft({ system, content, replaceableIds, retirableIds, signal? })` with maxTokens 10,000 and timeout 240,000 ms.
- `lessonDrafterSystemPrompt` rewritten.
- `service.draftLessons()` builds sheets from the durable feedback frames and returns `{ added, suggestions, usage }`.

- [ ] Failing tests:
  - `selectDraftCases` priority, caps and holdout exclusion.
  - `buildDraftContent` includes rejected lessons, both base prompts, at most 20 images, and case notes.
  - The service draft with a fake transport: the request has image blocks, the tool enum has lesson IDs, the returned `retire` item sets a `retireSuggestion`, and `replacesLessonIds` is stored.
- [ ] Implement.
- [ ] Run the full suite; expect all tests to pass.

### Task 9: UI

**Files:** Modify `src/discovery/api.ts`, `DiscoveryWorkspace.tsx`, `ReviewCard.tsx`, `FeedbackControls.tsx`, `DiscoveryEventCard.tsx`, `LearningPanel.tsx` and `discovery.css`.

**Behavior:**
- Already-covered cards collapse into `<details className="covered-cards">` after the main cards.
- The ReviewCard title is "Already covered", with a "Same concept as" block.
- The event card shows a concept chip.
- FeedbackControls uses `verdictLabel` and offers the `already_covered` tag only on approved cards.
- The scoreboard adds "N already covered · N missed repeats · N wrong merges".
- LearningPanel:
  - repeats metric tile;
  - "Replaces …" note, and an Accept label that says how many it turns off;
  - retire suggestion with Turn off (disable, or reject if pending) and Keep (`dismiss_suggestion`);
  - draft button "(~$0.30–0.50)";
  - notice includes suggestions.

- [ ] Implement.
- [ ] Run `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/vite build`; expect both to pass.

### Task 10: Verify and deploy

- [ ] Full tests, typecheck, build, and `node --import tsx docs/detection/v2/check-contract.ts`.
- [ ] Check that no Discovery session is ingesting, restart the server with the same command and environment, and confirm `/api/discovery/learning` responds and the migration tagged 8 labels.
- [ ] Request code review (superpowers:requesting-code-review), fix findings, and re-verify.
