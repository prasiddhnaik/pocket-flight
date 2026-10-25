import { expect, test } from "bun:test";
import * as T from "three";
import {
  belowLevel,
  fuelTable,
  inertiaPerKg,
  volumeProperties,
  type Triangles,
} from "../scripts/fuel-volume";
import { aircraftDesign, massProperties } from "../src/aircraft/aircraft-design";
import { consumeTankFuel, tankState } from "../src/flight/fuel-loading";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { connectedSurfaces } from "../scripts/geometry-components";
import { runtimeAircraftCatalog as aircraftCatalog } from "../lab/aircraft";
import { loadingSnapshot, validateLoading } from "../lab/loading-validation";
import { aircraftAerodynamics } from "../src/flight/aerodynamics";
import { solveTrim } from "../src/flight/flight-trim";
import { FlightPhysics } from "../src/flight/physics";

function box(w: number, h: number, l: number, center = new T.Vector3()) {
  const g = new T.BoxGeometry(w, h, l).toNonIndexed(),
    p = g.getAttribute("position"),
    triangles: Triangles = [];
  for (let i = 0; i < p.count; i += 3)
    triangles.push(
      [0, 1, 2].map((j) =>
        new T.Vector3().fromBufferAttribute(p, i + j).add(center),
      ),
    );
  g.dispose();
  return triangles;
}
test("fluid volume, translated centroid and tensor agree with an analytic box", () => {
  const center = new T.Vector3(3, -2, 5),
    triangles = box(2, 2, 4, center),
    full = volumeProperties(triangles);
  expect(full.volume).toBeCloseTo(16, 10);
  full.center.forEach((n, i) =>
    expect(n).toBeCloseTo(center.getComponent(i), 10),
  );
  const inertia = inertiaPerKg(full.center, full.second);
  expect(inertia[0]).toBeCloseTo(20 / 12, 10);
  expect(inertia[4]).toBeCloseTo(20 / 12, 10);
  expect(inertia[8]).toBeCloseTo(8 / 12, 10);
  const half = volumeProperties(belowLevel(triangles, -2));
  expect(half.volume).toBeCloseTo(8, 10);
  expect(half.center[1]).toBeCloseTo(-2.5, 10);
  expect(volumeProperties(belowLevel(triangles, -4)).volume).toBe(0);
});
test("capacity reserves reconcile; usable fuel moments exclude the fixed residual heel", () => {
  const t = fuelTable(box(2, 2, 4));
  expect(t.envelopeLitres).toBeCloseTo(16000, 6);
  expect(t.expansionLitres).toBeCloseTo(
    (t.usableLitres + t.unusableLitres) * 0.02,
    5,
  );
  expect(
    t.displacementLitres +
      t.expansionLitres +
      t.unusableLitres +
      t.usableLitres,
  ).toBeCloseTo(16000, 4);
  const fraction = 0.5,
    s = t.samples[16],
    heelHeight = (2 / 1.02) * 0.03,
    usableHeight = (2 / 1.02) * 0.97 * fraction;
  expect(s.level).toBeCloseTo(-1 + heelHeight + usableHeight, 6);
  expect(s.center[1]).toBeCloseTo(-1 + heelHeight + usableHeight / 2, 6);
  expect(s.inertiaPerKg[0]).toBeCloseTo((usableHeight ** 2 + 16) / 12, 5);
  expect(() =>
    tankState({ ...aircraftDesign("finch").fuel.tanks[0] }, NaN),
  ).toThrow();
});
for (const id of ["finch", "peregrine", "aurelia", "stormbird"] as const) {
  test(`${id}: mass allocation, usable capacity and residual accounting conserve the budget`, async () => {
    const d = aircraftDesign(id),
      empty = massProperties(d.massBudget, { fuel: 0, payload: 0 }),
      full = massProperties(d.massBudget, { fuel: 1, payload: 0 });
    expect(empty.mass).toBeCloseTo(d.fuel.emptyMassIncludingResidual, 8);
    expect(full.mass - empty.mass).toBeCloseTo(d.fuel.usableFuelKg, 8);
    expect(empty.fuelKg).toBe(0);
    expect(empty.unusableFuelKg).toBeCloseTo(d.fuel.unusableFuelKg, 8);
    expect(loadingSnapshot(id, d.defaultLoading).massAllowed).toBe(true);
    expect(loadingSnapshot(id, d.defaultLoading).cgAllowed).toBe(true);
    const { sha256 } = await loadGeometryOnly(
      new URL(`../public/assets/${aircraftCatalog[id].asset}`, import.meta.url),
    );
    expect(sha256).toBe(d.fuel.assetRevision);
    for (let n = 0; n <= 100; n++) {
      const m = massProperties(d.massBudget, { fuel: n / 100, payload: 1 });
      expect(m.inertia.determinant()).toBeGreaterThan(0);
      for (const t of d.fuel.tanks)
        expect(m.fuelByTank[t.id]).toBeLessThanOrEqual(
          t.usableLitres * t.densityKgPerLitre + 1e-8,
        );
    }
  }, 30000);
  test(`${id}: burn order conserves fuel and respects centre-first / paired-wing logic`, () => {
    const tanks = aircraftDesign(id).fuel.tanks,
      full = Object.fromEntries(
        tanks.map((t) => [t.id, t.usableLitres * t.densityKgPerLitre]),
      );
    const next = consumeTankFuel(tanks, full, 10);
    expect(
      Object.values(full).reduce((s, v) => s + v, 0) -
        Object.values(next).reduce((s, v) => s + v, 0),
    ).toBeCloseTo(10, 8);
    if (next.centre !== undefined) {
      expect(full.centre - next.centre).toBeCloseTo(10, 8);
      expect(next.left).toBe(full.left);
      expect(next.right).toBe(full.right);
    } else if (next.left !== undefined)
      expect(next.left / full.left).toBeCloseTo(next.right / full.right, 10);
    expect(
      Object.values(consumeTankFuel(tanks, full, 1e10)).every((n) => n === 0),
    ).toBe(true);
    expect(() => consumeTankFuel(tanks, full, -1)).toThrow();
  });
  test(`${id}: the private tester runs coupled mass, engine-out and zero-fuel checks`, () => {
    const result = validateLoading(id);
    for (const c of result.checks) expect(c.pass, c.name).toBe(true);
    expect(
      result.powered.before.mass - result.powered.after.mass,
    ).toBeGreaterThan(0);
    expect(result.cutoff.remainingMass).toBeCloseTo(
      massProperties(aircraftDesign(id).massBudget, { fuel: 0, payload: 1 })
        .mass,
      7,
    );
  });
  test(`${id}: resetting a different aircraft selects its dispatch loading`, () => {
    const p = new FlightPhysics();
    p.reset();
    p.aircraftId = id;
    p.reset();
    expect(p.fuelKg).toBeCloseTo(aircraftDesign(id).nominal.fuelKg, 8);
    expect(p.loadedMass).toBeCloseTo(aircraftDesign(id).nominal.mass, 8);
  });
}
test("imbalanced wing fuel changes lateral CG, roll torque and trim control", () => {
  const d = aircraftDesign("peregrine"),
    right = massProperties(d.massBudget, {
      fuel: 1,
      payload: 1,
      tanks: { left: 0, right: 1, centre: 0 },
    }),
    left = massProperties(d.massBudget, {
      fuel: 1,
      payload: 1,
      tanks: { left: 1, right: 0, centre: 0 },
    });
  expect(right.cg.x).toBeGreaterThan(0.1);
  expect(left.cg.x).toBeLessThan(-0.1);
  const sample = (cg: T.Vector3) =>
    aircraftAerodynamics(
      d,
      new T.Vector3(0, 0, -80),
      new T.Vector3(),
      new T.Quaternion().setFromEuler(new T.Euler(0.1, 0, 0)),
      1000,
      cg,
      new T.Vector3(),
    );
  expect(sample(right.cg).moment.z).toBeLessThan(sample(left.cg).moment.z);
  const t = solveTrim(d, right, 80, 1000);
  expect(t.roll).toBeLessThan(0);
  expect(t.forceResidual).toBeLessThan(1e-6);
  expect(t.momentResidual).toBeLessThan(1e-6);
});
test("unsafe and overweight fuel/payload cases stay explicitly rejected", () => {
  for (const id of ["finch", "peregrine", "stormbird"] as const)
    expect(loadingSnapshot(id, { fuel: 1, payload: 1 }).massAllowed).toBe(
      false,
    );
  expect(loadingSnapshot("aurelia", { fuel: 1, payload: 0 }).cgAllowed).toBe(
    true,
  );
  expect(loadingSnapshot("stormbird", { fuel: 1, payload: 0 }).cgAllowed).toBe(
    false,
  );
});
test("Aurelia original wing titanium has only a flush fuel cap, with exposed barrels removed", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-flight.glb", import.meta.url),
  );
  scene.updateWorldMatrix(true, true);
  for (const side of ["Left", "Right"]) {
    const mesh = scene.getObjectByName(
      `Wing_${side}_|_Machined_titanium`,
    ) as T.Mesh;
    const components = connectedSurfaces(mesh);
    expect(components).toHaveLength(1);
    expect(components[0].triangles).toHaveLength(64);
    expect(components[0].bounds.getSize(new T.Vector3()).y).toBeLessThan(0.025);
  }
});
