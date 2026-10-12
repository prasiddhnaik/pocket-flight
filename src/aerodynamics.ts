import {
  densityAltitude,
  localSoundSpeed,
  pistonPowerFactor,
  referenceJetThrust,
  interpolate,
} from "./engine-map";
import {
  fighterAlphaDegrees,
  fighterPitchDamping,
  sectionAlphaDegrees,
  sectionLift,
} from "./flight-reference-data";
import { MathUtils, Quaternion, Vector3 } from "three";
import { finchAspectRatio, finchDesign, finchMass } from "./finch-design";
import type { AircraftDesign } from "./aircraft-design";

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

export function aircraftStallSpeed(
  design: AircraftDesign,
  mass = design.nominal.mass,
  density = SEA_LEVEL_DENSITY,
  flap = 0,
  loadFactor = 1,
) {
  return Math.sqrt(
    (2 * mass * GRAVITY * Math.abs(loadFactor)) /
      (density *
        design.geometry.wingArea *
        (design.aerodynamics.clMax + design.aerodynamics.flapLift * flap)),
  );
}

export function aircraftThrust(
  design: AircraftDesign,
  speed: number,
  throttle: number,
  density: number,
  altitude = densityAltitude(density),
) {
  const p = design.propulsion,
    command = MathUtils.clamp(throttle, 0, 1);
  const densityRatio = density / SEA_LEVEL_DENSITY;
  if (p.kind === "propeller")
    return Math.min(
      p.staticThrust * command * pistonPowerFactor(altitude),
      (p.shaftPower * p.efficiency * command * pistonPowerFactor(altitude)) /
        Math.max(speed, 1),
    );
  const mach = speed / localSoundSpeed(altitude);
  if (design.id === "aurelia")
    // Civilian installed map remains an estimate; a fighter deck is not a match.
    return (
      command *
      p.dryThrust *
      densityRatio ** 0.7 *
      MathUtils.clamp(1 - 0.25 * mach, 0.65, 1)
    );
  // Scaled NASA reference shape. Ratings remain concept assumptions. Below
  // M=.2 hold the first row; above M=1 / 15.24km hold the boundary and flag in lab.
  const dry = (p.dryThrust * referenceJetThrust(mach, altitude)) / 56401;
  const maximum =
    (p.afterburningThrust * referenceJetThrust(mach, altitude, true)) / 95276;
  const militaryCommand = 0.88;
  return command <= militaryCommand
    ? (dry * command) / militaryCommand
    : MathUtils.lerp(
        dry,
        maximum,
        MathUtils.smoothstep(command, militaryCommand, 1),
      );
}

export type AerodynamicConfiguration = {
  gear: number;
  flap: number;
  wingDamage: number;
  gearDamage: number;
  leftWingDamage?: number;
  rightWingDamage?: number;
  leftWingDetached?: boolean;
  rightWingDetached?: boolean;
};
export type AerodynamicControls = { pitch: number; roll: number; yaw: number };
export function aircraftAerodynamics(
  design: AircraftDesign,
  velocity: Vector3,
  wind: Vector3,
  orientation: Quaternion,
  altitude: number,
  cg: Vector3,
  rates = new Vector3(),
  controls: AerodynamicControls = { pitch: 0, roll: 0, yaw: 0 },
  config: AerodynamicConfiguration = {
    gear: 0,
    flap: 0,
    wingDamage: 0,
    gearDamage: 0,
  },
) {
  const flow = bodyAirflow(velocity, wind, orientation),
    density = airDensity(altitude);
  const a = design.aerodynamics,
    g = design.geometry,
    m = design.moments;
  const flap = MathUtils.clamp(config.flap, 0, 1),
    alpha = flow.alpha + g.incidence;
  const cl0 = a.cl0 + a.flapLift * flap,
    clMax = a.clMax + a.flapLift * flap;
  const positiveStall = (clMax - cl0) / a.liftSlope,
    negativeStall = (a.clMin - cl0) / a.liftSlope;
  const attached = MathUtils.clamp(alpha, negativeStall, positiveStall);
  const separation = 1 - Math.exp(-8 * Math.abs(alpha - attached));
  const attachedCL = cl0 + a.liftSlope * attached;
  // Normalize the measured section lift loss about each concept's own CLmax
  // and critical angle. This transfers shape only; it does not validate those
  // peaks, swept-wing stall, negative-alpha symmetry or deep-stall behavior.
  const stallAngle = alpha >= 0 ? positiveStall : -negativeStall;
  const normalized = Math.abs(alpha) / stallAngle;
  const measuredEnd = 18 / 13.5;
  const stallRatio =
    interpolate(sectionAlphaDegrees, sectionLift, normalized * 13.5) / 1.35;
  const measuredCL = attachedCL * stallRatio;
  const deepBlend = MathUtils.smoothstep(
    Math.abs(alpha),
    stallAngle * measuredEnd,
    Math.PI / 4,
  );
  const cl =
    (normalized <= 1
      ? attachedCL
      : MathUtils.lerp(measuredCL, 1.1 * Math.sin(2 * alpha), deepBlend)) *
    Math.cos(flow.beta) ** 2;
  const controlEffectiveness = 1 - 0.65 * separation; // Explicit engineering assumption, not measured tail blanketing.
  const pitchDamping =
    design.id === "peregrine" || design.id === "stormbird"
      ? interpolate(
          fighterAlphaDegrees,
          fighterPitchDamping,
          (alpha * 180) / Math.PI,
        )
      : m.pitchDamping;
  const aspectRatio = g.span ** 2 / g.wingArea;
  const mach =
    flow.speed /
    Math.sqrt(
      1.4 * 287.05 * (288.15 - 0.0065 * MathUtils.clamp(altitude, 0, 11000)),
    );
  const cd =
    a.cd0 +
    cl ** 2 / (Math.PI * aspectRatio * a.efficiency) +
    a.gearDrag * MathUtils.clamp(config.gear, 0, 1) +
    a.flapDrag * flap ** 2 +
    separation * 1.8 * Math.sin(alpha) ** 2 +
    a.sideslipDrag * Math.sin(flow.beta) ** 2 +
    config.wingDamage * 0.08 +
    config.gearDamage * 0.04 +
    0.8 * Math.max(0, mach - 0.65) ** 2;
  const dynamicPressure = 0.5 * density * flow.speed ** 2,
    qS = dynamicPressure * g.wingArea;
  const leftDamage = config.leftWingDamage ?? config.wingDamage;
  const rightDamage = config.rightWingDamage ?? config.wingDamage;
  const leftLift = qS * cl * 0.5 * (config.leftWingDetached ? 0 : 1 - leftDamage * 0.62);
  const rightLift = qS * cl * 0.5 * (config.rightWingDetached ? 0 : 1 - rightDamage * 0.62);
  const lift = leftLift + rightLift,
    drag = qS * cd;
  const right = new Vector3(1, 0, 0).applyQuaternion(orientation);
  const liftDirection = new Vector3()
    .crossVectors(right, flow.direction)
    .normalize();
  const sideDirection = right
    .clone()
    .addScaledVector(flow.direction, -right.dot(flow.direction))
    .normalize();
  const sideForce = qS * a.sideForceSlope * Math.sin(flow.beta);
  const force = liftDirection
    .multiplyScalar(lift)
    .addScaledVector(flow.direction, -drag)
    .addScaledVector(sideDirection, sideForce);
  const c = g.meanAerodynamicChord,
    rateScale = 1 / (2 * Math.max(flow.speed, 1));
  const nominalTrimCL =
    (design.nominal.mass * GRAVITY) /
    (0.5 * SEA_LEVEL_DENSITY * design.trimSpeed ** 2 * g.wingArea);
  const trimAlpha = (nominalTrimCL - a.cl0) / a.liftSlope;
  const nominalMargin = (design.neutralPointZ - design.nominal.cg.z) / c;
  // Whole-aircraft moment derivatives include the estimated tail contribution.
  // CG displacement changes lift's lever arm, without retuning the polar.
  const pitchCoefficient =
    -a.liftSlope * nominalMargin * (alpha - trimAlpha) +
    (cl * (cg.z - design.nominal.cg.z)) / c +
    pitchDamping * rates.x * c * rateScale +
    m.elevator * controls.pitch * controlEffectiveness;
  const yawCoefficient =
    m.yawStability * Math.sin(flow.beta) +
    m.yawDamping * rates.y * g.span * rateScale -
    m.rudder * controls.yaw * controlEffectiveness;
  const rollCoefficient =
    m.dihedral * Math.sin(flow.beta) +
    m.rollDamping * rates.z * g.span * rateScale -
    m.aileron * controls.roll * controlEffectiveness * (1 - (leftDamage + rightDamage) * 0.25);
  const moment = new Vector3(
    qS * c * pitchCoefficient,
    qS * g.span * yawCoefficient,
    qS * g.span * rollCoefficient + (rightLift - leftLift) * g.span * 0.25,
  );
  return {
    ...flow,
    density,
    dynamicPressure,
    lift,
    drag,
    sideForce,
    force,
    moment,
    cl,
    cd,
    mach,
    positiveStall,
    negativeStall,
    separation,
    controlEffectiveness,
    stalled: Math.abs(alpha - attached) > 1e-8,
    staticMargin: (design.neutralPointZ - cg.z) / c,
  };
}
