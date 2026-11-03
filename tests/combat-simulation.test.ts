import { expect, test } from "bun:test";
import { Quaternion, Vector3 } from "three";
import {
  CombatSimulation,
  lockCandidate,
  LOCK_TIME,
  REARM_TIME,
  RearmCrew,
  type CombatTarget,
  type WeaponPose,
} from "../src/flight/combat/simulation";
import { rangeTargets } from "../src/flight/combat/range";
import { captureCombat, encodeBlast, ReplayCombat, replayVariant, type CombatFrame } from "../src/flight/combat/tape";
import type { Hardpoint } from "../src/flight/combat/loadout";
const pose: WeaponPose = {
  position: new Vector3(0, 100, 0),
  quaternion: new Quaternion(),
  velocity: new Vector3(),
};
const points: Hardpoint[] = [
  { id: "left", position: [-2, -1, 0], loads: ["rocket", "air-to-air"] },
  { id: "right", position: [2, -1, 0], loads: ["rocket", "air-to-air"] },
];
const floor = () => -1000;
function target(
  id: string,
  position = new Vector3(-2, 99, -100),
  kind: "air" | "ground" = "ground",
): CombatTarget {
  return { id, position, kind, radius: 5, health: 3, respawn: 0 };
}
function rockets(targets: CombatTarget[] = []) {
  return new CombatSimulation(
    points,
    points.map((point) => ({ hardpoint: point.id, store: "rocket" })),
    targets,
  );
}

test("rockets consume mounted rounds on rising edges and alternate sides", () => {
  const sim = rockets();
  expect(sim.ammunition("rocket")).toBe(8);
  expect(sim.trigger("rocket", true, pose)).toBe(true);
  expect(sim.trigger("rocket", true, pose)).toBe(false);
  expect(sim.projectiles[0].position.x).toBe(-2);
  sim.trigger("rocket", false, pose);
  expect(sim.trigger("rocket", true, pose)).toBe(true);
  expect(sim.projectiles[1].position.x).toBe(2);
  for (let i = 0; i < 10; i++) {
    sim.trigger("rocket", false, pose);
    sim.trigger("rocket", true, pose);
  }
  expect(sim.ammunition("rocket")).toBe(0);
  expect(sim.projectiles).toHaveLength(8);
});

test("launch pose uses hardpoint coordinates, rotation and inherited aircraft speed", () => {
  const sim = rockets();
  const moving = {
    position: new Vector3(10, 100, 20),
    quaternion: new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      Math.PI / 2,
    ),
    velocity: new Vector3(-80, 0, 0),
  };
  sim.trigger("rocket", true, moving);
  expect(
    sim.projectiles[0].position.distanceTo(new Vector3(10, 99, 22)),
  ).toBeLessThan(1e-8);
  expect(sim.projectiles[0].velocity.x).toBeCloseTo(-430);
});

test("rocket gravity and flight agree at 30 and 120 FPS", () => {
  const a = rockets(),
    b = rockets();
  a.trigger("rocket", true, pose);
  b.trigger("rocket", true, pose);
  for (let i = 0; i < 30; i++) a.step(1 / 30, pose, floor);
  for (let i = 0; i < 120; i++) b.step(1 / 120, pose, floor);
  expect(a.projectiles[0].position.y).toBeCloseTo(99 - 9.81 / 2, 6);
  expect(
    a.projectiles[0].position.distanceTo(b.projectiles[0].position),
  ).toBeLessThan(1e-8);
});

test("swept collision selects nearest target irrespective of list order", () => {
  const far = target("far", new Vector3(-2, 99, -3));
  far.radius = 0.1;
  const near = target("near", new Vector3(-2, 99, -1));
  near.radius = 0.1;
  const sim = rockets([far, near]);
  sim.trigger("rocket", true, pose);
  const impacts = sim.step(1 / 120, pose, floor);
  // The rocket strikes the nearer dummy; the other only takes the blast.
  expect(impacts[0]).toMatchObject({ target: "near", warhead: "rocket" });
  expect(impacts[1]).toMatchObject({ target: "far", splash: true });
  expect(near.health).toBe(0);
  expect(sim.projectiles).toHaveLength(0);
});

test("terrain occludes targets and removes the projectile", () => {
  const victim = target("behind", new Vector3(-2, 99, -2.5));
  victim.radius = 0.1;
  const sim = rockets([victim]);
  sim.trigger("rocket", true, pose);
  const impacts = sim.step(1 / 120, pose, (_x, z) => (z < -1 ? 200 : 0));
  expect(impacts).toHaveLength(1);
  expect(impacts[0].target).toBeNull();
  expect(victim.health).toBe(3);
  expect(sim.projectiles).toHaveLength(0);
});

test("gun damage counts destruction once and target respawns after five seconds", () => {
  const victim = target("practice");
  const sim = rockets([victim]);
  sim.gunHits(
    Array.from({ length: 8 }, () => ({
      target: "practice",
      point: victim.position,
    })),
  );
  expect(sim.hits).toBe(3);
  expect(sim.destroyed).toBe(1);
  expect(victim.health).toBe(0);
  for (let i = 0; i < 299; i++) sim.step(1 / 60, pose, floor);
  expect(victim.health).toBe(0);
  sim.step(1 / 30, pose, floor);
  expect(victim.health).toBe(3);
});

test("missiles require a sustained air lock, consume a station and hit", () => {
  const victim = target("air", new Vector3(0, 100, -500), "air");
  const sim = new CombatSimulation(
    points,
    [{ hardpoint: "left", store: "air-to-air" }],
    [victim],
  );
  expect(sim.trigger("missile", true, pose)).toBe(false);
  for (let i = 0; i < 125; i++) sim.step(1 / 120, pose, floor);
  sim.trigger("missile", false, pose);
  expect(sim.lockTime).toBe(LOCK_TIME);
  expect(sim.trigger("missile", true, pose)).toBe(true);
  expect(sim.ammunition("missile")).toBe(0);
  const impacts = [];
  for (let i = 0; i < 140; i++) impacts.push(...sim.step(1 / 120, pose, floor));
  expect(impacts.some((hit) => hit.target === "air" && hit.destroyed)).toBe(
    true,
  );
  expect(sim.projectiles).toHaveLength(0);
});

test("ground, off-axis, dead, distant and rearward targets cannot lock", () => {
  expect(
    lockCandidate(pose, [target("ground", new Vector3(0, 100, -100))]),
  ).toBeNull();
  for (const position of [
    new Vector3(100, 100, -100),
    new Vector3(0, 100, 100),
    new Vector3(0, 100, -3000),
  ])
    expect(lockCandidate(pose, [target("air", position, "air")])).toBeNull();
  const dead = target("dead", new Vector3(0, 100, -100), "air");
  dead.health = 0;
  expect(lockCandidate(pose, [dead])).toBeNull();
});

test("lost lock and suspension clear acquisition; expired ordnance stays bounded", () => {
  const victim = target("air", new Vector3(0, 100, -100), "air");
  const sim = rockets([victim]);
  for (let i = 0; i < 65; i++) sim.step(1 / 60, pose, floor);
  expect(sim.lockTime).toBe(LOCK_TIME);
  victim.position.z = 100;
  sim.step(1 / 60, pose, floor);
  expect(sim.lock).toBeNull();
  expect(sim.lockTime).toBe(0);
  sim.trigger("rocket", true, pose);
  const initial = sim.projectiles[0].position.clone();
  for (const invalid of [0, -1, NaN, Infinity]) sim.step(invalid, pose, floor);
  expect(sim.projectiles[0].position.equals(initial)).toBe(true);
  sim.suspend();
  expect(sim.lockTime).toBe(0);
  for (let i = 0; i < 600; i++) sim.step(1 / 60, pose, floor);
  expect(sim.projectiles).toHaveLength(0);
});

test("range places ground dummies on the surface and flies the drones on circuits", () => {
  const targets = rangeTargets(() => 12);
  const ground = targets.filter((target) => target.kind === "ground");
  const air = targets.filter((target) => target.kind === "air");
  expect(ground.length).toBeGreaterThan(8);
  for (const dummy of ground) {
    expect(dummy.base?.y).toBe(12);
    expect(dummy.position.y).toBeGreaterThan(12);
  }
  expect(air).toHaveLength(3);
  const sim = new CombatSimulation(points, [], targets);
  const start = air[0].position.clone();
  for (let i = 0; i < 60; i++) sim.step(1 / 60, pose, floor);
  const flown = air[0].position.distanceTo(start);
  expect(flown).toBeGreaterThan(air[0].orbit!.speed * 0.95);
  expect(flown).toBeLessThan(air[0].orbit!.speed * 1.05);
  expect(air[0].velocity?.length()).toBeCloseTo(air[0].orbit!.speed);
});

test("a missile leads a drone flying its circuit and hits it", () => {
  const drone = target("drone", new Vector3(0, 100, -600), "air");
  drone.orbit = { x: 400, z: -600, radius: 400, altitude: 100, speed: 60, direction: 1, phase: -Math.PI / 2 };
  const sim = new CombatSimulation(points, [{ hardpoint: "left", store: "air-to-air" }], [drone]);
  for (let i = 0; i < 125; i++) sim.step(1 / 120, pose, floor);
  expect(sim.locked).toBe(true);
  expect(sim.trigger("missile", true, pose)).toBe(true);
  for (let i = 0; i < 500 && drone.health > 0; i++) sim.step(1 / 60, pose, floor);
  expect(drone.health).toBe(0);
});

test("the seeker holds its target past the acquisition cone and resets when it leaves the hold cone", () => {
  const drone = target("drone", new Vector3(0, 100, -1000), "air");
  const off = (degrees: number) => new Vector3(Math.tan((degrees * Math.PI) / 180) * 1000, 100, -1000);
  drone.position.copy(off(14));
  expect(lockCandidate(pose, [drone])).toBeNull();
  expect(lockCandidate(pose, [drone], "drone")).toBe(drone);
  drone.position.copy(off(20));
  expect(lockCandidate(pose, [drone], "drone")).toBeNull();
});

test("a rocket blast damages dummies close to the impact, less with distance, and explodes on the ground", () => {
  const near = target("near", new Vector3(-2, 0, -12));
  const far = target("far", new Vector3(-2, 0, -60));
  const sim = rockets([near, far]);
  sim.trigger("rocket", true, { ...pose, position: new Vector3(0, 2, 0), quaternion: new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.2) });
  const impacts = [];
  for (let i = 0; i < 120; i++) impacts.push(...sim.step(1 / 120, pose, () => 0));
  expect(impacts.some((impact) => impact.warhead === "rocket")).toBe(true);
  expect(near.health).toBeLessThan(3);
  expect(far.health).toBe(3);
});

test("rearming needs a real sortie and a full stop on pavement", () => {
  const dt = 1 / 60;
  const hold = (crew: RearmCrew, seconds: number, speed: number, grounded: boolean, pavement: boolean) => {
    let rearmed = false;
    for (let i = 0; i < seconds * 60; i++) rearmed = crew.step(dt, speed, grounded, pavement) || rearmed;
    return rearmed;
  };
  const crew = new RearmCrew();
  // Never left the ground: waiting at the start does nothing.
  expect(hold(crew, 10, 0, true, true)).toBe(false);
  // A bounce is not a sortie.
  expect(hold(crew, 1, 40, false, false)).toBe(false);
  expect(hold(crew, 10, 0, true, true)).toBe(false);
  expect(hold(crew, 5, 60, false, false)).toBe(false);
  // Rolling, or stopped off the pavement, does not count.
  expect(hold(crew, 10, 20, true, true)).toBe(false);
  expect(hold(crew, 10, 0, true, false)).toBe(false);
  expect(hold(crew, REARM_TIME - 0.5, 0, true, true)).toBe(false);
  expect(crew.progress).toBeGreaterThan(0);
  expect(hold(crew, 1, 0, true, true)).toBe(true);
  expect(crew.progress).toBeLessThan(1);
  // Another reload takes another sortie.
  expect(hold(crew, 10, 0, true, true)).toBe(false);
});

test("rearm restores every station; dummies come back with their own health", () => {
  const tough = target("tough");
  tough.maxHealth = 6;
  tough.health = 6;
  tough.respawnTime = 1;
  const sim = rockets([tough]);
  sim.trigger("rocket", true, pose);
  expect(sim.ammunition("rocket")).toBe(7);
  sim.rearm();
  expect(sim.ammunition("rocket")).toBe(8);
  sim.damage("tough", 6, tough.position);
  expect(tough.health).toBe(0);
  for (let i = 0; i < 70; i++) sim.step(1 / 60, pose, floor);
  expect(tough.health).toBe(6);
});

import { Group, Object3D, BufferGeometry, Material } from "three";
import { CombatVisuals } from "../src/flight/combat/visuals";
test("combat visuals follow ammunition, restore stock stores and release every shared resource once", () => {
  const aircraft = new Group(),
    stock = new Object3D();
  stock.userData.weaponStore = true;
  aircraft.add(stock);
  const sim = rockets([target("ground")]);
  const visuals = new CombatVisuals(sim, aircraft);
  expect(stock.visible).toBe(false);
  sim.trigger("rocket", true, pose);
  visuals.update(1 / 60, []);
  expect(visuals.group.children.some((child) => child instanceof Group && child.children.length > 0)).toBe(true);
  visuals.show(false);
  expect(stock.visible).toBe(true);
  expect(visuals.mounted.visible).toBe(false);
  visuals.show(true);
  expect(stock.visible).toBe(false);
  const resources = new Set<BufferGeometry | Material>();
  for (const group of [visuals.group, visuals.mounted])
    group.traverse((node) => {
      if ("geometry" in node && node.geometry instanceof BufferGeometry)
        resources.add(node.geometry);
      if ("material" in node && node.material instanceof Material)
        resources.add(node.material);
    });
  const counts = new Map<BufferGeometry | Material, number>();
  resources.forEach((resource) =>
    resource.addEventListener("dispose", () =>
      counts.set(resource, (counts.get(resource) ?? 0) + 1),
    ),
  );
  visuals.dispose();
  expect(stock.visible).toBe(true);
  expect(aircraft.children).toEqual([stock]);
  resources.forEach((resource) => expect(counts.get(resource)).toBe(1));
});

import { CannonEffects } from "../src/flight/cannon-effects";
import { withPresentationDOM } from "./helpers/presentation-dom";
test("existing cannon effects deliver external combat hits from a configured gun port", () =>
  withPresentationDOM((container) => {
    const effects = new CannonEffects(container);
    const state = {
      ...pose,
      angularVelocity: new Vector3(),
      wind: new Vector3(),
    };
    effects.reset(state, false);
    const victim = target("external", new Vector3(0, 100, -50), "air");
    const sim = rockets([victim]);
    const result = effects.step(0.1, state, true, sim.targets, new Vector3());
    sim.gunHits(result.hits);
    expect(victim.health).toBe(0);
    expect(sim.destroyed).toBe(1);
    expect(effects.group.getObjectByName("Cannon_muzzle_flash")?.visible).toBe(
      true,
    );
    effects.dispose();
  }));

test("a sandbox flight replays dummies, rounds and blasts at any moment, after saving", () => {
  const sim = rockets([target("hit", new Vector3(-2, 99, -40)), target("standing", new Vector3(200, 99, -40))]);
  const frames: { t: number; combat: CombatFrame }[] = [];
  let pending: number[][] = [];
  sim.trigger("rocket", true, pose);
  for (let i = 0; i <= 45; i++) {
    const impacts = sim.step(1 / 15, pose, floor);
    for (const impact of impacts)
      if (impact.warhead) pending.push(encodeBlast({ point: impact.point, surface: "ground", size: 1 }));
    frames.push({ t: i / 15, combat: captureCombat(sim, pending) });
    pending = [];
  }
  expect(frames[0].combat.rounds.length + frames[1].combat.rounds.length).toBeGreaterThan(0);
  expect(frames.at(-1)!.combat.down).toEqual(["hit"]);
  expect(frames.flatMap((frame) => frame.combat.blasts)).toHaveLength(1);
  expect(frames.at(-1)!.combat.stores).toEqual([3, 4]);
  // Survives the JSON a saved replay goes through.
  const saved: typeof frames = JSON.parse(JSON.stringify(frames));
  const aircraft = new Group();
  const playback = new ReplayCombat("finch-attack", aircraft, () => 12, () => false);
  const dummies = playback.visuals.group;
  expect(aircraft.children).toContain(playback.visuals.mounted);
  // Scrubbing straight to the end, then back to the start, then playing forward.
  playback.pose(saved, 3, 800);
  playback.pose(saved, 0, 800);
  playback.pose(saved, 1 / 30, 800, true);
  expect(dummies.children.length).toBeGreaterThan(1);
  playback.dispose();
  expect(aircraft.children).toEqual([]);
});

test("the replay shows the A-2 when it was flown, and for older sandbox recordings", () => {
  expect(replayVariant({ aircraft: "finch", mission: "free" })).toBe("trainer");
  expect(replayVariant({ aircraft: "finch", mission: "free", variant: "attack" })).toBe("attack");
  expect(replayVariant({ aircraft: "finch", mission: "combat" })).toBe("attack");
  expect(replayVariant({ aircraft: "f15c", mission: "combat" })).toBe("trainer");
});
