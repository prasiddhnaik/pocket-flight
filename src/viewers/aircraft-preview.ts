import { isPropellerAircraft } from "../aircraft/aircraft";
import type { AircraftId, AircraftModel } from "../aircraft/aircraft";
import { initialJetInput } from "../aircraft/jet-effects";
import { aircraftNames } from "../app/flight-ui";

export function previewAircraftId(value: string | null): AircraftId {
  return value && Object.hasOwn(aircraftNames, value)
    ? (value as AircraftId)
    : "finch";
}

export function previewCapabilities(id: AircraftId) {
  return {
    propeller: isPropellerAircraft(id),
    gear: !isPropellerAircraft(id),
    flaps: id !== "finch",
    canopy: id === "peregrine" || id === "stormbird" || id === "f15c",
    burner: id === "peregrine" || id === "stormbird" || id === "f15c",
    cannon: id === "f15c",
    fuelSystem: id === "f15c",
    airbrake: id === "f15c",
    paint: id === "finch",
  };
}

export const initialPreviewSettings = () => ({
  power: 0,
  roll: 0,
  pitch: 0,
  yaw: 0,
  flaps: 0,
  gear: true,
  canopy: false,
  burner: true,
  airbrake: false,
  firing: false,
  fuelSystem: false,
  fuelLevel: 1,
});
export type PreviewSettings = ReturnType<typeof initialPreviewSettings>;
export type PreviewRange = "power" | "roll" | "pitch" | "yaw" | "flaps" | "fuelLevel";
export type PreviewToggle = "gear" | "canopy" | "burner" | "airbrake" | "fuelSystem";
export type PreviewConfiguration = "parked" | "clean" | "landing" | "inspect";

export function previewConfiguration(
  id: AircraftId,
  configuration: PreviewConfiguration,
): PreviewSettings {
  const capabilities = previewCapabilities(id);
  return {
    ...initialPreviewSettings(),
    gear: !capabilities.gear || configuration !== "clean",
    flaps:
      capabilities.flaps &&
      (configuration === "landing" || configuration === "inspect")
        ? 1
        : 0,
    canopy: capabilities.canopy && configuration === "inspect",
    airbrake: capabilities.airbrake && configuration === "inspect",
  };
}

export function setPreviewRange(
  state: PreviewSettings,
  id: AircraftId,
  key: PreviewRange,
  value: number,
) {
  if (
    !Number.isFinite(value) ||
    (key === "flaps" && !previewCapabilities(id).flaps)
  )
    return;
  state[key] = Math.max(
    key === "roll" || key === "pitch" || key === "yaw" ? -1 : 0,
    Math.min(1, value),
  );
  if (key === "power" && state.power > 0) state.canopy = false;
}

export function setPreviewToggle(
  state: PreviewSettings,
  id: AircraftId,
  key: PreviewToggle,
  value: boolean,
) {
  if (!previewCapabilities(id)[key]) return;
  state[key] = value;
  if (key === "canopy" && value) state.power = 0;
}

type PreviewAircraft = Pick<
  AircraftModel,
  "id" | "effects" | "surfaces" | "setConfiguration" | "propellerMotion"
>;

// Use the flight rigs directly so inspection cannot drift from the game model.
export function updateAircraftPreview(
  aircraft: PreviewAircraft,
  state: PreviewSettings,
  dt: number,
  reduced = false,
) {
  const capabilities = previewCapabilities(aircraft.id);
  if (aircraft.effects && "fuelCutaway" in aircraft.effects) {
    aircraft.effects.fuelCutaway.setEnabled(capabilities.fuelSystem && state.fuelSystem);
    aircraft.effects.fuelCutaway.setLevel(state.fuelLevel);
  }
  if (aircraft.effects) {
    aircraft.effects.setReducedMotion(reduced);
    aircraft.effects.update(dt, {
      ...initialJetInput(),
      throttle: state.power,
      roll: state.roll,
      pitch: state.pitch,
      yaw: state.yaw,
      flaps: capabilities.flaps ? state.flaps : 0,
      gear: capabilities.gear ? state.gear : true,
      canopy: capabilities.canopy && state.canopy,
      burner: capabilities.burner && state.burner,
      speedBrake: capabilities.airbrake && state.airbrake ? 1 : 0,
      gunFiring: capabilities.cannon && state.firing,
      powerResolved: true,
    });
  } else {
    aircraft.surfaces.update(state, dt);
    aircraft.setConfiguration(capabilities.flaps ? state.flaps : 0, state.yaw);
    aircraft.propellerMotion.update(
      {
        throttle: state.power,
        airspeed: 0,
        damage: 0,
        engineOut: state.power === 0,
        crashed: false,
      },
      reduced ? 0 : dt,
    );
  }
}
