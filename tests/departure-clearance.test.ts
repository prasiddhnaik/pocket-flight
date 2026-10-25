import { expect, test } from "bun:test";
import { Vector3 } from "three";
import { FlightPhysics } from "../src/flight/physics";
import type { AircraftId } from "../src/aircraft/aircraft";
import { groundHeight, runways, runwayLocal } from "../src/world/terrain";

for (const id of [
  "finch",
  "peregrine",
  "aurelia",
  "stormbird",
] as AircraftId[]) {
  test(`${id}: Palm Bay departure clears the entire climb-out at dispatch weight`, () => {
    for (const hz of [30, 60, 120])
      for (const pull of [0.3, 1]) {
        const p = new FlightPhysics();
        p.aircraftId = id;
        p.reset();
        const mass = p.loadedMass;
        const fuel = p.fuelKg;
        const dryMass = mass - fuel;
        const maxFuelRate =
          p.design.propulsion.fuelRate * (p.profile.afterburner ? 2 : 1);
        expect(mass).toBeCloseTo(p.design.nominal.mass, 8);
        let maxDryMassError = 0;
        let maxFuelCacheLag = 0;
        let takeoffTime = Infinity;
        const forward = new Vector3(0, 0, -1).applyQuaternion(p.quaternion);
        expect(forward.z).toBeGreaterThan(0.99);
        for (let n = 0; n < hz * 60; n++) {
          p.step(1 / hz, {
            pitch: p.airspeed * 1.943844 >= p.profile.rotationKnots ? pull : 0,
            roll: 0,
            yaw: 0,
            throttle: 1,
            brake: false,
          });
          maxDryMassError = Math.max(
            maxDryMassError,
            Math.abs(p.loadedMass - p.massProperties.fuelKg - dryMass),
          );
          const fuelCacheLag = p.massProperties.fuelKg - p.fuelKg;
          expect(fuelCacheLag).toBeGreaterThanOrEqual(-1e-8);
          maxFuelCacheLag = Math.max(maxFuelCacheLag, fuelCacheLag);
          if (
            p.events.some((e) => e.type === "takeoff") &&
            takeoffTime === Infinity
          ) {
            takeoffTime = p.flightTime;
            const local = runwayLocal(p.position.x, p.position.z, runways[0]);
            expect(Math.abs(local.z)).toBeLessThan(runways[0].length / 2);
          }
          expect(p.health).toBe(100);
          expect(p.crashed).toBe(false);
          if (p.flightTime > takeoffTime + 3) {
            expect(
              p.position.y - groundHeight(p.position.x, p.position.z),
            ).toBeGreaterThan(10);
            expect(p.grounded).toBe(false);
          }
        }
        expect(takeoffTime).toBeLessThan(15);
        expect(p.position.z).toBeGreaterThan(
          runways[0].z + runways[0].length / 2 + 500,
        );
        // Full-power jets can burn more than 1% of dispatch mass in a minute.
        // Only fuel may leave the mass budget; its cached CG/inertia update can
        // lag instantaneous tank fuel by at most 0.25 s plus one 120 Hz substep.
        const burnt = fuel - p.fuelKg;
        expect(burnt).toBeGreaterThan(0);
        expect(burnt).toBeLessThanOrEqual(maxFuelRate * p.flightTime + 1e-8);
        expect(maxDryMassError).toBeLessThan(1e-8);
        expect(maxFuelCacheLag).toBeLessThanOrEqual(
          maxFuelRate * (0.25 + 1 / 120) + 1e-8,
        );
        expect(mass - p.loadedMass).toBeCloseTo(
          fuel - p.massProperties.fuelKg,
          8,
        );
      }
  });
}

test("landing approaches and Needle Point retain their authored directions", () => {
  for (const short of [false, true]) {
    const p = new FlightPhysics();
    p.reset(true, short);
    const r = runways[Number(short)];
    expect(p.yaw).toBe(r.heading);
    expect(runwayLocal(p.position.x, p.position.z, r).z).toBeCloseTo(570, 6);
  }
  const p = new FlightPhysics();
  p.reset(false, true);
  expect(p.yaw).toBe(runways[1].heading);
});
