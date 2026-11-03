import type { JetLayout } from "../jet-effects";
import geometry from "./stormbird-geometry.json";

export const STORMBIRD_CENTER = geometry.centerOffsetY;
// Provisional seated pilot eye datum: CAD (0, 5.28, 2.78), before the body offset.
export const STORMBIRD_PILOT_EYE: [number, number, number] = [
  0,
  2.78 - STORMBIRD_CENTER,
  -5.28,
];
export const stormbirdLayout: JetLayout = {
  exhaust: [1.28, 1.9, 7.93],
  wingtip: [6.58, 2.11, 3.01],
  noseGear: [0, 1.5, -5.3],
  mainGear: [1.8, 1.525, 1.2],
  canopy: [0, 2.548, -2.8],
  flameRadius: 0.45,
  flameLength: 5.6,
  flameEmission: 1,
  flameLight: 0.5,
  flameStyle: "afterburner",
  flameBlending: "normal",
  flameTint: [1, 0.72, 0.6],
  gearDoorsOpen: true,
  lamps: [
    [-6.58, 2.11, 3.01, "#ff3425", "nav"],
    [6.58, 2.11, 3.01, "#39ffa9", "nav"],
    [0, 2.82, 1.2, "#ff4e37", "beacon"],
    [0, 1.85, 8.08, "#ffffff", "tail"],
    [-6.58, 2.11, 3.07, "#ffffff", "strobe"],
    [6.58, 2.11, 3.07, "#ffffff", "strobe"],
    [0, 1.42, -5.332, "#fff1d5", "landing"],
  ],
};
