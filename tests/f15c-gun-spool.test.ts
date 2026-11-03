import { expect, test } from "bun:test";
import { AnimationClip, NumberKeyframeTrack, VectorKeyframeTrack } from "three";
import { GUN_FULL_SPEED, GunSpool, gunBlur, gunCurves } from "../src/aircraft/f15c/gun-spool";
import { CannonSimulation, F15C_MUZZLE } from "../src/flight/cannon";
import { Mesh, Vector3 } from "three";
import { F15CPowerplantRig } from "../src/aircraft/f15c/powerplant-rig";
import { loadGeometryOnly } from "../scripts/geometry-loader";

const run = (spool: GunSpool, seconds: number, firing: boolean, fps = 60) => {
  for (let i = 0; i < Math.round(seconds * fps); i++) spool.step(1 / fps, firing);
};

test("reaches full speed in about a third of a second", () => {
  const spool = new GunSpool();
  run(spool, 0.2, true);
  expect(spool.speed).toBeLessThan(GUN_FULL_SPEED * 0.95);
  run(spool, 0.133, true);
  expect(Math.abs(spool.speed - GUN_FULL_SPEED)).toBeLessThan(GUN_FULL_SPEED * 0.02);
  run(spool, 5, true);
  expect(spool.speed).toBe(GUN_FULL_SPEED);
});

test("winds down over about a second", () => {
  const spool = new GunSpool();
  run(spool, 1, true);
  run(spool, 0.5, false);
  expect(spool.speed).toBeGreaterThan(0);
  expect(spool.speed).toBeLessThan(GUN_FULL_SPEED);
  run(spool, 0.6, false);
  expect(spool.speed).toBe(0);
});

test("barrels blur before they can alias", () => {
  // 25 degrees per frame at 60 fps, as a speed.
  const limit = ((25 * Math.PI) / 180) * 60;
  expect(gunBlur(limit)).toBe(1);
  expect(gunBlur(limit + 1)).toBe(1);
  expect(gunBlur(GUN_FULL_SPEED)).toBe(1);
  expect(gunBlur(0)).toBe(0);
  expect(gunBlur(limit * 0.3)).toBe(0);
  const spool = new GunSpool();
  run(spool, 1, true);
  expect(spool.blur).toBe(1);
});

test("visible barrels never turn far enough to look backward at any frame rate", () => {
  for (const fps of [30, 60, 120, 144]) {
    const spool = new GunSpool();
    let worst = 0;
    const watch = (seconds: number, firing: boolean) => {
      for (let i = 0; i < Math.round(seconds * fps); i++) {
        spool.step(1 / fps, firing);
        // Six identical barrels look the same every 60 degrees, so past 30 they read as reversing.
        if (spool.blur < 1) worst = Math.max(worst, (spool.speed * 180) / Math.PI / fps);
      }
    };
    watch(0.6, true);
    watch(1.2, false);
    expect(worst).toBeLessThan(30);
  }
});

test("a tap winds down from where it was", () => {
  const spool = new GunSpool();
  run(spool, 0.1, true);
  const before = spool.speed;
  expect(before).toBeGreaterThan(0);
  expect(before).toBeLessThan(GUN_FULL_SPEED * 0.6);
  spool.step(1 / 60, false);
  expect(spool.speed).toBeLessThan(before);
  expect(before - spool.speed).toBeLessThan(GUN_FULL_SPEED * 0.05);
  // Firing again picks up from the current speed too.
  const slowing = spool.speed;
  spool.step(1 / 60, true);
  expect(spool.speed).toBeGreaterThan(slowing);
  expect(spool.speed - slowing).toBeLessThan(GUN_FULL_SPEED * 0.15);
});

test("frame rate does not change the spin", () => {
  for (const seconds of [0.1, 0.2, 0.4]) {
    const slow = new GunSpool(),
      fast = new GunSpool();
    run(slow, seconds, true, 30);
    run(fast, seconds, true, 144);
    expect(Math.abs(slow.speed - fast.speed)).toBeLessThan(GUN_FULL_SPEED * 0.03);
  }
  const slow = new GunSpool(),
    fast = new GunSpool();
  run(slow, 1, true, 30);
  run(fast, 1, true, 144);
  run(slow, 0.4, false, 30);
  run(fast, 0.4, false, 144);
  expect(Math.abs(slow.speed - fast.speed)).toBeLessThan(GUN_FULL_SPEED * 0.03);
});

test("a zero step changes nothing", () => {
  const spool = new GunSpool();
  run(spool, 0.15, true);
  const speed = spool.speed;
  spool.step(0, true);
  spool.step(0, false);
  expect(spool.speed).toBe(speed);
});

test("speed read back from a replay continues smoothly", () => {
  const spool = new GunSpool();
  spool.seek(GUN_FULL_SPEED / 2);
  expect(spool.speed).toBe(GUN_FULL_SPEED / 2);
  spool.step(1 / 60, false);
  expect(spool.speed).toBeLessThan(GUN_FULL_SPEED / 2);
  expect(spool.speed).toBeGreaterThan(GUN_FULL_SPEED * 0.4);
});

test("Blender's clips drive the curves when the model has them", () => {
  const clips = [
    new AnimationClip("Gun_spin_up", 1, [new VectorKeyframeTrack("Gun_spin_up_curve.scale", [0, 1], [0, 1, 1, 1, 1, 1])]),
    new AnimationClip("Gun_wind_down", 2, [new VectorKeyframeTrack("Gun_wind_down_curve.scale", [0, 2], [1, 1, 1, 0, 1, 1])]),
    new AnimationClip("Gun_muzzle_shake", 0.1, [new VectorKeyframeTrack("Gun_shake_curve.position", [0, 0.1], [0.001, 0, 0, 0.001, 0, 0])]),
    new AnimationClip("Other", 1, [new NumberKeyframeTrack("x.morphTargetInfluences", [0, 1], [0, 1])]),
  ];
  const spool = new GunSpool(gunCurves(clips));
  run(spool, 0.5, true);
  expect(Math.abs(spool.speed - GUN_FULL_SPEED * 0.5)).toBeLessThan(GUN_FULL_SPEED * 0.02);
  run(spool, 0.5, true);
  run(spool, 1, false);
  expect(Math.abs(spool.speed - GUN_FULL_SPEED * 0.5)).toBeLessThan(GUN_FULL_SPEED * 0.02);
});

test("the first round leaves on the trigger frame", () => {
  const simulation = new CannonSimulation();
  const result = simulation.step(1 / 60, {
    origin: F15C_MUZZLE.clone(),
    direction: new Vector3(0, 0, -1),
    velocity: new Vector3(0, 0, -100),
    firing: true,
  }, [], {});
  expect(result.fired).toBeGreaterThan(0);
});

test("recorded speed alone swaps barrels and blur, so replays show the same thing", async () => {
  const { scene } = await loadGeometryOnly(new URL("../public/assets/f15c-eagle.glb", import.meta.url));
  const rig = new F15CPowerplantRig(scene);
  const tube = scene.getObjectByName("Gun_barrel_blur") as Mesh;
  const bores = scene.getObjectByName("Gun_blur_bores") as Mesh;
  expect(tube).toBeInstanceOf(Mesh);
  expect(bores).toBeInstanceOf(Mesh);
  rig.apply(0, 0, 1.2, 0);
  expect(rig.rotor.visible).toBe(true);
  expect(tube.visible).toBe(false);
  expect(bores.visible).toBe(false);
  rig.apply(0, 0, 1.2, GUN_FULL_SPEED);
  expect(rig.rotor.visible).toBe(false);
  expect(tube.visible).toBe(true);
  expect(bores.visible).toBe(true);
  expect((bores.material as { opacity: number }).opacity).toBe(1);
  // The bore ring is darker than the metal around it.
  rig.apply(0, 0, 0, 0);
  expect(rig.rotor.position.distanceTo(F15C_MUZZLE)).toBe(0);
  rig.dispose();
});
