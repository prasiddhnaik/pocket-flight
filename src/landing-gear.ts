import { Quaternion, Vector3 } from "three";
import { groundAt } from "./terrain";
import stormbirdGeometry from "./stormbird-geometry.json";

// Finch GLB axle positions and tire torus dimensions, in aircraft coordinates.
export const finchWheels = [
  { center: new Vector3(-1.22, -1.09, 0.55), major: 0.212, minor: 0.065 },
  { center: new Vector3(1.22, -1.09, 0.55), major: 0.212, minor: 0.065 },
  { center: new Vector3(0, -1.12, -2.12), major: 0.177, minor: 0.055 },
];
const axle = new Vector3(),
  offset = new Vector3(),
  orientation = new Quaternion();

export function gearContactHeight(
  position: Vector3,
  rotation: Quaternion,
  wheels = finchWheels,
) {
  // Damage changes performance, not the position of fixed gear attachments.
  orientation.copy(rotation);
  axle.set(1, 0, 0).applyQuaternion(orientation);
  const radialHeight = Math.sqrt(Math.max(0, 1 - axle.y * axle.y));
  let height = -Infinity;
  for (const wheel of wheels) {
    offset.copy(wheel.center).applyQuaternion(orientation);
    const surface = groundAt(
      position.x + offset.x,
      position.z + offset.z,
    ).height;
    height = Math.max(
      height,
      surface - offset.y + wheel.major * radialHeight + wheel.minor,
    );
  }
  return height;
}

// Same scale and centre offset as the flight GLB; six individual tire contacts.
export const peregrineWheels = [
  ...[-0.24, 0.24].map((x) => ({
    center: new Vector3(x * 0.7, (0.42 - 2.3) * 0.7, -7.05 * 0.7),
    major: 0.42 * 0.73 * 0.7,
    minor: 0.42 * 0.27 * 0.7,
  })),
  ...[-2.39, -1.71, 1.71, 2.39].map((x) => ({
    center: new Vector3(x * 0.7, (0.62 - 2.3) * 0.7, 2.45 * 0.7),
    major: 0.62 * 0.73 * 0.7,
    minor: 0.62 * 0.27 * 0.7,
  })),
];

export const aureliaWheels = [
  ...[-0.2, 0.2].map((x) => ({
    center: new Vector3(x * 0.55, (0.37 - 2.3) * 0.55, -10.65 * 0.55),
    major: 0.37 * 0.73 * 0.55,
    minor: 0.37 * 0.27 * 0.55,
  })),
  ...[-2.42, -1.88, 1.88, 2.42].map((x) => ({
    center: new Vector3(x * 0.55, (0.51 - 2.3) * 0.55, 1.1 * 0.55),
    major: 0.51 * 0.73 * 0.55,
    minor: 0.51 * 0.27 * 0.55,
  })),
];

// CAD ground datum is Y=0; the flight model is centered two metres above it.
export const stormbirdWheels = [
  ...stormbirdGeometry.wheels.map((wheel) => ({
    center: new Vector3()
      .fromArray(wheel.center)
      .add(new Vector3(0, -stormbirdGeometry.centerOffsetY, 0)),
    major: wheel.radius,
    minor: 0,
  })),
];
