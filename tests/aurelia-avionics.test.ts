import { expect, test } from "bun:test";
import * as T from "three";
import { aureliaAvionicsDemo } from "../src/aircraft/aurelia/avionics-demo";
import { makeAureliaReference } from "../src/aircraft/aurelia/reference-model";

const pose = { gear: 1, flaps: 0 };
test("demo vertical speed agrees with the derivative of displayed altitude", () => {
  for (let time = 0; time <= 100; time += 0.7) {
    const step = 0.001;
    const a = aureliaAvionicsDemo(time - step, pose),
      b = aureliaAvionicsDemo(time + step, pose);
    expect(aureliaAvionicsDemo(time, pose).verticalSpeedFpm).toBeCloseTo(
      ((b.altitudeFt - a.altitudeFt) / (2 * step)) * 60,
      4,
    );
  }
});
test("demo bank angle agrees with speed and heading rate in a coordinated turn", () => {
  for (let time = 0; time <= 100; time += 0.7) {
    const step = 0.001;
    const a = aureliaAvionicsDemo(time - step, pose),
      b = aureliaAvionicsDemo(time + step, pose);
    const s = aureliaAvionicsDemo(time, pose);
    const headingRate =
      ((b.headingDeg - a.headingDeg) * Math.PI) / 180 / (2 * step);
    expect((9.80665 * Math.tan(s.roll)) / (s.speedKt * 0.514444)).toBeCloseTo(
      headingRate,
      8,
    );
    expect(s.pitch - 0.035).toBeCloseTo(
      Math.atan2(s.verticalSpeedFpm * 0.00508, s.speedKt * 0.514444),
      8,
    );
  }
});
test("demo remains finite over long sessions and reports actual inspection mechanism positions", () => {
  for (const time of [0, 10, 100, 10000, 1000000]) {
    const s = aureliaAvionicsDemo(time, { gear: 0.43, flaps: 0.61 });
    expect(
      [
        s.time,
        s.speedKt,
        s.altitudeFt,
        s.headingDeg,
        s.pitch,
        s.roll,
        s.busVoltage,
      ].every(Number.isFinite),
    ).toBe(true);
    for (const engine of s.engines) {
      expect(Object.values(engine).every(Number.isFinite)).toBe(true);
      expect(engine.fuelLb).toBeGreaterThanOrEqual(0);
    }
    expect(s.gear).toBe(0.43);
    expect(s.flaps).toBe(0.61);
  }
});
test("three widescreen primary instruments and two touch controllers are mounted in preserved fittings", () => {
  const root = makeAureliaReference().root;
  root.updateMatrixWorld(true);
  const displays: T.Object3D[] = [];
  root.traverse((o) => {
    if (o.userData.avionicsDisplay) displays.push(o);
  });
  expect(displays.map((o) => o.userData.avionicsDisplay).sort()).toEqual([
    "mfd",
    "pfd",
    "pfd",
    "touch-flight",
    "touch-systems",
  ]);
  for (const display of displays) {
    const glass =
      display instanceof T.Mesh
        ? display
        : (display.getObjectByName("Inactive_screen") as T.Mesh);
    glass.geometry.computeBoundingBox();
    const size = glass.geometry.boundingBox!.getSize(new T.Vector3());
    if (!(display instanceof T.Mesh))
      expect(size.x / size.y).toBeCloseTo(1.6, 1);
    expect(glass.getWorldScale(new T.Vector3()).x).toBeCloseTo(1, 6);
  }
});

test("demo map velocity matches its displayed groundspeed and heading", () => {
  for (let time = 0; time < 100; time += 0.7) {
    const a = aureliaAvionicsDemo(time - 0.001, pose).navigation.position;
    const b = aureliaAvionicsDemo(time + 0.001, pose).navigation.position;
    const s = aureliaAvionicsDemo(time, pose);
    const vx = (b.x - a.x) / 0.002,
      vz = (b.z - a.z) / 0.002;
    expect(Math.hypot(vx, vz) / (1852 / 3600)).toBeCloseTo(s.groundSpeedKt, 5);
    expect((Math.atan2(vx, -vz) * 180) / Math.PI).toBeCloseTo(s.headingDeg, 5);
  }
});
