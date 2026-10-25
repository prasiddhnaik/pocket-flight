import { Vector3 } from "three";

// Same scale and centre offset as the flight GLB; six individual tire contacts.
export const peregrineWheels = [
  ...[-0.24, 0.24].map((x) => ({
    center: new Vector3(x * 0.7, (0.42 - 2.3) * 0.7, -7.05 * 0.7),
    major: 0.42 * 0.73 * 0.7,
    minor: 0.42 * 0.27 * 0.7,
  })),
  ...[-2.39, -1.71, 1.71, 2.39].map((x) => ({
    center: new Vector3(x * 0.7, (0.62 - 2.3) * 0.7, 2.45 * 0.7),
    major: 0.62 * 0.73 * 0.7,
    minor: 0.62 * 0.27 * 0.7,
  })),
];
