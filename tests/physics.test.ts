import { test } from "node:test";
import assert from "node:assert/strict";
import {
  torque,
  requiredForce,
  motionAt,
  assessAnswer,
  parseNumber,
} from "../shared/physics";
import { projectileAt, flightTime } from "../shared/physics";

test("at the apex only vertical velocity vanishes, not gravity or horizontal motion", () => {
  const speed = 9.5,
    angle = 52;
  const apex = (speed * Math.sin((angle * Math.PI) / 180)) / 9.81;
  const p = projectileAt(apex, speed, angle, 2);
  assert.ok(Math.abs(p.vy) < 1e-10);
  assert.ok(p.vx > 0);
  assert.equal(p.ay, -9.81);
  assert.equal(p.ax, 0);
  assert.equal(assessAnswer("projectile", "Downward").correct, true);
  assert.equal(assessAnswer("projectile", "Zero").correct, false);
});
test("analytic flight time lands at the floor for varied launches", () => {
  for (const [speed, angle, height] of [
    [4, 15, 0.5],
    [9.5, 52, 2],
    [14, 80, 3],
  ]) {
    const duration = flightTime(speed, angle, height);
    assert.ok(duration > 0);
    const end = projectileAt(duration, speed, angle, height);
    assert.ok(Math.abs(end.y) < 1e-9);
    assert.ok(end.vy < 0);
  }
});
test("projectile horizontal velocity is constant while vertical velocity changes by g delta t", () => {
  const a = projectileAt(0.2, 9, 40, 2),
    b = projectileAt(0.8, 9, 40, 2);
  assert.equal(a.vx, b.vx);
  assert.ok(Math.abs(b.vy - a.vy + 9.81 * 0.6) < 1e-10);
});
test("torque preserves the 8 N·m target while changing the arm", () => {
  assert.equal(torque(10, 0.8), 8);
  assert.equal(requiredForce(8, 0.2), 40);
  assert.equal(torque(requiredForce(8, 0.2)!, 0.2), 8);
});
test("oblique forces use the perpendicular moment arm", () => {
  assert.ok(Math.abs(torque(10, 0.8, 30) - 4) < 1e-10);
  assert.equal(requiredForce(8, 0.2, 0), null);
  assert.ok(Math.abs(requiredForce(8, 0.2, 30)! - 80) < 1e-8);
});
test("left net force slows a cart still moving right", () => {
  assert.ok(motionAt(2, -1).velocity > 0);
  assert.ok(motionAt(2, -1).velocity < motionAt(0, -1).velocity);
  assert.ok(motionAt(2, 1).velocity > motionAt(0, 1).velocity);
});
test("numeric assessment does not accept unrelated units or embedded numbers", () => {
  assert.equal(parseNumber("40 N"), 40);
  assert.equal(parseNumber("40 m"), null);
  assert.equal(parseNumber("40 or 10"), null);
  assert.equal(assessAnswer("torque", "40 N").correct, true);
  assert.equal(assessAnswer("torque", "10").correct, false);
  assert.equal(assessAnswer("equilibrium", "10 N").correct, true);
});
test("force assessment rejects ambiguous direction answers", () => {
  assert.equal(assessAnswer("force", "left").correct, true);
  assert.equal(assessAnswer("force", "left or right").correct, false);
  assert.equal(assessAnswer("force", "right").correct, false);
});
