import { expect, test } from "bun:test";
import * as T from "three";
import { CannonFlash } from "../src/flight/cannon-flash";
import { CannonEffects } from "../src/flight/cannon-effects";
import { cannonPose } from "../src/flight/cannon";
import { withPresentationDOM } from "./helpers/presentation-dom";

const camera = new T.PerspectiveCamera(), origin = new T.Vector3(0, 100, 0), direction = new T.Vector3(0, 0, -1);
const still = new T.Vector3();
test("discharge requires actual shots, varies between firing frames, freezes and clears on suspension", () => {
  const effect = new CannonFlash();
  effect.step(1 / 60, 0, 0, origin, direction, still, still);
  expect(effect.flash.visible).toBe(false); expect(effect.light.intensity).toBe(0);
  effect.step(1 / 60, 2, 2, origin, direction, still, still);
  const first = effect.flash.scale.clone();
  expect(effect.flash.visible).toBe(true); expect(effect.light.intensity).toBeGreaterThan(0);
  effect.step(0, 0, 2, origin, direction, still, still);
  expect(effect.flash.visible).toBe(true); expect(effect.flash.scale.equals(first)).toBe(true);
  effect.step(1 / 60, 1, 3, origin, direction, still, still);
  expect(effect.flash.scale.equals(first)).toBe(false);
  effect.suspend(); expect(effect.flash.visible).toBe(false); expect(effect.light.intensity).toBe(0);
  effect.dispose();
});

test("smoke is bounded, left behind a fast aircraft, responds to wind and expires after release", () => {
  const effect = new CannonFlash(), velocity = new T.Vector3(0, 0, -200), wind = new T.Vector3(8, 0, 0);
  const point = origin.clone(), matrix = new T.Matrix4(), position = new T.Vector3();
  let largest = 0;
  for (let i = 0; i < 600; i++) {
    point.addScaledVector(velocity, 1 / 60);
    effect.step(1 / 60, 2, (i + 1) * 2, point, direction, velocity, wind);
    effect.render(camera, point, direction);
    largest = Math.max(largest, effect.smoke.count);
    expect(effect.smoke.count).toBeLessThanOrEqual(32);
  }
  expect(largest).toBeGreaterThan(10);
  let behind = 0, drifted = 0;
  for (let i = 0; i < effect.smoke.count; i++) {
    effect.smoke.getMatrixAt(i, matrix); position.setFromMatrixPosition(matrix);
    if (position.z > point.z + 20) behind++;
    if (position.x > 1) drifted++;
  }
  expect(behind).toBeGreaterThan(0); expect(drifted).toBeGreaterThan(0);
  for (let i = 0; i < 45; i++) effect.step(1 / 60, 0, 1200, point, direction, velocity, wind);
  effect.render(camera, point, direction);
  expect(effect.flash.visible).toBe(false); expect(effect.smoke.count).toBe(0);
  effect.reset(); expect(effect.smoke.count).toBe(0); effect.dispose();
});

test("flash follows the interpolated aircraft muzzle through translation and bank; an empty gun cannot flash", () => withPresentationDOM(container => {
  const effects = new CannonEffects(container), aircraft = new T.Group();
  const state = { position: origin.clone(), quaternion: new T.Quaternion(), velocity: still, angularVelocity: still, wind: still };
  effects.reset(state, false);
  effects.step(1 / 60, state, true);
  aircraft.position.set(150, 230, -800);
  aircraft.quaternion.setFromEuler(new T.Euler(.3, 1.2, -.8));
  aircraft.updateMatrixWorld(true);
  effects.render(true, camera, aircraft, false);
  const flash = effects.group.getObjectByName("Cannon_muzzle_flash")!;
  const pose = cannonPose(aircraft.position, aircraft.quaternion);
  expect(flash.position.distanceTo(pose.origin)).toBeLessThan(1e-8);
  expect(new T.Vector3(0, 0, 1).applyQuaternion(flash.quaternion).distanceTo(pose.direction)).toBeLessThan(1e-8);
  effects.simulation.ammunition = 0;
  for (let i = 0; i < 4; i++) effects.step(1 / 60, state, true);
  expect(flash.visible).toBe(false); expect(effects.firing).toBe(false);
  effects.dispose();
}));

test("all discharge geometry and materials are released exactly once", () => {
  const effect = new CannonFlash(), resources = [effect.flash.geometry, effect.flash.material, effect.smoke.geometry, effect.smoke.material];
  const counts = resources.map(resource => { const count = { value: 0 }; resource.addEventListener("dispose", () => count.value++); return count; });
  effect.dispose();
  expect(counts.map(count => count.value)).toEqual([1, 1, 1, 1]); expect(effect.group.children).toHaveLength(0);
});
