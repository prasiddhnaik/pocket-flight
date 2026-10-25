import { MathUtils } from "three";
import {
  jetAltitudeAxis,
  jetDryNewtons,
  jetMachAxis,
  jetMaximumNewtons,
  pistonAltitudeFeet,
  pistonPowerPercent,
} from "./flight-reference-data";

export function interpolate(
  axis: readonly number[],
  values: readonly number[],
  value: number,
) {
  const x = MathUtils.clamp(value, axis[0], axis.at(-1)!);
  const i = Math.max(0, axis.findIndex((n) => n >= x) - 1);
  return MathUtils.lerp(
    values[i],
    values[i + 1],
    (x - axis[i]) / (axis[i + 1] - axis[i]),
  );
}
export function referenceJetThrust(
  mach: number,
  altitude: number,
  maximum = false,
) {
  const deck = maximum ? jetMaximumNewtons : jetDryNewtons;
  return interpolate(
    jetMachAxis,
    deck.map((row) => interpolate(jetAltitudeAxis, row, altitude)),
    mach,
  );
}
export function pistonPowerFactor(altitude: number) {
  return (
    interpolate(pistonAltitudeFeet, pistonPowerPercent, altitude / 0.3048) / 100
  );
}
// Equivalent ISA density altitude. Off-standard temperature/pressure are not modeled.
export function densityAltitude(density: number) {
  return (
    (288.15 / 0.0065) * (1 - (Math.max(density, 0.01) / 1.225) ** (1 / 4.25588))
  );
}
export function localSoundSpeed(altitude: number) {
  return Math.sqrt(
    1.4 * 287.05 * (288.15 - 0.0065 * MathUtils.clamp(altitude, 0, 11000)),
  );
}
