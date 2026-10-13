import { describe, expect, test } from "bun:test";
import {
  activeBand, airspeedScale, arcPath, clamp01, polar, ticks, unwrapHeading, valueAngle,
} from "../src/hud/geometry";

describe("hud geometry", () => {
  test("polar uses SVG angles: 0° east, 90° south", () => {
    const [x, y] = polar(100, 100, 10, 90);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(110);
  });
  test("valueAngle maps linearly and clamps outside the scale", () => {
    const s = { min: 0, max: 200, start: 135, sweep: 270 };
    expect(valueAngle(s, 100)).toBe(270);
    expect(valueAngle(s, -50)).toBe(135);
    expect(valueAngle(s, 900)).toBe(405);
    expect(Number.isNaN(valueAngle(s, Number.NaN))).toBe(false);
  });
  test("arcPath sets the large-arc flag only past 180°", () => {
    expect(arcPath(100, 100, 50, 0, 90)).toContain(" 0 0 1 ");
    expect(arcPath(100, 100, 50, 0, 270)).toContain(" 0 1 1 ");
  });
  test("ticks include both ends without float drift", () => {
    expect(ticks(-2000, 2000, 1000)).toEqual([-2000, -1000, 0, 1000, 2000]);
    expect(ticks(0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  test("unwrapHeading takes the short way through north", () => {
    expect(unwrapHeading(359, 1)).toBe(361);
    expect(unwrapHeading(1, 359)).toBe(-1);
    expect(unwrapHeading(720 + 10, 20)).toBe(740);
    expect(unwrapHeading(90, 90)).toBe(90);
  });
  test("airspeed scale orders stall < warning < redline <= dial max for every aircraft", () => {
    for (const id of ["finch", "peregrine", "aurelia", "stormbird"] as const) {
      const s = airspeedScale(id);
      const [green, amber] = s.bands;
      expect(green.from).toBeGreaterThan(0);
      expect(green.from).toBeLessThan(green.to);
      expect(green.to).toBe(amber.from);
      expect(amber.to).toBe(s.redline);
      expect(s.redline).toBeLessThanOrEqual(s.max);
    }
    expect(airspeedScale("finch").max).toBe(180);
    expect(airspeedScale("finch").redline).toBeCloseTo(165.37, 1);
    expect(airspeedScale("aurelia").max).toBe(450);
    expect(airspeedScale("stormbird").max).toBe(500);
  });
  test("activeBand finds the band containing the value", () => {
    const bands = [{ from: 50, to: 150, tone: "green" as const }, { from: 150, to: 165, tone: "amber" as const }];
    expect(activeBand(bands, 100)).toBe(0);
    expect(activeBand(bands, 160)).toBe(1);
    expect(activeBand(bands, 20)).toBe(-1);
  });
  test("clamp01 handles NaN as 0", () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
  });
});
