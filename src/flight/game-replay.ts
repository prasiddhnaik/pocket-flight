import * as T from "three";
import type { AircraftModel } from "../aircraft/aircraft";
import { initialJetInput } from "../aircraft/jet-effects";
import { applyJetReplay } from "../replay/replay-jet";
import { applyReplaySurfaces } from "../replay/replay-surfaces";
import type { makeWorld } from "../world/world";
import type { CombatRange } from "./combat/combat";
import type { CombatFrame } from "./combat/tape";
import type { DebrisField } from "./debris";
import type { FlightVfx } from "./flight-vfx";
import { poseReplayCamera } from "./game-camera";
import type { ReplayFrame } from "./game-types";
import type { MissionRings } from "./mission-rings";
import type { FlightPhysics } from "./physics";

export type ReplayCapture = {
  physics: FlightPhysics;
  aircraft: AircraftModel;
  worldTime: number;
  night: boolean;
  ring: number;
  debris: DebrisField;
  combat?: CombatFrame;
};

export function captureReplayFrame(c: ReplayCapture): ReplayFrame {
  const { physics: p, aircraft } = c;
  return {
    p: p.position.clone(),
    q: p.quaternion.clone(),
    t: p.flightTime,
    simulationTick: p.simulationTick,
    suspensionResolved: true,
    elevatorTrim: p.elevatorTrim,
    gearPosition: p.gearPosition,
    flapPosition: p.flapPosition,
    automaticConfiguration: p.automaticConfiguration,
    worldTime: c.worldTime,
    jet: aircraft.effects ? { ...aircraft.effects.motion } : undefined,
    throttle: p.throttle,
    speed: p.airspeed,
    suspension: p.suspension,
    gearDamage: p.damage.gear,
    propAngle: aircraft.propeller.rotation.z,
    propRpm: aircraft.propellerMotion.snapshot().rpm,
    surfaces: aircraft.surfaces.snapshot(),
    propVisible: aircraft.propeller.visible,
    gearVisible: aircraft.gear.visible,
    wings: aircraft.wings.map((w) => w.visible),
    engineOut: p.engineOut,
    night: c.night,
    ring: c.ring,
    debris: c.debris.capture(),
    ...(c.combat ? { combat: c.combat } : {}),
  };
}

export type ReplayVisuals = { aircraft: AircraftModel; rings: MissionRings; debris: DebrisField };

/** Restore the discrete visual state (gear, wings, rings, debris) recorded in a frame. */
export function applyReplayVisuals({ aircraft: a, rings, debris }: ReplayVisuals, frame: ReplayFrame) {
  if (a.effects) {
    applyJetReplay(a.effects.motion, frame.jet ?? {});
    a.effects.update(0, { ...initialJetInput(), lights: true });
  }
  a.gear.visible = frame.gearVisible;
  a.gear.rotation.z = 0;
  a.propeller.visible = frame.propVisible;
  a.propellerMotion.apply({ angle: frame.propAngle, rpm: frame.propRpm });
  a.wings.forEach((w, i) => (w.visible = frame.wings[i]));
  a.setSuspension(frame.suspension);
  a.surfaces.apply(frame.surfaces);
  a.setConfiguration(frame.flapPosition ?? 0);
  rings.rings.forEach((r, i) => (r.visible = i >= frame.ring));
  debris.apply(frame.debris);
}

export type ReplayPose = ReplayVisuals & {
  combat: CombatRange;
  camera: T.PerspectiveCamera;
  world: ReturnType<typeof makeWorld>;
  vfx: FlightVfx;
  vfxHeight: number;
  reducedMotion: boolean;
  clock: number;
  snapCamera: boolean;
};

/** Blend two recorded frames onto the aircraft, world and camera. Returns the frame used for discrete state. */
export function poseReplay(o: ReplayPose, a: ReplayFrame, b: ReplayFrame, mix: number) {
  const aircraft = o.aircraft;
  const lerp = (x: number, y: number) => T.MathUtils.lerp(x, y, mix);
  const visual = mix === 1 ? b : a;
  const model = aircraft.group;
  const suspension = lerp(a.suspension, b.suspension);
  model.scale.setScalar(1);
  model.position.lerpVectors(a.p, b.p, mix);
  model.quaternion.slerpQuaternions(a.q, b.q, mix);
  model.position.add(
    new T.Vector3(0, -aircraft.bodyCompression(suspension, a.suspensionResolved === true), 0)
      .applyQuaternion(model.quaternion),
  );
  applyReplayVisuals(o, visual);
  o.combat.poseReplay(lerp(a.t, b.t));
  if (aircraft.effects) {
    applyJetReplay(aircraft.effects.motion, a.jet ?? {}, b.jet ?? {}, mix);
    aircraft.effects.update(0, { ...initialJetInput(), lights: true });
  }
  aircraft.setSuspension(suspension);
  applyReplaySurfaces(aircraft, a, b, mix);
  aircraft.pilot?.update({
    pitch: lerp(a.surfaces.pitch, b.surfaces.pitch),
    roll: lerp(a.surfaces.roll, b.surfaces.roll),
    yaw: lerp(a.surfaces.yaw, b.surfaces.yaw),
    power: lerp(a.throttle, b.throttle),
  });
  aircraft.propellerMotion.apply({ angle: lerp(a.propAngle, b.propAngle), rpm: lerp(a.propRpm, b.propRpm) });
  const attitude = new T.Euler().setFromQuaternion(model.quaternion, "YXZ");
  aircraft.displays?.update(
    {
      time: lerp(a.t, b.t),
      mode: "replay",
      speed: lerp(a.speed, b.speed),
      altitude: lerp(a.p.y, b.p.y),
      pitch: attitude.x,
      roll: attitude.z,
      heading: -attitude.y,
      verticalSpeed: b.t > a.t ? (b.p.y - a.p.y) / (b.t - a.t) : 0,
      power: lerp(a.throttle, b.throttle),
      fuel: null,
      x: model.position.x,
      z: model.position.z,
      engineOut: visual.engineOut,
      stall: false,
    },
    // The orbiting replay camera stays ~30 m out; screens are unreadable there.
    o.camera.position.distanceTo(model.position) < 10,
    o.snapCamera,
  );
  o.world.update(lerp(a.worldTime, b.worldTime), visual.night);
  o.vfx.render(lerp(a.t, b.t), o.vfxHeight, o.reducedMotion, o.camera.aspect);
  poseReplayCamera(o.camera, aircraft, o.clock, o.snapCamera);
  return visual;
}
