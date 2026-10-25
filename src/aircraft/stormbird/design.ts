import { part, type MassComponent } from "../mass-component";

// Measured geometry; component masses, whole-aircraft coefficients and engines remain conceptual estimates.
export const stormbirdMassBudget: MassComponent[] = [
  part("Fuselage", 2800, [0, 0, -0.5], [2, 1.6, 12]),
  part("Wings", 1050, [0, 0, 0.8], [12, 0.35, 4]),
  part("Two engines", 1700, [0, -0.15, 2.5], [3, 1, 3]),
  part("Gear", 420, [0, -0.9, -0.1], [3.4, 1, 4]),
  part("Tail", 260, [0, 0.8, 6], [5.5, 1.8, 2]),
  part("Avionics", 280, [0, 0.3, -4], [1, 0.6, 1]),
  part("Crew", 160, [0, 0.4, -3.3], [1.2, 1, 1.5], "payload"),
  part("Fuel", 1800, [0, 0.1, 0.6], [6, 0.4, 4], "fuel"),
];

export const stormbirdGeometry = {
  span: 13.4,
  length: 17.589,
  wingArea: 55.3605,
  meanAerodynamicChord: 5.202973,
  quarterChordZ: 0.250668,
  incidence: 0,
};

// Attached lift is fitted to the private geometry solver; stall and viscous drag remain estimates.
export const stormbirdAerodynamics = {
  cl0: 0.0235411761,
  liftSlope: 3.3023327097,
  clMax: 1.5,
  clMin: -1.25,
  cd0: 0.026,
  efficiency: 0.75,
  sideslipDrag: 0.45,
  sideForceSlope: -0.85,
  gearDrag: 0.02,
  flapLift: 0.4,
  flapDrag: 0.065,
};

export const stormbirdPropulsion = {
  kind: "jet",
  shaftPower: 0,
  efficiency: 0,
  staticThrust: 0,
  dryThrust: 85_000,
  afterburningThrust: 115_000,
  fuelRate: 1.0,
  thrustCenter: [0, -0.15, 2.5],
} as const;
