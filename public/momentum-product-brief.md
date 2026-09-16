# Momentum — see a moment, keep the understanding

Momentum is a physics learning prototype for students who can remember a formula but struggle to recognize when it applies. It connects an ordinary video to their course through a focused coaching experience.

## The student experience

1. **Notice:** choose an event from a recording.
2. **Watch:** see the whole event before any interruption. This demo uses a 2.3-second basketball shot extracted from the user's real clip.
3. **Think:** the coach freezes a prepared teaching frame and asks a question inside the video stage. Answering reveals conceptual force and velocity arrows directly on the footage.
4. **Experiment:** change launch speed, angle, and height in an ideal projectile-motion model. Compare zero vertical velocity at the apex with nonzero downward acceleration.
5. **Explain and transfer:** save an explanation in your own words, then apply the idea to another situation in Practice & recall.

## The key distinction

**The in-video coach** guides one concrete learning moment. **The Physics lounge** is a separate space for broader discussion about physics. The lab is a place to test predictions, and the notebook preserves the student's own reasoning.

## What is working

- Real-video playback, an extracted event, event-only transport, slow motion, replay, and prepared teaching frames.
- Three questions inside the video stage, with feedback, hints, and conceptual annotations.
- A mathematically calculated projectile sandbox and a general physics discussion panel.
- Browser-local notebook, Markdown export, and transfer practice.
- A website introduction, usage guide, and a presentation walkthrough.
- A server-side Amazon Bedrock adapter for live tutoring and sampled-frame analysis when credentials are configured.

## What is prepared or simplified

The course, coaching sequence, teaching timestamps, and demo responses are prepared. Frame timing is approximate: the camera follows the ball, so the apparent image apex is not an exact measurement of the physical apex. The overlay uses an ideal ground-based model; its arrows are not measured forces or velocities. The sandbox ignores air resistance, spin, and collisions and uses hypothetical launch values.

The current demo works without an AWS login. Open-ended AI discussion and new-video analysis require Bedrock credentials. No learning gains or mastery scores are claimed. A correct multiple-choice answer and a saved explanation are evidence of activity, not proof of mastery.

## Why this matters

Momentum makes the context, question, and explanation visible together. A student can inspect the moment, test a misconception, and leave with an idea they can describe—not simply a formula they have seen.

Built for the Learn track of Minds & Machines: AI in Education.
