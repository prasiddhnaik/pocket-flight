import fleet from "./fleet-geometry.json";
import f15c from "../src/aircraft/f15c/geometry.json";
import heron from "../src/aircraft/heron/geometry.json";
import aurelia from "./aurelia-geometry.json";
import { aircraftCatalog, type LabAircraftId } from "./aircraft";
import type { WingGeometry } from "./solver";

export function wingForAircraft(id: LabAircraftId): WingGeometry {
  return measuredWing(id, fleetMeasurements);
}

// The game's force coefficients still describe its legacy runtime exports.
export function runtimeWingForAircraft(id: LabAircraftId): WingGeometry {
  return measuredWing(id, [...fleet, heron, f15c]);
}

function measuredWing(id: LabAircraftId, measurements: typeof fleet) {
  const measured = measurements.find((g) => g.id === id);
  if (!measured)
    throw new Error(
      `Extract geometry for ${aircraftCatalog[id].name} before running the lab.`,
    );
  return {
    name: `${measured.name} main wing`,
    revision: measured.revision,
    stations: measured.stations,
    assumptions: measured.assumptions,
  };
}
export const fleetMeasurements = [
  ...fleet.map((g) => (g.id === "aurelia" ? aurelia : g)),
  heron,
  f15c,
];
