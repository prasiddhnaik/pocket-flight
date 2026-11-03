import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { rangeTargets } from "../src/flight/combat/range";
import { FlightPhysics } from "../src/flight/physics";
import { rangeLayout, rangeSurface, rangeWorld, setRangeHeights } from "../src/world/range-island";
import { groundAt, groundHeight, maximumGroundHeight, onPavement, rangeRunway, runways, terrainHeight, terrainSurfaceHeight } from "../src/world/terrain";

const asset = (name: string) => new URL(`../public/assets/range/${name}`, import.meta.url);
const parse = async (name: string) => {
  const bytes = readFileSync(asset(name));
  return (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
};
const height = (x: number, z: number) => Math.max(0, groundHeight(x, z));

const palmBay = [[-260, 260], [610, -200], [-160, -220], [-355, 562], [100, -300]];
const before = palmBay.map(([x, z]) => terrainHeight(x, z));

beforeAll(() => {
  const bytes = readFileSync(asset("range-island-heights.bin"));
  setRangeHeights(new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
});
afterAll(() => setRangeHeights(null));

test("the collision grid is the visible Blender mesh", async () => {
  const scene = await parse("range-island.glb");
  scene.position.set(rangeLayout.centre.x, 0, rangeLayout.centre.z);
  scene.updateMatrixWorld(true);
  const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, -1, 0));
  for (let i = 0; i < 24; i++) {
    const a = i * 2.4, r = 40 + i * 42;
    const { x, z } = rangeWorld(Math.cos(a) * r, Math.sin(a) * r);
    ray.ray.origin.set(x, 600, z);
    const hit = ray.intersectObject(scene, true)[0];
    expect(hit).toBeDefined();
    expect(hit.point.y).toBeCloseTo(terrainSurfaceHeight(x, z), 2);
  }
});

test("Anvil Key stands clear of Palm Bay, which keeps its shape", () => {
  palmBay.forEach(([x, z], i) => expect(terrainHeight(x, z)).toBe(before[i]));
  expect(rangeSurface(0, 0)).toBeNull();
  expect(rangeLayout.centre.x - rangeLayout.size / 2).toBeGreaterThan(1400);
  // The island sinks to the surrounding seabed at its border.
  const { x, z } = rangeWorld(rangeLayout.size / 2 - 1, 0);
  expect(terrainHeight(x, z)).toBeLessThan(-30);
  const peak = maximumGroundHeight(x - 1400, x - 200, z - 600, z + 600);
  expect(peak).toBeGreaterThan(200);
});

test("the runway and apron are flat pavement at the declared height", () => {
  const r = rangeRunway;
  expect(runways.includes(r)).toBe(true);
  for (let along = -r.length / 2 + 2; along < r.length / 2; along += 20)
    for (const across of [-r.width / 2 + 1, 0, r.width / 2 - 1]) {
      expect(terrainHeight(r.x + across, r.z + along)).toBeCloseTo(r.y, 3);
      expect(groundAt(r.x + across, r.z + along).runway).toBe(r);
      expect(onPavement(r.x + across, r.z + along)).toBe(true);
    }
  for (const [x, z] of [[14, 17], [74, 17], [14, 123], [74, 123]]) {
    expect(terrainHeight(r.x + x, r.z + z)).toBeCloseTo(r.y, 3);
    expect(onPavement(r.x + x, r.z + z)).toBe(true);
  }
  // The hangar row and the tower stand on the same plateau.
  for (const [x, z] of [[81, 13], [81, 125], [36, -33], [48, -17]])
    expect(terrainHeight(r.x + x, r.z + z)).toBeCloseTo(r.y, 3);
  expect(onPavement(r.x - 90, r.z)).toBe(false);
  // The rollout has land ahead before the far shore.
  expect(terrainHeight(r.x, r.z - r.length / 2 - 60)).toBeGreaterThan(2);
});

test("ground dummies sit on level ground and the barge floats in the bay", () => {
  for (const dummy of rangeTargets(height).filter((target) => target.kind === "ground")) {
    const { x, z, y } = dummy.base!;
    if (dummy.model === "barge") {
      expect(terrainHeight(x, z)).toBeLessThan(-4);
      expect(y).toBe(0);
      continue;
    }
    expect(y).toBeGreaterThan(4);
    for (let a = 0; a < 8; a++)
      expect(Math.abs(height(x + Math.cos(a) * 5, z + Math.sin(a) * 5) - y)).toBeLessThan(1);
  }
});

test("drones clear the terrain on every part of their circuits", () => {
  for (const drone of rangeTargets(height).filter((target) => target.kind === "air")) {
    const orbit = drone.orbit!;
    for (let a = 0; a < Math.PI * 2; a += 0.05)
      expect(orbit.altitude - height(orbit.x + Math.sin(a) * orbit.radius, orbit.z + Math.cos(a) * orbit.radius)).toBeGreaterThan(60);
  }
});

test("every dummy the layout names has a model", async () => {
  const scene = await parse("range-targets.glb");
  for (const target of rangeTargets(height)) expect(scene.getObjectByName(`Range_${target.model}`)).toBeDefined();
});

for (const id of ["finch", "peregrine", "f15c"] as const)
  test(`${id} takes off from the Anvil Key runway and climbs out clear of the island`, () => {
    const p = new FlightPhysics(id);
    p.reset(false, false, rangeRunway);
    const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
    let airborneAt: number | null = null;
    for (let i = 0; i < 60 * 40; i++) {
      p.step(1 / 60, {
        ...neutral,
        throttle: 1,
        pitch: p.airspeed * 1.943844 > p.profile.rotationKnots && p.pitch < 0.15 ? 0.3 : 0,
      });
      expect(p.crashed).toBe(false);
      if (!p.grounded && airborneAt === null) {
        airborneAt = i;
        expect(Math.abs(p.position.z - rangeRunway.z)).toBeLessThan(rangeRunway.length / 2);
        // The aircraft rolled on the pavement, toward the targets.
        expect(p.position.z).toBeLessThan(rangeRunway.z + rangeRunway.length / 2);
      }
      if (airborneAt !== null && i > airborneAt + 60 * 6) break;
    }
    expect(airborneAt).not.toBeNull();
    expect(p.position.y - terrainHeight(p.position.x, p.position.z)).toBeGreaterThan(10);
  }, 30000);
