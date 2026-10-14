import { describe, expect, test } from "bun:test";
import { evaluateWarnings, freshLatch, secondsToImpact, type WarningInput } from "../src/hud/warnings";

const base: WarningInput = {
  mode: "playing", grounded: false, stall: false, speedProtection: false, agl: 2000, verticalSpeed: 0,
  roll: 0, gearPosition: 1, speed: 120, health: 100, fuelFraction: 0.8, jet: false, approachKnots: 70,
};
const run = (patch: Partial<WarningInput>, latch = freshLatch(), now = 0) => evaluateWarnings({ ...base, ...patch }, latch, now);

describe("warnings", () => {
  test("nothing is raised outside active play", () => {
    for (const mode of ["menu", "paused", "result", "replay"] as const)
      expect(run({ mode, stall: true }).active).toEqual([]);
  });
  test("time to impact divides height above ground by sink rate", () => {
    expect(secondsToImpact(328.084, -10)).toBeCloseTo(10);
    expect(secondsToImpact(300, 2)).toBe(Infinity);
  });
  test("pull up needs low height and under six seconds to impact", () => {
    expect(run({ agl: 300, verticalSpeed: -20 }).active).toEqual(["pullUp"]);
    expect(run({ agl: 300, verticalSpeed: -10 }).active).toEqual([]);
    expect(run({ agl: 900, verticalSpeed: -60 }).active).toEqual([]);
    expect(run({ agl: 300, verticalSpeed: -20, grounded: true }).active).toEqual([]);
  });
  test("pull up stays silent on a normal gear-down approach", () => {
    expect(run({ gearPosition: 1, grounded: false, agl: 50, verticalSpeed: -3 }).active).not.toContain("pullUp");
  });
  test("pull up warns on a steep gear-down descent", () => {
    expect(run({ gearPosition: 1, grounded: false, agl: 100, verticalSpeed: -10 }).active).toContain("pullUp");
  });
  test("pull up still warns on a shallow gear-up descent near the ground", () => {
    expect(run({ gearPosition: 0, grounded: false, agl: 50, verticalSpeed: -3 }).active).toContain("pullUp");
  });
  test("active warnings are sorted by priority", () => {
    const r = run({ agl: 200, verticalSpeed: -15, stall: true, roll: 1.2, speedProtection: true });
    expect(r.active).toEqual(["pullUp", "stall", "overspeed", "bankAngle"]);
  });
  test("bank angle triggers past 60 degrees either way", () => {
    expect(run({ roll: (61 * Math.PI) / 180 }).active).toEqual(["bankAngle"]);
    expect(run({ roll: (-61 * Math.PI) / 180 }).active).toEqual(["bankAngle"]);
    expect(run({ roll: (59 * Math.PI) / 180 }).active).toEqual([]);
  });
  test("landing gear warning is for jets low, slow, descending with gear up", () => {
    const approach = { agl: 400, verticalSpeed: -2, speed: 80, gearPosition: 0, approachKnots: 70 };
    expect(run({ ...approach, jet: true }).active).toEqual(["landingGear"]);
    expect(run({ ...approach, jet: false }).active).toEqual([]);
    expect(run({ ...approach, jet: true, gearPosition: 1 }).active).toEqual([]);
    expect(run({ ...approach, jet: true, speed: 120 }).active).toEqual([]);
  });
  test("fuel low fires once, hides after four seconds, and re-arms with hysteresis", () => {
    let r = run({ fuelFraction: 0.19 }, freshLatch(), 10);
    expect(r.active).toEqual(["fuelLow"]);
    r = run({ fuelFraction: 0.185 }, r.latch, 15);
    expect(r.active).toEqual([]);
    r = run({ fuelFraction: 0.201 }, r.latch, 16);
    r = run({ fuelFraction: 0.199 }, r.latch, 17);
    expect(r.active).toEqual([]);
    r = run({ fuelFraction: 0.23 }, r.latch, 20);
    r = run({ fuelFraction: 0.19 }, r.latch, 30);
    expect(r.active).toEqual(["fuelLow"]);
  });
  test("bingo fuel outranks fuel low", () => {
    const r = run({ fuelFraction: 0.08 }, freshLatch(), 1);
    expect(r.active).toEqual(["bingoFuel"]);
  });
  test("damage fires below 70 and again only after another 5 point drop", () => {
    let r = run({ health: 69 }, freshLatch(), 0);
    expect(r.active).toEqual(["damage"]);
    r = run({ health: 66 }, r.latch, 5);
    expect(r.active).toEqual([]);
    r = run({ health: 63 }, r.latch, 6);
    expect(r.active).toEqual(["damage"]);
    r = run({ health: 100 }, r.latch, 20);
    r = run({ health: 69 }, r.latch, 21);
    expect(r.active).toEqual(["damage"]);
  });
  test("a banner stamped late in a previous flight never shows after the clock restarts", () => {
    const r = run({ fuelFraction: 0.19 }, freshLatch(), 300);
    expect(run({ fuelFraction: 0.19 }, r.latch, 0.2).active).toEqual([]);
  });
  test("the input latch is not mutated", () => {
    const latch = freshLatch();
    run({ fuelFraction: 0.05, health: 50 }, latch, 0);
    expect(latch).toEqual(freshLatch());
  });
});
