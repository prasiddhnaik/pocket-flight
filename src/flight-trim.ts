import { Euler, Quaternion, Vector3 } from "three";
import type { AircraftDesign } from "./aircraft-design";
import { massProperties } from "./aircraft-design";
import { aircraftAerodynamics, aircraftThrust, GRAVITY } from "./aerodynamics";

// Solve force AND pitching-moment equilibrium; no attitude or velocity override.
export function solveTrim(
  design: AircraftDesign,
  balance: ReturnType<typeof massProperties>,
  speed: number,
  altitude = 600,
  gear = 0,
  flap = 0,
) {
  if (!Number.isFinite(speed) || speed <= 0)
    throw new RangeError("Trim speed must be positive.");
  const velocity = new Vector3(0, 0, -speed),
    zero = new Vector3();
  const config = { gear, flap, wingDamage: 0, gearDamage: 0 };
  const evaluate = (alpha: number) => {
    const q = new Quaternion().setFromEuler(new Euler(alpha, 0, 0, "YXZ"));
    const a = aircraftAerodynamics(
      design,
      velocity,
      zero,
      q,
      altitude,
      balance.cg,
      zero,
      undefined,
      config,
    );
    const thrust = a.drag / Math.cos(alpha);
    return {
      q,
      a,
      thrust,
      vertical: a.lift + thrust * Math.sin(alpha) - balance.mass * GRAVITY,
    };
  };
  let lo = -0.08,
    hi =
      (design.aerodynamics.clMax - design.aerodynamics.cl0) /
      design.aerodynamics.liftSlope;
  if (evaluate(lo).vertical > 0 || evaluate(hi).vertical < 0)
    throw new RangeError(
      "Requested trim is outside the attached-flight lift envelope.",
    );
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (evaluate(mid).vertical > 0) hi = mid;
    else lo = mid;
  }
  const alpha = (lo + hi) / 2,
    { q, a, thrust } = evaluate(alpha);
  if (thrust > aircraftThrust(design, speed, 1, a.density))
    throw new RangeError(
      "Insufficient installed thrust for this trim condition.",
    );
  lo = 0;
  hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (aircraftThrust(design, speed, mid, a.density) > thrust) hi = mid;
    else lo = mid;
  }
  const throttle = (lo + hi) / 2;
  const thrustMoment = new Vector3()
    .fromArray(design.propulsion.thrustCenter)
    .sub(balance.cg)
    .cross(new Vector3(0, 0, -thrust));
  const pitch =
    -(a.moment.x + thrustMoment.x) /
    (a.dynamicPressure *
      design.geometry.wingArea *
      design.geometry.meanAerodynamicChord *
      design.moments.elevator);
  if (Math.abs(pitch) > 1)
    throw new RangeError("Elevator authority cannot trim this loading.");
  const trimmed = aircraftAerodynamics(
    design,
    velocity,
    zero,
    q,
    altitude,
    balance.cg,
    zero,
    { pitch, roll: 0, yaw: 0 },
    config,
  );
  const force = trimmed.force
    .clone()
    .add(new Vector3(0, 0, -thrust).applyQuaternion(q))
    .add(new Vector3(0, -balance.mass * GRAVITY, 0));
  return {
    alpha,
    throttle,
    pitch,
    forceResidual: force.length(),
    momentResidual: trimmed.moment.add(thrustMoment).length(),
  };
}
