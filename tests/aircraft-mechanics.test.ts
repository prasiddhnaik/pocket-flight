import { expect, test } from "bun:test";
import * as T from "three";
import {
  AircraftMechanics,
  mechanismPose,
  type MechanismProgramme,
} from "../lab/mechanics";
import { aircraftCatalog, type LabAircraftId } from "../lab/aircraft";
import { batchStaticMeshes } from "../lab/render-batching";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { AureliaEffects } from "../src/aurelia-effects";
import { initialJetInput } from "../src/jet-effects";

test("Aurelia tester stows all four wheels at the same native pose as flight, and scrubs back to gear down", async () => {
  const asset = new URL("../public/assets/aurelia-flight.glb", import.meta.url);
  const { scene, animations } = await loadGeometryOnly(asset, true);
  const flight = await loadGeometryOnly(asset, true);
  const rig = new AircraftMechanics(scene, "aurelia", animations);
  for (const root of rig.getMovingRoots()) batchStaticMeshes(root);
  batchStaticMeshes(scene);
  const effects = new AureliaEffects(flight.scene, flight.animations);
  const wheels: T.Object3D[] = [];
  scene.traverse((node) => {
    if (!(node instanceof T.Mesh) && /^(Main|Nose)_wheel_/.test(node.name))
      wheels.push(node);
  });
  expect(wheels).toHaveLength(4);
  rig.apply(mechanismPose(0, "gear"), 0);
  const down = wheels.map((w) => w.getWorldPosition(new T.Vector3()));
  rig.apply(mechanismPose(16, "gear"), 16);
  effects.motion.gear = 0;
  effects.update(0, initialJetInput());
  wheels.forEach((wheel, index) => {
    const up = wheel.getWorldPosition(new T.Vector3());
    expect(up.y).toBeGreaterThan(down[index].y + 1);
    expect(
      up.distanceTo(
        flight.scene
          .getObjectByName(wheel.name)!
          .getWorldPosition(new T.Vector3()),
      ),
    ).toBeLessThan(1e-5);
  });
  rig.apply(mechanismPose(0, "gear"), 0);
  wheels.forEach((wheel, index) =>
    expect(
      wheel.getWorldPosition(new T.Vector3()).distanceTo(down[index]),
    ).toBeLessThan(1e-5),
  );
  // Revisiting the sealed endpoint must not leave the native one-shot action
  // paused at frame zero after scrubbing back to gear down.
  for (let cycle = 0; cycle < 3; cycle++) {
    rig.apply(mechanismPose(18, "gear"), 18);
    rig.apply(mechanismPose(18, "gear"), 18);
    for (const wheel of wheels)
      expect(
        wheel
          .getWorldPosition(new T.Vector3())
          .distanceTo(
            flight.scene
              .getObjectByName(wheel.name)!
              .getWorldPosition(new T.Vector3()),
          ),
      ).toBeLessThan(1e-5);
    for (const name of [
      "Main_door_hinge_-1",
      "Main_door_hinge_1",
      ...[-1, 1].flatMap((side) =>
        [0, 1].map((leaf) => `Main_tire_door_hinge_${side}_${leaf}`),
      ),
    ])
      expect(Math.abs(scene.getObjectByName(name)!.rotation.z)).toBeLessThan(
        1e-5,
      );
    rig.apply(mechanismPose(0, "gear"), 0);
  }
});

test("mechanical programmes are periodic, bounded and independently selectable", () => {
  for (const programme of [
    "all",
    "gear",
    "controls",
    "power",
    "cockpit",
  ] as MechanismProgramme[]) {
    for (let t = 0; t < 36; t += 0.25) {
      const pose = mechanismPose(t, programme),
        repeated = mechanismPose(t + 36, programme);
      expect(pose).toEqual(repeated);
      expect(Object.values(pose).every(Number.isFinite)).toBe(true);
      expect(pose.gear).toBeGreaterThanOrEqual(0);
      expect(pose.gear).toBeLessThanOrEqual(1);
      expect(pose.canopy).toBeGreaterThanOrEqual(0);
      expect(pose.canopy).toBeLessThanOrEqual(1);
      if (programme === "gear") expect(pose.roll).toBe(0);
      if (programme === "controls") expect(pose.gear).toBe(1);
      if (programme === "cockpit") expect(pose.power).toBe(0);
    }
  }
});

for (const id of Object.keys(aircraftCatalog) as LabAircraftId[]) {
  test(`${id} mechanisms retain movable geometry through batching and deterministic scrubbing`, async () => {
    const { scene, animations } = await loadGeometryOnly(
      new URL(`../public/assets/${aircraftCatalog[id].asset}`, import.meta.url),
      true,
    );
    const original = scene.clone(true);
    const originalPosition = original
      .getObjectByName("Aileron_Right")!
      .getWorldPosition(new T.Vector3());
    const rig = new AircraftMechanics(scene, id, animations);
    expect(rig.diagnostics().hardwareParts).toBeGreaterThan(100);
    const part = scene.getObjectByName("Aileron_Right")!;
    for (const root of rig.getMovingRoots()) batchStaticMeshes(root);
    batchStaticMeshes(scene);
    expect(part.getObjectByProperty("isMesh", true)).toBeTruthy();
    const snapshot = () => {
      const values: number[] = [];
      scene.traverse((node) => {
        values.push(...node.matrixWorld.elements);
        if (node instanceof T.InstancedMesh)
          values.push(
            ...Array.from(node.instanceMatrix.array).slice(0, node.count * 16),
          );
      });
      return values;
    };
    for (const t of [0, 3, 9, 16, 24, 31, 35.9]) {
      rig.apply(mechanismPose(t, "all"), t);
      expect(snapshot().every(Number.isFinite)).toBe(true);
    }
    rig.apply(mechanismPose(9, "all"), 9);
    const first = snapshot();
    rig.apply(mechanismPose(24, "all"), 24);
    rig.apply(mechanismPose(9, "all"), 9);
    const again = snapshot();
    expect(again.length).toBe(first.length);
    for (let i = 0; i < first.length; i++)
      expect(again[i]).toBeCloseTo(first[i], 5);
    expect(Math.abs(part.rotation.x)).toBeGreaterThan(0.05);
    const petals = scene.getObjectByName("Articulated_nozzle_petals");
    if (petals instanceof T.Mesh) {
      rig.apply(mechanismPose(3, "power"), 3);
      const closed = Array.from(petals.geometry.getAttribute("position").array);
      rig.apply(mechanismPose(16, "power"), 16);
      const opened = Array.from(petals.geometry.getAttribute("position").array);
      expect(opened.some((v, i) => Math.abs(v - closed[i]) > 0.001)).toBe(true);
      expect(opened.every(Number.isFinite)).toBe(true);
      expect(
        Array.from(petals.geometry.getAttribute("normal").array).every(
          Number.isFinite,
        ),
      ).toBe(true);
    }
    rig.reset();
    expect(
      part.getWorldPosition(new T.Vector3()).distanceTo(originalPosition),
    ).toBeLessThan(1e-5);
    expect(
      part.quaternion.angleTo(
        original.getObjectByName("Aileron_Right")!.quaternion,
      ),
    ).toBeLessThan(1e-5);
    expect(rig.diagnostics().fixedGear).toBe(id === "finch");
  });
}

test("rebuilt Finch cabin preserves fixed furniture, pilot clearance and mounted canopy supports through travel", async () => {
  const { scene, animations } = await loadGeometryOnly(
    new URL("../public/assets/finch-u2.glb", import.meta.url),
    true,
  );
  scene.updateWorldMatrix(true, true);
  const cockpit: { node: T.Object3D; matrix: T.Matrix4 }[] = [];
  const cabin = scene.getObjectByName("Cockpit")!;
  const canopy = scene.getObjectByName("Canopy")!;
  cabin.traverse((node) => {
    for (
      let ancestor: T.Object3D | null = node;
      ancestor && ancestor !== cabin;
      ancestor = ancestor.parent
    )
      if (
        /^(Canopy$|ControlStick_|RudderPedal_|Throttle$|Canopy_ram_)/.test(
          ancestor.name,
        )
      )
        return;
    cockpit.push({ node, matrix: node.matrixWorld.clone() });
  });
  const glazing: T.Mesh[] = [];
  canopy.traverse((node) => {
    if (node instanceof T.Mesh && node.name.startsWith("Glass_")) {
      (node.material as T.MeshStandardMaterial).side = T.DoubleSide;
      glazing.push(node);
    }
  });
  for (const side of ["Left", "Right"]) {
    const eye = scene
      .getObjectByName(`PilotEye_${side}`)!
      .getWorldPosition(new T.Vector3());
    const roof = new T.Raycaster(eye, new T.Vector3(0, 1, 0)).intersectObjects(
      glazing,
      false,
    );
    expect(roof.length).toBeGreaterThan(0);
    expect(roof[0].distance - 0.09).toBeGreaterThan(0.025);
    const forward = new T.Raycaster(
      eye,
      new T.Vector3(0, 0, -1),
    ).intersectObjects(glazing, false);
    expect(forward[0].object.name).toBe("Glass_Windshield");
  }
  const rig = new AircraftMechanics(scene, "finch", animations);
  // Measured from the exported cabin: includes both side panels and windshield.
  const upperCabin = new T.Box3(
    new T.Vector3(-0.65, 0.75, -1.65),
    new T.Vector3(0.65, 1.4, 1.01),
  );
  const matrix = new T.Matrix4();
  for (let time = 0; time < 36; time += 0.5) {
    rig.apply(mechanismPose(time, "all"), time);
    for (const { node, matrix: original } of cockpit)
      expect(node.matrixWorld.elements).toEqual(original.elements);
    expect(canopy.rotation.x).toBeCloseTo(
      mechanismPose(time, "all").canopy * canopy.userData.opening_radians,
      6,
    );
    for (const [i, side] of ["Left", "Right"].entries()) {
      const support = canopy.userData.supports[i];
      const fixed = cabin.localToWorld(
        new T.Vector3().fromArray(support.fixed),
      );
      const moving = canopy.localToWorld(
        new T.Vector3().fromArray(support.moving),
      );
      const barrel = scene.getObjectByName(`Canopy_ram_barrel_${side}`)!;
      const piston = scene.getObjectByName(`Canopy_ram_piston_${side}`)!;
      expect(
        new T.Vector3(0, -0.5, 0)
          .applyMatrix4(barrel.matrixWorld)
          .distanceTo(fixed),
      ).toBeLessThan(1e-5);
      expect(
        new T.Vector3(0, 0.5, 0)
          .applyMatrix4(piston.matrixWorld)
          .distanceTo(moving),
      ).toBeLessThan(1e-5);
      expect(fixed.distanceTo(moving)).toBeGreaterThan(0.3);
      expect(fixed.distanceTo(moving)).toBeLessThan(0.85);
    }
    rig.details.traverse((node) => {
      if (!(node instanceof T.InstancedMesh)) return;
      node.geometry.computeBoundingBox();
      for (let i = 0; i < node.count; i++) {
        node.getMatrixAt(i, matrix);
        const box = node.geometry.boundingBox!.clone().applyMatrix4(matrix);
        expect(box.intersectsBox(upperCabin)).toBe(false);
      }
    });
  }
});
