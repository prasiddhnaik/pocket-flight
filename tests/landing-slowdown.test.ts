import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Vector3 } from "three";
import type { AircraftId } from "../src/aircraft/aircraft";
import type { Snapshot } from "../src/flight/game";
import { missions } from "../src/flight/missions";
import { FlightPhysics } from "../src/flight/physics";
import { FlightHud } from "../src/hud/FlightHud";
import { landingCue } from "../src/hud/landing-cue";
import { runways } from "../src/world/terrain";

const KNOTS = 1.943844;
const STEP = 1 / 60;
const free = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
const closing = { ...free, throttle: -1 };

// Measured at full power in level flight before this change.
const topKnots: Record<AircraftId, number> = {
  finch: 73,
  heron: 152,
  aurelia: 367,
  peregrine: 436,
  stormbird: 439,
  f15c: 440,
};
// Fast enough to fly clean, slow enough for full flaps: about 1.72 x clean stall.
const flapKnots = {
  heron: 126,
  aurelia: 139,
  peregrine: 132,
  stormbird: 136,
  f15c: 181,
};
const flapped = ["heron", "aurelia", "peregrine", "stormbird", "f15c"] as const;
const retractable: AircraftId[] = ["aurelia", "peregrine", "stormbird", "f15c"];
const everyAircraft = Object.keys(topKnots) as AircraftId[];

function cruising(id: AircraftId, knots = topKnots[id] * 0.9, power = 0.5) {
  const p = new FlightPhysics();
  p.aircraftId = id;
  p.reset(true);
  p.initializeAirStart(knots / KNOTS);
  p.position.set(-260, 500, 2600);
  p.throttle = p.enginePower = power;
  p.updateQuaternion();
  return p;
}
const run = (p: FlightPhysics, seconds: number, input = free) => {
  for (let n = 0; n < seconds / STEP; n++) p.step(STEP, input);
};

describe("automatic gear and flaps when slowing down", () => {
  for (const id of flapped) {
    test(`${id}: closing the throttle near approach speeds commands full flaps`, () => {
      const p = cruising(id, flapKnots[id]);
      run(p, 0.1);
      expect(p.flapCommand).toBe(0);
      run(p, 3, closing);
      expect(p.flapCommand).toBe(1);
      run(p, 3, closing);
      expect(p.flapPosition).toBeGreaterThan(0.9);
    }, 30000);
    test(`${id}: reopening the throttle takes the flaps off full`, () => {
      const p = cruising(id);
      run(p, 3, closing);
      run(p, 2, { ...free, throttle: 1 });
      expect(p.flapCommand).toBeLessThan(1);
    }, 30000);
    test(`${id}: an engine-out glide keeps flying clean`, () => {
      const p = cruising(id);
      p.engineOut = true;
      run(p, 3, closing);
      expect(p.flapCommand).toBe(0);
    }, 30000);
    test(`${id}: manual mode ignores the closed throttle`, () => {
      const p = cruising(id);
      p.setAutomaticConfiguration(false);
      run(p, 3, closing);
      expect(p.flapCommand).toBe(0);
    }, 30000);
  }
  for (const id of retractable) {
    test(`${id}: closing the throttle in flight lowers the gear`, () => {
      const p = cruising(id);
      expect(p.gearPosition).toBe(0);
      run(p, 6, closing);
      expect(p.gearPosition).toBe(1);
    }, 30000);
    test(`${id}: flaps wait for the aircraft to slow from top speed`, () => {
      const p = cruising(id, topKnots[id], 1);
      run(p, 3, closing);
      expect(p.flapCommand).toBeLessThan(0.5);
    }, 30000);
  }
  test("a runway start with the throttle closed keeps takeoff flaps", () => {
    for (const [id, flaps] of [["aurelia", 0.65], ["heron", 0.5]] as const) {
      const p = new FlightPhysics();
      p.aircraftId = id;
      p.reset();
      run(p, 1, closing);
      expect(p.flapCommand).toBe(flaps);
    }
  }, 30000);
});

describe("speed brakes", () => {
  for (const id of retractable) {
    test(`${id}: holding the brake in flight slows the aircraft harder`, () => {
      const open = cruising(id), held = cruising(id);
      run(open, 4, free);
      run(held, 4, { ...free, brake: true });
      expect(held.airbrakePosition).toBeGreaterThan(0.9);
      expect(held.velocity.length()).toBeLessThan(open.velocity.length() - 3);
    }, 30000);
  }
  for (const id of ["finch", "heron"] as const) {
    test(`${id}: has no speed brake`, () => {
      const p = cruising(id);
      run(p, 2, { ...free, brake: true });
      expect(p.airbrakePosition).toBe(0);
    }, 30000);
  }
});

describe("room to land", () => {
  for (const id of everyAircraft) {
    test(`${id}: slows from top speed to approach speed in under 3 km`, () => {
      const p = cruising(id, topKnots[id], 1);
      const approach = p.profile.approachKnots / KNOTS;
      const startHeight = p.position.y;
      let metres = 0;
      let highest = startHeight;
      for (let n = 0; n < 240 / STEP && p.velocity.length() > approach; n++) {
        p.step(STEP, { ...closing, brake: true });
        metres += Math.hypot(p.velocity.x, p.velocity.z) * STEP;
        highest = Math.max(highest, p.position.y);
      }
      expect(p.velocity.length()).toBeLessThanOrEqual(approach);
      expect(metres).toBeLessThan(3000);
      expect(highest - startHeight).toBeLessThan(100);
      expect(p.crashed).toBe(false);
      expect(p.stall).toBe(false);
    }, 30000);
  }

  // Touches down 60 m past the threshold at approach speed, in the landing direction.
  function touchdown(id: AircraftId, runway: (typeof runways)[number]) {
    const resting = new FlightPhysics();
    resting.aircraftId = id;
    resting.reset(false, false, runway);
    const wheelHeight = resting.position.y - runway.y;
    const p = new FlightPhysics();
    p.aircraftId = id;
    p.reset(true, false, runway);
    const along = new Vector3(Math.sin(runway.heading), 0, Math.cos(runway.heading));
    const start = runway.length / 2 - 60;
    p.position.set(runway.x + along.x * start, runway.y + wheelHeight + 0.4, runway.z + along.z * start);
    p.gearPosition = 1;
    p.flapPosition = p.hasFlaps ? 1 : 0;
    p.pitch = 0.05;
    p.throttle = p.enginePower = 0;
    p.updateQuaternion();
    p.velocity.copy(along).multiplyScalar(-p.profile.approachKnots / KNOTS);
    p.velocity.y = -1;
    return { p, along };
  }
  // The F-15C needs about 340 m at realistic braking, so Needle Point stays out of its reach.
  const fitsRunway = (id: AircraftId, runway: (typeof runways)[number]) =>
    !(id === "f15c" && runway.short);
  for (const runway of runways.slice(0, 2)) {
    for (const id of everyAircraft.filter((aircraft) => fitsRunway(aircraft, runway))) {
      test(`${id}: stops on the ${runway.length} m ${runway.name} runway`, () => {
        const { p, along } = touchdown(id, runway);
        for (let n = 0; n < 60 / STEP && (!p.grounded || p.velocity.length() > 1); n++)
          p.step(STEP, { ...closing, brake: true });
        expect(p.crashed).toBe(false);
        expect(p.grounded).toBe(true);
        expect(p.velocity.length()).toBeLessThanOrEqual(1);
        const position = p.position.clone().sub(new Vector3(runway.x, p.position.y, runway.z));
        expect(Math.abs(position.dot(along))).toBeLessThan(runway.length / 2);
      }, 30000);
    }
  }
});

describe("a full approach", () => {
  const runway = runways[0];
  const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value));
  for (const id of everyAircraft) {
    test(`${id}: a scripted 3 degree approach lands undamaged and stops on the runway`, () => {
      const resting = new FlightPhysics();
      resting.aircraftId = id;
      resting.reset();
      const wheelHeight = resting.position.y - runway.y;
      const p = new FlightPhysics();
      p.aircraftId = id;
      p.windOverride = new Vector3();
      p.reset(true);
      const approach = p.profile.approachKnots / KNOTS;
      // Aims 90 m past the threshold, which keeps the wings above the rise short of the runway.
      const aim = runway.z + runway.length / 2 - 90;
      const glide = Math.tan((3 * Math.PI) / 180);
      const heightAt = (z: number) => runway.y + wheelHeight + (z - aim) * glide;
      p.position.set(runway.x, heightAt(aim + 1400), aim + 1400);
      p.gearPosition = 1;
      p.flapPosition = p.hasFlaps ? 1 : 0;
      p.slowingToLand = true;
      const descentPower = p.initializeAirStart(approach).throttle * 0.5;
      p.velocity.y = -approach * glide;
      p.updateQuaternion();
      let touchdownKnots = 0;
      let lowestSpeed = Infinity;
      for (let n = 0; n < 150 / STEP && (!p.grounded || p.velocity.length() > 1) && !p.crashed; n++) {
        const speed = p.velocity.length();
        const wheels = p.position.y - (runway.y + wheelHeight);
        if (p.grounded) touchdownKnots ||= speed * KNOTS;
        else lowestSpeed = Math.min(lowestSpeed, speed);
        // Flare over the last five metres so the sink rate falls to a gentle touchdown.
        const wanted = p.grounded
          ? 0
          : wheels < 5
            ? -0.6 - wheels * 0.35
            : -speed * glide + clamp((heightAt(p.position.z) - p.position.y) * 0.2, -2, 2);
        const error = wanted - p.velocity.y;
        p.throttle = p.grounded || wheels < 2.5 ? 0 : clamp(descentPower + (approach - speed) * 0.06, 0, 0.6);
        p.step(STEP, {
          ...free,
          pitch: p.grounded || Math.abs(error) < 0.1 ? 0 : clamp(error * 0.05, -0.5, 0.5),
          brake: p.grounded,
        });
      }
      expect(p.crashed).toBe(false);
      expect(p.health).toBe(100);
      expect(p.grounded).toBe(true);
      expect(p.velocity.length()).toBeLessThanOrEqual(1);
      expect(touchdownKnots).toBeLessThan(p.profile.approachKnots + 5);
      expect(lowestSpeed).toBeGreaterThan(p.profile.stallSpeed * 0.9);
      expect(p.flapPosition).toBeCloseTo(p.hasFlaps ? 1 : 0, 3);
      expect(Math.abs(p.position.z - runway.z)).toBeLessThan(runway.length / 2);
    }, 30000);
  }
});

describe("landing cue", () => {
  const base = { active: true, speed: 97, approachKnots: 97, speedBrake: true };
  test("stays hidden until the pilot is slowing down", () => {
    expect(landingCue({ ...base, active: false })).toBeNull();
  });
  test("tells the pilot how far above the target they are", () => {
    expect(landingCue({ ...base, speed: 150 })).toMatchObject({ target: 97, state: "fast" });
    expect(landingCue({ ...base, speed: 103 })?.state).toBe("fast");
  });
  test("treats five knots either side as on speed", () => {
    expect(landingCue({ ...base, speed: 102 })?.state).toBe("on-speed");
    expect(landingCue({ ...base, speed: 92 })?.state).toBe("on-speed");
  });
  test("warns when below the target", () => {
    expect(landingCue({ ...base, speed: 91 })?.state).toBe("slow");
  });
  test("only suggests the speed brake on aircraft that have one", () => {
    expect(landingCue({ ...base, speed: 150 })?.text).toContain("hold B");
    expect(landingCue({ ...base, speed: 150, speedBrake: false })?.text).not.toContain("hold B");
  });
});

describe("landing display in the HUD", () => {
  const hud = (patch: Partial<Snapshot>, aircraftId: AircraftId = "aurelia") =>
    renderToStaticMarkup(createElement(FlightHud, {
      game: null,
      mission: missions[0],
      aircraftId,
      beginnerAssist: true,
      automaticConfiguration: true,
      sound: false,
      voiceWarnings: false,
      map: null,
      onToggleSound: () => {},
      onOpenControls: () => {},
      snapshot: {
        ...flying,
        ...patch,
      },
    }));
  const flying = {
    mode: "playing", grounded: false, speed: 150, slowingToLand: true, speedBrake: 0, health: 100,
    time: 30, throttle: 0, altitude: 900, verticalSpeed: 0, heading: 0, gearPosition: 1, flapPosition: 1,
    fuel: 80, ring: 0, totalRings: 0, target: null, stall: false, hint: "", damage: { gear: 0, wing: 0, engine: 0, propeller: 0 },
    automaticConfiguration: true, elevatorTrim: 0, windSpeed: 0, windFrom: 0, wind: 0,
    instruments: { fuelFraction: 0.8, aoaDegrees: 5, aoaFraction: 0.2, enginePercent: 0, propRpm: 0, engine: { kind: "jet", percent: 0 } },
  } as unknown as Snapshot;
  test("shows the approach speed while slowing down in flight", () => {
    expect(hud({})).toContain("Slow to 89 kn");
  });
  test("hides it on the ground", () => {
    expect(hud({ grounded: true })).not.toContain("Slow to");
  });
  test("hides it during normal flight", () => {
    expect(hud({ slowingToLand: false })).not.toContain("Slow to");
  });
  test("shows when the speed brake is out", () => {
    expect(hud({})).not.toContain("SPEED BRAKE");
    expect(hud({ speedBrake: 1 })).toContain("SPEED BRAKE");
  });
});
