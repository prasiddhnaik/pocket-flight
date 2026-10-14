import { expect, test } from "bun:test";
import { aircraftSystems, hydraulicPumpWatts } from "../src/aircraft-systems";
import { aircraftDesign } from "../src/aircraft-design";

test("Every aircraft has its own installed hardware and sufficient conceptual electrical capacity", () => {
  expect(new Set(Object.values(aircraftSystems).map((s) => s.model)).size).toBe(
    4,
  );
  for (const s of Object.values(aircraftSystems)) {
    expect(s.generatorCount * s.generatorWatts).toBeGreaterThan(s.peakWatts);
    expect(s.generatorWatts).toBeGreaterThan(s.essentialWatts);
    expect(s.batteryVolts).toBeLessThan(s.busVolts);
  }
  expect(hydraulicPumpWatts("finch")).toBe(0);
  expect(hydraulicPumpWatts("aurelia")).toBeCloseTo(3234.375, 8);
  expect(hydraulicPumpWatts("stormbird")).toBeGreaterThan(
    hydraulicPumpWatts("peregrine"),
  );
});

test("Propulsion ratings remain specific to each aircraft, rather than sharing a generic power map", () => {
  expect(aircraftDesign("finch").propulsion.shaftPower).toBe(135000);
  expect(
    (["aurelia", "peregrine", "stormbird"] as const).map(
      (id) => aircraftDesign(id).propulsion.dryThrust,
    ),
  ).toEqual([50000, 62000, 85000]);
});
