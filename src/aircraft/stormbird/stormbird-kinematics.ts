import { MathUtils } from "three";

export const STORMBIRD_GEAR_SECONDS = 4.8;
export const STORMBIRD_OLEO_TRAVEL = 0.16;
export const gearPhase = (extension: number) =>
  1 - MathUtils.clamp(extension, 0, 1);
export const gearEase = (start: number, end: number, phase: number) =>
  MathUtils.smoothstep(phase, start, end);
export const oleoTravel = (compression: number, extension: number) =>
  MathUtils.clamp(compression, 0, STORMBIRD_OLEO_TRAVEL) *
  (1 - gearEase(0, 0.15, gearPhase(extension)));
