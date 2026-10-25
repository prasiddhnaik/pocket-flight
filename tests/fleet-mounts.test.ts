import { expect, test } from "bun:test";
import * as T from "three";
import { seatMechanicalAnchor } from "../lab/attachment-mounts";
import { AttachmentChecker } from "../scripts/aurelia-attachments";
import { orderFleetAttachmentChecks } from "../scripts/fleet-attachment-order";

test("offline traversal ordering preserves transforms and contact groups", () => {
  const root = new T.Group();
  for (const [name, x, segments] of [
    ["body", 0, 12],
    ["attached", 0.5, 1],
    ["detached", 3, 1],
  ] as const) {
    const mesh = new T.Mesh(
      new T.BoxGeometry(1, 1, 1, segments, segments, segments),
    );
    mesh.name = name;
    mesh.position.x = x;
    root.add(mesh);
  }
  root.updateMatrixWorld(true);
  const before = new Map(
    root.children.map((n) => [n.name, [...n.matrixWorld.elements]]),
  );
  const checker = new AttachmentChecker();
  const normalize = (groups: string[][]) =>
    groups.map((g) => [...g].sort()).sort((a, b) => a[0].localeCompare(b[0]));
  const contacts = normalize(checker.check(root, false, "body").detached);
  orderFleetAttachmentChecks(root);
  root.updateMatrixWorld(true);
  for (const node of root.children)
    expect(node.matrixWorld.elements).toEqual(before.get(node.name));
  expect(normalize(checker.check(root, false, "body").detached)).toEqual(
    contacts,
  );
});

test("generated actuator seats touch structure, preserve it, and batch repeated anchors", () => {
  const root = new T.Group(),
    body = new T.Mesh(new T.BoxGeometry(1, 1, 1));
  body.name = "body";
  root.add(body);
  const original = Array.from(body.geometry.getAttribute("position").array);
  seatMechanicalAnchor(root, root, new T.Vector3(0, 0.65, 0), new Set());
  seatMechanicalAnchor(root, root, new T.Vector3(0.2, 0.65, 0), new Set());
  seatMechanicalAnchor(root, root, new T.Vector3(0.2, 0.65, 0), new Set());
  expect(root.children.filter((c) => c.userData.anchorSeat)).toHaveLength(1);
  expect(new AttachmentChecker().check(root, false, "body").detached).toEqual(
    [],
  );
  expect(Array.from(body.geometry.getAttribute("position").array)).toEqual(
    original,
  );
});

test("suspension collar guide stays on the fixed leg during carrier compression", () => {
  const root = new T.Group(),
    leg = new T.Group(),
    body = new T.Mesh(new T.BoxGeometry(0.2, 1, 0.2));
  body.name = "body";
  leg.add(body);
  root.add(leg);
  const carrier = new T.Group();
  carrier.name = "Mechanical_oleo_test";
  leg.add(carrier);
  const wheel = new T.Group();
  wheel.name = "rotating_wheel";
  carrier.add(wheel);
  const collar = new T.Mesh(new T.CylinderGeometry(0.06, 0.06, 0.02, 24));
  collar.position.set(0.15, 0.2, 0);
  collar.name = "collar";
  carrier.add(collar);
  // The collar is represented by an instance in production and is not an
  // original carrier surface, so only rotating native children are candidates.
  carrier.remove(collar);
  seatMechanicalAnchor(
    root,
    carrier,
    new T.Vector3(0.15, 0.2, 0),
    new Set([carrier, wheel]),
  );
  carrier.add(collar);
  const checker = new AttachmentChecker();
  for (let i = 0; i <= 16; i++) {
    carrier.position.y = i * 0.01;
    expect(checker.check(root, false, "body").detached).toEqual([]);
  }
});

test("cockpit control bases retain contact under combined rotation and pedal travel", () => {
  const root = new T.Group(),
    body = new T.Mesh(new T.BoxGeometry(1, 1, 1));
  body.name = "body";
  root.add(body);
  const stick = new T.Group();
  stick.name = "Mechanical_control_stick";
  stick.position.set(0, 0.7, 0);
  root.add(stick);
  const pedal = new T.Group();
  pedal.name = "Mechanical_pedal_1";
  pedal.position.set(0.2, 0.7, 0);
  root.add(pedal);
  const moving = new Set<T.Object3D>([stick, pedal]);
  seatMechanicalAnchor(root, stick, new T.Vector3(0, 0.7, 0), moving);
  seatMechanicalAnchor(root, pedal, new T.Vector3(0.2, 0.7, 0), moving);
  stick.add(
    new T.Mesh(
      new T.CylinderGeometry(0.019, 0.019, 0.4, 24).translate(0, 0.2, 0),
    ),
  );
  const direction = new T.Vector3(0, 0.065, 0.04);
  pedal.add(
    new T.Mesh(
      new T.CylinderGeometry(0.03, 0.03, direction.length(), 24)
        .applyQuaternion(
          new T.Quaternion().setFromUnitVectors(
            new T.Vector3(0, 1, 0),
            direction.clone().normalize(),
          ),
        )
        .translate(...direction.multiplyScalar(0.5).toArray()),
    ),
  );
  const checker = new AttachmentChecker();
  for (let i = 0; i <= 20; i++) {
    stick.rotation.set(0.22 * Math.sin(i), 0, 0.18 * Math.cos(i));
    pedal.position.z = -0.05 + i * 0.005;
    expect(checker.check(root, false, "body").detached).toEqual([]);
  }
});
