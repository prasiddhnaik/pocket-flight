import { test, expect } from "bun:test";
import { FlightPhysics } from "../src/flight/physics";
import { gearContactHeight, aureliaWheels } from "../src/aircraft/landing-gear";
import { runways, groundAt } from "../src/world/terrain";
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
function jet() {
  const p = new FlightPhysics();
  p.aircraftId = "aurelia";
  p.reset();
  return p;
}
test("Aurelia starts with all four tires clear of both runways", () => {
  for (const short of [false, true]) {
    const p = jet();
    p.reset(false, short);
    expect(p.position.y).toBeCloseTo(
      gearContactHeight(p.position, p.quaternion, aureliaWheels),
      6,
    );
    for (const wheel of aureliaWheels) {
      const center = wheel.center
        .clone()
        .applyQuaternion(p.quaternion)
        .add(p.position);
      expect(
        center.y -
          wheel.major -
          wheel.minor -
          groundAt(center.x, center.z).height,
      ).toBeGreaterThanOrEqual(-0.001);
    }
  }
});
test("Aurelia takes off within Palm Bay and climbs without damage", () => {
  const p = jet();
  let airborne = false;
  for (let n = 0; n < 1200; n++) {
    p.step(1 / 60, {
      ...neutral,
      throttle: 1,
      pitch: p.airspeed > 31 && p.pitch < 0.14 ? 0.3 : 0,
    });
    if (!p.grounded) {
      airborne = true;
      break;
    }
  }
  expect(airborne).toBe(true);
  expect(p.position.z).toBeGreaterThan(runways[0].z - runways[0].length / 2);
  expect(p.health).toBe(100);
});
test("Aurelia approach lands and brakes to a stop without damage", () => {
  const p = jet();
  p.reset(true);
  // Start far enough up the 470 m runway for the calibrated CG-dependent
  // wheel loads and braking distance. The former late approach overran it.
  p.position.set(-260, 13, 510);
  p.gearPosition = 1;
  p.flapPosition = 0.65;
  const speed = p.stallSpeed * 1.35;
  const a = p.design.aerodynamics;
  const alpha =
    ((p.loadedMass * 9.80665) /
      (0.5 * 1.225 * speed ** 2 * p.design.geometry.wingArea) -
      a.cl0 -
      a.flapLift * p.flapPosition) /
    a.liftSlope;
  p.velocity.set(0, -1.2, -speed);
  p.pitch = alpha - Math.atan2(1.2, speed);
  p.throttle = p.enginePower = 0.08;
  let landed = false,
    touched = false;
  for (let n = 0; n < 1200; n++) {
    // Lower the nose and keep braking after touchdown, including brief wheel
    // unloading. Re-entering a flare every unloaded frame delays the rollout.
    touched ||= p.grounded;
    p.step(1 / 60, {
      ...neutral,
      pitch: touched
        ? 0
        : ((p.position.y < 11 ? alpha + 0.015 : alpha - 0.04) - p.pitch) * 4,
      throttle: touched ? -1 : 0,
      brake: touched,
    });
    landed ||= p.events.some((e) => e.type === "landing");
  }
  expect(landed).toBe(true);
  expect(p.grounded).toBe(true);
  expect(p.health).toBe(100);
  expect(p.velocity.length()).toBeLessThan(1);
  expect(p.position.z).toBeGreaterThan(
    runways[0].z - runways[0].length / 2 + 10,
  );
});
test("jet thrust exceeds Finch thrust while engine-out removes acceleration", () => {
  const a = jet(),
    b = new FlightPhysics();
  b.reset();
  a.throttle = b.throttle = 1;
  for (let n = 0; n < 180; n++) {
    a.step(1 / 60, neutral);
    b.step(1 / 60, neutral);
  }
  expect(a.airspeed).toBeGreaterThan(b.airspeed * 1.4);
  a.reset(true);
  a.engineOut = true;
  a.position.y = 500;
  const y = a.position.y;
  for (let n = 0; n < 300; n++) a.step(1 / 60, neutral);
  expect(a.position.y).toBeLessThan(y);
  expect(a.crashed).toBe(false);
});
