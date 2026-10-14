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
    { a, thrust } = evaluate(alpha);
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
  // Resolve all three forces and moments, including lateral tank imbalance.
  // Unknowns: pitch attitude, bank, elevator, aileron, rudder and power.
  const state = [alpha, 0, pitch, 0, 0, throttle];
  const residual = (v: number[]) => {
    const orientation = new Quaternion().setFromEuler(
      new Euler(v[0], 0, v[1], "YXZ"),
    );
    const aero = aircraftAerodynamics(
      design,
      velocity,
      zero,
      orientation,
      altitude,
      balance.cg,
      zero,
      { pitch: v[2], roll: v[3], yaw: v[4] },
      config,
    );
    const power = aircraftThrust(design, speed, v[5], aero.density, altitude);
    const force = aero.force
      .clone()
      .add(new Vector3(0, 0, -power).applyQuaternion(orientation))
      .add(new Vector3(0, -balance.mass * GRAVITY, 0));
    const moment = aero.moment.clone().add(
      new Vector3()
        .fromArray(design.propulsion.thrustCenter)
        .sub(balance.cg)
        .cross(new Vector3(0, 0, -power)),
    );
    return [...force.toArray(), ...moment.toArray()];
  };
  for (let iteration = 0; iteration < 12; iteration++) {
    const r = residual(state);
    if (Math.max(...r.map(Math.abs)) < 1e-8) break;
    const step = 1e-5,
      matrix = r.map((value) => [0, 0, 0, 0, 0, 0, -value]);
    for (let col = 0; col < 6; col++) {
      const perturbed = [...state];
      perturbed[col] += step;
      const b = residual(perturbed);
      for (let row = 0; row < 6; row++)
        matrix[row][col] = (b[row] - r[row]) / step;
    }
    for (let col = 0; col < 6; col++) {
      let pivot = col;
      for (let row = col + 1; row < 6; row++)
        if (Math.abs(matrix[row][col]) > Math.abs(matrix[pivot][col]))
          pivot = row;
      [matrix[col], matrix[pivot]] = [matrix[pivot], matrix[col]];
      if (Math.abs(matrix[col][col]) < 1e-10)
        throw RangeError("Trim Jacobian is singular");
      const scale = matrix[col][col];
      for (let j = col; j <= 6; j++) matrix[col][j] /= scale;
      for (let row = 0; row < 6; row++)
        if (row !== col) {
          const factor = matrix[row][col];
          for (let j = col; j <= 6; j++)
            matrix[row][j] -= factor * matrix[col][j];
        }
    }
    state.forEach((_, i) => {
      state[i] += matrix[i][6];
    });
  }
  const r = residual(state),
    forceResidual = Math.hypot(...r.slice(0, 3)),
    momentResidual = Math.hypot(...r.slice(3));
  if (
    state.some((v) => !Number.isFinite(v)) ||
    state.slice(2, 5).some((v) => Math.abs(v) > 1) ||
    state[5] < 0 ||
    state[5] > 1 ||
    forceResidual > 1e-4 ||
    momentResidual > 1e-4
  )
    throw RangeError(
      "Loading cannot be trimmed within control and power limits",
    );
  return {
    alpha: state[0],
    bank: state[1],
    pitch: state[2],
    roll: state[3],
    yaw: state[4],
    throttle: state[5],
    forceResidual,
    momentResidual,
  };
}
