import type { FuelTank } from "../../flight/fuel-loading";
import { f15cSystems } from "./systems";
import measuredWing from "./wing-fuel.json";

// The fuselage is an estimated equivalent box with a uniform level fill. Each wing
// tank is measured from its three bladders in the Blender model, settling level,
// with no slosh or feed model. The fuselage fills first and the wings burn first:
// the bladders sit well aft of the fuselage tank, and holding fuel there at low
// states would take the balance point past its aft limit.
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
    fillPriority: 1,
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
function wingTank(id: "left" | "right", name: string, kg: number): FuelTank {
  const densityKgPerLitre = 0.8;
  const unusableLitres = 25;
  const usableLitres = kg / densityKgPerLitre;
  const sign = id === "left" ? -1 : 1;
  // Measured on the right wing. Mirroring flips x and the two terms that depend on it.
  const mirror = (state: { center: number[]; inertiaPerKg: number[] }) => ({
    center: [sign * state.center[0], state.center[1], state.center[2]],
    inertiaPerKg: state.inertiaPerKg.map((value, i) =>
      [1, 2, 3, 6].includes(i) ? sign * value : value,
    ),
  });
  return {
    id,
    name,
    densityKgPerLitre,
    fillPriority: 2,
    assumptions:
      "Measured from three connected Blender wing bladders, level fill: no slosh or feed-system model.",
    envelopeLitres: measuredWing.capacityLitres,
    displacementLitres: 0,
    expansionLitres: measuredWing.capacityLitres - usableLitres - unusableLitres,
    usableLitres,
    unusableLitres,
    size: measuredWing.size,
    samples: measuredWing.samples.map((sample) => ({
      fraction: sample.fraction,
      level: sample.level,
      ...mirror(sample),
    })),
    residual: mirror(measuredWing.residual),
  };
}
export const f15cFuel = {
  asset: "f15c-eagle.glb",
  assetRevision:
    "F-15C internal fuel: wing tanks measured from the Blender bladders; fuselage conceptual",
  hardware: f15cSystems,
  tanks: [
    tank(
      "fuselage",
      "Fuselage equivalent fuel cells",
      3400,
      [0, 0.22, 0.2],
      [1.65, 0.6, 5.8],
    ),
    wingTank("left", "Left wing bladders", 1350),
    wingTank("right", "Right wing bladders", 1350),
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
