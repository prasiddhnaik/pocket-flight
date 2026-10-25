import { part, type MassComponent } from "../mass-component";

// Measured geometry; component masses, whole-aircraft coefficients and engines remain conceptual estimates.
export const peregrineMassBudget: MassComponent[] = [
  part("Fuselage", 2500, [0, 0, -0.45], [1.7, 1.8, 14]),
  part("Wings", 1000, [0, 0.8, 0.3], [12, 0.3, 3.8]),
  part("Two engines", 1400, [0, -0.3, 3.2], [2.8, 0.9, 3]),
  part("Gear", 350, [0, -0.8, 0.5], [3.5, 1, 6]),
  part("Tail", 300, [0, 1, 6], [5, 1.8, 2]),
  part("Avionics", 220, [0, 0.5, -4.5], [1, 0.6, 1]),
  part("Crew", 220, [0, 0.6, -3], [1.2, 1, 1.5], "payload"),
  part("Fuel", 1400, [0, 0.3, 0.8], [7, 0.35, 3], "fuel"),
];

export const peregrineGeometry = {
  span: 13.888,
  length: 20.589,
  wingArea: 52.00012,
  meanAerodynamicChord: 4.331776,
  quarterChordZ: 0.081942,
  incidence: 0,
};

// Attached lift is fitted to the private geometry solver; stall and viscous drag remain estimates.
export const peregrineAerodynamics = {
  cl0: 0.0903619537,
  liftSlope: 3.3799194053,
  clMax: 1.45,
  clMin: -1.2,
  cd0: 0.027,
  efficiency: 0.78,
  sideslipDrag: 0.4,
  sideForceSlope: -0.8,
  gearDrag: 0.022,
  flapLift: 0.45,
  flapDrag: 0.07,
};

export const peregrinePropulsion = {
  kind: "jet",
  shaftPower: 0,
  efficiency: 0,
  staticThrust: 0,
  dryThrust: 62_000,
  afterburningThrust: 82_000,
  fuelRate: 0.72,
  thrustCenter: [0, -0.3, 3.2],
} as const;
