import type { AircraftId } from "../aircraft/aircraft";
import type { FinchVariant } from "../aircraft/finch/attack";

export const aircraftNames: Record<AircraftId, string> = {
  f15c: "F-15C Eagle",
  heron: "Heron",
  finch: "The Finch",
  peregrine: "Peregrine",
  aurelia: "Aurelia",
  stormbird: "Stormbird",
};

/** A menu entry: one of the aircraft, or the Finch's attack variant. */
export type AircraftChoice = AircraftId | "finch-attack";

export function resolveAircraftChoice(choice: AircraftChoice): { id: AircraftId; variant: FinchVariant } {
  return choice === "finch-attack" ? { id: "finch", variant: "attack" } : { id: choice, variant: "trainer" };
}

export function aircraftChoice(id: AircraftId, variant: FinchVariant): AircraftChoice {
  return id === "finch" && variant === "attack" ? "finch-attack" : id;
}

export function parseAircraftChoice(value: string | null): AircraftChoice | null {
  if (value === "finch-attack") return value;
  return value !== null && Object.hasOwn(aircraftNames, value) ? (value as AircraftId) : null;
}

export const choiceName = (choice: AircraftChoice) =>
  choice === "finch-attack" ? "Finch A–2" : aircraftNames[choice];

export function aircraftViewerUrl(id: AircraftChoice, paint = 0) {
  return `/aircraft.html?aircraft=${id}&paint=${paint}`;
}

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
