import { expect, test } from "bun:test";
import { Box3, Mesh, Quaternion, Vector3, type Object3D } from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { heronGeometry, heronPropulsion } from "../src/aircraft/heron/design";

const { scene } = await loadGeometryOnly(new URL("../public/assets/heron-ut9.glb", import.meta.url));
scene.updateMatrixWorld(true);
const part = (name: string) => scene.getObjectByName(name)!;
const box = (node: Object3D) => new Box3().setFromObject(node, true);
const triangles = (root: Object3D) => {
  let total = 0;
  root.traverse((node) => {
    if (node instanceof Mesh) total += (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) / 3;
  });
  return total;
};

test("the skin is no heavier than the CAD model it replaced", () => {
  expect(triangles(scene)).toBeLessThanOrEqual(479176);
});

test("it has the Grand Caravan's glazing: a wrapped windshield, crew windows and seven cabin windows a side", () => {
  expect(part("Windshield")).toBeDefined();
  for (const side of ["Left", "Right"]) {
    expect(part(`Crew_window_${side}`)).toBeDefined();
    const row = Array.from({ length: 7 }, (_, i) => box(part(`Cabin_window_${side}_${i + 1}`)));
    for (let i = 1; i < row.length; i++) {
      // Front to back, stepping down with the roof.
      expect(row[i].min.z).toBeGreaterThan(row[i - 1].max.z);
      expect(row[i].max.y).toBeLessThan(row[i - 1].max.y);
    }
  }
  const glass = box(part("Windshield"));
  expect(glass.min.x).toBeLessThan(-0.7);
  expect(glass.max.x).toBeGreaterThan(0.7);
});

test("the wing sits behind the cockpit, where the real aircraft has it, with the propeller lower", () => {
  const wing = box(part("Wing_skin_Left"));
  expect(wing.min.z).toBeCloseTo(0.1, 1);
  expect(box(part("Windshield")).max.z).toBeLessThan(wing.min.z);
  expect(part("Propeller").getWorldPosition(new Vector3()).y).toBeCloseTo(-0.11, 2);
  expect(part("Propeller").userData.hinge[1]).toBeCloseTo(-0.11, 2);
});

test("the tailplane has the real span and the fin reaches the published height", () => {
  expect(box(part("Tailplane_Right")).max.x).toBeCloseTo(3.125, 2);
  expect(box(scene).max.y).toBeCloseTo(2.65, 2);
});

test("flight numbers stay as they were, whatever the skin does", () => {
  expect(heronGeometry.wingArea).toBeCloseTo(26.6852364, 5);
  expect(heronGeometry.meanAerodynamicChord).toBeCloseTo(1.7143084, 5);
  expect(heronGeometry.quarterChordZ).toBeCloseTo(-0.50907, 4);
  expect([...heronPropulsion.thrustCenter]).toEqual([0, 0.23, -3.3]);
});

test("the rudder turns on its raked hinge line and leaves the fin alone", () => {
  const rudder = part("Rudder");
  const hinge = rudder.getWorldPosition(new Vector3());
  expect(hinge.distanceTo(new Vector3(...(rudder.userData.hinge as [number, number, number])))).toBeLessThan(1e-5);
  const axis = new Vector3(0, 1, 0).applyQuaternion(rudder.getWorldQuaternion(new Quaternion()));
  // It rakes aft going up, by the same line the fin's trailing edge follows.
  expect(axis.z).toBeGreaterThan(0.05);
  const pointOnHinge = rudder.localToWorld(new Vector3(0, 2, 0));
  rudder.rotation.y = 0.5;
  scene.updateMatrixWorld(true);
  expect(rudder.localToWorld(new Vector3(0, 2, 0)).distanceTo(pointOnHinge)).toBeLessThan(1e-5);
  rudder.rotation.y = 0;
  scene.updateMatrixWorld(true);
});

test("the elevators hinge behind the tailplane and are cut back to clear the rudder", () => {
  const elevator = part("Elevator");
  expect(elevator.getWorldPosition(new Vector3()).z).toBeCloseTo(7.3, 3);
  for (const side of ["Left", "Right"]) {
    const fixed = box(part(`Tailplane_${side}`)), moving = box(part(`Elevator_skin_${side}`));
    expect(moving.min.z).toBeGreaterThan(fixed.max.z);
    expect(moving.max.z).toBeCloseTo(8.17, 2);
    expect(Math.min(Math.abs(moving.min.x), Math.abs(moving.max.x))).toBeGreaterThan(0.1);
  }
});

test("at full travel the rudder swings past the elevators without touching them", () => {
  const rudder = part("Rudder");
  const inboard: { z: number; x: number }[] = [];
  const point = new Vector3();
  for (const side of ["Left", "Right"])
    part(`Elevator_skin_${side}`).traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const positions = node.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
        inboard.push({ z: point.z, x: Math.abs(point.x) });
      }
    });
  const elevatorHeight = part("Elevator").getWorldPosition(new Vector3()).y;
  let closest = Infinity;
  for (const angle of [-28, 28]) {
    rudder.rotation.y = (angle * Math.PI) / 180;
    scene.updateMatrixWorld(true);
    rudder.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const positions = node.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
        if (Math.abs(point.y - elevatorHeight) > 0.1) continue;
        const nearby = inboard.filter((p) => Math.abs(p.z - point.z) < 0.03);
        if (nearby.length) closest = Math.min(closest, Math.min(...nearby.map((p) => p.x)) - Math.abs(point.x));
      }
    });
  }
  rudder.rotation.y = 0;
  scene.updateMatrixWorld(true);
  expect(Number.isFinite(closest)).toBe(true);
  expect(closest).toBeGreaterThan(0.01);
});

test("the cabin lining stops at the cabin, and the skin behind it is all paint", () => {
  const liner = part("Cabin_liner");
  const positions = (liner as Mesh).geometry.getAttribute("position");
  const point = new Vector3();
  let furthest = -Infinity;
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(liner.matrixWorld);
    furthest = Math.max(furthest, point.z);
  }
  // The belly paint's cut can reach this far; past it there is nothing to line.
  expect(furthest).toBeLessThan(7);
});

test("the propeller clears the ground, and the exhaust stack is on the right only", () => {
  const tip = part("Propeller").getWorldPosition(new Vector3()).y - 1.32;
  expect(tip - -2.05).toBeGreaterThan(0.55);
  expect(scene.getObjectByName("Exhaust_Right")).toBeDefined();
  expect(scene.getObjectByName("Exhaust_Left")).toBeUndefined();
  expect(box(part("Exhaust_Right")).min.x).toBeGreaterThan(0);
});
