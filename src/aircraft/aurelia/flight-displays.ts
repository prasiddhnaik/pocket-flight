import type { Object3D } from "three";
import type { DisplayTelemetry } from "../cockpit-displays";
import { runways } from "../../world/terrain";
import { AureliaAvionics } from "./avionics";
import type { AureliaAvionicsState } from "./avionics-state";

/** Bridge the game's sensor values to the authored five-screen cockpit. */
export function aureliaFlightDisplayState(
  t: DisplayTelemetry,
  gear: number,
  flaps: number,
): AureliaAvionicsState {
  const power = t.engineOut ? 0 : Math.max(0, Math.min(1, t.power));
  // Auxiliary engine indications are estimates derived from simulated engine power.
  const engine = {
    n1: power * 100,
    n2: power * 100,
    ittC: 20 + power * 650,
    oilPsi: power * 50,
    oilC: 20 + power * 90,
    fuelLb: (t.fuel ?? 0) * 1200,
  };
  return {
    time: t.time,
    revision: t.time,
    source:
      t.mode === "demo" ? "demo" : t.mode === "replay" ? "replay" : "flight",
    speedKt: t.speed * 1.943844,
    groundSpeedKt: t.speed * 1.943844,
    altitudeFt: t.altitude / 0.3048,
    verticalSpeedFpm: t.verticalSpeed / 0.00508,
    headingDeg: ((((t.heading * 180) / Math.PI) % 360) + 360) % 360,
    pitch: t.pitch,
    roll: t.roll,
    utcSeconds: t.time,
    busVoltage: t.engineOut ? 24 : 28,
    engines: [engine, engine],
    gear,
    flaps,
    guidance: {
      verticalMode: "MAN",
      lateralMode: "MAN",
      autopilot: false,
      yawDamper: false,
      selectedAltitudeFt: t.altitude / 0.3048,
      directorPitchRad: t.pitch,
      directorRollRad: t.roll,
    },
    radio: {
      com1MHz: 121.7,
      baroInHg: 29.92,
      transponderCode: "1200",
      transponderMode: "ALT",
    },
    navigation: {
      position: { x: t.x, z: t.z },
      rangeNm: 1,
      orientation: "heading-up",
      desiredTrackDeg: ((((t.heading * 180) / Math.PI) % 360) + 360) % 360,
      route: [],
      terrain: [],
      runways: runways.map((r) => ({
        id: r.name,
        start: {
          x: r.x - (Math.sin(r.heading) * r.length) / 2,
          z: r.z - (Math.cos(r.heading) * r.length) / 2,
        },
        end: {
          x: r.x + (Math.sin(r.heading) * r.length) / 2,
          z: r.z + (Math.cos(r.heading) * r.length) / 2,
        },
      })),
    },
  };
}

export class AureliaFlightDisplays {
  private avionics: AureliaAvionics;
  constructor(
    root: Object3D,
    private configuration: () => { gear: number; flaps: number },
  ) {
    this.avionics = new AureliaAvionics(
      root,
      aureliaFlightDisplayState(
        {
          time: 0,
          mode: "demo",
          speed: 0,
          altitude: 0,
          heading: 0,
          pitch: 0,
          roll: 0,
          verticalSpeed: 0,
          power: 0,
          fuel: 1,
          x: 0,
          z: 0,
          engineOut: false,
          stall: false,
        },
        1,
        0,
      ),
    );
  }
  update(telemetry: DisplayTelemetry, focused: boolean, force = false) {
    const { gear, flaps } = this.configuration();
    this.avionics.update(
      aureliaFlightDisplayState(telemetry, gear, flaps),
      force,
      focused,
    );
  }
  diagnostics() {
    return this.avionics.snapshot();
  }
  dispose() {
    this.avionics.dispose();
  }
}
