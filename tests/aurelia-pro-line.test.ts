import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  approachGuidance,
  cabinAltitudeFt,
  casMessages,
  deriveFlightDeck,
  electronicChecklist,
  flapDetent,
  flightDirector,
  flightPlan,
  LIMITS,
  radioAltitudeFt,
  tawsAlert,
  trafficAdvisories,
  turnTo,
} from "../src/aircraft/aurelia/pro-line";
import { drawCdu, drawEsis, drawMfdNav, drawMfdSystems, drawPfd, ProLineSuite } from "../src/aircraft/aurelia/pro-line-displays";
import { cockpitSpecs } from "../src/aircraft/cockpit-specs";
import type { CockpitState } from "../src/aircraft/cockpit-state";
import { groundHeight, runways } from "../src/world/terrain";

const NM = 1852;
const palmBay = runways[0];
// Well clear of the islands and any runway's approach.
const cruise: CockpitState = {
  time: 100,
  mode: "flight",
  speed: 128.6,
  altitude: 1500,
  pitch: 0.03,
  roll: 0,
  heading: Math.PI / 2,
  verticalSpeed: 0,
  power: 0.6,
  fuel: 0.5,
  x: 3000,
  z: 3000,
  engineOut: false,
  stall: false,
  aoa: 4,
  gLoad: 1,
  gear: 0,
  flaps: 0,
  stick: { pitch: 0, roll: 0, yaw: 0 },
  speedBrake: 0,
  night: false,
  grounded: false,
  slowingToLand: false,
  approachKnots: 110,
  target: null,
  contacts: [],
  stores: null,
  groundSpeed: 128.6,
  wind: { x: 1.8, z: 0.7 },
};
// Lined up to land towards the north, three miles out on a three degree path.
const finals = (miles = 3, offset = 0): CockpitState => {
  const threshold = palmBay.z + palmBay.length / 2;
  const along = miles * NM;
  return {
    ...cruise,
    heading: 0,
    x: palmBay.x + offset,
    z: threshold + along,
    altitude: palmBay.y + 1.265 + along * Math.tan((3 * Math.PI) / 180),
    gear: 1,
    flaps: 1,
    speed: 57,
    groundSpeed: 57,
    verticalSpeed: -3,
    slowingToLand: true,
  };
};

function recorder() {
  const texts: string[] = [];
  const context = new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (key === "fillText") return (value: string) => texts.push(String(value));
      if (key in target) return target[key as string];
      return () => {};
    },
    set(target, key, value) {
      target[key as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
  return { context, texts };
}
const cas = (s: CockpitState) => deriveFlightDeck(s).cas.map((m) => m.text);

describe("radio altitude and approach guidance", () => {
  test("reads the wheels' height over the terrain and zero on the ground", () => {
    const s = { ...cruise, altitude: groundHeight(3000, 3000) + 1.265 + 304.8 };
    expect(radioAltitudeFt(s)).toBeCloseTo(1000, 0);
    expect(radioAltitudeFt({ ...s, grounded: true })).toBe(0);
  });
  test("is centred on the beam and the glide path when flying them", () => {
    const a = approachGuidance(finals())!;
    expect(a.name).toBe("Palm Bay");
    expect(a.courseDeg).toBeCloseTo(0, 6);
    expect(a.distanceNm).toBeCloseTo(3, 6);
    expect(a.locDeg).toBeCloseTo(0, 6);
    expect(a.gsDeg).toBeCloseTo(0, 6);
  });
  test("the needle sits left and the director turns left when right of the centreline", () => {
    const s = finals(3, 300);
    const a = approachGuidance(s)!;
    expect(a.locDeg).toBeLessThan(0);
    const fd = flightDirector(s, a, flightPlan(s));
    expect(fd.lateralMode).toBe("LOC");
    // Positive roll is a left bank.
    expect(fd.rollCommand).toBeGreaterThan(0);
  });
  test("the director asks for the nose down when above the glide path", () => {
    const s = { ...finals(), altitude: finals().altitude + 50 };
    const a = approachGuidance(s)!;
    expect(a.gsDeg).toBeGreaterThan(0);
    const fd = flightDirector(s, a, flightPlan(s));
    expect(fd.verticalMode).toBe("GS");
    expect(fd.pitchCommand).toBeLessThan(s.pitch);
  });
  test("offers nothing when flying away from every runway", () => {
    expect(approachGuidance({ ...finals(), heading: Math.PI })).toBeNull();
    expect(approachGuidance(cruise)).toBeNull();
  });
  test("holds pitch and roll with no mode selected, as the spec describes", () => {
    const fd = flightDirector(cruise, null, flightPlan(cruise));
    expect([fd.lateralMode, fd.verticalMode]).toEqual(["ROL", "PIT"]);
    expect(fd.rollCommand).toBe(cruise.roll);
    expect(fd.pitchCommand).toBe(cruise.pitch);
  });
  test("steers to the mission's next point and turns the short way", () => {
    const s = { ...cruise, heading: 0, x: 0, z: 0, target: { x: 1000, z: 0 } };
    const plan = flightPlan(s);
    expect(plan.bearingDeg).toBeCloseTo(90, 6);
    expect(plan.distanceNm).toBeCloseTo(1000 / NM, 6);
    expect(flightDirector(s, null, plan).rollCommand).toBeLessThan(0);
    expect(turnTo(350, 10)).toBe(20);
    expect(turnTo(10, 350)).toBe(-20);
  });
});

describe("the spec's limit speeds and handle positions", () => {
  test("match the Citation CJ4 specification", () => {
    expect(LIMITS).toMatchObject({ vmoKt: 305, mmo: 0.77, vleKt: 200, vfe15Kt: 200, vfe35Kt: 160, radioAltitudeFt: 2500, tcasNm: 35 });
  });
  test("flaps read up, 15 or 35", () => {
    expect([0, 0.65, 1].map(flapDetent)).toEqual([0, 15, 35]);
  });
  test("cabin altitude follows the auto schedule chart", () => {
    expect(cabinAltitudeFt(5000)).toBe(0);
    expect(cabinAltitudeFt(35000)).toBeCloseTo(5500, 6);
    expect(cabinAltitudeFt(45000)).toBeCloseTo(7800, 6);
  });
});

describe("crew alerting", () => {
  test("a healthy cruise has no messages", () => {
    expect(cas(cruise)).toEqual([]);
  });
  test("warnings come first, then cautions, then advisories", () => {
    const s = { ...cruise, stall: true, fuel: 0.05, speedBrake: 1 };
    const messages = deriveFlightDeck(s).cas;
    expect(messages.map((m) => m.level)).toEqual(["warning", "caution", "advisory"]);
    expect(messages.map((m) => m.text)).toEqual(["STALL", "FUEL LOW", "SPEED BRAKE EXTEND"]);
  });
  test("overspeed and configuration limits trip at the spec's speeds", () => {
    const at = (knots: number) => ({ ...cruise, speed: knots / 1.943844 });
    expect(cas(at(300))).not.toContain("OVERSPEED");
    expect(cas(at(310))).toContain("OVERSPEED");
    expect(cas({ ...at(205), gear: 1 })).toContain("GEAR OVERSPEED");
    expect(cas({ ...at(195), gear: 1 })).not.toContain("GEAR OVERSPEED");
    expect(cas({ ...at(170), flaps: 1 })).toContain("FLAP OVERSPEED");
    expect(cas({ ...at(170), flaps: 0.65 })).not.toContain("FLAP OVERSPEED");
  });
  test("the gear horn needs wheels up, low and slow, with the levers back", () => {
    const low = { ...cruise, altitude: 200, speed: 62, power: 0.1, gear: 0 };
    expect(casMessages(low, 500, null, [])).toContainEqual({ level: "warning", text: "GEAR NOT DOWN" });
    expect(casMessages({ ...low, gear: 1 }, 500, null, []).map((m) => m.text)).not.toContain("GEAR NOT DOWN");
    expect(casMessages({ ...low, power: 1 }, 500, null, []).map((m) => m.text)).not.toContain("GEAR NOT DOWN");
  });
});

describe("terrain awareness", () => {
  test("stays silent on the ground, in level cruise and on a good approach", () => {
    expect(tawsAlert({ ...cruise, grounded: true, verticalSpeed: -50 }, 0, null, 0)).toBeNull();
    expect(tawsAlert(cruise, 4000, null, 0)).toBeNull();
    const s = finals();
    expect(tawsAlert(s, radioAltitudeFt(s), approachGuidance(s), 0)).toBeNull();
  });
  test("warns of an excessive descent rate, more urgently as it worsens", () => {
    expect(tawsAlert({ ...cruise, verticalSpeed: -10 }, 400, null, 0)?.text).toBe("SINK RATE");
    expect(tawsAlert({ ...cruise, verticalSpeed: -20 }, 400, null, 0)).toEqual({ level: "warning", text: "PULL UP" });
  });
  test("looks ahead along the flight path for rising terrain", () => {
    // Level, flying north at the island's highest point, starting this far south of it.
    let peak = { x: 0, z: 0, height: -1 };
    for (let x = -2000; x <= 2000; x += 40)
      for (let z = -2000; z <= 2000; z += 40)
        if (groundHeight(x, z) > peak.height) peak = { x, z, height: groundHeight(x, z) };
    const towards = (seconds: number) => ({ ...cruise, heading: 0, x: peak.x, z: peak.z + cruise.groundSpeed! * seconds, altitude: peak.height + 10 });
    expect(peak.height).toBeGreaterThan(50);
    expect(tawsAlert(towards(5), 300, null, 0)).toEqual({ level: "warning", text: "PULL UP" });
    expect(tawsAlert(towards(30), 300, null, 0)).toEqual({ level: "caution", text: "TERRAIN AHEAD" });
  });
  test("calls out the terrain clearance floor and altitude lost after takeoff", () => {
    const descending = { ...cruise, verticalSpeed: -1, speed: 70, groundSpeed: 0 };
    expect(tawsAlert({ ...descending, gear: 0, flaps: 1 }, 400, null, 0)?.text).toBe("TOO LOW GEAR");
    expect(tawsAlert({ ...descending, gear: 1, flaps: 0 }, 200, null, 0)?.text).toBe("TOO LOW FLAPS");
    expect(tawsAlert({ ...descending, gear: 1, flaps: 1 }, 400, null, 500)?.text).toBe("DON'T SINK");
  });
  test("calls out flying below the glideslope", () => {
    const s = { ...finals(1), altitude: palmBay.y + 1.265 + 40, verticalSpeed: -1 };
    const a = approachGuidance(s)!;
    expect(a.gsDeg).toBeLessThan(-1.3);
    expect(tawsAlert(s, radioAltitudeFt(s), a, 0)?.text).toBe("GLIDESLOPE");
  });
});

describe("traffic surveillance", () => {
  const contact = (miles: number, relativeFt: number, air = true) => ({ x: cruise.x + miles * NM, z: cruise.z, y: cruise.altitude + relativeFt / 3.28084, air });
  test("sorts air traffic by threat and ignores ground targets and anything past 35 miles", () => {
    const traffic = trafficAdvisories({ ...cruise, contacts: [contact(5, 0), contact(1.5, 300), contact(0.5, -200), contact(0.5, 0, false), contact(40, 0)] });
    expect(traffic.map((t) => t.level)).toEqual(["RA", "TA", "OTHER"]);
    expect(traffic[0].relativeFt).toBeCloseTo(-200, 3);
  });
  test("raises its alerts through the crew alerting system", () => {
    expect(cas({ ...cruise, contacts: [contact(1.5, 300)] })).toContain("TRAFFIC");
    expect(cas({ ...cruise, contacts: [contact(0.5, 100)] })).toContain("TRAFFIC RA");
  });
});

describe("takeoff altitude-loss memory", () => {
  const approachAt = (feet: number, time: number): CockpitState => ({
    ...finals(feet / (3.28084 * Math.tan(3 * Math.PI / 180) * NM)),
    time,
  });
  function display() {
    const suite = new ProLineSuite(2136);
    const { context, texts } = recorder();
    return {
      suite,
      draw(s: CockpitState) {
        texts.length = 0;
        suite.draw("mfd-systems", context, 512, 640, s);
        return texts;
      },
    };
  }
  test("an airborne start followed by a centered landing never raises DON'T SINK", () => {
    const { suite, draw } = display();
    for (const [i, feet] of [800, 650, 500, 400].entries()) {
      expect(draw(approachAt(feet, i))).not.toContain("DON'T SINK");
      expect(suite.alerts().caution).toBe(false);
    }
  });
  test("losing height just after takeoff still raises the caution", () => {
    const { suite, draw } = display();
    draw({ ...approachAt(0, 0), grounded: true });
    draw({ ...approachAt(200, 1), verticalSpeed: 3 });
    draw({ ...approachAt(400, 2), verticalSpeed: 3 });
    expect(draw(approachAt(250, 3))).toContain("DON'T SINK");
    expect(suite.alerts().caution).toBe(true);
  });
  test("leaving the takeoff envelope disarms altitude-loss alerts for the landing", () => {
    const { suite, draw } = display();
    draw({ ...approachAt(0, 0), grounded: true });
    draw({ ...approachAt(400, 1), verticalSpeed: 3 });
    draw({ ...approachAt(800, 2), verticalSpeed: 3 });
    for (const [i, feet] of [650, 500, 400].entries()) {
      expect(draw(approachAt(feet, i + 3))).not.toContain("DON'T SINK");
      expect(suite.alerts().caution).toBe(false);
    }
  });
  test("touchdown clears the old peak before the next takeoff", () => {
    const { draw } = display();
    draw({ ...approachAt(0, 0), grounded: true });
    draw({ ...approachAt(400, 1), verticalSpeed: 3 });
    draw({ ...approachAt(0, 2), grounded: true });
    expect(draw({ ...approachAt(100, 3), verticalSpeed: -1 })).not.toContain("DON'T SINK");
    draw({ ...approachAt(400, 4), verticalSpeed: 3 });
    expect(draw(approachAt(250, 5))).toContain("DON'T SINK");
  });
  test("rewinding the flight clears a previous takeoff's peak", () => {
    const { draw } = display();
    draw({ ...approachAt(0, 0), grounded: true });
    draw({ ...approachAt(400, 100), verticalSpeed: 3 });
    expect(draw(approachAt(250, 1))).not.toContain("DON'T SINK");
  });
});

describe("electronic checklist", () => {
  test("follows the phase of flight and ticks items from the aircraft's configuration", () => {
    const ready = electronicChecklist({ ...cruise, grounded: true, speed: 0, gear: 1, flaps: 0.65, power: 1 }, null);
    expect(ready.title).toBe("BEFORE TAKEOFF");
    expect(ready.items.every((item) => item.done)).toBe(true);
    const landing = electronicChecklist(finals(), approachGuidance(finals()));
    expect(landing.title).toBe("BEFORE LANDING");
    expect(landing.items.find((item) => item.text === "GEAR DOWN")?.done).toBe(true);
    expect(electronicChecklist({ ...cruise, gear: 1 }, null).items[0]).toEqual({ text: "GEAR UP", done: false });
  });
});

describe("the displays", () => {
  const deck = (s: CockpitState) => deriveFlightDeck(s);
  test("the PFD shows speed, altitude, metres, both baro units and its modes", () => {
    const { context, texts } = recorder();
    drawPfd(context, 512, 640, cruise, deck(cruise));
    for (const value of ["250", "4920", "1500 M", "29.92 IN", "1013 HPA", "ROL", "PIT", "090", "FD"]) expect(texts).toContain(value);
    expect(texts).not.toContain("AP");
  });
  test("the PFD shows radio altitude only below 2,500 feet", () => {
    const low = finals(1);
    const { context, texts } = recorder();
    drawPfd(context, 512, 640, low, deck(low));
    expect(texts.some((value) => value.startsWith("RA "))).toBe(true);
    const high = recorder();
    drawPfd(high.context, 512, 640, cruise, deck(cruise));
    expect(high.texts.some((value) => value.startsWith("RA "))).toBe(false);
  });
  test("the PFD posts the FMS V-speeds and approach guidance", () => {
    const s = finals();
    const { context, texts } = recorder();
    drawPfd(context, 512, 640, s, deck(s));
    for (const value of ["R", "RF", "LOC", "GS"]) expect(texts).toContain(value);
    expect(texts.some((value) => value.startsWith("LOC 109.50"))).toBe(true);
  });
  test("the PFD banners terrain, traffic and stall alerts", () => {
    const s = { ...cruise, stall: true, verticalSpeed: -40, altitude: 200, contacts: [{ x: cruise.x + 900, z: cruise.z, y: 240, air: true }] };
    const { context, texts } = recorder();
    drawPfd(context, 512, 640, s, deck(s));
    for (const value of ["STALL", "PULL UP", "DESCEND"]) expect(texts).toContain(value);
  });
  test("the left MFD reads the flight plan and wind and shows a taxi diagram at a field", () => {
    const s = { ...cruise, target: { x: palmBay.x, z: palmBay.z } };
    const { context, texts } = recorder();
    drawMfdNav(context, 512, 640, s, deck(s));
    expect(texts).toContain("PALM BAY");
    expect(texts).toContain("TERR");
    expect(texts).toContain("WX STBY");
    expect(texts.some((value) => value.startsWith("WIND "))).toBe(true);
    expect(texts.some((value) => value.endsWith(" 01"))).toBe(false);
    const parked = { ...cruise, grounded: true, speed: 0, groundSpeed: 0, x: palmBay.x, z: palmBay.z };
    const chart = recorder();
    drawMfdNav(chart.context, 512, 640, parked, deck(parked));
    expect(chart.texts).toContain("PALM BAY 01");
  });
  test("the right MFD shows engines, alerting and the checklist", () => {
    const s = { ...cruise, stall: true };
    const { context, texts } = recorder();
    drawMfdSystems(context, 512, 640, s, deck(s), 2136);
    for (const value of ["N1 %", "ITT C", "N2 %", "OIL PSI", "FF PPH", "FUEL LB", "534", "STALL", "AFTER TAKEOFF", "GEAR UP"]) expect(texts).toContain(value);
    const clear = recorder();
    drawMfdSystems(clear.context, 512, 640, cruise, deck(cruise), 2136);
    expect(clear.texts).toContain("NO MESSAGES");
  });
  test("the standby instrument and CDU read the same flight", () => {
    const esis = recorder();
    drawEsis(esis.context, 256, 256, cruise, deck(cruise));
    for (const value of ["250", "4920", "090"]) expect(esis.texts).toContain(value);
    const cdu = recorder();
    drawCdu(cdu.context, 384, 240, cruise, deck(cruise), 2136);
    for (const value of ["ACTIVE FLT PLAN", "FOB 1068", "COM 121.70", "XPDR 1200", "TA/RA"]) expect(cdu.texts).toContain(value);
    expect(cdu.texts.some((value) => value.startsWith("DME ") && value.split(" ").length === 4)).toBe(true);
  });
});

describe("the flight deck model", () => {
  const glb = (() => {
    const file = readFileSync("public/assets/cockpits/aurelia.glb");
    return JSON.parse(file.subarray(20, 20 + file.readUInt32LE(12)).toString("utf8")) as {
      nodes: { name?: string; mesh?: number; children?: number[]; translation?: number[] }[];
      meshes: { primitives: { attributes: { POSITION: number } }[] }[];
      accessors: { min?: number[]; max?: number[] }[];
    };
  })();
  const nodes = new Map(glb.nodes.map((node) => [node.name, node]));
  /** Width and height of the first mesh under a named screen node. */
  const screenSize = (name: string) => {
    const node = nodes.get(name)!;
    const child = node.mesh === undefined ? glb.nodes[node.children![0]] : node;
    const { min, max } = glb.accessors[glb.meshes[child.mesh!].primitives[0].attributes.POSITION];
    return { width: max![0] - min![0], extent: Math.hypot(max![1] - min![1], max![2] - min![2]) };
  };
  test("has the spec's four 8 x 10 inch portrait displays, standby instrument and dual CDUs", () => {
    for (const name of ["Screen_PFD", "Copilot_Screen_PFD", "Screen_MFD_L", "Screen_MFD_R"]) {
      const { width, extent } = screenSize(name);
      expect(width).toBeCloseTo(0.2, 3);
      expect(extent).toBeCloseTo(0.25, 3);
    }
    for (const name of ["Screen_ESIS", "Screen_CDU", "Copilot_Screen_CDU"]) expect(nodes.has(name)).toBe(true);
    expect(nodes.has("Standby_ADI_ball")).toBe(false);
    expect(nodes.has("Screen_FMS")).toBe(false);
  });
  test("drives a master warning and caution light on each side", () => {
    for (const name of ["Lamp_master", "Lamp_master_warning", "Copilot_Lamp_master", "Copilot_Lamp_master_warning"]) expect(nodes.has(name)).toBe(true);
  });
  test("every live screen in the spec has a surface", () => {
    const screens = cockpitSpecs.aurelia!.screens;
    expect(screens.map((screen) => screen.kind).sort()).toEqual(["cdu", "esis", "mfd-nav", "mfd-systems", "pfd"]);
    for (const screen of screens) expect(nodes.has(screen.node)).toBe(true);
    // Portrait 8 x 10 proportions for the large displays.
    for (const screen of screens.filter((s) => /pfd|mfd/.test(s.kind))) expect(screen.height / screen.width).toBeCloseTo(1.25, 6);
  });
});
