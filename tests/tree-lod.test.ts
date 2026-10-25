import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as T from "three";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { getBounds } from "@gltf-transform/functions";
import {
  clearScenery,
  makeSceneryGrove,
  TREE_LOD,
} from "../src/world/environment-assets";

function model(detail: number) {
  const group = new T.Group();
  group.add(
    new T.Mesh(
      new T.SphereGeometry(2, detail, detail),
      new T.MeshStandardMaterial(),
    ),
  );
  return group;
}
function forest(xs: number[]) {
  return makeSceneryGrove(
    model(12),
    model(3),
    xs.map((x) => ({ matrix: new T.Matrix4().makeTranslation(x, 4, 10) })),
    "Coastal forest",
    TREE_LOD.far,
    model(6),
  );
}

test("forest has exactly one selected level through both transition directions and zoom", () => {
  const group = forest([10]);
  group.updateMatrixWorld(true);
  const lod = group.children.find((child) => child instanceof T.LOD) as T.LOD;
  const camera = new T.PerspectiveCamera();
  for (const [distance, zoom, expected] of [
    [10, 1, 0],
    [32, 1, 1],
    [70, 1, 2],
    [44, 1, 1],
    [19, 1, 0],
    [70, 2, 1],
    [90, 2, 2],
    [30, 2, 0],
  ]) {
    camera.position.copy(lod.position).add(new T.Vector3(0, 0, distance));
    camera.zoom = zoom;
    camera.updateMatrixWorld();
    lod.update(camera);
    expect(lod.getCurrentLevel()).toBe(expected);
    expect(lod.levels.filter((level) => level.object.visible)).toHaveLength(1);
  }
  clearScenery(group);
});

test("spatial batches preserve every tree transform once, including negative cells", () => {
  const xs = [-810, -780, -1, 12, 810];
  const group = forest(xs);
  group.updateMatrixWorld(true);
  const batches = group.children.filter((child) =>
    child.name.startsWith("Distant canopy batch"),
  );
  expect(batches.length).toBeGreaterThan(1);
  const farPositions: number[] = [];
  const matrix = new T.Matrix4();
  const position = new T.Vector3();
  for (const batch of batches) {
    const mesh = batch.children[0] as T.InstancedMesh;
    expect(mesh.boundingSphere).not.toBeNull();
    const centers = mesh.geometry.getAttribute("treeCell");
    expect(centers.count).toBe(mesh.count);
    for (let index = 0; index < mesh.count; index++) {
      mesh.getMatrixAt(index, matrix);
      position.setFromMatrixPosition(matrix.premultiply(mesh.matrixWorld));
      expect(position.y).toBe(4);
      expect(position.z).toBe(10);
      farPositions.push(position.x);
    }
  }
  expect(farPositions.sort((a, b) => a - b)).toEqual(xs);
  for (const level of [0, 1]) {
    const positions: number[] = [];
    for (const child of group.children) {
      if (!(child instanceof T.LOD)) continue;
      const mesh = child.levels[level].object.children[0] as T.InstancedMesh;
      for (let index = 0; index < mesh.count; index++) {
        mesh.getMatrixAt(index, matrix);
        position.setFromMatrixPosition(matrix.premultiply(mesh.matrixWorld));
        positions.push(position.x);
      }
    }
    expect(positions.sort((a, b) => a - b)).toEqual(xs);
  }
  clearScenery(group);
});

test("rock groves retain two levels and their existing transition distance", () => {
  const group = makeSceneryGrove(
    model(12),
    model(3),
    [{ matrix: new T.Matrix4() }],
    "Limestone coves",
    170,
  );
  const lod = group.children[0] as T.LOD;
  expect(lod.levels).toHaveLength(2);
  expect(lod.levels[1].distance).toBe(170);
  expect(
    group.children.some((child) =>
      child.name.startsWith("Distant canopy batch"),
    ),
  ).toBe(false);
  clearScenery(group);
});

test("cached grove matrices still follow parent movement and reparenting", () => {
  const group = forest([10]);
  const parent = new T.Group();
  parent.add(group);
  const mesh = (group.children[0] as T.LOD).levels[0].object
    .children[0] as T.InstancedMesh;
  const x = () => {
    const matrix = new T.Matrix4();
    mesh.getMatrixAt(0, matrix);
    return new T.Vector3().setFromMatrixPosition(
      matrix.premultiply(mesh.matrixWorld),
    ).x;
  };
  parent.updateMatrixWorld(true);
  expect(x()).toBe(10);
  parent.position.x = 100;
  parent.updateMatrixWorld(true);
  expect(x()).toBe(110);
  group.position.x = 25;
  parent.updateMatrixWorld(true);
  expect(x()).toBe(135);
  group.removeFromParent();
  group.updateMatrixWorld();
  expect(x()).toBe(35);
  clearScenery(group);
});

test("middle tree instances reuse the near tier's material and texture", () => {
  const near = model(12);
  const middle = model(6);
  const source = (near.children[0] as T.Mesh)
    .material as T.MeshStandardMaterial;
  source.map = new T.Texture();
  const group = makeSceneryGrove(
    near,
    model(3),
    [{ matrix: new T.Matrix4() }],
    "Coastal forest",
    TREE_LOD.far,
    middle,
  );
  const lod = group.children[0] as T.LOD;
  const medium = lod.levels[1].object.children[0] as T.Mesh;
  expect(medium.material).toBe(source);
  expect((medium.material as T.MeshStandardMaterial).map).toBe(source.map);
  clearScenery(group);
});

function asset(name: string) {
  const bytes = readFileSync(
    new URL(`../public/assets/scenery/${name}.glb`, import.meta.url),
  );
  return JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
}
test("middle tree reduces geometry while preserving source material slots, UVs and overall silhouette bounds", async () => {
  const near = asset("coastal-tree-near");
  const middle = asset("coastal-tree-mid");
  expect(middle.images ?? []).toHaveLength(0);
  const triangles = (data: typeof near) =>
    data.meshes
      .flatMap((mesh: { primitives: { indices: number }[] }) => mesh.primitives)
      .reduce(
        (sum: number, primitive: { indices: number }) =>
          sum + data.accessors[primitive.indices].count / 3,
        0,
      );
  expect(triangles(middle)).toBeLessThan(triangles(near) * 0.5);
  expect(triangles(middle)).toBeGreaterThan(1000);
  expect(
    middle.materials.map((material: { name: string }) => material.name).sort(),
  ).toEqual(
    near.materials.map((material: { name: string }) => material.name).sort(),
  );
  for (let mesh = 0; mesh < near.meshes.length; mesh++)
    for (let index = 0; index < near.meshes[mesh].primitives.length; index++) {
      const primitive = middle.meshes[mesh].primitives[index];
      expect(primitive.attributes.TEXCOORD_0).toBeDefined();
      expect(primitive.attributes.NORMAL).toBeDefined();
    }
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  const bounds = await Promise.all(
    ["near", "mid"].map(async (level) => {
      const document = await io.read(
        fileURLToPath(
          new URL(
            `../public/assets/scenery/coastal-tree-${level}.glb`,
            import.meta.url,
          ),
        ),
      );
      return getBounds(document.getRoot().listScenes()[0]);
    }),
  );
  for (const bound of ["min", "max"] as const)
    for (let axis = 0; axis < 3; axis++)
      expect(
        Math.abs(bounds[0][bound][axis] - bounds[1][bound][axis]),
      ).toBeLessThan(0.01);
});
