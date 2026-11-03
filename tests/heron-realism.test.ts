import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Quaternion, Vector3 } from "three";
import { cachedSolveWing, solveWing, type WingGeometry } from "../lab/solver";
import { wingForAircraft } from "../lab/catalog";
import {
  aircraftDesign,
  massProperties,
} from "../src/aircraft/aircraft-design";
import calibrated from "../src/aircraft/heron/aerodynamics.json";
import fuel from "../src/aircraft/heron/fuel-geometry.json";
import { solveTrim } from "../src/flight/flight-trim";
import { FlightPhysics } from "../src/flight/physics";
import { loadGeometryOnly } from "../scripts/geometry-loader";

const conditions = { speed: 65, density: 1.225, alpha: 4 };
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };

test("wing incidence has the physical sign, shifts zero lift and invalidates the solve cache", () => {
  const flat: WingGeometry = {
    name: "Incidence benchmark",
    revision: "same-source",
    assumptions: [],
    stations: [0, 4].map((x) => ({
      x,
      y: 0,
      leading: -0.25,
      chord: 1,
      zeroLiftAlpha: 0,
    })),
  };
  const pitched = {
    ...flat,
    stations: flat.stations.map((s) => ({ ...s, incidence: 2.5 })),
  };
  expect(solveWing(pitched, { ...conditions, alpha: -2.5 }).cl).toBeCloseTo(
    0,
    10,
  );
  const zero = { ...conditions, alpha: 0 };
  expect(cachedSolveWing(pitched, zero).cl).toBeGreaterThan(
    cachedSolveWing(flat, zero).cl + 0.15,
  );
  const expected = solveWing(flat, { ...conditions, alpha: 2.5 }).cl;
  expect(Math.abs(solveWing(pitched, zero).cl / expected - 1)).toBeLessThan(
    0.02,
  );
  pitched.stations.forEach((s) => {
    s.incidence = 0;
  });
  expect(cachedSolveWing(pitched, zero).cl).toBeCloseTo(0, 10);
  expect(() =>
    solveWing(
      {
        ...flat,
        stations: flat.stations.map((s) => ({ ...s, incidence: NaN })),
      },
      zero,
    ),
  ).toThrow();
});

test("Heron runtime lift includes the measured incidence and washout exactly once", () => {
  const d = aircraftDesign("heron"),
    wing = wingForAircraft("heron");
  const zero = solveWing(wing, { ...conditions, alpha: 0 }, 96),
    four = solveWing(wing, conditions, 96);
  expect(calibrated.geometryRevision).toBe(wing.revision);
  expect(d.geometry.incidence).toBe(0);
  expect(wing.stations[0].incidence).toBe(2.5);
  expect(wing.stations.at(-1)!.incidence).toBe(0);
  expect(d.geometry.wingArea).toBeCloseTo(four.area, 8);
  expect(d.aerodynamics.cl0).toBeCloseTo(zero.cl, 10);
  expect(d.aerodynamics.cd0 * d.geometry.wingArea).toBeCloseTo(
    0.036 * 31.6804,
    8,
  );
  expect(d.aerodynamics.liftSlope).toBeCloseTo(
    (four.cl - zero.cl) / ((4 * Math.PI) / 180),
    10,
  );
  const finer = solveWing(wing, conditions, 144);
  expect(Math.abs(finer.lift / four.lift - 1)).toBeLessThan(0.005);
  expect(Math.abs(finer.inducedDrag / four.inducedDrag - 1)).toBeLessThan(
    0.005,
  );
});

test("washout reduces outer-wing section loading at the same total lift coefficient", () => {
  const wing = wingForAircraft("heron");
  const untwisted: WingGeometry = {
    ...wing,
    stations: wing.stations.map((s) => ({ ...s, incidence: 2.5 })),
  };
  function outerPeak(g: WingGeometry) {
    let low = -8,
      high = 8;
    for (let i = 0; i < 16; i++) {
      const alpha = (low + high) / 2;
      if (solveWing(g, { ...conditions, alpha }, 96).cl < 0.7) low = alpha;
      else high = alpha;
    }
    const solved = solveWing(g, { ...conditions, alpha: (low + high) / 2 }, 96);
    expect(solved.cl).toBeCloseTo(0.7, 3);
    return Math.max(
      ...solved.panels
        .filter((p) => Math.abs(p.x) > 4.86 && Math.abs(p.x) < 7.45)
        .map((p) => p.liftPerSpan / (solved.dynamicPressure * p.chord)),
    );
  }
  expect(outerPeak(wing)).toBeLessThan(outerPeak(untwisted) * 0.98);
});

test("game wing controls rotate around the actual swept and inclined CAD hinges", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/heron-ut9.glb", import.meta.url),
  );
  const data = await Bun.file(
    new URL("../assets/heron/GLB/cad-transfer.json", import.meta.url),
  ).json();
  scene.updateMatrixWorld(true);
  for (const name of [
    "Flap_Left",
    "Flap_Right",
    "Aileron_Left",
    "Aileron_Right",
  ]) {
    const node = scene.getObjectByName(name)!;
    const expected = new Vector3(...data.hingeAxes[name]).normalize();
    const axis = new Vector3(1, 0, 0).applyQuaternion(
      node.getWorldQuaternion(new Quaternion()),
    );
    expect(axis.distanceTo(expected)).toBeLessThan(1e-6);
    // The visible wing sits further aft than the CAD wing; see scripts/build-heron-skin.py.
    const origin = new Vector3(...data.hinges[name]).add(new Vector3(0, 0, 1.25));
    expect(node.userData.hinge).toEqual(origin.toArray());
    expect(
      node.getWorldPosition(new Vector3()).distanceTo(origin),
    ).toBeLessThan(1e-5);
    const end = node.localToWorld(new Vector3(1, 0, 0));
    node.rotation.x = 0.5;
    scene.updateMatrixWorld(true);
    expect(
      node.localToWorld(new Vector3(1, 0, 0)).distanceTo(end),
    ).toBeLessThan(1e-6);
  }
});

test("fuel cells match the current CAD and their settled fuel moves inboard as level falls", async () => {
  const source = await Bun.file(
    new URL("../assets/heron/src/heron.py", import.meta.url),
  ).text();
  expect(fuel.sourceSha256).toBe(
    createHash("sha256").update(source).digest("hex"),
  );
  expect(fuel.enclosedByWing).toBe(true);
  expect(fuel.usableFuelKg).toBeGreaterThan(1000);
  expect(fuel.usableFuelKg).toBeLessThan(1100);
  const [left, right] = fuel.tanks;
  for (const tank of fuel.tanks) {
    expect(
      Math.abs(tank.envelopeLitres / tank.exactEnvelopeLitres - 1),
    ).toBeLessThan(0.001);
    const capacity =
      tank.usableLitres +
      tank.unusableLitres +
      tank.expansionLitres +
      tank.displacementLitres;
    expect(capacity).toBeCloseTo(tank.envelopeLitres, 5);
    expect(Math.abs(tank.samples[1].center[0])).toBeLessThan(
      Math.abs(tank.samples.at(-1)!.center[0]),
    );
    for (let i = 1; i < tank.samples.length; i++)
      expect(tank.samples[i].level).toBeGreaterThan(tank.samples[i - 1].level);
  }
  for (let i = 0; i < left.samples.length; i++) {
    expect(left.samples[i].center[0]).toBeCloseTo(
      -right.samples[i].center[0],
      6,
    );
    expect(left.samples[i].center[1]).toBeCloseTo(
      right.samples[i].center[1],
      6,
    );
    expect(left.samples[i].center[2]).toBeCloseTo(
      right.samples[i].center[2],
      6,
    );
  }
});

test("Heron loadings stay ahead of the estimated neutral point and trim within control authority", () => {
  const d = aircraftDesign("heron");
  for (const fuel of [0, 0.25, 0.65, 1])
    for (const payload of [0, 0.5, 1]) {
      const balance = massProperties(d.massBudget, { fuel, payload });
      expect(
        (d.neutralPointZ - balance.cg.z) / d.geometry.meanAerodynamicChord,
      ).toBeGreaterThan(0.03);
      expect(balance.inertia.determinant()).toBeGreaterThan(0);
      for (const speed of [55, 65, 75]) {
        const trim = solveTrim(d, balance, speed, 600, 1);
        expect(trim.forceResidual).toBeLessThan(1e-6);
        expect(trim.momentResidual).toBeLessThan(1e-6);
        expect(Math.abs(trim.pitch)).toBeLessThan(0.7);
      }
    }
  expect(d.nominal.mass).toBeLessThan(d.maxTakeoffMass);
  // Full tanks plus the entire payload allowance is intentionally overweight.
  expect(
    massProperties(d.massBudget, { fuel: 1, payload: 1 }).mass,
  ).toBeGreaterThan(d.maxTakeoffMass);
});

test("the revised Heron sustains trimmed flight with beginner assistance disabled", () => {
  const p = new FlightPhysics();
  p.aircraftId = "heron";
  p.reset(true);
  p.position.set(0, 600, 700);
  p.windOverride = new Vector3();
  p.wind.set(0, 0, 0);
  p.initializeAirStart(65);
  p.beginnerAssist = false;
  for (let n = 0; n < 1200; n++) p.step(1 / 60, neutral);
  expect(Math.abs(p.position.y - 600)).toBeLessThan(0.5);
  expect(Math.abs(p.airspeed - 65)).toBeLessThan(0.1);
  expect(p.crashed).toBe(false);
  expect(p.health).toBe(100);
  expect(p.gearPosition).toBe(1);
});
