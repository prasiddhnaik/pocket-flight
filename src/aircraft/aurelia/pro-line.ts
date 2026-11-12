import { flightProfiles } from "../../flight/flight-profiles";
import { groundHeight, runways } from "../../world/terrain";
import type { CockpitState } from "../cockpit-state";
import { aureliaFlightOffsetY } from "./flight-model";

/**
 * Flight deck logic for the avionics in the Citation CJ4 Specification and Description (Oct 2015, section 10).
 * Everything here is worked out from the simulator's own state. The limit speeds are the CJ4's and only drive
 * indications: they do not change the Aurelia's flight model.
 */
export const LIMITS = { vmoKt: 305, mmo: 0.77, vleKt: 200, vfe15Kt: 200, vfe35Kt: 160, radioAltitudeFt: 2500, tcasNm: 35 } as const;
const GLIDE_PATH_DEG = 3;
const FEET = 3.28084;
const KNOTS = 1.943844;
const NM = 1852;
const DEG = 180 / Math.PI;
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const wrap360 = (degrees: number) => ((degrees % 360) + 360) % 360;
/** Shortest turn from one heading to another, in degrees. */
export const turnTo = (from: number, to: number) => ((wrap360(to - from) + 180) % 360) - 180;

/** Engine indications estimated from simulated power, the same for both engines since the simulator has one power value. */
export function engineIndications(s: CockpitState) {
  const power = clamp(s.power, 0, 1);
  if (s.engineOut)
    return { n1: Math.min(18, s.speed * 0.08), n2: Math.min(24, s.speed * 0.11), ittC: 60, oilPsi: 0, oilC: 40, fuelFlowPph: 0 };
  return { n1: 24 + 76 * power, n2: 56 + 42 * power, ittC: 480 + 400 * power, oilPsi: 34 + 36 * power, oilC: 72 + 45 * power, fuelFlowPph: 160 + 1040 * power };
}

/** Height of the wheels above the terrain, in feet. */
export function radioAltitudeFt(s: CockpitState) {
  return s.grounded ? 0 : Math.max(0, (s.altitude - groundHeight(s.x, s.z) + aureliaFlightOffsetY) * FEET);
}

export type Approach = { name: string; code: string; courseDeg: number; distanceNm: number; locDeg: number; gsDeg: number; frequency: number };

/** Localizer and glideslope to the best runway end ahead of the aircraft, within ten miles and well inside the beam. */
export function approachGuidance(s: CockpitState): Approach | null {
  const heading = s.heading * DEG;
  let best: Approach | null = null;
  for (const [index, runway] of runways.entries())
    for (const sign of [-1, 1]) {
      const dx = sign * Math.sin(runway.heading), dz = sign * Math.cos(runway.heading);
      const courseDeg = wrap360(Math.atan2(dx, -dz) * DEG);
      if (Math.abs(turnTo(heading, courseDeg)) > 60) continue;
      const ox = s.x - (runway.x - (dx * runway.length) / 2), oz = s.z - (runway.z - (dz * runway.length) / 2);
      // Across is negative right of the centreline, so the course correction and the needle both read directly from it.
      const along = -(ox * dx + oz * dz), across = ox * dz - oz * dx;
      if (along <= 0 || along > 10 * NM) continue;
      const locDeg = Math.atan2(across, along) * DEG;
      if (Math.abs(locDeg) > 20) continue;
      const distanceNm = along / NM;
      if (best && distanceNm >= best.distanceNm) continue;
      const gsDeg = Math.atan2(s.altitude + aureliaFlightOffsetY - runway.y, along) * DEG - GLIDE_PATH_DEG;
      best = { name: runway.name, code: runway.code, courseDeg, distanceNm, locDeg, gsDeg, frequency: 109.5 + index * 0.8 };
    }
  return best;
}

/** The FMS leg: straight to the mission's next point, or to the nearest field when there is none. */
export function flightPlan(s: CockpitState) {
  const fields = nearestFields(s);
  const target = s.target;
  const named = target && runways.find((r) => r.x === target.x && r.z === target.z);
  const to = target ?? fields[0];
  const dx = to.x - s.x, dz = to.z - s.z;
  const distanceNm = Math.hypot(dx, dz) / NM;
  const groundKnots = (s.groundSpeed ?? s.speed) * KNOTS;
  return {
    active: target !== null,
    name: (named ? named.name : target ? "NEXT WPT" : fields[0].name).toUpperCase(),
    bearingDeg: wrap360(Math.atan2(dx, -dz) * DEG),
    distanceNm,
    // Seconds to the point at this ground speed; null while standing still.
    eteSeconds: groundKnots > 30 ? (distanceNm / groundKnots) * 3600 : null,
    groundKnots,
  };
}

/** Every field with its distance and bearing, nearest first. The DME reads the first three. */
export function nearestFields(s: CockpitState) {
  return runways
    .map((r) => ({ name: r.name, code: r.code, x: r.x, z: r.z, distanceNm: Math.hypot(r.x - s.x, r.z - s.z) / NM, bearingDeg: wrap360(Math.atan2(r.x - s.x, -(r.z - s.z)) * DEG) }))
    .sort((a, b) => a.distanceNm - b.distanceNm);
}

/**
 * Flight director commands. With no mode selected it holds pitch and roll, as the spec describes,
 * and the bars sit centred. It computes guidance only: the game has no autopilot to couple it to.
 */
export function flightDirector(s: CockpitState, approach: Approach | null, plan: ReturnType<typeof flightPlan>) {
  const heading = s.heading * DEG;
  const lateralMode = approach ? "LOC" : plan.active ? "FMS" : "ROL";
  const verticalMode = approach && Math.abs(approach.gsDeg) < 1.5 ? "GS" : "PIT";
  const desired = approach ? approach.courseDeg + clamp(approach.locDeg * 6, -30, 30) : plan.bearingDeg;
  // Positive roll is a left bank, so a turn to the right asks for negative roll.
  const rollCommand = lateralMode === "ROL" ? s.roll : -clamp(turnTo(heading, desired) * 1.2, -25, 25) / DEG;
  const pitchCommand = verticalMode === "GS" ? s.pitch - clamp(approach!.gsDeg * 2.5, -5, 5) / DEG : s.pitch;
  return { lateralMode, verticalMode, armed: approach && verticalMode !== "GS" ? "GS" : plan.active && !approach ? "LOC" : "", rollCommand, pitchCommand };
}

export type TrafficLevel = "RA" | "TA" | "OTHER";
export type Traffic = { x: number; z: number; rangeNm: number; relativeFt: number; level: TrafficLevel };

/** Airborne aircraft inside the TCAS range, most threatening first. */
export function trafficAdvisories(s: CockpitState): Traffic[] {
  const rank = { RA: 0, TA: 1, OTHER: 2 };
  return s.contacts
    .filter((contact) => contact.air)
    .map((contact): Traffic => {
      const rangeNm = Math.hypot(contact.x - s.x, contact.z - s.z) / NM;
      const relativeFt = (contact.y - s.altitude) * FEET;
      const level = rangeNm < 1 && Math.abs(relativeFt) < 600 ? "RA" : rangeNm < 2 && Math.abs(relativeFt) < 850 ? "TA" : "OTHER";
      return { x: contact.x, z: contact.z, rangeNm, relativeFt, level };
    })
    .filter((t) => t.rangeNm <= LIMITS.tcasNm)
    .sort((a, b) => rank[a.level] - rank[b.level] || a.rangeNm - b.rangeNm);
}

export type TawsAlert = { level: "warning" | "caution"; text: string } | null;

/** Seconds until the projected flight path meets the terrain, within a 100 ft margin. */
function terrainConflict(s: CockpitState) {
  const speed = s.groundSpeed ?? s.speed;
  for (const seconds of [5, 10, 15, 20, 30, 40]) {
    const x = s.x + Math.sin(s.heading) * speed * seconds;
    const z = s.z - Math.cos(s.heading) * speed * seconds;
    if (groundHeight(x, z) + 30 > s.altitude + aureliaFlightOffsetY + s.verticalSpeed * seconds) return seconds;
  }
  return null;
}

/** Terrain awareness: descent rate, terrain ahead, clearance floor, loss after takeoff and below glideslope. */
export function tawsAlert(s: CockpitState, radioFt: number, approach: Approach | null, takeoffPeakFt: number): TawsAlert {
  if (s.grounded) return null;
  const sink = -s.verticalSpeed * FEET * 60;
  const knots = s.speed * KNOTS;
  const landing = approach !== null && approach.distanceNm < 2 && Math.abs(approach.locDeg) < 6;
  if (sink > 1400 + 1.6 * radioFt && radioFt < 2450) return { level: "warning", text: "PULL UP" };
  const conflict = landing ? null : terrainConflict(s);
  if (conflict !== null && conflict <= 10) return { level: "warning", text: "PULL UP" };
  if (conflict !== null) return { level: "caution", text: "TERRAIN AHEAD" };
  if (sink > 1000 + 1.2 * radioFt && radioFt < 2450) return { level: "caution", text: "SINK RATE" };
  if (sink > 0 && radioFt < 500 && s.gear < 0.5 && knots < 190) return { level: "caution", text: "TOO LOW GEAR" };
  if (sink > 0 && radioFt < 245 && s.flaps < 0.3 && knots < 160) return { level: "caution", text: "TOO LOW FLAPS" };
  if (radioFt < 700 && sink > 0 && takeoffPeakFt - radioFt > Math.max(30, takeoffPeakFt * 0.1)) return { level: "caution", text: "DON'T SINK" };
  if (approach && approach.gsDeg < -1.3 && radioFt < 1000 && s.gear > 0.5) return { level: "caution", text: "GLIDESLOPE" };
  return null;
}

/** The spec's three flap handle positions. The game parks its takeoff flaps at 0.65, which reads as 15. */
export const flapDetent = (flaps: number) => (flaps < 0.3 ? 0 : flaps < 0.85 ? 15 : 35);

export type CasLevel = "warning" | "caution" | "advisory";
export type CasMessage = { level: CasLevel; text: string };

/** Crew alerting messages, sorted by priority: warnings, then cautions, then advisories. */
export function casMessages(s: CockpitState, radioFt: number, taws: TawsAlert, traffic: readonly Traffic[]): CasMessage[] {
  const knots = s.speed * KNOTS;
  const mach = machNumber(s);
  const n2 = engineIndications(s).n2;
  const out: CasMessage[] = [];
  const add = (level: CasLevel, text: string, on: unknown) => on && out.push({ level, text });
  add("warning", "STALL", s.stall);
  add("warning", "ENGINE FAILURE L-R", s.engineOut);
  add("warning", "OVERSPEED", knots > LIMITS.vmoKt || mach > LIMITS.mmo);
  // The spec's gear horn: wheels up, slow, and a thrust lever below about 85% N2.
  add("warning", "GEAR NOT DOWN", !s.grounded && s.gear < 0.995 && radioFt < 1500 && knots < 150 && n2 < 85);
  add("warning", taws?.text ?? "", taws?.level === "warning");
  add("warning", "TRAFFIC RA", traffic.some((t) => t.level === "RA"));
  add("caution", taws?.text ?? "", taws?.level === "caution");
  add("caution", "TRAFFIC", traffic.some((t) => t.level === "TA"));
  add("caution", "FUEL LOW", (s.fuel ?? 1) < 0.1);
  add("caution", "GEAR OVERSPEED", s.gear > 0.005 && knots > LIMITS.vleKt);
  add("caution", "FLAP OVERSPEED", (flapDetent(s.flaps) === 35 && knots > LIMITS.vfe35Kt) || (s.flaps > 0.05 && knots > LIMITS.vfe15Kt));
  add("advisory", "SPEED BRAKE EXTEND", s.speedBrake > 0.05);
  add("advisory", "GEAR IN TRANSIT", s.gear > 0.005 && s.gear < 0.995);
  return out;
}

const soundSpeed = (altitude: number) => 340.29 - 0.0039 * altitude;
export const machNumber = (s: CockpitState) => s.speed / soundSpeed(s.altitude);

export type ChecklistItem = { text: string; done: boolean };

/** The checklist for this phase of flight, ticked off from the aircraft's real configuration. */
export function electronicChecklist(s: CockpitState, approach: Approach | null): { title: string; items: ChecklistItem[] } {
  const brakeIn = s.speedBrake < 0.05;
  const vref = s.approachKnots;
  if (s.grounded && s.speed < 25)
    return { title: "BEFORE TAKEOFF", items: [{ text: "FLAPS 15", done: flapDetent(s.flaps) === 15 }, { text: "SPEED BRAKE RET", done: brakeIn }, { text: "GEAR DOWN", done: s.gear > 0.995 }, { text: "THRUST TO", done: s.power > 0.8 }] };
  if (s.grounded)
    return { title: "AFTER LANDING", items: [{ text: "SPEED BRAKE EXT", done: !brakeIn }, { text: "THRUST IDLE", done: s.power < 0.1 }] };
  if (s.slowingToLand || (approach && approach.distanceNm < 5))
    return { title: "BEFORE LANDING", items: [{ text: "GEAR DOWN", done: s.gear > 0.995 }, { text: "FLAPS 35", done: flapDetent(s.flaps) === 35 }, { text: "SPEED BRAKE RET", done: brakeIn }, { text: `VREF ${vref} KT`, done: Math.abs(s.speed * KNOTS - vref) < 8 }] };
  return { title: "AFTER TAKEOFF", items: [{ text: "GEAR UP", done: s.gear < 0.005 }, { text: "FLAPS UP", done: s.flaps < 0.02 }, { text: "SPEED BRAKE RET", done: brakeIn }] };
}

/** Cabin altitude from the auto schedule chart in spec section 9.5, never below sea level. */
export function cabinAltitudeFt(feet: number) {
  const schedule = [[21067, 0], [35000, 5500], [45000, 7800]];
  if (feet <= schedule[0][0]) return 0;
  for (const [i, [high, cabin]] of schedule.entries()) {
    if (feet > high) continue;
    const [low, start] = schedule[i - 1];
    return start + ((cabin - start) * (feet - low)) / (high - low);
  }
  return 7800;
}

/** Everything the displays share, worked out once from a single state. */
export function deriveFlightDeck(s: CockpitState, takeoffPeakFt = 0) {
  const knots = s.speed * KNOTS;
  const feet = s.altitude * FEET;
  const radioFt = radioAltitudeFt(s);
  const approach = approachGuidance(s);
  const plan = flightPlan(s);
  const director = flightDirector(s, approach, plan);
  const traffic = trafficAdvisories(s);
  const taws = tawsAlert(s, radioFt, approach, takeoffPeakFt);
  const profile = flightProfiles.aurelia;
  return {
    knots,
    feet,
    mach: machNumber(s),
    radioFt,
    approach,
    plan,
    director,
    traffic,
    taws,
    cas: casMessages(s, radioFt, taws, traffic),
    engines: engineIndications(s),
    flapDetent: flapDetent(s.flaps),
    stallKnots: profile.stallSpeed * KNOTS,
    overspeedKnots: Math.min(LIMITS.vmoKt, LIMITS.mmo * soundSpeed(s.altitude) * KNOTS),
    vSpeeds: [["R", profile.rotationKnots], ["RF", s.approachKnots]] as const,
    fields: nearestFields(s),
    checklist: electronicChecklist(s, approach),
    cabinFt: cabinAltitudeFt(feet),
  };
}
export type FlightDeck = ReturnType<typeof deriveFlightDeck>;
