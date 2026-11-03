import { expect, test } from "bun:test";
import { firingLoop, propEngineMix } from "../src/audio/prop-engine-sound";
import { BUSINESS_JET, jetEngineMix } from "../src/audio/jet-engine-sound";
import { engineVoice } from "../src/audio/audio";
import { combatAircraft } from "../src/aircraft/weapons/combat-loadouts";
import { Group, Mesh, BoxGeometry } from "three";

test("a stopped propeller engine makes no engine sound", () => {
  for (const kind of ["piston", "turboprop"] as const) {
    const mix = propEngineMix(kind, 0);
    for (const gain of [mix.firingGain, mix.buzzGain, mix.roarGain, mix.whineGain]) expect(gain).toBe(0);
  }
});

test("each engine's beat matches its propeller and its RPM range", () => {
  // Finch: three blades, 800 to 2500 RPM. Heron: four blades, 600 to 1900 RPM.
  expect(propEngineMix("piston", 1).bladeHz).toBeCloseTo((2500 / 60) * 3, 5);
  expect(propEngineMix("turboprop", 1).bladeHz).toBeCloseTo((1900 / 60) * 4, 5);
  expect(propEngineMix("piston", .001).bladeHz).toBeLessThan(45);
  // Four cylinders fire twice per crank revolution.
  expect(propEngineMix("piston", 1).firingHz).toBeCloseTo((2500 / 60) * 2, 5);
});

test("a piston engine thumps and a turboprop whines", () => {
  const piston = propEngineMix("piston", .8), turbine = propEngineMix("turboprop", .8);
  expect(piston.firingGain).toBeGreaterThan(0);
  expect(piston.whineGain).toBe(0);
  expect(turbine.whineGain).toBeGreaterThan(0);
  expect(turbine.firingGain).toBe(0);
});

test("more power is louder and higher, and bad values cannot run away", () => {
  for (const kind of ["piston", "turboprop"] as const) {
    const low = propEngineMix(kind, .2), high = propEngineMix(kind, 1);
    expect(high.buzzGain).toBeGreaterThan(low.buzzGain);
    expect(high.roarGain).toBeGreaterThan(low.roarGain);
    expect(high.bladeHz).toBeGreaterThan(low.bladeHz);
    expect(propEngineMix(kind, 9)).toEqual(high);
    for (const value of Object.values(propEngineMix(kind, Number.NaN))) expect(Number.isFinite(value)).toBe(true);
  }
});

test("the firing loop is separate uneven pulses and does not clip", () => {
  let seed = 11;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const rate = 48000, pulses = 20, loop = firingLoop(rate / 2, pulses, rate, random), window = (rate / 2) / pulses;
  const peaks = Array.from({ length: pulses }, (_, i) => loop.subarray(i * window, (i + 1) * window).reduce((a, b) => Math.max(a, Math.abs(b)), 0));
  expect(Math.min(...peaks)).toBeGreaterThan(.2);
  expect(Math.max(...peaks) - Math.min(...peaks)).toBeGreaterThan(.05);
  expect(Math.max(...peaks)).toBeLessThanOrEqual(1);
});

test("a business jet whines more and roars less than a fighter", () => {
  const fighter = jetEngineMix(1, 0, 0), bizjet = jetEngineMix(1, 0, 0, BUSINESS_JET);
  expect(bizjet.whineGain).toBeGreaterThan(fighter.whineGain);
  expect(bizjet.whineHz).toBeGreaterThan(fighter.whineHz);
  expect(bizjet.roarGain).toBeLessThan(fighter.roarGain);
  expect(bizjet.rumbleGain).toBeLessThan(fighter.rumbleGain);
});

test("every aircraft gets the engine it actually has", () => {
  expect(engineVoice("finch")).toBe("piston");
  expect(engineVoice("heron")).toBe("turboprop");
  expect(engineVoice("aurelia")).toBe("business-jet");
  for (const id of ["f15c", "peregrine", "stormbird"] as const) expect(engineVoice(id)).toBe("fighter");
});

test("guns fire from outside the fuselage, not from its centreline", () => {
  const root = new Group(), stand = new Mesh(new BoxGeometry(1, 1, 1));
  stand.userData.weaponStore = true;
  root.add(stand);
  // Measured skin at z = -4: Peregrine reaches x 1.55 at y 0.3; Stormbird reaches x 0.95 at y 0.
  expect(combatAircraft("peregrine", root)!.gun).toEqual([1.6, 0.3, -4]);
  expect(combatAircraft("stormbird", root)!.gun).toEqual([1, 0, -4]);
});
