import type { FuelTank } from "../../flight/fuel-loading";
import measured from "./fuel-geometry.json";
import { heronSystems } from "./systems";

// CAD-contained conceptual wing boxes with measured settled-liquid centroids
// and inertia. Spar/structure displacement, residual fuel and density are estimates.
export const heronFuel = {
  asset: "heron-ut9.glb",
  assetRevision: `CAD source SHA256: ${measured.sourceSha256}`,
  hardware: heronSystems,
  tanks: measured.tanks as FuelTank[],
  installations: [] as {
    source: string;
    name: string;
    mass: number;
    center: number[];
    size: number[];
  }[],
  usableFuelKg: measured.usableFuelKg,
  unusableFuelKg: measured.unusableFuelKg,
  emptyMassIncludingResidual: measured.emptyMassIncludingResidual,
  maxTakeoffMass: 3995,
  defaultLoading: { fuel: 0.65, payload: 1 },
  validity:
    "Original CAD wing-cell envelopes, contained within the wing ahead of its controls; settled level-liquid moments. Estimated component masses, structure allowance, residual fuel, density and capacity. No slosh or feed-system validation.",
};
