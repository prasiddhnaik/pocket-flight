import { MathUtils, Quaternion, Vector3 } from "three";
import { finchAspectRatio, finchDesign, finchMass } from "./finch-design";

export const GRAVITY = 9.80665;
export const SEA_LEVEL_DENSITY = 1.225;

export function airDensity(altitude: number) {
  // Dry ISA troposphere; game's ceiling is 1,800 m. Temperature/weather not modeled.
  const temperatureRatio =
    1 - (0.0065 * MathUtils.clamp(altitude, 0, 11_000)) / 288.15;
  return SEA_LEVEL_DENSITY * temperatureRatio ** 4.25588;
}

export function bodyAirflow(
  velocity: Vector3,
  wind: Vector3,
  orientation: Quaternion,
) {
  const air = velocity.clone().sub(wind);
  const body = air.clone().applyQuaternion(orientation.clone().invert());
  const speed = air.length();
  return {
    air,
    body,
    speed,
    // +X right, +Y up, -Z forward. Positive alpha means nose above airflow.
    alpha: speed > 0.01 ? Math.atan2(-body.y, -body.z) : 0,
    beta: speed > 0.01 ? Math.asin(MathUtils.clamp(body.x / speed, -1, 1)) : 0,
    direction:
      speed > 0.01
        ? air.clone().divideScalar(speed)
        : new Vector3(0, 0, -1).applyQuaternion(orientation),
  };
}

export function finchCoefficients(alpha: number, beta = 0) {
  const a = finchDesign.aerodynamics;
  const positiveStall = (a.clMax - a.cl0) / a.liftSlope;
  const negativeStall = (a.clMin - a.cl0) / a.liftSlope;
  const attachedAlpha = MathUtils.clamp(alpha, negativeStall, positiveStall);
  const beyondStall = Math.abs(alpha - attachedAlpha);
  const separation = 1 - Math.exp(-8 * beyondStall);
  // Continuous blend to a flat-plate estimate at large angles; no polar is claimed.
  const attachedCL = a.cl0 + a.liftSlope * attachedAlpha;
  const cl =
    MathUtils.lerp(attachedCL, 1.1 * Math.sin(2 * alpha), separation) *
    Math.cos(beta) ** 2;
  const cd =
    a.cd0 +
    cl ** 2 / (Math.PI * finchAspectRatio * a.efficiency) +
    separation * 1.8 * Math.sin(alpha) ** 2 +
    a.sideslipDrag * Math.sin(beta) ** 2;
  return { cl, cd, stalled: beyondStall > 0, positiveStall, negativeStall };
}

export function finchStallSpeed(
  mass = finchMass,
  density = SEA_LEVEL_DENSITY,
  loadFactor = 1,
) {
  return Math.sqrt(
    (2 * mass * GRAVITY * Math.abs(loadFactor)) /
      (density *
        finchDesign.geometry.wingArea *
        finchDesign.aerodynamics.clMax),
  );
}

export function finchThrust(speed: number, throttle: number, density: number) {
  const p = finchDesign.propulsion;
  const command = MathUtils.clamp(throttle, 0, 1);
  const densityRatio = density / SEA_LEVEL_DENSITY;
  const power = command * p.shaftPower * densityRatio;
  return Math.min(
    p.staticThrust * command * densityRatio,
    (power * p.efficiency) / Math.max(speed, 1),
  );
}

export function finchAerodynamics(
  velocity: Vector3,
  wind: Vector3,
  orientation: Quaternion,
  altitude: number,
  wingDamage = 0,
) {
  const flow = bodyAirflow(velocity, wind, orientation);
  const density = airDensity(altitude);
  const coefficients = finchCoefficients(
    flow.alpha + finchDesign.geometry.incidence,
    flow.beta,
  );
  const dynamicPressure = 0.5 * density * flow.speed ** 2;
  const areaPressure = dynamicPressure * finchDesign.geometry.wingArea;
  const lift = areaPressure * coefficients.cl * (1 - wingDamage * 0.62);
  const drag = areaPressure * (coefficients.cd + wingDamage * 0.08);
  const right = new Vector3(1, 0, 0).applyQuaternion(orientation);
  const liftDirection = new Vector3()
    .crossVectors(right, flow.direction)
    .normalize();
  const sideDirection = right
    .clone()
    .addScaledVector(flow.direction, -right.dot(flow.direction))
    .normalize();
  const sideForce =
    areaPressure * finchDesign.aerodynamics.sideForceSlope * flow.beta;
  const force = liftDirection
    .multiplyScalar(lift)
    .addScaledVector(flow.direction, -drag)
    .addScaledVector(sideDirection, sideForce);
  return {
    ...flow,
    ...coefficients,
    density,
    dynamicPressure,
    lift,
    drag,
    sideForce,
    force,
  };
}
