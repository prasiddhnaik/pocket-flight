/** Exterior reconstruction reference. Dimensions are from the cited manufacturer brochure. */
export const aureliaExteriorReference = {
  aircraft: "Embraer Phenom 300E",
  revision: 1,
  source:
    "https://www.embraer.com/media/rboe5b55/brochure-phenom-300e-18-fb-eletronic.pdf",
  pages: [5, 6, 10],
  length: 15.91,
  span: 15.64,
  height: 5.1,
  tailSpan: 5.97,
  cabinWindowsPerSide: 6,
  wheelCount: 3,
  evidence:
    "Overall dimensions transcribed from the manufacturer's three-view on PDF page 10. Surface stations, airfoil sections, gear stations, hinge angles and timing are visual reconstructions, not manufacturer engineering drawings. The 15.64 m span is the dimension printed in this brochure; conflicting secondary span figures are not silently mixed into this build.",
} as const;

/** User-selected variant: the previous 105% airframe enlarged another 10%. */
export const aureliaAirframeScale = 1.155;

export const exteriorGear = {
  mainPivot: [1.8, 1.18, 0.82],
  mainWheel: [1.8, 0.3, 0.82],
  mainRadius: 0.3,
  mainWidth: 0.19,
  nosePivot: [0, 1.3, -4.8],
  noseWheel: [0, 0.23, -5.25],
  noseRadius: 0.23,
  noseWidth: 0.14,
} as const;

/** One finished walking-floor datum for flight deck, entry and cabin. */
export const aureliaInteriorLayout = {
  floorY: 1.4625,
  floorThickness: 0.025,
  cabinHeight: 1.5,
  stairCount: 4,
  stairRun: 0.18,
  entryAngle: 2.52,
} as const;

type Station = readonly [number, number, number, number];
export const aureliaHullStations: Station[] = [
  [-7.955, 0.004, 0.006, 1.58],
  [-7.6, 0.15, 0.14, 1.61],
  [-7.0, 0.36, 0.28, 1.68],
  [-6.3, 0.57, 0.45, 1.81],
  [-5.5, 0.73, 0.68, 1.98],
  [-4.5, 0.86, 0.87, 2.08],
  [-3.5, 0.9, 0.94, 2.08],
  [1.8, 0.9, 0.94, 2.08],
  [3.2, 0.82, 0.88, 2.12],
  [4.4, 0.65, 0.73, 2.19],
  [5.6, 0.43, 0.53, 2.27],
  [6.8, 0.2, 0.28, 2.32],
  [7.955, 0.004, 0.006, 2.35],
];
export function aureliaBodyAt(z: number) {
  let i = 0;
  while (
    i < aureliaHullStations.length - 2 &&
    z > aureliaHullStations[i + 1][0]
  )
    i++;
  const a = aureliaHullStations[i],
    b = aureliaHullStations[i + 1],
    t = Math.max(0, Math.min(1, (z - a[0]) / (b[0] - a[0])));
  const interpolate = (key: 1 | 2 | 3) => {
    const slope = (j: number) => {
      const before = aureliaHullStations[Math.max(0, j - 1)],
        at = aureliaHullStations[j],
        after =
          aureliaHullStations[Math.min(aureliaHullStations.length - 1, j + 1)];
      const left = j
        ? (at[key] - before[key]) / (at[0] - before[0])
        : (after[key] - at[key]) / (after[0] - at[0]);
      const right =
        j < aureliaHullStations.length - 1
          ? (after[key] - at[key]) / (after[0] - at[0])
          : left;
      return left * right <= 0 ? 0 : (2 * left * right) / (left + right);
    };
    const h = b[0] - a[0];
    return (
      (2 * t ** 3 - 3 * t ** 2 + 1) * a[key] +
      (t ** 3 - 2 * t ** 2 + t) * h * slope(i) +
      (-2 * t ** 3 + 3 * t ** 2) * b[key] +
      (t ** 3 - t ** 2) * h * slope(i + 1)
    );
  };
  return [interpolate(1), interpolate(2), interpolate(3)] as const;
}

export function aureliaFloorHalfWidth(z: number) {
  const [rx, ry, cy] = aureliaBodyAt(z);
  const bottom =
    aureliaInteriorLayout.floorY - aureliaInteriorLayout.floorThickness;
  return Math.min(
    0.66,
    rx * Math.sqrt(Math.max(0, 1 - ((bottom - cy) / ry) ** 2)) - 0.035,
  );
}
