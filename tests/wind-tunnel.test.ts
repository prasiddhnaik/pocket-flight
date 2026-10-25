import { expect, test } from "bun:test";
import { solveWing, velocityAt, SOLVER_VERSION, type WingGeometry } from "../lab/solver";
import { finchWing } from "../lab/finch-wing";
import {
  runSweep,
  convergenceCheck,
  exportCSV,
  experimentRecord,
} from "../lab/experiments";
import { aircraftCatalog } from "../lab/aircraft";
import { fleetMeasurements, wingForAircraft } from "../lab/catalog";

const rectangle: WingGeometry = {
  name: "Rectangular benchmark",
  revision: "test",
  assumptions: ["Flat symmetric section"],
  stations: [
    { x: 0, y: 0, leading: -0.25, chord: 1, zeroLiftAlpha: 0 },
    { x: 4, y: 0, leading: -0.25, chord: 1, zeroLiftAlpha: 0 },
  ],
};
const conditions = { speed: 30, density: 1.225, alpha: 4 };
const ellipse: WingGeometry = {
  ...rectangle,
  name: "Elliptical AR 8 benchmark",
  stations: Array.from({ length: 81 }, (_, i) => {
    const x = (4 * i) / 80,
      chord = Math.max(0.001, (4 / Math.PI) * Math.sqrt(1 - (x / 4) ** 2));
    return { x, y: 0, leading: -chord / 4, chord, zeroLiftAlpha: 0 };
  }),
};

test("flat symmetric wing has zero lift at zero angle, correct signs and symmetric loading", () => {
  expect(solveWing(rectangle, { ...conditions, alpha: 0 }, 48).cl).toBeCloseTo(
    0,
    10,
  );
  const positive = solveWing(rectangle, conditions, 48);
  const negative = solveWing(rectangle, { ...conditions, alpha: -4 }, 48);
  expect(positive.cl).toBeGreaterThan(0);
  expect(negative.cl).toBeCloseTo(-positive.cl, 9);
  expect(positive.cdi).toBeGreaterThan(0);
  expect(negative.cdi).toBeCloseTo(positive.cdi, 9);
  for (let i = 0; i < positive.panels.length; i++)
    expect(positive.panels[i].gamma).toBeCloseTo(
      positive.panels.at(-1 - i)!.gamma,
      8,
    );
  expect(positive.residual).toBeLessThan(1e-10);
});

test("elliptical wing approaches finite-wing lift slope and near-ideal induced drag", () => {
  const result = solveWing(ellipse, conditions, 96);
  const theoreticalSlope = (2 * Math.PI) / (1 + 2 / result.aspectRatio);
  expect(
    Math.abs(
      result.cl / ((conditions.alpha * Math.PI) / 180) / theoreticalSlope - 1,
    ),
  ).toBeLessThan(0.08);
  const idealCDi = result.cl ** 2 / (Math.PI * result.aspectRatio);
  expect(result.cdi / idealCDi).toBeGreaterThan(0.96);
  expect(result.cdi / idealCDi).toBeLessThan(1.08);
  const coarse = solveWing(ellipse, conditions, 24);
  const medium = solveWing(ellipse, conditions, 48);
  expect(Math.abs(result.cl - medium.cl)).toBeLessThan(
    Math.abs(medium.cl - coarse.cl),
  );
});

test("forces scale with density and speed squared while coefficients remain invariant", () => {
  const base = solveWing(rectangle, conditions);
  const fast = solveWing(rectangle, { ...conditions, speed: 60 });
  const dense = solveWing(rectangle, { ...conditions, density: 0.8 });
  expect(fast.lift / base.lift).toBeCloseTo(4, 8);
  expect(fast.inducedDrag / base.inducedDrag).toBeCloseTo(4, 8);
  expect(fast.cl).toBeCloseTo(base.cl, 10);
  expect(dense.lift / base.lift).toBeCloseTo(0.8 / 1.225, 8);
  expect(dense.cdi).toBeCloseTo(base.cdi, 10);
});

test("computed vortex field creates downwash and vanishes far from the wing", () => {
  const result = solveWing(rectangle, conditions);
  const near = velocityAt(result, [0.2, 0.5, 2]);
  const far = velocityAt(result, [1000, 1000, -1000]);
  expect(near[1]).toBeLessThan(
    conditions.speed * Math.sin((conditions.alpha * Math.PI) / 180),
  );
  expect(
    Math.hypot(...far.map((v, i) => v - result.freestream[i])),
  ).toBeLessThan(0.001);
  expect(velocityAt(result, result.panels[0].a).every(Number.isFinite)).toBe(
    true,
  );
});

test("invalid conditions and geometry produce explicit errors", () => {
  for (const bad of [
    { speed: 0 },
    { speed: NaN },
    { density: -1 },
    { alpha: 16 },
  ])
    expect(() => solveWing(rectangle, { ...conditions, ...bad })).toThrow();
  expect(() => solveWing(rectangle, conditions, 3)).toThrow();
  expect(() => solveWing({ ...rectangle, stations: [] }, conditions)).toThrow();
  expect(() =>
    solveWing(
      {
        ...rectangle,
        stations: [
          { ...rectangle.stations[0], chord: -1 },
          rectangle.stations[1],
        ],
      },
      conditions,
    ),
  ).toThrow();
});

test("Finch analysis area and span match the measured export and converge with panel count", () => {
  const result = solveWing(finchWing, conditions, 96);
  expect(result.span).toBeCloseTo(10.98, 2);
  expect(Math.abs(result.area / 16.124544 - 1)).toBeLessThan(0.001);
  expect(finchWing.revision).toMatch(/^[a-f0-9]{64}$/);
  const convergence = convergenceCheck(finchWing, conditions);
  expect(convergence.rows.map((r) => r.panelCount)).toEqual([24, 48, 96, 144]);
  expect(convergence.liftChangePercent).toBeLessThan(1);
  expect(convergence.dragChangePercent).toBeLessThan(1);
});

test("sweeps and exports retain conditions, units, model assumptions and geometry revision", () => {
  const sweep = runSweep(rectangle, conditions, {
    min: -4,
    max: 4,
    step: 2,
    panelCount: 48,
  });
  expect(sweep.map((s) => s.conditions.alpha)).toEqual([-4, -2, 0, 2, 4]);
  expect(sweep[0].cl).toBeCloseTo(-sweep.at(-1)!.cl, 10);
  const record = experimentRecord(sweep);
  expect(record.geometryRevision).toBe(rectangle.revision);
  expect(record.assumptions).toContain("Flat symmetric section");
  expect(record.units.lift).toBe("N");
  expect(record.results[0].conditions.speed).toBe(30);
  expect(record.results[0].spanLoading).toHaveLength(48);
  const csv = exportCSV(sweep);
  expect(csv).toContain(
    "alpha_deg,speed_m_s,density_kg_m3,CL,CDi,lift_N,induced_drag_N",
  );
  expect(csv).toContain(SOLVER_VERSION);
  expect(csv).toContain("geometry_revision,test");
  expect(csv).toContain("Flat symmetric section");
  expect(() =>
    runSweep(rectangle, conditions, {
      min: 4,
      max: -4,
      step: 1,
      panelCount: 48,
    }),
  ).toThrow();
  expect(() =>
    runSweep(rectangle, conditions, {
      min: -8,
      max: 8,
      step: 0,
      panelCount: 48,
    }),
  ).toThrow();
});

test("all six aircraft have independent lab geometry and valid numerical results", () => {
  expect(fleetMeasurements.map((m) => m.id)).toEqual([
    "finch",
    "peregrine",
    "aurelia",
    "stormbird",
    "heron",
    "f15c",
  ]);
  const revisions = new Set<string>();
  for (const id of Object.keys(
    aircraftCatalog,
  ) as (keyof typeof aircraftCatalog)[]) {
    const wing = wingForAircraft(id),
      result = solveWing(wing, conditions, 96);
    const measured = fleetMeasurements.find((m) => m.id === id)!;
    expect(wing.revision).toMatch(/^[a-f0-9]{64}$/);
    revisions.add(wing.revision);
    const span = "mainWingSpan" in measured ? measured.mainWingSpan : measured.dimensions[0];
    expect(Math.abs(result.span - span)).toBeLessThan(0.04);
    expect(result.cl).toBeGreaterThan(0.15);
    expect(result.cdi).toBeGreaterThan(0);
    expect(result.residual).toBeLessThan(1e-10);
    expect(measured.maxChordAsymmetry).toBeLessThan(0.001);
    expect(measured.scale).toBe(aircraftCatalog[id].scale);
    expect(measured.offsetY).toBe(aircraftCatalog[id].offsetY);
  }
  expect(revisions.size).toBe(6);
  expect(solveWing(wingForAircraft("stormbird"), conditions).area).toBeCloseTo(
    55.3605,
    3,
  );
});
