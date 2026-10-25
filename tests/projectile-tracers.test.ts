import { expect, test } from "bun:test";
import { Vector3 } from "three";
import { CannonSimulation } from "../src/flight/cannon";
import { ProjectileTracers } from "../src/flight/projectile-tracers";

const shot = { origin: new Vector3(0, 100, 0), direction: new Vector3(0, 0, -1), velocity: new Vector3(80, 5, -150), firing: true };
test("sparse tracer heads follow the real rounds and their optical tails trail the current velocity", () => {
  const gun = new CannonSimulation(), tracers = new ProjectileTracers();
  gun.step(.4, shot, []); tracers.update(gun.projectiles);
  const selected = gun.projectiles.filter(round => round.id % 5 === 0);
  expect(tracers.geometry.instanceCount).toBe(8);
  const head = tracers.geometry.getAttribute("head"), tail = tracers.geometry.getAttribute("tail");
  selected.forEach((round, i) => {
    const tip = new Vector3().fromBufferAttribute(head, i), end = new Vector3().fromBufferAttribute(tail, i);
    expect(tip.distanceTo(round.position)).toBeLessThan(.0001);
    expect(tip.sub(end).dot(round.velocity)).toBeGreaterThan(0);
    expect(tip.length()).toBeLessThanOrEqual(round.velocity.length() * .004 + .0001);
  });
  tracers.update([]); expect(tracers.geometry.instanceCount).toBe(0);
  tracers.dispose();
});
test("impact and expiry remove tracer glows with their physical projectiles, and the pool stays bounded", () => {
  const gun = new CannonSimulation(), tracers = new ProjectileTracers();
  for (let i = 0; i < 240; i++) {
    gun.step(1 / 60, shot, []); tracers.update(gun.projectiles);
    expect(tracers.geometry.instanceCount).toBeLessThanOrEqual(77);
  }
  gun.step(.1, { ...shot, firing: false }, [], { surfaceHeight: () => 1000 });
  tracers.update(gun.projectiles);
  expect(gun.projectiles).toHaveLength(0); expect(tracers.geometry.instanceCount).toBe(0);
  gun.reset(); gun.step(.1, shot, []);
  for (let i = 0; i < 200; i++) gun.step(1 / 60, { ...shot, firing: false }, []);
  tracers.update(gun.projectiles);
  expect(tracers.geometry.instanceCount).toBe(0);
  tracers.dispose();
});
