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

// Retracting Stormbird tires follow the same authored fold/swivel transforms
// as its visual rig. The other jets use their extended measured tire datums.
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
  } else if (id !== "finch") {
    center.y += (1 - extension) * 1.6;
  }
  return { center, axle, radius: wheel.major + wheel.minor };
}
