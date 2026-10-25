import { Vector3 } from "three";

// Authored CAD axle centers; the tires remain extended in every flight mode.
export const heronWheels = [
  { center: new Vector3(-1.62, -1.62, 0.75), major: 0.3, minor: 0.13 },
  { center: new Vector3(1.62, -1.62, 0.75), major: 0.3, minor: 0.13 },
  { center: new Vector3(0, -1.71, -2.7), major: 0.215, minor: 0.125 },
];
