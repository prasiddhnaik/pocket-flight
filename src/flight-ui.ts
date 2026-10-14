import type { AircraftId } from "./aircraft";

export const aircraftNames: Record<AircraftId, string> = {
  finch: "The Finch",
  peregrine: "Peregrine",
  aurelia: "Aurelia",
  stormbird: "Stormbird",
};

export function headingReadout(degrees: number) {
  const heading = ((Math.round(degrees) % 360) + 360) % 360;
  const cardinal = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][
    Math.round(heading / 45) % 8
  ];
  return { degrees: String(heading).padStart(3, "0"), cardinal };
}

// Physics supplies metres per second; the flight deck displays feet per minute.
export function climbReadout(metresPerSecond: number) {
  const feetPerMinute = Math.round((metresPerSecond * 196.8504) / 50) * 50;
  return feetPerMinute === 0
    ? "LEVEL"
    : `${feetPerMinute > 0 ? "+" : "−"}${Math.abs(feetPerMinute).toLocaleString("en-US")}`;
}

export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
