import { MathUtils } from "three";
import type { JetMotion } from "../aircraft/jet-effects";

type Snapshot = Partial<Omit<JetMotion, "update">>;
export function applyJetReplay(motion: JetMotion, a: Snapshot, b: Snapshot = a, mix = 0) {
  // Old saves predate the rotor rig. Seeking them must not retain a live burst.
  motion.gunAngle = motion.gunSpeed = 0;
  const keys = new Set([...Object.keys(a), ...Object.keys(b)] as (keyof Snapshot)[]);
  for (const key of keys) motion[key] = MathUtils.lerp(a[key] ?? 0, b[key] ?? 0, mix);
}
