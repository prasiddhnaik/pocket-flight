import { describe, it, expect } from "bun:test";
import { FlightPhysics } from "../src/physics";
import { terrainHeight, runways, runwayLocal } from "../src/terrain";
import { missions, scoreFlight } from "../src/missions";
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
describe("Finch flight envelope", () => {
  it("binary keyboard rotation reaches the first checkpoint with climb margin", () => {
    for (const hz of [30, 60, 120]) {
      const p = new FlightPhysics();
      p.reset();
      let takeoff = false,
        gateHeight = 0;
      for (let i = 0; i < hz * 20; i++) {
        p.step(1 / hz, {
          ...neutral,
          throttle: 1,
          pitch: p.airspeed * 1.943844 >= p.profile.rotationKnots ? 1 : 0,
        });
        takeoff ||= p.events.some((e) => e.type === "takeoff");
        if (!gateHeight && p.position.z <= 130) gateHeight = p.position.y;
      }
      expect(takeoff).toBe(true);
      expect(gateHeight).toBeGreaterThan(35);
      expect(gateHeight).toBeLessThan(65);
      expect(p.position.y).toBeGreaterThan(55);
      expect(p.grounded).toBe(false);
      expect(p.stall).toBe(false);
      expect(p.health).toBe(100);
    }
  });
  it("beginner rotation assist tolerates holding the key early without bypassing the physical flight model", () => {
    const p = new FlightPhysics();
    p.reset();
    for (let i = 0; i < 1200; i++)
      p.step(1 / 60, { ...neutral, throttle: 1, pitch: 1 });
    expect(p.grounded).toBe(false);
    expect(p.position.y).toBeGreaterThan(55);
    expect(p.stall).toBe(false);
    expect(p.loadedMass).toBeLessThan(860);
    expect(p.loadedMass).toBeGreaterThan(859);
    expect(p.health).toBe(100);
    const manual = new FlightPhysics();
    manual.reset();
    manual.beginnerAssist = false;
    let maximumPitch = 0;
    for (let i = 0; i < 1200 && !manual.crashed; i++) {
      manual.step(1 / 60, { ...neutral, throttle: 1, pitch: 1 });
      maximumPitch = Math.max(maximumPitch, manual.pitch);
    }
    expect(maximumPitch).toBeGreaterThan(0.45);
  });
  it("takes off with full throttle and a gentle pull before the end of Palm Bay", () => {
    const p = new FlightPhysics();
    p.reset();
    let tookOff = false;
    for (let i = 0; i < 1200; i++) {
      p.step(1 / 60, {
        ...neutral,
        throttle: 1,
        pitch:
          p.airspeed * 1.943844 > p.profile.rotationKnots && p.pitch < 0.15
            ? 0.3
            : 0,
      });
      if (!p.grounded) {
        tookOff = true;
        expect(p.position.z).toBeGreaterThan(25);
        break;
      }
    }
    expect(tookOff).toBe(true);
    expect(p.health).toBe(100);
  });
  it("can land smoothly and stop on the runway without damage", () => {
    const p = new FlightPhysics();
    p.reset(true);
    p.position.set(-260, 13, 410);
    const speed = p.stallSpeed * 1.35;
    const a = p.design.aerodynamics;
    const alpha =
      ((p.loadedMass * 9.80665) /
        (0.5 * 1.225 * speed ** 2 * p.design.geometry.wingArea) -
        a.cl0) /
      a.liftSlope;
    p.velocity.set(0, -1.4, -speed);
    p.pitch = alpha - Math.atan2(1.4, speed);
    p.throttle = 0.12;
    let landing = false;
    for (let i = 0; i < 1200; i++) {
      p.step(1 / 60, {
        ...neutral,
        pitch: p.grounded
          ? 0
          : ((p.position.y < 10.8 ? alpha + 0.015 : alpha - 0.04) - p.pitch) *
            4,
        throttle: p.grounded ? -1 : 0,
        brake: p.grounded,
      });
      for (const e of p.events)
        if (e.type === "landing") {
          expect(e.runway).toBe("Palm Bay");
          expect(e.sink!).toBeLessThan(2.5);
          landing = true;
        }
    }
    expect(landing).toBe(true);
    expect(p.grounded).toBe(true);
    expect(p.velocity.length()).toBeLessThan(1);
    expect(p.position.z).toBeGreaterThan(runways[0].z - runways[0].length / 2);
    expect(p.health).toBe(100);
  });
  it("stalls at low airspeed and loses altitude with the engine off", () => {
    const p = new FlightPhysics();
    p.reset(true);
    p.position.set(0, 600, 700);
    p.velocity.set(0, 0, -12);
    p.engineOut = true;
    p.pitch = 0.5;
    let stalled = false;
    for (let i = 0; i < 120; i++) {
      p.step(1 / 60, neutral);
      stalled ||= p.stall;
    }
    expect(stalled).toBe(true);
    expect(p.position.y).toBeLessThan(599);
  });
  it("glides forward with no engine and retains recoverable damage", () => {
    const p = new FlightPhysics();
    p.reset(true);
    p.position.set(0, 500, 700);
    p.velocity.set(0, 0, -32);
    p.engineOut = true;
    p.impact(0.5, "gear");
    for (let i = 0; i < 600; i++) p.step(1 / 60, neutral);
    expect(p.position.z).toBeLessThan(500);
    expect(p.position.y).toBeLessThan(500);
    expect(p.position.y).toBeGreaterThan(440);
    expect(p.crashed).toBe(false);
    expect(p.damage.gear).toBe(0.5);
  });
  it("damages gear after a hard landing, while a major impact crashes", () => {
    const p = new FlightPhysics();
    p.reset(true);
    p.position.set(-260, 9.8, 350);
    p.velocity.set(0, -7, -27);
    p.step(1 / 60, neutral);
    for (let i = 0; i < 8; i++) p.step(1 / 60, neutral);
    expect(p.damage.gear).toBeGreaterThan(0);
    expect(p.crashed).toBe(false);
    p.lastImpact = 0;
    p.impact(1.1, "wing");
    expect(p.crashed).toBe(true);
  });
  it("crashes into a steep hillside instead of teleporting up it", () => {
    const p = new FlightPhysics();
    p.reset(true);
    p.position.set(-260, 65, 6);
    p.velocity.set(0, 0, -45);
    for (let i = 0; i < 300 && !p.crashed; i++) p.step(1 / 60, neutral);
    expect(p.crashed).toBe(true);
  });
  it("damage lowers engine acceleration", () => {
    const healthy = new FlightPhysics(),
      damaged = new FlightPhysics();
    for (const p of [healthy, damaged]) {
      p.reset(true);
      p.position.set(0, 500, 800);
      p.throttle = 1;
    }
    damaged.damage.engine = 0.8;
    for (let i = 0; i < 300; i++) {
      healthy.step(1 / 60, neutral);
      damaged.step(1 / 60, neutral);
    }
    expect(healthy.airspeed).toBeGreaterThan(damaged.airspeed + 4);
  });
  it("levels out after a bank and responds to crosswind", () => {
    const p = new FlightPhysics();
    p.reset(true);
    p.position.set(0, 500, 800);
    p.roll = 0.6;
    p.strongWind = true;
    for (let i = 0; i < 180; i++) p.step(1 / 60, neutral);
    expect(Math.abs(p.roll)).toBeLessThan(0.08);
    expect(p.wind.x).toBeGreaterThan(6);
    expect(Math.abs(p.yaw)).toBeGreaterThan(0.05);
  });
});
describe("island and missions", () => {
  it("keeps every checkpoint clear of terrain across the flying aperture", () => {
    for (const m of missions)
      for (const p of m.rings)
        expect(p.y - terrainHeight(p.x, p.z)).toBeGreaterThan(23);
  });
  it("has flat, correctly oriented runways", () => {
    for (const r of runways)
      for (const z of [-r.length * 0.4, 0, r.length * 0.4]) {
        const x = r.x + Math.sin(r.heading) * z,
          worldZ = r.z + Math.cos(r.heading) * z;
        expect(terrainHeight(x, worldZ)).toBeCloseTo(r.y, 3);
        expect(runwayLocal(x, worldZ, r).x).toBeCloseTo(0, 4);
      }
  });
  it("rewards smooth, precise and undamaged flights", () => {
    const smooth = scoreFlight(100, 150, 100, 1, 0.95, 6),
      rough = scoreFlight(220, 150, 55, 6, 0.2, 6);
    expect(smooth.medal).toBe("gold");
    expect(smooth.score).toBeGreaterThan(rough.score);
  });
});
