import { Matrix3, Quaternion, Vector3 } from "three";
import type { AircraftId } from "./aircraft";
import { aircraftWheels, wheelPose } from "./airframe-contact";
import { groundAt } from "./terrain";

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
    groundAt(x - h, z).height - groundAt(x + h, z).height,
    2 * h,
    groundAt(x, z - h).height - groundAt(x, z + h).height,
  ).normalize();
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
  const spring =
    ((body.mass * 9.80665) / (wheels.length * 0.018)) * (1 - damage * 0.65);
  const damping = 1.7 * Math.sqrt((spring * body.mass) / wheels.length);
  const softness = 1 / (dt * (damping + dt * spring));
  for (let index = 0; index < wheels.length; index++) {
    const pose = wheelPose(id, index, gear);
    const axle = pose.axle.applyQuaternion(body.quaternion);
    const wheel = wheels[index];
    const radius =
      wheel.major * Math.sqrt(Math.max(0, 1 - axle.y ** 2)) + wheel.minor;
    const world = pose.center
      .clone()
      .applyQuaternion(body.quaternion)
      .add(body.position);
    world.y -= radius;
    const surface = groundAt(world.x, world.z);
    const gap = world.y - surface.height;
    // Cheap rejection before slope samples; speculative contacts stop a wheel
    // crossing the ground during this tick, without requiring a height clamp.
    if (
      gap >
      Math.max(0.06, pointVelocity(body, pose.center).length() * dt + 0.02)
    )
      continue;
    const normal = terrainNormal(world.x, world.z);
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
      bias: gap < 0 ? (gap * spring) / (damping + dt * spring) : gap / dt,
      traction: (surface.runway ? 0.8 : 0.55) * (1 - damage * 0.55),
      rolling: brake && !nose ? 0.65 : surface.runway ? 0.016 : 0.08,
    });
  }
  for (let iteration = 0; iteration < 10; iteration++) {
    for (const c of contacts) {
      const speed = pointVelocity(body, c.point).dot(c.normal);
      const next = Math.max(
        0,
        c.normalImpulse -
          (speed + c.bias + softness * c.normalImpulse) /
            (inverseContactMass(body, c.point, c.normal) + softness),
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
