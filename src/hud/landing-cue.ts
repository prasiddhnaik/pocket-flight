export type LandingCue = { target: number; state: "fast" | "on-speed" | "slow"; text: string };

const ON_SPEED_KNOTS = 5;

export function landingCue({ active, speed, approachKnots: target, speedBrake }: {
  active: boolean;
  speed: number;
  approachKnots: number;
  speedBrake: boolean;
}): LandingCue | null {
  if (!active) return null;
  if (speed > target + ON_SPEED_KNOTS)
    return { target, state: "fast", text: `Slow to ${target} kn${speedBrake ? " · hold B" : ""}` };
  if (speed < target - ON_SPEED_KNOTS)
    return { target, state: "slow", text: `Too slow · add power · ${target} kn` };
  return { target, state: "on-speed", text: `On speed · ${target} kn` };
}
