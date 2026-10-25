import { expect, test } from "bun:test";
import * as T from "three";
import { makeAureliaReference } from "../src/aircraft/aurelia/reference-model";
import {
  aureliaCockpitPartition as layout,
  aureliaCockpitDoorTravel,
} from "../src/aircraft/aurelia/cockpit-partition";
import {
  aureliaAirframeScale,
  aureliaInteriorLayout,
} from "../src/aircraft/aurelia/exterior-reference";
import {
  neutralExteriorPose,
  poseAureliaExterior,
} from "../src/aircraft/aurelia/exterior-mechanisms";
import { floorDatum } from "../scripts/aurelia-attachments";
import { distance, tree, triangles } from "../scripts/triangle-distance";
import { loadGeometryOnly } from "../scripts/geometry-loader";

const asset = new URL(
  "../public/assets/aurelia-phenom300e.glb",
  import.meta.url,
);
const mesh = (root: T.Object3D, name: string) => {
  const object = root.getObjectByName(name);
  if (!(object instanceof T.Mesh))
    throw new Error(`Missing partition mesh: ${name}`);
  return object;
};

test("aircraft door has metal panels, a rounded frame and a recessed latch", () => {
  const { root } = makeAureliaReference();
  root.updateMatrixWorld(true);
  for (const name of [
    "Cockpit_door_leaf",
    "Cockpit_door_frame",
    "Cockpit_door_flightdeck_face",
    "Cockpit_door_passenger_face",
  ]) {
    const material = mesh(root, name).material as T.MeshStandardMaterial;
    expect(material.metalness, name).toBeGreaterThan(0.6);
  }
  const leaf = mesh(root, "Cockpit_door_leaf");
  const bounds = new T.Box3().setFromObject(leaf);
  const topCorners = leaf.geometry.getAttribute("position");
  const local =
    leaf.geometry.boundingBox ??
    new T.Box3().setFromBufferAttribute(topCorners);
  for (let i = 0; i < topCorners.count; i++)
    if (Math.abs(topCorners.getY(i) - local.max.y) < 1e-6)
      expect(
        Math.min(
          topCorners.getX(i) - local.min.x,
          local.max.x - topCorners.getX(i),
        ),
      ).toBeGreaterThan(0.075);
  for (const name of ["Cockpit_handle_1", "Cockpit_handle_-1"]) {
    const latch = new T.Box3().setFromObject(mesh(root, name));
    expect(latch.min.z).toBeGreaterThan(bounds.min.z);
    expect(latch.max.z).toBeLessThan(bounds.max.z);
  }
});

test("closed partition separates the passenger cabin and cockpit on both faces", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const scale = aureliaAirframeScale;
  const partition = scene.getObjectByName("Cockpit_partition")!;
  for (const side of [-1, 1])
    for (const [x, height] of [
      [0, 0.03],
      [0, 0.65],
      [0, 1.2],
      [-0.4, 0.04],
      [0.4, 0.04],
      [-0.6, 0.65],
      [0.6, 0.65],
      [-0.3, 1.3],
      [0.3, 1.3],
      [0, 1.45],
    ]) {
      const ray = new T.Raycaster(
        new T.Vector3(
          x,
          aureliaInteriorLayout.floorY + height,
          layout.z + side * 0.2,
        ).multiplyScalar(scale),
        new T.Vector3(0, 0, -side),
        0,
        0.4 * scale,
      );
      expect(
        ray.intersectObject(partition, true).length,
        `${side}: ${x},${height}`,
      ).toBeGreaterThan(0);
    }
});

test("open door leaves a clear centre passage over the unchanged level floor", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const scale = aureliaAirframeScale;
  poseAureliaExterior(scene, { ...neutralExteriorPose(), cockpitDoor: 1 });
  const partition = scene.getObjectByName("Cockpit_partition")!;
  // The full 0.30 m walking corridor stays clear across the entire door sweep volume.
  for (const x of [-0.15, 0, 0.15])
    for (const height of [0.025, 0.6, 1.2]) {
      const ray = new T.Raycaster(
        new T.Vector3(
          x,
          aureliaInteriorLayout.floorY + height,
          layout.z + 0.15,
        ).multiplyScalar(scale),
        new T.Vector3(0, 0, -1),
        0,
        0.8 * scale,
      );
      expect(
        ray.intersectObject(partition, true),
        `open passage ${x},${height}`,
      ).toHaveLength(0);
    }
  const floors = ["Cockpit_floor", "Entry_vestibule_floor", "Cabin_floor"].map(
    (name) => scene.getObjectByName(name)!,
  );
  const expectedY = aureliaInteriorLayout.floorY * scale;
  for (const x of [-0.15, 0, 0.15])
    for (let i = 0; i <= 50; i++) {
      const ray = new T.Raycaster(
        new T.Vector3(
          x * scale,
          expectedY + 0.02,
          (layout.z - 0.3 + i * 0.012) * scale,
        ),
        new T.Vector3(0, -1, 0),
        0,
        0.04,
      );
      const hit = ray.intersectObjects(floors, true)[0];
      expect(hit, `continuous doorway carpet ${x},${i}`).toBeDefined();
      expect(hit.point.y).toBeCloseTo(expectedY, 6);
    }
  expect(floorDatum(scene).spread).toBeLessThan(1e-6);
});

test("101 exported door poses clear the frame, floor, seats and entry", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const scale = aureliaAirframeScale;
  const fixed = [
    "Cockpit_partition_wall",
    "Cockpit_door_frame",
    "Cockpit_latch_strike_backplate",
    "Cockpit_latch_strike_lip",
    "Cockpit_latch_strike_bridge_-1",
    "Cockpit_latch_strike_bridge_1",
  ].map((name) => ({ name, surface: tree(triangles(mesh(scene, name))) }));
  const moving: T.Mesh[] = [];
  scene.getObjectByName("Cockpit_door_hinge")!.traverse((object) => {
    // The hinge parts deliberately contact the fixed pins; tested below.
    if (object instanceof T.Mesh && !object.name.startsWith("Cockpit_hinge_"))
      moving.push(object);
  });
  expect(moving.length).toBeGreaterThan(30);
  const seatRear = Math.max(
    ...["Left", "Right"].map(
      (side) =>
        new T.Box3().setFromObject(scene.getObjectByName(`Pilot_seat_${side}`)!)
          .max.z,
    ),
  );
  const entryFront = new T.Box3().setFromObject(
    scene.getObjectByName("Passenger_entry_hinge")!,
  ).min.z;
  for (let step = 0; step <= 100; step++) {
    poseAureliaExterior(scene, {
      ...neutralExteriorPose(),
      cockpitDoor: step / 100,
      entry: step / 100,
    });
    for (const object of moving) {
      const box = new T.Box3().setFromObject(object);
      expect(box.min.y, `${object.name} floor ${step}%`).toBeGreaterThan(
        aureliaInteriorLayout.floorY * scale + 0.006,
      );
      expect(
        box.min.z - seatRear,
        `${object.name} seat ${step}%`,
      ).toBeGreaterThan(0.02);
      expect(
        entryFront - box.max.z,
        `${object.name} entry ${step}%`,
      ).toBeGreaterThan(0.2);
      const surface = tree(triangles(object));
      for (const other of fixed)
        expect(
          distance(surface, other.surface, 0.001).metres,
          `${object.name} / ${other.name} ${step}%`,
        ).toBeGreaterThan(1e-5);
    }
    // Physical pin/knuckle contacts remain connected at intermediate angles.
    for (let i = 0; i < 3; i++)
      expect(
        distance(
          tree(triangles(mesh(scene, `Cockpit_hinge_pin_${i}`))),
          tree(triangles(mesh(scene, `Cockpit_hinge_knuckle_${i}`))),
        ).metres,
      ).toBeLessThan(1e-5);
  }
}, 30000);

test("door resets absolutely and the gear animation never drives the cockpit door", async () => {
  const { scene, animations } = await loadGeometryOnly(asset, true);
  const hinge = scene.getObjectByName("Cockpit_door_hinge")!;
  for (const amount of [1, 0.25, 0.8, 0]) {
    poseAureliaExterior(scene, {
      ...neutralExteriorPose(),
      cockpitDoor: amount,
    });
    expect(hinge.rotation.y).toBeCloseTo(
      aureliaCockpitDoorTravel(amount).angle,
      7,
    );
  }
  const gear = animations.find((clip) => clip.name === "Gear_retract_6s")!;
  expect(gear.tracks.some((track) => track.name.includes("Cockpit"))).toBe(
    false,
  );
  poseAureliaExterior(scene, { ...neutralExteriorPose(), cockpitDoor: 1 });
  const mixer = new T.AnimationMixer(scene);
  mixer.clipAction(gear).play();
  mixer.setTime(3);
  expect(hinge.rotation.y).toBeCloseTo(layout.openAngle, 7);
});

test("latch releases inside its strike before door travel and closes before relatching", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const hinge = scene.getObjectByName("Cockpit_door_hinge")!;
  const bolt = mesh(scene, "Cockpit_latch_bolt");
  const handle = mesh(scene, "Cockpit_handle_1");
  const pivot = mesh(scene, "Cockpit_latch_pivot_1");
  const caseSurface = tree(triangles(mesh(scene, "Cockpit_latch_case")));
  for (const amount of [0, 0.05, 0.1, 0.5, 1, 0.1, 0.05, 0]) {
    poseAureliaExterior(scene, {
      ...neutralExteriorPose(),
      cockpitDoor: amount,
    });
    const travel = aureliaCockpitDoorTravel(amount);
    expect(hinge.rotation.y).toBeCloseTo(travel.angle, 8);
    expect(handle.parent!.rotation.x).toBeCloseTo(travel.release * 0.38, 8);
    expect(bolt.position.x).toBeCloseTo(-0.516 + travel.release * 0.014, 8);
    if (amount <= layout.latchRelease) {
      expect(hinge.rotation.y).toBeCloseTo(0, 12);
      // The bolt stays supported as it slides; it is not a floating decoration.
      expect(distance(tree(triangles(bolt)), caseSurface).metres).toBeLessThan(
        1e-5,
      );
    }
    expect(
      distance(tree(triangles(handle)), tree(triangles(pivot))).metres,
    ).toBeLessThan(1e-5);
  }
  expect(aureliaCockpitDoorTravel(-1)).toEqual(aureliaCockpitDoorTravel(0));
  expect(aureliaCockpitDoorTravel(2)).toEqual(aureliaCockpitDoorTravel(1));
});

test("inspection port and lower panel are fitted through actual door openings", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const hinge = scene.getObjectByName("Cockpit_door_hinge")!;
  const skins = [
    "Cockpit_door_leaf",
    "Cockpit_door_passenger_face",
    "Cockpit_door_flightdeck_face",
  ].map((name) => mesh(scene, name));
  for (const [x, y, fitted] of [
    [-0.26, 1.015, "Cockpit_inspection_lens_1"],
    [-0.26, 0.245, "Cockpit_lower_panel"],
  ] as const) {
    const origin = hinge.localToWorld(new T.Vector3(x, y, 0.15));
    const ray = new T.Raycaster(origin, new T.Vector3(0, 0, -1), 0, 0.2);
    expect(ray.intersectObjects(skins)).toHaveLength(0);
    expect(ray.intersectObject(mesh(scene, fitted)).length).toBeGreaterThan(0);
  }
});

test("partition source and export have identical door transforms throughout travel", async () => {
  const source = makeAureliaReference().root;
  const { scene } = await loadGeometryOnly(asset);
  for (const amount of [0, 0.25, 0.5, 0.75, 1]) {
    const pose = { ...neutralExteriorPose(), cockpitDoor: amount };
    poseAureliaExterior(source, pose);
    poseAureliaExterior(scene, pose);
    for (const name of [
      "Cockpit_partition_wall",
      "Cockpit_door_leaf",
      "Cockpit_handle_1",
      "Cockpit_hinge_knuckle_1",
      "Cockpit_latch_bolt",
      "Cockpit_lower_panel",
      "Cockpit_inspection_lens_1",
    ])
      expect(mesh(source, name).matrixWorld.elements).toEqual(
        mesh(scene, name).matrixWorld.elements,
      );
  }
});
