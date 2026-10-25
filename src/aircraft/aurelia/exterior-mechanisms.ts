import * as T from "three";
import { aureliaInteriorLayout } from "./exterior-reference";
import { poseAureliaCockpitDoor } from "./cockpit-partition";

export type ExteriorPose = {
  gear: number;
  flaps: number;
  roll: number;
  pitch: number;
  yaw: number;
  steering: number;
  fan: number;
  entry: number;
  cockpitDoor: number;
};
export const neutralExteriorPose = (): ExteriorPose => ({
  gear: 1,
  flaps: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
  steering: 0,
  fan: 0,
  entry: 0,
  cockpitDoor: 0,
});
const ramp = (value: number, start: number, end: number) => {
  const t = T.MathUtils.clamp((value - start) / (end - start), 0, 1);
  return t * t * (3 - 2 * t);
};

/** Absolute poses make reverse scrubbing and reset independent of playback history. */
export function poseAureliaExterior(root: T.Object3D, pose: ExteriorPose) {
  const gear = T.MathUtils.clamp(pose.gear, 0, 1),
    retract = 1 - gear;
  const fold = ramp(retract, 0.18, 0.8);
  const doors = ramp(retract, 0.01, 0.16) * (1 - ramp(retract, 0.84, 1));
  function turn(name: string, axis: T.Vector3, angle: number) {
    const o = root.getObjectByName(name);
    if (!o) throw new Error(`Aurelia exterior mechanism missing: ${name}`);
    o.quaternion.setFromAxisAngle(axis, angle);
  }
  function control(name: string, angle: number) {
    const o = root.getObjectByName(name);
    if (!o) throw new Error(`Aurelia exterior surface missing: ${name}`);
    const axis = new T.Vector3()
      .fromArray(o.userData.hingeAxis as number[])
      .normalize();
    turn(name, axis, angle);
  }
  const x = new T.Vector3(1, 0, 0),
    y = new T.Vector3(0, 1, 0),
    z = new T.Vector3(0, 0, 1);
  for (const side of [-1, 1]) {
    const label = side < 0 ? "Left" : "Right";
    turn(
      `Main_gear_${label}_retraction_hinge`,
      z,
      (-side * fold * Math.PI) / 2,
    );
    turn(`Main_door_hinge_${label}`, z, -side * doors * 2.0);
    turn(
      `Main_outer_door_hinge_${label}`,
      z,
      side * (1 - ramp(retract, 0.84, 1)) * 2.0,
    );
    turn(
      `Nose_door_hinge_${side}`,
      z,
      side * (1 - ramp(retract, 0.84, 1)) * 1.65,
    );
    control(`Flap_${label}`, T.MathUtils.clamp(pose.flaps, 0, 1) * 0.61);
    const flap = root.getObjectByName(`Flap_${label}`)!;
    flap.position.fromArray(flap.userData.restPosition as number[]);
    // Reconstructed slotted aft travel, followed by down deflection. The exact
    // manufacturer's track geometry and scheduling are not publicly established.
    flap.position.z += T.MathUtils.clamp(pose.flaps, 0, 1) * 0.18;
    flap.position.y -= T.MathUtils.clamp(pose.flaps, 0, 1) * 0.045;
    for (let i = 0; i < 2; i++) {
      const carriage = root.getObjectByName(`Flap_carriage_${label}_${i}`);
      if (!carriage)
        throw new Error(`Aurelia flap carriage missing: ${label} ${i}`);
      carriage.position.fromArray(carriage.userData.restPosition as number[]);
      carriage.position.z += T.MathUtils.clamp(pose.flaps, 0, 1) * 0.18;
      carriage.position.y -= T.MathUtils.clamp(pose.flaps, 0, 1) * 0.045;
    }

    control(
      `Aileron_${label}`,
      -side * T.MathUtils.clamp(pose.roll, -1, 1) * 0.35,
    );
    control(`Elevator_${label}`, -T.MathUtils.clamp(pose.pitch, -1, 1) * 0.38);
    turn(`Fan_${label}`, z, pose.fan);
  }
  turn("Nose_gear_retraction_hinge", x, (fold * Math.PI) / 2);
  turn(
    "Nose_steering",
    y,
    T.MathUtils.clamp(pose.steering, -1, 1) * 0.55 * ramp(gear, 0.8, 1),
  );
  control("Rudder", T.MathUtils.clamp(pose.yaw, -1, 1) * 0.45);
  turn(
    "Passenger_entry_hinge",
    z,
    T.MathUtils.clamp(pose.entry, 0, 1) *
      aureliaInteriorLayout.entryAngle *
      ramp(gear, 0.98, 1),
  );
  // Exterior-only assemblies deliberately have no interior privacy door.
  poseAureliaCockpitDoor(root, pose.cockpitDoor ?? 0);
  root.updateMatrixWorld(true);
}
