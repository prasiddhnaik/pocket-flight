import { test, expect } from "bun:test";
import { FlightPhysics } from "../src/physics";
import { gearContactHeight, peregrineWheels } from "../src/landing-gear";
import { runways, groundAt } from "../src/terrain";
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
function jet() {
  const p = new FlightPhysics();
  p.aircraftId = "peregrine";
  p.reset();
  return p;
}
test("Peregrine starts with all six tires clear of both runways", () => {
  for (const short of [false, true]) {
    const p = jet();
    p.reset(false, short);
    expect(p.position.y).toBeCloseTo(
      gearContactHeight(p.position, p.quaternion, peregrineWheels),
      6,
    );
    for (const wheel of peregrineWheels) {
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
test("Peregrine takes off within Palm Bay and climbs without damage", () => {
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
test("Peregrine approach lands and brakes to a stop without damage", () => {
  const p = jet();
  p.reset(true);
  p.position.set(-260, 13, 410);
  p.velocity.set(0, -1.2, -36);
  p.pitch = -0.04;
  p.throttle = 0.08;
  let landed = false;
  for (let n = 0; n < 1200; n++) {
    p.step(1 / 60, {
      ...neutral,
      pitch: p.grounded ? 0 : (-0.055 - p.pitch) * 4,
      throttle: p.grounded ? -1 : 0,
      brake: p.grounded,
    });
    landed ||= p.events.some((e) => e.type === "landing");
  }
  expect(landed).toBe(true);
  expect(p.grounded).toBe(true);
  expect(p.health).toBe(100);
  expect(p.velocity.length()).toBeLessThan(1);
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
