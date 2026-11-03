import { expect, test } from "bun:test";
import { gunFiringFromSpool, gunLoop, gunSilent, gunTailLevel, gunWhir } from "../src/audio/gun-sound";

const seeded = (start: number) => {
  let seed = start;
  return () => (seed = (seed * 16807) % 2147483647) / 2147483647;
};

test("the firing loop holds 100 separate shots a second, without clipping", () => {
  const rate = 48000, loop = gunLoop(rate, rate, 100, seeded(3));
  const window = rate / 100;
  let struck = 0;
  for (let i = 0; i < 100; i++) {
    const part = loop.subarray(i * window, (i + 1) * window);
    if (part.reduce((a, b) => Math.max(a, Math.abs(b)), 0) > .15) struck++;
  }
  expect(struck).toBeGreaterThan(95);
  expect(loop.reduce((a, b) => Math.max(a, Math.abs(b)), 0)).toBeCloseTo(.9, 5);
  // Each shot decays before the next, so it is a rip of shots and not a steady tone.
  const shot = loop.subarray(0, window), start = shot.subarray(0, 96), end = shot.subarray(window - 96);
  const energy = (part: Float32Array) => part.reduce((a, b) => a + b * b, 0);
  expect(energy(start) + energy(end)).toBeGreaterThan(0);
  const middle = shot.subarray(Math.round(window * .55), Math.round(window * .75));
  expect(energy(middle) / middle.length).toBeLessThan(energy(loop) / loop.length);
});

test("the sound keeps going between physics steps, even at a low frame rate, then stops", () => {
  expect(gunSilent(1, 1 + 1 / 60, true)).toBe(false);
  expect(gunSilent(1, 1 + 1 / 20, true)).toBe(false);
  expect(gunSilent(1, 1.2, true)).toBe(true);
  expect(gunSilent(1, 1.001, false)).toBe(true);
});

test("the barrel whir follows barrel speed and is silent at rest", () => {
  expect(gunWhir(0).gain).toBe(0);
  expect(gunWhir(1).gain).toBeGreaterThan(gunWhir(.3).gain);
  expect(gunWhir(1).hz).toBeGreaterThan(gunWhir(.3).hz);
  expect(gunWhir(9)).toEqual(gunWhir(1));
  expect(gunWhir(Number.NaN).gain).toBe(0);
});

test("a tap leaves a smaller tail than a long burst, up to a limit", () => {
  expect(gunTailLevel(.03)).toBeLessThan(gunTailLevel(.5));
  expect(gunTailLevel(5)).toBe(gunTailLevel(30));
});

test("a replay hears firing while the barrels spin up or hold speed, but not while they coast", () => {
  expect(gunFiringFromSpool(0, 0)).toBe(false);
  expect(gunFiringFromSpool(.1, .3)).toBe(true);
  expect(gunFiringFromSpool(1, 1)).toBe(true);
  expect(gunFiringFromSpool(1, .95)).toBe(false);
  expect(gunFiringFromSpool(.02, .03)).toBe(false);
});
