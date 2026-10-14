import { describe, expect, test } from "bun:test";
import { FlightPhysics } from "../src/physics";
import { fuelCapacityKg, instrumentData } from "../src/hud/instrument-data";
import type { AircraftId } from "../src/aircraft";

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0.6, brake: false };
function plane(id: AircraftId, airStart = false) {
  const p = new FlightPhysics();
  p.aircraftId = id;
  p.reset(airStart);
  return p;
}

describe("instrument data", () => {
  test("the Finch reports propeller RPM, jets report thrust percent", () => {
    expect(instrumentData(plane("finch"), 2276).engine).toEqual({ kind: "propeller", rpm: 2276 });
    const jet = plane("aurelia");
    jet.enginePower = 0.42;
    const engine = instrumentData(jet, 0).engine;
    expect(engine.kind).toBe("jet");
    if (engine.kind === "jet") expect(engine.percent).toBeCloseTo(42);
  });
  test("fuel fraction is remaining over capacity and clamped", () => {
    const p = plane("peregrine");
    const capacity = fuelCapacityKg(p);
    expect(capacity).toBeGreaterThan(0);
    p.fuelKg = capacity / 2;
    expect(instrumentData(p, 0).fuelFraction).toBeCloseTo(0.5);
    p.fuelKg = capacity * 3;
    expect(instrumentData(p, 0).fuelFraction).toBe(1);
    p.fuelKg = -5;
    expect(instrumentData(p, 0).fuelFraction).toBe(0);
  });
  test("AOA and stall AOA come from the live aerodynamics in degrees", () => {
    const p = plane("finch", true);
    p.step(1 / 120, neutral);
    const d = instrumentData(p, 0);
    expect(d.stallAoaDegrees).toBeGreaterThan(5);
    expect(d.stallAoaDegrees).toBeLessThan(30);
    expect(d.aoaDegrees).toBeGreaterThan(-10);
    expect(d.aoaDegrees).toBeLessThan(d.stallAoaDegrees);
  });
  test("before the first physics step AOA falls back safely", () => {
    const d = instrumentData(plane("stormbird"), 0);
    expect(d.aoaDegrees).toBe(0);
    expect(d.stallAoaDegrees).toBe(15);
  });
});
