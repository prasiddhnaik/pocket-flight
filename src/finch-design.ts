// Measured geometry; conceptual mass/propulsion and coefficient estimates.
// See docs/FINCH_ENGINEERING.html for provenance and validity limits.
export const finchDesign = {
  geometry: {
    span: 10.98,
    length: 8.09,
    height: 3.222,
    wingArea: 16.124544,
    meanAerodynamicChord: 1.529605,
    quarterChordZ: -0.28497,
    incidence: 0,
  },
  massBudget: [
    { name: "Fuselage and cabin", mass: 220, center: [0, 0, 0] },
    { name: "Wing structure", mass: 140, center: [0, 0, 0.1] },
    { name: "Engine and propeller", mass: 110, center: [0, 0.025, -2.6] },
    { name: "Avionics", mass: 25, center: [0, 0.2, -0.7] },
    { name: "Landing gear", mass: 45, center: [0, -0.9, 0] },
    { name: "Empennage", mass: 35, center: [0, 0.3, 3.4] },
    { name: "Two occupants", mass: 170, center: [0, 0, -0.18] },
    { name: "Fuel", mass: 80, center: [0, -0.05, 0] },
    { name: "Baggage", mass: 35, center: [0, 0, 1.4] },
  ],
  aerodynamics: {
    cl0: 0.24,
    liftSlope: 5, // Per radian; estimated finite-wing slope, not an airfoil polar.
    clMax: 1.55,
    clMin: -1.25,
    cd0: 0.032, // Includes the permanently extended tricycle gear.
    efficiency: 0.8,
    sideslipDrag: 0.35,
    sideForceSlope: -0.65,
  },
  propulsion: { shaftPower: 135_000, efficiency: 0.78, staticThrust: 3_350 },
  validity:
    "Concept trainer, subsonic island flight; no measured polar, structural validation, fuel burn, or component moment/inertia integration yet.",
} as const;

export const finchMass = finchDesign.massBudget.reduce(
  (sum, part) => sum + part.mass,
  0,
);
export const finchCG = [0, 1, 2].map(
  (axis) =>
    finchDesign.massBudget.reduce(
      (sum, part) => sum + part.mass * part.center[axis],
      0,
    ) / finchMass,
);
export const finchAspectRatio =
  finchDesign.geometry.span ** 2 / finchDesign.geometry.wingArea;
