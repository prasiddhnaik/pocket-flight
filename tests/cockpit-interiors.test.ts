import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import * as T from "three";
import { CockpitInterior } from "../src/aircraft/cockpit-interior";
import { counterRolls, dialAngle } from "../src/aircraft/cockpit-instruments";
import {
  drawEngines,
  drawFlight,
  drawHud,
  drawMpcd,
  drawTews,
  drawUfc,
  drawVsd,
  hudScale,
} from "../src/aircraft/cockpit-avionics";
import { cockpitSpecs } from "../src/aircraft/cockpit-specs";
import { cockpitDriver, gaugeValues, type CockpitSpec, type CockpitState } from "../src/aircraft/cockpit-state";
import gaugeData from "../src/aircraft/f15c/cockpit-gauges.json";

const f15c = cockpitSpecs.f15c as CockpitSpec;
const f15cGaugeValues = (s: CockpitState) => gaugeValues(s, f15c.fuelPounds);
const cruise: CockpitState = {
  time: 100,
  mode: "flight",
  speed: 128.6,
  altitude: 1524,
  pitch: 0.05,
  roll: 0,
  heading: Math.PI / 2,
  verticalSpeed: 5.08,
  power: 0.5,
  fuel: 0.5,
  x: 0,
  z: 0,
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
  approachKnots: 120,
  target: null,
  contacts: [],
  stores: null,
};

function glbJson(path: string) {
  const file = readFileSync(path);
  const length = file.readUInt32LE(12);
  return JSON.parse(file.subarray(20, 20 + length).toString("utf8")) as {
    nodes: { name?: string; mesh?: number }[];
    meshes: { primitives: { indices?: number }[] }[];
    accessors: { count: number }[];
  };
}

describe("dial scales", () => {
  test("interpolates between stops and stops at the ends", () => {
    const stops = [[0, 0], [100, 30], [200, 105]];
    expect(dialAngle(stops, 50)).toBe(15);
    expect(dialAngle(stops, 150)).toBe(67.5);
    expect(dialAngle(stops, -20)).toBe(0);
    expect(dialAngle(stops, 900)).toBe(105);
  });
  test("every gauge in the cockpit has a scale", () => {
    for (const scale of Object.values(gaugeData.gauges))
      expect(gaugeData.scales).toHaveProperty(scale);
  });
});

describe("counter drums", () => {
  test("holds whole digits away from a rollover", () => {
    expect(counterRolls(1450, [1000, 100])).toEqual([1, 4.5]);
  });
  test("the upper drum turns only as the lower one passes nine", () => {
    expect(counterRolls(1950, [1000, 100])).toEqual([1.5, 9.5]);
  });
  test("negative values read zero", () => {
    expect(counterRolls(-40, [1000, 100])).toEqual([0, 0]);
  });
});

describe("what the gauges read", () => {
  test("flight values convert to cockpit units", () => {
    const g = f15cGaugeValues(cruise);
    expect(g.airspeed).toBeCloseTo(250, 0);
    expect(g.altimeter).toBeCloseTo(5000, 0);
    expect(g.vvi).toBeCloseTo(1000, 0);
    expect(g.gmeter).toBe(1);
    expect(g.fuel).toBeCloseTo(6727.5, 1);
  });
  test("engines read shut down when they are out", () => {
    const g = f15cGaugeValues({ ...cruise, engineOut: true, power: 0 });
    expect(g.ftit_left).toBe(200);
    expect(g.flow_left).toBe(0);
    expect(g.oil_left).toBe(0);
    expect(g.rpm_left).toBeLessThan(20);
  });
  test("more power means more heat, flow and rpm", () => {
    const idle = f15cGaugeValues({ ...cruise, power: 0 });
    const mil = f15cGaugeValues({ ...cruise, power: 0.85 });
    expect(mil.rpm_left).toBeGreaterThan(idle.rpm_left);
    expect(mil.ftit_left).toBeGreaterThan(idle.ftit_left);
    expect(mil.flow_left).toBeGreaterThan(idle.flow_left);
  });
  test("the nozzle closes up to military power and opens in afterburner", () => {
    const at = (power: number) => f15cGaugeValues({ ...cruise, power }).nozzle_left;
    expect(at(0.85)).toBeLessThan(at(0));
    expect(at(1)).toBeGreaterThan(at(0.85));
  });
});

describe("the exported models", () => {
  for (const [id, spec] of Object.entries(cockpitSpecs)) {
    const glb = glbJson(`public/assets/cockpits/${id}.glb`);
    const names = new Set(glb.nodes.map((node) => node.name));
    test(`${id}: has a needle for every gauge`, () => {
      for (const gauge of Object.keys(spec.gauges.gauges))
        expect(names.has(`Needle_${gauge}`)).toBe(true);
    });
    test(`${id}: has a surface for every live screen`, () => {
      for (const screen of spec.screens) expect(names.has(screen.node)).toBe(true);
    });
    test(`${id}: has the controls and lamps the game drives`, () => {
      for (const name of ["Throttle_left", "Throttle_right", "Pedal_left", "Pedal_right", "Gear_handle", "Lamp_master", "Lamp_fire_left", "Lamp_fire_right", "Lamp_gear_nose", "Lamp_gear_left", "Lamp_gear_right", "Needle_clock_hour", "Needle_clock_minute", "Needle_clock_second", "Standby_ADI_ball"])
        expect(names.has(name)).toBe(true);
      expect(names.has("Stick") || names.has("Yoke_left")).toBe(true);
    });
    test(`${id}: stays inside its triangle budget`, () => {
      let triangles = 0;
      for (const node of glb.nodes)
        if (node.mesh !== undefined)
          for (const primitive of glb.meshes[node.mesh].primitives)
            triangles += glb.accessors[primitive.indices!].count / 3;
      expect(triangles).toBeGreaterThan(50000);
      expect(triangles).toBeLessThan(220000);
    });
  }
  test("the F-15C has its full analog panel", () => {
    const names = new Set(glbJson("public/assets/cockpits/f15c.glb").nodes.map((node) => node.name));
    for (const name of ["ADI_ball", "HSI_card", "HSI_course", "Stick", "Canopy_attached", "Lamp_speedbrake", "Drum_altitude_0", "Drum_fuel_4"])
      expect(names.has(name)).toBe(true);
  });
  test("tandem jets repeat the moving parts for the rear seat", () => {
    for (const id of ["peregrine", "stormbird"]) {
      const names = new Set(glbJson(`public/assets/cockpits/${id}.glb`).nodes.map((node) => node.name));
      for (const name of ["Rear_Stick", "Rear_Throttle_left", "Rear_Screen_MFD_L", "Rear_Standby_ADI_ball"])
        expect(names.has(name)).toBe(true);
    }
  });
  test("the Aurelia has a yoke and right-hand display for each pilot", () => {
    const names = new Set(glbJson("public/assets/cockpits/aurelia.glb").nodes.map((node) => node.name));
    for (const name of ["Yoke_left", "Yoke_left_wheel", "Yoke_right", "Yoke_right_wheel", "Copilot_Screen_PFD", "Copilot_Pedal_left", "Copilot_Lamp_master"])
      expect(names.has(name)).toBe(true);
  });
});

function fakeCabin() {
  const cabin = new T.Group();
  const add = (name: string, parent: T.Object3D = cabin) => {
    const node = new T.Group();
    node.name = name;
    parent.add(node);
    return node;
  };
  for (const name of [
    "Needle_airspeed", "Needle_altimeter", "Stick", "Throttle_left", "Throttle_right", "Pedal_left", "Pedal_right", "Gear_handle", "ADI_ball", "HSI_card",
  ])
    add(name);
  const attached = add("Canopy_attached");
  attached.position.set(0, 0.38, -3.13);
  return cabin;
}
function fakeAircraft() {
  // Canopy and simple cockpit nodes as the flight model names them.
  const scene = new T.Group();
  const add = (name: string) => {
    const node = new T.Group();
    node.name = name;
    scene.add(node);
    return node;
  };
  return { scene, fixed: add("Cockpit_fixed"), well: add("Cockpit_well"), canopy: add("Canopy") };
}

describe("the interior at runtime", () => {
  const make = () => {
    const aircraft = fakeAircraft();
    const cabin = fakeCabin();
    let loads = 0;
    const interior = new CockpitInterior(aircraft.scene, cockpitDriver(f15c, { screens: false }), async () => {
      loads++;
      return cabin;
    });
    return { aircraft, cabin, interior, loads: () => loads };
  };
  test("does not load until the cockpit camera is used", async () => {
    const { loads, interior } = make();
    expect(loads()).toBe(0);
    interior.setActive(true);
    await interior.loaded;
    expect(loads()).toBe(1);
  });
  test("swaps with the simple cockpit only once it has loaded", async () => {
    const { aircraft, cabin, interior } = make();
    interior.setActive(true);
    expect(aircraft.fixed.visible).toBe(true);
    await interior.loaded;
    expect(aircraft.fixed.visible).toBe(false);
    expect(aircraft.well.visible).toBe(false);
    expect(cabin.visible).toBe(true);
    interior.setActive(false);
    expect(aircraft.fixed.visible).toBe(true);
    expect(aircraft.well.visible).toBe(true);
    expect(cabin.visible).toBe(false);
  });
  test("a second activation does not load it again", async () => {
    const { interior, loads } = make();
    interior.setActive(true);
    interior.setActive(false);
    interior.setActive(true);
    await interior.loaded;
    expect(loads()).toBe(1);
  });
  test("rides the canopy with the parts fixed to it, without moving them", async () => {
    const { aircraft, interior } = make();
    aircraft.canopy.position.set(0, 0.38, -3.13);
    interior.setActive(true);
    await interior.loaded;
    const attached = aircraft.canopy.getObjectByName("Canopy_attached")!;
    expect(attached.parent).toBe(aircraft.canopy);
    expect(attached.getWorldPosition(new T.Vector3()).y).toBeCloseTo(0.38, 5);
  });
  test("cuts the old cabin out of merged meshes only while it shows", async () => {
    const aircraft = new T.Group();
    const geometry = new T.BufferGeometry();
    // One triangle wholly inside the cabin box, one outside it.
    geometry.setAttribute("position", new T.Float32BufferAttribute([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0, 5, 0, 0, 5.1, 0, 0, 5, 0.1, 0], 3));
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    const airframe = new T.Mesh(geometry);
    airframe.name = "Airframe";
    aircraft.add(airframe);
    const glass = new T.Mesh(geometry.clone());
    glass.name = "Canopy_glass";
    aircraft.add(glass);
    const driver = cockpitDriver({ ...f15c, carve: { min: [-1, -1, -1], max: [1, 1, 1], keep: /glass/i } }, { screens: false });
    const interior = new CockpitInterior(aircraft, driver, async () => new T.Group());
    interior.setActive(true);
    await interior.loaded;
    expect(geometry.index!.count).toBe(3);
    expect(glass.geometry.index!.count).toBe(6);
    interior.setActive(false);
    expect(geometry.index!.count).toBe(6);
  });
  test("needles turn clockwise as the value rises", async () => {
    const { cabin, interior } = make();
    interior.setActive(true);
    await interior.loaded;
    const needle = cabin.getObjectByName("Needle_airspeed")!;
    interior.update({ ...cruise, speed: 51.44 }, 10);
    // 100 knots is 30 degrees clockwise, a negative turn about the panel's outward axis.
    const up = new T.Vector3(0, 0, -1).applyQuaternion(needle.quaternion);
    expect(up.x).toBeCloseTo(Math.sin((30 * Math.PI) / 180), 2);
  });
  test("a rear cockpit's needle follows the same reading", async () => {
    const { interior, cabin } = make();
    const rear = new T.Group();
    rear.name = "Rear_Needle_airspeed";
    cabin.add(rear);
    interior.setActive(true);
    await interior.loaded;
    interior.update({ ...cruise, speed: 51.44 }, 10);
    expect(rear.quaternion.angleTo(new T.Quaternion())).toBeCloseTo((30 * Math.PI) / 180, 2);
  });
  test("pulling the stick leans it aft and right roll leans it right", async () => {
    const { cabin, interior } = make();
    interior.setActive(true);
    await interior.loaded;
    const stick = cabin.getObjectByName("Stick")!;
    interior.update({ ...cruise, stick: { pitch: 1, roll: 0, yaw: 0 } }, 10);
    const pulled = new T.Vector3(0, 1, 0).applyQuaternion(stick.quaternion);
    expect(pulled.z).toBeGreaterThan(0.05);
    interior.update({ ...cruise, stick: { pitch: 0, roll: 1, yaw: 0 } }, 10);
    const rolled = new T.Vector3(0, 1, 0).applyQuaternion(stick.quaternion);
    expect(rolled.x).toBeGreaterThan(0.05);
  });
  test("full power moves the throttles forward and they share the same travel", async () => {
    const { cabin, interior } = make();
    interior.setActive(true);
    await interior.loaded;
    const left = cabin.getObjectByName("Throttle_left")!;
    interior.update({ ...cruise, power: 0 }, 10);
    const idle = left.position.z;
    interior.update({ ...cruise, power: 1 }, 10);
    expect(left.position.z).toBeLessThan(idle - 0.1);
    expect(cabin.getObjectByName("Throttle_right")!.position.z).toBeCloseTo(left.position.z, 5);
  });
  test("disposing restores the simple cockpit and removes the interior", async () => {
    const { aircraft, cabin, interior } = make();
    interior.setActive(true);
    await interior.loaded;
    interior.dispose();
    expect(aircraft.fixed.visible).toBe(true);
    expect(cabin.parent).toBeNull();
  });
});

function recorder() {
  const texts: string[] = [];
  const context = new Proxy({} as Record<string, unknown>, {
    get(target, key) {
      if (key === "fillText") return (value: string) => texts.push(String(value));
      if (key === "createRadialGradient" || key === "createLinearGradient") return () => ({ addColorStop() {} });
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

describe("cutting out an old cabin", () => {
  test("can also remove long faces that only cross the box", async () => {
    const aircraft = new T.Group();
    const geometry = new T.BufferGeometry();
    // A long triangle with one corner inside the box, and one wholly outside it.
    geometry.setAttribute("position", new T.Float32BufferAttribute([0, 0, 0, 9, 0, 0, 0, 9, 0, 5, 0, 0, 5.1, 0, 0, 5, 0.1, 0], 3));
    geometry.setIndex([0, 1, 2, 3, 4, 5]);
    aircraft.add(new T.Mesh(geometry));
    const driver = cockpitDriver({ ...f15c, carve: { min: [-1, -1, -1], max: [1, 1, 1], keep: /glass/i, touching: true } }, { screens: false });
    const interior = new CockpitInterior(aircraft, driver, async () => new T.Group());
    interior.setActive(true);
    await interior.loaded;
    expect(geometry.index!.count).toBe(3);
  });
});

describe("the live screens", () => {
  test("the HUD is scaled so a degree on the glass matches a degree outside", () => {
    // 1.10 m to a glass 0.244 m tall drawn on 610 pixels is about 48 pixels a degree.
    expect(hudScale(610)).toBeCloseTo(48, 0);
  });
  test("the HUD shows speed, altitude and heading", () => {
    const { context, texts } = recorder();
    drawHud(context, 640, 610, cruise);
    expect(texts).toContain("250");
    expect(texts.join(" ")).toContain("50");
    expect(texts.join(" ")).toContain("090");
  });
  test("the HUD shows a stall warning and the approach speed when slowing", () => {
    const { context, texts } = recorder();
    drawHud(context, 640, 610, { ...cruise, stall: true, slowingToLand: true });
    expect(texts).toContain("STALL");
    expect(texts.join(" ")).toContain("120");
  });
  test("the HUD says fast above the approach speed and slow below it", () => {
    const fast = recorder();
    drawHud(fast.context, 640, 610, { ...cruise, slowingToLand: true, speed: 90 });
    expect(fast.texts).toContain("FAST");
    const slow = recorder();
    drawHud(slow.context, 640, 610, { ...cruise, slowingToLand: true, speed: 50 });
    expect(slow.texts).toContain("SLOW");
  });
  test("the HUD shows stores in the combat range", () => {
    const { context, texts } = recorder();
    drawHud(context, 640, 610, { ...cruise, stores: { gun: 940, rockets: 8, missiles: 6, locked: true } });
    expect(texts.join(" ")).toContain("940");
    expect(texts).toContain("LOCK");
  });
  test("the radar lists a contact and reads no target without one", () => {
    const empty = recorder();
    drawVsd(empty.context, 384, cruise);
    expect(empty.texts.join(" ")).toContain("NO TGT");
    const found = recorder();
    drawVsd(found.context, 384, { ...cruise, contacts: [{ x: 0, z: -3000, y: 1500, air: true }] });
    expect(found.texts.join(" ")).not.toContain("NO TGT");
  });
  test("the threat display reads clear without contacts", () => {
    const { context, texts } = recorder();
    drawTews(context, 384, cruise);
    expect(texts).toContain("CLEAR");
  });
  test("the colour display moves from navigation to stores in the range", () => {
    const map = recorder();
    drawMpcd(map.context, 512, cruise);
    expect(map.texts).toContain("NAV");
    const arm = recorder();
    drawMpcd(arm.context, 512, { ...cruise, stores: { gun: 500, rockets: 7, missiles: 5, locked: false } });
    expect(arm.texts.join(" ")).toContain("500");
    expect(arm.texts).toContain("ARM");
  });
  test("the flight display shows speed, altitude and heading", () => {
    const { context, texts } = recorder();
    drawFlight(context, 512, 512, cruise);
    expect(texts).toContain("250");
    expect(texts).toContain("090");
  });
  test("the engine page reports the fuel and an engine failure", () => {
    const { context, texts } = recorder();
    drawEngines(context, 512, 512, { ...cruise, engineOut: true }, 13455);
    expect(texts.join(" ")).toContain("6728");
    expect(texts).toContain("ENGINE OUT");
  });
  test("the up-front display fits its rows into a short readout", () => {
    const rows: number[] = [];
    const { context } = recorder();
    const tracked = new Proxy(context, {
      get(target, key) {
        if (key === "fillText") return (_text: string, _x: number, y: number) => rows.push(y);
        return Reflect.get(target, key);
      },
      set(target, key, value) {
        return Reflect.set(target, key, value);
      },
    });
    drawUfc(tracked, 512, 124, cruise);
    expect(rows.length).toBe(4);
    expect(Math.max(...rows)).toBeLessThan(124);
  });
  test("the up-front display shows fuel and steering", () => {
    const { context, texts } = recorder();
    drawUfc(context, 512, 168, { ...cruise, target: { x: 0, z: -1852 } });
    expect(texts.join(" ")).toContain("6728");
    expect(texts.join(" ")).toContain("1.0");
  });
});
