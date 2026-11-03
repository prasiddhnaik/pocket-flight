import { expect, test } from "bun:test";
import { burnerLitEdge, crackleNoise, jetEngineMix, loopedBrownNoise } from "../src/audio/jet-engine-sound";

test("a stopped engine is silent, and only airflow is left in a glide", () => {
  const stopped = jetEngineMix(0, 0, 0);
  for (const gain of [stopped.whineGain, stopped.rumbleGain, stopped.roarGain, stopped.burnerGain, stopped.crackleGain, stopped.windGain])
    expect(gain).toBe(0);
  const glide = jetEngineMix(0, 0, 200);
  expect(glide.windGain).toBeGreaterThan(0);
  expect(glide.roarGain).toBe(0);
});

test("the engine gets louder and higher with power", () => {
  const idle = jetEngineMix(.2, 0, 0), military = jetEngineMix(1, 0, 0);
  expect(military.whineHz).toBeGreaterThan(idle.whineHz);
  expect(military.roarGain).toBeGreaterThan(idle.roarGain);
  expect(military.rumbleGain).toBeGreaterThan(idle.rumbleGain);
});

test("the burner adds its own roar and crackle, and needs a running engine", () => {
  const dry = jetEngineMix(1, 0, 0), lit = jetEngineMix(1, 1, 0);
  expect(dry.burnerGain).toBe(0);
  expect(dry.crackleGain).toBe(0);
  expect(lit.burnerGain).toBeGreaterThan(0);
  expect(lit.crackleGain).toBeGreaterThan(0);
  expect(jetEngineMix(0, 1, 0).burnerGain).toBe(0);
});

test("out-of-range values cannot produce a runaway mix", () => {
  const mix = jetEngineMix(4, 9, 5000);
  expect(mix).toEqual(jetEngineMix(1, 1, 5000));
  expect(mix.windGain).toBe(jetEngineMix(1, 1, 320).windGain);
  for (const value of Object.values(jetEngineMix(Number.NaN, Number.NaN, Number.NaN))) expect(Number.isFinite(value)).toBe(true);
});

test("the thump fires once per light-off and re-arms only after the burner is out", () => {
  let armed = true, thumps = 0;
  for (const burner of [0, .01, .06, .5, 1, .5, .04, .06, .5, .01, .08]) {
    const edge = burnerLitEdge(armed, burner);
    armed = edge.armed;
    if (edge.fire) thumps++;
  }
  expect(thumps).toBe(2);
});

test("pausing in the burner does not thump again on resume", () => {
  const lit = burnerLitEdge(true, 1);
  expect(lit.fire).toBe(true);
  const paused = burnerLitEdge(lit.armed, 0, false);
  expect(paused).toEqual({ armed: false, fire: false });
  expect(burnerLitEdge(paused.armed, 1).fire).toBe(false);
});

test("the engine noise loops without an audible click", () => {
  let seed = 1;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const noise = loopedBrownNoise(48000, 2400, random);
  const steps = noise.slice(1).map((sample, i) => Math.abs(sample - noise[i]));
  const largest = steps.reduce((a, b) => Math.max(a, b), 0);
  expect(Math.abs(noise[0] - noise[noise.length - 1])).toBeLessThanOrEqual(largest * 2);
  expect(noise.reduce((a, b) => Math.max(a, Math.abs(b)), 0)).toBeCloseTo(1, 5);
});

test("burner crackle is sparse pops, not continuous hiss", () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const crackle = crackleNoise(48000, 48000, 40, random);
  const quiet = crackle.filter((sample) => Math.abs(sample) < .01).length;
  expect(quiet / crackle.length).toBeGreaterThan(.3);
  expect(crackle.reduce((a, b) => Math.max(a, Math.abs(b)), 0)).toBeLessThanOrEqual(1);
});
