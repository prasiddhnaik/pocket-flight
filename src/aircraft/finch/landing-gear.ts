import { Vector3 } from "three";

// Finch GLB axle positions and tire torus dimensions, in aircraft coordinates.
export const finchWheels = [
  { center: new Vector3(-1.22, -1.09, 0.55), major: 0.212, minor: 0.065 },
  { center: new Vector3(1.22, -1.09, 0.55), major: 0.212, minor: 0.065 },
  { center: new Vector3(0, -1.12, -2.12), major: 0.177, minor: 0.055 },
];
