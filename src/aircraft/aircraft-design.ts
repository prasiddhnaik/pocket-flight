import type { MassComponent } from "./mass-component";
export type { MassComponent } from "./mass-component";
import {
  finchMassBudget,
  finchGeometry,
  finchAerodynamics,
  finchPropulsion,
} from "./finch/design";
import {
  peregrineMassBudget,
  peregrineGeometry,
  peregrineAerodynamics,
  peregrinePropulsion,
} from "./peregrine/design";
import {
  aureliaMassBudget,
  aureliaGeometry,
  aureliaAerodynamics,
  aureliaPropulsion,
} from "./aurelia/design";
import {
  stormbirdMassBudget,
  stormbirdGeometry,
  stormbirdAerodynamics,
  stormbirdPropulsion,
} from "./stormbird/design";
import { Matrix3, Vector3 } from "three";
import { heronMassBudget, heronGeometry, heronAerodynamics, heronPropulsion } from "./heron/design";
import heronStability from "./heron/aerodynamics.json";
import type { AircraftId } from "./aircraft";
import { f15cMassBudget, f15cGeometry, f15cAerodynamics, f15cPropulsion } from "./f15c/design";
import {
  calibratedMassBudget,
  fuelInstallation,
  tankFractions,
  tankState,
} from "../flight/fuel-loading";
const massBudgets: Record<AircraftId, MassComponent[]> = {
  f15c: f15cMassBudget,
  heron: heronMassBudget,
  finch: finchMassBudget,
  peregrine: peregrineMassBudget,
  aurelia: aureliaMassBudget,
  stormbird: stormbirdMassBudget,
};

export type Loading = {
  fuel: number;
  payload: number;
  tanks?: Record<string, number>;
};
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
  const fractions = tankFractions(parts, loading);
  const states = parts.map((p) =>
    p.fuelTank
      ? tankState(p.fuelTank, fractions[p.fuelTank.id])
      : { center: p.center, inertiaPerKg: p.inertiaPerKg },
  );
  const masses = parts.map(
    (p) =>
      p.mass *
      (p.fuelTank
        ? fractions[p.fuelTank.id]
        : p.category === "empty"
          ? 1
          : loading[p.category]),
  );
  const mass = masses.reduce((sum, m) => sum + m, 0);
  const cg = new Vector3();
  parts.forEach((p, i) =>
    cg.addScaledVector(
      new Vector3().fromArray(states[i].center),
      masses[i] / mass,
    ),
  );
  const inertia = new Matrix3().set(0, 0, 0, 0, 0, 0, 0, 0, 0);
  parts.forEach((p, i) => {
    const [w, h, l] = p.size,
      m = masses[i];
    const { x, y, z } = new Vector3().fromArray(states[i].center).sub(cg);
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
    const intrinsic = states[i].inertiaPerKg;
    contribution.forEach((value, j) => {
      // Replace cuboid self-inertia with measured settled-liquid inertia.
      if (intrinsic)
        value +=
          m * intrinsic[j] -
          (j === 0
            ? (m * (h * h + l * l)) / 12
            : j === 4
              ? (m * (w * w + l * l)) / 12
              : j === 8
                ? (m * (w * w + h * h)) / 12
                : 0);
      inertia.elements[j] += value;
    });
  });
  const fuelByTank = Object.fromEntries(
    parts
      .filter((p) => p.fuelTank)
      .map((p) => [p.fuelTank!.id, p.mass * fractions[p.fuelTank!.id]]),
  );
  return {
    mass,
    cg,
    inertia,
    inverseInertia: inertia.clone().invert(),
    fuelByTank,
    fuelKg: parts.reduce(
      (sum, p, i) => sum + (p.category === "fuel" ? masses[i] : 0),
      0,
    ),
    unusableFuelKg: parts.reduce(
      (sum, p) => sum + (p.trappedFuel ? p.mass : 0),
      0,
    ),
  };
}
const geometries = {
  f15c: f15cGeometry,
  heron: heronGeometry,
  finch: finchGeometry,
  peregrine: peregrineGeometry,
  aurelia: aureliaGeometry,
  stormbird: stormbirdGeometry,
};
const polars = {
  f15c: f15cAerodynamics,
  heron: heronAerodynamics,
  finch: finchAerodynamics,
  peregrine: peregrineAerodynamics,
  aurelia: aureliaAerodynamics,
  stormbird: stormbirdAerodynamics,
};
const propulsion = {
  f15c: f15cPropulsion,
  heron: heronPropulsion,
  finch: finchPropulsion,
  peregrine: peregrinePropulsion,
  aurelia: aureliaPropulsion,
  stormbird: stormbirdPropulsion,
};
function createAircraftDesign(id: AircraftId) {
  const geometry = geometries[id],
    referenceMassBudget = massBudgets[id],
    massBudget = calibratedMassBudget(id, referenceMassBudget);
  const fuel = fuelInstallation(id),
    defaultLoading = fuel.defaultLoading;
  const nominal = massProperties(massBudget, defaultLoading),
    reference = massProperties(referenceMassBudget);
  const staticMargin = id === "finch" ? 0.14 : id === "aurelia" ? 0.16 : 0.1;
  const neutralPointZ =
    id === "heron" ? heronStability.neutralPointZ :
    reference.cg.z + staticMargin * geometry.meanAerodynamicChord;
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
    reference,
    fuel,
    defaultLoading,
    maxTakeoffMass: fuel.maxTakeoffMass,
    aerodynamics: polars[id],
    propulsion: propulsion[id],
    neutralPointZ,
    trimSpeed:
      id === "f15c" ? 145 :
      id === "finch" || id === "heron"
        ? id === "heron" ? 65 : 34
        : id === "aurelia"
          ? 70
          : id === "peregrine"
            ? 80
            : 90,
    assistClimbPitch:
      id === "f15c" ? 0.62 :
      id === "finch" || id === "heron"
        ? id === "heron" ? 0.26 : 0.3
        : id === "aurelia"
          ? 0.65
          : id === "peregrine"
            ? 0.7
            : 0.85,
    moments: {
      pitchDamping: id === "f15c" ? -12.8 : id === "heron" ? heronStability.pitchDamping : id === "finch" ? -11.4 : -14,
      yawStability: id === "f15c" ? -0.21 : -0.16,
      yawDamping: id === "f15c" ? -0.78 : -0.65,
      dihedral: id === "f15c" ? 0.045 : 0.06,
      rollDamping: id === "f15c" ? -0.49 : -0.55,
      elevator: id === "f15c" ? 0.86 : id === "heron" ? heronStability.elevator : 1.05,
      aileron:
        id === "f15c" ? 0.16 :
        id === "peregrine" || id === "stormbird"
          ? 0.14
          : id === "aurelia"
            ? 0.08
            : 0.1,
      rudder: id === "f15c" ? 0.15 : 0.12,
    },
    cgEnvelope: [
      forwardCG - 0.02 * geometry.meanAerodynamicChord,
      neutralPointZ - 0.03 * geometry.meanAerodynamicChord,
    ],
    provenance: id === "f15c"
      ? "F-15C reference-scale CAD reconstruction; saved STEP wing sections with a declared centerline continuation. Attached-flow lift slope transferred from the private low-speed wing-only solver. Estimated dry mass allocations/inertia, internal equivalent fuel boxes, neutral point, whole-aircraft polar, control derivatives, twin-engine thrust map and fuel flow. Island subsonic cap; no supersonic CFD, production-airfoil, flight-test or certification claim."
      : id === "heron"
      ? "Original CAD utility turboprop based on Grand Caravan dimensions and shaft-power class. CAD planform, incidence, washout and fuel envelopes; private-lab attached-flow wing lift calibration and analytical tail stability. Estimated masses, whole-aircraft drag, stall limits, flap increments and turboprop altitude lapse; not flight-test calibrated."
      : "Measured main-wing and tank geometry, settled-liquid moments and internal equipment stations; estimated component masses, residual allowance, dry-component cuboid inertia, whole-aircraft coefficients and neutral point. Finch altitude power and military jet thrust/damping use explicitly transferred published references; civil engine map remains estimated. Subsonic conceptual model; not flight-test calibrated.",
  };
}
const designs = Object.fromEntries(
  (["finch", "peregrine", "aurelia", "stormbird", "heron", "f15c"] as const).map((id) => [
    id,
    createAircraftDesign(id),
  ]),
) as Record<AircraftId, ReturnType<typeof createAircraftDesign>>;
export function aircraftDesign(id: AircraftId) {
  return designs[id];
}
export type AircraftDesign = ReturnType<typeof aircraftDesign>;
