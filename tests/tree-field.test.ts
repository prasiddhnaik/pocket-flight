import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as T from "three";
import { keptFraction, levelAt, SHRUB_REACH, TREE_LEVELS, TREE_STRIDE, TreeBuckets, TreeField, type TreeSite } from "../src/world/tree-field";

const levels = { broadleaf: 4, round: 4, tall: 4, palm: 3, shrub: 2 };
const site = (kind: string, x: number, z: number, y = 0): TreeSite => ({ kind, x, y, z, scale: 2, yaw: 0.5, stretch: 1, shade: 1 });
const view = (position: T.Vector3, target: T.Vector3) => {
  const camera = new T.PerspectiveCamera(48, 16 / 9, 0.2, 11000);
  camera.position.copy(position);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  return new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
};

test("the whole model set is a tiny download, far below the scanned trees it replaces", () => {
  const bytes = readFileSync(new URL("../public/assets/scenery/tropical-trees.glb", import.meta.url));
  expect(bytes.length).toBeLessThan(60 * 1024);
});

test("each level stays inside its triangle budget and carries no textures or transparency", () => {
  const bytes = readFileSync(new URL("../public/assets/scenery/tropical-trees.glb", import.meta.url));
  const data = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  expect(data.images).toBeUndefined();
  expect(data.textures).toBeUndefined();
  const budgets: Record<string, number> = { "0": 240, "1": 60, "2": 24, "3": 10 };
  const names = new Set<string>();
  for (const mesh of data.meshes) {
    names.add(mesh.name);
    const triangles = data.accessors[mesh.primitives[0].indices].count / 3;
    const [kind, level] = mesh.name.split("_");
    expect(triangles).toBeLessThanOrEqual(budgets[level]);
    if (kind === "shrub") expect(triangles).toBeLessThanOrEqual(level === "0" ? 50 : 18);
    expect(mesh.primitives[0].attributes.COLOR_0).toBeDefined();
    expect(mesh.primitives[0].attributes.NORMAL).toBeDefined();
  }
  for (const kind of ["broadleaf", "round", "tall", "palm"]) for (const level of [0, 1, 2]) expect(names.has(`${kind}_${level}`)).toBe(true);
  for (const kind of ["broadleaf", "round", "tall"]) expect(names.has(`${kind}_3`)).toBe(true);
});

test("trees get coarser with distance, in the right order, and zoom counts as being closer", () => {
  expect(levelAt(0, 3)).toBe(0);
  expect(levelAt(TREE_LEVELS[0] - 1, 3)).toBe(0);
  expect(levelAt(TREE_LEVELS[0] + 1, 3)).toBe(1);
  expect(levelAt(TREE_LEVELS[1] + 1, 4)).toBe(2);
  expect(levelAt(TREE_LEVELS[2] + 1, 4)).toBe(3);
  expect(levelAt(TREE_LEVELS[2] + 1, 3)).toBe(2);
  expect(levelAt(TREE_LEVELS[1] + 1, 2)).toBe(1);
  const buckets = new TreeBuckets([site("round", 200, 0)], levels);
  const frustum = view(new T.Vector3(0, 0, 0), new T.Vector3(200, 0, 0));
  buckets.fill(new T.Vector3(), frustum, 1);
  expect(buckets.counts.get("round")).toEqual([0, 1, 0, 0]);
  buckets.fill(new T.Vector3(), frustum, 4);
  expect(buckets.counts.get("round")).toEqual([1, 0, 0, 0]);
});

test("every tree in view lands in exactly one draw, with its numbers intact", () => {
  const sites: TreeSite[] = [];
  for (let i = 0; i < 400; i++) sites.push(site(i % 2 ? "round" : "tall", ((i * 37) % 300) - 150, ((i * 61) % 300) - 150));
  const buckets = new TreeBuckets(sites, levels);
  buckets.fill(new T.Vector3(0, 300, 0), view(new T.Vector3(0, 300, 0), new T.Vector3(0, 0, 1)));
  let total = 0;
  const seen = new Set<string>();
  for (const kind of ["round", "tall"]) {
    const counts = buckets.counts.get(kind)!;
    counts.forEach((count, level) => {
      total += count;
      const data = buckets.buffers.get(kind)![level];
      for (let i = 0; i < count; i++) {
        const at = i * TREE_STRIDE;
        seen.add(`${kind}:${data[at]},${data[at + 2]}`);
        expect(data[at + 3]).toBe(2);
        expect(data[at + 4]).toBeCloseTo(Math.cos(0.5), 5);
        expect(data[at + 5]).toBeCloseTo(Math.sin(0.5), 5);
      }
    });
  }
  expect(total).toBe(400);
  expect(seen.size).toBe(new Set(sites.map((s) => `${s.kind}:${s.x},${s.z}`)).size);
});

test("trees outside the view are not drawn, but ones close behind stay for their shadows", () => {
  const buckets = new TreeBuckets([site("round", 0, 900), site("tall", 0, 60)], levels);
  buckets.fill(new T.Vector3(), view(new T.Vector3(), new T.Vector3(0, 0, -100)));
  expect(buckets.counts.get("round")).toEqual([0, 0, 0, 0]);
  expect(buckets.counts.get("tall")).toEqual([1, 0, 0, 0]);
});

test("undergrowth stops at its reach, and has no third level to fall through to", () => {
  const buckets = new TreeBuckets([site("shrub", 0, -(SHRUB_REACH - 30)), site("shrub", 0, -(SHRUB_REACH + 200))], levels);
  buckets.fill(new T.Vector3(), view(new T.Vector3(), new T.Vector3(0, 0, -100)));
  expect(buckets.counts.get("shrub")).toEqual([0, 1]);
});

test("far forests thin out, in steps, and never vanish", () => {
  expect(keptFraction(100)).toBe(1);
  expect(keptFraction(1000)).toBeLessThan(1);
  expect(keptFraction(5000)).toBeGreaterThan(0.2);
  const sites = Array.from({ length: 100 }, (_, i) => site("round", 10 + (i % 10), 2000 + Math.floor(i / 10)));
  const buckets = new TreeBuckets(sites, levels);
  const target = new T.Vector3(0, 0, 2000);
  buckets.fill(new T.Vector3(), view(new T.Vector3(), target));
  expect(buckets.counts.get("round")![3]).toBe(35);
});

test("refilling is fast enough to do while flying, for a whole forest", () => {
  const sites: TreeSite[] = [];
  const kinds = ["broadleaf", "round", "tall", "palm", "shrub"];
  for (let i = 0; i < 16000; i++) sites.push(site(kinds[i % 5], ((i * 73.1) % 1740) - 870, ((i * 41.7) % 1700) - 850));
  const buckets = new TreeBuckets(sites, levels);
  const position = new T.Vector3(0, 200, 700);
  const frustum = view(position, new T.Vector3());
  const start = performance.now();
  for (let i = 0; i < 100; i++) buckets.fill(position, frustum);
  // Generous for a shared test machine; a refill only happens when the camera has moved.
  expect((performance.now() - start) / 100).toBeLessThan(3);
});

test("trees are refilled by the scene's own hook, before the renderer gathers its draws, and dispose puts it back", () => {
  const scene = new T.Scene();
  let earlier = 0;
  const hook = () => void earlier++;
  scene.onBeforeRender = hook;
  const models = new Map<string, T.BufferGeometry>();
  for (const [kind, count] of Object.entries(levels))
    for (let level = 0; level < count; level++) {
      const model = new T.BoxGeometry();
      model.setAttribute("color", model.getAttribute("position"));
      models.set(`${kind}_${level}`, model);
    }
  const field = new TreeField(scene, models, [site("round", 0, -50)]);
  const camera = new T.PerspectiveCamera(48, 16 / 9, 0.2, 11000);
  camera.updateMatrixWorld(true);
  const showing = () =>
    field.children.filter((child) => child.visible).map((child) => [child.name, ((child as T.Mesh).geometry as T.InstancedBufferGeometry).instanceCount]);
  expect(showing().every(([, count]) => count === 0)).toBe(true);

  scene.onBeforeRender({} as T.WebGLRenderer, scene, camera, new T.BufferGeometry(), new T.Material(), new T.Group());
  expect(earlier).toBe(1);
  expect(showing()).toEqual([["round level 0", 1]]);

  field.dispose();
  expect(scene.onBeforeRender).toBe(hook);
});
