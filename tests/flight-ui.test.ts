import { describe, expect, test } from "bun:test";
import { climbReadout, formatClock, headingReadout } from "../src/app/flight-ui";

describe("flight deck units", () => {
  test("heading wraps through north, including rounding and negative values", () => {
    expect(headingReadout(359.6)).toEqual({ degrees: "000", cardinal: "N" });
    expect(headingReadout(-90)).toEqual({ degrees: "270", cardinal: "W" });
    expect(headingReadout(405)).toEqual({ degrees: "045", cardinal: "NE" });
  });
  test("climb rate converts m/s to ft/min and distinguishes descent from level", () => {
    expect(climbReadout(5)).toBe("+1,000");
    expect(climbReadout(-2)).toBe("−400");
    expect(climbReadout(0.1)).toBe("LEVEL");
  });
  test("clock formats minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(252.9)).toBe("04:12");
    expect(formatClock(-1)).toBe("00:00");
    expect(formatClock(3600)).toBe("60:00");
  });
});
