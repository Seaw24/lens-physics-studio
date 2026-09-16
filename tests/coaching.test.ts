import { test } from "node:test";
import assert from "node:assert/strict";
import { SHOT_EVENT, SHOT_QUESTIONS, eventTime } from "../shared/coaching";
import { generalPhysicsReply } from "../shared/generalTutor";

test("original-video times map into the isolated event without escaping it", () => {
  assert.equal(eventTime(0, SHOT_EVENT.start, SHOT_EVENT.end), 0);
  assert.ok(
    Math.abs(eventTime(14.7, SHOT_EVENT.start, SHOT_EVENT.end) - 1.2) < 1e-10,
  );
  assert.equal(
    eventTime(48.6, SHOT_EVENT.start, SHOT_EVENT.end),
    SHOT_EVENT.end - SHOT_EVENT.start,
  );
  for (const question of SHOT_QUESTIONS) {
    assert.ok(
      question.time > SHOT_EVENT.start && question.time < SHOT_EVENT.end,
    );
    assert.ok(question.position.x > 0 && question.position.x < 1);
    assert.ok(question.position.y > 0 && question.position.y < 1);
  }
});

test("general lounge answers the selected topic instead of redirecting everything to apex coaching", () => {
  const torque = generalPhysicsReply("How is torque different from force?");
  assert.match(torque.reply, /turning effect/);
  assert.doesNotMatch(torque.reply, /highest point|apex/);
  assert.match(
    generalPhysicsReply("Where does energy go?").reply,
    /kinetic energy/i,
  );
  assert.match(generalPhysicsReply("Explain electric current").reply, /V = IR/);
  assert.equal(torque.mode, "rehearsal");
});

test("unsupported demo lounge questions disclose the prepared-response limitation", () => {
  const answer = generalPhysicsReply("Explain quantum entanglement");
  assert.match(answer.reply, /prepared explanations/);
  assert.match(answer.reply, /Connect Amazon Bedrock/);
});
