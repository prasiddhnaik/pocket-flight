import { expect, test } from "bun:test";
import { checkAirframe } from "../scripts/fit/airframe";
import { pilotSeats } from "../src/aircraft/pilot";

for (const id of ["finch", "finch-attack", "heron"] as const)
  test(`${id}: the pilot fits the airframe's own seat, canopy and controls`, async () => {
    const report = await checkAirframe(id);
    expect(report.issues).toEqual([]);
    expect(report.verdict).toBe("PASS");
  }, 120_000);

test("a full-size Finch pilot in the old outside position is caught through the canopy", async () => {
  const seat = pilotSeats.finch, saved = { outside: seat.outside, outsideSize: seat.outsideSize };
  try {
    Object.assign(seat, { outside: [0, 0, 0], outsideSize: 1 });
    const report = await checkAirframe("finch");
    expect(report.verdict).toBe("REVIEW");
    expect(report.issues.some((issue) => issue.includes("canopy"))).toBe(true);
  } finally {
    Object.assign(seat, saved);
  }
}, 120_000);
