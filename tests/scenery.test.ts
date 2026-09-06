import { expect, test } from "bun:test";
import * as T from "three";
import {
  terrainHeight,
  runways,
  WORLD_SIZE,
  TERRAIN_SEGMENTS,
  terrainSurfaceHeight,
} from "../src/terrain";
import { villageRoof, hangarRoof, groundPath } from "../src/scenery-geometry";

test("both runways and aprons clear the actual triangulated island", () => {
  const geometry = new T.PlaneGeometry(
    WORLD_SIZE,
    WORLD_SIZE,
    TERRAIN_SEGMENTS,
    TERRAIN_SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);
  const vertices = geometry.attributes.position;
  for (let i = 0; i < vertices.count; i++)
    vertices.setY(i, terrainHeight(vertices.getX(i), vertices.getZ(i)));
  const land = new T.Mesh(geometry, new T.MeshBasicMaterial());
  const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0));
  for (const r of runways) {
    let highest = -Infinity;
    for (const [left, right, start, end] of [
      [-r.width / 2, r.width / 2, -r.length / 2, r.length / 2],
      [12, 81, 13, 125],
      [36, 48, -33, -17],
    ]) {
      for (let x = left; x <= right; x += (right - left) / 4)
        for (let z = start; z <= end; z += (end - start) / 12) {
          ray.ray.origin.set(
            r.x + x * Math.cos(r.heading) + z * Math.sin(r.heading),
            500,
            r.z - x * Math.sin(r.heading) + z * Math.cos(r.heading),
          );
          const actual = ray.intersectObject(land)[0].point.y;
          expect(
            terrainSurfaceHeight(ray.ray.origin.x, ray.ray.origin.z),
          ).toBeCloseTo(actual, 4);
          highest = Math.max(highest, actual);
        }
    }
    expect(highest - r.y).toBeLessThan(0.1);
  }
  geometry.dispose();
});

function roofHeight(geometry: T.BufferGeometry, x: number, z: number) {
  const mesh = new T.Mesh(
    geometry,
    new T.MeshBasicMaterial({ side: T.DoubleSide }),
  );
  const hit = new T.Raycaster(
    new T.Vector3(x, 100, z),
    new T.Vector3(0, -1, 0),
  ).intersectObject(mesh)[0];
  return hit?.point.y ?? -Infinity;
}

test("village roofs cover the walls without cutting through their upper corners", () => {
  for (const width of [8, 10.5, 13])
    for (const depth of [9, 12.5, 16]) {
      const roof = villageRoof(width, depth);
      for (const x of [-width / 2, 0, width / 2])
        for (const z of [-depth / 2, 0, depth / 2])
          expect(roofHeight(roof, x, z)).toBeGreaterThan(0.1);
      roof.dispose();
    }
});

test("hangar barrel roofs arch over the full building footprint", () => {
  const roof = hangarRoof();
  for (const x of [-11.5, 0, 11.5])
    for (const z of [-12, 0, 12])
      expect(roofHeight(roof, x, z)).toBeGreaterThan(0.4);
  roof.dispose();
});

test("the village footpath clears terrain between vertices, including grid seams", () => {
  const path = groundPath(
    [
      new T.Vector3(-207, 0, 280),
      new T.Vector3(-165, 0, 435),
      new T.Vector3(-275, 0, 490),
      new T.Vector3(-455, 0, 530),
    ],
    6,
  );
  const p = path.attributes.position,
    index = path.index!;
  let clearance = Infinity;
  for (let i = 0; i < index.count; i += 3) {
    const a = new T.Vector3().fromBufferAttribute(p, index.getX(i));
    const b = new T.Vector3().fromBufferAttribute(p, index.getX(i + 1));
    const c = new T.Vector3().fromBufferAttribute(p, index.getX(i + 2));
    for (const [u, v] of [
      [1 / 3, 1 / 3],
      [0.5, 0],
      [0, 0.5],
      [0.5, 0.5],
    ]) {
      const sample = a
        .clone()
        .multiplyScalar(1 - u - v)
        .addScaledVector(b, u)
        .addScaledVector(c, v);
      clearance = Math.min(
        clearance,
        sample.y - terrainSurfaceHeight(sample.x, sample.z),
      );
    }
  }
  expect(clearance).toBeGreaterThan(0.15);
  path.dispose();
});
