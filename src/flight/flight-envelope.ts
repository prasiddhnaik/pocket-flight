import { MathUtils } from "three";
import type { AircraftId } from "../aircraft/aircraft";
export const ISLAND_FLIGHT_MODEL = "island-rigid-body-1";

// Release scope, not a claim of certified flight limits. Keep the lab's engine
// reference maps intact; the island game governs thrust and adds a speed brake.
export const islandEnvelope = {
  f15c: { maximumMach: 0.7, maximumAltitude: 1800 },
  heron: { maximumMach: 0.32, maximumAltitude: 1800 },
  aurelia: { maximumMach: 0.6, maximumAltitude: 1800 },
  finch: { maximumMach: 0.25, maximumAltitude: 1800 },
  peregrine: { maximumMach: 0.7, maximumAltitude: 1800 },
  stormbird: { maximumMach: 0.7, maximumAltitude: 1800 },
} satisfies Record<
  AircraftId,
  { maximumMach: number; maximumAltitude: number }
>;

export function islandSpeedProtection(id: AircraftId, mach: number) {
  const limit = islandEnvelope[id].maximumMach;
  return {
    thrustScale: 1 - MathUtils.smoothstep(mach, limit - 0.07, limit),
    // Smooth dissipative force also slows a dive; no velocity teleport.
    dragCoefficient: 8 * Math.max(0, mach - limit) ** 2,
    active: mach > limit - 0.035,
  };
}
