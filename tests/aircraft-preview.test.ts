import { expect, test } from "bun:test";
import { Object3D, Quaternion, Vector3 } from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { F15CEffects } from "../src/aircraft/f15c/effects";
import { f15cControlSurfaces } from "../src/aircraft/f15c/mechanisms";
import { controlSurfaces } from "../src/aircraft/finch/control-surfaces";
import { propellerAnimation } from "../src/aircraft/finch/propeller";
import { aircraftNames, aircraftViewerUrl } from "../src/app/flight-ui";
import {
  initialPreviewSettings,
  previewCapabilities,
  previewConfiguration,
  previewAircraftId,
  setPreviewRange,
  setPreviewToggle,
  updateAircraftPreview,
} from "../src/viewers/aircraft-preview";
import { withPresentationDOM } from "./helpers/presentation-dom";

test("hangar configurations respect every aircraft's available systems", () => {
  for (const id of Object.keys(aircraftNames)) {
    const aircraft = previewAircraftId(id),
      capabilities = previewCapabilities(aircraft);
    const clean = previewConfiguration(aircraft, "clean");
    const landing = previewConfiguration(aircraft, "landing");
    const inspect = previewConfiguration(aircraft, "inspect");
    expect(clean.gear).toBe(!capabilities.gear);
    expect(landing.gear).toBe(true);
    expect(landing.flaps).toBe(capabilities.flaps ? 1 : 0);
    expect(inspect.canopy).toBe(capabilities.canopy);
    expect(inspect.airbrake).toBe(capabilities.airbrake);
    for (const state of [clean, landing, inspect]) {
      expect(state.power).toBe(0);
      expect(state.firing).toBe(false);
      expect([state.roll, state.pitch, state.yaw]).toEqual([0, 0, 0]);
    }
  }
});

test("precise hangar inputs clamp to rig travel and keep canopy and power requests consistent", () => {
  const state = initialPreviewSettings();
  setPreviewRange(state, "f15c", "power", 0.8);
  setPreviewToggle(state, "f15c", "canopy", true);
  expect(state.power).toBe(0);
  expect(state.canopy).toBe(true);
  setPreviewRange(state, "f15c", "power", 2);
  expect(state.power).toBe(1);
  expect(state.canopy).toBe(false);
  setPreviewRange(state, "f15c", "roll", -2);
  setPreviewRange(state, "f15c", "pitch", 2);
  setPreviewRange(state, "f15c", "yaw", 0.37);
  expect([state.roll, state.pitch, state.yaw]).toEqual([-1, 1, 0.37]);
  setPreviewRange(state, "f15c", "yaw", NaN);
  expect(state.yaw).toBe(0.37);
  const finch = initialPreviewSettings();
  setPreviewToggle(finch, "finch", "gear", false);
  setPreviewToggle(finch, "finch", "canopy", true);
  setPreviewRange(finch, "finch", "flaps", 1);
  expect(finch).toEqual(initialPreviewSettings());
});

test("hangar landing and inspection configurations reach the actual Eagle mechanisms", () =>
  withPresentationDOM(async () => {
    const { scene } = await loadGeometryOnly(
      new URL("../public/assets/f15c-eagle.glb", import.meta.url),
    );
    const effects = new F15CEffects(scene);
    const aircraft = {
      id: "f15c" as const,
      effects,
      surfaces: f15cControlSurfaces(effects.mechanisms.parts),
      setConfiguration() {},
      propellerMotion: propellerAnimation(),
    };
    for (const configuration of ["clean", "landing", "inspect"] as const) {
      const state = previewConfiguration("f15c", configuration);
      for (let frame = 0; frame < 600; frame++)
        updateAircraftPreview(aircraft, state, 1 / 60);
      expect(effects.motion.gear).toBeCloseTo(Number(state.gear), 3);
      expect(effects.motion.flaps).toBeCloseTo(state.flaps, 3);
      expect(effects.motion.canopy).toBeCloseTo(Number(state.canopy), 3);
      expect(effects.motion.speedBrake).toBeCloseTo(Number(state.airbrake), 3);
    }
    effects.dispose();
  }));

test("game viewer links retain every aircraft and paint, while invalid deep links fall back safely", () => {
  for (const id of Object.keys(aircraftNames)) {
    const aircraft = previewAircraftId(id);
    const link = new URL(
      aircraftViewerUrl(aircraft, 3),
      "https://pocket-flight.example",
    );
    expect(link.pathname).toBe("/aircraft.html");
    expect(previewAircraftId(link.searchParams.get("aircraft"))).toBe(id);
    expect(link.searchParams.get("paint")).toBe("3");
  }
  for (const id of [null, "", "__proto__", "toString", "unknown", "F15C"])
    expect(previewAircraftId(id)).toBe("finch");
});

test("viewer controls drive the actual Eagle gear, flaps, speedbrake, nozzles and cannon, then reset", () =>
  withPresentationDOM(async () => {
    const { scene } = await loadGeometryOnly(
      new URL("../public/assets/f15c-eagle.glb", import.meta.url),
    );
    const effects = new F15CEffects(scene);
    const aircraft = {
      id: "f15c" as const,
      effects,
      surfaces: f15cControlSurfaces(effects.mechanisms.parts),
      setConfiguration() {},
      propellerMotion: propellerAnimation(),
    };
    const state = {
      ...initialPreviewSettings(),
      power: 1,
      gear: false,
      flaps: 1,
      airbrake: true,
      firing: true,
      roll: 0.5,
    };
    for (let frame = 0; frame < 600; frame++)
      updateAircraftPreview(aircraft, state, 1 / 60);
    expect(effects.motion.rpm).toBe(1);
    expect(effects.motion.burner).toBeGreaterThan(0.999);
    expect(effects.motion.gear).toBeLessThan(0.001);
    expect(effects.motion.flaps).toBeGreaterThan(0.999);
    expect(effects.motion.speedBrake).toBeGreaterThan(0.999);
    expect(effects.motion.gunSpeed).toBeGreaterThan(100);
    const rotor = scene.getObjectByName("F15C_gun_rotor")!;
    expect(rotor.rotation.z).toBeCloseTo(-effects.motion.gunAngle, 6);
    expect(
      scene.getObjectByName("Airbrake")!.quaternion.angleTo(new Quaternion()),
    ).toBeGreaterThan(0.9);
    expect(
      scene
        .getObjectByName("Aileron_Left")!
        .quaternion.angleTo(new Quaternion()),
    ).toBeGreaterThan(0.1);
    expect(
      scene.getObjectByName("Flap_Left")!.quaternion.angleTo(new Quaternion()),
    ).toBeGreaterThan(0.4);
    const frozen = JSON.stringify(effects.motion);
    updateAircraftPreview(aircraft, initialPreviewSettings(), 0);
    expect(JSON.stringify(effects.motion)).toBe(frozen);
    effects.reset();
    expect(effects.motion.gunSpeed).toBe(0);
    expect(effects.motion.gear).toBe(1);
    expect(rotor.rotation.z).toBeCloseTo(0, 10);
    effects.dispose();
  }));

test("propeller inspection keeps Heron fixed gear and drives its actual surfaces and propeller", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/heron-ut9.glb", import.meta.url),
  );
  const parts = new Map<string, Object3D>();
  scene.traverse((node) => parts.set(node.name, node));
  const propeller = propellerAnimation({
    radius: 1.32,
    blades: 4,
    idleRpm: 600,
    maxRpm: 1900,
  });
  propeller.bind(parts.get("Propeller")!);
  const gear = parts.get("LandingGear")!;
  const before = gear.getWorldPosition(new Vector3());
  const aircraft = {
    id: "heron" as const,
    effects: null,
    surfaces: controlSurfaces(parts),
    propellerMotion: propeller,
    setConfiguration(flaps: number) {
      for (const name of ["Flap_Left", "Flap_Right"])
        parts.get(name)!.rotation.x = (flaps * 35 * Math.PI) / 180;
    },
  };
  const state = {
    ...initialPreviewSettings(),
    power: 1,
    gear: false,
    roll: 1,
    pitch: 0.5,
    yaw: -0.5,
    flaps: 1,
  };
  for (let frame = 0; frame < 240; frame++)
    updateAircraftPreview(aircraft, state, 1 / 60);
  expect(propeller.snapshot().rpm).toBeGreaterThan(1890);
  expect(parts.get("Aileron_Left")!.rotation.x).toBeGreaterThan(0.35);
  expect(parts.get("Aileron_Right")!.rotation.x).toBeLessThan(-0.35);
  expect(parts.get("Elevator")!.rotation.x).toBeLessThan(-0.2);
  expect(gear.getWorldPosition(new Vector3()).distanceTo(before)).toBe(0);
  const frozen = propeller.snapshot();
  updateAircraftPreview(aircraft, state, 1 / 60, true);
  expect(propeller.snapshot()).toEqual(frozen);
});
