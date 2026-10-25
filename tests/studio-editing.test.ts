import { expect, test } from "bun:test";
import type { SavedReplay } from "../src/replay/replay-data";
import { ReplayLibrary } from "../src/replay/replay-library";
import { IDBFactory } from "fake-indexeddb";
import {
  addReplayClip,
  newProject,
  projectDuration,
  validateProject,
} from "../src/studio/studio-model";
import {
  newObject,
  newScene,
  setTransformKey,
} from "../src/studio/studio-scene";
import { packProject, unpackProject } from "../src/studio/studio-assets";
import {
  cameraFilmTime,
  changeSceneObject,
  duplicateClip,
  duplicateSceneObject,
  editClip,
  moveClip,
  removeClip,
  sceneSpawnPosition,
  splitClip,
} from "../src/studio/studio-editing";

function film() {
  const replay: SavedReplay = {
    schemaVersion: 1,
    id: "flight",
    name: "Saved coast flight",
    aircraft: "finch",
    paint: 0,
    mission: "free",
    createdAt: 1,
    updatedAt: 1,
    duration: 10,
    trimmed: false,
    frames: [0, 10].map((t) => ({
      t,
      p: [100 + t, 20, 0],
      q: [0, 0, 0, 1],
      worldTime: t,
      throttle: 0.5,
      speed: 30,
      suspension: 0,
      gearDamage: 0,
      propAngle: t,
      propRpm: 1200,
      surfaces: { pitch: 0, roll: 0, yaw: 0 },
      propVisible: true,
      gearVisible: true,
      wings: [true, true],
      engineOut: false,
      night: false,
      ring: 0,
      debris: [],
    })),
  };
  const project = addReplayClip(newProject(), replay);
  project.clips[0] = {
    ...project.clips[0],
    in: 2,
    out: 8,
    speed: 2,
    title: "Coast",
    volume: 0.5,
  };
  return project;
}

test("splitting a trimmed fast clip preserves duration, source, settings and original project", () => {
  const project = film(),
    before = structuredClone(project),
    original = project.clips[0];
  const next = splitClip(project, 1)!;
  expect(next.project.clips.map((c) => [c.in, c.out])).toEqual([
    [2, 4],
    [4, 8],
  ]);
  expect(projectDuration(next.project)).toBe(projectDuration(project));
  expect(next.project.clips[0].id).toBe(original.id);
  expect(next.selected).toBe(next.project.clips[1].id);
  expect(next.selected).not.toBe(original.id);
  expect(
    next.project.clips.every(
      (c) =>
        c.replayId === original.replayId &&
        c.title === "Coast" &&
        c.speed === 2 &&
        c.volume === 0.5,
    ),
  ).toBe(true);
  expect(project).toEqual(before);
  expect(validateProject(next.project)).toBe(true);
});

test("splits reject empty timelines and cuts too close to source endpoints", () => {
  const project = film();
  expect(splitClip(newProject(), 1)).toBeNull();
  expect(splitClip(project, 0)).toBeNull();
  expect(splitClip(project, 0.01)).toBeNull();
  expect(splitClip(project, 2.99)).toBeNull();
  expect(splitClip(project, 3)).toBeNull();
});

test("duplicate, reorder and remove retain shared source recordings until their last clip is removed", () => {
  const original = film();
  const duplicated = duplicateClip(original, original.clips[0]);
  expect(duplicated.clips).toHaveLength(2);
  expect(duplicated.clips[1].id).not.toBe(duplicated.clips[0].id);
  expect(duplicated.sources).toBe(original.sources);
  expect(moveClip(duplicated, duplicated.clips[0], -1)).toBeNull();
  expect(moveClip(duplicated, duplicated.clips[1], 1)).toBeNull();
  const moved = moveClip(duplicated, duplicated.clips[1], -1)!;
  expect(moved.index).toBe(0);
  expect(moved.project.clips[0]).toBe(duplicated.clips[1]);
  const once = removeClip(moved.project, moved.project.clips[0]);
  expect(Object.keys(once.sources)).toHaveLength(1);
  const empty = removeClip(once, once.clips[0]);
  expect(empty.clips).toHaveLength(0);
  expect(Object.keys(empty.sources)).toHaveLength(0);
  expect(original.clips).toHaveLength(1);
});

test("camera seek maps source time into the selected clip's film position and clamps trims", () => {
  const first = film(),
    project = duplicateClip(first, first.clips[0]),
    clip = project.clips[1];
  expect(cameraFilmTime(project, clip, 4)).toBe(4);
  expect(cameraFilmTime(project, clip, -10)).toBe(3);
  expect(cameraFilmTime(project, clip, 99)).toBe(6);
});

test("camera anchor edits preserve key positions through a round trip at each source timestamp", () => {
  const project = film(),
    clip = project.clips[0];
  clip.cameraKeys = [2, 8].map((t) => ({
    t,
    position: [1, 3, 5],
    target: [0, 0, 0],
    fov: 48,
    ease: "smooth",
  }));
  const before = structuredClone(project);
  const world = editClip(project, clip, { cameraAnchor: "world" });
  expect(world.clips[0].cameraKeys?.map((k) => k.position)).toEqual([
    [3, 3, 5],
    [9, 3, 5],
  ]);
  const restored = editClip(world, world.clips[0], {
    cameraAnchor: "aircraft",
  });
  expect(restored.clips[0].cameraKeys).toEqual(clip.cameraKeys);
  expect(project).toEqual(before);
});

test("object anchor edits use film time for keys and keep poses through a round trip", () => {
  const project = film();
  let object = newObject("cube", [12, 3, 0]);
  object = setTransformKey(object, 0, object.transform, "linear");
  object = setTransformKey(
    object,
    2,
    { ...object.transform, position: [14, 3, 0] },
    "smooth",
  );
  project.scene = { ...newScene(), objects: [object] };
  const before = structuredClone(project);
  const aircraft = changeSceneObject(
    project,
    object.id,
    { anchor: "aircraft" },
    1,
  );
  expect(aircraft.objects[0].transform.position).toEqual([8, 3, 0]);
  expect(aircraft.objects[0].keys.map((k) => k.transform.position[0])).toEqual([
    10, 8,
  ]);
  const restored = changeSceneObject(
    { ...project, scene: aircraft },
    object.id,
    { anchor: "world" },
    1,
  );
  // Euler conversion may produce -0; JSON stores the same numeric pose.
  expect(JSON.parse(JSON.stringify(restored.objects[0]))).toEqual(object);
  expect(project).toEqual(before);
});

test("duplicating an animated object offsets its pose and every key without mutating the source", () => {
  const original = setTransformKey(
    newObject("cube", [1, 2, 3]),
    2,
    { position: [5, 6, 7], rotation: [0, 0, 0], scale: [1, 1, 1] },
    "linear",
  );
  const before = structuredClone(original),
    next = duplicateSceneObject(original);
  expect(next.id).not.toBe(original.id);
  expect(next.name).toBe(`${original.name} copy`);
  expect(next.transform.position).toEqual([5, 2, 3]);
  expect(next.keys[0].transform.position).toEqual([9, 6, 7]);
  next.keys[0].transform.position[1] = 99;
  expect(original).toEqual(before);
});

test("scene spawning follows the trimmed source position relative to the first recorded origin", () => {
  expect(sceneSpawnPosition(film(), 1)).toEqual([12, 2, 0]);
  expect(sceneSpawnPosition(newProject(), 0)).toEqual([8, 3, 0]);
});

test("edited projects remain portable and survive reopening the existing browser library schema", async () => {
  const original = film();
  const split = splitClip(original, 1)!.project;
  const edited = editClip(split, split.clips[1], {
    title: "Second shot",
    camera: "side",
  });
  const backup = await packProject(edited, []);
  const restored = unpackProject(backup);
  expect(restored.project).toEqual(edited);
  expect(validateProject(restored.project)).toBe(true);
  const factory = new IDBFactory(),
    name = crypto.randomUUID();
  const library = new ReplayLibrary(factory, name);
  await library.saveProject(restored.project);
  library.close();
  const reopened = new ReplayLibrary(factory, name);
  try {
    expect(await reopened.getProject(edited.id)).toEqual(edited);
  } finally {
    reopened.close();
  }
});
