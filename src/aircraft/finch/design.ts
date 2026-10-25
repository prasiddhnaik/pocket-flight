import { finchDesign } from "./finch-design";
import type { MassComponent } from "../mass-component";

// Measured geometry; component masses, whole-aircraft coefficients and engines remain conceptual estimates.
const finchSizes = [
  [1.4, 1.5, 5],
  [10, 0.2, 1.5],
  [0.8, 0.8, 1.1],
  [0.6, 0.3, 0.4],
  [2.4, 0.6, 2.6],
  [3, 1.2, 1.8],
  [1, 1, 0.8],
  [2, 0.2, 0.6],
  [0.8, 0.6, 0.6],
];
export const finchMassBudget: MassComponent[] = finchDesign.massBudget.map(
  (p, i) => ({
    ...p,
    size: finchSizes[i],
    category:
      p.name === "Fuel"
        ? "fuel"
        : p.name === "Two occupants" || p.name === "Baggage"
          ? "payload"
          : "empty",
  }),
);

export const finchGeometry = {
  ...finchDesign.geometry,
  wingArea: 16.129242,
  meanAerodynamicChord: 1.530837,
};

// Attached lift is fitted to the private geometry solver; stall and viscous drag remain estimates.
export const finchAerodynamics = {
  ...finchDesign.aerodynamics,
  cl0: 0.1244436731,
  liftSlope: 4.6479478799,
  gearDrag: 0,
  flapLift: 0.32,
  flapDrag: 0.04,
};

export const finchPropulsion = {
  kind: "propeller",
  ...finchDesign.propulsion,
  dryThrust: 0,
  afterburningThrust: 0,
  fuelRate: 0.0075,
  thrustCenter: [0, 0.025, -2.6],
} as const;
