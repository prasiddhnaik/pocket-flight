import * as T from "three";
import { loadGeometryOnly } from "../geometry-loader";
import { Pilot } from "../../src/aircraft/pilot";
import { cockpitDriver, type CockpitState } from "../../src/aircraft/cockpit-state";
import { cockpitSpecs } from "../../src/aircraft/cockpit-specs";
import { JET_CENTER, JET_SCALE } from "../../src/aircraft/aircraft";
import { STORMBIRD_CENTER } from "../../src/aircraft/stormbird/stormbird-config";
import { aureliaFlightOffsetY } from "../../src/aircraft/aurelia/flight-model";
import type { FitId } from "./limits";

export type FitMap = { id: string; parts: { name: string; material: string; min: [number, number, number]; max: [number, number, number] }[]; surfaces: { id: string; surface: string; corners: [number, number, number][] }[] };
export async function load(id: FitId) {
  const group = new T.Group();
  const { scene } = await loadGeometryOnly(new URL(`../../public/assets/cockpits/${id}.glb`, import.meta.url));
  const root = scene.getObjectByName(`${id}_cockpit`);
  if (!root) throw new Error(`Missing ${id}_cockpit`);
  root.scale.setScalar(1);
  scene.position.y = { f15c: 0, peregrine: -JET_CENTER * JET_SCALE, stormbird: -STORMBIRD_CENTER, aurelia: aureliaFlightOffsetY }[id];
  group.add(scene);
  const driver = cockpitDriver(cockpitSpecs[id]!, { screens: false });
  driver.bind(scene);
  const pilot = new Pilot(group, id, loadGeometryOnly(new URL("../../public/assets/pilot/fighter-pilot.glb", import.meta.url)));
  await pilot.ready;
  pilot.setFirstPerson(true);
  const file = Bun.file(new URL(`../../assets/${id}/cockpit/fit-map.json`, import.meta.url));
  const map: FitMap | undefined = await file.exists() ? await file.json() : undefined;
  if (map && (map.id !== id || !Array.isArray(map.parts) || !Array.isArray(map.surfaces))) throw new Error(`Invalid fit map for ${id}`);
  return { group, scene, pilot, driver, map };
}
export function state(c: { pitch: number; roll: number; yaw: number; power: number }): CockpitState {
  return { time: 0, mode: "flight", speed: 100, altitude: 1000, pitch: 0, roll: 0, heading: 0, verticalSpeed: 0, power: c.power, fuel: 1, x: 0, z: 0, engineOut: false, stall: false, aoa: 0, gLoad: 1, gear: 0, flaps: 0, stick: c, speedBrake: 0, night: false, grounded: false, slowingToLand: false, approachKnots: 100, target: null, contacts: [], stores: null };
}
