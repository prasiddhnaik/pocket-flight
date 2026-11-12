import * as T from "three";
import { CockpitAvionics } from "./cockpit-avionics";
import type { DisplayTelemetry } from "./cockpit-displays";
import { counterRolls, dialAngle } from "./cockpit-instruments";
import type { CockpitCarve, InteriorDriver } from "./cockpit-interior";

export type CockpitContact = { x: number; z: number; y: number; air: boolean };
export type CockpitStores = { gun: number; rockets: number; missiles: number; locked: boolean };
export type CockpitState = DisplayTelemetry & {
  /** Wing angle of attack in degrees. */
  aoa: number;
  gLoad: number;
  gear: number;
  flaps: number;
  stick: { pitch: number; roll: number; yaw: number };
  speedBrake: number;
  night: boolean;
  grounded: boolean;
  slowingToLand: boolean;
  approachKnots: number;
  target: { x: number; z: number } | null;
  contacts: readonly CockpitContact[];
  stores: CockpitStores | null;
  /** Horizontal speed over the ground, in metres a second. */
  groundSpeed?: number;
  /** Where the air is moving, in metres a second. */
  wind?: { x: number; z: number };
};
export type ScreenKind = "hud" | "radar" | "threat" | "map" | "readout" | "flight" | "engines" | "pfd" | "mfd-nav" | "mfd-systems" | "esis" | "cdu";
export type HudGeometry = { distance: number; height: number; eyeAbove: number };
export type CockpitSpec = {
  url: string;
  /** Pilot's eye relative to the aircraft group, in metres. */
  eye: readonly [number, number, number];
  /** Radians the resting view tips down so the panel stays in frame. */
  lookDown: number;
  replaces: readonly string[];
  carve?: CockpitCarve;
  gauges: { scales: Record<string, readonly (readonly number[])[]>; gauges: Record<string, string> };
  fuelPounds: number;
  throttle: { idle: number; travel: number };
  stick: { pitch: number; roll: number };
  screens: readonly { node: string; kind: ScreenKind; width: number; height: number }[];
  hud?: HudGeometry;
  /** Colour of the panel lighting at night. */
  panelLight: string;
};

const KNOTS = 1.943844;
const FEET = 3.28084;
const MILITARY = 0.85;

/** Values each dial reads, in the units printed on its face. */
export function gaugeValues(s: CockpitState, fuelPounds: number): Record<string, number> {
  const out = s.engineOut;
  const dry = Math.min(1, s.power / MILITARY);
  const rpm = out ? Math.min(18, s.speed * 0.08) : 65 + dry * 35 + Math.max(0, s.power - MILITARY) * 20;
  const ftit = out ? 200 : 480 + dry * 500 + Math.max(0, s.power - MILITARY) * 130;
  const flow = out ? 0 : 12 + dry * 88;
  const nozzle = s.power < MILITARY ? 80 - dry * 72 : 8 + ((s.power - MILITARY) / (1 - MILITARY)) * 92;
  const oil = out ? 0 : 32 + s.power * 25;
  const hydraulic = out ? 0 : 3000;
  const feet = s.altitude * FEET;
  const knots = s.speed * KNOTS;
  return {
    airspeed: knots,
    standby_airspeed: knots,
    altimeter: feet,
    standby_altimeter: feet,
    aoa: T.MathUtils.clamp(s.aoa * 1.75, 0, 45),
    gmeter: s.gLoad,
    vvi: s.verticalSpeed * FEET * 60,
    rpm_left: rpm,
    rpm_right: out ? rpm : rpm + 0.4,
    ftit_left: ftit,
    ftit_right: out ? ftit : ftit - 6,
    flow_left: flow,
    flow_right: flow,
    nozzle_left: nozzle,
    nozzle_right: nozzle,
    oil_left: oil,
    oil_right: oil,
    hyd_one: hydraulic,
    hyd_two: hydraulic,
    fuel: (s.fuel ?? 0) * fuelPounds,
    cabin: Math.min(feet, 8000),
    oxygen: 8.4,
  };
}

const PANEL_OUT = new T.Vector3(0, 1, 0);
const PANEL_ACROSS = new T.Vector3(1, 0, 0);
const AFT_AXIS = new T.Vector3(0, 0, -1);
const delta = new T.Quaternion();
const second = new T.Quaternion();
const PEDAL_TRAVEL = 0.035;
const LAMPS: Record<string, string> = { red: "#ff3a2c", green: "#42ff6a", amber: "#ffb020" };
// A second cockpit repeats its instruments under these name prefixes.
const REPEATS = ["", "Rear_", "Copilot_"];

type Moving = { node: T.Object3D; rest: T.Quaternion; place: T.Vector3 };

export function cockpitDriver(spec: CockpitSpec, options: { screens?: boolean } = {}): InteriorDriver<CockpitState> {
  const moving = new Map<string, Moving[]>();
  const needles = new Map<string, number>();
  const lamps = new Map<string, T.MeshStandardMaterial[]>();
  const printed: T.MeshStandardMaterial[] = [];
  const bounced: T.MeshStandardMaterial[] = [];
  let avionics: CockpitAvionics | null = null;

  const each = (name: string, act: (part: Moving) => void) => {
    for (const part of moving.get(name) ?? []) act(part);
  };
  const turn = (name: string, axis: T.Vector3, radians: number) =>
    each(name, (part) => part.node.quaternion.copy(part.rest).multiply(delta.setFromAxisAngle(axis, radians)));
  const light = (name: string, on: boolean) => {
    for (const material of lamps.get(name) ?? []) material.emissiveIntensity = on ? 2.4 : 0;
  };
  return {
    url: spec.url,
    replaces: spec.replaces,
    carve: spec.carve,
    bind(cabin) {
      cabin.traverse((node) => {
        const base = REPEATS.reduce((name, prefix) => (prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name), node.name);
        if (/^(Needle_|ADI_|Standby_ADI|HSI_|Stick$|Throttle_|Pedal_|Yoke_|Gear_handle$|Drum_)/.test(base)) {
          moving.set(base, [...(moving.get(base) ?? []), { node, rest: node.quaternion.clone(), place: node.position.clone() }]);
        }
        if (!(node instanceof T.Mesh)) return;
        const material = node.material as T.MeshStandardMaterial;
        if (material.name === "Cockpit atlas" && !printed.includes(material)) {
          printed.push(material);
          if (material.map) material.map.anisotropy = 8;
          material.emissive = new T.Color(spec.panelLight);
          material.emissiveIntensity = 0;
        }
        // Faked bounce light: inside a canopy nothing would otherwise lift the shaded surfaces.
        if (material.isMeshStandardMaterial && !/atlas|lamp|glass|screen/.test(material.name) && !bounced.includes(material)) {
          bounced.push(material);
          material.emissive = material.color.clone();
        }
        const owner = REPEATS.reduce((name, prefix) => (prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name), node.parent?.name ?? "");
        if (owner.startsWith("Lamp_") && /lamp|atlas/.test(material.name)) {
          const colour = /red/.test(material.name) ? "red" : /green/.test(material.name) ? "green" : "amber";
          const own = material.clone();
          own.emissive = new T.Color(LAMPS[colour]);
          own.emissiveMap = null;
          own.emissiveIntensity = 0;
          node.material = own;
          lamps.set(owner, [...(lamps.get(owner) ?? []), own]);
        }
      });
      if (options.screens !== false) avionics = new CockpitAvionics(cabin, spec);
    },
    update(s, dt) {
      const values = gaugeValues(s, spec.fuelPounds);
      const rate = 1 - Math.exp(-9 * dt);
      for (const [id, scale] of Object.entries(spec.gauges.gauges)) {
        // The altimeter pointer winds freely, one turn every thousand feet.
        const target = scale === "altimeter" ? values[id] * 0.36 : dialAngle(spec.gauges.scales[scale], values[id]);
        const name = `Needle_${id}`;
        const angle = needles.get(name) ?? target;
        const next = angle + (target - angle) * rate;
        needles.set(name, next);
        turn(name, PANEL_OUT, T.MathUtils.degToRad(-next));
      }
      for (const name of ["ADI_ball", "Standby_ADI_ball"])
        each(name, (part) =>
          part.node.quaternion
            .copy(part.rest)
            .multiply(delta.setFromAxisAngle(PANEL_OUT, -s.roll))
            .multiply(second.setFromAxisAngle(PANEL_ACROSS, s.pitch)),
        );
      turn("HSI_card", PANEL_OUT, s.heading);
      if (s.target) {
        const bearing = Math.atan2(s.target.x - s.x, -(s.target.z - s.z));
        turn("HSI_course", PANEL_OUT, s.heading - bearing);
      }
      const hours = 36000 + s.time;
      turn("Needle_clock_hour", PANEL_OUT, -(hours / 43200) * T.MathUtils.degToRad(360));
      turn("Needle_clock_minute", PANEL_OUT, -(hours / 3600) * T.MathUtils.degToRad(360));
      turn("Needle_clock_second", PANEL_OUT, -(Math.floor(hours) / 60) * T.MathUtils.degToRad(360));
      const drum = (prefix: string, value: number, places: number[]) =>
        counterRolls(value, places).forEach((roll, i) =>
          turn(`${prefix}_${i}`, PANEL_ACROSS, T.MathUtils.degToRad((roll + 0.5) * 36)),
        );
      drum("Drum_altitude", values.altimeter, [10000, 1000, 100]);
      drum("Drum_fuel", values.fuel, [10000, 1000, 100, 10, 1]);
      each("Stick", (part) =>
        part.node.quaternion
          .copy(part.rest)
          .multiply(delta.setFromAxisAngle(PANEL_ACROSS, s.stick.pitch * spec.stick.pitch))
          .multiply(second.setFromAxisAngle(AFT_AXIS, s.stick.roll * spec.stick.roll)),
      );
      // A yoke column rocks fore and aft; its wheel turns with the roll input.
      for (const side of ["left", "right"]) {
        turn(`Yoke_${side}`, PANEL_ACROSS, s.stick.pitch * spec.stick.pitch);
        turn(`Yoke_${side}_wheel`, AFT_AXIS, s.stick.roll * spec.stick.roll);
      }
      for (const [name, sign] of [["Pedal_left", -1], ["Pedal_right", 1]] as const)
        each(name, (part) => {
          part.node.position.z = part.place.z - sign * s.stick.yaw * PEDAL_TRAVEL;
        });
      for (const name of ["Throttle_left", "Throttle_right"])
        each(name, (part) => {
          part.node.position.z = part.place.z - (spec.throttle.idle + s.power * spec.throttle.travel);
        });
      turn("Gear_handle", PANEL_ACROSS, T.MathUtils.lerp(-0.42, 0.42, s.gear));
      const alerts = avionics?.alerts();
      light("Lamp_master", alerts ? alerts.caution : s.stall || s.engineOut || (s.fuel ?? 1) < 0.1);
      light("Lamp_master_warning", alerts?.warning ?? false);
      light("Lamp_fire_left", s.engineOut);
      light("Lamp_fire_right", s.engineOut);
      for (const name of ["Lamp_gear_nose", "Lamp_gear_left", "Lamp_gear_right"]) light(name, s.gear > 0.995);
      light("Lamp_speedbrake", s.speedBrake > 0.05);
      for (const material of printed) material.emissiveIntensity = s.night ? 0.9 : 0.22;
      for (const material of bounced) material.emissiveIntensity = s.night ? 0.03 : 0.16;
      avionics?.update(s, dt);
    },
    dispose() {
      avionics?.dispose();
    },
  };
}
