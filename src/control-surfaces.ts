import { MathUtils } from "three";
import type { Object3D } from "three";

export type SurfacePose = { roll: number; pitch: number; yaw: number };

export function controlSurfaces(parts: Map<string, Object3D>) {
  const pose: SurfacePose = { roll: 0, pitch: 0, yaw: 0 };
  function apply(next: SurfacePose) {
    pose.roll = MathUtils.clamp(next.roll, -1, 1);
    pose.pitch = MathUtils.clamp(next.pitch, -1, 1);
    pose.yaw = MathUtils.clamp(next.yaw, -1, 1);
    const rotate = (name: string, axis: "x" | "y", degrees: number) => {
      const part = parts.get(name);
      if (part) part.rotation[axis] = MathUtils.degToRad(degrees);
    };
    // Positive roll banks right: left trailing edge down, right edge up.
    rotate("Aileron_Left", "x", pose.roll * 22);
    rotate("Aileron_Right", "x", -pose.roll * 22);
    rotate("Elevator", "x", -pose.pitch * 25);
    rotate("Rudder", "y", pose.yaw * 28);
  }
  return {
    snapshot: (): SurfacePose => ({ ...pose }),
    apply,
    reset: () => apply({ roll: 0, pitch: 0, yaw: 0 }),
    update(input: SurfacePose, dt: number) {
      apply({
        roll: MathUtils.damp(
          pose.roll,
          MathUtils.clamp(input.roll, -1, 1),
          12,
          dt,
        ),
        pitch: MathUtils.damp(
          pose.pitch,
          MathUtils.clamp(input.pitch, -1, 1),
          12,
          dt,
        ),
        yaw: MathUtils.damp(
          pose.yaw,
          MathUtils.clamp(input.yaw, -1, 1),
          12,
          dt,
        ),
      });
    },
  };
}
