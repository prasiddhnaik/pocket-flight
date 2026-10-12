import type { AircraftId } from "../src/aircraft";
import stormbirdGeometry from "../src/stormbird-geometry.json";

export const aircraftCatalog = {
  finch: {
    name: "Finch U–2",
    asset: "finch-u2.glb",
    scale: 1,
    offsetY: 0,
    camber: 0.015,
    section:
      "Nominal authoring section: 1.5% sinusoidal camber. Thin-airfoil approximation; no measured polar.",
  },
  peregrine: {
    name: "Peregrine HX–27",
    asset: "peregrine-hx27.glb",
    scale: 0.7,
    offsetY: -2.3 * 0.7,
    camber: 0.015,
    section:
      "Nominal authoring section: 1.5% sinusoidal camber, checked in the adjacent editable build source. Thin-airfoil approximation; no measured polar. Separate leading-edge extensions excluded from this main-wing model.",
  },
  aurelia: {
    name: "Aurelia S32",
    asset: "aurelia-flight.glb",
    scale: 0.55,
    offsetY: -2.3 * 0.55,
    camber: 0,
    section:
      "Section camber is unverified. Symmetric-section zero-lift angle is an explicit default assumption. Vertical winglets are not resolved as separate lifting surfaces.",
  },
  stormbird: {
    name: "Stormbird HX–40",
    asset: "stormbird-hx40.gltf",
    scale: 1,
    offsetY: -stormbirdGeometry.centerOffsetY,
    camber: 0.004,
    section:
      "Nominal authoring section: 0.4% sinusoidal camber from the aircraft design sheet. Thin-airfoil approximation; no measured polar.",
  },
} satisfies Record<
  AircraftId,
  {
    name: string;
    asset: string;
    scale: number;
    offsetY: number;
    camber: number;
    section: string;
  }
>;

export type LabAircraftId = keyof typeof aircraftCatalog;

export function zeroLiftEstimate(camber: number) {
  let integral = 0;
  const n = 2048;
  for (let i = 0; i < n; i++) {
    const theta = (Math.PI * (i + 0.5)) / n,
      u = (1 - Math.cos(theta)) / 2;
    integral +=
      (camber * Math.PI * Math.cos(Math.PI * u) * (1 - Math.cos(theta))) / n;
  }
  return (integral * 180) / Math.PI;
}
