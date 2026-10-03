import { expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as T from "three";
import { terrainSurfaceHeight, random, runways } from "../src/terrain";

function glb(name: string) {
  const bytes = readFileSync(
    new URL(`../public/assets/scenery/${name}.glb`, import.meta.url),
  );
  const length = bytes.readUInt32LE(12);
  return {
    bytes,
    data: JSON.parse(bytes.subarray(20, 20 + length).toString()),
  };
}

test("Blender terrain matches the simulator ground at coasts, mountains and airfields", async () => {
  const { bytes } = glb("palm-bay-terrain");
  const buffer = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  );
  const { scene } = await new GLTFLoader().parseAsync(buffer, "");
  scene.updateMatrixWorld(true);
  const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0));
  const rng = random(167);
  const points = runways.map((r) => [r.x, r.z]);
  for (let i = 0; i < 40; i++)
    points.push([(rng() - 0.5) * 2100, (rng() - 0.5) * 2100]);
  for (const [x, z] of points) {
    ray.ray.origin.set(x, 500, z);
    const hit = ray.intersectObject(scene, true)[0];
    expect(hit).toBeDefined();
    expect(hit.point.y).toBeCloseTo(terrainSurfaceHeight(x, z), 3);
  }
});

test("runtime exports have geometry, bounded downloads and dark basalt material", () => {
  for (const file of readdirSync(
    new URL("../public/assets/scenery/", import.meta.url),
  ).filter((f) => f.endsWith(".glb"))) {
    const { bytes, data } = glb(file.slice(0, -4));
    expect(bytes.length).toBeLessThan(8 * 1024 * 1024);
    expect(data.meshes.length).toBeGreaterThan(0);
    expect(data.accessors.length).toBeGreaterThan(0);
    for (const mesh of data.meshes)
      for (const primitive of mesh.primitives)
        expect(
          data.accessors[primitive.attributes.POSITION].count,
        ).toBeGreaterThan(3);
  }
  const basalt = glb("basalt-outcrop").data;
  const base = basalt.materials[0].pbrMetallicRoughness.baseColorFactor;
  expect(base).toBeDefined();
  expect(Math.max(...base.slice(0, 3))).toBeLessThan(0.3);
  const distant = glb("coastal-tree-far").data;
  const triangles = distant.meshes.reduce(
    (sum: number, mesh: any) =>
      sum +
      mesh.primitives.reduce(
        (n: number, p: any) => n + distant.accessors[p.indices].count / 3,
        0,
      ),
    0,
  );
  expect(triangles).toBe(4);
});
