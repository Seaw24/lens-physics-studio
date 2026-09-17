import test from "node:test";
import assert from "node:assert/strict";
import {
  ENGINES,
  compareMetric,
  getEngine,
  resolveParams,
  runExperiment,
} from "../shared/studio/engines";

const near = (actual: number | null, expected: number, tolerance: number) => {
  assert.ok(actual !== null, `expected ${expected}, got null`);
  assert.ok(
    Math.abs(actual! - expected) <= tolerance,
    `expected ${expected} ± ${tolerance}, got ${actual}`,
  );
};

const run = (id: string, overrides: Record<string, number>) => {
  const engine = getEngine(id)!;
  return engine.simulate(resolveParams(engine, overrides));
};

test("every engine simulates its defaults with finite metrics and samples", () => {
  for (const engine of Object.values(ENGINES)) {
    const sim = engine.simulate(resolveParams(engine));
    assert.ok(sim.duration > 0, `${engine.id} duration`);
    for (const [key, value] of Object.entries(sim.metrics))
      assert.ok(value === null || Number.isFinite(value), `${engine.id}.${key}`);
    for (const t of [0, sim.duration / 3, sim.duration, sim.duration + 5])
      for (const [key, value] of Object.entries(sim.sample(t)))
        assert.ok(Number.isFinite(value), `${engine.id} sample ${key} at ${t}`);
    for (const spec of engine.metrics)
      assert.ok(spec.key in sim.metrics, `${engine.id} reports ${spec.key}`);
  }
});

test("projectile without drag matches the ideal equations", () => {
  const g = 9.81;
  const v = 10;
  const sim = run("projectile", { speed: v, angle: 45, height: 0, drag: 0 });
  near(sim.metrics.range, (v * v) / g, 0.02);
  near(sim.metrics.flightTime, (2 * v * Math.SQRT1_2) / g, 0.004);
  near(sim.metrics.maxHeight, (v * Math.SQRT1_2) ** 2 / (2 * g), 0.01);
  near(sim.metrics.apexTime, (v * Math.SQRT1_2) / g, 0.004);
  const drop = run("projectile", { speed: 0, height: 2, drag: 0 });
  near(drop.metrics.flightTime, Math.sqrt((2 * 2) / g), 0.004);
  near(drop.metrics.range, 0, 1e-6);
  const apex = sim.sample(sim.metrics.apexTime!);
  near(apex.vy, 0, 0.05);
  near(apex.ay, -g, 1e-6);
});

test("projectile mass matters only with air drag", () => {
  const light = run("projectile", { speed: 15, angle: 40, mass: 0.1, drag: 0 });
  const heavy = run("projectile", { speed: 15, angle: 40, mass: 5, drag: 0 });
  near(light.metrics.range, heavy.metrics.range!, 1e-6);
  const lightDrag = run("projectile", { speed: 15, angle: 40, mass: 0.1, drag: 0.47 });
  const heavyDrag = run("projectile", { speed: 15, angle: 40, mass: 5, drag: 0.47 });
  assert.ok(lightDrag.metrics.range! < heavyDrag.metrics.range!);
  assert.ok(heavyDrag.metrics.range! < heavy.metrics.range!);
});

test("surface push obeys static and kinetic friction", () => {
  const holds = run("surface", { mass: 1, force: 4, muS: 0.5, muK: 0.3, pushTime: 1 });
  assert.equal(holds.metrics.startsMoving, 0);
  assert.equal(holds.metrics.distance, 0);
  const m = 2;
  const F = 20;
  const T = 0.5;
  const muK = 0.3;
  const g = 9.81;
  const sim = run("surface", { mass: m, force: F, muS: 0.5, muK, pushTime: T });
  const a1 = (F - muK * m * g) / m;
  near(sim.metrics.pushAcceleration, a1, 1e-3);
  const v1 = a1 * T;
  near(sim.metrics.maxSpeed, v1, 0.02);
  const expectedDistance = 0.5 * a1 * T * T + (v1 * v1) / (2 * muK * g);
  near(sim.metrics.distance, expectedDistance, 0.02);
  near(sim.metrics.stopTime, T + v1 / (muK * g), 0.03);
});

test("surface slope holds below the friction angle and slides above it", () => {
  const holds = run("surface", { force: 0, pushTime: 0, incline: 20, muS: 0.5, muK: 0.4 });
  assert.equal(holds.metrics.startsMoving, 0);
  const slides = run("surface", { force: 0, pushTime: 0, incline: 35, muS: 0.5, muK: 0.4 });
  assert.equal(slides.metrics.startsMoving, 1);
  const engine = getEngine("surface")!;
  assert.equal(resolveParams(engine, { muS: 0.2, muK: 0.9 }).muK, 0.2);
});

test("rotation torque depends on lever arm and angle", () => {
  const base = run("rotation", { force: 10, leverArm: 0.5, forceAngle: 90, resistance: 0 });
  near(base.metrics.torque, 5, 1e-9);
  const far = run("rotation", { force: 10, leverArm: 0.8, forceAngle: 90, resistance: 0 });
  assert.ok(far.metrics.torque! > base.metrics.torque!);
  const slanted = run("rotation", { force: 10, leverArm: 0.5, forceAngle: 30, resistance: 0 });
  near(slanted.metrics.torque, 2.5, 1e-9);
  const stuck = run("rotation", { force: 10, leverArm: 0.1, forceAngle: 90, resistance: 2 });
  assert.equal(stuck.metrics.startsTurning, 0);
  const inertia = (20 * 0.9 * 0.9) / 3;
  const turning = run("rotation", { force: 10, leverArm: 0.5, resistance: 1, mass: 20, length: 0.9 });
  near(turning.metrics.angularAcceleration, (5 - 1) / inertia, 1e-4);
});

test("balance: equal torques balance, support forces add to the weight", () => {
  const level = run("balance", {
    support: 0,
    beamLength: 3,
    beamMass: 0,
    pivot: 1.5,
    mass1: 30,
    pos1: 1,
    mass2: 15,
    pos2: 2.5,
    mass3: 0,
  });
  assert.equal(level.metrics.balanced, 1);
  const tips = run("balance", {
    support: 0,
    beamLength: 3,
    beamMass: 0,
    pivot: 1.5,
    mass1: 30,
    pos1: 1,
    mass2: 15,
    pos2: 3,
    mass3: 0,
  });
  assert.equal(tips.metrics.tipDirection, 1);
  const table = run("balance", {
    support: 1,
    beamLength: 2,
    beamMass: 10,
    support1: 0.2,
    support2: 1.8,
    mass1: 20,
    pos1: 0.5,
    mass2: 5,
    pos2: 1.5,
    mass3: 0,
  });
  assert.equal(table.metrics.balanced, 1);
  near(
    table.metrics.leftSupportForce! + table.metrics.rightSupportForce!,
    table.metrics.totalWeight!,
    1e-6,
  );
  const overhang = run("balance", {
    support: 1,
    beamLength: 3,
    beamMass: 2,
    support1: 0,
    support2: 1,
    mass1: 40,
    pos1: 2.8,
    mass2: 0,
    mass3: 0,
  });
  assert.equal(overhang.metrics.balanced, 0);
  assert.equal(overhang.metrics.tipDirection, 1);
});

test("pendulum period follows 2π√(L/g) for small swings and ignores mass", () => {
  const small = run("pendulum", { length: 2, angle: 5, damping: 0 });
  near(small.metrics.period, 2 * Math.PI * Math.sqrt(2 / 9.81), 0.01);
  const heavy = run("pendulum", { length: 2, angle: 5, damping: 0, mass: 90 });
  near(heavy.metrics.period, small.metrics.period!, 1e-3);
  const big = run("pendulum", { length: 2, angle: 60, damping: 0 });
  assert.ok(big.metrics.period! > small.metrics.period!);
  near(big.metrics.maxSpeed, Math.sqrt(2 * 9.81 * big.metrics.dropHeight!), 0.02);
});

test("collisions conserve momentum; contact time changes force, not impulse", () => {
  const elastic = run("collision", { mass1: 1, mass2: 1, speed1: 4, speed2: 0, elasticity: 1 });
  near(elastic.metrics.v1After, 0, 1e-9);
  near(elastic.metrics.v2After, 4, 1e-9);
  const stick = run("collision", { mass1: 2, mass2: 1, speed1: 3, speed2: 0, elasticity: 0 });
  near(stick.metrics.v1After, 2, 1e-9);
  near(stick.metrics.momentumAfter, stick.metrics.momentumBefore!, 1e-9);
  const quick = run("collision", { contactTime: 0.01 });
  const padded = run("collision", { contactTime: 0.2 });
  near(quick.metrics.impulse, padded.metrics.impulse!, 1e-9);
  assert.ok(quick.metrics.peakForce! > 10 * padded.metrics.peakForce!);
  const apart = run("collision", { speed1: -1, speed2: 2 });
  assert.equal(apart.metrics.collides, 0);
});

test("spring stays elastic below its limit and keeps a dent above it", () => {
  const gentle = run("spring", { mode: 1, stiffness: 2000, elasticLimit: 0.05, force: 50, direction: -1 });
  assert.equal(gentle.metrics.yielded, 0);
  near(gentle.metrics.permanentSet, 0, 1e-9);
  near(gentle.metrics.maxDeformation, 0.025, 0.002);
  const crush = run("spring", { mode: 1, stiffness: 2000, elasticLimit: 0.01, force: 60, direction: -1 });
  assert.equal(crush.metrics.yielded, 1);
  assert.ok(crush.metrics.permanentSet! > 0.005);
  const swing = run("spring", { mode: 0, stiffness: 100, mass: 1, displacement: 0.05, elasticLimit: 0.5 });
  near(swing.metrics.period, 2 * Math.PI * Math.sqrt(1 / 100), 1e-4);
});

test("buoyancy: floats by density and sinks when overloaded", () => {
  const boat = run("buoyancy", { mass: 100, load: 0, volume: 1, height: 0.5, fluidDensity: 1000 });
  assert.equal(boat.metrics.floats, 1);
  near(boat.metrics.submergedFraction, 10, 1e-6);
  near(boat.metrics.spareLoad, 900, 1e-6);
  const settled = boat.sample(boat.duration);
  near(settled.depth, 0.05, 0.01);
  const sunk = run("buoyancy", { mass: 100, load: 950, volume: 1, height: 0.5, fluidDensity: 1000 });
  assert.equal(sunk.metrics.floats, 0);
  assert.ok(sunk.metrics.spareLoad! < 0);
});

test("experiments compare metrics with a 2% dead band", () => {
  assert.equal(compareMetric(10, 10.1).direction, "same");
  assert.equal(compareMetric(10, 12).direction, "increase");
  assert.equal(compareMetric(0, 0).direction, "same");
  assert.equal(compareMetric(null, 3).direction, null);
  const engine = getEngine("surface")!;
  const result = runExperiment(
    engine,
    { mass: 2, force: 20, pushTime: 0.5 },
    { force: 40 },
    "pushAcceleration",
  );
  assert.equal(result.comparison.direction, "increase");
  const clamped = resolveParams(getEngine("projectile")!, { angle: 400 });
  assert.equal(clamped.angle, 90);
});
