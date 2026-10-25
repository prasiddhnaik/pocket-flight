import { expect, test } from "bun:test";
import * as T from "three";
import {
  AttachmentChecker,
  attachmentTolerance,
  floorDatum,
} from "../scripts/aurelia-attachments";
import { distance, tree, triangles } from "../scripts/triangle-distance";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import {
  neutralExteriorPose,
  poseAureliaExterior,
} from "../src/aircraft/aurelia/exterior-mechanisms";

test("attachment distance rejects separated surfaces even when their bounding boxes overlap", () => {
  const triangle = (points: number[]) => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3));
    return new T.Mesh(geometry);
  };
  const a = triangle([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  const b = triangle([1, 1, 0, 1, 0.6, 0, 0.6, 1, 0]);
  expect(
    new T.Box3().setFromObject(a).intersectsBox(new T.Box3().setFromObject(b)),
  ).toBe(true);
  expect(distance(tree(triangles(a)), tree(triangles(b))).metres).toBeCloseTo(
    Math.SQRT2 * 0.3,
    6,
  );
});
test("attachment distance resolves known separation and intersection", () => {
  const a = new T.Mesh(new T.BoxGeometry(1, 1, 1)),
    b = new T.Mesh(new T.BoxGeometry(1, 1, 1));
  b.position.set(1.3, 1.4, 0);
  b.updateMatrixWorld(true);
  expect(distance(tree(triangles(a)), tree(triangles(b))).metres).toBeCloseTo(
    0.5,
    7,
  );
  b.position.set(0.25, 0.25, 0);
  b.updateMatrixWorld(true);
  expect(distance(tree(triangles(a)), tree(triangles(b))).metres).toBe(0);
});
test("attachment cache invalidates after position edits inside overlapping bounds", () => {
  const make = (points: number[], name: string) => {
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(points, 3));
    const mesh = new T.Mesh(geometry);
    mesh.name = name;
    return mesh;
  };
  const root = new T.Group(),
    body = make([0, 0, 0, 1, 0, 0, 0, 1, 0], "Pressure_shell_upper"),
    moving = make([0.1, 0.1, 0, 0.9, 0.1, 0, 0.1, 0.9, 0], "Mutable_triangle");
  root.add(body, moving);
  const checker = new AttachmentChecker();
  expect(checker.check(root).detached).toEqual([]);
  const position = moving.geometry.getAttribute(
    "position",
  ) as T.BufferAttribute;
  position.set([1, 1, 0, 1, 0.6, 0, 0.6, 1, 0]);
  position.needsUpdate = true;
  expect(checker.check(root).detached).toHaveLength(1);
});
test("attachment graph rejects a floating surface merged with an attached one", () => {
  const root = new T.Group(),
    body = new T.Mesh(new T.BoxGeometry(1, 1, 1));
  body.name = "Pressure_shell_upper";
  root.add(body);
  const parts = [0.5, 3].map((x) =>
    new T.BoxGeometry(0.3, 0.3, 0.3).toNonIndexed().translate(x, 0, 0),
  );
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    "position",
    new T.Float32BufferAttribute(
      parts.flatMap((g) => Array.from(g.getAttribute("position").array)),
      3,
    ),
  );
  const merged = new T.Mesh(geometry);
  merged.name = "Merged_support";
  root.add(merged);
  const result = new AttachmentChecker().check(root);
  expect(result.detached).toHaveLength(1);
  expect(result.detached[0][0]).toContain("Merged_support#surface-");
});
test("exported Aurelia has no unsupported mesh groups, including without decorative paint support", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  const checker = new AttachmentChecker();
  // Guard against making the graph pass by hiding or dropping a previously
  // unsupported assembly. Every original issue must still be represented.
  const required = [
    ...[1, 2, 3, 4].map((i) => `Airstair_tread_${i}`),
    ...["Left", "Right"].flatMap((side) => [
      `Main_oleo_${side}`,
      `Main_wheel_${side}_tire`,
      `Main_wheel_${side}_hub_-1`,
      `Main_wheel_${side}_hub_1`,
      `Aileron_skin_${side}`,
      `Elevator_skin_${side}`,
      `Fan_back_${side}`,
      `Fan_spinner_${side}`,
      `Exhaust_${side}`,
      ...Array.from({ length: 22 }, (_, i) => `Fan_blade_${side}_${i}`),
      ...Array.from({ length: 6 }, (_, i) => `Cabin_window_${side}_${i + 1}`),
    ]),
    "Nose_oleo",
    "Nose_wheel_tire",
    "Nose_fork_-1",
    "Nose_fork_1",
    "Nose_wheel_hub_-1",
    "Nose_wheel_hub_1",
    "Instrument_panel_structure",
    "Yoke_column",
    "Yoke_column_1",
    "Locker_pull",
    "Closed_toilet_lid",
    "Inactive_screen",
    "Inactive_screen_1",
    "Inactive_screen_2",
    ...[-1, 1].flatMap((side) => [
      `Touch_controller_placeholder_${side}`,
      `Thrust_lever_${side}`,
      ...[-1, 1].map((pedal) => `Rudder_pedal_${side}_${pedal}`),
    ]),
  ];
  for (const name of required) {
    const object = scene.getObjectByName(name);
    expect(object, `original part retained: ${name}`).toBeInstanceOf(T.Mesh);
    expect(object?.visible, `original part visible: ${name}`).toBe(true);
  }
  for (const excludeCosmetics of [false, true]) {
    const result = checker.check(scene, excludeCosmetics);
    expect(result.detached, JSON.stringify(result.detached)).toEqual([]);
  }
  const floor = floorDatum(scene);
  expect(floor.spread).toBeLessThan(attachmentTolerance);
  expect(floor.maximumError).toBeLessThan(attachmentTolerance);
}, 30000);

test("fan stators and toilet hinge seat in their intended fixed mounts", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  const part = (name: string) => {
    const object = scene.getObjectByName(name);
    expect(object, name).toBeInstanceOf(T.Mesh);
    return object as T.Mesh;
  };
  const seated = (a: string, b: string) =>
    expect(
      distance(tree(triangles(part(a))), tree(triangles(part(b)))).metres,
      `${a} seats in ${b}`,
    ).toBeLessThan(attachmentTolerance);
  for (const side of ["Left", "Right"]) {
    seated(`Intake_duct_${side}`, `Intake_lip_${side}`);
    seated(`Exhaust_inner_liner_${side}`, `Exhaust_exit_lip_${side}`);
    seated(`Exhaust_exit_lip_${side}`, `Exhaust_${side}`);
    seated(`Exhaust_dark_${side}`, `Exhaust_inner_liner_${side}`);
    seated(`Exhaust_centrebody_${side}`, `Exhaust_dark_${side}`);
    for (let i = 0; i < 3; i++) {
      seated(`Exhaust_stator_${side}_${i}`, `Exhaust_centrebody_${side}`);
      seated(`Exhaust_stator_${side}_${i}`, `Exhaust_inner_liner_${side}`);
    }
  }
  for (const side of ["Left", "Right"])
    for (let i = 0; i < 3; i++)
      seated(`Fan_stator_support_${side}_${i}`, `Nacelle_${side}`);
  for (const dx of [-0.075, 0.075]) {
    const leaf = T.PropertyBinding.sanitizeNodeName(
      `Toilet_hinge_base_leaf_${dx}`,
    );
    seated("Toilet_base", leaf);
    seated(leaf, "Toilet_lid_hinge");
  }
  seated("Toilet_lid_hinge", "Closed_toilet_lid");
  for (let i = 0; i < 2; i++) {
    seated(`Entry_hinge_bracket_${i}`, "Pressure_shell_lower");
    seated(`Entry_hinge_bracket_${i}`, `Entry_hinge_pin_${i}`);
  }
});

test("flap rollers touch their rails without crossed solids or fixed-fairing intersections throughout travel", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  const part = (name: string) => {
    const object = scene.getObjectByName(name);
    expect(object, name).toBeInstanceOf(T.Mesh);
    return object as T.Mesh;
  };
  for (let step = 0; step <= 100; step++) {
    poseAureliaExterior(scene, { ...neutralExteriorPose(), flaps: step / 100 });
    for (const side of ["Left", "Right"])
      for (let i = 0; i < 2; i++) {
        const roller = part(`Flap_track_roller_${side}_${i}`);
        const rollerTree = tree(triangles(roller));
        for (const railSide of [-1, 1]) {
          const rail = part(`Flap_track_rail_${side}_${i}_${railSide}`);
          const rollerAxis = new T.Vector3(0, 1, 0).transformDirection(
            roller.matrixWorld,
          );
          const railAxis = new T.Vector3(0, 1, 0).transformDirection(
            rail.matrixWorld,
          );
          const normal = rollerAxis.cross(railAxis).normalize();
          const delta = rail
            .getWorldPosition(new T.Vector3())
            .sub(roller.getWorldPosition(new T.Vector3()));
          // Infinite-axis separation bounds the gap of the finite cylinders.
          // The faceted meshes lie inside cylinders of radii 14 and 9 mm.
          expect(Math.abs(delta.dot(normal))).toBeGreaterThan(0.023 - 2e-7);
          expect(
            distance(rollerTree, tree(triangles(rail))).metres,
          ).toBeLessThan(attachmentTolerance);
        }
        const fairing = part("Wing_body_carry_through_fairing");
        for (const moving of [
          roller,
          part(`Flap_carriage_upright_${side}_${i}`),
        ])
          expect(
            distance(tree(triangles(moving)), tree(triangles(fairing))).metres,
            `${moving.name} clears fixed fairing at ${step}%`,
          ).toBeGreaterThan(attachmentTolerance);
      }
  }
}, 30000);

test("fixed entry brackets clear the actual outer door panels throughout opening", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  const part = (name: string) => {
    const object = scene.getObjectByName(name);
    expect(object, name).toBeInstanceOf(T.Mesh);
    return object as T.Mesh;
  };
  const brackets = [0, 1].map((i) =>
    tree(triangles(part(`Entry_hinge_bracket_${i}`))),
  );
  for (let step = 0; step <= 100; step++) {
    poseAureliaExterior(scene, { ...neutralExteriorPose(), entry: step / 100 });
    // The blue _livery piece is part of the actual door skin, not paint trim.
    for (const name of ["Passenger_entry_door", "Passenger_entry_door_livery"])
      for (const bracket of brackets)
        expect(
          distance(bracket, tree(triangles(part(name)))).metres,
          `${name} clears fixed brackets at ${step}%`,
        ).toBeGreaterThan(attachmentTolerance);
  }
}, 30000);
