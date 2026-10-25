import { expect, test } from "bun:test";
import * as T from "three";
import { CannonEffects } from "../src/flight/cannon-effects";
import { F15CEffects } from "../src/aircraft/f15c/effects";
import { initialJetInput } from "../src/aircraft/jet-effects";
import { loadGeometryOnly } from "../scripts/geometry-loader";

import { withPresentationDOM } from "./helpers/presentation-dom";

const state = { position: new T.Vector3(0, 100, 0), quaternion: new T.Quaternion(), velocity: new T.Vector3(), angularVelocity: new T.Vector3(), wind: new T.Vector3() };
test("muzzle flashes survive the firing frame at 20–120 FPS and reset clears them", () => withPresentationDOM(container => {
  for (const fps of [20, 30, 60, 120]) {
    const effects = new CannonEffects(container);
    effects.reset(state, false);
    expect(effects.step(1 / fps, state, true).fired).toBeGreaterThan(0);
    expect(effects.group.getObjectByName("Cannon_muzzle_flash")!.visible).toBe(true);
    effects.reset(state, false);
    expect(effects.group.getObjectByName("Cannon_muzzle_flash")!.visible).toBe(false);
    expect(effects.simulation.projectiles).toHaveLength(0);
    effects.dispose();
  }
}));
test("actual F-15 actuators move through intermediate poses, freeze, and retain their power band after reset", () => withPresentationDOM(async () => {
  const { scene } = await loadGeometryOnly(new URL("../public/assets/f15c-eagle.glb", import.meta.url));
  const effects = new F15CEffects(scene);
  const input = { ...initialJetInput(), gear: false, flaps: 1, speedBrake: 1, roll: .7 };
  effects.update(.1, input);
  expect(effects.motion.gear).toBeGreaterThan(.5); expect(effects.motion.gear).toBeLessThan(1);
  expect(effects.motion.flaps).toBeGreaterThan(0); expect(effects.motion.flaps).toBeLessThan(.5);
  const frozen = JSON.stringify(effects.motion);
  effects.update(0, initialJetInput()); expect(JSON.stringify(effects.motion)).toBe(frozen);
  for (let i = 0; i < 600; i++) effects.update(1 / 60, input);
  expect(effects.motion.gear).toBeLessThan(.001); expect(effects.motion.flaps).toBeGreaterThan(.999);
  effects.reset();
  for (let i = 0; i < 240; i++) effects.update(1 / 60, { ...initialJetInput(), throttle: .9, burner: true, powerResolved: true });
  expect(effects.motion.rpm).toBe(.9); expect(effects.motion.burner).toBeLessThan(.1);
  effects.dispose();
}));
test("F-15 effect cleanup releases sprite, particle and shared texture resources", () => withPresentationDOM(() => {
  const model = new T.Group(), effects = new F15CEffects(model);
  const resources = new Set<T.BufferGeometry | T.Material | T.Texture>();
  effects.group.traverse(node => {
    if (node instanceof T.Mesh || node instanceof T.Points) resources.add(node.geometry);
    if (node instanceof T.Mesh || node instanceof T.Points || node instanceof T.Sprite) {
      for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
        resources.add(material);
        for (const value of Object.values(material)) if (value instanceof T.Texture) resources.add(value);
      }
    }
  });
  let released = 0;
  resources.forEach(resource => resource.addEventListener("dispose", () => released++));
  effects.dispose();
  expect(released).toBe(resources.size); expect(model.children).toHaveLength(0);
}));
