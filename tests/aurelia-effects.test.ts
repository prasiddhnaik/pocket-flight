import { beforeAll, expect, test } from "bun:test";
import type { GLTF } from "three/addons/loaders/GLTFLoader.js";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { Quaternion, Vector3 } from "three";
import { AureliaEffects } from "../src/aircraft/aurelia/aurelia-effects";
import { initialJetInput } from "../src/aircraft/jet-effects";
import { legacyAureliaWheelPose } from "../src/flight/airframe-contact";
let gltf: Pick<GLTF, "scene" | "animations">;
beforeAll(async () => {
  const loaded = await loadGeometryOnly(
    new URL("../public/assets/aurelia-flight.glb", import.meta.url),
    true,
  );
  gltf = loaded;
});
test("legacy S32 export gear retracts all four wheels along their contact paths and returns to its original pose", () => {
  const e = new AureliaEffects(gltf.scene, gltf.animations),
    i = initialJetInput();
  const wheels = [
    "Nose_wheel_-1",
    "Nose_wheel_1",
    "Main_wheel_Left",
    "Main_wheel_Right",
  ].map((name) => {
    const wheel = gltf.scene.getObjectByName(name);
    expect(wheel).toBeDefined();
    return wheel!;
  });
  e.motion.gear = 1;
  e.update(0, i);
  const down = wheels.map((wheel) => wheel.getWorldPosition(new Vector3()));
  // Exercise the flight effects controller in both directions, including the
  // fully sealed endpoint. Contact coordinates include the runtime model datum.
  for (const direction of [-1, 1])
    for (let step = 0; step <= 100; step++) {
      const extension = direction < 0 ? 1 - step / 100 : step / 100;
      e.motion.gear = extension;
      e.update(0, i);
      wheels.forEach((wheel, index) => {
        const position = wheel.getWorldPosition(new Vector3());
        const rendered = position.clone().multiplyScalar(0.55);
        rendered.y -= 1.265;
        const contact = legacyAureliaWheelPose(index, extension);
        expect(rendered.distanceTo(contact.center)).toBeLessThan(0.0005);
        const axle = new Vector3(1, 0, 0).applyQuaternion(
          wheel.getWorldQuaternion(new Quaternion()),
        );
        expect(axle.distanceTo(contact.axle)).toBeLessThan(0.0005);
        if (extension === 0)
          expect(position.y).toBeGreaterThan(down[index].y + 1);
      });
    }
  wheels.forEach((wheel, index) =>
    expect(
      wheel.getWorldPosition(new Vector3()).distanceTo(down[index]),
    ).toBeLessThan(0.00001),
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
