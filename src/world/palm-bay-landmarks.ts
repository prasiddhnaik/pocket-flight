// Palm Bay's landmark buildings. Each model comes from scripts/build-palm-bay-buildings.py.
export type Landmark = {
  asset: string;
  x: number;
  z: number;
  /** Turn about the vertical, in radians. */
  angle?: number;
  /** Reach of the walls from the model's origin, for checking the ground under them. */
  reach: number;
  /** Collision: top height above the footing, and circles along the building as [x, z, radius]. */
  height?: number;
  circles?: [number, number, number][];
  tint?: string;
};

/** Relative to each airfield's runway centre. Every airfield gets a tower. */
export const AIRFIELD_TOWER: Landmark = {
  asset: "airfield-tower",
  x: 42,
  z: -25,
  reach: 8,
  height: 15,
  circles: [[42, -25, 7.5]],
};
/** Relative to Palm Bay's runway centre. The tower stands north of them. */
export const PALM_BAY_AIRFIELD: Landmark[] = [
  {
    asset: "airfield-terminal",
    x: 70,
    z: -8,
    reach: 14,
    height: 7.5,
    circles: [[68, -17, 8], [68, -8, 8], [68, 1, 8]],
  },
  { asset: "airfield-fuel", x: 70, z: 116, reach: 7.5, height: 3.8, circles: [[70, 116, 7]] },
];
/** World positions. The church and store face the cottages to their west. */
export const PALM_BAY_VILLAGE: Landmark[] = [
  { asset: "village-church", x: -268, z: 520, reach: 11, height: 12, circles: [[-268, 520, 9]] },
  { asset: "village-store", x: -277, z: 563, reach: 8, height: 6.5, circles: [[-277, 563, 7]] },
  { asset: "village-water-tower", x: -276, z: 606, reach: 3.5, height: 16, circles: [[-276, 606, 3.5]] },
];
/** Pier centres: each runs 37.5 m north onto the sand and 37.5 m south over the water. */
export const MARINA_PIERS: [number, number][] = [[-465, 640], [-485, 635], [-505, 627]];
/** World positions. The boats lie between the piers, and the boathouse doors face the water. */
export const PALM_BAY_MARINA: Landmark[] = [
  { asset: "marina-boathouse", x: -452, z: 596, angle: Math.PI, reach: 8, height: 5.8, circles: [[-452, 596, 8.5]] },
  { asset: "marina-boat", x: -475, z: 652, angle: 0.06, reach: 4, tint: "#ffffff" },
  { asset: "marina-boat", x: -475, z: 668, angle: 3.2, reach: 4, tint: "#e8d7b0" },
  { asset: "marina-boat", x: -495, z: 648, angle: -0.05, reach: 4, tint: "#bcd6db" },
  { asset: "marina-boat", x: -495, z: 662, angle: 3.1, reach: 4, tint: "#ffffff" },
  { asset: "marina-boat", x: -516, z: 650, angle: 0.1, reach: 4, tint: "#f0c4a4" },
];
