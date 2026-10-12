import { expect, test } from "bun:test";
import { FlightPhysics } from "../src/physics";
import { flightProfiles } from "../src/flight-profiles";
import type { AircraftId } from "../src/aircraft";

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
const ids = Object.keys(flightProfiles) as AircraftId[];
function airborne(id: AircraftId) {
  const p = new FlightPhysics();
  p.aircraftId = id;
  p.reset(true);
  p.position.y = 500;
  p.beginnerAssist = false;
  return p;
}
test("engine output ramps smoothly and resets with the aircraft", () => {
  for (const id of ids) {
    const p = airborne(id);
    p.throttle = 1;
    p.enginePower = 0;
    p.step(1 / 60, neutral);
    expect(p.enginePower).toBeGreaterThan(0);
    expect(p.enginePower).toBeLessThan(0.08);
    for (let n = 0; n < 300; n++) p.step(1 / 60, neutral);
    expect(p.enginePower).toBeGreaterThan(0.99);
    p.reset();
    expect(p.enginePower).toBe(0);
  }
});
test("fleet handling differs and remains consistent across simulation steps", () => {
  const banks = new Map<AircraftId, number>();
  for (const id of ids) {
    const results = [30, 60, 120].map((hz) => {
      const p = airborne(id);
      for (let n = 0; n < hz / 2; n++)
        p.step(1 / hz, { ...neutral, roll: 0.65, yaw: 0.2 });
      expect(p.crashed).toBe(false);
      return p;
    });
    expect(Math.abs(results[0].roll - results[2].roll)).toBeLessThan(0.025);
    expect(Math.abs(results[0].yaw - results[2].yaw)).toBeLessThan(0.01);
    banks.set(id, Math.abs(results[1].roll));
  }
  expect(banks.get("peregrine")!).toBeGreaterThan(banks.get("aurelia")! * 1.5);
  expect(banks.get("stormbird")!).toBeGreaterThan(banks.get("finch")! * 1.2);
});
test("beginner assist recovers a bank while manual flight retains it", () => {
  for (const id of ids) {
    const manual = airborne(id),
      assisted = airborne(id);
    manual.roll = assisted.roll = 0.5;
    assisted.beginnerAssist = true;
    for (let n = 0; n < 180; n++) {
      manual.step(1 / 60, neutral);
      assisted.step(1 / 60, neutral);
    }
    expect(Math.abs(assisted.roll)).toBeLessThan(0.06);
    expect(Math.abs(manual.roll)).toBeGreaterThan(0.45);
  }
});
test("Stormbird takes off with its deployed gear and new engine response", () => {
  const p = new FlightPhysics();
  p.aircraftId = "stormbird";
  p.reset();
  for (let n = 0; n < 1200 && p.grounded; n++)
    p.step(1 / 60, {
      ...neutral,
      throttle: 1,
      pitch: p.airspeed > 39 && p.pitch < 0.14 ? 0.3 : 0,
    });
  expect(p.grounded).toBe(false);
  expect(p.health).toBe(100);
});
