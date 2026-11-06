import { expect, test } from "bun:test";
import { Vector3, Quaternion } from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { AureliaEffects } from "../src/aircraft/aurelia/aurelia-effects";
import { initialJetInput } from "../src/aircraft/jet-effects";
import { wheelPose, aircraftWheels } from "../src/flight/airframe-contact";
import { aureliaFlightOffsetY } from "../src/aircraft/aurelia/flight-model";
import { aureliaFlightDisplayState } from "../src/aircraft/aurelia/flight-displays";
import { displayDemo } from "../src/aircraft/cockpit-displays";

test("the improved Aurelia's three rendered tires match flight contacts throughout reversible gear travel", async () => {
  const { scene, animations } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
    true,
  );
  scene.position.y = aureliaFlightOffsetY;
  const effects = new AureliaEffects(scene, animations);
  expect(aircraftWheels.aurelia).toHaveLength(3);
  const names = ["Nose_wheel", "Main_wheel_Left", "Main_wheel_Right"];
  for (const extension of [1, 0.9, 0.75, 0.5, 0.2, 0, 0.5, 1, 0, 1]) {
    effects.motion.gear = extension;
    effects.update(0, initialJetInput());
    scene.updateMatrixWorld(true);
    names.forEach((name, i) => {
      const wheel = scene.getObjectByName(name)!;
      const actual = wheel.getWorldPosition(new Vector3());
      const pose = wheelPose("aurelia", i, extension);
      expect(actual.distanceTo(pose.center)).toBeLessThan(0.0005);
      const axle = new Vector3(1, 0, 0).applyQuaternion(
        wheel.getWorldQuaternion(new Quaternion()),
      );
      expect(axle.distanceTo(pose.axle)).toBeLessThan(0.0005);
    });
  }
});

test("improved Aurelia controls follow authored hinge axes and replay scrubbing is repeatable", async () => {
  const { scene, animations } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
    true,
  );
  const effects = new AureliaEffects(scene, animations);
  const control = scene.getObjectByName("Aileron_Left")!;
  effects.motion.roll = 0.6;
  effects.update(0, initialJetInput());
  const pose = control.quaternion.clone();
  expect(pose.angleTo(new Quaternion())).toBeGreaterThan(0.1);
  effects.motion.roll = -0.6;
  effects.update(0, initialJetInput());
  effects.motion.roll = 0.6;
  effects.update(0, initialJetInput());
  expect(control.quaternion.angleTo(pose)).toBeLessThan(1e-6);
  expect(scene.getObjectByName("Cockpit_door_hinge")).toBeTruthy();
  expect(scene.getObjectByName("Wing_body_carry_through_fairing")).toBeTruthy();
});

test("the Phenom cockpit screens receive flight/replay telemetry and actual configuration", () => {
  const t = {
    ...displayDemo(42),
    mode: "replay" as const,
    speed: 75,
    altitude: 304.8,
    heading: -Math.PI / 2,
    verticalSpeed: -5.08,
    power: 0.6,
    x: 123,
    z: -456,
  };
  const state = aureliaFlightDisplayState(t, 0.4, 0.65);
  expect(state.source).toBe("replay");
  expect(state.speedKt).toBeCloseTo(145.7883);
  expect(state.altitudeFt).toBeCloseTo(1000);
  expect(state.verticalSpeedFpm).toBeCloseTo(-1000);
  expect(state.headingDeg).toBe(270);
  expect(state.gear).toBe(0.4);
  expect(state.flaps).toBe(0.65);
  expect(state.navigation.position).toEqual({ x: 123, z: -456 });
  expect(aureliaFlightDisplayState({ ...t, engineOut: true }, 0, 0).engines[0].n1).toBe(0);
});
