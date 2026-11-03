import { afterAll, beforeAll, expect, test } from "bun:test";
import * as T from "three";

const context = new Proxy({}, { get: () => () => {}, set: () => true });
let original: PropertyDescriptor | undefined;
beforeAll(() => {
  original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: {
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    },
  });
});
afterAll(() => {
  if (original) Object.defineProperty(globalThis, "document", original);
  else Reflect.deleteProperty(globalThis, "document");
});

test("clouds stay groups of placeholder puffs for the sprite swap", async () => {
  const { makeWorld } = await import("../src/world/world");
  const scene = new T.Scene();
  const world = makeWorld(scene);
  const clouds = scene.children.filter((o) => o.name === "Cloud formation");
  expect(clouds).toHaveLength(27);
  expect(clouds.every((cloud) => cloud.children.length === 5)).toBe(true);
  const start = clouds[3].position.x;
  world.update(100, false);
  expect(clouds[3].position.x).toBeCloseTo(start + 72, 6);
  world.dispose();
});

test("the shadow map follows the aircraft from a fixed sun direction", async () => {
  const { makeWorld } = await import("../src/world/world");
  const world = makeWorld(new T.Scene());
  const focus = new T.Vector3(1234.5, 80, -987.6);
  world.focusSun(focus);
  const { sun } = world;
  expect(sun.target.position.distanceTo(focus)).toBeLessThan(1);
  expect(sun.position.clone().sub(sun.target.position).toArray()).toEqual([-600, 900, 500]);
  world.dispose();
});
