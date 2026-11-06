import type { AircraftId } from "./aircraft";
import type { CockpitSpec } from "./cockpit-state";
import { F15C_HUD } from "./cockpit-avionics";
import aureliaGauges from "./aurelia/cockpit-gauges.json";
import f15cGauges from "./f15c/cockpit-gauges.json";
import { F15C_PILOT_EYE } from "./f15c/design";
import peregrineGauges from "./peregrine/cockpit-gauges.json";
import stormbirdGauges from "./stormbird/cockpit-gauges.json";
import { STORMBIRD_PILOT_EYE } from "./stormbird/stormbird-config";

/** Aircraft with a detailed Blender cockpit. Built by scripts/build-cockpit.py. */
export const cockpitSpecs: Partial<Record<AircraftId, CockpitSpec>> = {
  f15c: {
    url: "/assets/cockpits/f15c.glb",
    eye: F15C_PILOT_EYE,
    lookDown: 0.26,
    replaces: ["Cockpit_fixed", "Cockpit_well"],
    gauges: f15cGauges,
    fuelPounds: 13455,
    throttle: { idle: -0.078, travel: 0.238 },
    stick: { pitch: 0.2, roll: 0.22 },
    screens: [
      { node: "Screen_VSD", kind: "radar", width: 384, height: 384 },
      { node: "Screen_TEWS", kind: "threat", width: 384, height: 384 },
      { node: "Screen_MPCD", kind: "map", width: 512, height: 512 },
      { node: "Screen_UFC", kind: "readout", width: 512, height: 168 },
      { node: "Screen_HUD", kind: "hud", width: 640, height: 610 },
    ],
    hud: F15C_HUD,
    panelLight: "#ffd9a0",
  },
  peregrine: {
    url: "/assets/cockpits/peregrine.glb",
    eye: [0, 1.83, -6.6],
    lookDown: 0.2,
    // Painted exterior arches would show through as pale bands so close to the eye.
    replaces: ["Canopy forward arch", "Windscreen rear arch"],
    carve: { min: [-0.98, 3.05, -10.95], max: [0.98, 5.3, -5.9], keep: /glaz|canopy|windscreen|arch/i },
    gauges: peregrineGauges,
    fuelPounds: 4111,
    throttle: { idle: -0.04, travel: 0.22 },
    stick: { pitch: 0.2, roll: 0.22 },
    screens: [
      { node: "Screen_MFD_L", kind: "map", width: 512, height: 512 },
      { node: "Screen_MFD_C", kind: "radar", width: 384, height: 384 },
      { node: "Screen_MFD_R", kind: "engines", width: 512, height: 512 },
      { node: "Screen_UFC", kind: "readout", width: 512, height: 124 },
      { node: "Screen_HUD", kind: "hud", width: 640, height: 571 },
    ],
    hud: { distance: 0.54, height: 0.2, eyeAbove: 0.03 },
    panelLight: "#c4ffd8",
  },
  stormbird: {
    url: "/assets/cockpits/stormbird.glb",
    eye: STORMBIRD_PILOT_EYE,
    lookDown: 0.2,
    replaces: [],
    // The old cockpit is baked into the airframe meshes, so it can only be cut out.
    carve: { min: [-0.52, 1.55, -6.25], max: [0.52, 2.96, -2.98], keep: /canopy|actuator/i },
    gauges: stormbirdGauges,
    fuelPounds: 6884,
    throttle: { idle: -0.04, travel: 0.22 },
    stick: { pitch: 0.16, roll: 0.18 },
    screens: [
      { node: "Screen_MFD_L", kind: "flight", width: 512, height: 512 },
      { node: "Screen_MFD_R", kind: "map", width: 512, height: 512 },
      { node: "Screen_UFC", kind: "readout", width: 512, height: 102 },
      { node: "Screen_HUD", kind: "hud", width: 640, height: 500 },
    ],
    hud: { distance: 0.67, height: 0.2, eyeAbove: 0.033 },
    panelLight: "#ffd9a0",
  },
  aurelia: {
    url: "/assets/cockpits/aurelia.glb",
    // The left seat of the Phenom 300E-based airframe, at the height of its own pilot eye.
    eye: [-0.32, 1.455, -6.04],
    lookDown: 0.26,
    // The airframe's simple flight deck; its glareshield deck under the windshield stays.
    replaces: [
      "Cockpit_floor", "Pilot_seat_Left_mount", "Pilot_seat_Right_mount", "Yoke_Left_mount", "Yoke_Right_mount",
      "Centre_pedestal_mount", "Instrument_panel_mount", "Pedal_assembly_-1_-1_mount", "Pedal_assembly_-1_1_mount",
      "Pedal_assembly_1_-1_mount", "Pedal_assembly_1_1_mount", "Cockpit_partition",
    ],
    // Skin and forward liner touching the deck are cut; the new liner replaces them. Glass and seals stay.
    carve: {
      min: [-1.2, 1.62, -7.0],
      max: [1.2, 3.6, -5.15],
      keep: /(^|\/)(Cockpit|Flight_deck|Windshield_-?1_seal|Cockpit_side_window_-?1_seal)(\/|$)/,
      touching: true,
    },
    gauges: aureliaGauges,
    fuelPounds: 2136,
    throttle: { idle: -0.1, travel: 0.23 },
    stick: { pitch: 0.14, roll: 0.5 },
    screens: [
      { node: "Screen_PFD", kind: "flight", width: 512, height: 452 },
      { node: "Screen_MFD_L", kind: "map", width: 512, height: 512 },
      { node: "Screen_MFD_R", kind: "engines", width: 512, height: 452 },
      { node: "Screen_FMS", kind: "readout", width: 512, height: 168 },
    ],
    panelLight: "#ffe3b8",
  },
};
