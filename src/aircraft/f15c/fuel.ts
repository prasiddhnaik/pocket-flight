import type { FuelTank } from "../../flight/fuel-loading";
import { f15cSystems } from "./systems";

// Estimated equivalent internal boxes; not CAD-measured tank envelopes. Uniform
// level fill supplies explicit approximate CG/inertia, with no slosh/feed model.
// Wing-first fill/center-first burn is a conceptual balance schedule.
function tank(
  id: string,
  name: string,
  kg: number,
  center: number[],
  size: number[],
): FuelTank {
  const densityKgPerLitre = 0.8;
  const inertia = (height: number) => [
    (height ** 2 + size[2] ** 2) / 12,
    0,
    0,
    0,
    (size[0] ** 2 + size[2] ** 2) / 12,
    0,
    0,
    0,
    (size[0] ** 2 + height ** 2) / 12,
  ];
  const unusableLitres = 25;
  return {
    id,
    name,
    densityKgPerLitre,
    fillPriority: id === "fuselage" ? 2 : 1,
    assumptions:
      "Estimated equivalent box: no measured tank envelope, slosh or feed-system model.",
    envelopeLitres: kg / densityKgPerLitre + unusableLitres,
    displacementLitres: 0,
    expansionLitres: 0,
    usableLitres: kg / densityKgPerLitre,
    unusableLitres,
    size,
    samples: Array.from({ length: 17 }, (_, i) => {
      const fraction = i / 16;
      return {
        fraction,
        level: center[1] - size[1] / 2 + size[1] * fraction,
        center: [
          center[0],
          center[1] - (size[1] * (1 - fraction)) / 2,
          center[2],
        ],
        inertiaPerKg: inertia(size[1] * fraction),
      };
    }),
    residual: {
      center: [center[0], center[1] - size[1] / 2 + 0.01, center[2]],
      inertiaPerKg: inertia(0.02),
    },
  };
}
export const f15cFuel = {
  asset: "f15c-eagle.glb",
  assetRevision:
    "F-15C conceptual internal fuel allocation; no CAD tank measurement",
  hardware: f15cSystems,
  tanks: [
    tank(
      "fuselage",
      "Fuselage equivalent fuel cells",
      3400,
      [0, 0.22, 0.2],
      [1.65, 0.6, 5.8],
    ),
    tank(
      "left",
      "Left wing equivalent cells",
      1350,
      [-2.55, 0.62, 1.1],
      [2.5, 0.28, 3.1],
    ),
    tank(
      "right",
      "Right wing equivalent cells",
      1350,
      [2.55, 0.62, 1.1],
      [2.5, 0.28, 3.1],
    ),
  ],
  installations: [] as {
    source: string;
    name: string;
    mass: number;
    center: number[];
    size: number[];
  }[],
  usableFuelKg: 6100,
  unusableFuelKg: 60,
  emptyMassIncludingResidual: 12700,
  maxTakeoffMass: 30845,
  defaultLoading: { fuel: 0.65, payload: 1 },
  validity:
    "Estimated 6100 kg internal fuel and 12700 kg empty mass reference class. Equivalent tank boxes and settled-liquid moments are conceptual allocations, not measured aircraft tanks. No external tanks, stores, slosh or feed-system validation.",
};
