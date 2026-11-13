import * as T from "three";
import type { AircraftId, AircraftModel } from "../aircraft/aircraft";
import type { FlightAudio } from "../audio/audio";
import { runways } from "../world/terrain";
import { ISLAND_FLIGHT_MODEL } from "./flight-envelope";
import type { FlightVfx } from "./flight-vfx";
import type { GameMode, Snapshot } from "./game-types";
import type { Mission } from "./missions";
import type { FlightPhysics } from "./physics";

/** The next checkpoint, else a point just past the destination runway threshold. */
export function routeTarget(mission: Mission, ringIndex: number): T.Vector3 | null {
  const ring = mission.rings[ringIndex];
  if (ring) return ring;
  const runway = mission.land && runways.find((r) => r.name === mission.land);
  return runway ? new T.Vector3(runway.x, runway.y + 4, runway.z + runway.length * 0.3) : null;
}

/** Where the target marker sits on screen, clamped to the HUD safe area. */
export function screenTarget(
  point: T.Vector3 | null,
  camera: T.PerspectiveCamera,
  from: T.Vector3,
): Snapshot["target"] {
  if (!point) return null;
  const screen = point.clone().project(camera);
  const front =
    point.clone().sub(camera.position).dot(camera.getWorldDirection(new T.Vector3())) > 0;
  return {
    x: T.MathUtils.clamp(screen.x, -0.86, 0.86),
    y: T.MathUtils.clamp(screen.y, -0.63, 0.63),
    distance: from.distanceTo(point),
    visible: front && Math.abs(screen.x) < 0.94 && Math.abs(screen.y) < 0.8,
  };
}

export type ObjectiveInput = {
  mode: GameMode;
  mission: Mission;
  ringIndex: number;
  airborne: boolean;
  physics: FlightPhysics;
  hasGun: boolean;
};

export function objectiveText(o: ObjectiveInput) {
  const { mission, physics: p } = o;
  if (o.mode === "menu") return "A little escape awaits.";
  if (mission.id === "free") return "The islands are yours. Go explore.";
  if (mission.id === "combat")
    return `Weapons sandbox ·${o.hasGun ? " J gun ·" : ""} K rocket · L missile · land to rearm`;
  if (!o.airborne)
    return p.airspeed * 1.943844 < p.profile.rotationKnots
      ? `Throttle up. Pull back at ${p.profile.rotationKnots} knots.`
      : "Gently pull back to lift off.";
  if (o.ringIndex < mission.rings.length)
    return `Fly through checkpoint ${o.ringIndex + 1} of ${mission.rings.length}`;
  if (mission.land) return p.grounded ? "Hold B to brake to a stop." : `Land at ${mission.land}`;
  return "Route complete";
}

export function flightHint(p: FlightPhysics, aircraft: AircraftId) {
  if (p.engineOut)
    return aircraft === "heron"
      ? "Engine out · maintain 85–95 knots"
      : p.jet
        ? "Engine out · maintain 75–90 knots"
        : "Engine out · maintain 55–65 knots";
  if (p.stall) return "STALL · Lower the nose and add power";
  return p.grounded
    ? "SHIFT throttle · ↓ pull back · B brake"
    : "Arrow keys to fly · Shift / Ctrl throttle";
}

export type DiagnosticsInput = {
  mode: GameMode;
  aircraft: AircraftModel;
  audio: FlightAudio;
  physics: FlightPhysics;
  ringIndex: number;
  mission: Mission;
  fps: number;
  renderer: T.WebGLRenderer;
  vfx: FlightVfx;
};

/** Full simulation state for browser checks and benchmarks. */
export function diagnostics(o: DiagnosticsInput) {
  const p = o.physics;
  const aero = p.aerodynamics;
  return {
    mode: o.mode,
    aircraft: o.aircraft.id,
    cockpitDisplays: o.aircraft.displays?.diagnostics(),
    music: o.audio.music?.getState() ?? null,
    position: p.position.toArray(),
    velocity: p.velocity.toArray(),
    speed: p.airspeed,
    grounded: p.grounded,
    crashed: p.crashed,
    health: p.health,
    ring: o.ringIndex,
    mission: o.mission.id,
    throttle: p.throttle,
    pitch: p.pitch,
    roll: p.roll,
    fps: Math.round(o.fps),
    drawCalls: o.renderer.info.render.calls,
    vfx: o.vfx.stats,
    triangles: o.renderer.info.render.triangles,
    enginePower: p.enginePower,
    beginnerAssist: p.beginnerAssist,
    elevatorTrim: p.elevatorTrim,
    flightModel: ISLAND_FLIGHT_MODEL,
    automaticConfiguration: p.automaticConfiguration,
    gearPosition: p.gearPosition,
    gearTarget: p.gearTarget,
    flapPosition: p.flapPosition,
    flapTarget: p.flapCommand,
    wingDamage: { ...p.wingDamage },
    detachedWings: { ...p.detachedWings },
    simulationTick: p.simulationTick,
    speedProtection: p.speedProtectionActive,
    wheelContacts: p.wheelContacts.map((c) => ({
      index: c.index,
      loadNewtons: c.load,
      compression: c.compression,
      closingSpeed: c.closingSpeed,
      locked: c.locked,
      runway: c.runway,
    })),
    aerodynamics: aero
      ? {
          alpha: aero.alpha,
          beta: aero.beta,
          density: aero.density,
          dynamicPressure: aero.dynamicPressure,
          liftNewtons: aero.lift,
          dragNewtons: aero.drag,
          massKg: p.loadedMass,
          cgMetres: p.massProperties.cg.toArray(),
          inertiaKgM2: p.massProperties.inertia.toArray(),
          angularVelocity: p.angularVelocity.toArray(),
          momentsNewtonMetres: aero.moment.toArray(),
          staticMargin: aero.staticMargin,
          mach: aero.mach,
          stallSpeedMetresPerSecond: p.stallSpeed,
          fuelKg: p.fuelKg,
          stalled: p.stall,
        }
      : null,
  };
}
