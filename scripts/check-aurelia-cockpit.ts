import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as T from "three";
import {
  aureliaAirframeScale as scale,
  aureliaInteriorLayout,
} from "../src/aircraft/aurelia/exterior-reference";
import {
  aureliaCockpitLayout,
  aureliaPilotEye,
} from "../src/aircraft/aurelia/cockpit-layout";
import {
  cockpitSightlines,
  cockpitSkinContainment,
} from "./aurelia-sightlines";
import { loadGeometryOnly } from "./geometry-loader";
import { triangles } from "./triangle-distance";

const option = (name: string, fallback: string) =>
  Bun.argv.includes(name) ? Bun.argv[Bun.argv.indexOf(name) + 1] : fallback;
const output = resolve(option("--out", "output/aurelia-reference-check"));
const beforeFile = option("--before", "");
const after = await loadGeometryOnly(
  new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
);
const eyes = [-1, 1].map((side) =>
  new T.Vector3(...aureliaPilotEye(scale, side)).multiplyScalar(scale),
);
const layout = aureliaCockpitLayout(scale);
const containment = cockpitSkinContainment(after.scene);
assert.equal(
  containment.escapes.length,
  0,
  JSON.stringify(containment.escapes.slice(0, 5)),
);
assert(
  containment.minimumClearanceMetres > 0.005,
  "Dashboard must remain at least 5 mm inside the actual nose skin",
);
const current = cockpitSightlines(after.scene, eyes);
const windows = [-1, 1].flatMap((side) =>
  ["Windshield", "Cockpit_side_window"].map((prefix) => {
    const name = `${prefix}_${side}`,
      mesh = after.scene.getObjectByName(name) as T.Mesh;
    const centre = new T.Vector3()
      .fromBufferAttribute(mesh.geometry.getAttribute("position"), 0)
      .applyMatrix4(mesh.matrixWorld);
    const areaSquareMetres = triangles(mesh).reduce(
      (sum, t) => sum + new T.Triangle(t.a, t.b, t.c).getArea(),
      0,
    );
    return {
      name,
      centre: centre.toArray(),
      areaSquareMetres,
      previousAreaSquareMetres: null as number | null,
      areaIncreasePercent: null as number | null,
      centreMoveMetres: null as number[] | null,
    };
  }),
);
const windowBefore = option("--window-before", "");
if (windowBefore) {
  const before = await loadGeometryOnly(pathToFileURL(resolve(windowBefore)));
  for (const window of windows) {
    const mesh = before.scene.getObjectByName(window.name) as T.Mesh;
    const original = triangles(mesh).reduce(
      (sum, t) => sum + new T.Triangle(t.a, t.b, t.c).getArea(),
      0,
    );
    const originalCentre = new T.Vector3()
      .fromBufferAttribute(mesh.geometry.getAttribute("position"), 0)
      .applyMatrix4(mesh.matrixWorld);
    window.previousAreaSquareMetres = original;
    window.areaIncreasePercent = (window.areaSquareMetres / original - 1) * 100;
    window.centreMoveMetres = new T.Vector3(...window.centre)
      .sub(originalCentre)
      .toArray();
    assert(
      window.areaSquareMetres > original * 1.1,
      `${window.name}: glazing area must grow at least 10 percent`,
    );
  }
}
let previous: ReturnType<typeof cockpitSightlines> | undefined;
if (beforeFile) {
  const before = await loadGeometryOnly(pathToFileURL(resolve(beforeFile)));
  previous = cockpitSightlines(
    before.scene,
    [-1, 1].map(
      (side) =>
        new T.Vector3(
          side * 0.31 * scale,
          aureliaInteriorLayout.floorY * scale + 1.035,
          -4.58 * scale + 0.02,
        ),
    ),
  );
  for (let i = 0; i < 2; i++) {
    assert(
      current[i].solidAngleSteradians > previous[i].solidAngleSteradians * 1.1,
      "The visible windshield area must improve for both pilots",
    );
  }
  for (const name of ["Nose_wheel", "Main_wheel_Left", "Main_wheel_Right"]) {
    const a = new T.Box3().setFromObject(before.scene.getObjectByName(name)!);
    const b = new T.Box3().setFromObject(after.scene.getObjectByName(name)!);
    assert(
      Math.abs(a.min.y - b.min.y) < 1e-6,
      `${name}: ground contact changed`,
    );
    if (name === "Nose_wheel")
      assert(
        Math.abs(a.min.z - b.min.z - layout.noseShift * scale) < 1e-6,
        "Nose installation translation disagrees with cockpit layout",
      );
    else
      assert(
        a.min.distanceTo(b.min) < 1e-6 && a.max.distanceTo(b.max) < 1e-6,
        `${name}: main gear moved`,
      );
  }
}
for (const view of current)
  assert(
    view.horizonClear,
    "The actual pilot eye must see the horizon through glazing",
  );
for (const view of current)
  assert.equal(
    view.eyeBoxBlocked,
    0,
    "The central view must clear the frame and dashboard throughout the sampled eye box",
  );
await mkdir(output, { recursive: true });
const report = {
  assetSha256: after.sha256,
  layout,
  containment,
  windows,
  forwardMoveMetres: layout.forwardShift * scale,
  previous,
  current,
  scope:
    "Static model visibility through actual windshield triangles, with every opaque triangle tested on both sides. Angular sample grid: yaw -60 to +60, pitch -20 to +34 at 2 degrees. Eye height 1.035 m above the floor in both versions. This is geometric reconstruction, not a certified pilot visibility or ergonomic assessment.",
};
await Bun.write(
  resolve(output, "cockpit-sightlines.json"),
  JSON.stringify(report, null, 2),
);
console.log("AURELIA_COCKPIT_VERIFIED", JSON.stringify(report));
