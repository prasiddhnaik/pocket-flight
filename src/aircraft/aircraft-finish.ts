import * as T from "three";

// Ace Combat–style exterior finish for UV-less CAD aircraft: a sky reflection
// map, procedural panel lines, rivets, panel tone and flow grime, and
// projected markings. Everything is computed in the aircraft's own frame
// (nose −Z, up +Y, span ±X) so the detail stays glued to the airframe.

type Slot = "insignia" | "tail" | "stencil" | "emblem" | "number" | "rescue" | "panel";
type Decal = {
  slot: Slot;
  /** Centre in glTF units; mirrored to both sides unless `side` is set. */
  at: [number, number, number];
  /** Full width and height in glTF units. */
  size: [number, number];
  /** "side" projects along X, "top"/"bottom" along Y. */
  face: "side" | "top" | "bottom";
  depth: number;
  side?: -1 | 1;
  opacity?: number;
};
type Markings = {
  ink: string;
  accent: string;
  code: string;
  serial: string;
  number: string;
  civil?: boolean;
};
type Finish = {
  root: string;
  exterior: RegExp;
  /** Main panel column length in glTF units. */
  panel: number;
  lines: number;
  grime: number;
  /** Exhaust soot ramps from z[0] to z[1] (glTF units, aft is +Z). */
  soot?: [number, number];
  paint: { roughness: number; clearcoat: number; coatRoughness: number; albedo: number; metalness: number; desaturate: number };
  canopy: { tint: string; opacity: number; iridescence: number };
  /** Bare exhaust metal, matched by node or material name, heat-tinted from z[0] to z[1]. */
  heat?: { match: RegExp; z: [number, number] };
  markings: Markings;
  decals: Decal[];
};

// AC6 gunship gray: darker, desaturated, with a satin metallic sheen.
const military = { roughness: 0.44, clearcoat: 0.3, coatRoughness: 0.22, albedo: 0.48, metalness: 0.18, desaturate: 0.55 };
// Flat tactical paint for the Finch A-2.
const matte = { roughness: 0.66, clearcoat: 0.06, coatRoughness: 0.5, albedo: 1, metalness: 0.05, desaturate: 0 };
const gloss = { roughness: 0.3, clearcoat: 0.85, coatRoughness: 0.05, albedo: 1, metalness: 0.05, desaturate: 0 };

const finishes: Finish[] = [
  {
    root: "F15C_Eagle",
    exterior: /^Paint • F-15C/,
    soot: [3.8, 8.1],
    panel: 1.05,
    lines: 0.45,
    grime: 1.4,
    paint: military,
    canopy: { tint: "#3a4c55", opacity: 0.45, iridescence: 0.2 },
    heat: { match: /^(Nozzle_|Convergent_petal|Divergent_petal|Engine_collar)/, z: [6.77, 7.96] },
    markings: { ink: "#2b3136", accent: "#c8a03a", code: "PB", serial: "AF 86 0179", number: "179" },
    decals: [
      { slot: "tail", at: [1.76, 1.75, 7.25], size: [1.75, 1.75], face: "side", depth: 0.2 },
      { slot: "insignia", at: [1.98, -0.1, 0.1], size: [0.62, 0.62], face: "side", depth: 0.28 },
      { slot: "number", at: [0.66, -0.3, -6.1], size: [1.0, 0.42], face: "side", depth: 0.4 },
      { slot: "insignia", at: [-4.35, 0.04, 3.1], size: [1.35, 1.35], face: "top", depth: 0.25, side: -1 },
      { slot: "insignia", at: [4.35, -0.1, 3.1], size: [1.35, 1.35], face: "bottom", depth: 0.25, side: 1 },
      { slot: "stencil", at: [2.6, 0.08, 2.4], size: [0.9, 0.22], face: "top", depth: 0.25 },
      { slot: "rescue", at: [1.5, 0.05, -3.35], size: [0.55, 0.28], face: "side", depth: 0.2 },
      { slot: "emblem", at: [1.98, -0.1, 2.9], size: [0.62, 0.62], face: "side", depth: 0.28, opacity: 0.95 },
    ],
  },
  {
    root: "Peregrine_HX27",
    exterior: /^(Airframe|Panels|Radome)/,
    soot: [9.5, 13.8],
    panel: 1.5,
    lines: 0.9,
    grime: 0.9,
    paint: military,
    canopy: { tint: "#3a3020", opacity: 0.5, iridescence: 0.75 },
    heat: { match: /^Nozzles/, z: [12.2, 13.75] },
    markings: { ink: "#2f383f", accent: "#d06a2a", code: "HX", serial: "27-0412", number: "07" },
    decals: [
      { slot: "insignia", at: [-6.4, 4.1, 3.6], size: [1.9, 1.9], face: "top", depth: 0.7, side: -1 },
      { slot: "insignia", at: [6.4, 3.6, 3.6], size: [1.9, 1.9], face: "bottom", depth: 0.7, side: 1 },
      { slot: "emblem", at: [2.6, 3.0, 4.0], size: [1.2, 1.2], face: "side", depth: 0.6 },
      { slot: "number", at: [1.3, 2.7, -11.4], size: [1.6, 0.66], face: "side", depth: 0.7 },
      { slot: "stencil", at: [3.8, 4.25, 5.4], size: [1.3, 0.32], face: "top", depth: 0.5 },
      { slot: "rescue", at: [1.15, 3.7, -5.4], size: [1.0, 0.5], face: "side", depth: 0.8 },
    ],
  },
  {
    root: "Stormbird_HX40",
    soot: [5.0, 8.2],
    exterior: /^Stormbird alloy (0|1|2|10|14)$/,
    panel: 1.0,
    lines: 1,
    grime: 1,
    paint: military,
    canopy: { tint: "#3b2f1c", opacity: 0.5, iridescence: 0.8 },
    markings: { ink: "#323b44", accent: "#e0602a", code: "SB", serial: "40-1108", number: "108" },
    decals: [
      { slot: "insignia", at: [-4.2, 2.35, 1.6], size: [1.4, 1.4], face: "top", depth: 0.5, side: -1 },
      { slot: "insignia", at: [4.2, 1.8, 1.6], size: [1.4, 1.4], face: "bottom", depth: 0.5, side: 1 },
      { slot: "number", at: [0.7, 2.2, -6.6], size: [1.05, 0.44], face: "side", depth: 0.5 },
      { slot: "emblem", at: [2.15, 2.6, 2.6], size: [0.9, 0.9], face: "side", depth: 0.5 },
      { slot: "stencil", at: [2.7, 2.3, 2.7], size: [0.9, 0.22], face: "top", depth: 0.4 },
      { slot: "rescue", at: [0.75, 2.75, -2.6], size: [0.7, 0.35], face: "side", depth: 0.5 },
    ],
  },
  {
    root: "Finch_U2",
    exterior: /^(Paint|Livery • coastal teal$)/,
    panel: 0.55,
    lines: 0.6,
    grime: 0.45,
    paint: gloss,
    canopy: { tint: "#55707a", opacity: 0.3, iridescence: 0 },
    markings: { ink: "#1f3d44", accent: "#c0472f", code: "PF", serial: "PF-U2", number: "PF-U2", civil: true },
    decals: [
      { slot: "number", at: [0.66, 0.15, 2.3], size: [1.3, 0.42], face: "side", depth: 0.25 },
      { slot: "number", at: [-3.2, 0.25, 0.15], size: [1.6, 0.52], face: "top", depth: 0.25, side: -1 },
      { slot: "stencil", at: [0.9, 0.24, 0.55], size: [0.42, 0.1], face: "top", depth: 0.2 },
    ],
  },
  {
    root: "Finch_A2",
    exterior: /^(Paint|Livery • coastal teal$)/,
    panel: 0.55,
    lines: 0.75,
    grime: 0.8,
    paint: matte,
    canopy: { tint: "#3f5058", opacity: 0.4, iridescence: 0.1 },
    markings: { ink: "#262c30", accent: "#c8a03a", code: "PB", serial: "AF 24 0212", number: "212" },
    decals: [
      { slot: "panel", at: [0, 0.45, -1.9], size: [0.5, 1.5], face: "top", depth: 0.5, opacity: 0.9 },
      { slot: "tail", at: [0.06, 1.05, 3.62], size: [0.9, 0.9], face: "side", depth: 0.15 },
      { slot: "insignia", at: [0.5, 0.12, 1.75], size: [0.6, 0.6], face: "side", depth: 0.3 },
      { slot: "number", at: [0.45, 0.05, -2.25], size: [0.55, 0.25], face: "side", depth: 0.3 },
      { slot: "insignia", at: [-3.6, 0.2, -0.05], size: [0.85, 0.85], face: "top", depth: 0.3, side: -1 },
      { slot: "insignia", at: [3.6, -0.05, -0.05], size: [0.85, 0.85], face: "bottom", depth: 0.3, side: 1 },
      { slot: "stencil", at: [0.9, 0.24, 0.55], size: [0.42, 0.1], face: "top", depth: 0.2 },
    ],
  },
  {
    root: "Heron_UT9",
    exterior: /^Paint • Heron/,
    panel: 0.75,
    lines: 0.7,
    grime: 0.6,
    paint: gloss,
    canopy: { tint: "#0d1418", opacity: 0.72, iridescence: 0 },
    markings: { ink: "#14263f", accent: "#b25a22", code: "HR", serial: "PF-UT9", number: "PF-UT9", civil: true },
    decals: [
      { slot: "number", at: [0.55, 0.02, 5.3], size: [1.7, 0.4], face: "side", depth: 0.4 },
      { slot: "emblem", at: [0.14, 1.3, 7.0], size: [0.9, 0.9], face: "side", depth: 0.15 },
      { slot: "number", at: [-4.2, 1.42, 1.05], size: [2.5, 0.7], face: "top", depth: 0.3, side: -1 },
    ],
  },
  {
    root: "Aurelia_S32",
    exterior: /^(Pearl|Atlantic blue lacquer|Gear fairing|Radome)/,
    panel: 1.7,
    lines: 0.55,
    grime: 0.4,
    paint: gloss,
    canopy: { tint: "#0b1418", opacity: 0.75, iridescence: 0 },
    markings: { ink: "#0f2a3c", accent: "#b8955a", code: "AU", serial: "PF-S32", number: "PF-S32", civil: true },
    decals: [
      { slot: "number", at: [2.2, 4.6, 8.6], size: [3.4, 0.85], face: "side", depth: 0.4 },
      { slot: "emblem", at: [0.18, 6.6, 13.2], size: [1.6, 1.6], face: "side", depth: 0.3 },
    ],
  },
];

const SLOTS: Slot[] = ["insignia", "tail", "stencil", "emblem", "number", "rescue", "panel"];
const MAX_DECALS = 8;

let sky: T.DataTexture | undefined;
/** Shared HDR daylight sky used only for aircraft reflections. */
export function aircraftSky() {
  if (sky) return sky;
  const w = 256,
    h = 128,
    data = new Float32Array(w * h * 4);
  const sun = new T.Vector3(-0.45, 0.62, 0.64).normalize();
  const dir = new T.Vector3();
  const noise = (x: number, y: number) =>
    Math.sin(x * 12.9 + Math.sin(y * 7.1) * 2) * Math.sin(y * 9.7 + x * 3.3) * 0.5 + 0.5;
  for (let j = 0; j < h; j++) {
    const elevation = ((j + 0.5) / h - 0.5) * Math.PI;
    for (let i = 0; i < w; i++) {
      const azimuth = ((i + 0.5) / w - 0.5) * Math.PI * 2;
      dir.set(Math.cos(elevation) * Math.cos(azimuth), Math.sin(elevation), Math.cos(elevation) * Math.sin(azimuth));
      const up = dir.y;
      let r: number, g: number, b: number;
      if (up >= 0) {
        const t = Math.pow(up, 0.45);
        r = T.MathUtils.lerp(1.15, 0.1, t);
        g = T.MathUtils.lerp(1.26, 0.25, t);
        b = T.MathUtils.lerp(1.4, 0.66, t);
        // Cumulus band near the horizon gives the fuselage broken reflections.
        const cloud = Math.max(0, noise(azimuth * 1.7, up * 6) - 0.55) * 2.2 * Math.exp(-up * 5);
        r += cloud * 1.15;
        g += cloud * 1.15;
        b += cloud * 1.12;
      } else {
        // Hazy sea and land below the horizon: the dark lower half of the classic
        // jet "horizon line" reflection.
        const t = Math.pow(-up, 0.35);
        r = T.MathUtils.lerp(0.34, 0.03, t);
        g = T.MathUtils.lerp(0.4, 0.05, t);
        b = T.MathUtils.lerp(0.46, 0.07, t);
      }
      const s = Math.max(0, dir.dot(sun));
      const glow = Math.pow(s, 900) * 90 + Math.pow(s, 40) * 1.6 + Math.pow(s, 6) * 0.25;
      const k = (j * w + i) * 4;
      data[k] = r + glow;
      data[k + 1] = g + glow * 0.93;
      data[k + 2] = b + glow * 0.8;
      data[k + 3] = 1;
    }
  }
  sky = new T.DataTexture(data, w, h, T.RGBAFormat, T.FloatType);
  sky.mapping = T.EquirectangularReflectionMapping;
  sky.colorSpace = T.LinearSRGBColorSpace;
  sky.magFilter = sky.minFilter = T.LinearFilter;
  sky.needsUpdate = true;
  return sky;
}

function drawAtlas(m: Markings) {
  const cell = 512,
    canvas = document.createElement("canvas");
  canvas.width = cell * 4;
  canvas.height = cell * 2;
  const g = canvas.getContext?.("2d");
  // Headless or stubbed DOM: keep the finish, skip markings.
  if (typeof g?.save !== "function" || typeof g.fillText !== "function") return null;
  const font = (weight: number, px: number) =>
    `${weight} ${px}px "DIN Condensed", "Arial Narrow", "Helvetica Neue", Arial, sans-serif`;
  const slot = (name: Slot, draw: () => void) => {
    const i = SLOTS.indexOf(name);
    g.save();
    g.translate((i % 4) * cell, Math.floor(i / 4) * cell);
    draw();
    g.restore();
  };
  const star = (cx: number, cy: number, r: number, inner = 0.42) => {
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const a = -Math.PI / 2 + (k * Math.PI) / 5,
        rr = k % 2 ? r * inner : r;
      g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr);
    }
    g.closePath();
  };
  slot("insignia", () => {
    if (m.civil) return;
    // Low-visibility roundel: ring, star and swept bars in a darker gray.
    g.fillStyle = g.strokeStyle = m.ink;
    g.lineWidth = 22;
    g.beginPath();
    g.arc(256, 256, 210, 0, Math.PI * 2);
    g.stroke();
    star(256, 256, 170);
    g.fill();
    g.fillRect(28, 236, 120, 40);
    g.fillRect(364, 236, 120, 40);
  });
  slot("tail", () => {
    // Fin-tip squadron band with chevrons, tail code and serial.
    g.fillStyle = m.accent;
    g.fillRect(70, 20, 400, 62);
    g.fillStyle = "#1a1d20";
    for (let x = 80; x < 470; x += 54) {
      g.beginPath();
      g.moveTo(x, 20);
      g.lineTo(x + 22, 20);
      g.lineTo(x + 46, 51);
      g.lineTo(x + 22, 82);
      g.lineTo(x, 82);
      g.lineTo(x + 24, 51);
      g.closePath();
      g.fill();
    }
    g.fillStyle = m.ink;
    g.textAlign = "center";
    g.textBaseline = "alphabetic";
    g.font = font(800, 230);
    g.fillText(m.code, 268, 330);
    g.font = font(700, 52);
    g.fillText(m.serial, 268, 400);
    g.font = font(600, 30);
    g.fillText("PALM BAY AIR DEFENSE WING", 268, 446);
  });
  slot("stencil", () => {
    g.strokeStyle = g.fillStyle = m.civil ? "#5b6367" : m.ink;
    g.lineWidth = 10;
    g.strokeRect(14, 170, 484, 172);
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = font(800, 120);
    g.fillText("NO STEP", 256, 262);
  });
  slot("emblem", () => {
    // Squadron patch: shield, sea-bird and lightning in full colour.
    g.beginPath();
    g.moveTo(256, 470);
    g.bezierCurveTo(90, 400, 60, 250, 70, 60);
    g.lineTo(442, 60);
    g.bezierCurveTo(452, 250, 422, 400, 256, 470);
    g.closePath();
    g.fillStyle = "#e9e4d4";
    g.fill();
    g.lineWidth = 16;
    g.strokeStyle = "#16212b";
    g.stroke();
    g.save();
    g.clip();
    g.fillStyle = m.accent;
    g.fillRect(60, 60, 400, 120);
    g.fillStyle = "#1f3f5c";
    g.fillRect(60, 330, 400, 160);
    g.restore();
    g.fillStyle = "#16212b";
    g.beginPath();
    g.moveTo(100, 250);
    g.quadraticCurveTo(200, 170, 256, 250);
    g.quadraticCurveTo(312, 170, 412, 250);
    g.quadraticCurveTo(312, 215, 256, 290);
    g.quadraticCurveTo(200, 215, 100, 250);
    g.fill();
    g.fillStyle = "#f2c230";
    g.beginPath();
    g.moveTo(276, 150);
    g.lineTo(226, 270);
    g.lineTo(262, 270);
    g.lineTo(236, 380);
    g.lineTo(300, 240);
    g.lineTo(264, 240);
    g.closePath();
    g.fill();
    g.fillStyle = "#16212b";
    g.textAlign = "center";
    g.font = font(800, 54);
    g.fillText(m.code, 256, 140);
  });
  slot("number", () => {
    g.fillStyle = m.ink;
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = font(800, m.number.length > 4 ? 150 : 210);
    g.fillText(m.number, 256, 262, 490);
  });
  slot("rescue", () => {
    if (m.civil) return;
    g.fillStyle = "#d9b13a";
    g.beginPath();
    g.moveTo(20, 256);
    g.lineTo(150, 120);
    g.lineTo(150, 200);
    g.lineTo(490, 200);
    g.lineTo(490, 312);
    g.lineTo(150, 312);
    g.lineTo(150, 392);
    g.closePath();
    g.fill();
    g.fillStyle = "#1b1b1b";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.font = font(800, 78);
    g.fillText("RESCUE", 320, 258);
  });
  slot("panel", () => {
    // Anti-glare panel: flat dark paint with a rounded leading edge.
    g.fillStyle = "#1d2124";
    if (typeof g.roundRect !== "function") return g.fillRect(24, 24, 464, 464);
    g.beginPath();
    g.roundRect(24, 24, 464, 464, [200, 200, 24, 24]);
    g.fill();
  });
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  texture.anisotropy = 8;
  texture.generateMipmaps = true;
  texture.minFilter = T.LinearMipmapLinearFilter;
  return texture;
}

const vertexHead = /* glsl */ `
uniform mat4 skinInverse;
varying vec3 vSkinPos;
varying vec3 vSkinNormal;
`;
const vertexBody = /* glsl */ `
mat4 skinFrame = skinInverse * modelMatrix;
vSkinPos = (skinFrame * vec4(transformed, 1.0)).xyz;
vSkinNormal = normalize(mat3(skinFrame) * objectNormal);
`;
const fragmentHead = /* glsl */ `
uniform vec4 skinParams; // panel, lines, grime, seed
uniform float skinAmbient;
uniform vec4 skinExtra; // soot start z, soot end z
uniform sampler2D decalAtlas;
uniform vec4 decalA[${MAX_DECALS}];
uniform vec4 decalB[${MAX_DECALS}];
uniform int decalCount;
varying vec3 vSkinPos;
varying vec3 vSkinNormal;
float skinHash(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
float skinHash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float skinNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(skinHash2(i), skinHash2(i + vec2(1, 0)), f.x),
             mix(skinHash2(i + vec2(0, 1)), skinHash2(i + vec2(1, 1)), f.x), f.y);
}
// x: panel line coverage, y: rivet coverage, z: panel tone (-1..1).
// x: line, y: rivet, z: panel tone (-1..1), w: seam proximity for grime.
vec4 skinPanels(vec2 p, float S, float seed) {
  float px = max(length(vec2(dFdx(p.x), dFdy(p.x))), length(vec2(dFdx(p.y), dFdy(p.y))));
  // Long stringer bands along the flow, frames staggered per band, and some
  // frames dropped so panels merge into longer skins.
  float bandH = S * 0.62;
  float band = floor(p.y / bandH);
  float hb = skinHash(band * 1.37 + seed);
  float colW = S * mix(0.75, 1.45, hb);
  float x = p.x / colW + skinHash(band * 5.1 + seed * 3.1);
  float col = floor(x);
  float hr = skinHash(col * 17.0 + band * 3.7 + seed);
  vec2 cell = vec2(colW, bandH);
  vec2 local = vec2(fract(x) * colW, p.y - band * bandH);
  float left = skinHash(col * 7.7 + band * 1.9 + seed) > 0.35 ? local.x : 1e3;
  float right = skinHash((col + 1.0) * 7.7 + band * 1.9 + seed) > 0.35 ? colW - local.x : 1e3;
  // Every other band boundary is a full-length stringer; the rest are partial.
  float bottom = (mod(band, 2.0) < 0.5 || hr > 0.45) ? local.y : 1e3;
  float top = (mod(band + 1.0, 2.0) < 0.5 || skinHash(col * 17.0 + (band + 1.0) * 3.7 + seed) > 0.45) ? bandH - local.y : 1e3;
  vec2 edge = vec2(min(left, right), min(bottom, top));
  float d = min(edge.x, edge.y);
  // Box-filtered line: thin and crisp up close, fading to a faint tone at range.
  float w = 0.0065 * S;
  float line = clamp((w + 0.5 * px - d) / px, 0.0, 1.0) * clamp(2.0 * w / px, 0.0, 1.0);
  if (hr > 0.9) {
    // Occasional small access hatch: tight corners, finer and fainter than
    // the structural joints, so it reads as a flush panel rather than a decal.
    vec2 hs = cell * vec2(mix(0.08, 0.18, fract(hr * 7.3)), mix(0.14, 0.24, fract(hr * 3.1)));
    vec2 centre = cell * vec2(mix(0.25, 0.75, fract(hr * 11.0)), mix(0.35, 0.65, fract(hr * 5.7)));
    float r = 0.008 * S;
    vec2 q = abs(local - centre) - hs + r;
    float box = abs(length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r);
    float wh = w * 0.6;
    line = max(line, 0.55 * clamp((wh + 0.5 * px - box) / px, 0.0, 1.0) * clamp(2.0 * wh / px, 0.0, 1.0));
  }
  float pitch = 0.07 * S, inset = 0.028 * S, rr = 0.0065 * S;
  vec2 rv = vec2(length(vec2(edge.x - inset, (fract(local.y / pitch) - 0.5) * pitch)),
                 length(vec2(edge.y - inset, (fract(local.x / pitch) - 0.5) * pitch)));
  float rivet = (1.0 - smoothstep(rr, rr + px, min(rv.x, rv.y))) * (1.0 - smoothstep(rr * 0.5, rr * 1.5, px));
  float seam = exp(-d / (0.05 * S));
  return vec4(line, rivet, hr * 2.0 - 1.0, seam);
}
`;
const fragmentColor = /* glsl */ `
vec3 skinN = normalize(vSkinNormal);
vec3 skinW = pow(abs(skinN), vec3(6.0));
skinW /= skinW.x + skinW.y + skinW.z;
float skinS = skinParams.x;
vec4 skinSide = skinPanels(vec2(vSkinPos.z, vSkinPos.y), skinS, skinParams.w);
vec4 skinTop = skinPanels(vec2(vSkinPos.z, abs(vSkinPos.x)), skinS, skinParams.w + 9.0);
vec4 skinFront = skinW.z > 0.02 ? skinPanels(vec2(vSkinPos.y * 1.3, abs(vSkinPos.x) * 1.3), skinS, skinParams.w + 4.0) : vec4(0.0);
vec4 skin = skinSide * skinW.x + skinTop * skinW.y + skinFront * skinW.z;
float skinGrime = skinNoise(vec2(vSkinPos.z * 0.22 / skinS, (vSkinPos.y + abs(vSkinPos.x)) * 2.6 / skinS)) * 0.65
  + skinNoise(vec2(vSkinPos.z * 0.9 / skinS, (vSkinPos.y - abs(vSkinPos.x)) * 7.0 / skinS)) * 0.35;
skinGrime = smoothstep(0.35, 0.95, skinGrime) * skinParams.z;
// Flow streaks run aft along the skin; mottling breaks up the paint; soot
// darkens the rear fuselage ahead of the nozzles.
vec2 skinFlowSide = vec2(vSkinPos.z, vSkinPos.y), skinFlowTop = vec2(vSkinPos.z, abs(vSkinPos.x));
float skinStreak = (skinNoise(vec2(skinFlowSide.x * 0.12, skinFlowSide.y * 9.0) / skinS) * 0.6
  + skinNoise(vec2(skinFlowSide.x * 0.35, skinFlowSide.y * 22.0) / skinS) * 0.4) * (skinW.x + skinW.z * 0.5)
  + (skinNoise(vec2(skinFlowTop.x * 0.12, skinFlowTop.y * 9.0) / skinS + 17.0) * 0.6
  + skinNoise(vec2(skinFlowTop.x * 0.35, skinFlowTop.y * 22.0) / skinS + 17.0) * 0.4) * (skinW.y + skinW.z * 0.5);
skinStreak = smoothstep(0.48, 0.9, skinStreak) * skinParams.z;
float skinMottle = (skinNoise(vec2(vSkinPos.z, vSkinPos.x + vSkinPos.y * 0.7) * 0.3 / skinS) - 0.5) * skinParams.z;
float skinSoot = skinExtra.y > skinExtra.x ? smoothstep(skinExtra.x, skinExtra.y, vSkinPos.z) : 0.0;
float skinSeam = skin.w * skinParams.z;
// Projected markings.
float skinDecal = 0.0;
vec3 skinDx = dFdx(vSkinPos), skinDy = dFdy(vSkinPos);
for (int i = 0; i < ${MAX_DECALS}; i++) {
  if (i >= decalCount) break;
  vec4 a = decalA[i];
  vec4 b = decalB[i];
  float face = floor(a.w + 0.5);
  float sideMode = b.w >= 100.0 ? 1.0 : b.w >= 50.0 ? -1.0 : 0.0;
  float slot = mod(b.w, 50.0);
  float sx = vSkinPos.x >= 0.0 ? 1.0 : -1.0;
  if (sideMode != 0.0 && sideMode != sx) continue;
  float cx = sideMode == 0.0 ? sx * abs(a.x) : a.x;
  vec2 uv, gx, gy;
  if (face < 0.5) {
    if (abs(vSkinPos.x - cx) > b.z || skinN.x * sx < 0.3) continue;
    uv = vec2(sx * (a.z - vSkinPos.z) / b.x, (vSkinPos.y - a.y) / b.y) + 0.5;
    gx = vec2(-sx * skinDx.z / b.x, skinDx.y / b.y);
    gy = vec2(-sx * skinDy.z / b.x, skinDy.y / b.y);
  } else {
    float sy = face < 1.5 ? 1.0 : -1.0;
    if (abs(vSkinPos.y - a.y) > b.z || skinN.y * sy < 0.3) continue;
    uv = vec2(sy * (vSkinPos.x - cx) / b.x, (a.z - vSkinPos.z) / b.y) + 0.5;
    gx = vec2(sy * skinDx.x / b.x, -skinDx.z / b.y);
    gy = vec2(sy * skinDy.x / b.x, -skinDy.z / b.y);
  }
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
  vec2 atlasCell = vec2(mod(slot, 4.0), floor(slot / 4.0));
  vec2 atlasUv = vec2((atlasCell.x + uv.x) / 4.0, 1.0 - (atlasCell.y + 1.0 - uv.y) / 2.0);
  vec4 ink = textureGrad(decalAtlas, atlasUv, gx * vec2(0.25, 0.5), gy * vec2(0.25, 0.5));
  float alpha = ink.a * fract(a.w) * 2.0;
  diffuseColor.rgb = mix(diffuseColor.rgb, ink.rgb, alpha);
  skinDecal = max(skinDecal, alpha);
}
diffuseColor.rgb *= 1.0 + skin.z * 0.04 + skinMottle * 0.12;
diffuseColor.rgb *= 1.0 - skinGrime * 0.17 - skinStreak * 0.13 - skinSeam * 0.09;
diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.3, 0.29, 0.28), skinSoot * (0.45 + 0.35 * skinStreak));
diffuseColor.rgb *= 1.0 - skin.x * 0.72 * skinParams.y;
diffuseColor.rgb *= 1.0 - skin.y * 0.28 * skinParams.y;
`;
const fragmentRoughness = /* glsl */ `
roughnessFactor = clamp(roughnessFactor + skin.x * 0.3 * skinParams.y + skinGrime * 0.14 + skinStreak * 0.1 + skinSeam * 0.05 + skinSoot * 0.25 + skin.z * 0.035 + skinDecal * 0.06, 0.04, 1.0);
`;

// Heat-discoloured titanium: straw and bronze where the nozzle meets the
// fuselage, violet and blue across the petals, burnt grey at the lip.
const heatFragmentHead = /* glsl */ `
uniform vec2 heatRange;
varying vec3 vSkinPos;
varying vec3 vSkinNormal;
float heatHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float heatNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(heatHash(i), heatHash(i + vec2(1, 0)), f.x),
             mix(heatHash(i + vec2(0, 1)), heatHash(i + vec2(1, 1)), f.x), f.y);
}
vec3 heatTint(float t) {
  vec3 c = mix(vec3(0.52, 0.5, 0.46), vec3(0.62, 0.47, 0.25), smoothstep(0.0, 0.22, t));
  c = mix(c, vec3(0.5, 0.29, 0.17), smoothstep(0.18, 0.42, t));
  c = mix(c, vec3(0.32, 0.22, 0.36), smoothstep(0.38, 0.6, t));
  c = mix(c, vec3(0.22, 0.31, 0.46), smoothstep(0.55, 0.72, t));
  c = mix(c, vec3(0.17, 0.16, 0.15), smoothstep(0.7, 0.92, t));
  // Weathered, not polished: keep only a hint of the oxide colours.
  return mix(vec3(dot(c, vec3(0.3, 0.5, 0.2))), c, 0.6);
}
`;
const heatFragmentColor = /* glsl */ `
vec3 heatN = normalize(vSkinNormal);
// Streaks run along the petals: angle about the local surface, not a fixed axis.
// Faces pointing straight aft have no angle; atan(0, 0) is undefined in GLSL.
float heatAngle = length(heatN.xy) > 1e-3 ? atan(heatN.y, heatN.x) : 0.0;
float heatStreak = heatNoise(vec2(heatAngle * 9.0, vSkinPos.z * 1.4)) * 0.65 + heatNoise(vec2(heatAngle * 31.0, vSkinPos.z * 4.0)) * 0.35;
float heatT = clamp((vSkinPos.z - heatRange.x) / (heatRange.y - heatRange.x) + (heatStreak - 0.5) * 0.3, 0.0, 1.0);
float heatLum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
diffuseColor.rgb = heatTint(heatT) * clamp(heatLum / 0.2, 0.18, 1.2) * (0.6 + 0.3 * heatStreak);
`;
const heatFragmentRoughness = /* glsl */ `
roughnessFactor = clamp(0.38 + heatStreak * 0.22 + heatT * 0.15, 0.05, 1.0);
`;

function heatMaterial(source: T.MeshStandardMaterial, range: [number, number], inverse: { value: T.Matrix4 }) {
  const material = source.clone();
  material.metalness = 0.85;
  material.envMapIntensity = 1;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, { skinInverse: inverse, heatRange: { value: new T.Vector2(...range) } });
    shader.vertexShader = vertexHead + shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n${vertexBody}`);
    shader.fragmentShader =
      heatFragmentHead +
      shader.fragmentShader
        .replace("#include <color_fragment>", `#include <color_fragment>\n${heatFragmentColor}`)
        .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${heatFragmentRoughness}`);
  };
  material.customProgramCacheKey = () => "aircraft-heat";
  return material;
}

// Glass adds only its reflections and filters what lies behind it through a
// constant tint. Alpha blending would fade the reflections that show the
// bubble's curvature and lay a lit, milky veil over the cockpit.
const glassOutput = /* glsl */ `
#include <opaque_fragment>
vec3 glassSpecular = totalSpecular;
#ifdef USE_CLEARCOAT
glassSpecular += (clearcoatSpecularDirect + clearcoatSpecularIndirect) * material.clearcoat;
#endif
gl_FragColor = vec4(glassSpecular, 1.0);
`;

function styleGlass(material: T.MeshPhysicalMaterial, tint: string, density: number) {
  const hue = new T.Color(tint);
  hue.multiplyScalar(1 / Math.max(hue.r, hue.g, hue.b, 1e-4));
  material.blending = T.CustomBlending;
  material.blendSrc = T.OneFactor;
  material.blendDst = T.ConstantColorFactor;
  material.blendColor = new T.Color(1, 1, 1).lerp(hue, 0.35).multiplyScalar(1 - density);
  material.side = T.FrontSide;
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace("#include <opaque_fragment>", glassOutput);
  };
  material.customProgramCacheKey = () => "aircraft-glass";
  material.needsUpdate = true;
}

function luminance(c: T.Color) {
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
}

function decalUniforms(decals: Decal[]) {
  const a = Array.from({ length: MAX_DECALS }, () => new T.Vector4());
  const b = Array.from({ length: MAX_DECALS }, () => new T.Vector4());
  decals.slice(0, MAX_DECALS).forEach((d, i) => {
    const face = d.face === "side" ? 0 : d.face === "top" ? 1 : 2;
    // Opacity rides in the fractional part of the face code (0..0.5).
    a[i].set(d.at[0], d.at[1], d.at[2], face + (d.opacity ?? 1) * 0.4999);
    const side = d.side === 1 ? 100 : d.side === -1 ? 50 : 0;
    b[i].set(d.size[0], d.size[1], d.depth, side + SLOTS.indexOf(d.slot));
  });
  return { a, b, count: Math.min(decals.length, MAX_DECALS) };
}

const skyLights = new WeakMap<T.Object3D, T.HemisphereLight[]>();
/** Scale hemisphere fill so its total matches the viewer's 0.5 budget. */
function ambientBalance(scene: T.Object3D) {
  let lights = skyLights.get(scene);
  if (!lights) {
    lights = [];
    scene.traverse((o) => {
      if (o instanceof T.HemisphereLight) lights!.push(o);
    });
    skyLights.set(scene, lights);
  }
  const total = lights.reduce((sum, light) => sum + light.intensity, 0);
  return total > 0.5 ? 0.5 / total : 1;
}

/** Upgrade an aircraft's materials in place. Returns false for unknown models. */
export function applyAircraftFinish(root: T.Object3D) {
  const finish = finishes.find((f) => root.getObjectByName(f.root));
  const environment = aircraftSky();
  const paints = new Set<T.MeshPhysicalMaterial>();
  const meshes = new Set<T.Mesh>();
  const plain = new Map<T.Material, T.Material>();
  const swap = new Map<T.Material, T.Material>();
  const interior = (object: T.Object3D) => {
    for (let node: T.Object3D | null = object; node && node !== root; node = node.parent)
      if (/^(Pilot_|Seat_|Ejection_|Instrument_|Display_|Round_instrument|Cockpit_side_console|Control_|Throttle_|HUD_|Panel_mount|Console_mount)/.test(node.name)) return true;
    return false;
  };
  root.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!(material instanceof T.MeshStandardMaterial)) continue;
      material.envMap = environment;
      if (!finish) continue;
      if (
        /glass|glazing/i.test(material.name) &&
        material instanceof T.MeshPhysicalMaterial &&
        material.color.g <= material.color.b * 1.2 // skip green HUD combiners
      ) {
        material.color.set(finish.canopy.tint);
        material.opacity = finish.canopy.opacity;
        material.roughness = 0.04;
        material.metalness = 0.1;
        material.clearcoat = 1;
        material.clearcoatRoughness = 0.02;
        material.envMapIntensity = 1.6;
        material.iridescence = finish.canopy.iridescence;
        material.iridescenceIOR = 1.7;
        material.iridescenceThicknessRange = [260, 520];
        material.specularIntensity = 1;
        styleGlass(material, finish.canopy.tint, finish.canopy.opacity);
      } else if (
        material instanceof T.MeshPhysicalMaterial &&
        finish.exterior.test(material.name) &&
        luminance(material.color) > 0.02
      ) {
        if (interior(object)) {
          // Cockpit occupants and fittings keep a plain finish.
          if (!plain.has(material)) plain.set(material, material.clone());
          swap.set(material, plain.get(material)!);
        } else {
          paints.add(material);
          meshes.add(object);
        }
      } else if (material.metalness > 0.7) {
        material.envMapIntensity = 1.1;
      }
    }
  });
  if (swap.size)
    root.traverse((object) => {
      if (!(object instanceof T.Mesh) || !interior(object)) return;
      object.material = Array.isArray(object.material)
        ? object.material.map((m) => swap.get(m) ?? m)
        : (swap.get(object.material) ?? object.material);
    });
  if (!finish) return false;
  const inverse = { value: new T.Matrix4() };
  if (finish.heat) {
    const { match, z } = finish.heat;
    const hot = new Map<T.Material, T.Material>();
    root.traverse((object) => {
      if (!(object instanceof T.Mesh) || !(object.material instanceof T.MeshStandardMaterial)) return;
      if (!match.test(object.name) && !match.test(object.material.name)) return;
      if (!hot.has(object.material)) hot.set(object.material, heatMaterial(object.material, z, inverse));
      object.material = hot.get(object.material)!;
      meshes.add(object);
    });
  }
  const atlas = typeof document === "undefined" ? null : drawAtlas(finish.markings);
  const decals = decalUniforms(atlas ? finish.decals : []);
  const params = new T.Vector4(finish.panel, finish.lines, finish.grime, 3.7);
  const ambient = { value: 1 };
  for (const material of paints) {
    const grey = luminance(material.color);
    material.color.lerp(new T.Color(grey, grey, grey * 1.04), finish.paint.desaturate).multiplyScalar(finish.paint.albedo);
    material.metalness = finish.paint.metalness;
    material.roughness = finish.paint.roughness;
    material.clearcoat = finish.paint.clearcoat;
    material.clearcoatRoughness = finish.paint.coatRoughness;
    material.envMapIntensity = 1;
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, {
        skinInverse: inverse,
        skinParams: { value: params },
        skinAmbient: ambient,
        skinExtra: { value: new T.Vector4(finish.soot?.[0] ?? 0, finish.soot?.[1] ?? 0, 0, 0) },
        decalAtlas: { value: atlas },
        decalA: { value: decals.a },
        decalB: { value: decals.b },
        decalCount: { value: decals.count },
      });
      shader.vertexShader = vertexHead + shader.vertexShader.replace("#include <project_vertex>", `#include <project_vertex>\n${vertexBody}`);
      shader.fragmentShader =
        fragmentHead +
        shader.fragmentShader
          .replace("#include <color_fragment>", `#include <color_fragment>\n${fragmentColor}`)
          .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\n${fragmentRoughness}`)
          // The sky map already supplies ambient light; damp bright hemisphere fill.
          .replace("#include <lights_fragment_maps>", "#include <lights_fragment_maps>\nirradiance *= skinAmbient;");
    };
    material.customProgramCacheKey = () => "aircraft-skin";
    material.needsUpdate = true;
  }
  // The frame matrix is shared by every skin material and re-uploaded at the
  // first draw of each material per render, so keep it current per frame.
  for (const mesh of meshes) {
    const previous = mesh.onBeforeRender;
    mesh.onBeforeRender = function (...args) {
      inverse.value.copy(root.matrixWorld).invert();
      ambient.value = ambientBalance(args[1]);
      previous.apply(this, args);
    };
  }
  if (atlas) root.userData.aircraftDecalAtlas = atlas;
  return true;
}
