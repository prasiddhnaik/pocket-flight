import { MathUtils, Object3D, Vector3 } from "three";
import type { SurfacePose } from "../finch/control-surfaces";
import { f15cGear, f15cGearState } from "./landing-gear";

import { F15CPowerplantRig } from "./powerplant-rig";

type Parts = Map<string, Object3D>;
export function f15cParts(root: Object3D): Parts {
  const parts: Parts = new Map();
  root.traverse((node) => parts.set(node.name, node));
  return parts;
}
function turn(parts: Parts, name: string, degrees: number, fallback: number[]) {
  const node = parts.get(name);
  if (!node) return;
  const axis = node.userData.hinge_axis;
  node.quaternion.setFromAxisAngle(
    new Vector3().fromArray(Array.isArray(axis) ? axis : fallback).normalize(),
    MathUtils.degToRad(degrees),
  );
}
export function poseF15CControls(parts: Parts, pose: SurfacePose, flaps = 0) {
  const roll = MathUtils.clamp(pose.roll, -1, 1);
  const pitch = MathUtils.clamp(pose.pitch, -1, 1);
  const yaw = MathUtils.clamp(pose.yaw, -1, 1);
  for (const [side, sign] of [
    ["Left", -1],
    ["Right", 1],
  ] as const) {
    // Use the exported axis sign: canonical +X and mirrored outward datums
    // both produce the same physical trailing-edge directions.
    const aileron = parts.get(`Aileron_${side}`);
    const flap = parts.get(`Flap_${side}`);
    const axisSign = (node: Object3D | undefined) =>
      Math.sign(node?.userData.hinge_axis?.[0] ?? sign) || sign;
    turn(parts, `Aileron_${side}`, -sign * axisSign(aileron) * roll * 20, [
      sign,
      0,
      0,
    ]);
    turn(
      parts,
      `Flap_${side}`,
      axisSign(flap) * MathUtils.clamp(flaps, 0, 1) * 25,
      [sign, 0, 0],
    );
    turn(parts, `Stabilator_${side}`, -pitch * 20, [1, 0, 0]);
    turn(parts, `Stabilator_shaft_${side}`, -pitch * 20, [1, 0, 0]);
    turn(parts, `Rudder_${side}`, yaw * 25, [0, 1, 0]);
  }
}
export function f15cControlSurfaces(parts: Parts) {
  const pose: SurfacePose = { roll: 0, pitch: 0, yaw: 0 };
  let flaps = 0;
  const apply = (next: SurfacePose) => {
    for (const key of ["roll", "pitch", "yaw"] as const)
      pose[key] = MathUtils.clamp(next[key], -1, 1);
    poseF15CControls(parts, pose, flaps);
  };
  return {
    snapshot: (): SurfacePose => ({ ...pose }),
    apply,
    reset: () => apply({ roll: 0, pitch: 0, yaw: 0 }),
    setFlaps(value: number) {
      flaps = MathUtils.clamp(value, 0, 1);
      apply(pose);
    },
    update(input: SurfacePose, dt: number) {
      apply({
        roll: MathUtils.damp(pose.roll, input.roll, 12, dt),
        pitch: MathUtils.damp(pose.pitch, input.pitch, 12, dt),
        yaw: MathUtils.damp(pose.yaw, input.yaw, 12, dt),
      });
    },
  };
}
export type F15CMechanismPose = SurfacePose & {
  gear: number;
  flaps: number;
  canopy: number;
  speedBrake: number;
  power?: number;
  burner?: number;
  gunAngle?: number;
};
export class F15CMechanisms {
  readonly parts: Parts;
  readonly powerplant: F15CPowerplantRig;
  constructor(root: Object3D) {
    this.parts = f15cParts(root);
    this.powerplant = new F15CPowerplantRig(root);
  }
  apply(pose: F15CMechanismPose) {
    this.powerplant.apply(pose.power ?? 0, pose.burner ?? MathUtils.smoothstep(pose.power ?? 0, .88, 1), pose.gunAngle ?? 0);
    poseF15CControls(this.parts, pose, pose.flaps);
    const state = f15cGearState(pose.gear);
    for (const leg of f15cGear)
      turn(this.parts, leg.name, leg.travel * state.leg, leg.axis);
    for (const [name, node] of this.parts) {
      if (!/^Door_(Nose|Left|Right)_(Forward|Aft|Inner)$/.test(name)) continue;
      const travel: unknown = node.userData.travel_degrees;
      const open = Array.isArray(travel)
        ? travel
            .filter(
              (angle): angle is number =>
                typeof angle === "number" && Number.isFinite(angle),
            )
            .reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0)
        : name.startsWith("Door_Right")
          ? -100
          : 100;
      turn(
        this.parts,
        name,
        open * (name.endsWith("_Aft") ? state.aftDoor : state.forwardDoor),
        [0, 0, -1],
      );
    }
    turn(
      this.parts,
      "Canopy",
      55 * MathUtils.clamp(pose.canopy, 0, 1),
      [1, 0, 0],
    );
    turn(
      this.parts,
      "Airbrake",
      -55 * MathUtils.clamp(pose.speedBrake, 0, 1),
      [1, 0, 0],
    );
  }
  getMovingRoots() {
    return [...this.powerplant.movingRoots, ...[...this.parts.values()].filter((node) =>
      /^(?:(?:Aileron|Flap|Stabilator|Stabilator_shaft|Rudder|Gear|Wheel)_(?:Left|Right|Nose)|Door_(?:Left|Right|Nose)_(?:Forward|Aft|Inner)|Canopy|Airbrake)$/.test(
        node.name,
      ),
    )];
  }
}
