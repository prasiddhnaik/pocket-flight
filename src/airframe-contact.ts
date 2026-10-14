import { Quaternion, Vector3 } from "three";
import type { AircraftId } from "./aircraft";
import collisionGeometry from "./airframe-collision.json";
import {
  aureliaWheels,
  finchWheels,
  peregrineWheels,
  stormbirdWheels,
} from "./landing-gear";
import geometry from "./stormbird-geometry.json";
import { gearEase, gearPhase } from "./stormbird-kinematics";
import { aureliaGearFold } from "./aurelia-motion";

export type ContactPart =
  "gear" | "body" | "leftWing" | "rightWing" | "tail" | "engine" | "propeller";
export type ContactProbe = {
  center: Vector3;
  radius: number;
  part: ContactPart;
  terrain?: boolean;
};
export const aircraftWheels = {
  aurelia: aureliaWheels,
  finch: finchWheels,
  peregrine: peregrineWheels,
  stormbird: stormbirdWheels,
};

// Compound collision spheres and skin samples measured offline from the saved
// meshes. Asset hashes and the authoring transforms travel with the data.
export function airframeProbes(id: AircraftId): ContactProbe[] {
  return collisionGeometry.models[id].probes.map((p) => ({
    center: new Vector3().fromArray(p.center),
    radius: p.radius,
    part: p.part as ContactPart,
  }));
}

// Aurelia and Stormbird tire contacts follow their authored retraction paths.
export function wheelPose(id: AircraftId, index: number, extension: number) {
  const wheel = aircraftWheels[id][index];
  const center = wheel.center.clone(),
    axle = new Vector3(1, 0, 0);
  if (id === "stormbird") {
    const authored = geometry.wheels[index];
    const leg = geometry.legs.find((item) => item.name === authored.leg)!;
    center.fromArray(authored.center);
    const phase = gearPhase(extension);
    if (leg.swivel) {
      const turn = leg.swivel;
      const q = new Quaternion().setFromAxisAngle(
        new Vector3().fromArray(turn.axis).normalize(),
        ((turn.angle * Math.PI) / 180) * gearEase(0.3, 0.75, phase),
      );
      const pivot = new Vector3().fromArray(turn.point);
      center.sub(pivot).applyQuaternion(q).add(pivot);
      axle.applyQuaternion(q);
    }
    const q = new Quaternion().setFromAxisAngle(
      new Vector3().fromArray(leg.axis).normalize(),
      ((leg.angle * Math.PI) / 180) * gearEase(leg.start, leg.end, phase),
    );
    const pivot = new Vector3().fromArray(leg.point);
    center.sub(pivot).applyQuaternion(q).add(pivot);
    center.y -= geometry.centerOffsetY;
    axle.applyQuaternion(q);
  } else if (id === "aurelia") {
    const nose = index < 2;
    const pivot = new Vector3(
      center.x,
      (2.35 - 2.3) * 0.55,
      (nose ? -10.65 : 1.1) * 0.55,
    );
    const q = new Quaternion().setFromAxisAngle(
      new Vector3(1, 0, 0),
      aureliaGearFold(extension, nose),
    );
    center.sub(pivot).applyQuaternion(q).add(pivot);
    axle.applyQuaternion(q);
  } else if (id !== "finch") {
    center.y += (1 - extension) * 1.6;
  }
  return { center, axle, radius: wheel.major + wheel.minor };
}

/** Lowest point of the rigid rendered tire in a world-space support direction. */
export function wheelSupportPoint(
  id: AircraftId,
  index: number,
  extension: number,
  position: Vector3,
  rotation: Quaternion,
  normal = new Vector3(0, 1, 0),
) {
  const pose = wheelPose(id, index, extension);
  const center = pose.center.applyQuaternion(rotation).add(position);
  const axle = pose.axle.applyQuaternion(rotation),
    axial = axle.dot(normal);
  const radialDirection = normal.clone().addScaledVector(axle, -axial);
  const radial = radialDirection.length();
  if (radial > 1e-10) radialDirection.divideScalar(radial);
  if (id === "stormbird") {
    // The CAD tire has sidewalls: its full measured profile is needed when
    // banked. A zero-width disk underestimated the support height.
    let best = -Infinity,
      axialOffset = 0,
      radialOffset = 0;
    for (const [a, r] of geometry.wheels[index].profile) {
      const support = a * Math.abs(axial) + r * radial;
      if (support > best) {
        best = support;
        axialOffset = a;
        radialOffset = r;
      }
    }
    return center
      .addScaledVector(radialDirection, -radialOffset)
      .addScaledVector(axle, -Math.sign(axial) * axialOffset);
  }
  const wheel = aircraftWheels[id][index];
  return center
    .addScaledVector(radialDirection, -wheel.major)
    .addScaledVector(normal, -wheel.minor);
}
