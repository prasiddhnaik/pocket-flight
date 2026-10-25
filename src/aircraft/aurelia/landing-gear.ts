import { Vector3 } from "three";
import { AURELIA_MAIN_GEAR } from "./aurelia-motion";

export const aureliaWheels = [
  // Twin nose wheels and single inboard-folding mains, matching the rendered rig.
  ...[-0.2, 0.2].map((x) => ({
    center: new Vector3(x * 0.55, (0.37 - 2.3) * 0.55, -10.65 * 0.55),
    major: 0.37 * 0.73 * 0.55,
    minor: 0.37 * 0.27 * 0.55,
  })),
  ...[-1, 1].map((side) => ({
    center: new Vector3(
      side * AURELIA_MAIN_GEAR.x * 0.55,
      (AURELIA_MAIN_GEAR.contactY - 2.3) * 0.55,
      AURELIA_MAIN_GEAR.z * 0.55,
    ),
    major: 0.51 * 0.73 * 0.55,
    minor: 0.51 * 0.27 * 0.55,
  })),
];
