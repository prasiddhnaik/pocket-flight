import { expect, test } from "bun:test";
import { Actuator, controlCheck } from "../src/aurelia-motion";

test("actuator converges without overshoot and remains frame-rate independent", () => {
  const values = [30, 60, 144].map(fps => {
    const a = new Actuator();
    for (let i = 0; i < fps; i++) {
      a.step(1, 1 / fps);
      expect(a.value).toBeGreaterThanOrEqual(0);
      expect(a.value).toBeLessThanOrEqual(1);
    }
    return a.value;
  });
  expect(values[0]).toBeCloseTo(values[2], 10);
  expect(values[1]).toBeGreaterThan(.998);
});
test("reversal preserves continuous motion and inspection loop returns to neutral", () => {
  const a = new Actuator();
  a.step(1, .3);
  const before = a.value;
  a.step(-1, .001);
  expect(Math.abs(a.value - before)).toBeLessThan(.01);
  expect(controlCheck(0)).toBe(0);
  expect(controlCheck(16)).toBeCloseTo(0);
});
