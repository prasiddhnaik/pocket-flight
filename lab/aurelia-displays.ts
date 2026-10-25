import * as T from "three";
import { AureliaAvionics } from "../src/aircraft/aurelia/avionics";
import { aureliaAvionicsDemo } from "../src/aircraft/aurelia/avionics-demo";
import type {
  CockpitDisplays,
  DisplayTelemetry,
} from "../src/aircraft/cockpit-displays";
import type { MechanismPose } from "./mechanics";

export type LabDisplays = {
  update(
    state: DisplayTelemetry,
    focused?: boolean,
    force?: boolean,
    pose?: MechanismPose,
  ): boolean;
  diagnostics(): unknown;
  viewTarget: CockpitDisplays["viewTarget"];
  dispose(): void;
};

/** Illuminate the reference model's mounted faces instead of adding legacy screens. */
export class AureliaLabDisplays implements LabDisplays {
  private avionics: AureliaAvionics;
  constructor(root: T.Object3D) {
    this.avionics = new AureliaAvionics(
      root,
      aureliaAvionicsDemo(0, { gear: 1, flaps: 0 }),
    );
  }
  update(
    state: DisplayTelemetry,
    focused = true,
    force = false,
    pose?: MechanismPose,
  ) {
    const demo = aureliaAvionicsDemo(state.time, pose ?? { gear: 1, flaps: 0 });
    return this.avionics.update(
      {
        ...demo,
        speedKt: state.speed / (1852 / 3600),
        groundSpeedKt:
          state.mode === "tunnel" ? 0 : state.speed / (1852 / 3600),
        altitudeFt: state.altitude / 0.3048,
        verticalSpeedFpm: (state.verticalSpeed * 60) / 0.3048,
        pitch: state.pitch,
        roll: state.roll,
        headingDeg: ((((-state.heading * 180) / Math.PI) % 360) + 360) % 360,
        guidance: {
          ...demo.guidance,
          verticalMode: "LAB",
          lateralMode: "DEMO",
          autopilot: false,
          directorPitchRad: state.pitch,
          directorRollRad: state.roll,
        },
        navigation: {
          ...demo.navigation,
          position: { x: state.x, z: state.z },
          route: [],
          runways: [],
          terrain: [],
        },
      },
      force,
      focused,
    );
  }
  viewTarget(root: T.Object3D) {
    root.updateWorldMatrix(true, true);
    const bounds = new T.Box3();
    root.traverse((node) => {
      if (node instanceof T.Mesh && node.name.startsWith("Inactive_screen"))
        bounds.union(new T.Box3().setFromObject(node));
    });
    const rotation = root.getWorldQuaternion(new T.Quaternion());
    return {
      center: bounds.getCenter(new T.Vector3()),
      width: bounds.getSize(new T.Vector3()).x,
      forward: new T.Vector3(0, 0, 1).applyQuaternion(rotation),
      up: new T.Vector3(0, 1, 0).applyQuaternion(rotation),
    };
  }
  diagnostics() {
    return { ...this.avionics.snapshot(), ready: true, mounted: true };
  }
  dispose() {
    this.avionics.dispose();
  }
}
