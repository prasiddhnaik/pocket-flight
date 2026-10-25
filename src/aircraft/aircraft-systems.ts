import { finchSystems } from "./finch/systems";
import { peregrineSystems } from "./peregrine/systems";
import { aureliaSystems } from "./aurelia/systems";
import { stormbirdSystems } from "./stormbird/systems";
import type { AircraftId } from "./aircraft";
import { f15cSystems } from "./f15c/systems";
import { heronSystems } from "./heron/systems";

// Aircraft-specific concept allowances. These are not manufacturer equipment
// specifications, and electrical/hydraulic power draw is not simulated yet.
export const aircraftSystems = {
  f15c: f15cSystems,
  heron: heronSystems,
  finch: finchSystems,
  peregrine: peregrineSystems,
  aurelia: aureliaSystems,
  stormbird: stormbirdSystems,
} satisfies Record<
  AircraftId,
  {
    model: string;
    architecture: string;
    busVolts: number;
    batteryVolts: number;
    batteryCount: number;
    batteryAh: number;
    generatorCount: number;
    generatorWatts: number;
    essentialWatts: number;
    peakWatts: number;
    avionicsModules: number;
    hydraulicCircuits: number;
    accumulatorCount: number;
    pressureMPa: number;
    pumpLitresPerMinute: number;
    pumpEfficiency: number;
    fuelPumpsPerWing: number;
  }
>;

/** Required shaft power of one primary hydraulic pump: pressure × flow / efficiency. */
export function hydraulicPumpWatts(id: AircraftId) {
  const s = aircraftSystems[id];
  return (
    (s.pressureMPa * 1e6 * (s.pumpLitresPerMinute / 60000)) / s.pumpEfficiency
  );
}
