import { Quaternion, Vector3 } from "three";
import { groundAt } from "./terrain";

// Finch GLB axle positions and tire torus dimensions, in aircraft coordinates.
const wheels = [
  { center: new Vector3(-1.22, -1.09, 0.55), major: 0.212, minor: 0.065 },
  { center: new Vector3(1.22, -1.09, 0.55), major: 0.212, minor: 0.065 },
  { center: new Vector3(0, -1.12, -2.12), major: 0.177, minor: 0.055 },
];
const axle = new Vector3(),
  offset = new Vector3(),
  orientation = new Quaternion();
const bendAxis = new Vector3(0, 0, 1),
  bend = new Quaternion();

export function gearContactHeight(
  position: Vector3,
  rotation: Quaternion,
  damage = 0,
) {
  orientation
    .copy(rotation)
    .multiply(bend.setFromAxisAngle(bendAxis, damage * 0.35));
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
