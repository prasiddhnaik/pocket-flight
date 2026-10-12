import fleet from "./fleet-geometry.json";
import { aircraftCatalog, type LabAircraftId } from "./aircraft";
import type { WingGeometry } from "./solver";

export function wingForAircraft(id: LabAircraftId): WingGeometry {
  const measured = fleet.find((g) => g.id === id);
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
export const fleetMeasurements = fleet;
