import { MathUtils } from "three";
import type { SurfacePose } from "../aircraft/finch/control-surfaces";

type Frame = { surfaces: SurfacePose; flapPosition?: number; jet?: { flaps: number } };
type Aircraft = { surfaces: { apply(pose: SurfacePose): void }; setConfiguration(flaps: number): void };
export function applyReplaySurfaces(aircraft: Aircraft, a: Frame, b: Frame, mix: number) {
  aircraft.surfaces.apply({
    roll: MathUtils.lerp(a.surfaces.roll, b.surfaces.roll, mix),
    pitch: MathUtils.lerp(a.surfaces.pitch, b.surfaces.pitch, mix),
    yaw: MathUtils.lerp(a.surfaces.yaw, b.surfaces.yaw, mix),
  });
  // Configuration is last: surface wrappers retain flap state and otherwise
  // overwrite the interpolated mechanism pose with a previous replay frame.
  aircraft.setConfiguration(MathUtils.lerp(a.flapPosition ?? a.jet?.flaps ?? 0, b.flapPosition ?? b.jet?.flaps ?? 0, mix));
}
