import { expect, test } from "bun:test";
import { FlightPhysics } from "../src/flight/physics";
import type { AircraftId } from "../src/aircraft/aircraft";
import { aircraftDesign, massProperties } from "../src/aircraft/aircraft-design";
import {
  aircraftAerodynamics,
  aircraftStallSpeed,
  aircraftThrust,
} from "../src/flight/aerodynamics";
import { solveTrim } from "../src/flight/flight-trim";
import { integrateRotation } from "../src/flight/rigid-body";
import { Euler, Matrix3, Quaternion, Vector3 } from "three";
import { runtimeWingForAircraft } from "../lab/catalog";
import { cachedSolveWing } from "../lab/solver";

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
const fleet: AircraftId[] = ["finch", "peregrine", "aurelia", "stormbird"];

for (const id of fleet) {
  test(`${id}: keyboard departure clears Palm Bay terrain with full control and force dynamics`, () => {
    for (const hz of [30, 60, 120]) {
      const p = new FlightPhysics();
      p.aircraftId = id;
      p.reset();
      let tookOff = false;
      for (let n = 0; n < hz * 20; n++) {
        p.step(1 / hz, {
          ...neutral,
          throttle: 1,
          pitch: p.airspeed * 1.943844 >= p.profile.rotationKnots ? 1 : 0,
        });
        tookOff ||= p.events.some((e) => e.type === "takeoff");
      }
      expect(tookOff).toBe(true);
      expect(p.grounded).toBe(false);
      expect(p.crashed).toBe(false);
      expect(p.health).toBe(100);
      expect(p.stall).toBe(false);
      expect(p.position.y).toBeGreaterThan(55);
    }
  });
  test(`${id}: wheel reactions prevent a power-only nose rotation on the runway`, () => {
    // Compare with the settled stance of the measured rigid tires. Finch's
    // unequal axle heights give a slight nose-down stance even without power.
    const resting = new FlightPhysics();
    resting.aircraftId = id;
    resting.reset();
    resting.beginnerAssist = false;
    for (let n = 0; n < 180; n++) resting.step(1 / 60, neutral);
    const p = new FlightPhysics();
    p.aircraftId = id;
    p.reset();
    p.beginnerAssist = false;
    p.throttle = 1;
    for (let n = 0; n < 180; n++) p.step(1 / 60, neutral);
    expect(Math.abs(p.pitch - resting.pitch)).toBeLessThan(0.005);
    expect(p.grounded).toBe(true);
  });
  test(`${id}: payload changes actual lift acceleration`, () => {
    const light = new FlightPhysics(),
      heavy = new FlightPhysics();
    for (const p of [light, heavy]) {
      p.aircraftId = id;
      p.reset(true);
      p.position.set(0, 600, 700);
      p.velocity.set(0, 0, -60);
      p.pitch = 0.1;
      p.beginnerAssist = false;
      p.engineOut = true;
    }
    heavy.loadedMass *= 1.2;
    light.step(1 / 120, neutral);
    heavy.step(1 / 120, neutral);
    expect(light.velocity.y).toBeGreaterThan(heavy.velocity.y + 0.001);
    expect(light.aerodynamics).not.toBeNull();
    expect(heavy.aerodynamics).not.toBeNull();
  });
  test(`${id}: loading changes CG and inertia; inadmissible loadings are rejected`, () => {
    const d = aircraftDesign(id);
    for (const fuel of [0, 0.1, 1])
      for (const payload of [0, 0.5, 1]) {
        const m = massProperties(d.massBudget, { fuel, payload });
        expect(m.mass).toBeGreaterThan(0);
        expect(m.inertia.determinant()).toBeGreaterThan(0);
        const admissible =
          m.cg.z >= d.cgEnvelope[0] && m.cg.z <= d.cgEnvelope[1];
        const p = new FlightPhysics();
        p.aircraftId = id;
        if (admissible)
          expect(() => p.configureLoading({ fuel, payload })).not.toThrow();
        else expect(() => p.configureLoading({ fuel, payload })).toThrow();
        const product = m.inertia.clone().multiply(m.inverseInertia);
        product.elements.forEach((v, i) =>
          expect(v).toBeCloseTo(i % 4 === 0 ? 1 : 0, 8),
        );
      }
    expect(
      massProperties(d.massBudget, { fuel: 0, payload: 0 }).mass,
    ).toBeLessThan(d.nominal.mass);
    expect(
      aircraftStallSpeed(d, d.nominal.mass * 1.2) / aircraftStallSpeed(d),
    ).toBeCloseTo(Math.sqrt(1.2), 10);
    expect(() =>
      massProperties(d.massBudget, { fuel: -1, payload: 1 }),
    ).toThrow();
  });
  test(`${id}: attached lift matches its runtime asset's measured wing`, () => {
    const d = aircraftDesign(id),
      g = runtimeWingForAircraft(id);
    const a = cachedSolveWing(
      g,
      { speed: 45, density: 1.225, alpha: 0, beta: 0 },
      96,
    );
    const b = cachedSolveWing(
      g,
      { speed: 45, density: 1.225, alpha: 4, beta: 0 },
      96,
    );
    expect(d.geometry.wingArea).toBeCloseTo(b.area, 5);
    expect(d.aerodynamics.cl0).toBeCloseTo(a.cl, 8);
    expect(d.aerodynamics.liftSlope).toBeCloseTo(
      (b.cl - a.cl) / ((4 * Math.PI) / 180),
      8,
    );
  });
  test(`${id}: trim balances forces and moments and survives unassisted flight`, () => {
    const d = aircraftDesign(id),
      t = solveTrim(d, d.nominal, d.trimSpeed, 600, id === "finch" ? 1 : 0);
    expect(t.forceResidual).toBeLessThan(1e-6);
    expect(t.momentResidual).toBeLessThan(1e-6);
    const p = new FlightPhysics();
    p.aircraftId = id;
    p.reset(true);
    p.position.set(0, 600, 700);
    p.velocity.set(0, 0, -d.trimSpeed);
    p.pitch = t.alpha;
    p.elevatorTrim = t.pitch;
    p.throttle = p.enginePower = t.throttle;
    p.beginnerAssist = false;
    p.windOverride = new Vector3();
    for (let n = 0; n < 1200; n++) p.step(1 / 60, neutral);
    expect(Math.abs(p.position.y - 600)).toBeLessThan(0.5);
    expect(Math.abs(p.airspeed - d.trimSpeed)).toBeLessThan(0.1);
    expect(p.gearPosition).toBe(id === "finch" ? 1 : 0);
    expect(p.health).toBe(100);
  });
  test(`${id}: density, flap, gear, CG and control moments have physical effects`, () => {
    const d = aircraftDesign(id),
      v = new Vector3(0, 0, -60),
      zero = new Vector3();
    const q = new Quaternion().setFromEuler(new Euler(0.1, 0, 0));
    const evaluate = (
      alt = 0,
      cg = d.nominal.cg,
      controls = { pitch: 0, roll: 0, yaw: 0 },
      gear = 0,
      flap = 0,
    ) =>
      aircraftAerodynamics(d, v, zero, q, alt, cg, zero, controls, {
        gear,
        flap,
        wingDamage: 0,
        gearDamage: 0,
      });
    const base = evaluate(),
      high = evaluate(1800),
      flapped = evaluate(0, d.nominal.cg, undefined, 1, 0.35);
    expect(high.lift).toBeLessThan(base.lift);
    expect(flapped.lift).toBeGreaterThan(base.lift);
    expect(flapped.drag).toBeGreaterThan(base.drag);
    expect(
      evaluate(0, d.nominal.cg.clone().add(new Vector3(0, 0, 0.1))).moment.x,
    ).toBeGreaterThan(base.moment.x);
    const input = evaluate(0, d.nominal.cg, { pitch: 1, roll: 1, yaw: 1 });
    expect(input.moment.x).toBeGreaterThan(base.moment.x);
    expect(input.moment.y).toBeLessThan(base.moment.y);
    expect(input.moment.z).toBeLessThan(base.moment.z);
    expect(aircraftThrust(d, 60, 0, 1.225)).toBe(0);
    expect(aircraftThrust(d, 60, 1, 1.0)).toBeLessThan(
      aircraftThrust(d, 60, 1, 1.225),
    );
    const stalled = aircraftAerodynamics(
      d,
      v,
      zero,
      new Quaternion().setFromEuler(new Euler(0.7, 0, 0)),
      0,
      d.nominal.cg,
    );
    expect(stalled.stalled).toBe(true);
    expect(stalled.force.dot(v)).toBeLessThanOrEqual(1e-6);
  });
  test(`${id}: actuators are rate limited and fuel changes mass and propulsion`, () => {
    const p = new FlightPhysics();
    p.aircraftId = id;
    p.reset(true);
    p.position.y = 600;
    p.beginnerAssist = false;
    p.step(1 / 120, { ...neutral, pitch: 1, roll: 1, yaw: 1 });
    const start = { ...p.surfaces };
    p.step(1 / 120, { ...neutral, pitch: -1, roll: -1, yaw: -1 });
    for (const axis of ["pitch", "roll", "yaw"] as const)
      expect(Math.abs(p.surfaces[axis] - start[axis])).toBeLessThanOrEqual(
        3 / 120 + 1e-9,
      );
    const mass = p.loadedMass,
      fuel = p.fuelKg;
    for (let n = 0; n < 180; n++) p.step(1 / 60, neutral);
    expect(p.fuelKg).toBeLessThan(fuel);
    expect(p.loadedMass).toBeLessThan(mass);
    p.configureLoading({ fuel: 0, payload: 1 });
    p.step(1 / 60, neutral);
    expect(p.fuelKg).toBe(0);
    expect(() => {
      p.loadedMass = -1;
    }).toThrow();
  });
}

test("rigid-body torque follows inertia and free rotation conserves angular momentum", () => {
  const q = new Quaternion(),
    w = new Vector3(),
    moment = new Vector3(2, 0, 0);
  const inertia = new Matrix3().set(2, 0, 0, 0, 3, 0, 0, 0, 4);
  integrateRotation(q, w, moment, inertia, inertia.clone().invert(), 0.1);
  expect(w.x).toBeCloseTo(0.1, 10);
  expect(q.length()).toBeCloseTo(1, 12);
  w.set(0.3, 0.6, 0.9);
  q.identity();
  const momentum = w.clone().applyMatrix3(inertia),
    energy = w.dot(momentum) / 2;
  for (let n = 0; n < 2400; n++)
    integrateRotation(
      q,
      w,
      new Vector3(),
      inertia,
      inertia.clone().invert(),
      1 / 240,
    );
  expect(
    w.clone().applyMatrix3(inertia).applyQuaternion(q).distanceTo(momentum),
  ).toBeLessThan(0.0001);
  expect(
    Math.abs(w.dot(w.clone().applyMatrix3(inertia)) / 2 - energy),
  ).toBeLessThan(0.0001);
});
