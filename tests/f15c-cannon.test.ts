import { describe, expect, test } from "bun:test";
import { Quaternion, Vector3 } from "three";
import { CannonSimulation, F15C_CANNON, F15C_MUZZLE, cannonPose, segmentSphere } from "../src/flight/cannon";
const input = { firing: true, origin: new Vector3(), direction: new Vector3(0, 0, -1), velocity: new Vector3() };

describe("F-15C cannon", () => {
  test("cadence and flight paths agree across 30 and 120 FPS", () => {
    const a = new CannonSimulation(), b = new CannonSimulation();
    for (let i = 0; i < 60; i++) a.step(1 / 30, input, []);
    for (let i = 0; i < 240; i++) b.step(1 / 120, input, []);
    expect(a.shots).toBe(2 * F15C_CANNON.roundsPerSecond);
    expect(a.ammunition).toBe(b.ammunition);
    expect(a.projectiles.length).toBe(b.projectiles.length);
    expect(a.projectiles[0].position.distanceTo(b.projectiles[0].position)).toBeLessThan(1e-8);
  });
  test("swept hits catch a small target between endpoints", () => {
    expect(segmentSphere(new Vector3(), new Vector3(0, 0, -100), new Vector3(0, 0, -50), 1)).toBeCloseTo(.49);
    const gun = new CannonSimulation();
    const result = gun.step(.1, input, [{ id: "target", position: new Vector3(0, 0, -50), radius: 2 }]);
    expect(result.hits.length).toBeGreaterThan(0);
    expect(gun.hits).toBeGreaterThan(0);
  });
  test("a bullet hits the closest target only", () => {
    const gun = new CannonSimulation();
    const result = gun.step(1 / 120, input, [
      { id: "far", position: new Vector3(0, 0, -6), radius: 1 },
      { id: "near", position: new Vector3(0, 0, -3), radius: 1 },
    ]);
    expect(result.hits.map(hit => hit.target)).toEqual(["near"]);
  });
  test("empty ammunition cannot become negative and projectiles stay bounded", () => {
    const gun = new CannonSimulation();
    for (let i = 0; i < 40; i++) gun.step(1, input, []);
    expect(gun.ammunition).toBe(0);
    expect(gun.shots).toBe(F15C_CANNON.capacity);
    expect(gun.projectiles.length).toBeLessThanOrEqual(F15C_CANNON.maximumProjectiles);
    expect(gun.step(1, input, []).fired).toBe(0);
  });
  test("released trigger stops firing and suspension drops queued partial time", () => {
    const gun = new CannonSimulation();
    gun.step(.25, input, []);
    const shots = gun.shots;
    gun.suspend();
    expect(gun.step(.5, { ...input, firing: false }, []).fired).toBe(0);
    expect(gun.shots).toBe(shots);
    gun.reset();
    expect(gun.ammunition).toBe(940);
    expect(gun.projectiles).toHaveLength(0);
  });
  test("muzzle and barrel direction follow aircraft attitude", () => {
    const position = new Vector3(100, 200, 300);
    const quaternion = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
    const pose = cannonPose(position, quaternion);
    expect(pose.origin.distanceTo(F15C_MUZZLE.clone().applyQuaternion(quaternion).add(position))).toBeLessThan(1e-10);
    expect(pose.direction.distanceTo(new Vector3(-1, 0, 0))).toBeLessThan(1e-10);
  });
});
