import { createHash } from "node:crypto";
import { Vector3 } from "three";
import { FlightPhysics, type Controls } from "../src/flight/physics";
import type { AircraftId } from "../src/aircraft/aircraft";
import { aircraftDefinitionSources } from "./aircraft-source";
import { solveTrim } from "../src/flight/flight-trim";
import { ISLAND_FLIGHT_MODEL, islandEnvelope } from "../src/flight/flight-envelope";
import collisionGeometry from "../src/aircraft/airframe-collision.json";
// Repeatable tuning traces, not a test runner or a flight certification.
// All approaches/obstacle strikes below use seeded physical states.
const neutral: Controls = {
  pitch: 0,
  roll: 0,
  yaw: 0,
  throttle: 0,
  brake: false,
};
function aircraft(id: AircraftId, air = false) {
  const p = new FlightPhysics();
  p.aircraftId = id;
  p.windOverride = new Vector3();
  p.reset(air);
  return p;
}
function state(p: FlightPhysics) {
  return {
    tick: p.simulationTick,
    position: p.position.toArray(),
    velocity: p.velocity.toArray(),
    quaternion: p.quaternion.toArray(),
    rates: p.angularVelocity.toArray(),
    speed: p.airspeed,
    pitch: p.pitch,
    roll: p.roll,
    grounded: p.grounded,
    crashed: p.crashed,
    health: p.health,
    damage: { ...p.damage },
    wingDamage: { ...p.wingDamage },
    gear: p.gearPosition,
    flaps: p.flapPosition,
    mach: p.aerodynamics?.mach,
    finite: [
      ...p.position.toArray(),
      ...p.velocity.toArray(),
      ...p.angularVelocity.toArray(),
      ...p.quaternion.toArray(),
    ].every(Number.isFinite),
    loads: p.wheelContacts.map((c) => ({
      index: c.index,
      load: c.load,
      compression: c.compression,
    })),
  };
}
const models = [];
for (const id of [
  "aurelia",
  "finch",
  "peregrine",
  "stormbird",
] as AircraftId[]) {
  const start = performance.now();
  let ticks = 0;
  const p = aircraft(id);
  const departureTrace = [],
    departureEvents = [];
  let liftOff: ReturnType<typeof state> | null = null;
  for (let n = 0; n < 1200; n++) {
    p.step(1 / 60, {
      ...neutral,
      throttle: 1,
      pitch: p.airspeed * 1.943844 >= p.profile.rotationKnots ? 0.65 : 0,
    });
    ticks += 2;
    if (!p.grounded && !liftOff) liftOff = state(p);
    departureEvents.push(
      ...p.events.map((e) => ({ ...e, time: p.flightTime })),
    );
    if (n % 30 === 0) departureTrace.push({ time: p.flightTime, ...state(p) });
    if (liftOff && p.simulationTick - liftOff.tick > 360) break;
  }
  const a = aircraft(id, true);
  a.position.set(-260, 13, 410);
  a.gearPosition = 1;
  a.flapPosition = id === "finch" ? 0 : 0.65;
  const speed = a.stallSpeed * 1.35,
    polar = a.design.aerodynamics;
  const alpha =
    ((a.loadedMass * 9.80665) /
      (0.5 * 1.225 * speed ** 2 * a.design.geometry.wingArea) -
      polar.cl0 -
      polar.flapLift * a.flapPosition) /
    polar.liftSlope;
  a.velocity.set(0, -1.2, -speed);
  a.pitch = alpha - Math.atan2(1.2, speed);
  a.throttle = a.enginePower = 0.08;
  const approachTrace = [],
    approachEvents = [];
  for (let n = 0; n < 1200; n++) {
    a.step(1 / 60, {
      ...neutral,
      pitch: a.grounded
        ? 0
        : ((a.position.y < 11 ? alpha + 0.015 : alpha - 0.04) - a.pitch) * 4,
      throttle: a.grounded ? -1 : 0,
      brake: a.grounded,
    });
    ticks += 2;
    approachEvents.push(...a.events.map((e) => ({ ...e, time: a.flightTime })));
    if (n % 60 === 0) approachTrace.push({ time: a.flightTime, ...state(a) });
    if (a.crashed) break;
  }
  const trimPlane = aircraft(id, true);
  trimPlane.position.set(0, 600, 700);
  trimPlane.beginnerAssist = false;
  const trim = trimPlane.initializeAirStart(trimPlane.design.trimSpeed);
  for (let n = 0; n < 600; n++) {
    trimPlane.step(1 / 60, neutral);
    ticks += 2;
  }
  const glide = aircraft(id, true);
  glide.position.set(0, 600, 700);
  glide.initializeAirStart(glide.design.trimSpeed);
  glide.engineOut = true;
  for (let n = 0; n < 600; n++) {
    glide.step(1 / 60, neutral);
    ticks += 2;
  }
  const taxi = aircraft(id);
  taxi.throttle = 1;
  for (let n = 0; n < 180; n++) {
    taxi.step(1 / 60, { ...neutral, yaw: n > 60 ? -0.5 : 0 });
    ticks += 2;
  }
  const taxiTurn = state(taxi);
  taxi.throttle = 0;
  for (let n = 0; n < 420; n++) {
    taxi.step(1 / 60, { ...neutral, brake: true });
    ticks += 2;
  }
  const config = aircraft(id, true);
  config.position.set(0, 600, 700);
  config.setAutomaticConfiguration(false);
  const before = state(config),
    gearAccepted = config.toggleGear(),
    flapsAccepted = config.cycleFlaps();
  for (let n = 0; n < 360; n++) {
    config.step(1 / 60, neutral);
    ticks += 2;
  }
  const manual = state(config);
  config.setAutomaticConfiguration(true);
  config.step(1 / 120, neutral);
  ticks++;
  const restored = state(config);
  const grounded = aircraft(id);
  grounded.setAutomaticConfiguration(false);
  const groundRetractionAccepted = grounded.toggleGear();
  const strike = aircraft(id, true);
  strike.setAutomaticConfiguration(false);
  strike.position.set(0, 400, 100);
  strike.velocity.set(0, 0, -140);
  strike.pitch = 0;
  strike.beginnerAssist = false;
  const span = strike.design.geometry.span,
    wingX = -span * 0.42;
  const obstacle = {
    x: wingX,
    y: 430,
    z: 90,
    radius: 0.3,
    label: "Calibration pole",
  };
  const strikeEvents = [];
  for (let n = 0; n < 30; n++) {
    strike.step(1 / 60, neutral, [obstacle]);
    ticks += 2;
    strikeEvents.push(...strike.events);
  }
  const dive = aircraft(id, true);
  dive.position.set(0, 1700, 700);
  dive.pitch = -0.7;
  dive.beginnerAssist = false;
  dive.elevatorTrim = 0;
  dive.throttle = dive.enginePower = 1;
  dive.velocity.set(0, -90, -140);
  let peakMach = 0;
  for (let n = 0; n < 480; n++) {
    dive.step(1 / 60, neutral);
    ticks += 2;
    peakMach = Math.max(peakMach, dive.aerodynamics?.mach ?? 0);
    if (dive.grounded) break;
  }
  models.push({
    id,
    envelope: islandEnvelope[id],
    collisionAsset: collisionGeometry.models[id].sha256,
    departure: {
      liftOff,
      events: departureEvents,
      trace: departureTrace,
      final: state(p),
    },
    approach: { events: approachEvents, trace: approachTrace, final: state(a) },
    trim: { ...trim, final: state(trimPlane) },
    glide: { final: state(glide) },
    taxi: { turn: taxiTurn, stop: state(taxi) },
    configuration: {
      before,
      gearAccepted,
      flapsAccepted,
      manual,
      restored,
      groundRetractionAccepted,
    },
    wingStrike: { events: strikeEvents, final: state(strike) },
    dive: { peakMach, final: state(dive) },
    simulationCost: { ticks, elapsedMilliseconds: performance.now() - start },
  });
  console.log(
    id,
    `lift-off ${liftOff?.speed.toFixed(1)}m/s (${liftOff?.health}% health)`,
    `landing ${a.health}% health, stop ${a.velocity.length().toFixed(3)}m/s`,
    `pole ${strikeEvents.map((e) => e.part).join(",")}`,
    `peak M${peakMach.toFixed(3)}`,
  );
}
const modules = {
  ...Object.fromEntries(aircraftDefinitionSources.map((path) => [path, `../${path}`])),
  "physics.ts": "../src/flight/physics.ts",
  "aerodynamics.ts": "../src/flight/aerodynamics.ts",
  "aircraft-design.ts": "../src/aircraft/aircraft-design.ts",
  "engine-map.ts": "../src/flight/engine-map.ts",
  "flight-trim.ts": "../src/flight/flight-trim.ts",
  "rigid-body.ts": "../src/flight/rigid-body.ts",
  "wheel-contact.ts": "../src/flight/wheel-contact.ts",
  "collision.ts": "../src/flight/collision.ts",
  "airframe-contact.ts": "../src/flight/airframe-contact.ts",
  "airframe-collision.json": "../src/aircraft/airframe-collision.json",
  "flight-envelope.ts": "../src/flight/flight-envelope.ts",
  "terrain.ts": "../src/world/terrain.ts",
};
const hashes: Record<string, string> = {};
for (const [name, path] of Object.entries(modules))
  hashes[name] = createHash("sha256")
    .update(
      new Uint8Array(await Bun.file(new URL(path, import.meta.url)).arrayBuffer()),
    )
    .digest("hex");
await Bun.write(
  new URL("../output/island-physics/calibration.json", import.meta.url),
  JSON.stringify(
    {
      model: ISLAND_FLIGHT_MODEL,
      date: new Date().toISOString(),
      source: hashes,
      models,
    },
    null,
    2,
  ),
);
