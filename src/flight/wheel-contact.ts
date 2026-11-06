import { Matrix3, Quaternion, Vector3 } from "three";
import type { AircraftId } from "../aircraft/aircraft";
import {
  aircraftWheels,
  wheelPose,
  wheelSupportPoint,
} from "./airframe-contact";
import { groundAt, groundHeight, maximumGroundHeight } from "../world/terrain";

export type ContactBody = {
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
  angularVelocity: Vector3;
  mass: number;
  cg: Vector3;
  inverseInertia: Matrix3;
};
export function pointVelocity(body: ContactBody, point: Vector3) {
  const r = point.clone().sub(body.cg);
  return body.angularVelocity
    .clone()
    .cross(r)
    .applyQuaternion(body.quaternion)
    .add(body.velocity);
}
export function applyContactImpulse(
  body: ContactBody,
  point: Vector3,
  impulse: Vector3,
) {
  body.velocity.addScaledVector(impulse, 1 / body.mass);
  const local = impulse
    .clone()
    .applyQuaternion(body.quaternion.clone().invert());
  body.angularVelocity.add(
    point.clone().sub(body.cg).cross(local).applyMatrix3(body.inverseInertia),
  );
}
export function inverseContactMass(
  body: ContactBody,
  point: Vector3,
  direction: Vector3,
) {
  const local = direction
    .clone()
    .applyQuaternion(body.quaternion.clone().invert());
  const r = point.clone().sub(body.cg);
  return (
    1 / body.mass +
    r.clone().cross(local).applyMatrix3(body.inverseInertia).cross(r).dot(local)
  );
}
export function terrainNormal(x: number, z: number) {
  const h = 0.35;
  return new Vector3(
    groundHeight(x - h, z) - groundHeight(x + h, z),
    2 * h,
    groundHeight(x, z - h) - groundHeight(x, z + h),
  ).normalize();
}

// Farthest any tire surface reaches from the body origin across gear travel.
const wheelReach = new Map<AircraftId, number>();
function reachOf(id: AircraftId) {
  let reach = wheelReach.get(id);
  if (reach === undefined) {
    reach = 0;
    for (let index = 0; index < aircraftWheels[id].length; index++)
      for (let step = 0; step <= 20; step++) {
        const pose = wheelPose(id, index, step / 20);
        reach = Math.max(reach, pose.center.length() + pose.radius);
      }
    // Margin covers sampling between gear steps and wide tire profiles.
    reach += 1;
    wheelReach.set(id, reach);
  }
  return reach;
}
/** True when no tire can touch terrain or pavement during this step. */
export function wheelsClearOfGround(body: ContactBody, id: AircraftId, dt: number) {
  const reach = reachOf(id);
  const travel =
    (body.velocity.length() + body.angularVelocity.length() * reach) * dt + 0.1;
  const p = body.position;
  return (
    p.y - reach - travel >
    maximumGroundHeight(p.x - reach, p.x + reach, p.z - reach, p.z + reach)
  );
}
export type WheelContact = {
  index: number;
  point: Vector3;
  normal: Vector3;
  compression: number;
  closingSpeed: number;
  load: number;
  locked: boolean;
  runway?: string;
  water: boolean;
};

export function solveWheelContacts(
  body: ContactBody,
  id: AircraftId,
  gear: number,
  steering: number,
  brake: boolean,
  damage: number,
  dt: number,
): WheelContact[] {
  const wheels = aircraftWheels[id];
  const contacts = [];
  if (wheelsClearOfGround(body, id, dt)) return [];
  for (let index = 0; index < wheels.length; index++) {
    const pose = wheelPose(id, index, gear);
    const center = pose.center
      .clone()
      .applyQuaternion(body.quaternion)
      .add(body.position);
    const normal = terrainNormal(center.x, center.z);
    const world = wheelSupportPoint(
      id,
      index,
      gear,
      body.position,
      body.quaternion,
      normal,
    );
    const surface = groundAt(world.x, world.z);
    const gap = world.y - surface.height;
    // Speculative contact limits downward motion before the next pose crosses
    // the surface. Position recovery is separate from kinetic impulses.
    if (
      gap >
      Math.max(0.06, pointVelocity(body, pose.center).length() * dt + 0.02)
    )
      continue;
    const point = world
      .clone()
      .sub(body.position)
      .applyQuaternion(body.quaternion.clone().invert());
    const normalSpeed = pointVelocity(body, point).dot(normal);
    if (gap > 0.025 && gap + normalSpeed * dt > 0.025) continue;
    const nose = pose.center.z < -1;
    const forward = new Vector3(
      nose ? -Math.sin(steering * 0.4) : 0,
      0,
      nose ? -Math.cos(steering * 0.4) : -1,
    ).applyQuaternion(body.quaternion);
    forward.addScaledVector(normal, -forward.dot(normal)).normalize();
    const lateral = new Vector3().crossVectors(forward, normal).normalize();
    contacts.push({
      index,
      point,
      normal,
      compression: Math.max(0, -gap),
      closingSpeed: Math.max(0, -normalSpeed),
      load: 0,
      locked: id === "finch" || gear > 0.995,
      runway: surface.runway?.name,
      water: surface.water,
      forward,
      lateral,
      normalImpulse: 0,
      forwardImpulse: 0,
      lateralImpulse: 0,
      // Tire exclusion is rigid; overlap recovery never injects kinetic energy.
      bias: Math.max(0, gap) / dt,
      traction: (surface.runway ? 0.8 : 0.55) * (1 - damage * 0.55),
      rolling: brake && !nose ? 1 : surface.runway ? 0.016 : 0.08,
    });
  }
  for (let iteration = 0; iteration < 10; iteration++) {
    for (const c of contacts) {
      const speed = pointVelocity(body, c.point).dot(c.normal);
      const next = Math.max(
        0,
        c.normalImpulse -
          (speed + c.bias) / inverseContactMass(body, c.point, c.normal),
      );
      applyContactImpulse(
        body,
        c.point,
        c.normal.clone().multiplyScalar(next - c.normalImpulse),
      );
      c.normalImpulse = next;
      for (const axis of ["forward", "lateral"] as const) {
        const key = axis === "forward" ? "forwardImpulse" : "lateralImpulse";
        const limit =
          c.normalImpulse * (axis === "forward" ? c.rolling : c.traction);
        const change =
          -pointVelocity(body, c.point).dot(c[axis]) /
          inverseContactMass(body, c.point, c[axis]);
        const impulse = Math.max(-limit, Math.min(limit, c[key] + change));
        applyContactImpulse(
          body,
          c.point,
          c[axis].clone().multiplyScalar(impulse - c[key]),
        );
        c[key] = impulse;
      }
      const ellipse = Math.hypot(
        c.forwardImpulse / Math.max(1e-9, c.normalImpulse * c.rolling),
        c.lateralImpulse / Math.max(1e-9, c.normalImpulse * c.traction),
      );
      if (ellipse > 1) {
        const forward = c.forwardImpulse / ellipse,
          lateral = c.lateralImpulse / ellipse;
        applyContactImpulse(
          body,
          c.point,
          c.forward
            .clone()
            .multiplyScalar(forward - c.forwardImpulse)
            .addScaledVector(c.lateral, lateral - c.lateralImpulse),
        );
        c.forwardImpulse = forward;
        c.lateralImpulse = lateral;
      }
    }
  }
  return contacts.map((c) => ({
    index: c.index,
    point: c.point,
    normal: c.normal,
    compression: c.compression,
    closingSpeed: c.closingSpeed,
    load: c.normalImpulse / dt,
    locked: c.locked,
    runway: c.runway,
    water: c.water,
  }));
}

/** Split position correction: remove overlap without adding bounce velocity. */
export function resolveWheelPenetration(
  position: Vector3,
  rotation: Quaternion,
  id: AircraftId,
  gear: number,
) {
  if (id !== "finch" && gear < 0.995) return 0;
  const reach = reachOf(id);
  if (
    position.y - reach >
    maximumGroundHeight(
      position.x - reach,
      position.x + reach,
      position.z - reach,
      position.z + reach,
    )
  )
    return 0;
  let depth = 0;
  for (let index = 0; index < aircraftWheels[id].length; index++) {
    const pose = wheelPose(id, index, gear);
    const center = pose.center.applyQuaternion(rotation).add(position);
    const point = wheelSupportPoint(
      id,
      index,
      gear,
      position,
      rotation,
      terrainNormal(center.x, center.z),
    );
    depth = Math.max(depth, groundAt(point.x, point.z).height - point.y);
  }
  // Tire-ground exclusion is a positional constraint, not spring compression.
  // Correct the minimum required height while preserving attitude and all rates.
  if (depth > 0) position.y += depth + 1e-6;
  return depth;
}
