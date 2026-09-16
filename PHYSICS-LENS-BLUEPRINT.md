# Lens — product and application blueprint

**Working name:** Lens. **Promise:** Turn everyday encounters into physics you can test.

**Status:** A finalized product recommendation and build specification, not an implemented application. Targets and schedules below are planning assumptions, not benchmark results. Prepared from the supplied discussion and primary-source research on September 16, 2026 UTC. Naming availability has not been checked.

## 1. The decision

Build a course-aware physics companion that notices useful moments throughout an enabled day, then helps the student build, test, and explain a model of what happened. Its central experience is **your explanation compared with evidence**.

The complete loop is: encounter → prediction → model → test → explanation → transfer to a different problem.

The camera is one source of evidence. A phone sensor, an instructor's dataset, a course problem, and a verified simulation can enter the same learning workspace. This is essential for heat, electricity, fields, waves, and modern physics, where an ordinary camera cannot observe many of the quantities being studied.

Preserve automatic discovery: students do not have to hunt for clips or choose random recording windows. Preserve the normal tutor: they can always ask about lectures or problems. Replace the assumption that every encounter should become a numerical quiz with a system that chooses the strongest scientifically justified learning activity.

**North-star outcome:** a student can independently apply a principle in an unfamiliar situation several days later.

**First audience:** university students in introductory mechanics and electricity/magnetism, particularly those who can substitute into equations but struggle to identify which physical model applies. Extend through reviewed topic packs; do not claim complete coverage of every physics course at launch.

## 2. Why the previous design needs a structural change

| Weak assumption | Consequence | Product decision |
|---|---|---|
| An object identifies a physics concept | A runner becomes “acceleration,” a mug becomes “temperature measured” | Separate visible evidence, possible interpretation, and claims actually supported |
| Everything interesting moves | Static equilibrium, electrical circuits, thermal processes, optics, and quantum topics get neglected | Support scene context, temporal change, sensor signals, and course-triggered investigations |
| Putting “estimated” before a number makes it trustworthy | Arbitrary lamp-post distances become false precision | Require a measurement method, source, assumptions, and uncertainty; otherwise leave the quantity unknown |
| A diagram generator plus a formula checker guarantees correct physics | A correctly calculated answer can still use the wrong physical model | Validate model applicability and problem solvability before checking arithmetic |
| More detector labels means broader physics coverage | Each new object needs another special case, while conceptual coverage stays shallow | Expand reusable representations and validated models, not an object catalogue |
| Saving tokens solves always-on feasibility | Camera capture, encoding, radio, tracking, battery, heat, and OS restrictions remain | Treat sustained sensing as an independently benchmarked device capability |
| Many spontaneous quizzes imply learning | Students may become interrupted, dependent, or bored | Optimize for useful investigations and delayed transfer, not popup counts |

Two specific corrections to the earlier examples: distance and elapsed time determine average speed only when path length is known; they do not by themselves determine acceleration. A language model's self-reported confidence is also not a calibrated error bound on speed, distance, or temperature.

## 3. What makes Lens worth building

### A. Test the student's explanation

A student sketches a velocity graph, chooses forces, predicts a cooling trend, or rearranges a circuit. Lens computes what that model predicts and compares it with admissible evidence. The tutor asks about the specific mismatch.

For example, a trolley is moving right and slowing down. A student places a net-force arrow to the right because “force follows motion.” Under the stated one-dimensional inertial-frame model, that predicts increasing rightward velocity. Lens shows the prediction beside the observed decreasing velocity. The student revises the net-force direction. If the evidence cannot establish ground-relative deceleration, this activity uses a clearly marked instructional dataset instead.

This is deeper than watching a visualization: the student's reasoning changes the prediction.

### B. Revisit the same moment through a new concept

A door encountered during a mechanics unit can support torque, work, and angular motion at different times. A swing can return for energy after being studied as periodic motion. Stored evidence is rematched to later course objectives; it is not repeatedly uploaded or reanalyzed unnecessarily.

Every revisit must pose a new intellectual task. A new topic does not authorize inventing a previously unmeasured force or mass.

### C. Ask what would distinguish two explanations

When evidence is incomplete, offer a small, purposeful test. For a cooling question, compare two temperature measurements. For a pendulum, compare periods while changing one variable. Sometimes the best answer is that the available observation cannot distinguish the hypotheses.

Do not make “we need more information” the repeated punch line. If an accessible measurement would not help, move to a labeled model or a course example. The student should leave with understanding, not another permission request.

### D. Preserve a personal record of changed thinking

A saved moment records: “I predicted this; the evidence supported this; I changed this part of my model; here is where the model stops applying.” The valuable asset is learning evidence, not accumulated surveillance footage.

## 4. The signature session

**Example: the door you used after class.** This is an illustrative product scenario, not a claim about an existing detector.

1. Canvas identifies torque as a current objective; the student has confirmed that context.
2. During enabled discovery, the observer recognizes a door interaction and retains the event locally. It cannot measure contact force from ordinary video.
3. Later, at a permitted interruption time: “That door connects to today's torque lesson. Would pushing closer to its hinge make the same turning effect easier or harder?”
4. On opening, the student sees a short replay with the hinge and approximate contact point highlighted. Uncertain geometry is editable. No force magnitude is fabricated.
5. The student predicts and explains. Lens converts the scene into a clean top-down door diagram, visibly labeled **simplified model**.
6. The student places a force arrow and changes its application point. The perpendicular moment arm changes with it. The tutor links the change to torque, τ = rF sin θ.
7. In a separate **practice variation**, Lens supplies r = 0.80 m and a perpendicular force F = 10 N. These are hypothetical teaching values, not recovered measurements. The reference torque is 8.0 N·m.
8. The student predicts the force needed at r = 0.20 m for the same torque, with all other modeled conditions unchanged. The reference is 40 N. The tutor reveals only the help needed for the next step.
9. A transfer challenge uses a wrench. The system checks whether the student identifies the perpendicular moment arm rather than memorizing the door answer.
10. The notebook saves the original claim, model, help used, and transfer result. A later course unit can revisit the door for work done through an angle.

The impressive transition is **a real encounter becoming a model the student can challenge**. This does not require a photorealistic recreation of the room.

## 5. How it spans physics

These rows define an expansion roadmap. A row is not production support until its detector, models, representations, questions, and evaluations are validated.

| Area | Useful real-world entry | Evidence required for numerical claims | Best learning representation | Honest fallback |
|---|---|---|---|---|
| Kinematics | Person walking, cart rolling | Reliable time; spatial calibration and geometry for metric motion | Trajectory, position/velocity graphs | Qualitative comparison or pixel-space analysis with explicit limits |
| Forces and equilibrium | Book at rest, trolley slowing | Interaction assumptions; mass and acceleration for net force | Free-body diagram and force balance | Ask which interactions exist; do not infer individual forces from appearance |
| Work, energy, momentum | Swing, lift, collision | System boundary; relevant masses, velocities, heights; losses if needed | Energy accounting, momentum vectors | Predict transfers qualitatively or use supplied values |
| Rotation | Door, wheel, wrench | Axis, moment arm, force direction and magnitude | Torque diagram, angular graphs | Hypothetical force/geometry practice model |
| Oscillation | Pendulum, vibrating object | Enough samples and cycles; scale if amplitude is needed | Time trace, phase comparison | Period estimation if time is reliable; model only for unsupported quantities |
| Waves and sound | Tuning fork, speaker, ripples | Appropriate temporal sampling; microphone or calibrated spatial data | Waveform, spectrum, wavefronts | Synthetic tone or instructor dataset; no casual loudness-to-dB claim |
| Thermal physics | Mug, radiator, insulation | Temperature probe/time series; material and environmental assumptions | Temperature-time graph, energy-flow diagram | Contextual prediction; a camera image does not measure internal temperature |
| Fluids | Water jet, floating object, bottle | Pressure/height/volume data and applicable flow assumptions | Pressure plot, streamlines, buoyancy diagram | Explain competing effects; do not apply Bernoulli indiscriminately |
| Circuits | Safe teaching circuit, visible lamp | Verified topology and component values; voltage/current measurements | Circuit schematic, potential/current views | Component supplied by a course diagram; do not infer hidden wiring |
| Electric and magnetic fields | Magnet and compass; instrumented coil | Calibrated sensor locations/orientations or known sources | Field vectors, equipotentials, flux | Idealized field model explicitly separated from a camera view |
| Optics | Mirror, lens, refraction | Geometry, optical elements and refractive indices when calculating | Ray diagram, wave model where appropriate | Qualitative ray prediction with declared approximations |
| Modern physics | LED, spectra, solar device as a context | Spectral or experimental data; a relevant validated model | Energy levels, probability, spectra | Curated experiment/simulation; an LED photo is not a direct observation of a quantum state |
| Advanced courses | Lab results, mathematical questions | Domain-specific datasets and boundary conditions | Phase space, field plots, symbolic derivations | Direct course tutoring and reviewed domain tools; no universal scene-to-solver promise |

The reusable core consists of a small collection of representation families: geometry/vectors, graphs, interaction diagrams, energy accounting, circuits, fields/rays, and probability/state views. New domains may still require new solvers and expert authoring. Modularity reduces repeated engineering; it does not eliminate scientific work.

## 6. The application, screen by screen

### First use

Enter as a guest with a sample course, import selected files, or connect Canvas. Choose the course and confirm an editable summary: topics, recent material, notation, mathematical level, and upcoming objectives. A stale module date is not proof of current understanding.

Run one short diagnostic. Ask the learner's preferred support level and interruption preference. Discovery setup comes after the first useful learning experience. Show actual available inputs: camera, motion sensors, microphone, external instrument. Missing hardware is a capability state, not an error.

### Today

One current objective, one recommended investigation, and the next review. A compact status line shows **Observing**, **Sensors only**, **Paused**, **Offline**, or **Camera unavailable**. The exact capabilities behind the status are inspectable.

Use four main navigation destinations: **Today, Moments, Tutor, Review**. Settings holds course sources, sensing controls, notification limits, storage, and deletion. Avoid a dashboard of arbitrary mastery percentages.

### Ambient invitation

A brief line connects the event to the course and offers one question. Actions: **Try now**, **Save for later**, **Skip**, and **Fewer like this**. No modal blocking the user's current activity. Default proposal: at most two unsolicited invitations a day, subject to a student-selected limit; collection can continue independently. No invitation is generated simply to fill a quota.

Delay invitations while activity is demanding or uncertain. Suppression is conservative and imperfect; it must not imply the app can certify that a user is safe to look at a screen. Never demand a response to maintain a streak.

### Investigation workspace

Desktop: evidence and model occupy the main workspace; a short tutor prompt sits alongside. Mobile: one representation at a time with an obvious switch. Preserve context when switching; do not force the learner to manage several tiny graphs.

The session progresses through **Predict, Build, Test, Explain**. Keep one required action in view. The student can revisit a prior step, correct the evidence, or request help. Controls expose only variables relevant to the current objective.

Three persistent source labels distinguish **Recorded evidence**, **Simplified model**, and **Practice variation**. Measured values link to their origin. A model toggle never quietly changes the claimed real event.

Supporting tools: timeline scrubber, graph sketching with keyboard alternative, vector/force selection, quantity table, optional equation editor, and labeled model controls. Not every problem needs every tool. The default is one diagram plus one question.

### Tutor

Accept typed questions, optional speech, and course/problem images. Show the relevant source excerpt and its location when using course material. Ask for an interpretation or prediction before solving when appropriate. Teach definitions directly when that is what the learner needs.

The tutor can open an investigation, a worked parallel example, or an ordinary mathematical walkthrough. A hardware-free learner receives a complete tutor and review experience.

### Moments

A chronological list with concept filters and readable titles such as “Why pushing near the hinge felt harder.” Each moment opens its evidence, model assumptions, learning history, and available revisits. Display gaps honestly: “Observation paused from 1:10–2:05.” The recap describes detected moments, not everything that happened during the day.

The evening recap proposes up to three useful follow-ups and lets the student dismiss the rest. Reuse a still/trace where it supports the lesson; raw video is optional.

### Review

Prioritize concepts with demonstrated difficulty and upcoming relevance. Use prediction, graph construction, explanation, error diagnosis, and a fresh setting. Multiple-choice is useful for fast diagnosis but insufficient as the sole evidence of mastery.

Show meaningful states: **New**, **Practicing with help**, **Independent here**, **Transferred to a new setting**, **Review due**. These states are supported by visible attempts. They are not psychological diagnoses or precise estimates of intelligence.

### Accessibility

All interactions need keyboard and text alternatives. Diagrams have structured descriptions; recordings have captions where audio matters. Meaning cannot depend on color. Respect reduced motion, allow playback control, and never require a camera, fine dragging, voice, or hearing to complete the learning objective.

## 7. Tutoring and assessment rules

Maintain a structured session state: objective, active model, student claim, attempt, available evidence, hint level, and next permissible teaching action. The model receives this compact state rather than repeatedly reading the day's entire footage or conversation.

The help sequence is: focused prompt → highlight relevant evidence → supply a principle → work a parallel example → demonstrate one step → guided completion. The learner can request a full explanation. “Never give the answer” must not become an endless interrogation; do not reveal the solution by default, but do support recovery.

Classify difficulties provisionally: concept, representation, model choice, algebra, units, signs, assumptions, or insufficient evidence. One incorrect sentence is a hypothesis about a difficulty, not a permanent misconception label. Allow the student to correct the interpretation.

Objective numerical and diagram constraints use deterministic checks. Open explanations use a short explicit rubric: claim, governing principle, application/conditions, connection to evidence. If interpretation is uncertain, ask one targeted follow-up. Fluent prose is not evidence of physical understanding.

Distinguish correct unaided work from correct work after a reveal. Repeat a concept later with a different surface setting and a different representation. Initial review defaults can be next day, several days later, and around one week, adjusted to performance; these are tunable product choices, not a universally optimal schedule.

Research supports structured exploration and retrieval as design ingredients, but does not establish that this proposed ambient product improves learning. Test that claim directly. See [PhET scaffolding research](https://arxiv.org/abs/1306.6544) and [Karpicke and Blunt's retrieval study](https://learninglab.psych.purdue.edu/downloads/2011/2011_Karpicke_Blunt_Science.pdf).

## 8. Scientific correctness is a product feature

Each quantity carries a value or **unknown**, unit, coordinate frame, time interval, source, method, applicability conditions, uncertainty if justified, and software/model version. Its source category is one of: **measured**, **derived from measurements**, **user supplied**, **course supplied**, or **hypothetical**. “Estimated” additionally describes the method and uncertainty; it is not a substitute for a source.

Claims have different authority. “An image region was tracked” is direct image evidence. “A cart accelerated relative to the ground” needs temporal/geometry support. “Friction caused that acceleration” is a physical interpretation requiring assumptions and potentially other evidence.

Question generation follows this order:

1. Establish the learning objective and admissible evidence.
2. Select a reviewed model and check whether its assumptions apply.
3. Check what is identifiable from the known quantities. Underdetermined questions are allowed only when identifying the missing information is the objective.
4. Solve or derive the reference answer with a versioned model.
5. Generate wording and distractors that preserve those exact constraints.
6. Validate wording, units, graph labels, signs, and equivalence to the reference problem. Reject disagreement.

Important boundaries:

- Image-space displacement is not automatically world-space displacement. A reference should match the motion plane and geometry. Camera translation and changing depth can corrupt a simple scale. [Tracker's calibration documentation](https://opensourcephysics.github.io/tracker-website/help/stick.html) is a useful baseline.
- Velocity differentiation and especially acceleration amplify tracking noise. Fit appropriate time series, inspect residuals, and propagate uncertainties instead of differentiating two unreliable points.
- IMU readings require device/frame calibration and gravity treatment. A phone resting on a desk is not in inertial free fall merely because of a misunderstood sensor value.
- A free-body diagram requires a defined object/system and interactions. Do not add “motion force,” duplicate third-law pairs on one body, or label net force as a separate interaction force.
- Energy and momentum checks need explicit system boundaries. Friction can reduce mechanical energy without violating total energy conservation.
- A low image sampling rate cannot resolve arbitrarily rapid oscillations. State the detector's observable frequency/time range and reject aliased estimates.
- A symbolic solver does not decide whether Ohm's law, a lumped thermal model, geometric optics, or Newtonian mechanics applies. Domain adapters must enforce that choice.
- Quantum representations need their own semantics. A classical particle animation is not an accurate generic picture of a wavefunction.

A claim of “82% confidence” is prohibited unless it refers to a defined, evaluated probability with calibration evidence. The learner should normally see concise reasons such as “Time is available; distance scale is missing.”

## 9. Always-on discovery, specified honestly

The intended experience remains enabled throughout the day without manually choosing interesting clips. However, **continuous availability, continuous camera capture, and exhaustive understanding of the day are three different promises**.

A native observer or supported wearable companion is required for production capture. The web app owns tutoring and review. Android documents camera foreground services with permission and startup restrictions; Apple documents background camera interruptions. Support must be qualified per device, OS, API, and operating condition. An ordinary mobile browser is not the basis for an unconditional all-day capture claim. [Android camera service rules](https://developer.android.com/develop/background-work/services/fgs/service-types), [Apple background interruption documentation](https://developer.apple.com/documentation/avfoundation/avcapturesession/interruptionreason/videodevicenotavailableinbackground).

The observer has these states:

| State | Local work | Cloud work | Exit condition |
|---|---|---|---|
| Paused/unavailable | None for disabled inputs | None | Student resumes or capability returns |
| Baseline observation | Supported capture buffer, sparse scene features, sensor features | None | Relevant change/context candidate |
| Candidate accumulation | Track a candidate across time; retain context and quality metadata | None initially | Reject, sufficient evidence, timeout, or budget |
| Event analysis | Assemble minimum necessary frames/trace; redact where feasible | One bounded analysis job if justified | Valid question or rejection |
| Saved/deferred | Store permitted evidence and summary | Optional later tutoring | Student engages or expiry |
| Degraded | Reduced capability with visible gaps | Bounded retry/queue | Resources recover or content expires |

Two kinds of evidence window are needed. Fast events use a short circular video buffer. Slow changes use sparse observations or time-series summaries spanning minutes. Static scenes can be contextual candidates even without motion. Context alone authorizes a question or model invitation, not a hidden physical measurement.

Separate capture rate from inference rate. Sparse inference over a sufficiently sampled buffer can allow later analysis of earlier frames. Raising capture quality only after detecting an event cannot reconstruct missed high-frequency motion before the trigger. If the hardware cannot sustain the required buffer, disclose that lost capability and use another task.

Use generic scene/object features plus shared signal features, then course-specific relevance. Merely changing a prompt's list of desired objects does not make a general detector cheaper to run. Savings require actual changes to model execution, resolution, sampling, or escalation frequency.

Apply hard gates first: input permission, usable evidence, allowed teaching pack, resource allowance, and notification policy. Rank surviving candidates by relevance, learning need, novelty, and evidence usefulness. Do not multiply invented confidence percentages into a supposed probability of educational value.

Merge repeated observations of the same event and apply per-concept cooldowns. A long commute must not generate fifty near-identical velocity questions. Unsupported topics can still enter through course materials and trusted datasets. Discovery coverage is opportunistic; curriculum coverage comes from the tutor plus topic packs.

## 10. Architecture and data contracts

Use one orchestrated application with explicit stages before adding autonomous agents or numerous microservices.

**Course service:** read-only imports, document extraction, page/section provenance, content hashes, course concept mapping, and an editable active objective set. Restrict retrieval to the selected student's authorized course. Treat document content as untrusted data, never operational instructions.

**Observer:** device capability discovery, sensing/capture, ring buffer, generic features, candidate state, resource governor, and local pause/delete. Keep precise location out unless a learning activity needs it.

**Evidence service:** accept a typed event, validate timestamps and input schemas, run permitted tracking/sensor analysis, and record claims with provenance. Image analysis may propose labels and hypotheses; it cannot write authoritative metric values without a measurement method.

**Activity planner:** combine a concept objective, learner evidence, event evidence, and an approved topic pack. Choose qualitative task, quantitative task, measurement task, model comparison, or direct instruction. Return unsupported when necessary.

**Domain adapters:** deterministic calculations and validated models for a bounded problem family. Examples: planar torque, one-dimensional motion, linear resistive circuits, single-node cooling. Each has applicability checks, parameter limits, reference cases, and representation outputs. No execution of arbitrary model-generated code in the client.

**Renderer:** declarative graph, vector, diagram, and timeline primitives. The same model state drives numerical values and diagrams. Keep answer/rubric data server-side until an allowed reveal; visible client simulations are learning tools, not secure exam assessment.

**Tutor controller:** session state machine plus language-model phrasing/explanation. Persist attempted steps and help levels. Validate tool actions before executing them.

**Learning store:** concepts, attempts, tentative misconceptions, review tasks, and selected moments. Prioritize evidence over a single opaque mastery score.

Core records:

| Record | Minimum fields |
|---|---|
| Course context | owner/course IDs, source version, objective IDs, notation, prerequisites, citations, confirmation status |
| Event | owner/device IDs, start/end and monotonic clock mapping, input capabilities, evidence references, capture gaps, expiry |
| Quantity/claim | source, method, value/unit or unknown, frame, interval, uncertainty, assumptions, quality checks |
| Model | adapter ID/version, entities/system boundary, variables, assumptions, allowed changes, validation result |
| Activity | objective, question type, evidence/model IDs, public prompt, hidden reference/rubric, permitted hints |
| Attempt | response, representation edits, timestamp, help used, validation and learner correction |
| Learning evidence | skill, context, outcome, independence, transfer setting, next review; links back to attempts |

Stable interfaces include: ingest course materials; accept/deduplicate event candidates; fetch permitted evidence; create validated activity; submit step; request hint; update learner correction; list review tasks; and delete a moment with its derived assets. Idempotency keys prevent retrying an upload or analysis from creating duplicate moments and bills.

A topic pack contains objectives/prerequisites, candidate contexts, required evidence, supported models, representation bindings, question families, misconception hypotheses, hint sequences, transfer tasks, source references, and regression fixtures. An expert reviews the pack before release. Keep a support registry that distinguishes experimental from validated capabilities.

If AWS is required by the hackathon, a reasonable mapping is object storage for selected media/course files, a database for records, a job queue plus workers for analysis, Bedrock for bounded multimodal/tutor requests, and a web frontend. Use short functions for short tasks and appropriate workers for longer video processing. Choose available models after checking account/region access. Avoid making the demo depend on one named video-generation model or a multi-agent orchestration product.

## 11. Performance, cost, and operational scale

Maintain three independent budgets: **device energy/thermal load**, **network and cloud analysis**, and **student attention**. Saving LLM tokens does not bound the other two.

Illustrative sizing only: a 30-second encoded buffer at 1 Mbit/s holds about 3.75 MB of encoded data, excluding overhead and decoder/tracker memory. Eight hours at that bitrate would amount to about 3.6 GB if retained or transmitted. A circular buffer bounds retention; it does not remove capture and encoding energy.

For 12 escalated events/day with five frames each, there are 60 image inputs/day. If the chosen configuration bills an average of I tokens per frame, image input is 60I tokens, plus text, output, tool calls, and tutoring. Temporal analysis may require more frames or video and must be budgeted separately. Do not reuse another model's image/video token formula. [Bedrock pricing](https://aws.amazon.com/bedrock/pricing/) varies by model and usage category.

Cloud cost per active learner/day = event count × measured analysis cost + tutoring turns × measured turn cost + allocated storage/network/database costs. Also record rejected-candidate cost, retries, and tail latency. Average cost without the rejection funnel is misleading.

Hard-limit expensive event analyses separately from popups. Cache course summaries by source version; send only relevant excerpts. Reuse validated activity plans and deterministic renderers. Use compact structured session state, short outputs, duplicate detection, job timeouts, and a daily resource ceiling. Defer or discard low-value candidates when the budget is reached.

At an illustrative 10,000 active learners × 12 events/day, the system processes 120,000 event jobs/day, about 1.4/second averaged over 24 hours. This is not a capacity estimate: class schedules create bursts, jobs differ in size, and provider token quotas may dominate. Load-test the actual distribution. Use bounded queues, per-user/tenant limits, retry backoff, and visible delayed states. Keep the observer useful offline and never accumulate an unbounded media backlog.

Device acceptance requires tests on named hardware: sustained duration, thermal behavior, battery delta versus baseline, missed events, and capture continuity under lock/background/network loss. Publish those results before using “all day” as a supported claim. If full visual capture fails, retain the product with sensor/context discovery and an explicit camera limitation; this is a conscious scope change, not a hidden implementation substitution.

## 12. Privacy, ownership, and failure behavior

The student controls sensing. Make recording state visible and pause immediate. Default microphone off except a chosen sound activity; no persistent conversation recording. No face identification. Process/redact locally where feasible, while acknowledging redaction is fallible. Saving an event does not require retaining a bystander's identity.

Proposed retention policy: unsaved circular-buffer content overwritten continuously; rejected candidates deleted promptly; temporary cloud evidence expires within 24 hours; raw video is excluded from saved moments unless the learner chooses to retain it. Keep the minimal still/trace necessary for replay only with a clear retention setting. Deletion includes derivatives, embeddings, thumbnails, caches, and configured backup expiry. Logs must avoid raw course text, footage, and tutor responses by default.

Use per-user authorization, encrypted transport/storage, short-lived media access, secure server-side course tokens, and auditable revocation. Teachers see only student-shared work or appropriately aggregated learning results. They do not receive a timeline of students' movements. Aggregate views need minimum group sizes to reduce re-identification.

| Failure | Required behavior |
|---|---|
| Wrong object/event label | Student can correct/dismiss; invalidate dependent claims and questions |
| Missing scale or bad tracking | Fall back to a useful qualitative task or declared model; never fabricate units |
| Sensor absent or permission revoked | Update capability status; offer course/dataset route |
| No relevant moments today | Offer course-based practice without inventing a daily observation |
| Course import uncertain/stale | Show source and editable objective; stop claiming it is current |
| Model unsupported or solver fails | Explain the specific limit, preserve work, and offer a reviewed alternative |
| AI answer contradicts reference | Withhold it, retry once within budget, then use validated fallback text |
| Network unavailable | Local capture within budget; deferred analysis with expiry; existing review works |
| User changes/deletes evidence | Version or invalidate derived calculations, models, and activities |
| Student frustrated | Reduce task complexity, offer example/explanation, or let them leave without penalty |

## 13. Differentiation and adoption

Simulations, video analysis, and phone experiments already exist. [PhET](https://phet.colorado.edu/en/simulations/filter?view=list), [Tracker](https://opensourcephysics.github.io/tracker-website/), and [phyphox](https://phyphox.org/docs/) establish that useful baseline. Their documented capabilities are not evidence that Lens would be first or unique.

The differentiation to validate is the complete connection: the student's current course + automatically encountered evidence + the student's own model + targeted teaching + later transfer. Individual components are reproducible; high-quality topic packs, evidence validation, and a demonstrated learning outcome matter more than the camera novelty.

Start with one introductory course and willing instructors who can review objectives and misconceptions. Provide a useful no-hardware experience from day one. Shared instructor datasets and optional lab sensors reduce dependence on wearable ownership. A later course-license or bounded student subscription is plausible, but willingness to pay is untested. Do not sell “unlimited all-day AI video” before measuring unit economics. Do not fund the product through student footage or attention advertising.

Canvas should accelerate personalization, not block first use. Canvas Cloud API OAuth requires institution-issued developer keys; course-file import is the initial fallback. A pasting interface should never ask students to embed access tokens into chat. [Canvas OAuth documentation](https://developerdocs.instructure.com/services/canvas/oauth2/file.oauth).

## 14. The build sequence

The original discussion mentions a hackathon; its exact duration, team, and rules have not been supplied. The following **48–72-hour demonstration plan assumes a small experienced team with working model access**. It is a scope proposal, not a delivery guarantee.

### Demonstration release

Implement one complete mechanical investigation and a second, smaller thermal investigation to prove the architecture is not motion-only. Prefer a slow pendulum or trolley for the mechanical recording so detection requirements are tractable. Use the door scenario as a future experience if hinge/force annotation would consume the whole build.

Inputs: one imported course excerpt; an untrimmed 10–15-minute consented recording with irrelevant intervals and eligible scenes; a separately identified temperature trace for the thermal case. Mark sample course data and recorded sensor fixtures clearly. Neither timestamp labels nor demo playback controls may trigger the event detector.

Deliver: actual candidate detection on the full recording; event window with before/after context; one validated model per domain; a student prediction/build/test action; adaptive hint levels; one saved learning record; and one transfer review. The temperature data is supplied evidence, not “measured from a mug video.” Replayed footage is labeled replay.

Suggested sequence: establish record/contracts and fixtures; implement the validated model and workspace; integrate detection and evidence; attach tutor/course retrieval; then test rejection/fallback paths and rehearse. Cut visual decoration before cutting the evidence check or the transfer step.

Do not add live glasses integration, full OAuth deployment, photorealistic generation, social feeds, rewards, or a broad teacher dashboard to this release. Do not spend the full effort on three skins of the same velocity problem and call that domain scalability.

### Pilot release

Ship a native observer on one explicitly supported device family, a small reviewed mechanics pack and one non-mechanical pack, selected course integration, full deletion flows, and instrumented learning evaluation. Test sustained observation before expanding device support.

### Expansion release

Add topic packs and representations, external sensor adapters, instructor authoring/review, and additional compatible observer devices. Require the same scientific and learning validation for each pack. Some domains will stay course/dataset-first.

## 15. How to know whether it works

Product metrics: invitations accepted or deferred, “fewer like this” rate, completed reasoning steps, return to review, and weekly useful investigations. These diagnose experience; they do not prove learning.

Scientific evaluation: expert-annotated held-out recordings and datasets, with stable camera, moving camera, occlusion, misleading apparent motion, static scenes, repeated scenes, missing scale, and unsupported topics. Report event precision/recall on defined eligible events, unsupported numerical-claim rate, correct abstention, model validity, and question solvability. Split by participant/location/session so near-duplicate clips cannot inflate results.

Learning evaluation: baseline task, immediate task, and delayed transfer in a new context. Compare equal-time course tutoring with and without the personal-moment/model-testing experience. Use an independent scoring rubric, ideally blinded scoring, and report uncertainty and attrition. A small feasibility pilot can detect usability problems; it cannot establish a general learning gain. Set sample size after a power analysis appropriate to the intended claim.

Demonstration acceptance gates:

- Candidate windows are selected by the detector from the whole recording, including irrelevant sections.
- At least one quantitative answer is traceable to legitimate supplied/measured inputs.
- At least one underdetermined candidate is handled constructively without invented numbers.
- At least one non-motion domain uses a different representation and model.
- A student's wrong model produces an interpretable mismatch and a targeted next step.
- Hints and revealed answers remain distinguishable in the saved learning evidence.
- A new-context review can be completed without replaying the previous answer.
- Media deletion, offline/deferred state, and a model failure have clear behavior.

Operational launch gates require predeclared device, accuracy, latency, and cost targets measured under real conditions. There is no responsible numerical accuracy or battery guarantee before those measurements exist.

Stop or change direction if ambient capture adds little learning value over a normal tutor, if users consistently reject invitations, if unsupported claims persist, or if sustained capture exceeds acceptable device cost. The preferred fallback is the same evidence-and-model workspace fed by course and sensor investigations, preserving the strongest learning mechanism.

## 16. Pitch and final commitments

“Students often know a formula without recognizing when it applies. Lens connects what they are learning to moments they encounter, then lets them build and test an explanation. A door becomes torque, a swing becomes energy, and a cooling drink becomes a temperature curve. Lens shows what was observed, what was assumed, and what the model predicts—then checks whether the student can use that idea somewhere new.”

Commit to spontaneous discovery, inspectable evidence, reviewed physics, a tutor that helps students progress, and transfer beyond the original scene. Treat broad domain support, all-day wearable capture, and improved learning outcomes as capabilities to earn through staged validation.

The first thing to build is the **evidence-to-model investigation workspace**, with continuous-recording replay as its first discovery input. That proves the educational product while giving the hardware ambition a concrete interface to grow into.
