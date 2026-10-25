import { expect, test } from "bun:test";
import * as T from "three";
import { makeAureliaReference } from "../src/aircraft/aurelia/reference-model";
import { aureliaAirframeScale } from "../src/aircraft/aurelia/exterior-reference";
import { aureliaPilotEye } from "../src/aircraft/aurelia/cockpit-layout";
import {
  cockpitSightlines,
  cockpitSkinContainment,
} from "../scripts/aurelia-sightlines";

for (const scale of [1, aureliaAirframeScale])
  test(`the complete dashboard stays inside actual skin triangles at scale ${scale}`, () => {
    const result = cockpitSkinContainment(makeAureliaReference(scale).root);
    expect(result.probes).toBeGreaterThan(20000);
    expect(result.escapes).toEqual([]);
    expect(result.minimumClearanceMetres).toBeGreaterThan(0.005);
  }, 30000);

test("both seated pilots see the forward horizon and below it through real glazing", () => {
  const root = makeAureliaReference().root;
  const eyes = [-1, 1].map((side) =>
    new T.Vector3(
      ...aureliaPilotEye(aureliaAirframeScale, side),
    ).multiplyScalar(aureliaAirframeScale),
  );
  for (const view of cockpitSightlines(root, eyes)) {
    expect(view.horizonClear).toBe(true);
    expect(Math.min(...view.forwardClearPitchDegrees)).toBeLessThanOrEqual(
      -4.5,
    );
    expect(view.solidAngleSteradians).toBeGreaterThan(0.8);
    expect(view.eyeBoxProbes).toBe(81);
    expect(view.eyeBoxBlocked).toBe(0);
  }
}, 30000);

test("front glazing centres align with both pilots' actual eye lines", () => {
  const { root } = makeAureliaReference();
  root.updateMatrixWorld(true);
  for (const side of [-1, 1]) {
    const eye = new T.Vector3(
      ...aureliaPilotEye(aureliaAirframeScale, side),
    ).multiplyScalar(aureliaAirframeScale);
    const pane = root.getObjectByName(`Windshield_${side}`) as T.Mesh;
    const centre = new T.Vector3()
      .fromBufferAttribute(pane.geometry.getAttribute("position"), 0)
      .applyMatrix4(pane.matrixWorld);
    expect(Math.abs(centre.x - eye.x)).toBeLessThan(0.003);
    expect(Math.abs(centre.y - eye.y)).toBeLessThan(0.003);
    expect(centre.z).toBeLessThan(eye.z - 0.5);
    const hit = new T.Raycaster(eye, new T.Vector3(0, 0, -1)).intersectObject(
      pane,
    )[0];
    expect(hit).toBeDefined();
    expect(hit.point.distanceTo(centre)).toBeLessThan(0.006);
  }
});
