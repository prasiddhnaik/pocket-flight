import { aircraftDesign } from "../aircraft/aircraft-design";
import { aircraftStallSpeed } from "./aerodynamics";
import type { AircraftId } from "../aircraft/aircraft";

// These are assist/spool settings, not substitutes for forces or inertia.
function profile(
  id: AircraftId,
  pitchRate: number,
  rollRate: number,
  rudderRate: number,
  bankRecovery: number,
  engineResponse: number,
  gearDamage = 1,
) {
  const design = aircraftDesign(id);
  const stallSpeed = aircraftStallSpeed(design);
  const departureStall = aircraftStallSpeed(
    design,
    design.nominal.mass,
    1.225,
    id === "finch" ? 0 : id === "heron" ? 0.5 : 0.65,
  );
  const landingStall = aircraftStallSpeed(
    design,
    design.nominal.mass,
    1.225,
    id === "finch" ? 0 : 1,
  );
  return {
    pitchRate,
    rollRate,
    rudderRate,
    bankRecovery,
    engineResponse,
    gearDamage,
    stallSpeed,
    trimSpeed: design.trimSpeed,
    rotationKnots: Math.round(departureStall * 1.2 * 1.943844),
    approachKnots: Math.round(landingStall * 1.3 * 1.943844),
    gearSpeed: stallSpeed * 1.5,
    afterburner: design.propulsion.dryThrust
      ? design.propulsion.afterburningThrust / design.propulsion.dryThrust - 1
      : 0,
  };
}
export const flightProfiles = {
  f15c: profile("f15c", 0.56, 1.55, 0.28, 0.8, 1.3, 0.8),
  heron: profile("heron", 0.36, 0.72, 0.20, 0.9, 1.6),
  finch: profile("finch", 0.46, 1.05, 0.26, 1.05, 3.5),
  peregrine: profile("peregrine", 0.54, 1.45, 0.3, 0.85, 1.4),
  aurelia: profile("aurelia", 0.42, 0.88, 0.22, 0.8, 1.1),
  stormbird: profile("stormbird", 0.58, 1.65, 0.3, 0.75, 1.6, 0.65),
};
