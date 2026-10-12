import { expect, test } from "bun:test";
import { BoxGeometry, Mesh } from "three";
import {
  AirframeEnvelope,
  traceAirflow,
  samplePath,
  wakeModel,
  displayVelocity,
} from "../lab/airflow";
import { solveWing, type WingGeometry } from "../lab/solver";
import { aircraftCatalog, type LabAircraftId } from "../lab/aircraft";
import { wingForAircraft } from "../lab/catalog";
import { loadGeometryOnly } from "../scripts/geometry-loader";

const conditions = { speed: 30, density: 1.225, alpha: 4 };
const wing: WingGeometry = {
  name: "Symmetric wing",
  revision: "test",
  assumptions: [],
  stations: [
    { x: 0, y: 0, leading: -0.25, chord: 1, zeroLiftAlpha: 0 },
    { x: 4, y: 0, leading: -0.25, chord: 1, zeroLiftAlpha: 0 },
  ],
};

test("mesh envelope identifies solid aircraft volume and continuous segment clearance", () => {
  const box = new Mesh(new BoxGeometry(2, 2, 4));
  const envelope = new AirframeEnvelope(box);
  expect(envelope.contains([0, 0, 0])).toBe(true);
  expect(envelope.contains([0, 1.5, 0])).toBe(false);
  expect(envelope.segmentClear([0, 0, -3], [0, 0, 3], 1)).toBe(false);
  expect(envelope.segmentClear([0, 1.5, -3], [0, 1.5, 3], 1)).toBe(true);
  const result = traceAirflow(solveWing(wing, conditions), envelope);
  expect(result.paths.length).toBeGreaterThan(60);
  const central = result.paths.find(
    (p) => !p.wake && Math.abs(p.points[0][0]) < 0.4 && p.points[0][1] > -1,
  )!;
  expect(central.points.some((p) => Math.abs(p[2]) < 1 && p[1] > 1.1)).toBe(
    true,
  );
  expect(result.direction).toContain("nose → tail");
});

test("wake pair strength reverses with lift and vanishes at zero circulation", () => {
  const positive = solveWing(wing, conditions),
    negative = solveWing(wing, { ...conditions, alpha: -4 });
  const zero = solveWing(wing, { ...conditions, alpha: 0 });
  const right = wakeModel(positive),
    left = wakeModel(negative);
  expect(right.gamma).toBeGreaterThan(0);
  expect(left.gamma).toBeCloseTo(-right.gamma, 8);
  expect(Math.abs(wakeModel(zero).gamma)).toBe(0);
  const z = right.trailing + 10,
    y = right.y + Math.tan((4 * Math.PI) / 180) * 10 - positive.cl * 0.035 * 10;
  const outsideRight = displayVelocity(positive, [right.x + 0.45, y, z]);
  const outsideLeft = displayVelocity(positive, [-right.x - 0.45, y, z]);
  expect(outsideRight[1]).toBeGreaterThan(positive.freestream[1]);
  expect(outsideLeft[1]).toBeCloseTo(outsideRight[1], 8);
  expect(displayVelocity(zero, [0, 0.5, z])).toEqual(zero.freestream);
});

for (const id of Object.keys(aircraftCatalog) as LabAircraftId[]) {
  test(`${id}: full-aircraft traces clear the actual mesh envelope and travel toward the downstream fan`, async () => {
    const config = aircraftCatalog[id];
    const { scene } = await loadGeometryOnly(
      new URL(`../public/assets/${config.asset}`, import.meta.url),
    );
    scene.scale.setScalar(config.scale);
    scene.position.y = config.offsetY;
    // The root transform is part of the aircraft placement; wrap it so the
    // envelope uses the same scaled body frame as the browser's model group.
    const { Group } = await import("three"),
      root = new Group();
    root.add(scene);
    const envelope = new AirframeEnvelope(root);
    for (const alpha of [-8, 4, 8]) {
      const result = traceAirflow(
        solveWing(wingForAircraft(id), { ...conditions, alpha }, 48),
        envelope,
      );
      expect(result.paths.length).toBeGreaterThan(65);
      expect(result.rejected).toBeLessThan(6);
      expect(result.checkedSegments).toBeGreaterThan(6000);
      const angle = (alpha * Math.PI) / 180;
      let allClear = true,
        downstream = true,
        finite = true,
        interpolatedClear = true;
      for (const path of result.paths) {
        for (let i = 1; i < path.points.length; i++) {
          const a = path.points[i - 1],
            b = path.points[i];
          allClear &&=
            !envelope.contains(a, 0.03) && !envelope.contains(b, 0.03);
          finite &&= b.every(Number.isFinite);
          downstream &&=
            (b[2] - a[2]) * Math.cos(angle) + (b[1] - a[1]) * Math.sin(angle) >
            0;
          // Either side's sufficient clearance certificate proves no crossing.
          allClear &&=
            envelope.segmentClear(a, b, 1, 0.03) ||
            envelope.segmentClear(a, b, -1, 0.03);
        }
        for (let d = 0.8; d < path.length; d += 0.4) {
          const head = samplePath(path, d),
            tail = samplePath(path, d - 0.11);
          interpolatedClear &&=
            envelope.segmentClear(head, tail, 1, 0.02) ||
            envelope.segmentClear(head, tail, -1, 0.02);
        }
        expect(samplePath(path, 0)).toEqual(path.points[0]);
        expect(samplePath(path, path.length)).toEqual(path.points.at(-1)!);
      }
      expect(allClear).toBe(true);
      expect(interpolatedClear).toBe(true);
      expect(downstream).toBe(true);
      expect(finite).toBe(true);
    }
  }, 30000);
}
