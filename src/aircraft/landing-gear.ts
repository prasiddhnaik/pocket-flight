import { finchWheels } from "./finch/landing-gear";
export { finchWheels } from "./finch/landing-gear";
export { f15cWheels } from "./f15c/landing-gear";
export { heronWheels } from "./heron/landing-gear";
export { peregrineWheels } from "./peregrine/landing-gear";
export { aureliaWheels as legacyAureliaWheels } from "./aurelia/landing-gear";
import { aureliaTires, aureliaFlightOffsetY } from "./aurelia/flight-model";
export const aureliaWheels = aureliaTires.map((tire) => ({
  center: new Vector3().fromArray(tire.center).add(new Vector3(0, aureliaFlightOffsetY, 0)),
  major: tire.radius * 0.73, minor: tire.radius * 0.27,
}));
export { stormbirdWheels } from "./stormbird/landing-gear";
import { Quaternion, Vector3 } from "three";
import { groundAt } from "../world/terrain";
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
