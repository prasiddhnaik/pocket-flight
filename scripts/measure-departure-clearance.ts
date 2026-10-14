import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MathUtils, Vector3 } from "three";
import { FlightPhysics } from "../src/physics";
import type { AircraftId } from "../src/aircraft";
import { aircraftDesign, massProperties } from "../src/aircraft-design";
import { airframeProbes } from "../src/airframe-contact";
import { aircraftThrust, airDensity, GRAVITY } from "../src/aerodynamics";
import { solveTrim } from "../src/flight-trim";
import { groundHeight, runways } from "../src/terrain";
import { missions } from "../src/missions";

// Read-only experiments: use the shipped dynamics, contacts, fuel burn and assist.
// Controllers issue ordinary pilot inputs; they never overwrite motion or mass.
const root = fileURLToPath(new URL("../", import.meta.url));
const ids: AircraftId[] = ["finch", "peregrine", "aurelia", "stormbird"];
const modes = ["full pull", "gentle pull", "10° attitude", "climb-speed control"] as const;
type Mode = typeof modes[number];
type Load = "default" | "zero payload" | "half default fuel";
type Wind = "game gusts" | "calm";
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 1, brake: false };
const deg = 180 / Math.PI;

function measure(id: AircraftId, load: Load, mode: Mode, wind: Wind, hz = 60) {
  const p = new FlightPhysics();
  p.aircraftId = id;
  const d = p.design;
  const loading = {
    fuel: d.defaultLoading.fuel * (load === "half default fuel" ? 0.5 : 1),
    payload: load === "zero payload" ? 0 : d.defaultLoading.payload,
  };
  p.configureLoading(loading);
  p.windOverride = wind === "calm" ? new Vector3() : null;
  p.reset();
  const probes = airframeProbes(id);
  const sample = () => {
    const speed = p.velocity.clone().sub(p.wind).length();
    const centerGround = groundHeight(p.position.x, p.position.z);
    const clearance = Math.min(...probes.map(probe => {
      const point = probe.center.clone().applyQuaternion(p.quaternion).add(p.position);
      return point.y - probe.radius - groundHeight(point.x, point.z);
    }));
    return {
      time: p.flightTime, x: p.position.x, y: p.position.y, z: p.position.z,
      terrain: centerGround, centerAgl: p.position.y - centerGround,
      bodyClearance: clearance, speed, knots: speed * 1.943844,
      verticalSpeed: p.velocity.y, horizontalSpeed: Math.hypot(p.velocity.x, p.velocity.z),
      pitchDegrees: p.pitch * deg,
      pathDegrees: Math.atan2(p.velocity.y, Math.hypot(p.velocity.x, p.velocity.z)) * deg,
      alphaDegrees: (p.aerodynamics?.alpha ?? 0) * deg,
      stallSpeed: p.stallSpeed, stalled: p.stall, grounded: p.grounded,
      lift: p.aerodynamics?.lift ?? 0, drag: p.aerodynamics?.drag ?? 0,
      thrust: p.installedThrust, enginePower: p.enginePower,
      mass: p.loadedMass, fuelKg: p.fuelKg, gear: p.gearPosition, flap: p.flapPosition,
      wind: p.wind.toArray(), health: p.health,
    };
  };
  const initial = {
    mass: p.loadedMass, fuelKg: p.fuelKg, loading, cg: p.massProperties.cg.toArray(),
    stallSpeed: p.stallSpeed, rotationKnots: p.profile.rotationKnots,
    position: p.position.toArray(), yaw: p.yaw, wingArea: d.geometry.wingArea,
    shaftPower: d.propulsion.shaftPower, dryThrust: d.propulsion.dryThrust,
  };
  const samples = [sample()];
  let liftoff: ReturnType<typeof sample> | null = null;
  let threshold: ReturnType<typeof sample> | null = null;
  let damage: { before: ReturnType<typeof sample>; after: ReturnType<typeof sample>; events: typeof p.events } | null = null;
  let gate: ReturnType<typeof sample> | null = null;
  let outcome = "time limit";
  for (let tick = 0; tick < hz * 60; tick++) {
    let pitch = 0;
    if (p.airspeed * 1.943844 >= p.profile.rotationKnots || liftoff) {
      if (mode === "full pull") pitch = 1;
      else if (mode === "gentle pull") pitch = 0.3;
      else if (!liftoff) pitch = 0.65;
      else if (mode === "10° attitude") pitch = MathUtils.clamp((10 / deg - p.pitch) * 2, -1, 1);
      else {
        // Test controller, not a change to beginner assist: hold 1.5× instantaneous
        // stall speed by commanding pitch rate. This is not an established Vy.
        pitch = MathUtils.clamp((p.airspeed - p.stallSpeed * 1.5) * 0.045, -0.5, 0.7);
      }
    }
    const before = sample();
    p.step(1 / hz, { ...neutral, pitch });
    if (!liftoff && p.events.some(e => e.type === "takeoff")) liftoff = sample();
    if (!gate && p.position.z <= 130) gate = sample();
    if (!threshold && p.position.z <= 25) threshold = sample();
    if (p.health < 100 || p.crashed) {
      damage = { before, after: sample(), events: [...p.events] };
      samples.push(before);
      outcome = "first damage";
      break;
    }
    if (tick % Math.round(hz / 4) === 0) samples.push(sample());
    if (p.position.z <= -700) { outcome = "past ridge"; break; }
    if (p.position.y >= 1799) { outcome = "game ceiling"; break; }
  }
  if (!damage) samples.push(sample());
  return { id, load, mode, wind, hz, initial, liftoff, gate, threshold, damage, outcome, samples };
}

const runs: ReturnType<typeof measure>[] = [];
for (const id of ids) {
  for (const load of ["default", "zero payload", "half default fuel"] as const)
    for (const mode of modes)
      for (const wind of ["game gusts", "calm"] as const)
        runs.push(measure(id, load, mode, wind));
  console.log(`${id}: 24 departure traces recorded`);
}
for (const hz of [30, 120]) runs.push(measure("finch", "default", "full pull", "game gusts", hz));

const estimates = [];
for (const id of ids) {
  const design = aircraftDesign(id);
  for (const load of ["default", "zero payload", "half default fuel"] as const) {
    const loading = {
      fuel: design.defaultLoading.fuel * (load === "half default fuel" ? 0.5 : 1),
      payload: load === "zero payload" ? 0 : design.defaultLoading.payload,
    };
    const balance = massProperties(design.massBudget, loading);
    const sweep = [];
    for (let speed = id === "finch" ? 22 : 40; speed <= (id === "finch" ? 65 : 180); speed++) {
      try {
        const trim = solveTrim(design, balance, speed, 100, id === "finch" ? 1 : 0);
        const thrust = aircraftThrust(design, speed, 1, airDensity(100), 100);
        const requiredThrust = aircraftThrust(design, speed, trim.throttle, airDensity(100), 100);
        const excess = (thrust - requiredThrust) * Math.cos(trim.alpha);
        const gradient = excess / (balance.mass * GRAVITY);
        sweep.push({ speed, gradient, rate: gradient * speed, trimAlphaDegrees: trim.alpha * deg });
      } catch (error) {
        if (!(error instanceof RangeError)) throw error;
      }
    }
    estimates.push({ id, load, altitude: 100, mass: balance.mass,
      bestRate: sweep.reduce<typeof sweep[number] | null>((a, b) => !a || b.rate > a.rate ? b : a, null),
      bestGradient: sweep.reduce<typeof sweep[number] | null>((a, b) => !a || b.gradient > a.gradient ? b : a, null), sweep });
  }
}

const terrain = [];
for (let z = 459; z >= -700; z -= 5) terrain.push({ z, distance: 459 - z, height: groundHeight(-260, z) });
const files = ["src/physics.ts", "src/aerodynamics.ts", "src/engine-map.ts", "src/flight-reference-data.ts",
  "src/aircraft-design.ts", "src/flight-profiles.ts", "src/finch-design.ts", "src/fuel-loading.ts",
  "src/fuel-mass-calibration.json", "src/terrain.ts", "src/collision.ts", "src/airframe-contact.ts",
  "src/airframe-collision.json", "src/wheel-contact.ts", "src/landing-gear.ts", "src/aurelia-motion.ts",
  "src/rigid-body.ts", "src/flight-envelope.ts", "src/flight-trim.ts", "src/missions.ts"];
const hashes = Object.fromEntries(await Promise.all(files.map(async path =>
  [path, createHash("sha256").update(new Uint8Array(await Bun.file(root + path).arrayBuffer())).digest("hex")])));
const report = {
  generatedAt: new Date().toISOString(), method: "Unmodified FlightPhysics; default beginner assist, automatic gear/flaps, full commanded throttle; stop at first damage, north z=-700, ceiling or 60s. 60Hz plus Finch 30/120Hz repeat. No scenery obstacles supplied: terrain contacts only. Actual triangulated groundHeight and mesh contact proxies. No production deployment.",
  limitations: ["Scripted controls and empty scenery obstacle list are not a browser playtest.",
    "Zero payload removes every component tagged payload, including crew where tagged: a diagnostic mass/CG case, not a normal piloted loading.",
    "10° attitude and 1.5× stall-speed controllers are experiments, not established Vx/Vy schedules.",
    "Excess-power sweep uses level trim at 100m with retracted jet gear and no flaps; small-angle estimates do not certify climb performance or account for ceiling protection.",
    "Source data for fictional aircraft remain design assumptions; real models are comparison references, not interchangeable performance targets."],
  runway: runways[0], missionRoute: missions.find(m => m.id === "discovery")!.rings.map(p => p.toArray()),
  hashes, terrain, runs, estimates,
  sources: [
    { title: "Diamond DA40 XLT — manufacturer", url: "https://www.diamondaircraft.com/en/private-owners/aircraft/da40/tech-specs/", powerHp: 180, maxMassKg: 1200, climbMps: 4, groundRollM: 305, obstacleDistanceM: 450, condition: "Manufacturer sea-level ISA performance; DA40 XLT variant. Different mass, geometry and propeller from Finch." },
    { title: "Citation CJ4 Gen3 — manufacturer", url: "https://txtav.com/CJ4-Gen2", maxMassKg: 7761, thrustPerEngineN: 16110, climbMps: 1175 / 60, takeoffFieldM: 1039, condition: "Current Gen3 page at legacy Gen2 URL. Listed maximum climb and takeoff field length are separate published figures, not an Aurelia matched-condition test." },
    { title: "FAA — Airplane Flying Handbook, Chapter 4", url: "https://www.faa.gov/sites/faa.gov/files/regulations_policies/handbooks_manuals/aviation/airplane_handbook/05_afh_ch4.pdf", condition: "Energy management, excess power, Vx/Vy and constant-speed climbs." },
  ],
};
await mkdir(root + "output", { recursive: true });
await Bun.write(root + "output/departure-research.json", JSON.stringify(report, null, 2));
console.table(runs.filter(r => r.hz === 60 && r.load === "default" && r.mode === "full pull" && r.wind === "game gusts").map(r => ({
  aircraft: r.id, massKg: r.initial.mass.toFixed(1), liftoffSeconds: r.liftoff?.time.toFixed(2),
  outcome: r.outcome, time: (r.damage?.before ?? r.samples.at(-1)!).time.toFixed(2),
  altitudeM: (r.damage?.before ?? r.samples.at(-1)!).y.toFixed(1),
  speedKnots: (r.damage?.before ?? r.samples.at(-1)!).knots.toFixed(1),
})));
console.log("Saved output/departure-research.json; no aircraft, terrain or control settings changed.");
