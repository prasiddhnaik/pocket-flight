import * as T from "three";
import { rangeLayout, rangeSurface } from "../world/range-island";
import { runways, terrainHeight } from "../world/terrain";
import { isProLineKind, ProLineSuite } from "./aurelia/pro-line-displays";
import { chartRegion, navigationLabel } from "./cockpit-displays";
import type { CockpitSpec, CockpitState, HudGeometry } from "./cockpit-state";

const DEG = 180 / Math.PI;
const FEET = 3.28084;
const KNOTS = 1.943844;
const NM = 1852;
// Eye-to-combiner geometry from the Blender build, so the symbols line up with the world outside.
export const F15C_HUD: HudGeometry = { distance: 1.1, height: 0.244, eyeAbove: 0.033 };
const GREEN = "#5cff95";
const FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";
type Ctx = CanvasRenderingContext2D;

const wrap360 = (degrees: number) => ((degrees % 360) + 360) % 360;
const three = (degrees: number) => String(Math.round(wrap360(degrees)) % 360).padStart(3, "0");

function label(c: Ctx, value: string, x: number, y: number, size: number, colour: string, align: CanvasTextAlign = "left") {
  c.font = `700 ${size}px ${FONT}`;
  c.fillStyle = colour;
  c.textAlign = align;
  c.textBaseline = "middle";
  c.fillText(value, x, y);
}
function line(c: Ctx, x0: number, y0: number, x1: number, y1: number) {
  c.beginPath();
  c.moveTo(x0, y0);
  c.lineTo(x1, y1);
  c.stroke();
}

function bearingTo(s: CockpitState, x: number, z: number) {
  return Math.atan2(x - s.x, -(z - s.z));
}
function relative(radians: number) {
  return Math.atan2(Math.sin(radians), Math.cos(radians));
}

/** Pixels on the glass for one degree outside, for a canvas this tall. */
export function hudScale(height: number, hud: HudGeometry = F15C_HUD) {
  return (Math.tan(1 / DEG) * hud.distance * height) / hud.height;
}

export function drawHud(c: Ctx, width: number, height: number, s: CockpitState, hud: HudGeometry = F15C_HUD) {
  c.fillStyle = "#000";
  c.fillRect(0, 0, width, height);
  c.strokeStyle = GREEN;
  c.lineWidth = 4;
  c.lineCap = "round";
  const scale = hudScale(height, hud);
  const cx = width / 2;
  const bore = height / 2 - (hud.eyeAbove / hud.height) * height;
  const knots = s.speed * KNOTS;
  const feet = s.altitude * FEET;

  // Pitch ladder, turned by the bank about the boresight.
  c.save();
  c.translate(cx, bore);
  c.rotate(s.roll);
  const pitch = s.pitch * DEG;
  for (let angle = -85; angle <= 85; angle += 5) {
    const y = (pitch - angle) * scale;
    if (Math.abs(y) > height) continue;
    if (angle === 0) {
      line(c, -width, y, -70, y);
      line(c, 70, y, width, y);
      continue;
    }
    const outer = 112, inner = 50;
    if (angle < 0) c.setLineDash([16, 12]);
    for (const side of [-1, 1]) {
      line(c, side * inner, y, side * outer, y);
      line(c, side * outer, y, side * outer, y + (angle > 0 ? 16 : -16));
      label(c, String(Math.abs(angle)), side * (outer + 12), y, 28, GREEN, side > 0 ? "left" : "right");
    }
    c.setLineDash([]);
  }
  c.restore();

  // Waterline, then the flight path marker sitting below it by the angle of attack.
  line(c, cx - 26, bore, cx - 10, bore);
  line(c, cx + 10, bore, cx + 26, bore);
  line(c, cx - 10, bore, cx, bore + 8);
  line(c, cx + 10, bore, cx, bore + 8);
  const pathY = T.MathUtils.clamp(bore + s.aoa * scale, 60, height - 60);
  c.beginPath();
  c.arc(cx, pathY, 16, 0, Math.PI * 2);
  c.stroke();
  line(c, cx - 44, pathY, cx - 16, pathY);
  line(c, cx + 16, pathY, cx + 44, pathY);
  line(c, cx, pathY - 16, cx, pathY - 32);

  // Heading tape.
  const heading = s.heading * DEG;
  const tape = 7;
  for (let mark = Math.ceil((heading - 40) / 5) * 5; mark <= heading + 40; mark += 5) {
    const x = cx + relative((mark - heading) / DEG) * DEG * tape;
    const major = wrap360(mark) % 10 === 0;
    line(c, x, 74, x, major ? 58 : 66);
    if (wrap360(mark) % 30 === 0) label(c, String(Math.round(wrap360(mark) / 10)).padStart(2, "0"), x, 90, 22, GREEN, "center");
  }
  c.clearRect(cx - 58, 14, 116, 42);
  c.fillStyle = "#000";
  c.fillRect(cx - 58, 14, 116, 42);
  c.strokeRect(cx - 58, 14, 116, 42);
  label(c, three(heading), cx, 36, 36, GREEN, "center");
  if (s.target) {
    const offset = relative(bearingTo(s, s.target.x, s.target.z) - s.heading) * DEG;
    const x = cx + T.MathUtils.clamp(offset, -40, 40) * tape;
    c.beginPath();
    c.moveTo(x, 98);
    c.lineTo(x - 11, 116);
    c.lineTo(x + 11, 116);
    c.closePath();
    c.stroke();
  }

  // Speed and altitude boxes either side of the boresight.
  c.strokeRect(14, bore - 26, 118, 52);
  label(c, String(Math.round(knots)), 124, bore, 40, GREEN, "right");
  c.strokeRect(width - 148, bore - 26, 134, 52);
  label(c, String(Math.round(feet / 10) * 10), width - 22, bore, 40, GREEN, "right");
  label(c, `M ${(s.speed / 340).toFixed(2)}`, 18, bore + 56, 26, GREEN);
  label(c, `G ${s.gLoad.toFixed(1)}`, 18, bore + 90, 26, GREEN);
  label(c, `AOA ${Math.round(s.aoa * 1.75)}`, 18, bore + 124, 26, GREEN);
  const climb = s.verticalSpeed * FEET * 60;
  label(c, `${climb >= 0 ? "+" : ""}${Math.round(climb / 100) * 100}`, width - 18, bore + 56, 26, GREEN, "right");
  label(c, `T ${Math.round(s.power * 100)}`, width - 18, bore + 90, 26, GREEN, "right");

  // Landing and weapons cues along the bottom of the glass.
  if (s.slowingToLand) {
    const error = knots - s.approachKnots;
    label(c, `APP ${s.approachKnots}`, 18, height - 86, 30, GREEN);
    label(c, error > 5 ? "FAST" : error < -5 ? "SLOW" : "ON SPD", 18, height - 52, 28, GREEN);
  }
  const state = [s.gear > 0.995 ? "GEAR" : s.gear > 0.005 ? "GEAR TR" : "", s.flaps > 0.05 ? "FLAP" : "", s.speedBrake > 0.05 ? "SPD BK" : ""].filter(Boolean).join(" ");
  label(c, state, cx, height - 24, 26, GREEN, "center");
  if (s.stores) {
    label(c, `GUN ${s.stores.gun}`, width - 18, height - 120, 28, GREEN, "right");
    label(c, `RKT ${s.stores.rockets}`, width - 18, height - 88, 28, GREEN, "right");
    label(c, `AAM ${s.stores.missiles}`, width - 18, height - 56, 28, GREEN, "right");
    if (s.stores.locked) label(c, "LOCK", cx, pathY + 66, 36, GREEN, "center");
  }
  if (s.stall && Math.sin(s.time * 12) > -0.3) label(c, "STALL", cx, pathY - 72, 48, GREEN, "center");
  if (s.engineOut && Math.sin(s.time * 8) > -0.3) label(c, "ENG OUT", cx, height - 70, 34, GREEN, "center");
}

export function drawVsd(c: Ctx, size: number, s: CockpitState) {
  const ink = "#57f08c", dim = "#1d6e45";
  c.fillStyle = "#031109";
  c.fillRect(0, 0, size, size);
  const left = 44, right = size - 18, top = 54, bottom = size - 54;
  const cx = (left + right) / 2;
  const rangeMetres = 6000;
  c.strokeStyle = dim;
  c.lineWidth = 2;
  c.strokeRect(left, top, right - left, bottom - top);
  for (let i = 1; i < 4; i++) {
    const y = top + ((bottom - top) * i) / 4;
    line(c, left, y, right, y);
    const x = left + ((right - left) * i) / 4;
    line(c, x, top, x, bottom);
  }
  // A faint clutter pattern that changes with each radar bar.
  const bar = Math.floor(s.time * 1.5);
  c.fillStyle = "#1f8a56";
  for (let i = 0; i < 28; i++) {
    const a = Math.sin((i + 1) * 12.9898 + bar * 78.233) * 43758.5453;
    const b = Math.sin((i + 1) * 39.346 + bar * 11.135) * 24634.6345;
    const x = left + (a - Math.floor(a)) * (right - left);
    const y = bottom - (b - Math.floor(b)) ** 2 * (bottom - top) * 0.4;
    c.fillRect(x, y, 4, 2);
  }
  // Antenna sweep with a short fading trail.
  const sweep = Math.sin(s.time * 1.1);
  for (let i = 0; i < 4; i++) {
    c.strokeStyle = i === 0 ? ink : dim;
    c.globalAlpha = 1 - i * 0.24;
    const x = cx + Math.sin(s.time * 1.1 - i * 0.09) * ((right - left) / 2);
    line(c, x, top, x, bottom);
  }
  c.globalAlpha = 1;
  c.strokeStyle = ink;
  line(c, cx + sweep * ((right - left) / 2) - 8, bottom + 10, cx + sweep * ((right - left) / 2) + 8, bottom + 10);
  // Contacts: azimuth across, range up the scope.
  c.fillStyle = ink;
  let shown = 0;
  for (const contact of s.contacts) {
    const rel = relative(bearingTo(s, contact.x, contact.z) - s.heading);
    const range = Math.hypot(contact.x - s.x, contact.z - s.z);
    if (Math.abs(rel) > 1.05 || range > rangeMetres) continue;
    const x = cx + (rel / 1.05) * ((right - left) / 2);
    const y = bottom - (range / rangeMetres) * (bottom - top);
    c.fillRect(x - 8, y - 5, 16, 10);
    label(c, String(Math.round((contact.y * FEET) / 1000)), x + 12, y, 22, ink);
    shown++;
  }
  label(c, "RWS", 14, 28, 26, ink);
  label(c, `${s.contacts.length ? shown : 0} TGT`, cx, 28, 24, ink, "center");
  label(c, three(s.heading * DEG), size - 14, 28, 26, ink, "right");
  label(c, `${Math.round(s.speed * KNOTS)} KT`, 14, size - 24, 24, ink);
  label(c, `${Math.round((s.altitude * FEET) / 100) * 100} FT`, size - 14, size - 24, 24, ink, "right");
  if (!s.contacts.length) label(c, "NO TGT", cx, top + (bottom - top) * 0.36, 30, dim, "center");
}

export function drawTews(c: Ctx, size: number, s: CockpitState) {
  const ink = "#6dffa0", dim = "#217348";
  c.fillStyle = "#020a06";
  c.fillRect(0, 0, size, size);
  const cx = size / 2, cy = size / 2, radius = size * 0.45;
  c.strokeStyle = dim;
  c.lineWidth = 2;
  for (const r of [0.33, 0.66, 1]) {
    c.beginPath();
    c.arc(cx, cy, radius * r, 0, Math.PI * 2);
    c.stroke();
  }
  // Compass ticks turn with the aircraft; the top of the scope is the nose.
  for (let mark = 0; mark < 360; mark += 30) {
    const a = mark / DEG - s.heading;
    line(c, cx + Math.sin(a) * radius * 0.93, cy - Math.cos(a) * radius * 0.93, cx + Math.sin(a) * radius, cy - Math.cos(a) * radius);
    if (mark % 90 === 0)
      label(c, ["N", "E", "S", "W"][mark / 90], cx + Math.sin(a) * radius * 0.84, cy - Math.cos(a) * radius * 0.84, 24, dim, "center");
  }
  c.strokeStyle = ink;
  c.lineWidth = 3;
  line(c, cx - 18, cy, cx + 18, cy);
  line(c, cx, cy - 22, cx, cy + 18);
  line(c, cx - 8, cy + 18, cx + 8, cy + 18);
  const scope = 6000;
  let inside = 0;
  for (const contact of s.contacts) {
    const a = bearingTo(s, contact.x, contact.z) - s.heading;
    const distance = Math.hypot(contact.x - s.x, contact.z - s.z);
    if (distance > scope) continue;
    inside++;
    const r = (distance / scope) * radius;
    label(c, contact.air ? "A" : "G", cx + Math.sin(a) * r, cy - Math.cos(a) * r, 30, ink, "center");
  }
  label(c, inside ? `${inside} CONTACT` : "CLEAR", cx, cy + radius * 0.56, 26, inside ? ink : dim, "center");
}

/** Terrain tint for the colour map, drawn once per island. */
function paintChart(size: number, chart: ReturnType<typeof chartRegion>) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const c = canvas.getContext("2d")!;
  const image = c.createImageData(size, size);
  const inRange = chart.id !== "palm-bay";
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const wx = chart.centerX + (x / (size - 1) - 0.5) * chart.size;
      const wz = chart.centerZ + (y / (size - 1) - 0.5) * chart.size;
      const height = inRange ? (rangeSurface(wx, wz) ?? -1) : terrainHeight(wx, wz);
      const land = height > 0.5;
      const i = (y * size + x) * 4;
      image.data[i] = land ? 52 + Math.min(height, 400) * 0.14 : 16;
      image.data[i + 1] = land ? 86 + Math.min(height, 400) * 0.09 : 44;
      image.data[i + 2] = land ? 54 : 76;
      image.data[i + 3] = 255;
    }
  c.putImageData(image, 0, 0);
  return canvas;
}

const KEYS = ["NAV", "ARM", "FUEL", "ENG", "BIT"];
// Attitude displays stay smooth; the rest take turns so only one uploads each tick.
const SMOOTH: readonly CockpitSpec["screens"][number]["kind"][] = ["hud", "flight", "pfd", "esis"];

export function drawMpcd(c: Ctx, size: number, s: CockpitState, chart?: CanvasImageSource, fuelPounds = 13455) {
  const white = "#eef3ea", amber = "#ffc24a", cyan = "#7fe7ff";
  c.fillStyle = "#04080b";
  c.fillRect(0, 0, size, size);
  const inset = 58;
  const view = size - inset * 2;
  KEYS.forEach((key, i) => {
    const x = (size * (i + 0.5)) / 5;
    const selected = (key === "ARM") === Boolean(s.stores) && (key === "NAV" || key === "ARM");
    if (selected) {
      c.fillStyle = white;
      c.fillRect(x - 40, 8, 80, 34);
    }
    label(c, key, x, 25, 26, selected ? "#04080b" : white, "center");
  });
  if (s.stores) {
    label(c, "STORES", size / 2, inset + 16, 28, amber, "center");
    c.strokeStyle = white;
    c.lineWidth = 3;
    const cx = size / 2, cy = size / 2 + 8;
    // Plan view of the Eagle with its stations.
    c.beginPath();
    c.moveTo(cx, cy - 118);
    c.lineTo(cx + 22, cy - 44);
    c.lineTo(cx + 134, cy + 30);
    c.lineTo(cx + 134, cy + 62);
    c.lineTo(cx + 38, cy + 40);
    c.lineTo(cx + 56, cy + 110);
    c.lineTo(cx - 56, cy + 110);
    c.lineTo(cx - 38, cy + 40);
    c.lineTo(cx - 134, cy + 62);
    c.lineTo(cx - 134, cy + 30);
    c.lineTo(cx - 22, cy - 44);
    c.closePath();
    c.stroke();
    label(c, `GUN ${s.stores.gun}`, inset, size - inset - 72, 30, cyan);
    label(c, `RKT ${s.stores.rockets}`, inset, size - inset - 38, 30, cyan);
    label(c, `AAM ${s.stores.missiles}`, inset, size - inset - 4, 30, cyan);
    label(c, s.stores.locked ? "LOCK" : "SRCH", size - inset, size - inset - 4, 34, s.stores.locked ? "#ff6a57" : amber, "right");
  } else {
    const region = chartRegion(s.x, s.z);
    if (chart) c.drawImage(chart, inset, inset, view, view);
    const px = (x: number) => inset + ((x - region.centerX) / region.size + 0.5) * view;
    const py = (z: number) => inset + ((z - region.centerZ) / region.size + 0.5) * view;
    c.lineWidth = 6;
    c.strokeStyle = "#f0e6b0";
    for (const runway of runways) {
      const half = (runway.length / region.size) * view * 0.5;
      const x = px(runway.x), y = py(runway.z);
      if (x < inset || x > size - inset || y < inset || y > size - inset) continue;
      line(c, x - Math.sin(runway.heading) * half, y - Math.cos(runway.heading) * half, x + Math.sin(runway.heading) * half, y + Math.cos(runway.heading) * half);
    }
    if (s.target) {
      c.strokeStyle = amber;
      c.lineWidth = 3;
      line(c, px(s.x), py(s.z), px(s.target.x), py(s.target.z));
      c.strokeRect(px(s.target.x) - 9, py(s.target.z) - 9, 18, 18);
    }
    c.save();
    c.translate(T.MathUtils.clamp(px(s.x), inset, size - inset), T.MathUtils.clamp(py(s.z), inset, size - inset));
    c.rotate(s.heading);
    c.strokeStyle = white;
    c.lineWidth = 4;
    line(c, 0, -22, 0, 18);
    line(c, -18, 2, 18, 2);
    line(c, -8, 18, 8, 18);
    c.restore();
    c.fillStyle = "#04080bcc";
    c.fillRect(inset, size - inset - 32, view, 32);
    label(c, navigationLabel(s.x, s.z), size / 2, size - inset - 16, 24, white, "center");
  }
  c.save();
  c.translate(26, size / 2);
  c.rotate(-Math.PI / 2);
  label(c, `HDG ${three(s.heading * DEG)}`, 0, 0, 24, white, "center");
  c.restore();
  c.save();
  c.translate(size - 26, size / 2);
  c.rotate(Math.PI / 2);
  label(c, `FUEL ${Math.round((s.fuel ?? 0) * fuelPounds)}`, 0, 0, 24, white, "center");
  c.restore();
  label(c, `${Math.round(s.speed * KNOTS)} KT  ${Math.round(s.altitude * FEET)} FT`, size / 2, size - 22, 26, white, "center");
}

export function drawUfc(c: Ctx, width: number, height: number, s: CockpitState, fuelPounds = 13455) {
  const ink = "#6fff9e";
  c.fillStyle = "#041208";
  c.fillRect(0, 0, width, height);
  const rows = [
    s.target
      ? `STR ${three(bearingTo(s, s.target.x, s.target.z) * DEG)}  ${(Math.hypot(s.target.x - s.x, s.target.z - s.z) / NM).toFixed(1)} NM`
      : `HDG ${three(s.heading * DEG)}  DIRECT`,
    `FUEL ${Math.round((s.fuel ?? 0) * fuelPounds)} LB`,
    `UHF 275.80   TCN 085X`,
    s.slowingToLand ? `APP ${s.approachKnots} KT  GEAR ${s.gear > 0.995 ? "DN" : "UP"}` : `ALT ${Math.round((s.altitude * FEET) / 10) * 10} FT`,
  ];
  const pitch = height / rows.length;
  rows.forEach((row, i) => label(c, row, 14, (i + 0.5) * pitch, Math.min(32, pitch * 0.78), ink));
}

/** Glass primary flight display: attitude in the middle, speed and altitude tapes either side. */
export function drawFlight(c: Ctx, width: number, height: number, s: CockpitState) {
  const white = "#f2f5ef", cyan = "#58e6ff", magenta = "#ff6ad5", amber = "#ffc24a";
  c.fillStyle = "#05080b";
  c.fillRect(0, 0, width, height);
  const cx = width / 2, cy = height * 0.47, scale = height / 44;
  c.save();
  c.beginPath();
  c.rect(0, 0, width, height);
  c.clip();
  c.translate(cx, cy);
  c.rotate(s.roll);
  const offset = s.pitch * DEG * scale;
  c.fillStyle = "#2a78b6";
  c.fillRect(-width * 1.5, -height * 2 + offset, width * 3, height * 2);
  c.fillStyle = "#6f4a26";
  c.fillRect(-width * 1.5, offset, width * 3, height * 2);
  c.strokeStyle = white;
  c.lineWidth = 3;
  line(c, -width * 1.5, offset, width * 1.5, offset);
  c.lineWidth = 2;
  for (let angle = -40; angle <= 40; angle += 5) {
    if (angle === 0) continue;
    const y = offset - angle * scale;
    if (Math.abs(y) > height * 0.5) continue;
    const half = angle % 10 === 0 ? width * 0.1 : width * 0.05;
    line(c, -half, y, half, y);
    if (angle % 10 === 0) {
      label(c, String(Math.abs(angle)), -half - 6, y, 18, white, "right");
      label(c, String(Math.abs(angle)), half + 6, y, 18, white);
    }
  }
  c.restore();
  // Fixed aircraft symbol and bank pointer.
  c.strokeStyle = amber;
  c.lineWidth = 5;
  line(c, cx - width * 0.17, cy, cx - width * 0.05, cy);
  line(c, cx + width * 0.05, cy, cx + width * 0.17, cy);
  line(c, cx - width * 0.05, cy, cx, cy + 10);
  line(c, cx + width * 0.05, cy, cx, cy + 10);
  // Tapes.
  const tapeW = width * 0.2;
  c.fillStyle = "#05080bdd";
  c.fillRect(0, 0, tapeW, height * 0.86);
  c.fillRect(width - tapeW, 0, tapeW, height * 0.86);
  const knots = s.speed * KNOTS, feet = s.altitude * FEET;
  c.strokeStyle = white;
  c.lineWidth = 2;
  for (let mark = Math.floor(knots / 10) * 10 - 40; mark <= knots + 50; mark += 10) {
    if (mark < 0) continue;
    const y = cy - (mark - knots) * (height / 110);
    line(c, tapeW - 16, y, tapeW, y);
    if (mark % 20 === 0) label(c, String(mark), tapeW - 22, y, 20, white, "right");
  }
  for (let mark = Math.floor(feet / 100) * 100 - 400; mark <= feet + 500; mark += 100) {
    const y = cy - (mark - feet) * (height / 1100);
    line(c, width - tapeW, y, width - tapeW + 16, y);
    if (mark % 200 === 0) label(c, String(mark), width - tapeW + 22, y, 20, white);
  }
  if (s.slowingToLand) {
    const y = cy - (s.approachKnots - knots) * (height / 110);
    c.fillStyle = magenta;
    c.fillRect(tapeW - 10, y - 5, 10, 10);
  }
  c.fillStyle = "#000";
  c.fillRect(6, cy - 22, tapeW - 6, 44);
  c.fillRect(width - tapeW, cy - 22, tapeW - 6, 44);
  c.strokeStyle = white;
  c.strokeRect(6, cy - 22, tapeW - 6, 44);
  c.strokeRect(width - tapeW, cy - 22, tapeW - 6, 44);
  label(c, String(Math.round(knots)), tapeW - 8, cy, 32, white, "right");
  label(c, String(Math.round(feet / 10) * 10), width - tapeW + 8, cy, 28, white);
  // Heading along the bottom.
  c.fillStyle = "#05080b";
  c.fillRect(0, height * 0.86, width, height * 0.14);
  const heading = s.heading * DEG;
  c.strokeStyle = white;
  for (let mark = Math.ceil((heading - 50) / 10) * 10; mark <= heading + 50; mark += 10) {
    const x = cx + relative((mark - heading) / DEG) * DEG * (width / 130);
    line(c, x, height * 0.86, x, height * 0.885);
    if (wrap360(mark) % 30 === 0) label(c, String(Math.round(wrap360(mark) / 10)).padStart(2, "0"), x, height * 0.925, 20, white, "center");
  }
  label(c, three(heading), cx, height * 0.965, 26, cyan, "center");
  if (s.stall) label(c, "STALL", cx, height * 0.2, 44, "#ff5040", "center");
}

/** Engine and systems page, drawn as twin arc gauges with fuel and configuration below. */
export function drawEngines(c: Ctx, width: number, height: number, s: CockpitState, fuelPounds = 13455) {
  const white = "#f2f5ef", green = "#64ff90", amber = "#ffc24a", red = "#ff5040";
  c.fillStyle = "#05080b";
  c.fillRect(0, 0, width, height);
  const value = s.engineOut ? 0 : 0.62 + Math.min(1, s.power / 0.85) * 0.38;
  const arcs: [string, number, string][] = [["N1", value, `${Math.round(value * 100)}`], ["ITT", s.engineOut ? 0.1 : 0.4 + s.power * 0.5, `${Math.round((s.engineOut ? 0.1 : 0.4 + s.power * 0.5) * 1000)}`]];
  arcs.forEach(([name, fraction, text], row) => {
    for (const col of [0, 1]) {
      const x = width * (col ? 0.72 : 0.28), y = height * (0.2 + row * 0.3), r = Math.min(width, height) * 0.13;
      c.strokeStyle = "#39434b";
      c.lineWidth = 8;
      c.beginPath();
      c.arc(x, y, r, Math.PI * 0.75, Math.PI * 2.25);
      c.stroke();
      c.strokeStyle = fraction > 0.92 ? amber : green;
      c.beginPath();
      c.arc(x, y, r, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * Math.min(1, fraction));
      c.stroke();
      label(c, text, x, y + 2, 26, white, "center");
    }
    label(c, name, width / 2, height * (0.2 + row * 0.3), 22, white, "center");
  });
  const lines = [
    `FUEL ${Math.round((s.fuel ?? 0) * fuelPounds)} LB`,
    `GEAR ${s.gear > 0.995 ? "DOWN" : s.gear > 0.005 ? "MOVING" : "UP"}`,
    `FLAPS ${Math.round(s.flaps * 100)}%`,
    s.speedBrake > 0.05 ? "SPEED BRAKE" : "",
  ];
  lines.forEach((text, i) => label(c, text, 22, height * (0.72 + i * 0.075), 24, i === 3 ? amber : white));
  if (s.engineOut) label(c, "ENGINE OUT", width / 2, height * 0.06, 32, red, "center");
}

type Surface = { canvas: HTMLCanvasElement; c: Ctx; texture: T.CanvasTexture; kind: CockpitSpec["screens"][number]["kind"] };

/** The live surfaces. Each redraws on its own cadence, only while the cockpit is in view. */
export class CockpitAvionics {
  private surfaces: Surface[] = [];
  private materials: T.Material[] = [];
  private charts = new Map<string, HTMLCanvasElement>();
  private clock = 0;
  private turn = 0;
  private hudClock = 0;
  private suite: ProLineSuite | null = null;
  constructor(cabin: T.Object3D, private spec: CockpitSpec) {
    for (const screen of spec.screens) this.surface(cabin, screen);
  }
  private surface(cabin: T.Object3D, screen: CockpitSpec["screens"][number]) {
    const canvas = document.createElement("canvas");
    canvas.width = screen.width;
    canvas.height = screen.height;
    const c = canvas.getContext("2d", { alpha: false })!;
    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    // glTF texture coordinates run from the top of the image.
    texture.flipY = false;
    texture.generateMipmaps = false;
    texture.minFilter = T.LinearFilter;
    const additive = screen.kind === "hud";
    const material = new T.MeshBasicMaterial({ map: texture, toneMapped: false });
    if (additive) {
      material.transparent = true;
      material.blending = T.AdditiveBlending;
      material.depthWrite = false;
      material.side = T.DoubleSide;
    }
    // A rear or right-hand seat repeats the same picture.
    for (const name of [screen.node, `Rear_${screen.node}`, `Copilot_${screen.node}`]) {
      cabin.getObjectByName(name)?.traverse((child) => {
        if (child instanceof T.Mesh) {
          (child.material as T.Material).dispose();
          child.material = material;
          if (additive) child.renderOrder = 6;
        }
      });
    }
    this.materials.push(material);
    this.surfaces.push({ canvas, c, texture, kind: screen.kind });
  }
  private chart(s: CockpitState) {
    const region = chartRegion(s.x, s.z);
    let image = this.charts.get(region.id);
    if (!image) {
      image = paintChart(192, region);
      // Anvil Key's heights arrive late, so only keep its chart once they exist.
      if (region.id === "palm-bay" || rangeSurface(rangeLayout.centre.x, rangeLayout.centre.z) !== null) this.charts.set(region.id, image);
    }
    return image;
  }
  private draw(surface: Surface, s: CockpitState) {
    const { c, canvas } = surface;
    const fuel = this.spec.fuelPounds;
    if (surface.kind === "hud") drawHud(c, canvas.width, canvas.height, s, this.spec.hud);
    if (surface.kind === "radar") drawVsd(c, canvas.width, s);
    if (surface.kind === "threat") drawTews(c, canvas.width, s);
    if (surface.kind === "map") drawMpcd(c, canvas.width, s, this.chart(s), fuel);
    if (surface.kind === "readout") drawUfc(c, canvas.width, canvas.height, s, fuel);
    if (surface.kind === "flight") drawFlight(c, canvas.width, canvas.height, s);
    if (surface.kind === "engines") drawEngines(c, canvas.width, canvas.height, s, fuel);
    if (isProLineKind(surface.kind)) (this.suite ??= new ProLineSuite(fuel)).draw(surface.kind, c, canvas.width, canvas.height, s);
    surface.texture.needsUpdate = true;
  }
  /** Master lights from the crew alerting system, on the cockpits that have one. */
  alerts() {
    return this.suite?.alerts() ?? null;
  }
  update(s: CockpitState, dt: number) {
    this.hudClock -= dt;
    if (this.hudClock <= 0) {
      this.hudClock = 1 / 30;
      for (const surface of this.surfaces) if (SMOOTH.includes(surface.kind)) this.draw(surface, s);
    }
    this.clock -= dt;
    if (this.clock > 0) return;
    this.clock = 1 / 24;
    const others = this.surfaces.filter((surface) => !SMOOTH.includes(surface.kind));
    if (others.length) this.draw(others[this.turn++ % others.length], s);
  }
  dispose() {
    for (const surface of this.surfaces) {
      surface.texture.dispose();
      surface.canvas.width = 1;
    }
    for (const material of this.materials) material.dispose();
    for (const chart of this.charts.values()) chart.width = 1;
    this.suite?.dispose();
    this.surfaces = [];
    this.charts.clear();
  }
}
