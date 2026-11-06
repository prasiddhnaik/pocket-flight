import * as T from "three";
import type { JetMotion } from "../jet-effects";

// Saved Phenom-based export: native metres, including its authored 1.155 root scale.
// Keep the previous flight datum so replay positions and ground starts remain compatible.
export const aureliaFlightOffsetY = -1.265;
export const aureliaPilotEye = [
  -0.40425,
  2.7241875 + aureliaFlightOffsetY,
  -6.0425172858,
] as const;
export const aureliaTires = [
  {
    name: "Nose_wheel",
    center: [0, 0.26565, -6.8363672858],
    pivot: [0, 1.565025, -6.3166172858],
    radius: 0.26565,
    halfWidth: 0.08085,
  },
  {
    name: "Main_wheel_Left",
    center: [-2.079, 0.3465, 0.9471],
    pivot: [-2.079, 1.3629, 0.9471],
    radius: 0.3465,
    halfWidth: 0.109725,
  },
  {
    name: "Main_wheel_Right",
    center: [2.079, 0.3465, 0.9471],
    pivot: [2.079, 1.3629, 0.9471],
    radius: 0.3465,
    halfWidth: 0.109725,
  },
];

export function aureliaReferenceWheelPose(index: number, extension: number) {
  const tire = aureliaTires[index];
  const fold = T.MathUtils.smoothstep(1 - extension, 0.18, 0.8);
  const nose = index === 0;
  const rotation = new T.Quaternion().setFromAxisAngle(
    new T.Vector3(nose ? 1 : 0, 0, nose ? 0 : 1),
    ((nose ? 1 : -Math.sign(tire.center[0])) * fold * Math.PI) / 2,
  );
  const pivot = new T.Vector3().fromArray(tire.pivot);
  const center = new T.Vector3()
    .fromArray(tire.center)
    .sub(pivot)
    .applyQuaternion(rotation)
    .add(pivot);
  center.y += aureliaFlightOffsetY;
  return {
    center,
    axle: new T.Vector3(1, 0, 0).applyQuaternion(rotation),
    radius: tire.radius,
  };
}

/** Cache authored pivots once; frame updates never search the complete interior hierarchy. */
export function bindAureliaFlightControls(root: T.Object3D) {
  const parts = new Map<string, T.Object3D>();
  root.traverse((node) => parts.set(node.name, node));
  const turn = (name: string, angle: number) => {
    const part = parts.get(name)!;
    const axis = new T.Vector3().fromArray(part.userData.hingeAxis).normalize();
    part.quaternion.setFromAxisAngle(axis, angle);
  };
  return (
    s: Pick<JetMotion, "roll" | "pitch" | "yaw" | "flaps"> & {
      fanPhase: number;
      gear?: number;
      gearSteering?: number;
      wheelDistance?: number;
    },
  ) => {
    for (const side of [-1, 1]) {
      const label = side < 0 ? "Left" : "Right";
      turn(`Aileron_${label}`, -side * s.roll * 0.35);
      turn(`Elevator_${label}`, -s.pitch * 0.38);
      turn(`Flap_${label}`, s.flaps * 0.61);
      for (const name of [
        `Flap_${label}`,
        `Flap_carriage_${label}_0`,
        `Flap_carriage_${label}_1`,
      ]) {
        const part = parts.get(name)!;
        part.position.fromArray(part.userData.restPosition);
        part.position.z += s.flaps * 0.18;
        part.position.y -= s.flaps * 0.045;
      }
      parts.get(`Fan_${label}`)!.rotation.z = s.fanPhase;
    }
    turn("Rudder", s.yaw * 0.45);
    parts.get("Nose_steering")!.rotation.y =
      (s.gearSteering ?? 0) *
      0.55 *
      T.MathUtils.smoothstep(s.gear ?? 1, 0.8, 1);
    aureliaTires.forEach((tire) => {
      parts.get(tire.name)!.rotation.x = -(s.wheelDistance ?? 0) / tire.radius;
    });
  };
}
