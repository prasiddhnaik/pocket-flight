import { expect, test } from "bun:test";
import * as T from "three";
import { AureliaAvionics } from "../src/aircraft/aurelia/avionics";
import { aureliaAvionicsDemo } from "../src/aircraft/aurelia/avionics-demo";
import {
  aureliaAvionicsFromFlight,
  projectAureliaMap,
  shouldRenderAureliaAvionics,
  avionicsUtc,
} from "../src/aircraft/aurelia/avionics-state";
import { makeAureliaReference } from "../src/aircraft/aurelia/reference-model";

const demo = aureliaAvionicsDemo(0, { gear: 1, flaps: 0 });
const systems = {
  ...demo,
  busVoltage: 27.4,
  utcSeconds: 86399,
  radio: {
    com1MHz: 123.45,
    baroInHg: 30.12,
    transponderCode: "0421",
    transponderMode: "ON",
  },
  engines: [
    { n1: 61.2, n2: 80.1, ittC: 554, oilPsi: 43, oilC: 98, fuelLb: 901 },
    { n1: 72.3, n2: 92.4, ittC: 623, oilPsi: 49, oilC: 111, fuelLb: 812 },
  ] as const,
};
const flight = {
  time: 0,
  revision: 100,
  position: { x: 875, y: 3010.2048, z: -310 },
  velocity: { x: 30, y: -5.08, z: -40 },
  indicatedAirspeedMps: (137 * 1852) / 3600,
  yaw: -Math.PI / 2,
  pitch: 0.1,
  roll: -0.2,
  gear: 0.43,
  flaps: 0.61,
};

test("SI telemetry adapter preserves position, separates IAS from GS, and converts vertical motion and yaw", () => {
  const s = aureliaAvionicsFromFlight(flight, systems, demo.navigation);
  expect(s.source).toBe("flight");
  expect(s.speedKt).toBeCloseTo(137, 9);
  expect(s.groundSpeedKt).toBeCloseTo((50 * 3600) / 1852, 9);
  expect(s.altitudeFt).toBeCloseTo(9876, 9);
  expect(s.verticalSpeedFpm).toBeCloseTo(-1000, 9);
  expect(s.headingDeg).toBe(90);
  expect(s.navigation.position).toEqual({ x: 875, z: -310 });
  expect(s.pitch).toBe(0.1);
  expect(s.roll).toBe(-0.2);
  expect(s.gear).toBe(0.43);
  expect(s.flaps).toBe(0.61);
  expect(s.engines).toEqual(systems.engines);
  for (const [yaw, heading] of [
    [0, 0],
    [Math.PI / 2, 270],
    [Math.PI, 180],
    [-Math.PI * 4.5, 90],
  ])
    expect(
      aureliaAvionicsFromFlight({ ...flight, yaw }, systems, demo.navigation)
        .headingDeg,
    ).toBeCloseTo(heading, 8);
});

test("map translation, heading rotation and nautical-mile range share one world coordinate projection", () => {
  const nav = { ...demo.navigation, position: { x: 800, z: -400 }, rangeNm: 1 };
  expect(projectAureliaMap(nav.position, nav, 90)).toEqual([234, 276]);
  const east = { x: 800 + 1852, z: -400 };
  const north = { x: 800, z: -400 - 1852 };
  expect(
    projectAureliaMap(east, { ...nav, orientation: "north-up" }, 90),
  ).toEqual([374, 276]);
  const ahead = projectAureliaMap(east, nav, 90);
  expect(ahead[0]).toBeCloseTo(234, 9);
  expect(ahead[1]).toBeCloseTo(136, 9);
  expect(projectAureliaMap(north, nav, 90)[0]).toBeCloseTo(94, 9);
  expect(projectAureliaMap(east, { ...nav, rangeNm: 2 }, 90)[1]).toBeCloseTo(
    206,
    9,
  );
  expect(projectAureliaMap(east, { ...nav, position: east }, 90)).toEqual([
    234, 276,
  ]);
});

test("paused-time telemetry revisions, playback rewind and background cadence remain supported", () => {
  const next = { ...demo, revision: 2, altitudeFt: 9999 };
  expect(shouldRenderAureliaAvionics(demo, next, 0.051, true)).toBe(true);
  expect(shouldRenderAureliaAvionics(demo, next, 0.01, true)).toBe(false);
  expect(shouldRenderAureliaAvionics(demo, next, 0.49, false)).toBe(false);
  expect(shouldRenderAureliaAvionics(demo, next, 0.51, false)).toBe(true);
  expect(shouldRenderAureliaAvionics(demo, demo, 10, true)).toBe(false);
  expect(
    shouldRenderAureliaAvionics(demo, { ...demo, gear: 0.5 }, 0, false),
  ).toBe(true);
  expect(
    shouldRenderAureliaAvionics(next, { ...next, time: -1 }, 0, false),
  ).toBe(true);
  expect(avionicsUtc(86399)).toBe("23:59:59Z");
  expect(avionicsUtc(86400)).toBe("00:00:00Z");
  expect(avionicsUtc(-1)).toBe("23:59:59Z");
});

test("all five mounted displays render supplied readings, not internally generated demo values", () => {
  const originalDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const text: string[] = [];
  const commands: { method: string; args: unknown[] }[] = [];
  const context = new Proxy(
    {},
    {
      get:
        (_, method: string) =>
        (...args: unknown[]) => {
          commands.push({ method, args });
          if (method === "fillText") text.push(String(args[0]));
          if (method === "createLinearGradient") return { addColorStop() {} };
        },
    },
  );
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {
      hidden: false,
      createElement: () => ({ width: 0, height: 0, getContext: () => context }),
    },
  });
  const root = makeAureliaReference().root;
  const glass = root.getObjectByName("Inactive_screen") as T.Mesh;
  const originalGeometry = glass.geometry,
    originalMaterial = glass.material;
  let avionics: AureliaAvionics | undefined;
  try {
    avionics = new AureliaAvionics(root, demo);
    text.length = 0;
    commands.length = 0;
    const s = aureliaAvionicsFromFlight(flight, systems, {
      ...demo.navigation,
      rangeNm: 1,
      route: [{ id: "LIVE WAYPOINT", x: 900, z: -500 }],
      runways: [
        {
          id: "LIVE RUNWAY",
          start: { x: 875, z: -310 },
          end: { x: 1852 + 875, z: -310 },
        },
      ],
    });
    const before = structuredClone(s);
    expect(avionics.update(s, true)).toBe(true);
    for (const value of [
      "137",
      "09876",
      "GS 97 KT",
      "61.2",
      "72.3",
      "80.1",
      "92.4",
      "554",
      "623",
      "43 / 98",
      "49 / 111",
      "901",
      "812",
      "1713 LB",
      "27.4 V",
      "BARO 30.12",
      "COM1  123.450",
      "XPDR  0421 ON",
      "COM1 123.450  23:59:59Z",
      "LIVE WAYPOINT",
      "LIVE RUNWAY",
      "1 NM",
    ])
      expect(text, value).toContain(value);
    expect(text).not.toContain("AVIONICS DEMO");
    expect(text).not.toContain("MAP  ·  AVIONICS DEMO");
    expect(s).toEqual(before);
    expect(avionics.snapshot().state).toEqual(s);
    expect(avionics.snapshot().screens).toBe(5);
    expect(avionics.snapshot().canvases).toBe(8);
    const end = projectAureliaMap(
      s.navigation.runways[0].end,
      s.navigation,
      s.headingDeg,
    );
    expect(
      commands.some(
        (call) =>
          call.method === "lineTo" &&
          Math.abs(Number(call.args[0]) - end[0]) < 1e-9 &&
          Math.abs(Number(call.args[1]) - end[1]) < 1e-9,
      ),
    ).toBe(true);
    text.length = 0;
    avionics.update(
      { ...s, revision: s.revision + 1, speedKt: 202, altitudeFt: 12000 },
      true,
    );
    expect(text).toContain("202");
    expect(text).toContain("12000");
    expect(text).not.toContain("09876");
  } finally {
    avionics?.dispose();
    if (originalDocument)
      Object.defineProperty(globalThis, "document", originalDocument);
    else Reflect.deleteProperty(globalThis, "document");
  }
  expect(glass.geometry).toBe(originalGeometry);
  expect(glass.material).toBe(originalMaterial);
  expect(avionics!.update(demo, true)).toBe(false);
});
