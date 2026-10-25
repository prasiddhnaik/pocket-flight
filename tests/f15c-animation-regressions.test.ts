import { expect, test } from "bun:test";
import { Quaternion, Vector3 } from "three";
import { mechanismPose, type MechanismProgramme } from "../lab/mechanics";
import { CannonSimulation, F15C_CANNON, F15C_MUZZLE, muzzleVelocity } from "../src/flight/cannon";
import { JetMotion, initialJetInput } from "../src/aircraft/jet-effects";
import { projectileGeometry, ProjectileVisuals } from "../src/flight/projectile-visuals";
import { exhaustRayInterval } from "../src/aircraft/f15c/exhaust-shader";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { F15CMechanisms, f15cControlSurfaces } from "../src/aircraft/f15c/mechanisms";
import { applyReplaySurfaces } from "../src/replay/replay-surfaces";

const shot = { firing: true, origin: new Vector3(0, 100, 0), direction: new Vector3(0, 0, -1), velocity: new Vector3(120, 0, 0) };
test("projectiles lose airspeed, fall, and retain aircraft lateral motion", () => {
  const gun = new CannonSimulation();
  gun.step(1 / 120, shot, []);
  const speed = gun.projectiles[0].velocity.length();
  gun.step(.5, { ...shot, firing: false }, []);
  const round = gun.projectiles[0];
  expect(round.velocity.length()).toBeLessThan(speed * .99);
  expect(round.position.y).toBeLessThan(99);
  expect(round.position.x).toBeGreaterThan(40);
});
test("a swept round stops at the terrain before a buried practice target", () => {
  const gun = new CannonSimulation();
  const result = gun.step(.1, { ...shot, origin: new Vector3(0, 1, 0), direction: new Vector3(0, -1, -1).normalize(), velocity: new Vector3() },
    [{ id: "buried", position: new Vector3(0, -3, -4), radius: 2 }], { surfaceHeight: () => 0 });
  expect(result.hits.some(hit => hit.target === "buried")).toBe(false);
  expect(result.impacts.length).toBeGreaterThan(0);
  expect(gun.projectiles).toHaveLength(0);
});
test("all mechanical programmes join continuously at their loop boundary", () => {
  for (const programme of ["all", "gear", "controls", "power", "cockpit"] as MechanismProgramme[]) {
    const before = mechanismPose(36 - 1e-6, programme), after = mechanismPose(0, programme);
    for (const key of Object.keys(before) as (keyof typeof before)[])
      expect(Math.abs((before[key] ?? 0) - (after[key] ?? 0))).toBeLessThan(1e-5);
  }
});
test("the controls programme actually opens and closes the dorsal airbrake", () => {
  const values = Array.from({ length: 145 }, (_, i) => mechanismPose(i / 4, "controls").speedBrake ?? 0);
  expect(Math.max(...values)).toBeGreaterThan(.99);
  expect(values[0]).toBe(0);
  expect(values.at(-1)).toBe(0);
});
test("resolved F-15 engine power has a continuous wet-power envelope", () => {
  const powers = [.88, .9, .9001, .95, 1];
  const strengths = powers.map(power => {
    const motion = new JetMotion(false, [.88, 1]);
    const input = { ...initialJetInput(), throttle: power, burner: true, powerResolved: true };
    for (let i = 0; i < 240; i++) motion.update(1 / 60, input);
    expect(motion.rpm).toBe(power);
    return motion.burner;
  });
  expect(strengths[0]).toBe(0);
  expect(strengths[1]).toBeLessThan(.1);
  expect(strengths[2] - strengths[1]).toBeLessThan(.002);
  expect(strengths[3]).toBeGreaterThan(strengths[2]);
  expect(strengths[4]).toBeGreaterThan(.999);
});
test("the actual projectile is 20 mm wide and its sparse trail is a separate motion cue", () => {
  const geometry = projectileGeometry(); geometry.computeBoundingBox();
  const size = geometry.boundingBox!.getSize(new Vector3());
  expect(size.x).toBeCloseTo(.02, 7); expect(size.z).toBeCloseTo(.02, 7);
  expect(size.y).toBeCloseTo(F15C_CANNON.projectileLength, 7);
  const visuals = new ProjectileVisuals(), gun = new CannonSimulation();
  gun.step(.1, shot, []); visuals.update(gun.projectiles);
  expect(visuals.rounds.count).toBe(gun.shots);
  expect(visuals.rounds.count).toBe(10);
  visuals.update([]); expect(visuals.rounds.count).toBe(0);
  visuals.dispose(); geometry.dispose();
});
test("gun-point velocity includes body rotation in the world frame", () => {
  const q = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const velocity = new Vector3(50, 3, -80), rate = new Vector3(.2, -.1, .3);
  const result = muzzleVelocity(velocity, rate, q);
  expect(result.distanceTo(rate.clone().cross(F15C_MUZZLE).applyQuaternion(q).add(velocity))).toBeLessThan(1e-10);
  expect(velocity.toArray()).toEqual([50, 3, -80]);
});
test("axial and side exhaust rays intersect, while parallel outside rays miss", () => {
  expect(exhaustRayInterval(new Vector3(0, 0, 5), new Vector3(0, 0, -1))).toEqual([4, 5]);
  expect(exhaustRayInterval(new Vector3(5, 0, .5), new Vector3(-1, 0, 0))).toEqual([4, 6]);
  expect(exhaustRayInterval(new Vector3(2, 0, 5), new Vector3(0, 0, -1))).toBeNull();
  expect(exhaustRayInterval(new Vector3(1, 0, 5), new Vector3(0, 0, -1))).toEqual([4, 5]);
  expect(exhaustRayInterval(new Vector3(-1, 0, 5), new Vector3(0, 0, -1))).toEqual([4, 5]);
});
test("saved F-15 flap rig retains interpolated replay deployment after control updates", async () => {
  const { scene } = await loadGeometryOnly(new URL("../public/assets/f15c-eagle.glb", import.meta.url));
  const rig = new F15CMechanisms(scene), surfaces = f15cControlSurfaces(rig.parts);
  const neutral = { roll: 0, pitch: 0, yaw: 0 };
  const a = { surfaces: neutral, flapPosition: 0 }, b = { surfaces: neutral, flapPosition: 1 };
  surfaces.setFlaps(0);
  rig.apply({ ...neutral, gear: 1, flaps: .5, canopy: 0, speedBrake: 0 });
  applyReplaySurfaces({ surfaces, setConfiguration: value => surfaces.setFlaps(value) }, a, b, .5);
  for (const side of ["Left", "Right"]) {
    const flap = rig.parts.get(`Flap_${side}`)!;
    expect(flap.quaternion.angleTo(new Quaternion()) * 180 / Math.PI).toBeCloseTo(12.5, 6);
    expect(new Vector3(0, 0, 1).applyQuaternion(flap.quaternion).y).toBeLessThan(-.15);
  }
});
test("a moving muzzle, wind and drag give the same rounds at 30 and 120 FPS", () => {
  const run = (fps: number) => {
    const gun = new CannonSimulation();
    for (let i = 1; i <= fps; i++) gun.step(1 / fps, { ...shot, origin: shot.origin.clone().addScaledVector(shot.velocity, i / fps) }, [], { wind: new Vector3(8, 0, 3) });
    return gun;
  };
  const a = run(30), b = run(120);
  expect(a.shots).toBe(100); expect(b.shots).toBe(100);
  a.projectiles.forEach((round, i) => expect(round.position.distanceTo(b.projectiles[i].position)).toBeLessThan(1e-8));
});
