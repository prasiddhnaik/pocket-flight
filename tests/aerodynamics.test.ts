import { expect, test } from "bun:test";
import { Euler, Quaternion, Vector3 } from "three";
import {
  airDensity,
  bodyAirflow,
  finchAerodynamics,
  finchCoefficients,
  finchStallSpeed,
  finchThrust,
  GRAVITY,
  SEA_LEVEL_DENSITY,
} from "../src/aerodynamics";
import { finchDesign, finchMass } from "../src/finch-design";
import { FlightPhysics } from "../src/physics";

const zero = new Vector3();
const attitude = new Quaternion().setFromEuler(new Euler(0.12, 0, 0));
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };

test("body angle of attack and sideslip are invariant under world rotation and uniform wind", () => {
  const body = new Vector3(4, -8, -40);
  const base = bodyAirflow(body, zero, new Quaternion());
  const q = new Quaternion().setFromEuler(
    new Euler(0.55, 1.1, Math.PI / 2, "YXZ"),
  );
  const wind = new Vector3(8, 3, -6);
  const rotated = bodyAirflow(
    body.clone().applyQuaternion(q).add(wind),
    wind,
    q,
  );
  expect(rotated.alpha).toBeCloseTo(base.alpha, 10);
  expect(rotated.beta).toBeCloseTo(base.beta, 10);
  expect(rotated.speed).toBeCloseTo(base.speed, 10);
  expect(base.alpha).toBeCloseTo(Math.atan2(8, 40), 10);
});

test("forces scale with dynamic pressure and act along the air-relative aerodynamic axes", () => {
  const slow = finchAerodynamics(new Vector3(0, 0, -30), zero, attitude, 0);
  const fast = finchAerodynamics(new Vector3(0, 0, -60), zero, attitude, 0);
  expect(fast.lift / slow.lift).toBeCloseTo(4, 10);
  expect(fast.drag / slow.drag).toBeCloseTo(4, 10);
  expect(slow.lift).toBeCloseTo(
    0.5 * SEA_LEVEL_DENSITY * 30 ** 2 * finchDesign.geometry.wingArea * slow.cl,
    6,
  );
  expect(slow.force.dot(slow.direction)).toBeCloseTo(-slow.drag, 8);
  const wind = new Vector3(5, -2, 11);
  const shifted = finchAerodynamics(
    new Vector3(0, 0, -30).add(wind),
    wind,
    attitude,
    0,
  );
  expect(shifted.force.distanceTo(slow.force)).toBeLessThan(1e-8);
});

test("a bank rotates lift and requires more lift to maintain height", () => {
  const q = new Quaternion().setFromEuler(
    new Euler(0.12, 0, Math.PI / 3, "YXZ"),
  );
  const body = new Vector3(0, -30 * Math.sin(0.12), -30 * Math.cos(0.12));
  const wingsLevel = finchAerodynamics(body, zero, new Quaternion(), 0);
  const banked = finchAerodynamics(body.clone().applyQuaternion(q), zero, q, 0);
  expect(banked.lift).toBeCloseTo(wingsLevel.lift, 7);
  // Rotate the complete force; banking is not a command to hold altitude.
  expect(
    banked.force.distanceTo(wingsLevel.force.clone().applyQuaternion(q)),
  ).toBeLessThan(1e-7);
  expect(
    finchStallSpeed(finchMass, SEA_LEVEL_DENSITY, 2) / finchStallSpeed(),
  ).toBeCloseTo(Math.SQRT2, 10);
});

test("stall follows angle of attack, has continuous onset, and loses lift after separation", () => {
  const peakAlpha = finchCoefficients(0).positiveStall;
  const before = finchCoefficients(peakAlpha - 1e-7);
  const after = finchCoefficients(peakAlpha + 1e-7);
  expect(before.stalled).toBe(false);
  expect(after.stalled).toBe(true);
  expect(Math.abs(before.cl - after.cl)).toBeLessThan(0.00001);
  expect(finchCoefficients(0.6).cl).toBeLessThan(before.cl);
  expect(finchCoefficients(0.6).cd).toBeGreaterThan(before.cd);
  expect(finchCoefficients(0).stalled).toBe(false);
  expect(finchCoefficients(-0.5).stalled).toBe(true);
});

test("density and mass change true stall speed according to the lift equation", () => {
  const base = finchStallSpeed();
  expect(base).toBeGreaterThan(23);
  expect(base).toBeLessThan(24);
  expect(finchStallSpeed(finchMass * 1.2) / base).toBeCloseTo(
    Math.sqrt(1.2),
    10,
  );
  expect(finchStallSpeed(finchMass, airDensity(1800))).toBeGreaterThan(base);
  expect(airDensity(0)).toBe(SEA_LEVEL_DENSITY);
  expect(airDensity(1800)).toBeGreaterThan(1);
});

test("propeller thrust is bounded by static thrust and available shaft power", () => {
  expect(finchThrust(0, 0, SEA_LEVEL_DENSITY)).toBe(0);
  expect(finchThrust(0, 1, SEA_LEVEL_DENSITY)).toBe(
    finchDesign.propulsion.staticThrust,
  );
  expect(finchThrust(60, 1, SEA_LEVEL_DENSITY) * 60).toBeCloseTo(
    finchDesign.propulsion.shaftPower * finchDesign.propulsion.efficiency,
    6,
  );
  expect(finchThrust(30, 1, airDensity(1800))).toBeLessThan(
    finchThrust(30, 1, SEA_LEVEL_DENSITY),
  );
});

test("zero speed and reverse flow stay finite and aerodynamic forces do not add energy", () => {
  for (const velocity of [
    zero,
    new Vector3(0, 30, 0),
    new Vector3(30, 0, 0),
    new Vector3(0, 0, 30),
  ]) {
    const a = finchAerodynamics(velocity, zero, new Quaternion(), 0);
    for (const value of [a.alpha, a.beta, a.lift, a.drag, ...a.force.toArray()])
      expect(Number.isFinite(value)).toBe(true);
    expect(a.force.dot(velocity)).toBeLessThanOrEqual(1e-7);
  }
});

test("low airspeed alone is insufficient lift, while high-speed high-AOA flight stalls", () => {
  const low = new FlightPhysics();
  low.reset(true);
  low.position.set(0, 500, 700);
  low.pitch = 0;
  low.velocity.set(0, 0, -12);
  low.beginnerAssist = false;
  low.engineOut = true;
  low.step(1 / 60, neutral);
  expect(low.stall).toBe(false);
  expect(low.aerodynamics!.lift).toBeLessThan(finchMass * GRAVITY);
  expect(low.velocity.y).toBeLessThan(0);
  low.pitch = 0.5;
  low.velocity.set(0, 0, -60);
  low.step(1 / 60, neutral);
  expect(low.stall).toBe(true);
});

test("assist can be disabled and mass affects actual acceleration", () => {
  const light = new FlightPhysics(),
    heavy = new FlightPhysics();
  for (const p of [light, heavy]) {
    p.reset(true);
    p.position.set(0, 500, 700);
    p.velocity.set(0, 0, -34);
    p.beginnerAssist = false;
    p.roll = 0.6;
    p.pitch = 0.12;
    p.engineOut = true;
  }
  heavy.loadedMass *= 1.2;
  light.step(1 / 60, neutral);
  heavy.step(1 / 60, neutral);
  // Natural roll/yaw coupling remains active with the level assist off.
  expect(light.angularVelocity.length()).toBeGreaterThan(0);
  expect(Math.abs(light.roll - 0.6)).toBeLessThan(0.01);
  expect(light.velocity.y).toBeGreaterThan(heavy.velocity.y);
  expect(light.beginnerAssist).toBe(false);
  light.reset();
  expect(light.beginnerAssist).toBe(false);
});
