import { expect, test } from "bun:test";
import * as T from "three";
import { aircraftCatalog } from "../lab/aircraft";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import {
  AttachmentChecker,
  aircraftMeshes,
} from "../scripts/aurelia-attachments";
import {
  loadFleetAttachmentModel,
  neutralFleetPose,
} from "../scripts/fleet-attachment-model";

test("instanced hardware checks every active instance at its own transform", () => {
  const root = new T.Group();
  const body = new T.Mesh(new T.BoxGeometry(1, 1, 1));
  body.name = "Body";
  const parts = new T.InstancedMesh(
    new T.BoxGeometry(0.4, 0.4, 0.4),
    new T.MeshBasicMaterial(),
    3,
  );
  parts.name = "Hardware";
  parts.count = 2;
  parts.setMatrixAt(0, new T.Matrix4().makeTranslation(0.5, 0, 0));
  parts.setMatrixAt(1, new T.Matrix4().makeTranslation(3, 0, 0));
  root.add(body, parts);
  const checker = new AttachmentChecker();
  expect(aircraftMeshes(root)).toHaveLength(3);
  expect(
    new T.Box3()
      .setFromObject(aircraftMeshes(root)[2])
      .getCenter(new T.Vector3()).x,
  ).toBeCloseTo(3, 7);
  expect(root.children).toHaveLength(2);
  expect(checker.check(root, false, "Body").detached[0][0]).toContain(
    "Hardware_instance_1",
  );
  parts.setMatrixAt(1, new T.Matrix4().makeTranslation(-0.5, 0, 0));
  expect(checker.check(root, false, "Body").detached).toHaveLength(0);
});

test("fleet checker uses the selected body and measures gaps to its connected structure", () => {
  const root = new T.Group();
  for (const [name, x] of [
    ["Test_body", 0],
    ["Far_part", 3],
    ["Near_part", 1.75],
  ] as const) {
    const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1));
    mesh.name = name;
    mesh.position.x = x;
    root.add(mesh);
  }
  const checker = new AttachmentChecker();
  const result = checker.check(root, false, "Test_body");
  expect(result.detached).toHaveLength(2);
  const measured = checker.measureDetached(root, result.detached);
  // The nearby disconnected part cannot masquerade as the airframe support.
  expect(
    measured.find((m) => m.from?.endsWith("Far_part"))!.metres,
  ).toBeCloseTo(2, 7);
  expect(
    measured.find((m) => m.from?.endsWith("Near_part"))!.metres,
  ).toBeCloseTo(0.75, 7);
  expect(measured.every((m) => m.to?.endsWith("Test_body"))).toBe(true);
  expect(() => checker.check(root, false, "Missing_body")).toThrow(
    "Missing primary body mesh",
  );
});

test("Finch audit restores suspension and uses the production control deflections", async () => {
  const model = await loadFleetAttachmentModel("finch");
  model.apply(neutralFleetPose());
  const carrier = model.root.getObjectByName("Suspension_Main_Left")!;
  const rest = carrier.position.clone();
  model.apply({ ...neutralFleetPose(), compression: 1, roll: 1, pitch: 1 });
  expect(carrier.position.y - rest.y).toBeCloseTo(0.16, 8);
  expect(carrier.position.x - rest.x).toBeCloseTo(0.104, 8);
  expect(model.root.getObjectByName("Aileron_Left")!.rotation.x).toBeCloseTo(
    T.MathUtils.degToRad(22),
    8,
  );
  expect(model.root.getObjectByName("Elevator")!.rotation.x).toBeCloseTo(
    T.MathUtils.degToRad(-25),
    8,
  );
  model.apply(neutralFleetPose());
  expect(carrier.position.toArray()).toEqual(rest.toArray());
});

test("jet audit keeps all asset meshes and restores their actual runtime transforms", async () => {
  for (const id of ["peregrine", "stormbird"] as const) {
    const raw = await loadGeometryOnly(
      new URL(`../public/assets/${aircraftCatalog[id].asset}`, import.meta.url),
    );
    const originalNames = aircraftMeshes(raw.scene)
      .map((mesh) => mesh.name)
      .sort();
    const model = await loadFleetAttachmentModel(id);
    model.apply(neutralFleetPose());
    const meshes = aircraftMeshes(model.root);
    expect(meshes.map((mesh) => mesh.name).sort()).toEqual(originalNames); // No effects added and no asset parts dropped.
    const before = meshes.map((m) => [...m.matrixWorld.elements]);
    model.apply({
      ...neutralFleetPose(),
      gear: 0.5,
      compression: 0.6,
      canopy: 0.75,
      roll: 0.7,
      pitch: -0.5,
      yaw: 1,
      flaps: 1,
      phase: 2,
    });
    expect(
      meshes.some((m, i) =>
        m.matrixWorld.elements.some((v, j) => v !== before[i][j]),
      ),
    ).toBe(true);
    model.apply(neutralFleetPose());
    for (let i = 0; i < meshes.length; i++)
      expect(meshes[i].matrixWorld.elements).toEqual(before[i]);
  }
});
