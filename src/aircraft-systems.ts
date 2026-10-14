import type { AircraftId } from "./aircraft";

// Aircraft-specific concept allowances. These are not manufacturer equipment
// specifications, and electrical/hydraulic power draw is not simulated yet.
export const aircraftSystems = {
  finch: {
    model: "U2-E1",
    architecture:
      "Piston trainer: compact battery, alternator and manual flight controls",
    busVolts: 14,
    batteryVolts: 12,
    batteryCount: 1,
    batteryAh: 24,
    generatorCount: 1,
    generatorWatts: 840,
    essentialWatts: 390,
    peakWatts: 790,
    avionicsModules: 1,
    hydraulicCircuits: 0,
    accumulatorCount: 0,
    pressureMPa: 0,
    pumpLitresPerMinute: 0,
    pumpEfficiency: 0.8,
    fuelPumpsPerWing: 0,
  },
  peregrine: {
    model: "HX27-EH2",
    architecture:
      "Combat jet: paired avionics processors and independent hydraulic channels",
    busVolts: 28,
    batteryVolts: 24,
    batteryCount: 1,
    batteryAh: 28,
    generatorCount: 2,
    generatorWatts: 12000,
    essentialWatts: 3200,
    peakWatts: 18500,
    avionicsModules: 2,
    hydraulicCircuits: 2,
    accumulatorCount: 2,
    pressureMPa: 20.7,
    pumpLitresPerMinute: 22,
    pumpEfficiency: 0.8,
    fuelPumpsPerWing: 2,
  },
  aurelia: {
    model: "S32-EH1",
    architecture:
      "Civil jet: split starter batteries, flat avionics modules and hydraulic standby unit",
    busVolts: 28,
    batteryVolts: 24,
    batteryCount: 2,
    batteryAh: 22,
    generatorCount: 2,
    generatorWatts: 5000,
    essentialWatts: 1400,
    peakWatts: 7400,
    avionicsModules: 3,
    hydraulicCircuits: 1,
    accumulatorCount: 1,
    pressureMPa: 20.7,
    pumpLitresPerMinute: 7.5,
    pumpEfficiency: 0.8,
    fuelPumpsPerWing: 1,
  },
  stormbird: {
    model: "HX40-EH4",
    architecture:
      "Heavy combat jet: modular processor rack and twin high-flow hydraulic channels",
    busVolts: 28,
    batteryVolts: 24,
    batteryCount: 1,
    batteryAh: 40,
    generatorCount: 2,
    generatorWatts: 20000,
    essentialWatts: 5200,
    peakWatts: 28500,
    avionicsModules: 4,
    hydraulicCircuits: 2,
    accumulatorCount: 4,
    pressureMPa: 34.5,
    pumpLitresPerMinute: 18,
    pumpEfficiency: 0.8,
    fuelPumpsPerWing: 3,
  },
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
