import { expect, test } from "bun:test";
import { Group, MathUtils, Vector3 } from "three";
import { controlSurfaces } from "../src/control-surfaces";

const fixture = () => {
  const names = ["Aileron_Left", "Aileron_Right", "Elevator", "Rudder"];
  const parts = new Map(names.map((name) => [name, new Group()]));
  return { parts, animation: controlSurfaces(parts) };
};

test("roll, pitch and yaw move trailing edges in the correct directions", () => {
  const { parts, animation } = fixture();
  for (let i = 0; i < 30; i++)
    animation.update({ roll: 1, pitch: 1, yaw: 1 }, 1 / 60);
  const edge = (name: string) =>
    new Vector3(0, 0, 0.4).applyQuaternion(parts.get(name)!.quaternion);
  expect(edge("Aileron_Left").y).toBeLessThan(-0.14);
  expect(edge("Aileron_Right").y).toBeGreaterThan(0.14);
  expect(edge("Elevator").y).toBeGreaterThan(0.16);
  expect(edge("Rudder").x).toBeGreaterThan(0.18);
});

test("combined keyboard and touch inputs stay within hinge travel and release smoothly", () => {
  const { parts, animation } = fixture();
  animation.update({ roll: 2, pitch: -2, yaw: 2 }, 10);
  expect(parts.get("Aileron_Left")!.rotation.x).toBeCloseTo(
    MathUtils.degToRad(22),
  );
  expect(parts.get("Elevator")!.rotation.x).toBeCloseTo(MathUtils.degToRad(25));
  expect(parts.get("Rudder")!.rotation.y).toBeCloseTo(MathUtils.degToRad(28));
  animation.update({ roll: 0, pitch: 0, yaw: 0 }, 1 / 60);
  expect(animation.snapshot().roll).toBeGreaterThan(0.5);
  for (let i = 0; i < 60; i++)
    animation.update({ roll: 0, pitch: 0, yaw: 0 }, 1 / 60);
  expect(Math.abs(animation.snapshot().roll)).toBeLessThan(0.001);
});

test("replay snapshots are independent and restoring a pose leaves no stale deflection", () => {
  const { parts, animation } = fixture();
  animation.apply({ roll: 0.7, pitch: -0.4, yaw: 0.3 });
  const recorded = animation.snapshot();
  animation.reset();
  expect(recorded.roll).toBe(0.7);
  expect(parts.get("Aileron_Left")!.rotation.x).toBe(0);
  animation.apply(recorded);
  expect(animation.snapshot()).toEqual(recorded);
  expect(parts.get("Elevator")!.rotation.x).toBeCloseTo(MathUtils.degToRad(10));
});
