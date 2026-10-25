import type { Snapshot } from "../flight/game";

export function isNewFlight(previousMode: Snapshot["mode"], previousTime: number, mode: Snapshot["mode"], time: number) {
  return mode === "playing" && (
    (previousMode !== "playing" && previousMode !== "paused") ||
    (previousTime > 1 && time < 1)
  );
}
