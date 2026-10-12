import { expect, test } from "bun:test";
import { validateAircraft } from "../lab/validation";
import {
  interpolate,
  pistonPowerFactor,
  referenceJetThrust,
  localSoundSpeed,
} from "../src/engine-map";
import { aircraftDesign } from "../src/aircraft-design";
import { airDensity, aircraftThrust } from "../src/aerodynamics";

test("primary reference anchors preserve units, grid orientation and interpolation", () => {
  // Independent spot checks against PDF Table VI(a) and Lycoming p.8-4.
  expect(referenceJetThrust(0.2, 0)).toBe(56401);
  expect(referenceJetThrust(0.8, 6096)).toBe(34472);
  expect(referenceJetThrust(0.6, 9144, true)).toBe(41300);
  expect(referenceJetThrust(1, 15240, true)).toBe(22494);
  expect(referenceJetThrust(0.3, 1524)).toBeCloseTo(
    (56401 + 40699 + 56089 + 41420) / 4,
    8,
  );
  expect(pistonPowerFactor(5000 * 0.3048)).toBe(0.846);
  expect(pistonPowerFactor(15000 * 0.3048)).toBeCloseTo(0.587, 12);
  expect(pistonPowerFactor(22500 * 0.3048)).toBe(0.434);
  expect(interpolate([0, 1, 2], [0, 10, 30], 1.5)).toBe(20);
  expect(referenceJetThrust(0, 0)).toBe(56401); // Explicit low-Mach hold.
});
for (const id of ["finch", "peregrine", "aurelia", "stormbird"] as const) {
  test(`${id}: bench checks stall, loaded static stability and unassisted disturbance decay`, () => {
    const r = validateAircraft(id);
    expect(r.polars).toHaveLength(2);
    for (const p of r.polars) {
      expect(
        p.rows.every(
          (x) =>
            [x.cl, x.cd, x.cm, x.controlEffectiveness].every(Number.isFinite) &&
            x.cd > 0,
        ),
      ).toBe(true);
      const peak = Math.max(...p.rows.map((x) => x.cl));
      const high = p.rows.find((x) => x.alpha === 45)!;
      expect(high.cl).toBeLessThan(peak);
      expect(high.stalled).toBe(true);
      expect(high.controlEffectiveness).toBeLessThan(0.8);
      const attached = p.rows.find((x) => x.alpha === 5)!;
      expect(attached.cl).toBeCloseTo(
        aircraftDesign(id).aerodynamics.cl0 +
          aircraftDesign(id).aerodynamics.flapLift * p.flap +
          (aircraftDesign(id).aerodynamics.liftSlope * 5 * Math.PI) / 180,
        8,
      );
    }
    for (const c of r.cgChecks) {
      expect(c.cmAlpha).toBeLessThan(0);
      expect(c.cmQ).toBeLessThan(0);
      expect(c.staticMargin).toBeGreaterThan(0.03);
    }
    for (const d of r.disturbances) {
      expect(d.bounded).toBe(true);
      expect(d.ratio).toBeLessThan(0.25);
    }
    for (const s of r.stalls) {
      expect(s.entry).toBe(true);
      expect(s.recoveryTime).not.toBeNull();
      expect(s.health).toBe(100);
    }
    for (const s of r.poweredRecoveries) {
      expect(s.entry).toBe(true);
      expect(s.stalledAtEnd).toBe(false);
      expect(s.terminalStallFreeSeconds).toBeGreaterThan(2);
      expect(s.health).toBe(100);
      expect(s.lossOfHeight).toBeLessThan(200);
      expect(s.maximumHeight).toBeLessThan(1750);
    }
    for (const s of r.stallSpeeds) {
      expect(s.twoG / s.clean).toBeCloseTo(Math.sqrt(2), 9);
      expect(s.flapped).toBeLessThan(s.clean);
    }
  });
  test(`${id}: engine map is finite, monotonic with command and altitude, with explicit cutoff`, () => {
    const d = aircraftDesign(id);
    for (const height of [0, 1000, 3000, 6000])
      for (const mach of [0, 0.1, 0.2, 0.4, 0.6, 0.8]) {
        let previous = 0;
        for (let i = 0; i <= 100; i++) {
          const thrust = aircraftThrust(
            d,
            mach * localSoundSpeed(height),
            i / 100,
            airDensity(height),
            height,
          );
          expect(Number.isFinite(thrust)).toBe(true);
          expect(thrust).toBeGreaterThanOrEqual(previous);
          previous = thrust;
        }
        expect(aircraftThrust(d, 40, 0, airDensity(height), height)).toBe(0);
      }
    expect(aircraftThrust(d, 70, 1, airDensity(3000), 3000)).toBeLessThan(
      aircraftThrust(d, 70, 1, 1.225, 0),
    );
    if (id === "peregrine" || id === "stormbird") {
      expect(aircraftThrust(d, 0.2 * localSoundSpeed(0), 0.88, 1.225, 0)).toBe(
        d.propulsion.dryThrust,
      );
      expect(aircraftThrust(d, 0.2 * localSoundSpeed(0), 1, 1.225, 0)).toBe(
        d.propulsion.afterburningThrust,
      );
    }
  });
}
