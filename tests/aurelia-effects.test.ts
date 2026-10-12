import { beforeAll, expect, test } from "bun:test";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";
import { Vector3 } from "three";
import { AureliaEffects } from "../src/aurelia-effects";
import { initialJetInput } from "../src/jet-effects";
let gltf: GLTF;
beforeAll(async () => {
  gltf = await new GLTFLoader().parseAsync(
    await Bun.file("public/assets/aurelia-flight.glb").arrayBuffer(),
    "",
  );
});
test("exported Blender gear retracts into the hull and returns to its original pose", () => {
  const e = new AureliaEffects(gltf.scene, gltf.animations),
    i = initialJetInput();
  const wheel = gltf.scene.getObjectByName("Main_wheel_Left_-027")!;
  e.motion.gear = 1;
  e.update(0, i);
  const down = wheel.getWorldPosition(new Vector3());
  e.motion.gear = 0;
  e.update(0, i);
  const up = wheel.getWorldPosition(new Vector3());
  expect(up.y).toBeGreaterThan(down.y + 1);
  e.motion.gear = 1;
  e.update(0, i);
  expect(wheel.getWorldPosition(new Vector3()).distanceTo(down)).toBeLessThan(
    0.00001,
  );
});
test("fan phase never reverses on shutdown and paused replay does not advance it", () => {
  const e = new AureliaEffects(gltf.scene, gltf.animations),
    i = initialJetInput();
  e.motion.rpm = 0.9;
  e.update(0.01, i);
  expect(e.motion.fanPhase).toBeGreaterThan(0);
  const phase = e.motion.fanPhase;
  e.update(0, i);
  expect(e.motion.fanPhase).toBe(phase);
  expect(e.motion.burner).toBe(0);
});

test("touchdown compression never translates Aurelia's fixed gear mounts", () => {
  const e = new AureliaEffects(gltf.scene, gltf.animations);
  const gear = gltf.scene.getObjectByName("LandingGear")!;
  const mounted = gear.position.clone();
  e.setSuspension(0.16);
  expect(gear.position.distanceTo(mounted)).toBeLessThan(0.00001);
  e.setSuspension(0);
});
