import type { Snapshot } from "../game";

export const warningOrder = [
  "pullUp", "stall", "overspeed", "landingGear", "bankAngle", "bingoFuel", "damage", "fuelLow",
] as const;
export type WarningId = (typeof warningOrder)[number];

export const warningText: Record<WarningId, string> = {
  pullUp: "PULL UP", stall: "STALL", overspeed: "OVERSPEED", landingGear: "LANDING GEAR",
  bankAngle: "BANK ANGLE", bingoFuel: "BINGO FUEL", damage: "DAMAGE", fuelLow: "FUEL LOW",
};

export const ONE_SHOT_BANNER_SECONDS = 4;
const FEET_PER_METRE = 3.28084;
const ONE_SHOT: WarningId[] = ["bingoFuel", "damage", "fuelLow"];

export type WarningInput = Pick<
  Snapshot,
  "mode" | "grounded" | "stall" | "speedProtection" | "agl" | "verticalSpeed" | "roll" | "gearPosition" | "speed" | "health"
> & { fuelFraction: number; jet: boolean; approachKnots: number };

export type WarningLatch = {
  fuelLowArmed: boolean;
  bingoArmed: boolean;
  damageHealth: number;
  firedAt: Partial<Record<WarningId, number>>;
};

export const freshLatch = (): WarningLatch => ({ fuelLowArmed: true, bingoArmed: true, damageHealth: 100, firedAt: {} });

export function secondsToImpact(aglFeet: number, verticalSpeed: number) {
  return verticalSpeed < -0.5 ? aglFeet / FEET_PER_METRE / -verticalSpeed : Infinity;
}

export function evaluateWarnings(s: WarningInput, latch: WarningLatch, now: number) {
  const next: WarningLatch = { ...latch, firedAt: { ...latch.firedAt } };
  if (s.mode !== "playing") return { active: [] as WarningId[], latch: next };
  const airborne = !s.grounded;
  const on = new Set<WarningId>();
  if (airborne && s.agl < 500 && secondsToImpact(s.agl, s.verticalSpeed) < 6) on.add("pullUp");
  if (s.stall) on.add("stall");
  if (s.speedProtection) on.add("overspeed");
  if (s.jet && airborne && s.gearPosition < 0.5 && s.agl < 500 && s.verticalSpeed < 0 && s.speed < s.approachKnots * 1.2)
    on.add("landingGear");
  if (airborne && Math.abs(s.roll) > Math.PI / 3) on.add("bankAngle");

  // One-shot warnings fire on crossing a threshold and re-arm only past a hysteresis margin.
  if (s.fuelFraction <= 0.1) {
    if (next.bingoArmed) (next.bingoArmed = false), (next.firedAt.bingoFuel = now);
  } else if (s.fuelFraction > 0.12) next.bingoArmed = true;
  if (s.fuelFraction <= 0.2 && s.fuelFraction > 0.1) {
    if (next.fuelLowArmed) (next.fuelLowArmed = false), (next.firedAt.fuelLow = now);
  } else if (s.fuelFraction > 0.22) next.fuelLowArmed = true;
  if (s.health >= 97) next.damageHealth = 100;
  else if (s.health < 70 && s.health <= next.damageHealth - 5) (next.damageHealth = s.health), (next.firedAt.damage = now);

  for (const id of ONE_SHOT) {
    const at = next.firedAt[id];
    // `now >= at` ignores stamps from a previous flight whose clock has since restarted.
    if (at !== undefined && now >= at && now - at < ONE_SHOT_BANNER_SECONDS) on.add(id);
  }
  return { active: warningOrder.filter((id) => on.has(id)), latch: next };
}
