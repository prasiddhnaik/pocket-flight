import { part, type MassComponent } from "../mass-component";

// Measured geometry; component masses, whole-aircraft coefficients and engines remain conceptual estimates.
export const aureliaMassBudget: MassComponent[] = [
  part("Fuselage and cabin", 1800, [0, 0, -1], [1.6, 1.7, 13]),
  part("Wings", 650, [0, 0.15, 0.9], [13, 0.25, 2.6]),
  part("Two engines", 900, [0, 0.15, 3], [3, 1, 2.8]),
  part("Gear", 240, [0, -0.75, -0.15], [3, 0.8, 6]),
  part("Tail", 160, [0, 1, 6], [4.5, 1.8, 2]),
  part("Avionics", 160, [0, 0.2, -6], [0.8, 0.5, 0.8]),
  part(
    "Crew, passengers and baggage",
    750,
    [0, 0.2, -2],
    [1.3, 1, 5],
    "payload",
  ),
  part("Fuel", 1000, [0, 0.1, 0.1], [7, 0.3, 2.5], "fuel"),
];

export const aureliaGeometry = {
  span: 14.982,
  length: 17.325,
  wingArea: 35.466754,
  meanAerodynamicChord: 2.858568,
  quarterChordZ: 0.290714,
  incidence: 0,
};

// Attached lift is fitted to the private geometry solver; stall and viscous drag remain estimates.
export const aureliaAerodynamics = {
  cl0: 0,
  liftSlope: 4.2073163671,
  clMax: 1.5,
  clMin: -1.2,
  cd0: 0.022,
  efficiency: 0.83,
  sideslipDrag: 0.3,
  sideForceSlope: -0.75,
  gearDrag: 0.025,
  flapLift: 0.55,
  flapDrag: 0.075,
};

export const aureliaPropulsion = {
  kind: "jet",
  shaftPower: 0,
  efficiency: 0,
  staticThrust: 0,
  // Conceptual twin 25 kN installation, sized against the measured 5.66 t
  // loading and Palm Bay departure. This is not a manufacturer engine rating.
  dryThrust: 50_000,
  afterburningThrust: 50_000,
  fuelRate: 0.32,
  thrustCenter: [0, 0.15, 3],
} as const;
