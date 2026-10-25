import { part } from "../mass-component";
import measured from "./geometry.json";
import calibrated from "./aerodynamics.json";

// Grand Caravan scale reference; original CAD, estimated component masses/polar.
// SI coordinates are right/up/aft, with CAD ground 2.05 m below the body datum.
export const heronMassBudget = [
  part("Fuselage and cabin", 1050, [0, 0.05, 0.8], [1.82, 2.1, 9.5]),
  part("Wing structure", 430, [0, 1.18, -0.38], [15.87, 0.32, 1.95]),
  part("Turboprop and propeller", 300, [0, 0.23, -3.3], [1.1, 1.0, 1.9]),
  part("Landing gear", 180, [0, -1.15, -0.1], [3.5, 1.4, 3.8]),
  part("Empennage", 110, [0, 0.8, 6.5], [5.32, 2.4, 2.2]),
  part("Equipment and fittings", 240, [0, -0.1, -0.3], [1.4, 1.2, 4.5]),
  part(
    "Crew and passengers",
    680,
    [0, 0.05, 0.31],
    [1.3, 1.2, 4.6],
    "payload",
  ),
  part("Cargo", 180, [0, -1.16, 0.72], [1.1, 0.6, 3.0], "payload"),
];

export const heronGeometry = {
  span: 15.87,
  length: 12.67,
  height: 4.7,
  wingArea: measured.wingArea,
  meanAerodynamicChord: measured.meanAerodynamicChord,
  quarterChordZ: measured.quarterChordZ,
  incidence: 0,
};

export const heronAerodynamics = {
  cl0: calibrated.cl0,
  liftSlope: calibrated.liftSlope,
  clMax: 1.65,
  clMin: -1.15,
  cd0: calibrated.cd0, // Prior estimated drag area retained for gear, struts and pod.
  efficiency: 0.78,
  sideslipDrag: 0.4,
  sideForceSlope: -0.72,
  gearDrag: 0,
  flapLift: 0.62,
  flapDrag: 0.075,
};

export const heronPropulsion = {
  kind: "propeller",
  shaftPower: 646_520, // 867 shaft horsepower, reference class rating.
  efficiency: 0.8,
  staticThrust: 11_800,
  dryThrust: 0,
  afterburningThrust: 0,
  fuelRate: 0.09,
  thrustCenter: [0, 0.23, -3.3],
} as const;
