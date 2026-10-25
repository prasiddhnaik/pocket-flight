import { expect, test } from "bun:test";
import { IDBFactory } from "fake-indexeddb";
import {
  convertAnchor,
  newScene,
  newObject,
  sampleTransform,
  setTransformKey,
  sampleCamera,
  validateScene,
} from "../src/studio/studio-scene";
import { newProject } from "../src/studio/studio-model";
import { Box3, Vector3, Mesh, MeshStandardMaterial } from "three";
import { loadAssetModel } from "../src/studio/studio-scene-renderer";
import { ReplayLibrary } from "../src/replay/replay-library";
import {
  packProject,
  readAssets,
  unpackProject,
  type StudioAsset,
} from "../src/studio/studio-assets";
const asset: StudioAsset = {
  schemaVersion: 1,
  id: "asset",
  name: "Triangle",
  kind: "obj",
  createdAt: 1,
  files: [
    {
      name: "triangle.obj",
      type: "text/plain",
      data: new TextEncoder().encode("v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3")
        .buffer,
    },
  ],
  animations: [],
};
test("scene keyframes sample position and scale, clamp endpoints, and honor hold", () => {
  let object = newObject("cube", [0, 0, 0]);
  object = setTransformKey(
    object,
    0,
    { ...object.transform, position: [0, 0, 0] },
    "linear",
  );
  object = setTransformKey(
    object,
    4,
    { ...object.transform, position: [8, 2, 0], scale: [3, 3, 3] },
    "linear",
  );
  expect(sampleTransform(object, 2).position).toEqual([4, 1, 0]);
  expect(sampleTransform(object, 2).scale).toEqual([2, 2, 2]);
  expect(sampleTransform(object, -1).position).toEqual([0, 0, 0]);
  expect(sampleTransform(object, 10).position).toEqual([8, 2, 0]);
  object.keys[0].ease = "hold";
  expect(sampleTransform(object, 3).position).toEqual([0, 0, 0]);
});
test("key insertion replaces a key at the same time and sorts the track", () => {
  let object = newObject("sphere", [0, 0, 0]);
  object = setTransformKey(object, 4, object.transform, "smooth");
  object = setTransformKey(object, 1, object.transform, "linear");
  object = setTransformKey(
    object,
    4,
    { ...object.transform, position: [1, 2, 3] },
    "hold",
  );
  expect(object.keys.map((k) => k.t)).toEqual([1, 4]);
  expect(object.keys[1].transform.position).toEqual([1, 2, 3]);
});
test("camera position, target, and lens interpolate deterministically", () => {
  const keys = [
    {
      t: 0,
      position: [0, 5, 10] as [number, number, number],
      target: [0, 0, 0] as [number, number, number],
      fov: 40,
      ease: "linear" as const,
    },
    {
      t: 4,
      position: [8, 9, 6] as [number, number, number],
      target: [0, 2, 0] as [number, number, number],
      fov: 60,
      ease: "linear" as const,
    },
  ];
  expect(sampleCamera(keys, 2)).toMatchObject({
    position: [4, 7, 8],
    target: [0, 1, 0],
    fov: 50,
  });
});
test("asset persistence upgrades an existing version-one replay database", async () => {
  const factory = new IDBFactory(),
    name = crypto.randomUUID();
  await new Promise<void>((resolve, reject) => {
    const r = factory.open(name, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore("replays", { keyPath: "id" });
      r.result.createObjectStore("projects", { keyPath: "id" });
    };
    r.onsuccess = () => {
      r.result.close();
      resolve();
    };
    r.onerror = () => reject(r.error);
  });
  const library = new ReplayLibrary(factory, name);
  await library.saveAssets([asset]);
  const project = {
    ...newProject(),
    scene: {
      ...newScene(),
      objects: [{ ...newObject("asset", [0, 0, 0]), assetId: asset.id }],
    },
  };
  await library.saveProject(project);
  library.close();
  const reopened = new ReplayLibrary(factory, name);
  expect((await reopened.getAsset(asset.id))?.files[0].data.byteLength).toBe(
    asset.files[0].data.byteLength,
  );
  expect((await reopened.getProject(project.id))?.scene?.objects).toEqual(
    project.scene.objects,
  );
  reopened.close();
});
test("portable backups preserve exact asset bytes and scene settings", async () => {
  const project = {
    ...newProject(),
    scene: {
      ...newScene(),
      objects: [{ ...newObject("asset", [0, 0, 0]), assetId: asset.id }],
    },
  };
  const restored = unpackProject(await packProject(project, [asset]));
  expect(new Uint8Array(restored.assets[0].files[0].data)).toEqual(
    new Uint8Array(asset.files[0].data),
  );
  expect(restored.project).toEqual(project);
  const invalid = JSON.parse(await packProject(project, [asset]));
  invalid.assets = [];
  expect(() => unpackProject(JSON.stringify(invalid))).toThrow("missing");
});
test("invalid scene values and malformed object tracks are rejected", () => {
  const scene = newScene();
  expect(validateScene(scene)).toBe(true);
  expect(validateScene({ ...scene, objects: [null] })).toBe(false);
  expect(
    validateScene({
      ...scene,
      objects: [
        {
          ...newObject("cube", [0, 0, 0]),
          transform: {
            position: [NaN, 0, 0],
            rotation: [0, 0, 0],
            scale: [1, 1, 1],
          },
        },
      ],
    }),
  ).toBe(false);
});

test("switching object anchors preserves its world pose", () => {
  const pose = {
    position: [8, 2, 4] as [number, number, number],
    rotation: [0, 20, 0] as [number, number, number],
    scale: [2, 2, 2] as [number, number, number],
  };
  const attached = convertAnchor(
    pose,
    "world",
    "aircraft",
    [0, 10, 0],
    [12, 80, -5],
    [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)],
  );
  const restored = convertAnchor(
    attached,
    "aircraft",
    "world",
    [0, 10, 0],
    [12, 80, -5],
    [0, Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)],
  );
  restored.position.forEach((n, i) =>
    expect(n).toBeCloseTo(pose.position[i], 5),
  );
  restored.rotation.forEach((n, i) =>
    expect(n).toBeCloseTo(pose.rotation[i], 5),
  );
});

test("project restore rolls back assets and project when a dependency is missing", async () => {
  const library = new ReplayLibrary(new IDBFactory(), crypto.randomUUID());
  const project = {
    ...newProject(),
    scene: {
      ...newScene(),
      objects: [{ ...newObject("asset", [0, 0, 0]), assetId: "missing" }],
    },
  };
  await expect(library.saveProject(project, [asset])).rejects.toThrow(
    "missing",
  );
  expect(await library.getProject(project.id)).toBeNull();
  expect(await library.getAsset(asset.id)).toBeNull();
  library.close();
});

test("mixed imports retain standalone images and audio beside model files", async () => {
  const files = [
    new File([asset.files[0].data], "triangle.obj"),
    new File([new Uint8Array([1, 2, 3])], "poster.png", { type: "image/png" }),
    new File([new Uint8Array([4, 5, 6])], "music.wav", { type: "audio/wav" }),
  ];
  const imported = await readAssets(files);
  expect(imported.map((a) => a.kind)).toEqual(["obj", "image", "audio"]);
  expect(imported.every((a) => a.files.length === 1)).toBe(true);
});

test("OBJ imports normalize geometry and use editable standard materials", async () => {
  const loaded = await loadAssetModel(asset);
  loaded.group.updateMatrixWorld(true);
  const box = new Box3().setFromObject(loaded.group);
  expect(box.getCenter(new Vector3()).length()).toBeCloseTo(0, 5);
  expect(Math.max(...box.getSize(new Vector3()).toArray())).toBeCloseTo(6, 5);
  let meshes = 0;
  loaded.group.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    ++meshes;
    expect(node.material).toBeInstanceOf(MeshStandardMaterial);
    node.geometry.dispose();
    (node.material as MeshStandardMaterial).dispose();
  });
  expect(meshes).toBe(1);
});
