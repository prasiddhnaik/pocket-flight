import { describe, expect, test } from "bun:test";
import { isNewFlight } from "../src/hud/boot";

describe("HUD new-flight detection", () => {
  test("entering playing from the menu starts a new flight", () => {
    expect(isNewFlight("menu", 0, "playing", 0)).toBe(true);
  });
  test("resuming from pause does not start a new flight", () => {
    expect(isNewFlight("paused", 30, "playing", 30)).toBe(false);
    expect(isNewFlight("paused", 0.2, "playing", 0.2)).toBe(false);
  });
  test("restarting the flight clock while playing starts a new flight", () => {
    expect(isNewFlight("playing", 30, "playing", 0.2)).toBe(true);
  });
  test("restarting from pause is detected by the flight clock", () => {
    expect(isNewFlight("paused", 30, "playing", 0.2)).toBe(true);
  });
  test("an advancing flight clock does not start a new flight", () => {
    expect(isNewFlight("playing", 5, "playing", 5.1)).toBe(false);
    expect(isNewFlight("playing", 0.2, "playing", 0.3)).toBe(false);
  });
  test("non-playing modes never start a new flight", () => {
    for (const mode of ["menu", "paused", "result", "replay"] as const)
      expect(isNewFlight("playing", 30, mode, 0.2)).toBe(false);
  });
});
