import { expect, test } from "bun:test";
import { Group, Mesh, MeshStandardMaterial, BoxGeometry } from "three";
import {
  advancePropeller,
  propellerAnimation,
  type PropellerPose,
} from "../src/propeller";

const power = {
  throttle: 1,
  airspeed: 35,
  damage: 0,
  engineOut: false,
  crashed: false,
};

test("propeller spools smoothly and gives the same motion at 30, 60 and 144 fps", () => {
  const poses = [30, 60, 144].map((fps) => {
    let pose: PropellerPose = { angle: 0, rpm: 0 };
    for (let i = 0; i < fps * 2; i++)
      pose = advancePropeller(pose, power, 1 / fps);
    return pose;
  });
  expect(
    advancePropeller({ angle: 0, rpm: 0 }, power, 1 / 60).rpm,
  ).toBeLessThan(120);
  for (const pose of poses) {
    expect(pose.rpm).toBeGreaterThan(2400);
    expect(pose.rpm).toBeCloseTo(poses[0].rpm, 8);
    expect(pose.angle).toBeCloseTo(poses[0].angle, 8);
  }
});

test("an engine-out propeller winds down, windmills in flight and stops after a crash", () => {
  const initial = { angle: 100, rpm: 2500 };
  const off = { ...power, engineOut: true };
  const slowing = advancePropeller(initial, off, 0.1);
  expect(slowing.rpm).toBeGreaterThan(1500);
  expect(slowing.rpm).toBeLessThan(initial.rpm);
  const windmill = advancePropeller(initial, off, 10);
  expect(windmill.rpm).toBeCloseTo(360, 2);
  expect(
    advancePropeller(initial, { ...off, airspeed: 0 }, 10).rpm,
  ).toBeLessThan(0.001);
  expect(
    advancePropeller(initial, { ...power, crashed: true }, 10).rpm,
  ).toBeLessThan(0.001);
});

test("cruise replaces sharp blades with blur without fading the spinner or shared paint", () => {
  const propeller = new Group(),
    blade = new Group();
  blade.name = "Propeller_Blade_1";
  const paint = new MeshStandardMaterial();
  const spinner = new Mesh(new BoxGeometry(), paint);
  const skin = new Mesh(new BoxGeometry(), paint);
  blade.add(skin);
  propeller.add(spinner, blade);
  const animation = propellerAnimation();
  animation.bind(propeller);
  animation.apply({ angle: 12, rpm: 2400 });
  expect(skin.visible).toBe(false);
  expect(skin.castShadow).toBe(false);
  expect(spinner.visible).toBe(true);
  expect(paint.opacity).toBe(1);
  expect(paint.transparent).toBe(false);
  expect(propeller.getObjectByName("Propeller_motion_blur")!.visible).toBe(
    true,
  );
  const recorded = animation.snapshot();
  animation.reset();
  expect(skin.visible).toBe(true);
  expect(propeller.getObjectByName("Propeller_motion_blur")!.visible).toBe(
    false,
  );
  animation.apply(recorded);
  expect(animation.snapshot()).toEqual(recorded);
  expect(propeller.rotation.z).toBe(12);
});
