import { expect, test } from "bun:test";
import * as T from "three";
import { crossings, faces, Tree, insideDepth, hidden, solidTrees } from "../scripts/fit/geometry";
import { load, state } from "../scripts/fit/load";
import { joints, poses } from "../scripts/fit/checks";
import { limits } from "../scripts/fit/limits";
import { Pilot, pilotSeats } from "../src/aircraft/pilot";
import { loadGeometryOnly } from "../scripts/geometry-loader";

const v = (x: number, y: number, z: number) => new T.Vector3(x, y, z);
test("triangle crossings distinguish separation and a true crossing", () => {
  const a = new T.Triangle(v(-1, 0, 0), v(1, 0, 0), v(0, 1, 0));
  expect(crossings(a, new T.Triangle(v(0, 0.2, -1), v(0, 0.2, 1), v(0, 0.8, 1)))).toBe(true);
  expect(crossings(a, new T.Triangle(v(0, 0.2, 2), v(0, 0.2, 3), v(0, 0.8, 3)))).toBe(false);
});
test("solid depth requires six outward hits and nearest-surface corroboration", () => {
  const box = new T.Mesh(new T.BoxGeometry(2, 2, 2));
  const tree = new Tree(faces(box).faces);
  expect(insideDepth(v(0.1, 0.2, 0.3), tree)).toBeCloseTo(0.7);
  expect(insideDepth(v(1.1, 0, 0), tree)).toBe(0);
  expect(insideDepth(v(0, 0, 0), new Tree(faces(new T.Mesh(new T.PlaneGeometry(2, 2))).faces))).toBe(0);
});
test("inward imported shells and thin rotated solids do not inflate depth", () => {
  const mesh = new T.Mesh(new T.BoxGeometry(2, 0.02, 2));
  mesh.rotation.set(0.4, 0.5, 0.6);
  const triangles = faces(mesh).faces.map((f) => ({ ...f, triangle: new T.Triangle(f.triangle.a, f.triangle.c, f.triangle.b) }));
  const shells = solidTrees(triangles);
  expect(shells.length).toBe(1);
  expect(insideDepth(v(0, 0, 0), shells[0].tree)).toBeCloseTo(0.01, 5);
});
test("hidden rays stop at the target and use the current drawn index", () => {
  const mesh = new T.Mesh(new T.PlaneGeometry(2, 2));
  expect(hidden(v(0, 0, 1), v(0, 0, -1), new Tree(faces(mesh).faces))).toBe(true);
  expect(hidden(v(0, 0, 1), v(0, 0, 0.5), new Tree(faces(mesh).faces))).toBe(false);
  mesh.geometry.setIndex([]);
  expect(hidden(v(0, 0, 1), v(0, 0, -1), new Tree(faces(mesh).faces))).toBe(false);
});
test("quick real Aurelia seat pose uses game driver and catches a bad knee in memory", async () => {
  const { pilot, scene, driver, group } = await load("aurelia");
  const pose = poses[1].c;
  const throttle = scene.getObjectByName("Throttle_left")!;
  const before = throttle.position.clone();
  driver.update(state(pose), 1);
  expect(throttle.position.distanceTo(before)).toBeGreaterThan(0);
  pilot.update(pose); group.updateMatrixWorld(true);
  expect(joints(pilot, pose)[0].knee).toBeGreaterThan(110);
  const skin = faces(pilot.root, true);
  expect(skin.faces.length).toBeGreaterThan(1000);
  const original = pilotSeats.aurelia;
  try {
    pilotSeats.aurelia = { ...original, size: 1, eye: [-0.32, 1.455, -6.1], pedals: [[-0.44, 0.55, -6.35], [-0.2, 0.55, -6.35]] };
    const bad = new Pilot(new T.Group(), "aurelia", loadGeometryOnly(new URL("../public/assets/pilot/fighter-pilot.glb", import.meta.url)));
    await bad.ready;
    bad.setFirstPerson(true); bad.update(pose);
    expect(Math.min(...joints(bad, pose).map((j) => j.knee))).toBeLessThan(limits.aurelia.knee);
    bad.dispose();
  } finally { pilotSeats.aurelia = original; pilot.dispose(); driver.dispose?.(); }
});
