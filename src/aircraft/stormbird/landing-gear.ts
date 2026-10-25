import { Vector3 } from "three";
import stormbirdGeometry from "./stormbird-geometry.json";

// CAD ground datum is Y=0; the flight model is centered two metres above it.
export const stormbirdWheels = [
  ...stormbirdGeometry.wheels.map((wheel) => ({
    center: new Vector3()
      .fromArray(wheel.center)
      .add(new Vector3(0, -stormbirdGeometry.centerOffsetY, 0)),
    major: wheel.radius,
    minor: 0,
  })),
];
