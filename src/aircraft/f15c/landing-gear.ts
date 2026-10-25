import { MathUtils, Quaternion, Vector3 } from "three";

// CAD axle datums transformed [x,z−2.38,−y]. Outer tire radii are 0.38/0.27m;
// major+minor retains the shared finite-width tire-support API.
export const f15cWheels = [
  { center: new Vector3(-1, -2, 1.75), major: 0.27, minor: 0.11 },
  { center: new Vector3(1, -2, 1.75), major: 0.27, minor: 0.11 },
  { center: new Vector3(0, -2.11, -4.85), major: 0.19, minor: 0.08 },
];
export const f15cTires = [
  { radius: 0.38, halfWidth: 0.11 },
  { radius: 0.38, halfWidth: 0.11 },
  { radius: 0.27, halfWidth: 0.08 },
];
const sweep = MathUtils.degToRad(22);
export const f15cGear = [
  {
    name: "Gear_Left",
    pivot: [-0.6, -0.31, 1.94],
    axis: [Math.cos(sweep), 0, Math.sin(sweep)],
    travel: 90,
  },
  {
    name: "Gear_Right",
    pivot: [0.6, -0.31, 1.94],
    axis: [Math.cos(sweep), 0, -Math.sin(sweep)],
    travel: 90,
  },
  { name: "Gear_Nose", pivot: [0, -0.47, -5], axis: [1, 0, 0], travel: 100 },
];
export function f15cGearState(extension: number) {
  const retract = 1 - MathUtils.clamp(extension, 0, 1);
  const opening =
    MathUtils.smoothstep(retract, 0, 0.14) *
    (1 - MathUtils.smoothstep(retract, 0.84, 1));
  return {
    leg: MathUtils.smoothstep(retract, 0.16, 0.82),
    forwardDoor: opening,
    aftDoor: Math.max(1 - MathUtils.smoothstep(retract, 0.82, 1), opening),
  };
}
export function f15cWheelPose(index: number, extension: number) {
  const wheel = f15cWheels[index],
    datum = f15cGear[index];
  const pivot = new Vector3().fromArray(datum.pivot);
  const q = new Quaternion().setFromAxisAngle(
    new Vector3().fromArray(datum.axis),
    MathUtils.degToRad(datum.travel) * f15cGearState(extension).leg,
  );
  return {
    center: wheel.center.clone().sub(pivot).applyQuaternion(q).add(pivot),
    axle: new Vector3(1, 0, 0).applyQuaternion(q),
    radius: wheel.major + wheel.minor,
  };
}
