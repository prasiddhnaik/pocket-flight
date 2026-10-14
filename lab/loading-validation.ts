import { Vector3 } from "three";
import type { AircraftId } from "../src/aircraft";
import {
  aircraftDesign,
  massProperties,
  type Loading,
} from "../src/aircraft-design";
import { aircraftStallSpeed } from "../src/aerodynamics";
import { consumeTankFuel } from "../src/fuel-loading";
import { FlightPhysics } from "../src/physics";
import { solveTrim } from "../src/flight-trim";
import { validateGear } from "./gear-validation";

export function loadingSnapshot(id: AircraftId, loading: Loading) {
  const design = aircraftDesign(id),
    balance = massProperties(design.massBudget, loading);
  const cgAllowed =
    balance.cg.z >= design.cgEnvelope[0] &&
    balance.cg.z <= design.cgEnvelope[1];
  let trim: ReturnType<typeof solveTrim> | null = null,
    trimError = "";
  try {
    trim = solveTrim(
      design,
      balance,
      design.trimSpeed,
      1000,
      id === "finch" ? 1 : 0,
    );
  } catch (error) {
    trimError = String(error);
  }
  return {
    loading,
    mass: balance.mass,
    cg: balance.cg.toArray(),
    inertia: balance.inertia.elements,
    fuelKg: balance.fuelKg,
    fuelByTank: balance.fuelByTank,
    unusableFuelKg: balance.unusableFuelKg,
    staticMargin:
      (design.neutralPointZ - balance.cg.z) /
      design.geometry.meanAerodynamicChord,
    cgAllowed,
    massAllowed: balance.mass <= design.maxTakeoffMass + 1e-6,
    stallSpeed: aircraftStallSpeed(design, balance.mass),
    trim,
    trimError,
  };
}

export function validateLoading(id: AircraftId) {
  const design = aircraftDesign(id),
    fuel = design.fuel;
  const cases = [
    { name: "Dispatch", loading: design.defaultLoading },
    ...[0, 0.1, 0.5, 1].map((fraction) => ({
      name: `${fraction * 100}% fuel / full payload`,
      loading: { fuel: fraction, payload: 1 },
    })),
    { name: "Full tanks / no payload", loading: { fuel: 1, payload: 0 } },
  ].map((c) => ({ name: c.name, ...loadingSnapshot(id, c.loading) }));
  const burnSweep = [];
  let quantities = { ...design.nominal.fuelByTank };
  for (let step = 0; step <= 60; step++) {
    const tanks = Object.fromEntries(
      fuel.tanks.map((t) => [
        t.id,
        quantities[t.id] / (t.usableLitres * t.densityKgPerLitre),
      ]),
    );
    burnSweep.push(loadingSnapshot(id, { ...design.defaultLoading, tanks }));
    quantities = consumeTankFuel(
      fuel.tanks,
      quantities,
      design.nominal.fuelKg / 60,
    );
  }
  const p = new FlightPhysics();
  p.aircraftId = id;
  p.configureLoading(design.defaultLoading);
  p.windOverride = new Vector3();
  p.reset(true);
  p.position.set(0, 1000, 700);
  p.yaw = 0;
  p.initializeAirStart(design.trimSpeed);
  p.beginnerAssist = false;
  const before = {
    mass: p.loadedMass,
    fuel: p.fuelKg,
    cg: p.massProperties.cg.toArray(),
  };
  for (let n = 0; n < 1800; n++)
    p.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false });
  const massLossError = Math.abs(
    before.mass - p.loadedMass - (before.fuel - p.fuelKg),
  );
  const powered = {
    seconds: 30,
    before,
    after: {
      mass: p.loadedMass,
      fuel: p.fuelKg,
      cg: p.massProperties.cg.toArray(),
      tanks: { ...p.massProperties.fuelByTank },
    },
    massLossError,
    health: p.health,
    height: p.position.y,
  };
  p.engineOut = true;
  const engineOutFuel = p.fuelKg;
  for (let n = 0; n < 60; n++)
    p.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false });
  const engineOutBurn = engineOutFuel - p.fuelKg;
  p.configureLoading({ fuel: 0, payload: 1 });
  p.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false });
  const cutoff = {
    usableFuel: p.fuelKg,
    remainingMass: p.loadedMass,
    unusableFuel: p.massProperties.unusableFuelKg,
    thrust: p.installedThrust,
  };
  const emptyCabin =
    id === "aurelia"
      ? [0.1, 1].map((fuel) => {
          const loading = { fuel, payload: 0 };
          const snapshot = loadingSnapshot(id, loading);
          const flight = new FlightPhysics();
          flight.aircraftId = id;
          flight.configureLoading(loading);
          flight.reset(true);
          flight.position.set(0, 1000, 700);
          flight.windOverride = new Vector3();
          flight.initializeAirStart(design.trimSpeed);
          flight.beginnerAssist = false;
          for (let n = 0; n < 1800; n++)
            flight.step(1 / 60, {
              pitch: 0,
              roll: 0,
              yaw: 0,
              throttle: 0,
              brake: false,
            });
          return {
            loading,
            cgAllowed: snapshot.cgAllowed,
            staticMargin: snapshot.staticMargin,
            health: flight.health,
            height: flight.position.y,
            stalled: flight.stall,
          };
        })
      : [];
  const gear = validateGear(id);
  const checks = [
    {
      name: "Dispatch respects takeoff mass and CG limits",
      pass: cases[0].cgAllowed && cases[0].massAllowed,
    },
    {
      name: "Fuel burn conserves mass within the 0.25 s balance update interval",
      pass: massLossError < design.propulsion.fuelRate * 0.5 + 1e-5,
    },
    {
      name: "Powered 30 s flight remains undamaged",
      pass: powered.health === 100 && Math.abs(powered.height - 1000) < 10,
    },
    { name: "Engine cutoff stops fuel consumption", pass: engineOutBurn === 0 },
    {
      name: "Exhausted usable fuel removes thrust and retains unusable fuel mass",
      pass:
        cutoff.usableFuel === 0 &&
        cutoff.thrust === 0 &&
        cutoff.unusableFuel > 0,
    },
    {
      name: "Planned centre-first burn remains within the CG envelope",
      pass: burnSweep.every((s) => s.cgAllowed),
    },
    ...gear.checks,
    ...(id === "aurelia"
      ? [
          {
            name: "Empty cabin keeps stable CG and undamaged unassisted flight at low and full fuel",
            pass:
              Array.from({ length: 101 }, (_, i) =>
                loadingSnapshot(id, { fuel: i / 100, payload: 0 }),
              ).every(
                (s) => s.cgAllowed && s.staticMargin > 0.03 && s.trim !== null,
              ) &&
              emptyCabin.every(
                (c) =>
                  c.health === 100 &&
                  !c.stalled &&
                  Math.abs(c.height - 1000) < 10,
              ),
          },
        ]
      : []),
  ];
  return {
    id,
    version: "fuel-balance-gear-2",
    cases,
    burnSweep,
    powered,
    engineOutBurn,
    cutoff,
    emptyCabin,
    gear,
    checks,
  };
}
export type LoadingValidation = ReturnType<typeof validateLoading>;
