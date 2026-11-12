import { rangeSurface } from "../../world/range-island";
import { runways, terrainHeight } from "../../world/terrain";
import { chartRegion } from "../cockpit-displays";
import type { CockpitState } from "../cockpit-state";
import { deriveFlightDeck, LIMITS, turnTo, type FlightDeck } from "./pro-line";

const WATER = "#06101c";
const WHITE = "#f2f5ef", CYAN = "#58e6ff", MAGENTA = "#ff6ad5", GREEN = "#64ff90", AMBER = "#ffc24a", RED = "#ff5040", MUTED = "#93a3ad", INK = "#05080b";
const FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";
const DEG = 180 / Math.PI;
const FEET = 3.28084;
const NM = 1852;
type Ctx = CanvasRenderingContext2D;
export const proLineKinds = ["pfd", "mfd-nav", "mfd-systems", "esis", "cdu"] as const;
export type ProLineKind = (typeof proLineKinds)[number];
export const isProLineKind = (kind: string): kind is ProLineKind => (proLineKinds as readonly string[]).includes(kind);

const wrap360 = (degrees: number) => ((degrees % 360) + 360) % 360;
const three = (degrees: number) => String(Math.round(wrap360(degrees)) % 360).padStart(3, "0");
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const clock = (seconds: number | null) =>
  seconds === null ? "--:--" : `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const CAS_COLOUR = { warning: RED, caution: AMBER, advisory: CYAN };

function text(c: Ctx, value: string, x: number, y: number, size: number, colour = WHITE, align: CanvasTextAlign = "left") {
  c.font = `700 ${size}px ${FONT}`;
  c.fillStyle = colour;
  c.textAlign = align;
  c.textBaseline = "middle";
  c.fillText(value, x, y);
}
function stroke(c: Ctx, colour: string, width: number, ...points: number[]) {
  c.strokeStyle = colour;
  c.lineWidth = width;
  c.beginPath();
  for (let i = 0; i < points.length; i += 2) {
    if (i) c.lineTo(points[i], points[i + 1]);
    else c.moveTo(points[i], points[i + 1]);
  }
  c.stroke();
}
function boxed(c: Ctx, x: number, y: number, w: number, h: number, fill: string, edge?: string) {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
  if (edge) {
    c.strokeStyle = edge;
    c.lineWidth = 2;
    c.strokeRect(x, y, w, h);
  }
}

/** Sky, ground, horizon and pitch ladder, clipped to a box and turned with the bank. */
function attitude(c: Ctx, s: CockpitState, x: number, y: number, w: number, h: number, cx: number, cy: number, perDegree: number, labels: number) {
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  c.translate(cx, cy);
  c.rotate(s.roll);
  const horizon = s.pitch * DEG * perDegree;
  const far = (w + h) * 1.5;
  c.fillStyle = "#2a78b6";
  c.fillRect(-far, horizon - far, far * 2, far);
  c.fillStyle = "#6f4a26";
  c.fillRect(-far, horizon, far * 2, far);
  stroke(c, WHITE, 3, -far, horizon, far, horizon);
  for (let angle = -40; angle <= 40; angle += 5) {
    if (!angle) continue;
    const row = horizon - angle * perDegree;
    const half = (angle % 10 ? 0.05 : 0.11) * w;
    stroke(c, WHITE, 2, -half, row, half, row);
    if (labels && angle % 10 === 0) {
      text(c, String(Math.abs(angle)), -half - 6, row, labels, WHITE, "right");
      text(c, String(Math.abs(angle)), half + 6, row, labels);
    }
  }
  c.restore();
}

/** The heading-up picture: terrain, runways, the FMS leg and traffic, centred on the aircraft. */
function plot(c: Ctx, s: CockpitState, f: FlightDeck, terrain: HTMLCanvasElement | undefined, area: [number, number, number, number], ox: number, oy: number, ring: number, rangeNm: number) {
  const metre = ring / (rangeNm * NM);
  const screen = (x: number, z: number) => {
    const dx = (x - s.x) * metre, dz = (z - s.z) * metre;
    return [ox + dx * Math.cos(s.heading) + dz * Math.sin(s.heading), oy - dx * Math.sin(s.heading) + dz * Math.cos(s.heading)];
  };
  c.save();
  c.beginPath();
  c.rect(...area);
  c.clip();
  boxed(c, ...area, WATER);
  if (terrain) {
    c.save();
    c.translate(ox, oy);
    c.rotate(-s.heading);
    c.scale(metre, metre);
    c.translate(-s.x, -s.z);
    const region = chartRegion(s.x, s.z);
    c.drawImage(terrain, region.centerX - region.size / 2, region.centerZ - region.size / 2, region.size, region.size);
    c.restore();
  }
  for (const runway of runways) {
    const half = runway.length / 2;
    const [ax, ay] = screen(runway.x - Math.sin(runway.heading) * half, runway.z - Math.cos(runway.heading) * half);
    const [bx, by] = screen(runway.x + Math.sin(runway.heading) * half, runway.z + Math.cos(runway.heading) * half);
    stroke(c, WHITE, 4, ax, ay, bx, by);
    text(c, runway.code, ax + 8, ay, 20, CYAN);
  }
  const bearing = f.plan.bearingDeg / DEG, reach = f.plan.distanceNm * NM;
  const [wx, wy] = screen(s.x + Math.sin(bearing) * reach, s.z - Math.cos(bearing) * reach);
  stroke(c, MAGENTA, 3, ox, oy, wx, wy);
  c.strokeStyle = MAGENTA;
  c.strokeRect(wx - 7, wy - 7, 14, 14);
  for (const t of f.traffic) {
    const [x, y] = screen(t.x, t.z);
    const colour = t.level === "RA" ? RED : t.level === "TA" ? AMBER : CYAN;
    c.fillStyle = colour;
    c.beginPath();
    c.moveTo(x, y - 9);
    c.lineTo(x + 9, y);
    c.lineTo(x, y + 9);
    c.lineTo(x - 9, y);
    c.closePath();
    c.fill();
    text(c, `${t.relativeFt >= 0 ? "+" : "-"}${String(Math.round(Math.abs(t.relativeFt) / 100)).padStart(2, "0")}`, x, y - 19, 18, colour, "center");
  }
  c.restore();
}

function ownship(c: Ctx, x: number, y: number) {
  stroke(c, WHITE, 4, x, y - 18, x, y + 16);
  stroke(c, WHITE, 4, x - 15, y - 2, x + 15, y - 2);
  stroke(c, WHITE, 3, x - 7, y + 15, x + 7, y + 15);
}

/** Edge-to-edge attitude over a compass arc, in the portrait format of an 8 x 10 inch display. */
export function drawPfd(c: Ctx, w: number, h: number, s: CockpitState, f: FlightDeck, terrain?: HTMLCanvasElement) {
  const top = 46, bottom = 396, cx = 246, cy = 214, perDegree = 9;
  boxed(c, 0, 0, w, h, INK);
  attitude(c, s, 0, top, w, bottom - top, cx, cy, perDegree, 18);

  // Roll scale and pointer.
  for (const bank of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) {
    const a = bank / DEG, r = 138, long = bank % 30 === 0 ? 14 : 8;
    stroke(c, WHITE, 2, cx + Math.sin(a) * r, cy - Math.cos(a) * r, cx + Math.sin(a) * (r + long), cy - Math.cos(a) * (r + long));
  }
  c.save();
  c.translate(cx, cy);
  c.rotate(s.roll);
  c.fillStyle = WHITE;
  c.beginPath();
  c.moveTo(0, -136);
  c.lineTo(-8, -122);
  c.lineTo(8, -122);
  c.closePath();
  c.fill();
  c.restore();

  // Cross-pointer flight director, then the fixed aircraft symbol over it.
  const barY = cy + clamp((s.pitch - f.director.pitchCommand) * DEG * perDegree, -90, 90);
  const barX = cx + clamp((s.roll - f.director.rollCommand) * DEG * 3, -90, 90);
  stroke(c, MAGENTA, 4, cx - 64, barY, cx + 64, barY);
  stroke(c, MAGENTA, 4, barX, cy - 64, barX, cy + 64);
  stroke(c, "#ffe267", 6, cx - 92, cy, cx - 34, cy, cx - 34, cy + 11);
  stroke(c, "#ffe267", 6, cx + 92, cy, cx + 34, cy, cx + 34, cy + 11);
  boxed(c, cx - 5, cy - 4, 10, 8, "#ffe267");

  // Airspeed tape with its limit bands and the FMS V-speeds.
  boxed(c, 0, top, 92, bottom - top, "#05080bb8");
  const knotY = (knots: number) => cy - (knots - f.knots) * 2.6;
  c.save();
  c.beginPath();
  c.rect(0, top, 130, bottom - top);
  c.clip();
  for (let mark = Math.floor(f.knots / 10) * 10 - 70; mark <= f.knots + 80; mark += 10) {
    if (mark < 0) continue;
    const y = knotY(mark);
    stroke(c, WHITE, 2, 78, y, 92, y);
    if (mark % 20 === 0) text(c, String(mark), 72, y, 24, WHITE, "right");
  }
  boxed(c, 86, knotY(f.stallKnots * 1.2), 6, knotY(f.stallKnots) - knotY(f.stallKnots * 1.2), AMBER);
  boxed(c, 86, knotY(f.stallKnots), 6, bottom, RED);
  boxed(c, 86, knotY(f.overspeedKnots) - 400, 6, 400, RED);
  for (const [name, knots] of f.vSpeeds) {
    const y = knotY(knots);
    stroke(c, CYAN, 3, 92, y, 104, y);
    text(c, name, 106, y, 20, CYAN);
  }
  c.restore();
  boxed(c, 2, cy - 25, 84, 50, "#000", WHITE);
  text(c, String(Math.round(f.knots)), 80, cy, 38, WHITE, "right");
  if (f.mach >= 0.2) {
    boxed(c, 0, bottom - 30, 92, 30, "#000");
    text(c, `M.${String(Math.round(f.mach * 100)).padStart(2, "0")}`, 46, bottom - 15, 22, WHITE, "center");
  }

  // Altitude tape, metres above and both barometric units below.
  boxed(c, 392, top, 120, bottom - top, "#05080bb8");
  const footY = (feet: number) => cy - (feet - f.feet) * 0.36;
  c.save();
  c.beginPath();
  c.rect(392, top + 26, 84, bottom - top - 62);
  c.clip();
  for (let mark = Math.floor(f.feet / 100) * 100 - 500; mark <= f.feet + 600; mark += 100) {
    const y = footY(mark);
    stroke(c, WHITE, 2, 392, y, 404, y);
    if (mark % 200 === 0) text(c, String(mark), 408, y, 22);
  }
  c.restore();
  boxed(c, 392, cy - 25, 84, 50, "#000", WHITE);
  text(c, String(Math.round(f.feet / 10) * 10), 472, cy, 30, WHITE, "right");
  text(c, `${Math.round(s.altitude)} M`, 434, top + 13, 20, CYAN, "center");
  text(c, "29.92 IN", 434, bottom - 28, 18, CYAN, "center");
  text(c, "1013 HPA", 434, bottom - 10, 18, CYAN, "center");

  // Vertical speed.
  const climb = s.verticalSpeed * FEET * 60;
  const vsY = cy - clamp(Math.sign(climb) * Math.sqrt(Math.abs(climb)) * 2.6, -130, 130);
  stroke(c, MUTED, 2, 478, cy - 130, 478, cy + 130);
  stroke(c, WHITE, 4, 478, cy, 508, vsY);
  if (Math.abs(climb) >= 100) text(c, `${climb > 0 ? "+" : "-"}${Math.round(Math.abs(climb) / 100) * 100}`, 510, climb > 0 ? top + 36 : bottom - 46, 16, WHITE, "right");

  // Radio altitude from 2,500 feet to touchdown.
  if (!s.grounded && f.radioFt <= LIMITS.radioAltitudeFt) {
    boxed(c, cx - 64, bottom - 34, 128, 30, "#000000cc");
    text(c, `RA ${Math.round(f.radioFt / 10) * 10}`, cx, bottom - 19, 24, f.radioFt < 200 ? AMBER : GREEN, "center");
  }

  // Localizer along the foot of the attitude, glideslope beside the altitude tape.
  if (f.approach) {
    const y = bottom - 48;
    for (const dot of [-2, -1, 1, 2]) {
      c.fillStyle = WHITE;
      c.fillRect(cx + dot * 34 - 2, y - 2, 5, 5);
      c.fillRect(380 - 2, cy + dot * 34 - 2, 5, 5);
    }
    const diamond = (x: number, yy: number) => {
      c.fillStyle = GREEN;
      c.beginPath();
      c.moveTo(x, yy - 9);
      c.lineTo(x + 9, yy);
      c.lineTo(x, yy + 9);
      c.lineTo(x - 9, yy);
      c.closePath();
      c.fill();
    };
    diamond(cx + clamp(f.approach.locDeg * 34, -72, 72), y);
    diamond(380, cy + clamp(f.approach.gsDeg * 48, -72, 72));
  }

  // Alerts across the attitude.
  if (s.stall) text(c, "STALL", cx, cy - 80, 44, RED, "center");
  if (f.taws) {
    boxed(c, cx - 112, cy + 54, 224, 40, "#000000cc");
    text(c, f.taws.text, cx, cy + 74, 28, f.taws.level === "warning" ? RED : AMBER, "center");
  }
  const threat = f.traffic.find((t) => t.level !== "OTHER");
  if (threat) text(c, threat.level === "RA" ? (threat.relativeFt > 0 ? "DESCEND" : "CLIMB") : "TRAFFIC", cx, top + 34, 30, threat.level === "RA" ? RED : AMBER, "center");

  // Flight mode annunciators. No AP: the game has no autopilot to engage.
  boxed(c, 0, 0, w, top, "#000");
  text(c, f.director.lateralMode, 14, 16, 26, GREEN);
  text(c, "FD", w / 2, 16, 26, WHITE, "center");
  text(c, f.director.verticalMode, w - 14, 16, 26, GREEN, "right");
  if (f.director.armed) text(c, f.director.armed, 14, 37, 16, WHITE);
  stroke(c, MUTED, 1, 0, top, w, top);

  // Compass arc with terrain, the FMS leg and traffic.
  const ox = 256, oy = 616, ring = 196;
  plot(c, s, f, terrain, [0, bottom, w, h - bottom], ox, oy, ring, 2);
  const heading = s.heading * DEG;
  for (let mark = Math.ceil((heading - 62) / 5) * 5; mark <= heading + 62; mark += 5) {
    const a = turnTo(heading, mark) / DEG;
    const major = wrap360(mark) % 30 === 0, tick = major ? 14 : wrap360(mark) % 10 === 0 ? 10 : 6;
    stroke(c, WHITE, 2, ox + Math.sin(a) * ring, oy - Math.cos(a) * ring, ox + Math.sin(a) * (ring - tick), oy - Math.cos(a) * (ring - tick));
    if (major) text(c, String(Math.round(wrap360(mark) / 10)).padStart(2, "0"), ox + Math.sin(a) * (ring - 32), oy - Math.cos(a) * (ring - 32), 22, WHITE, "center");
  }
  boxed(c, ox - 36, bottom + 2, 72, 28, "#000", WHITE);
  text(c, three(heading), ox, bottom + 16, 24, WHITE, "center");
  ownship(c, ox, oy - 10);
  // Solid ground under the corner readouts, so a runway label passing beneath stays out of them.
  boxed(c, 0, bottom, 154, 56, "#000");
  boxed(c, w - 118, bottom, 118, 56, "#000");
  const source = f.approach ? `LOC ${f.approach.frequency.toFixed(2)}` : "FMS1";
  const course = f.approach ? f.approach.courseDeg : f.plan.bearingDeg;
  text(c, source, 10, bottom + 16, 22, f.approach ? GREEN : MAGENTA);
  text(c, `CRS ${three(course)}`, 10, bottom + 42, 22, MAGENTA);
  text(c, `${(f.approach ? f.approach.distanceNm : f.plan.distanceNm).toFixed(1)} NM`, w - 10, bottom + 16, 22, WHITE, "right");
  text(c, `GS ${Math.round(f.plan.groundKnots)}`, w - 10, bottom + 42, 22, WHITE, "right");
  text(c, "TFC", 10, h - 20, 20, CYAN);
  text(c, "TERR", w - 10, h - 20, 20, GREEN, "right");
}

/** Navigation map with the flight plan, terrain and traffic overlays and a taxi diagram near a field. */
export function drawMfdNav(c: Ctx, w: number, h: number, s: CockpitState, f: FlightDeck, terrain?: HTMLCanvasElement) {
  boxed(c, 0, 0, w, h, WATER);
  const rangeNm = f.plan.distanceNm > 4 ? 10 : f.plan.distanceNm > 1.6 ? 5 : 2;
  const ox = w / 2, oy = 400, ring = 340;
  plot(c, s, f, terrain, [0, 34, w, 416], ox, oy, ring, rangeNm);
  c.strokeStyle = "#789da8";
  c.lineWidth = 1;
  for (const r of [ring / 2, ring]) {
    c.beginPath();
    c.arc(ox, oy, r, 0, Math.PI * 2);
    c.stroke();
  }
  text(c, `${rangeNm} NM`, w - 10, oy - 12, 22, CYAN, "right");
  ownship(c, ox, oy);
  boxed(c, 0, 0, w, 34, "#000");
  text(c, "MAP", 10, 17, 22);
  text(c, "TERR", 90, 17, 22, GREEN);
  text(c, "TFC", 170, 17, 22, CYAN);
  text(c, "WX STBY", 230, 17, 22, MUTED);
  text(c, three(s.heading * DEG), w - 10, 17, 24, WHITE, "right");

  boxed(c, 0, 450, w, h - 450, "#000");
  const narrow = s.grounded || f.fields[0].distanceNm < 0.8;
  text(c, f.plan.name.slice(0, narrow ? 12 : 18), 10, 474, 24, MAGENTA);
  text(c, `${three(f.plan.bearingDeg)}  ${f.plan.distanceNm.toFixed(1)} NM`, 10, 506, 24);
  text(c, `ETE ${clock(f.plan.eteSeconds)}`, 10, 538, 24);
  text(c, `GS ${Math.round(f.plan.groundKnots)} KT`, 10, 570, 24);
  const wind = s.wind ? Math.hypot(s.wind.x, s.wind.z) * 1.943844 : null;
  const from = s.wind ? wrap360(Math.atan2(-s.wind.x, s.wind.z) * DEG) : 0;
  text(c, wind === null ? "WIND ---" : `WIND ${three(from)}/${Math.round(wind)}`, 10, 602, 24, CYAN);
  if (narrow) chart(c, s, f, 300, 458, 206, 176);
}

/** A geo-referenced airport diagram: the runway, its apron and the aircraft's present position. */
function chart(c: Ctx, s: CockpitState, f: FlightDeck, x: number, y: number, w: number, h: number) {
  const field = runways.find((r) => r.name === f.fields[0].name)!;
  boxed(c, x, y, w, h, "#10181b", MUTED);
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  const scale = (h - 26) / (field.length * 1.2);
  c.translate(x + w / 2, y + h / 2 + 8);
  c.scale(scale, scale);
  // Airfield frame: the runway runs up the diagram, with the local x across it.
  const across = (s.x - field.x) * Math.cos(field.heading) - (s.z - field.z) * Math.sin(field.heading);
  const along = (s.x - field.x) * Math.sin(field.heading) + (s.z - field.z) * Math.cos(field.heading);
  c.fillStyle = "#3b4347";
  c.fillRect(12, 15, 64, 110);
  c.fillStyle = "#c9cdc4";
  c.fillRect(-field.width / 2, -field.length / 2, field.width, field.length);
  c.restore();
  const px = x + w / 2 + across * scale, py = y + h / 2 + 8 + along * scale;
  if (px > x && px < x + w && py > y && py < y + h) {
    c.fillStyle = MAGENTA;
    c.beginPath();
    c.arc(px, py, 6, 0, Math.PI * 2);
    c.fill();
  }
  text(c, `${field.name.toUpperCase().slice(0, 12)} ${field.code}`, x + 6, y + 14, 16, CYAN);
}

/** Engine indicating and crew alerting, with the electronic checklist below. */
export function drawMfdSystems(c: Ctx, w: number, h: number, s: CockpitState, f: FlightDeck, fuelPounds: number) {
  boxed(c, 0, 0, w, h, INK);
  const e = f.engines;
  const dial = (x: number, y: number, value: number) => {
    c.strokeStyle = "#39434b";
    c.lineWidth = 9;
    c.beginPath();
    c.arc(x, y, 40, Math.PI * 0.75, Math.PI * 2.25);
    c.stroke();
    c.strokeStyle = value > 100 ? RED : GREEN;
    c.beginPath();
    c.arc(x, y, 40, Math.PI * 0.75, Math.PI * 0.75 + Math.PI * 1.5 * clamp(value / 110, 0, 1));
    c.stroke();
    text(c, value.toFixed(1), x, y + 2, 22, WHITE, "center");
  };
  dial(120, 54, e.n1);
  dial(392, 54, e.n1);
  text(c, "N1 %", w / 2, 54, 24, CYAN, "center");
  const fuel = (s.fuel ?? 0) * fuelPounds;
  const rows: [string, string][] = [
    ["ITT C", String(Math.round(e.ittC))],
    ["N2 %", e.n2.toFixed(1)],
    ["OIL PSI", String(Math.round(e.oilPsi))],
    ["OIL C", String(Math.round(e.oilC))],
    ["FF PPH", String(Math.round(e.fuelFlowPph))],
    ["FUEL LB", String(Math.round(fuel / 2))],
  ];
  rows.forEach(([name, value], i) => {
    const y = 114 + i * 27;
    text(c, value, 120, y, 24, name === "FUEL LB" && (s.fuel ?? 1) < 0.1 ? AMBER : GREEN, "center");
    text(c, name, w / 2, y, 20, CYAN, "center");
    text(c, value, 392, y, 24, name === "FUEL LB" && (s.fuel ?? 1) < 0.1 ? AMBER : GREEN, "center");
  });

  // Configuration line under the engines.
  stroke(c, MUTED, 1, 0, 272, w, 272);
  const gear = s.gear > 0.995 ? "DN" : s.gear < 0.005 ? "UP" : "--";
  text(c, `GEAR ${gear}`, 10, 290, 22, gear === "DN" ? GREEN : gear === "UP" ? WHITE : AMBER);
  text(c, `FLAP ${f.flapDetent}`, 180, 290, 22);
  text(c, `CAB ${Math.round(f.cabinFt)} FT`, w - 10, 290, 22, CYAN, "right");
  stroke(c, MUTED, 1, 0, 308, w, 308);

  // Crew alerting messages, colour coded and stacked by priority.
  text(c, "CAS", 10, 326, 18, MUTED);
  if (!f.cas.length) text(c, "NO MESSAGES", 70, 326, 18, MUTED);
  const shown = f.cas.slice(0, 6);
  shown.forEach((message, i) => text(c, message.text, 10, 350 + i * 28, 26, CAS_COLOUR[message.level]));
  if (f.cas.length > shown.length) text(c, `+${f.cas.length - shown.length} MORE`, w - 10, 326, 18, WHITE, "right");

  // Electronic checklist for this phase of flight.
  stroke(c, MUTED, 1, 0, 516, w, 516);
  text(c, f.checklist.title, 10, 532, 20, CYAN);
  f.checklist.items.forEach((item, i) => {
    const y = 556 + i * 22;
    text(c, item.done ? "[X]" : "[ ]", 10, y, 18, item.done ? GREEN : WHITE);
    text(c, item.text, 56, y, 18, item.done ? GREEN : WHITE);
  });
}

/** Electronic standby instrument: its own attitude, speed, altitude and heading, as a third source. */
export function drawEsis(c: Ctx, w: number, h: number, s: CockpitState, f: FlightDeck) {
  const cy = h * 0.46;
  attitude(c, s, 0, 0, w, h, w / 2, cy, 5.2, 0);
  stroke(c, "#ffe267", 6, w / 2 - 54, cy, w / 2 - 18, cy);
  stroke(c, "#ffe267", 6, w / 2 + 18, cy, w / 2 + 54, cy);
  boxed(c, w / 2 - 4, cy - 4, 8, 8, "#ffe267");
  boxed(c, 0, cy - 24, 74, 48, "#000", WHITE);
  text(c, String(Math.round(f.knots)), 68, cy, 32, WHITE, "right");
  boxed(c, w - 88, cy - 24, 88, 48, "#000", WHITE);
  text(c, String(Math.round(f.feet / 10) * 10), w - 6, cy, 26, WHITE, "right");
  text(c, "KT", 6, cy - 38, 20, CYAN);
  text(c, "FT", w - 6, cy - 38, 20, CYAN, "right");
  boxed(c, 0, h - 54, w, 54, "#000");
  text(c, three(s.heading * DEG), w / 2, h - 34, 30, WHITE, "center");
  text(c, "29.92", w / 2, h - 11, 18, CYAN, "center");
}

/** The FMS control display unit, on its progress and tuning page. */
export function drawCdu(c: Ctx, w: number, h: number, s: CockpitState, f: FlightDeck, fuelPounds: number) {
  boxed(c, 0, 0, w, h, "#02060a");
  text(c, "ACTIVE FLT PLAN", w / 2, 15, 22, WHITE, "center");
  text(c, f.plan.name.slice(0, 14), 8, 44, 22, MAGENTA);
  text(c, `${three(f.plan.bearingDeg)}  ${f.plan.distanceNm.toFixed(1)}NM`, w - 8, 44, 20, MAGENTA, "right");
  text(c, `ETE ${clock(f.plan.eteSeconds)}`, 8, 72, 20, GREEN);
  text(c, `FOB ${Math.round((s.fuel ?? 0) * fuelPounds)}`, w - 8, 72, 20, GREEN, "right");
  text(c, "COM 121.70", 8, 102, 20, CYAN);
  text(c, "118.30", w - 8, 102, 20, CYAN, "right");
  const nav = f.approach ? `NAV ${f.approach.frequency.toFixed(2)}` : "NAV 110.30";
  text(c, nav, 8, 130, 20, CYAN);
  text(c, f.approach ? `${f.approach.code} ${three(f.approach.courseDeg)}` : "---", w - 8, 130, 20, CYAN, "right");
  // The DME holds up to three stations at once.
  text(c, `DME ${f.fields.slice(0, 3).map((field) => field.distanceNm.toFixed(1)).join(" ")}`, 8, 158, 20, GREEN);
  text(c, "XPDR 1200", 8, 186, 20, GREEN);
  text(c, "TA/RA", w - 8, 186, 20, GREEN, "right");
  text(c, `VR ${f.vSpeeds[0][1]}`, 8, 216, 20, CYAN);
  text(c, `VREF ${f.vSpeeds[1][1]}`, w - 8, 216, 20, CYAN, "right");
}

/** Terrain coloured against the aircraft's height, as the terrain awareness display shows it. Land only. */
function terrainColour(heightFt: number, aircraftFt: number) {
  if (heightFt <= 2) return [6, 16, 28]; // WATER
  if (heightFt >= aircraftFt) return [176, 34, 26];
  if (heightFt >= aircraftFt - 500) return [186, 142, 26];
  if (heightFt >= aircraftFt - 1500) return [38, 118, 56];
  return [24, 58, 38];
}

const SHADE = 96;
/** A low-resolution terrain picture for the map, recoloured only as the altitude changes. */
class TerrainShade {
  private heights = new Map<string, Float32Array>();
  private canvas: HTMLCanvasElement | null = null;
  private drawn = "";
  picture(s: CockpitState) {
    const region = chartRegion(s.x, s.z);
    let heights = this.heights.get(region.id);
    if (!heights) {
      const inRange = region.id !== "palm-bay";
      heights = new Float32Array(SHADE * SHADE);
      let known = !inRange;
      for (let y = 0; y < SHADE; y++)
        for (let x = 0; x < SHADE; x++) {
          const wx = region.centerX + ((x + 0.5) / SHADE - 0.5) * region.size;
          const wz = region.centerZ + ((y + 0.5) / SHADE - 0.5) * region.size;
          const height = inRange ? rangeSurface(wx, wz) : terrainHeight(wx, wz);
          known ||= height !== null;
          heights[y * SHADE + x] = (height ?? 0) * FEET;
        }
      // Anvil Key's heights arrive late, so only keep its picture once they exist.
      if (known) this.heights.set(region.id, heights);
    }
    // Terrain alerting is off on the ground, so the land reads plainly rather than as a threat.
    const feet = s.grounded ? Infinity : s.altitude * FEET;
    const key = `${region.id}:${s.grounded ? "ground" : Math.round(feet / 25)}`;
    if (this.canvas && key === this.drawn) return this.canvas;
    this.drawn = key;
    this.canvas ??= Object.assign(document.createElement("canvas"), { width: SHADE, height: SHADE });
    const c = this.canvas.getContext("2d")!;
    const image = c.createImageData(SHADE, SHADE);
    for (let i = 0; i < heights.length; i++) {
      const [r, g, b] = terrainColour(heights[i], feet);
      image.data.set([r, g, b, 255], i * 4);
    }
    c.putImageData(image, 0, 0);
    return this.canvas;
  }
  dispose() {
    if (this.canvas) this.canvas.width = 1;
    this.heights.clear();
  }
}

/** The whole suite for one cockpit: shared derived state, the terrain picture and the takeoff memory. */
export class ProLineSuite {
  private terrain = new TerrainShade();
  private takeoffPeakFt = 0;
  private takeoffArmed = false;
  private time = -Infinity;
  private lights = { warning: false, caution: false };
  constructor(private fuelPounds: number) {}
  /** The master warning and caution lights, from the crew alerting messages of the last draw. */
  alerts() {
    return this.lights;
  }
  draw(kind: ProLineKind, c: Ctx, w: number, h: number, s: CockpitState) {
    if (s.grounded || s.time < this.time) {
      this.takeoffPeakFt = 0;
      this.takeoffArmed = s.grounded;
    }
    this.time = s.time;
    const deck = deriveFlightDeck(s, this.takeoffPeakFt);
    // Arm on the ground, then stop tracking after the takeoff climb. A landing cannot rearm it.
    if (deck.radioFt >= 700) {
      this.takeoffArmed = false;
      this.takeoffPeakFt = 0;
    } else if (this.takeoffArmed && !s.grounded) {
      this.takeoffPeakFt = Math.max(this.takeoffPeakFt, deck.radioFt);
    }
    this.lights = { warning: deck.cas.some((m) => m.level === "warning"), caution: deck.cas.some((m) => m.level === "caution") };
    if (kind === "pfd") drawPfd(c, w, h, s, deck, this.terrain.picture(s));
    if (kind === "mfd-nav") drawMfdNav(c, w, h, s, deck, this.terrain.picture(s));
    if (kind === "mfd-systems") drawMfdSystems(c, w, h, s, deck, this.fuelPounds);
    if (kind === "esis") drawEsis(c, w, h, s, deck);
    if (kind === "cdu") drawCdu(c, w, h, s, deck, this.fuelPounds);
  }
  dispose() {
    this.terrain.dispose();
  }
}
