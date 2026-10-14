import { expect, test } from "bun:test";
import * as T from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { AURELIA_GEAR_STOW_TIME } from "../src/aurelia-motion";
import {
  aureliaBays,
  bayCeilingHeight,
  bellyDoorHeight,
} from "../scripts/aurelia-gear-bays";
import { wheelPose } from "../src/airframe-contact";
import { AircraftMechanics } from "../lab/mechanics";

async function aircraft() {
  const { scene, animations } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-flight.glb", import.meta.url),
    true,
  );
  const tracks = [
    ...new Map(
      animations
        .flatMap((c) => c.tracks)
        .filter((t) => /retraction_hinge|door_hinge/.test(t.name))
        .map((t) => [t.name, t]),
    ).values(),
  ];
  const mixer = new T.AnimationMixer(scene);
  mixer.clipAction(new T.AnimationClip("gear", -1, tracks)).play();
  return {
    scene,
    pose(extension: number) {
      mixer.setTime((1 - extension) * AURELIA_GEAR_STOW_TIME);
      scene.updateMatrixWorld(true);
    },
  };
}

// Indexed meshes can retain unused authoring vertices after removing a panel.
// Clearance concerns the triangles that actually render, not those orphan vertices.
function surfaceBounds(node: T.Object3D) {
  const bounds = new T.Box3();
  node.traverse((mesh) => {
    if (!(mesh instanceof T.Mesh)) return;
    const p = mesh.geometry.getAttribute("position"),
      ix = mesh.geometry.index;
    for (let i = 0; i < (ix?.count ?? p.count); i++)
      bounds.expandByPoint(
        new T.Vector3()
          .fromBufferAttribute(p, ix ? ix.getX(i) : i)
          .applyMatrix4(mesh.matrixWorld),
      );
  });
  return bounds;
}

test("all six Aurelia wheels stay below the passenger floor throughout retraction", async () => {
  const { scene, pose } = await aircraft();
  const wheels: T.Object3D[] = [];
  scene.traverse((n) => {
    if (!(n instanceof T.Mesh) && /^(Main|Nose)_wheel_/.test(n.name))
      wheels.push(n);
  });
  expect(wheels).toHaveLength(6);
  for (let step = 0; step <= 100; step++) {
    pose(step / 100);
    for (const wheel of wheels) {
      const bounds = surfaceBounds(wheel);
      expect(bounds.max.y).toBeLessThan(2.38 - 0.025);
    }
  }
});

test("stowed wheels fit sealed bays and belly doors cover every tire from below", async () => {
  const { scene, pose } = await aircraft();
  pose(0);
  for (const [name, doorName] of [
    ["Main_gear_Left_retraction_hinge", "Main_door_hinge_-1"],
    ["Main_gear_Right_retraction_hinge", "Main_door_hinge_1"],
    ["Nose_gear_retraction_hinge", "NoseDoors"],
  ]) {
    const gear = scene.getObjectByName(name)!;
    const ceiling = scene.getObjectByName(
      name.startsWith("Main")
        ? `MainBayCeiling_${name.includes("Left") ? "Left" : "Right"}`
        : "NoseBayCeiling",
    );
    expect(ceiling).toBeTruthy();
    const bay = aureliaBays.find(
      (b) =>
        b.name ===
        (name.startsWith("Main")
          ? `MainBay_${name.includes("Left") ? "Left" : "Right"}`
          : "NoseBay"),
    )!;
    gear.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      const p = node.geometry.getAttribute("position"),
        ix = node.geometry.index;
      for (let i = 0; i < (ix?.count ?? p.count); i++) {
        const point = new T.Vector3()
          .fromBufferAttribute(p, ix ? ix.getX(i) : i)
          .applyMatrix4(node.matrixWorld);
        expect(point.y).toBeLessThan(bayCeilingHeight(bay, point.z) - 0.0325);
      }
    });
    const doors = name.startsWith("Main")
      ? [scene.getObjectByName(doorName)!]
      : [
          scene.getObjectByName("Nose_door_hinge_1")!,
          scene.getObjectByName("Nose_door_hinge_-1")!,
        ];
    gear.traverse((wheel) => {
      if (wheel instanceof T.Mesh || !/^(Main|Nose)_wheel_/.test(wheel.name))
        return;
      const box = new T.Box3().setFromObject(wheel, true);
      const bay = aureliaBays.find(
        (b) =>
          b.name ===
          (name.startsWith("Main")
            ? `MainBay_${name.includes("Left") ? "Left" : "Right"}`
            : "NoseBay"),
      )!;
      const volume = new T.Box3(
        new T.Vector3(bay.x - bay.half, bay.bottom + 0.035, bay.front),
        new T.Vector3(bay.x + bay.half, bay.top - 0.015, bay.back),
      );
      expect(volume.containsBox(box)).toBe(true);
      for (const x of [box.min.x + 0.01, box.max.x - 0.01])
        for (const z of [box.min.z + 0.01, box.max.z - 0.01]) {
          const ray = new T.Raycaster(
            new T.Vector3(x, 0.1, z),
            new T.Vector3(0, 1, 0),
          );
          const hits = ray.intersectObjects(doors, true);
          expect(hits.length).toBeGreaterThan(0);
          expect(hits[0].point.y).toBeLessThan(box.min.y - 0.025);
        }
    });
  }
});

test("nose bay roof steps down below the passenger floor at the cabin entrance", async () => {
  const { scene } = await aircraft();
  const ceiling = scene.getObjectByName("NoseBayCeiling") as T.Mesh;
  const p = ceiling.geometry.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const vertex = new T.Vector3()
      .fromBufferAttribute(p, i)
      .applyMatrix4(ceiling.matrixWorld);
    if (vertex.z >= -8.3) expect(vertex.y).toBeLessThan(2.38);
  }
  expect(bayCeilingHeight(aureliaBays[2], -8.3) + 0.0125).toBeLessThan(2.38);
});

test("tester door actuators mount on the inner face of the closed belly panels", async () => {
  const { scene, animations } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-flight.glb", import.meta.url),
    true,
  );
  const rig = new AircraftMechanics(scene, "aurelia", animations);
  rig.apply(
    {
      gear: 0,
      compression: 0,
      roll: 0,
      pitch: 0,
      yaw: 0,
      flaps: 0,
      canopy: 0,
      power: 0,
    },
    0,
  );
  let checked = 0;
  scene.traverse((node) => {
    if (!(node instanceof T.InstancedMesh)) return;
    for (const record of node.userData.doorHardwareInstances ?? []) {
      const transform = new T.Matrix4();
      node.getMatrixAt(record.index, transform);
      transform.premultiply(node.matrixWorld);
      const p = node.geometry.getAttribute("position");
      let bottom = Infinity;
      for (let i = 0; i < p.count; i++)
        bottom = Math.min(
          bottom,
          new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(transform).y,
        );
      const bay = record.hinge.startsWith("Nose")
        ? aureliaBays[2]
        : aureliaBays[0];
      expect(bottom).toBeGreaterThan(bay.bottom + 0.0225);
      checked++;
    }
  });
  expect(checked).toBe(8);
});

test("belly doors stay clear of the actual tire surfaces throughout travel and close only after folding", async () => {
  const { scene, pose } = await aircraft();
  const doors = [
    "Main_door_hinge_-1",
    "Main_door_hinge_1",
    "Nose_door_hinge_-1",
    "Nose_door_hinge_1",
  ].map((n) => scene.getObjectByName(n)!);
  const wheels: T.Object3D[] = [];
  scene.traverse((n) => {
    if (!(n instanceof T.Mesh) && /^(Main|Nose)_wheel_/.test(n.name))
      wheels.push(n);
  });
  for (let step = 0; step <= 100; step++) {
    const extension = step / 100;
    pose(extension);
    for (const door of doors) {
      const bounds = surfaceBounds(door);
      for (const wheel of wheels)
        expect(bounds.intersectsBox(surfaceBounds(wheel))).toBe(false);
      if (extension > 0.18)
        expect(Math.abs(door.rotation.z)).toBeGreaterThan(1.6);
      if (extension === 0) expect(Math.abs(door.rotation.z)).toBeLessThan(1e-5);
    }
  }
});

test("flight contact geometry follows all six rendered wheel centres through the new aft fold", async () => {
  const { scene, pose } = await aircraft();
  const names = [
    "Nose_wheel_-1",
    "Nose_wheel_1",
    "Main_wheel_Left_-027",
    "Main_wheel_Left_027",
    "Main_wheel_Right_-027",
    "Main_wheel_Right_027",
  ];
  for (let step = 0; step <= 100; step++) {
    const extension = step / 100;
    pose(extension);
    names.forEach((name, index) => {
      const rendered = scene
        .getObjectByName(name)!
        .getWorldPosition(new T.Vector3())
        .multiplyScalar(0.55);
      rendered.y -= 1.265;
      // Native curves are sampled at 24 fps; contacts use their analytic path.
      expect(
        rendered.distanceTo(wheelPose("aurelia", index, extension).center),
      ).toBeLessThan(0.0005);
    });
  }
});

test("closed doors follow the continuous belly skin with a narrow perimeter seam", async () => {
  const { scene, pose } = await aircraft();
  pose(0);
  for (const bay of aureliaBays) {
    const fairing = scene.getObjectByName("Integrated_belly_fairing") as T.Mesh;
    const p = fairing.geometry.getAttribute("position");
    for (const x of [bay.x - bay.half, bay.x + bay.half]) {
      const join = new T.Vector3();
      let distance = Infinity;
      for (let i = 0; i < p.count; i++) {
        const v = new T.Vector3()
          .fromBufferAttribute(p, i)
          .applyMatrix4(fairing.matrixWorld);
        const d = Math.hypot(v.x - x, v.z - bay.front);
        if (d < distance) {
          distance = d;
          join.copy(v);
        }
      }
      expect(distance).toBeLessThan(0.00001);
      expect(Math.abs(join.y - bellyDoorHeight(bay, x))).toBeLessThan(0.00001);
    }
    for (const side of bay.side ? [bay.side] : [-1, 1]) {
      const door = scene.getObjectByName(`${bay.name}_door_${side}`) as T.Mesh;
      const vertices = door.geometry.getAttribute("position");
      // First half is the outer skin; the second half is the inner sandwich face.
      for (let i = 0; i < vertices.count / 2; i++) {
        const v = new T.Vector3()
          .fromBufferAttribute(vertices, i)
          .applyMatrix4(door.matrixWorld);
        expect(Math.abs(v.y - bellyDoorHeight(bay, v.x))).toBeLessThan(0.00001);
      }
      const bounds = surfaceBounds(door);
      expect(bounds.min.z - bay.front).toBeCloseTo(0.003, 5);
      expect(bay.back - bounds.max.z).toBeCloseTo(0.003, 5);
    }
  }
});
