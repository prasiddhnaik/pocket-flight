import { Matrix3, Quaternion, Vector3 } from "three";

// Body tensor and rates use the same right/up/aft frame as the mesh.
// I·omegaDot = moment - omega×(I·omega). Midpoint integration retains coupling.
export function integrateRotation(
  orientation: Quaternion,
  rate: Vector3,
  moment: Vector3,
  inertia: Matrix3,
  inverseInertia: Matrix3,
  dt: number,
) {
  const midpoint = integrateAngularVelocity(
    rate,
    moment,
    inertia,
    inverseInertia,
    dt,
  );
  advanceOrientation(orientation, midpoint, dt);
}

export function integrateAngularVelocity(
  rate: Vector3,
  moment: Vector3,
  inertia: Matrix3,
  inverseInertia: Matrix3,
  dt: number,
) {
  const acceleration = (w: Vector3) =>
    moment
      .clone()
      .sub(w.clone().cross(w.clone().applyMatrix3(inertia)))
      .applyMatrix3(inverseInertia);
  const midpoint = rate.clone().addScaledVector(acceleration(rate), dt / 2);
  rate.addScaledVector(acceleration(midpoint), dt);
  return midpoint;
}

export function advanceOrientation(
  orientation: Quaternion,
  rate: Vector3,
  dt: number,
) {
  const midpoint = rate.clone();
  const angle = midpoint.length() * dt;
  if (angle > 1e-12)
    orientation
      .multiply(new Quaternion().setFromAxisAngle(midpoint.normalize(), angle))
      .normalize();
}
