import * as T from "three";
import type { AircraftModel } from "../aircraft/aircraft";
import { STORMBIRD_PILOT_EYE } from "../aircraft/stormbird/stormbird-config";
import { aureliaPilotEye } from "../aircraft/aurelia/flight-model";
import { pilotSeats } from "../aircraft/pilot";
import { terrainHeight } from "../world/terrain";
import type { FlightPhysics } from "./physics";
import type { CameraMode } from "./game-types";

const X = new T.Vector3(1, 0, 0);
const Y = new T.Vector3(0, 1, 0);

/** The menu camera drifts over the bay; the aircraft floats in the frame. */
export function poseMenuCamera(
  camera: T.PerspectiveCamera,
  aircraft: AircraftModel,
  time: number,
  dt: number,
) {
  const model = aircraft.group;
  camera.fov = T.MathUtils.damp(camera.fov, 48, 2, dt);
  const pos = new T.Vector3(-740 + Math.sin(time * 0.023) * 75, 480, 1100);
  camera.position.lerp(pos, 1 - Math.exp(-dt * 2));
  camera.lookAt(-20, 50, -120);
  const forward = camera.getWorldDirection(new T.Vector3());
  const right = new T.Vector3(1, 0, 0).applyQuaternion(camera.quaternion);
  const up = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion);
  const portrait = camera.aspect < 1;
  model.position
    .copy(camera.position)
    .addScaledVector(forward, 82)
    .addScaledVector(right, portrait ? 4 : 21)
    .addScaledVector(up, portrait ? -11 : 1);
  model.scale.setScalar((portrait ? 1.65 : 3.8) / aircraft.cameraScale);
  model.rotation.set(
    0.065 + Math.sin(time * 0.6) * 0.015,
    -0.32,
    -0.12 + Math.sin(time * 0.45) * 0.035,
  );
  model.visible = true;
}

export function cockpitEye(aircraft: AircraftModel, jet: boolean) {
  if (aircraft.cockpit) return new T.Vector3(...aircraft.cockpit.eye);
  if (aircraft.id === "stormbird") return new T.Vector3().fromArray(STORMBIRD_PILOT_EYE);
  if (aircraft.id === "heron") return new T.Vector3(...pilotSeats.heron.eye);
  if (aircraft.id === "aurelia") return new T.Vector3().fromArray(aureliaPilotEye);
  return jet ? new T.Vector3(0, 1.855, -6.68) : new T.Vector3(...pilotSeats.finch.eye);
}

export type FlightCameraInput = {
  camera: T.PerspectiveCamera;
  aircraft: AircraftModel;
  physics: FlightPhysics;
  mode: CameraMode;
  playing: boolean;
  /** Interpolated aircraft pose for this frame. */
  position: T.Vector3;
  quaternion: T.Quaternion;
  orbit: { x: number; y: number };
  dragging: boolean;
  zoom: boolean;
  time: number;
  dt: number;
};

/** Cockpit, chase, landing and cinematic views during live flight. */
export function poseFlightCamera(o: FlightCameraInput) {
  const { camera, aircraft, physics: p, position, quaternion, orbit, dt } = o;
  if (o.mode === "cockpit") {
    camera.position.copy(position).add(cockpitEye(aircraft, p.jet).applyQuaternion(quaternion));
    camera.quaternion.copy(quaternion);
    camera.rotateY(orbit.x);
    // Detailed cockpits rest the view a little low so the panel stays in frame.
    camera.rotateX(-orbit.y - (aircraft.cockpit?.lookDown ?? 0));
    // Hold Z to lean in and read the instruments.
    camera.fov = T.MathUtils.damp(camera.fov, o.zoom ? 30 : 68, 9, dt);
    return;
  }
  const offset = new T.Vector3(0, 4.5, 22 + Math.min(6, p.airspeed * 0.075));
  if (o.mode === "landing") offset.set(17, 5, 20);
  if (o.mode === "cinematic")
    offset.set(Math.sin(o.time * 0.14) * 23, 9, Math.cos(o.time * 0.14) * 25);
  offset
    .multiplyScalar(aircraft.cameraScale)
    .applyAxisAngle(X, orbit.y)
    .applyAxisAngle(Y, p.yaw + orbit.x);
  const goal = position.clone().add(offset);
  goal.y = Math.max(goal.y, Math.max(0, terrainHeight(goal.x, goal.z)) + 3);
  camera.position.lerp(goal, 1 - Math.exp(-dt * (o.playing ? (p.jet ? 9 : 4) : 2)));
  // Follow position smoothly, but keep the aircraft centred while banking
  // or catching up after a turn. Looking ahead made it drift off-screen.
  camera.lookAt(aircraft.group.position);
  camera.fov = T.MathUtils.damp(camera.fov, 50 + Math.min(8, p.airspeed * 0.065), 2, dt);
  if (!o.dragging) {
    orbit.x = T.MathUtils.damp(orbit.x, 0, 2, dt);
    orbit.y = T.MathUtils.damp(orbit.y, 0, 2, dt);
  }
  camera.rotateZ(Math.sin(o.time * 12) * p.lastImpact * 0.008);
}

/** The replay camera circles the aircraft slowly, staying above the ground. */
export function poseReplayCamera(
  camera: T.PerspectiveCamera,
  aircraft: AircraftModel,
  clock: number,
  snap: boolean,
) {
  const model = aircraft.group;
  const angle = clock * 0.1;
  const heading = new T.Euler().setFromQuaternion(model.quaternion, "YXZ").y;
  const offset = new T.Vector3(Math.sin(angle) * 26 + 17, 8, Math.cos(angle) * 29)
    .applyAxisAngle(Y, heading)
    .multiplyScalar(aircraft.cameraScale);
  const goal = model.position.clone().add(offset);
  goal.y = Math.max(goal.y, terrainHeight(goal.x, goal.z) + 3);
  if (snap) camera.position.copy(goal);
  else camera.position.lerp(goal, 0.12);
  camera.fov = 50;
  camera.lookAt(model.position);
}
