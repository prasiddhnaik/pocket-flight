import { Vector3 } from "three";
import { rangeLayout, rangeWorld } from "../../world/range-island";
import type { CombatTarget } from "./simulation";

const GROUND_RESPAWN = 25;
const AIR_RESPAWN = 15;

/** The Anvil Key dummies: fixed ground targets and drones flying circuits. */
export function rangeTargets(
  height: (x: number, z: number) => number,
): CombatTarget[] {
  const ground = rangeLayout.targets.map((spec): CombatTarget => {
    const { x, z } = rangeWorld(spec.x, spec.z);
    const base = new Vector3(x, height(x, z), z);
    return {
      id: spec.id,
      kind: "ground",
      model: spec.model,
      base,
      heading: spec.heading,
      position: base.clone().setY(base.y + spec.aim),
      radius: spec.radius,
      health: spec.health,
      maxHealth: spec.health,
      respawn: 0,
      respawnTime: GROUND_RESPAWN,
    };
  });
  const air = rangeLayout.drones.map((spec): CombatTarget => {
    const { x, z } = rangeWorld(spec.x, spec.z);
    return {
      id: spec.id,
      kind: "air",
      model: "drone",
      position: new Vector3(x, spec.altitude, z),
      radius: 7,
      health: 3,
      maxHealth: 3,
      respawn: 0,
      respawnTime: AIR_RESPAWN,
      orbit: {
        x,
        z,
        radius: spec.orbit,
        altitude: spec.altitude,
        speed: spec.speed,
        direction: spec.direction,
        phase: spec.phase,
      },
    };
  });
  return [...ground, ...air];
}
