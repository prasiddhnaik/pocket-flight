import { expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Box3, BoxGeometry, Group, Matrix4, Mesh, Vector3 } from "three";
import {
  boundsInFrame,
  fitObjectSize,
  measureObject,
  placeBesideAircraft,
  placeOnGround,
  placeSceneObject,
  type PlacementAction,
} from "../src/studio/studio-placement";
import { SceneObjectInspector } from "../src/studio/panels/SceneObjectInspector";
import {
  newObject,
  type SceneObject,
  type Transform,
  type Vec3,
} from "../src/studio/studio-scene";

const pose = (): Transform => ({
  position: [3, 7, -4],
  rotation: [0, 20, 0],
  scale: [2, 1, 3],
});

test("dimensions stay in the anchor frame when the aircraft banks", () => {
  const anchor = new Group();
  anchor.position.set(20, 70, -10);
  anchor.rotation.z = Math.PI / 2;
  const object = new Group();
  object.scale.set(2, 3, 4);
  object.add(new Mesh(new BoxGeometry(2, 4, 6)));
  anchor.add(object);
  anchor.updateMatrixWorld(true);
  expect(
    boundsInFrame(object, anchor.matrixWorld)?.getSize(new Vector3()).toArray(),
  ).toEqual([4, 12, 24]);
});

test("bounds include child transforms and ignore invisible geometry", () => {
  const object = new Group();
  const mesh = new Mesh(new BoxGeometry(2, 4, 6));
  mesh.position.set(1, 2, 3);
  object.add(mesh);
  const hidden = new Mesh(new BoxGeometry(100, 100, 100));
  hidden.visible = false;
  object.add(hidden);
  const bounds = boundsInFrame(object, new Matrix4())!;
  expect(bounds.min.toArray()).toEqual([0, 0, 0]);
  expect(bounds.max.toArray()).toEqual([2, 4, 6]);
  expect(boundsInFrame(new Group(), new Matrix4())).toBeNull();
});

test("requested size preserves nonuniform scale ratios and the rest of the pose", () => {
  expect(fitObjectSize(pose(), [4, 12, 24], 48)).toEqual({
    position: [3, 7, -4],
    rotation: [0, 20, 0],
    scale: [4, 2, 6],
  });
});

test("invalid size and out-of-range scale do not create invalid transforms", () => {
  for (const size of [0, -2, NaN, Infinity, 1e9])
    expect(fitObjectSize(pose(), [4, 12, 24], size)).toBeNull();
  expect(fitObjectSize(pose(), [0, 0, 0], 10)).toBeNull();
  expect(fitObjectSize(pose(), [4, 12, 24], 0.00001)).toBeNull();
});

test("beside placement follows aircraft heading instead of world X", () => {
  const aircraft = new Group();
  aircraft.position.set(100, 50, 200);
  aircraft.rotation.y = Math.PI / 2;
  const next = placeBesideAircraft(
    pose(),
    "world",
    new Vector3(10, 5, 20),
    aircraft,
  );
  expect(next.position[0]).toBeCloseTo(90);
  expect(next.position[1]).toBeCloseTo(47);
  expect(next.position[2]).toBeCloseTo(172);
  expect(next.rotation).toEqual([0, 20, 0]);
  expect(next.scale).toEqual([2, 1, 3]);
});

test("beside placement retains an aircraft anchor and uses a local offset", () => {
  const aircraft = new Group();
  aircraft.position.set(100, 50, 200);
  aircraft.rotation.set(0.4, 1.2, -0.7);
  const next = placeBesideAircraft(
    pose(),
    "aircraft",
    new Vector3(10, 5, 20),
    aircraft,
  );
  next.position.forEach((n, i) => expect(n).toBeCloseTo([8, 2, 0][i], 8));
});

test("ground placement accounts for the transformed bottom and highest sampled footprint", () => {
  const original = pose();
  const box = new Box3(new Vector3(10, 3, 20), new Vector3(14, 15, 24));
  const next = placeOnGround(original, box, (x, z) =>
    x === 14 && z === 24 ? 9 : 5,
  )!;
  expect(next.position).toEqual([3, 13, -4]);
  expect(next.rotation).toEqual([0, 20, 0]);
  expect(next.scale).toEqual([2, 1, 3]);
  expect(original.position).toEqual([3, 7, -4]);
});

test("ground placement uses bounds after rotation and scale", () => {
  const object = new Group();
  object.position.set(3, 20, 4);
  object.rotation.z = Math.PI / 2;
  object.scale.set(2, 1, 1);
  object.add(new Mesh(new BoxGeometry(4, 10, 2)));
  const transform: Transform = {
    position: [3, 20, 4],
    rotation: [0, 0, 90],
    scale: [2, 1, 1],
  };
  const next = placeOnGround(
    transform,
    boundsInFrame(object, new Matrix4())!,
    () => 2,
  )!;
  expect(next.position[1]).toBeCloseTo(6);
});

test("ground placement rejects empty or nonfinite surface measurements", () => {
  expect(placeOnGround(pose(), new Box3(), () => 0)).toBeNull();
  const box = new Box3(new Vector3(0, 0, 0), new Vector3(2, 2, 2));
  expect(placeOnGround(pose(), box, () => NaN)).toBeNull();
});

test("dimensions follow the current morph pose rather than the full animation envelope", () => {
  const geometry = new BoxGeometry(2, 4, 6);
  const target = geometry.attributes.position.clone();
  for (let i = 0; i < target.count; i++) target.setX(i, target.getX(i) * 2);
  geometry.morphAttributes.position = [target];
  const mesh = new Mesh(geometry);
  mesh.morphTargetInfluences![0] = 0.5;
  expect(
    boundsInFrame(mesh, new Matrix4())?.getSize(new Vector3()).toArray(),
  ).toEqual([3, 4, 6]);
});

// The same anchor > root > mesh graph StudioSceneRenderer builds.
function instance() {
  const anchor = new Group(),
    root = new Group();
  root.add(new Mesh(new BoxGeometry(2, 4, 6)));
  anchor.add(root);
  return { anchor, root };
}
const flatScene = {
  origin: new Vector3(),
  aircraft: new Group(),
  height: () => 0,
};
const actions: PlacementAction[] = ["beside", "ground", "size"];

test("no placement command applies to locked, light, hidden or unloaded objects", () => {
  const cube = newObject("cube", [0, 0, 0]);
  const { anchor, root } = instance();
  const refused = (object: SceneObject, model: Group | null) =>
    actions.every(
      (action) =>
        placeSceneObject(object, model, 0, action, flatScene, 10) === null,
    );
  expect(refused({ ...cube, locked: true }, root)).toBe(true);
  expect(refused({ ...cube, kind: "light" }, root)).toBe(true);
  expect(refused(cube, null)).toBe(true);
  anchor.visible = false;
  expect(refused(cube, root)).toBe(true);
});

test("ground placement refuses aircraft-anchored objects", () => {
  const object = { ...newObject("cube", [0, 0, 0]), anchor: "aircraft" as const };
  expect(
    placeSceneObject(object, instance().root, 0, "ground", flatScene),
  ).toBeNull();
});

test("resizing measures in the anchor frame so a banked aircraft does not skew it", () => {
  const { anchor, root } = instance();
  anchor.rotation.x = Math.PI / 4;
  const object = { ...newObject("cube", [0, 0, 0]), anchor: "aircraft" as const };
  const next = placeSceneObject(object, root, 0, "size", flatScene, 12)!;
  next.scale.forEach((n) => expect(n).toBeCloseTo(2, 8));
});

test("ground placement samples terrain at world coordinates, not origin-relative ones", () => {
  const { anchor, root } = instance();
  anchor.position.set(1000, 0, 2000);
  root.position.set(3, 50, 4);
  const sampled: number[][] = [];
  const object = newObject("cube", [3, 50, 4]);
  const next = placeSceneObject(object, root, 0, "ground", {
    ...flatScene,
    origin: anchor.position,
    height: (x, z) => {
      sampled.push([x, z]);
      return 9;
    },
  })!;
  expect(sampled.length).toBe(25);
  expect(sampled.every(([x, z]) => x > 1000 && z > 2000)).toBe(true);
  // The 4 m box's bottom starts at 48 and comes down to the ground at 9.
  expect(next.position).toEqual([3, 11, 4]);
});

test("placement uses the pose at the requested playhead for keyed objects", () => {
  const { root } = instance();
  const first: Transform = {
    position: [0, 0, 0],
    rotation: [0, 33, 0],
    scale: [1, 1, 1],
  };
  const object: SceneObject = {
    ...newObject("cube", [9, 9, 9]),
    keys: [
      { t: 0, transform: first, ease: "linear" },
      { t: 10, transform: { ...first, rotation: [0, 77, 0] }, ease: "linear" },
    ],
  };
  const next = placeSceneObject(object, root, 10, "beside", flatScene)!;
  expect(next.rotation).toEqual([0, 77, 0]);
});

test("measurements round to the millimeter and need a visible anchor", () => {
  const { anchor, root } = instance();
  root.scale.set(1.00049, 1, 1);
  expect(measureObject(root)).toEqual([2.001, 4, 6]);
  anchor.visible = false;
  expect(measureObject(root)).toBeNull();
  expect(measureObject(null)).toBeNull();
});

function inspector(values: Partial<SceneObject>, dimensions: Vec3 | null) {
  return renderToStaticMarkup(
    createElement(SceneObjectInspector, {
      object: { ...newObject("cube", [0, 0, 0]), ...values },
      time: 0,
      disabled: false,
      dimensions,
      placementDisabled: !dimensions,
      onPlace: () => {},
      onUpdate: () => {},
      onPose: () => {},
      onKey: () => {},
      onRemoveKey: () => {},
      onSeek: () => {},
    }),
  );
}
const button = (html: string, label: string) =>
  html.match(new RegExp(`<button[^>]*>${label}</button>`))?.[0];

test("inspector shows the measured size and offers placement on a measured object", () => {
  const html = inspector({}, [2, 4, 6]);
  expect(html).toContain("W 2 · H 4 · D 6 m");
  expect(button(html, "Place beside aircraft")).not.toContain("disabled");
  expect(button(html, "Place on ground")).not.toContain("disabled");
});

test("inspector offers ground placement to world-anchored objects only", () => {
  const html = inspector({ anchor: "aircraft" }, [2, 4, 6]);
  expect(button(html, "Place beside aircraft")).not.toContain("disabled");
  expect(button(html, "Place on ground")).toContain("disabled");
});

test("inspector disables placement until a model can be measured", () => {
  const html = inspector({}, null);
  expect(html).toContain("Select a visible, loaded model");
  expect(button(html, "Place beside aircraft")).toContain("disabled");
  expect(button(html, "Place on ground")).toContain("disabled");
});
