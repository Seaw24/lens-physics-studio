# Event Studio: agent-built annotations, quiz and physics lab on "Your day"

Date: 2026-09-16 · Status: decided by Claude (the user asked for a recommendation and code, with little design back-and-forth)

## Goal

Every Discovery event that passes review is sent to Opus 4.6 agents. They produce:

1. **Telestrated footage**: motion tracks, trails, force and velocity vectors, pivots, torque arcs, angle marks, labels, chapters, freeze frames and slow-motion drawn directly on the real clip.
2. **A quiz inside the video**: the clip pauses at moments the agent chooses. Answers use the video itself (drag a vector, tap a point, scrub to a moment, predict a path, or pick an option), and every answer reveals animated annotations.
3. **A physics lab**: an interactive simulation of the same situation, with sliders, live readouts and graphs, what-if experiments ("push twice as hard") where you predict before the lab runs, and one challenge.

"Your day" becomes that studio. A slide rail on the left (like PowerPoint) lists every event, grouped by recording. The main stage shows the annotated video with its quiz, and the lab sits directly below it. There is no "Explore this event" step.

## Decisions

- **Two agents per event, both `us.anthropic.claude-opus-4-6-v1`** (configurable with `STUDIO_MODEL_ID`):
  - *Motion annotator* (vision). It sees about 18 frames of the event clip with a labeled 0–100 coordinate grid and timestamps. It returns boxes for each tracked object, overlays, chapters, freezes and slow-motion segments.
  - *Lesson designer*. It sees the event facts, the annotator's output, 4 clean key frames and the engine catalog. It returns the headline, quiz and lab.
- **Physics truth comes from code, not from the model.** Labs run on 8 deterministic engines in `shared/studio/engines` (projectile, surface, rotation, balance, pendulum, collision, spring, buoyancy). The server simulates every experiment and challenge. If a stated expectation disagrees with the simulation, or a challenge cannot be reached, the agent gets one repair turn with the numbers, the same way the judge's schema repair works.
- **Strict, versioned contract** (`shared/studio/schema.ts`, zod), shared by the server and the browser. Coordinates are normalized image space (x right, y down, 0–1). Times are in clip seconds. Angles are in degrees with 0 = right and 90 = up on screen.
- **Isolation from Discovery.** `server/studio/*` only reads the Discovery store and reuses its transport. It uses its own queue lane, so studio calls never block the proposer or judge. Discovery changes are limited to one-word type unions.
- **When generation runs**
  - Sessions that finish while the server is running: all of their events are queued ("after all events are accepted").
  - Older events are generated when opened on "Your day", with the opened slide first.
  - Two jobs run at a time. Results are saved to `sessions/<id>/studio/<eventId>.json`, so they follow session retention.
  - A studio is reused for the same source video and the same clip interval, so re-running a video does not pay again.
- **"Your day" contents**: the latest session per source video (by content fingerprint) that has events, newest first. Events a human marked "should be rejected" are hidden. The basketball sample studio appears when there is nothing else.
- **Auth**: the studio API uses the Discovery controller cookie. The page shows the unlock card on 401.

## Contract (abridged)

- `annotations`
  - `tracks[{id,label,role,samples[{t,x,y,w,h,visible}]}]`
  - `overlays[]`: `trail | halo | vector | label | pivot | arc | angle | dimension | zone | ghosts`. Every overlay has `id`, `from` and `to`. A vector's direction is a fixed angle, the tracked motion, or toward an anchor.
  - `chapters[{t,title,caption}]`, `freezes[{t,holdSeconds,caption}]`, `slowmo[{from,to,rate}]`, `focusT`
- `quiz[]`: every question has `id`, `t`, `kicker`, `prompt`, `hint`, `explanation`, `reveal[]` and `extraOverlays`, plus one of:
  - `choice(options[{text,correct,feedback}])`
  - `vector(anchor,answerDeg,toleranceDeg)`
  - `hotspot(target,radius)`
  - `scrub(answerT,toleranceS)`
  - `path(track,horizonS)`. Distractor paths are generated from the real track.
- `lab`:
  - `engine`, `title`, `goal`, `skin` (body, other, surface, agent)
  - `params{key:{value,min,max}}`, restricted to the engine's keys and hard limits
  - `experiments[{id,title,question,change,metric,expect,explanation}]` (2–4)
  - `challenge{title,prompt,metric,target,tolerance,hint}|null`
  - `takeaway`

## API (under the Discovery cookie path)

- `GET /api/discovery/studio/day`: recordings, each with slides (subject, concept, clip, poster, status and stage)
- `GET /api/discovery/studio/events/:id`: the slide, the event and the studio record (queues generation if missing)
- `POST /api/discovery/studio/events/:id/generate` with `{force}`
- `GET /api/discovery/studio/events/:id/poster`: a JPEG frame at the event midpoint, cached

## UI

- **Rail**: numbered slide thumbnails with poster, title, concept and a status ring (queued, tracking, designing, ready, failed). Up/Down and PageUp/PageDown move between slides, and the stage animates a push transition.
- **Theater**: aspect-true video with a blurred poster backdrop and an SVG overlay layer driven by `requestVideoFrameCallback` or rAF. It has glass HTML labels, chapter captions, a custom scrubber with chapter ticks, quiz pins and the event band, speed control and an annotations toggle. Strobe "ghosts" are cut from the real footage on a canvas.
- **Quiz dock**: watch-first intro, then the question for each pause. Interaction layers sit on the video. After a check you get feedback, the reveal plays on the video, and the next question follows. It ends with a score summary and a pointer to the lab.
- **Lab**: a dark instrument canvas. Next to it are grouped sliders with units, and some quantities can also be dragged on the canvas. Below are metric tiles, a live graph, experiment cards (predict up, same or down, then an animated run against a baseline ghost with the measured change) and a challenge gauge.
- **Colors**: Momentum tokens. Cobalt is for interface, orange for physics data, and each vector quantity has a fixed color used in both the video and the lab.

## Build order

1. Shared schema, engine interface and the 8 engines with invariant tests.
2. Semantic validation (references, times, physics checks).
3. Server: frames and grid, prompts, agent calls with repair, queue service, router, wiring.
4. Client: day page, rail, theater overlays, quiz interactions, lab shell and engine views, CSS.
5. Basketball sample studio from the reviewed demo trace, then typecheck, tests and browser verification.

## Limits (stated in the UI)

Tracks are model estimates on sampled frames and are not calibrated measurements. Lab values are hypothetical and scaled to the scene. The engines are ideal models, and each one says which effects it ignores.
