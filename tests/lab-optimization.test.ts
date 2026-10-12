import { expect, test } from "bun:test";
import * as T from "three";
import { batchStaticMeshes } from "../lab/render-batching";
import { cachedSolveWing, solveWing } from "../lab/solver";
import { wingForAircraft } from "../lab/catalog";
import { aircraftCatalog, type LabAircraftId } from "../lab/aircraft";
import { AirframeEnvelope, samplePath, traceAirflow } from "../lab/airflow";
import { loadGeometryOnly } from "../scripts/geometry-loader";

test("cached linear solutions match fresh solves throughout the supported speed and density range", () => {
  for (const id of Object.keys(aircraftCatalog) as LabAircraftId[]) {
    const wing = wingForAircraft(id);
    for (const alpha of [-8, 0, 8])
      for (const speed of [5, 30, 80])
        for (const density of [0.5, 1.4]) {
          const conditions = { alpha, speed, density };
          const cached = cachedSolveWing(wing, conditions, 48),
            direct = solveWing(wing, conditions, 48);
          expect(cached.cl).toBeCloseTo(direct.cl, 10);
          expect(cached.cdi).toBeCloseTo(direct.cdi, 10);
          expect(cached.lift).toBeCloseTo(direct.lift, 6);
          expect(cached.inducedDrag).toBeCloseTo(direct.inducedDrag, 6);
          for (let i = 0; i < 3; i++)
            expect(cached.freestream[i]).toBeCloseTo(direct.freestream[i], 12);
          for (let i = 0; i < cached.panels.length; i++)
            expect(cached.panels[i].gamma).toBeCloseTo(
              direct.panels[i].gamma,
              8,
            );
        }
    expect(() =>
      cachedSolveWing(wing, { alpha: 9, speed: 30, density: 1.225 }),
    ).toThrow();
    const first = cachedSolveWing(wing, {
      alpha: 4,
      speed: 30,
      density: 1.225,
    });
    first.panels[0].a[0] = 999;
    expect(cachedSolveWing(wing, first.conditions).panels[0].a[0]).not.toBe(
      999,
    );
  }
});

test("static batching preserves world geometry, glazing, movable hardware and wing filtering", () => {
  const root = new T.Group();
  root.position.set(3, 5, -2);
  const paint = new T.MeshStandardMaterial(),
    glass = new T.MeshStandardMaterial({ transparent: true });
  const wing = new T.Group();
  wing.name = "Wing_Left";
  for (const parent of [root, wing])
    for (let i = 0; i < 3; i++) {
      const mesh = new T.Mesh(new T.BoxGeometry(), paint);
      mesh.position.x = i * 2;
      parent.add(mesh);
    }
  root.add(wing);
  const fan = new T.Group();
  fan.name = "Fan_Rotor";
  const blade = new T.Mesh(new T.BoxGeometry(), paint);
  fan.add(blade);
  root.add(fan);
  const glazing = new T.Mesh(new T.BoxGeometry(), glass);
  root.add(glazing);
  const before = new T.Box3().setFromObject(root, true);
  expect(batchStaticMeshes(root)).toBe(4);
  expect(new T.Box3().setFromObject(root, true).equals(before)).toBe(true);
  expect(blade.parent).toBe(fan);
  expect(glazing.parent).toBe(root);
  const meshes: T.Mesh[] = [];
  root.traverse((n) => {
    if (n instanceof T.Mesh) meshes.push(n);
  });
  expect(meshes.length).toBe(4);
  expect(meshes.filter((n) => n.userData.mainWing).length).toBe(1);
});

test("worker envelopes and reusable path samples preserve the clearance calculation", () => {
  const original = new AirframeEnvelope(new T.Mesh(new T.BoxGeometry(2, 2, 4)));
  const restored = new AirframeEnvelope(structuredClone(original.toData()));
  for (const p of [
    [0, 0, 0],
    [0, 2, 0],
    [3, 0, 0],
  ] as [number, number, number][])
    expect(restored.contains(p)).toBe(original.contains(p));
  const result = traceAirflow(
    solveWing(
      wingForAircraft("finch"),
      { alpha: 4, speed: 30, density: 1.225 },
      24,
    ),
    restored,
  );
  const path = result.paths[0],
    out: [number, number, number] = [0, 0, 0];
  for (let d = 0; d < path.length; d += 0.3) {
    const expected = samplePath(path, d);
    expect(samplePath(path, d, out)).toBe(out);
    expect(out).toEqual(expected);
  }
});

for (const id of Object.keys(aircraftCatalog) as LabAircraftId[])
  test(`${id}: batching preserves every runtime triangle and aircraft bounds`, async () => {
    const config = aircraftCatalog[id],
      { scene } = await loadGeometryOnly(
        new URL(`../public/assets/${config.asset}`, import.meta.url),
      );
    const root = new T.Group();
    scene.scale.setScalar(config.scale);
    scene.position.y = config.offsetY;
    root.add(scene);
    const triangles = () => {
      let n = 0;
      root.traverse((o) => {
        if (o instanceof T.Mesh)
          n +=
            (o.geometry.index?.count ??
              o.geometry.getAttribute("position").count) / 3;
      });
      return n;
    };
    const before = new T.Box3().setFromObject(root, true),
      count = triangles();
    expect(batchStaticMeshes(root)).toBeGreaterThan(0);
    expect(triangles()).toBe(count);
    const after = new T.Box3().setFromObject(root, true);
    expect(after.min.distanceTo(before.min)).toBeLessThan(0.00001);
    expect(after.max.distanceTo(before.max)).toBeLessThan(0.00001);
  }, 30000);
