import { part } from "../mass-component";
import measured from "./geometry.json";

// F-15C reference-scale reconstruction. Dry allocations and their cuboid inertia
// are estimates in runtime metres: +X right, +Y up, +Z aft. No stores are fitted.
export const f15cMassBudget = [
  part("Fuselage and inlet structure", 4200, [0, 0.4, -0.1], [2.5, 1.4, 14.8]),
  part("Wing structure", 1700, [0, 0.66, 0.65], [13.04925, 0.3, 4.86]),
  part("Two F100-class engines", 3000, [0, -0.12, 3.5], [3.1, 1.1, 5.3]),
  part("Empennage", 600, [0, 1.12, 7.2], [8.4, 3.4, 3.7]),
  part("Landing gear and doors", 850, [0, -0.7, -0.2], [2.7, 1.9, 7.2]),
  part("Cockpit and avionics", 1000, [0, 0.75, -5.2], [1.3, 1.7, 3.2]),
  part("Flight systems and equipment", 1290, [0, 0.18, 0.7], [2.6, 1.1, 8.0]),
  part(
    "Pilot and equipment",
    110,
    [0, 1.0, -4.5],
    [0.65, 1.4, 0.85],
    "payload",
  ),
  part(
    "Reference internal fuel",
    6100,
    [0, 0.45, 0.6],
    [6.0, 0.7, 6.0],
    "fuel",
  ),
];
export const f15cGeometry = {
  span: measured.dimensions[0],
  height: measured.dimensions[1],
  length: measured.dimensions[2],
  wingArea: measured.wingArea,
  meanAerodynamicChord: measured.meanAerodynamicChord,
  quarterChordZ: measured.quarterChordZ,
  incidence: 0,
};
// Lift slope fitted to the refined saved 144-panel wing-only run at +4°.
// All whole-aircraft drag, stall, flap and side-force terms remain estimates.
export const f15cAerodynamics = {
  cl0: 0,
  liftSlope: 2.926898013214739,
  clMax: 1.5,
  clMin: -1.1,
  cd0: 0.026,
  efficiency: 0.76,
  sideslipDrag: 0.48,
  sideForceSlope: -0.86,
  gearDrag: 0.024,
  flapLift: 0.42,
  flapDrag: 0.065,
};
export const f15cPropulsion = {
  kind: "jet",
  shaftPower: 0,
  efficiency: 0,
  staticThrust: 0,
  dryThrust: 130_000,
  afterburningThrust: 210_000,
  fuelRate: 1.35,
  thrustCenter: [0, -0.125, 3.5],
} as const;

// Estimated seat-eye datum inside the authored single-seat canopy, not a
// measured manufacturer visibility envelope. Converted from CAD(0,4.55,3.58).
export const F15C_PILOT_EYE = [0, 1.2, -4.55] as const;
