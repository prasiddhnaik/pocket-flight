import { expect, test } from "bun:test";
import { aircraftDesign, massProperties } from "../src/aircraft-design";
import { loadingSnapshot, validateLoading } from "../lab/loading-validation";

// Empty-cabin operation must not rely on passengers as forward ballast.
test("Aurelia retains its mass and neutral point while empty cabin stays inside the aft limit throughout fuel burn", () => {
  const d = aircraftDesign("aurelia");
  expect(d.neutralPointZ).toBeCloseTo(0.46602812381625445, 10);
  expect(d.fuel.emptyMassIncludingResidual).toBeCloseTo(3939.9608087726685, 7);
  for (let i = 0; i <= 100; i++) {
    const s = loadingSnapshot("aurelia", { fuel: i / 100, payload: 0 });
    expect(s.cgAllowed, `fuel ${i}%`).toBe(true);
    expect(s.staticMargin).toBeGreaterThan(0.03);
    expect(s.trim).not.toBeNull();
  }
});
test("Aurelia full cabin and pilot-only cases keep positive inertia and trimmable loading", () => {
  const d = aircraftDesign("aurelia");
  for (const fuel of [0, 0.1, 0.5, 1])
    for (const payload of [0.2, 1]) {
      const m = massProperties(d.massBudget, { fuel, payload }),
        s = loadingSnapshot("aurelia", { fuel, payload });
      expect(m.inertia.determinant()).toBeGreaterThan(0);
      expect(s.cgAllowed).toBe(true);
      expect(s.trim).not.toBeNull();
    }
});

test("Aurelia empty cabin completes low-fuel and full-fuel flight in the private integrator bench", () => {
  const result = validateLoading("aurelia");
  expect(result.emptyCabin).toHaveLength(2);
  for (const c of result.emptyCabin) {
    expect(c.cgAllowed).toBe(true);
    expect(c.staticMargin).toBeGreaterThan(0.03);
    expect(c.health).toBe(100);
    expect(c.stalled).toBe(false);
    expect(Math.abs(c.height - 1000)).toBeLessThan(10);
  }
  expect(result.checks.every((c) => c.pass)).toBe(true);
});
