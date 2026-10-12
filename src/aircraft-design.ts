import { Matrix3, Vector3 } from "three";
import type { AircraftId } from "./aircraft";
import { finchDesign } from "./finch-design";

// SI units; +X right, +Y up, +Z aft. Geometry is measured at runtime scale.
// Component masses/envelopes and aero/engine data are conceptual estimates.
export type MassComponent = {
  name: string;
  mass: number;
  center: readonly number[];
  size: readonly number[];
  category: "empty" | "fuel" | "payload";
};
const part = (
  name: string,
  mass: number,
  center: number[],
  size: number[],
  category: MassComponent["category"] = "empty",
): MassComponent => ({ name, mass, center, size, category });

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
const massBudgets: Record<AircraftId, MassComponent[]> = {
  finch: finchDesign.massBudget.map((p, i) => ({
    ...p,
    size: finchSizes[i],
    category:
      p.name === "Fuel"
        ? "fuel"
        : p.name === "Two occupants" || p.name === "Baggage"
          ? "payload"
          : "empty",
  })),
  peregrine: [
    part("Fuselage", 2500, [0, 0, -0.45], [1.7, 1.8, 14]),
    part("Wings", 1000, [0, 0.8, 0.3], [12, 0.3, 3.8]),
    part("Two engines", 1400, [0, -0.3, 3.2], [2.8, 0.9, 3]),
    part("Gear", 350, [0, -0.8, 0.5], [3.5, 1, 6]),
    part("Tail", 300, [0, 1, 6], [5, 1.8, 2]),
    part("Avionics", 220, [0, 0.5, -4.5], [1, 0.6, 1]),
    part("Crew", 220, [0, 0.6, -3], [1.2, 1, 1.5], "payload"),
    part("Fuel", 1400, [0, 0.3, 0.8], [7, 0.35, 3], "fuel"),
  ],
  aurelia: [
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
  ],
  stormbird: [
    part("Fuselage", 2800, [0, 0, -0.5], [2, 1.6, 12]),
    part("Wings", 1050, [0, 0, 0.8], [12, 0.35, 4]),
    part("Two engines", 1700, [0, -0.15, 2.5], [3, 1, 3]),
    part("Gear", 420, [0, -0.9, -0.1], [3.4, 1, 4]),
    part("Tail", 260, [0, 0.8, 6], [5.5, 1.8, 2]),
    part("Avionics", 280, [0, 0.3, -4], [1, 0.6, 1]),
    part("Crew", 160, [0, 0.4, -3.3], [1.2, 1, 1.5], "payload"),
    part("Fuel", 1800, [0, 0.1, 0.6], [6, 0.4, 4], "fuel"),
  ],
};

export type Loading = { fuel: number; payload: number };
export function massProperties(
  parts: readonly MassComponent[],
  loading: Loading = { fuel: 1, payload: 1 },
) {
  if (
    !Number.isFinite(loading.fuel) ||
    !Number.isFinite(loading.payload) ||
    loading.fuel < 0 ||
    loading.fuel > 1 ||
    loading.payload < 0 ||
    loading.payload > 1
  )
    throw new RangeError(
      "Fuel and payload fractions must be between zero and one.",
    );
  const masses = parts.map(
    (p) => p.mass * (p.category === "empty" ? 1 : loading[p.category]),
  );
  const mass = masses.reduce((sum, m) => sum + m, 0);
  const cg = new Vector3();
  parts.forEach((p, i) =>
    cg.addScaledVector(new Vector3().fromArray(p.center), masses[i] / mass),
  );
  const inertia = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  parts.forEach((p, i) => {
    const [w, h, l] = p.size,
      m = masses[i];
    const { x, y, z } = new Vector3().fromArray(p.center).sub(cg);
    const contribution = [
      m * ((h * h + l * l) / 12 + y * y + z * z),
      -m * x * y,
      -m * x * z,
      -m * x * y,
      m * ((w * w + l * l) / 12 + x * x + z * z),
      -m * y * z,
      -m * x * z,
      -m * y * z,
      m * ((w * w + h * h) / 12 + x * x + y * y),
    ];
    contribution.forEach((value, j) => (inertia.elements[j] += value));
  });
  return { mass, cg, inertia, inverseInertia: inertia.clone().invert() };
}

const geometries = {
  finch: {
    ...finchDesign.geometry,
    wingArea: 16.129242,
    meanAerodynamicChord: 1.530837,
  },
  peregrine: {
    span: 13.888,
    length: 20.589,
    wingArea: 52.00012,
    meanAerodynamicChord: 4.331776,
    quarterChordZ: 0.081942,
    incidence: 0,
  },
  aurelia: {
    span: 14.982,
    length: 17.325,
    wingArea: 35.466754,
    meanAerodynamicChord: 2.858568,
    quarterChordZ: 0.290714,
    incidence: 0,
  },
  stormbird: {
    span: 13.4,
    length: 17.589,
    wingArea: 55.3605,
    meanAerodynamicChord: 5.202973,
    quarterChordZ: 0.250668,
    incidence: 0,
  },
};
const polars = {
  // Attached lift is fitted to the private geometry solver's 0°/4°, 96-panel
  // main-wing results. Stall, viscous drag and tail derivatives remain estimates.
  finch: {
    ...finchDesign.aerodynamics,
    cl0: 0.1244436731,
    liftSlope: 4.6479478799,
    gearDrag: 0,
    flapLift: 0.32,
    flapDrag: 0.04,
  },
  peregrine: {
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
  },
  aurelia: {
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
  },
  stormbird: {
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
  },
};
const propulsion = {
  finch: {
    kind: "propeller",
    ...finchDesign.propulsion,
    dryThrust: 0,
    afterburningThrust: 0,
    fuelRate: 0.0075,
    thrustCenter: [0, 0.025, -2.6],
  },
  peregrine: {
    kind: "jet",
    shaftPower: 0,
    efficiency: 0,
    staticThrust: 0,
    dryThrust: 62_000,
    afterburningThrust: 82_000,
    fuelRate: 0.72,
    thrustCenter: [0, -0.3, 3.2],
  },
  aurelia: {
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
  },
  stormbird: {
    kind: "jet",
    shaftPower: 0,
    efficiency: 0,
    staticThrust: 0,
    dryThrust: 85_000,
    afterburningThrust: 115_000,
    fuelRate: 1.0,
    thrustCenter: [0, -0.15, 2.5],
  },
} as const;
function createAircraftDesign(id: AircraftId) {
  const geometry = geometries[id],
    massBudget = massBudgets[id];
  const nominal = massProperties(massBudget);
  const staticMargin = id === "finch" ? 0.14 : id === "aurelia" ? 0.16 : 0.1;
  const neutralPointZ =
    nominal.cg.z + staticMargin * geometry.meanAerodynamicChord;
  const forwardCG = Math.min(
    ...[0, 1].flatMap((fuel) =>
      [0, 1].map(
        (payload) => massProperties(massBudget, { fuel, payload }).cg.z,
      ),
    ),
  );
  return {
    id,
    geometry,
    massBudget,
    nominal,
    aerodynamics: polars[id],
    propulsion: propulsion[id],
    neutralPointZ,
    trimSpeed:
      id === "finch"
        ? 34
        : id === "aurelia"
          ? 70
          : id === "peregrine"
            ? 80
            : 90,
    assistClimbPitch:
      id === "finch"
        ? 0.3
        : id === "aurelia"
          ? 0.65
          : id === "peregrine"
            ? 0.7
            : 0.85,
    moments: {
      pitchDamping: id === "finch" ? -11.4 : -14,
      yawStability: -0.16,
      yawDamping: -0.65,
      dihedral: 0.06,
      rollDamping: -0.55,
      elevator: 1.05,
      aileron:
        id === "peregrine" || id === "stormbird"
          ? 0.14
          : id === "aurelia"
            ? 0.08
            : 0.1,
      rudder: 0.12,
    },
    cgEnvelope: [
      forwardCG - 0.02 * geometry.meanAerodynamicChord,
      neutralPointZ - 0.03 * geometry.meanAerodynamicChord,
    ],
    provenance:
      "Measured main-wing geometry; estimated component cuboids, whole-aircraft coefficients, neutral point. Finch altitude power and military jet thrust/damping use explicitly transferred published references; civil engine map remains estimated. Subsonic conceptual model; not flight-test calibrated.",
  };
}
const designs = Object.fromEntries(
  (["finch", "peregrine", "aurelia", "stormbird"] as const).map((id) => [
    id,
    createAircraftDesign(id),
  ]),
) as Record<AircraftId, ReturnType<typeof createAircraftDesign>>;
export function aircraftDesign(id: AircraftId) {
  return designs[id];
}
export type AircraftDesign = ReturnType<typeof aircraftDesign>;
