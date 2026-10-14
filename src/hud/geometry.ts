import type { AircraftId } from "../aircraft";
import { flightProfiles } from "../flight-profiles";
import { islandEnvelope } from "../flight-envelope";

export const KNOTS_PER_MPS = 1.943844;
// ISA sea level; the island ceiling is 1,800 m so the error is small.
export const KNOTS_PER_MACH = 661.47;
const RAD = Math.PI / 180;

export const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

// SVG angles: 0° points east and positive angles turn clockwise.
export function polar(cx: number, cy: number, r: number, degrees: number): [number, number] {
  return [cx + r * Math.cos(degrees * RAD), cy + r * Math.sin(degrees * RAD)];
}

export function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export type Scale = { min: number; max: number; start: number; sweep: number };

export function valueAngle(s: Scale, value: number) {
  return s.start + clamp01((value - s.min) / (s.max - s.min)) * s.sweep;
}

export function ticks(min: number, max: number, step: number) {
  const count = Math.floor((max - min) / step + 1e-9);
  return Array.from({ length: count + 1 }, (_, i) => Math.round((min + i * step) * 1000) / 1000);
}

// Equivalent heading nearest to `previous`, so a ring rotating through north takes the short way.
export function unwrapHeading(previous: number, heading: number) {
  const delta = ((((heading - previous) % 360) + 540) % 360) - 180;
  return previous + delta;
}

export type Band = { from: number; to: number; tone: "green" | "amber" };
export type AirspeedScale = { max: number; majorStep: number; minorStep: number; bands: Band[]; redline: number };

const airspeedDialMax: Record<AircraftId, number> = { finch: 180, aurelia: 450, peregrine: 500, stormbird: 500 };

export function airspeedScale(id: AircraftId): AirspeedScale {
  const max = airspeedDialMax[id];
  const limitMach = islandEnvelope[id].maximumMach;
  const stall = flightProfiles[id].stallSpeed * KNOTS_PER_MPS;
  // Speed protection reports active from 0.035 Mach below the limit.
  const warn = (limitMach - 0.035) * KNOTS_PER_MACH;
  const redline = limitMach * KNOTS_PER_MACH;
  const small = max <= 200;
  return {
    max,
    majorStep: small ? 40 : 100,
    minorStep: small ? 10 : 25,
    bands: [
      { from: stall, to: warn, tone: "green" },
      { from: warn, to: redline, tone: "amber" },
    ],
    redline,
  };
}

export function activeBand(bands: Band[], value: number) {
  return bands.findIndex((b) => value >= b.from && value <= b.to);
}
