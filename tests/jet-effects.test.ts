import { test, expect } from "bun:test";
import { JetMotion, initialJetInput, lightOffKick, sequenceInput } from "../src/aircraft/jet-effects";
import { applyJetReplay } from "../src/replay/replay-jet";
test("afterburner cannot light at idle and spools smoothly before ignition", () => {
  const s = new JetMotion(),
    i = initialJetInput();
  i.burner = true;
  for (let n = 0; n < 180; n++) s.update(1 / 60, i);
  expect(s.burner).toBe(0);
  i.throttle = 1;
  s.update(1 / 60, i);
  expect(s.rpm).toBeLessThan(0.02);
  for (let n = 0; n < 360; n++) s.update(1 / 60, i);
  expect(s.burner).toBeGreaterThan(0.95);
  i.throttle = 0;
  i.burner = false;
  for (let n = 0; n < 600; n++) s.update(1 / 60, i);
  expect(s.burner).toBeLessThan(0.001);
  expect(s.rpm).toBeLessThan(0.01);
});
test("pause freezes every state including running engines and moving gear", () => {
  const s = new JetMotion(),
    i = sequenceInput("afterburner", 4);
  s.update(0.05, i);
  const frozen = JSON.stringify(s);
  s.update(0, sequenceInput("landing", 9));
  expect(JSON.stringify(s)).toBe(frozen);
});
test("motion converges consistently across browser frame rates", () => {
  const states = [30, 60, 144].map((fps) => {
    const s = new JetMotion();
    for (let n = 0; n < fps * 5; n++)
      s.update(1 / fps, sequenceInput("afterburner", n / fps));
    return s;
  });
  for (const s of states) {
    expect(s.rpm).toBeCloseTo(states[0].rpm, 5);
    expect(s.gear).toBeCloseTo(states[0].gear, 5);
    expect(Math.abs(s.burner - states[0].burner)).toBeLessThan(0.01);
  }
});
test("canopy interlock closes it under power and landing cue returns to stopped state", () => {
  const s = new JetMotion(),
    i = initialJetInput();
  i.canopy = true;
  for (let n = 0; n < 180; n++) s.update(1 / 60, i);
  expect(s.canopy).toBeGreaterThan(0.99);
  i.throttle = 1;
  for (let n = 0; n < 360; n++) s.update(1 / 60, i);
  expect(s.canopy).toBeLessThan(0.001);
  const landing = sequenceInput("landing", 18);
  expect(landing.gear).toBe(true);
  expect(landing.speed).toBe(0);
  expect(landing.throttle).toBe(0);
});

test("persistent contrails require the high-altitude cruise preview", () => {
  expect(sequenceInput("cruise", 10).contrails).toBe(true);
  for (const mode of ["manual", "startup", "takeoff", "afterburner", "landing", "emergency"] as const)
    expect(sequenceInput(mode, 10).contrails).toBe(false);
});

test("the burner marks ignition once, and the flash dies away", () => {
  const s = new JetMotion(), i = initialJetInput();
  i.throttle = 1;
  i.powerResolved = true;
  expect(lightOffKick(s.lightOffAge)).toBeLessThan(.001);
  for (let n = 0; n < 60; n++) s.update(1 / 60, i);
  expect(s.burner).toBe(0);
  i.burner = true;
  const flash: number[] = [];
  for (let n = 0; n < 120; n++) {
    s.update(1 / 60, i);
    flash.push(lightOffKick(s.lightOffAge));
  }
  expect(Math.max(...flash)).toBeGreaterThan(.5);
  expect(flash.at(-1)!).toBeLessThan(.01);
  expect(flash.filter((value, n) => n > 0 && value > flash[n - 1] + .001 && flash[n - 1] < .001).length).toBe(1);
});

test("a replay frame carries the light-off moment, and old frames do not need it", () => {
  const s = new JetMotion();
  expect({ ...s }).toHaveProperty("lightOffAge", 10);
  applyJetReplay(s, { lightOffAge: .05, burner: .4 });
  expect(lightOffKick(s.lightOffAge)).toBeGreaterThan(.5);
  const old = new JetMotion();
  applyJetReplay(old, { burner: .4 });
  expect(lightOffKick(old.lightOffAge)).toBeLessThan(.001);
});
