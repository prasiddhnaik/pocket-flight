import { expect, test } from "bun:test";
import * as T from "three";
import { aircraftCatalog, runtimeAircraftCatalog } from "../lab/aircraft";
import {
  fleetMeasurements,
  runtimeWingForAircraft,
  wingForAircraft,
} from "../lab/catalog";
import { AircraftMechanics, mechanismPose } from "../lab/mechanics";
import { batchStaticMeshes } from "../lab/render-batching";
import { measureAureliaLab } from "../scripts/measure-aurelia-lab";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import {
  poseAureliaExterior,
  neutralExteriorPose,
} from "../src/aircraft/aurelia/exterior-mechanisms";
import { solveWing } from "../lab/solver";

test("Aurelia lab geometry matches the current Phenom export without changing runtime calibration", async () => {
  const measured = await measureAureliaLab();
  expect(aircraftCatalog.aurelia.asset).toBe("aurelia-phenom300e.glb");
  expect(runtimeAircraftCatalog.aurelia.asset).toBe("aurelia-flight.glb");
  expect(measured).toEqual(fleetMeasurements.find((m) => m.id === "aurelia"));
  expect(wingForAircraft("aurelia").revision).toBe(measured.revision);
  expect(runtimeWingForAircraft("aurelia").revision).not.toBe(
    measured.revision,
  );
  expect(measured.dimensions[0]).toBeCloseTo(15.64 * 1.155, 5);
  expect(measured.dimensions[2]).toBeCloseTo(15.91 * 1.155, 5);
  expect(measured.mainWingSpan).toBeLessThan(measured.dimensions[0] - 1);
  const solution = solveWing(
    wingForAircraft("aurelia"),
    { speed: 45, density: 1.225, alpha: 4 },
    96,
  );
  expect(solution.span).toBeCloseTo(measured.mainWingSpan, 5);
  expect(solution.residual).toBeLessThan(1e-10);
  expect(solution.cl).toBeGreaterThan(0);
});

test("batched Phenom gear, swept hinges and entry doors follow the new model's native rig", async () => {
  const asset = new URL(
    "../public/assets/aurelia-phenom300e.glb",
    import.meta.url,
  );
  const { scene, animations } = await loadGeometryOnly(asset, true);
  const expected = (await loadGeometryOnly(asset)).scene;
  const rig = new AircraftMechanics(scene, "aurelia", animations);
  const names = [
    "Main_wheel_Left",
    "Main_wheel_Right",
    "Nose_wheel",
    "Aileron_Right",
    "Flap_Right",
    "Flap_carriage_Right_0",
    "Passenger_entry_hinge",
    "Cockpit_door_hinge",
  ];
  const rest = names.map((name) =>
    scene.getObjectByName(name)!.matrixWorld.clone(),
  );
  for (const root of rig.getMovingRoots()) batchStaticMeshes(root);
  batchStaticMeshes(scene);
  expect(
    scene.getObjectByName("Mechanical_oleo_Main_gear_Right"),
  ).toBeUndefined();
  for (const time of [0, 3, 9, 16, 24, 31, 35.9, 9, 16, 0]) {
    const pose = mechanismPose(time, "all");
    rig.apply(pose, time);
    poseAureliaExterior(expected, {
      ...pose,
      steering: pose.yaw,
      fan: time * 2.4,
      entry: pose.canopy,
      cockpitDoor: pose.canopy,
    });
    expected.updateWorldMatrix(true, true);
    for (const name of names) {
      const actual = scene.getObjectByName(name)!.matrixWorld.elements;
      const target = expected.getObjectByName(name)!.matrixWorld.elements;
      actual.forEach((value, i) => expect(value).toBeCloseTo(target[i], 6));
    }
  }
  rig.apply(mechanismPose(16, "gear"), 16);
  for (const [i, name] of names.slice(0, 3).entries()) {
    const down = new T.Vector3().setFromMatrixPosition(rest[i]);
    expect(
      scene.getObjectByName(name)!.getWorldPosition(new T.Vector3()).y,
    ).toBeGreaterThan(down.y + 0.5);
  }
  rig.reset();
  poseAureliaExterior(expected, neutralExteriorPose());
  expected.updateWorldMatrix(true, true);
  for (const name of names)
    expect(scene.getObjectByName(name)!.matrixWorld.elements).toEqual(
      expected.getObjectByName(name)!.matrixWorld.elements,
    );
});
