import { afterAll, beforeAll, expect, test } from "bun:test";
import * as T from "three";

// Only runway label painting needs a DOM; animation and transforms use real Three objects.
const context = new Proxy({}, { get: () => () => {}, set: () => true });
let original: PropertyDescriptor | undefined;
beforeAll(() => {
  original = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    writable: true,
    value: { createElement: () => ({ width: 0, height: 0, getContext: () => context }) },
  });
});
afterAll(() => {
  if (original) Object.defineProperty(globalThis, "document", original);
  else Reflect.deleteProperty(globalThis, "document");
});

test("world animation is repeatable and independent of render frame rate", async () => {
  const { makeWorld } = await import("../src/world/world");
  const states = [30, 144].map((fps) => {
    const scene = new T.Scene();
    const world = makeWorld(scene);
    // Two seconds into a dusk fade, at two very different frame rates.
    for (let frame = 1; frame <= fps * 2; frame++) world.update(frame / fps, true);
    const before = scene.children.map((child) => child.position.x);
    world.update(2, true);
    expect(scene.children.map((child) => child.position.x)).toEqual(before);
    const state = { positions: before, sky: (scene.background as T.Color).toArray() };
    world.dispose();
    return state;
  });
  expect(states[0].positions).toEqual(states[1].positions);
  states[0].sky.forEach((value, i) => expect(value).toBeCloseTo(states[1].sky[i], 8));
});
