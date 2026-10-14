import type { FlightPhysics } from "../physics";

export type EngineReadout = { kind: "propeller"; rpm: number } | { kind: "jet"; percent: number };
export type InstrumentData = {
  engine: EngineReadout;
  fuelFraction: number;
  aoaDegrees: number;
  stallAoaDegrees: number;
};

const DEG = 180 / Math.PI;
const FALLBACK_STALL_DEGREES = 15;

export function fuelCapacityKg(p: FlightPhysics) {
  return p.design.massBudget.filter((part) => part.category === "fuel").reduce((sum, part) => sum + part.mass, 0);
}

export function instrumentData(p: FlightPhysics, propellerRpm: number): InstrumentData {
  const capacity = fuelCapacityKg(p);
  const aero = p.aerodynamics;
  return {
    engine: p.jet ? { kind: "jet", percent: p.enginePower * 100 } : { kind: "propeller", rpm: propellerRpm },
    fuelFraction: capacity > 0 ? Math.min(1, Math.max(0, p.fuelKg / capacity)) : 0,
    // Same wing-referenced alpha the stall model uses (flow alpha + incidence).
    aoaDegrees: aero ? (aero.alpha + p.design.geometry.incidence) * DEG : 0,
    stallAoaDegrees: aero ? aero.positiveStall * DEG : FALLBACK_STALL_DEGREES,
  };
}
