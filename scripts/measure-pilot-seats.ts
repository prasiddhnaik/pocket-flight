// Measures where the pilot's eye, hands and feet go in each aircraft: bun scripts/measure-pilot-seats.ts [--check]
// Reads the detail cockpits and the Finch and Heron models; writes src/aircraft/pilot-seats.json in aircraft-group metres.
import * as T from "three";
import { loadGeometryOnly } from "./geometry-loader";
import { JET_CENTER, JET_SCALE, type AircraftId } from "../src/aircraft/aircraft";
import { STORMBIRD_CENTER } from "../src/aircraft/stormbird/stormbird-config";
import { aureliaFlightOffsetY } from "../src/aircraft/aurelia/flight-model";
import { cockpitSpecs } from "../src/aircraft/cockpit-specs";

type V = [number, number, number];
type Q = [number, number, number, number];
export type MeasuredGrip =
  | { kind: "stick"; pivot: V; rest: Q; grip: V }
  | { kind: "yoke"; base: V; rest: Q; wheel: V; wheelRest: Q; grip: V }
  | { kind: "throttle"; at: V }
  | { kind: "fixed"; at: V }
  | { kind: "thigh" };
export type MeasuredSeat = { eye: V; right: MeasuredGrip; left: MeasuredGrip; pedals: [V, V]; pedalsMove: boolean };

const asset = (file: string) => new URL(`../public/assets/${file}`, import.meta.url);
const round = (values: ArrayLike<number>) => Array.from(values, (v) => Math.round(v * 10000) / 10000);
const v = (p: T.Vector3) => round(p.toArray()) as V;
const q = (r: T.Quaternion) => round(r.toArray()) as Q;
// Palm centres in each control's own frame, from scripts/cockpit/kit.py (game axes: y up, z aft).
const STICK_PALM = new T.Vector3(0, 0.56, 0.03);
const SIDE_STICK_PALM = new T.Vector3(0, 0.14, -0.015);
const THROTTLE_PALM = new T.Vector3(0, 0.12, -0.01);
const YOKE_PALM = new T.Vector3(-0.112, 0.045, 0.008);
const PEDAL_BALL = new T.Vector3(0, 0.12, -0.02);
const sceneY: Partial<Record<AircraftId, number>> = { f15c: 0, peregrine: -JET_CENTER * JET_SCALE, stormbird: -STORMBIRD_CENTER, aurelia: aureliaFlightOffsetY };

async function cockpit(id: "f15c" | "peregrine" | "stormbird" | "aurelia"): Promise<MeasuredSeat> {
  const { scene } = await loadGeometryOnly(asset(`cockpits/${id}.glb`));
  // The cockpit root undoes the flight model's scale; in the aircraft group everything is in metres.
  scene.getObjectByName(`${id}_cockpit`)!.scale.setScalar(1);
  scene.position.y = sceneY[id]!;
  scene.updateMatrixWorld(true);
  const node = (name: string) => {
    const found = scene.getObjectByName(name);
    if (!found) throw new Error(`${id} cockpit is missing ${name}`);
    return found;
  };
  const at = (name: string, local = new T.Vector3()) => node(name).localToWorld(local.clone());
  const throttle = at("Throttle_left", THROTTLE_PALM).add(at("Throttle_right", THROTTLE_PALM)).multiplyScalar(0.5);
  const pedals: [V, V] = [v(at("Pedal_left", PEDAL_BALL)), v(at("Pedal_right", PEDAL_BALL))];
  const eye = cockpitSpecs[id]!.eye.slice() as V;
  if (id === "aurelia") {
    const base = node("Yoke_left"), wheel = node("Yoke_left_wheel");
    return {
      eye, pedals, pedalsMove: true,
      left: { kind: "yoke", base: v(base.getWorldPosition(new T.Vector3())), rest: q(base.getWorldQuaternion(new T.Quaternion())), wheel: v(wheel.position), wheelRest: q(wheel.quaternion), grip: v(YOKE_PALM) },
      right: { kind: "throttle", at: v(throttle) },
    };
  }
  const stick = node("Stick");
  return {
    eye, pedals, pedalsMove: true,
    right: { kind: "stick", pivot: v(stick.getWorldPosition(new T.Vector3())), rest: q(stick.getWorldQuaternion(new T.Quaternion())), grip: v(id === "stormbird" ? SIDE_STICK_PALM : STICK_PALM) },
    left: { kind: "throttle", at: v(throttle) },
  };
}

async function model(file: string) {
  const { scene } = await loadGeometryOnly(asset(file));
  scene.updateMatrixWorld(true);
  return (name: string) => {
    // Three.js drops dots from node names; the original stays in userData.
    let found: T.Object3D | undefined;
    scene.traverse((node) => { if (!found && (node.userData.name ?? node.name) === name) found = node; });
    if (!found) throw new Error(`${file} is missing ${name}`);
    return new T.Box3().setFromObject(found);
  };
}

async function finch(): Promise<MeasuredSeat> {
  const box = await model("finch-u2.glb");
  const stick = box("ControlStick_Left");
  const top = new T.Vector3((stick.min.x + stick.max.x) / 2, stick.max.y - 0.04, (stick.min.z + stick.max.z) / 2);
  const ball = (name: string) => {
    const pedal = box(name);
    return v(new T.Vector3((pedal.min.x + pedal.max.x) / 2, pedal.min.y + 0.1, pedal.max.z - 0.01));
  };
  return {
    eye: [-0.3, 1.01, 0.1],
    right: { kind: "fixed", at: v(top) },
    left: { kind: "thigh" },
    pedals: [ball("RudderPedal_Left_-1"), ball("RudderPedal_Left_1")],
    pedalsMove: false,
  };
}

async function heron(): Promise<MeasuredSeat> {
  const box = await model("heron-ut9.glb");
  const centre = (name: string) => box(name).getCenter(new T.Vector3());
  const eye = new T.Vector3(-0.4, 0.75, -1.8);
  const panel = box("Instrument_panel");
  const cushion = box("Seat_cushion_0_-1");
  // No rudder pedals are modelled: the feet rest on the floor under the panel.
  const foot = (side: number) => v(new T.Vector3(eye.x + side * 0.12, cushion.min.y - 0.18, panel.max.z + 0.18));
  return {
    eye: v(eye),
    left: { kind: "fixed", at: v(centre("Yoke_grip_-0.4_-1")) },
    right: { kind: "throttle", at: v(centre("Throttle_handle")) },
    pedals: [foot(-1), foot(1)],
    pedalsMove: false,
  };
}

export async function measurePilotSeats() {
  return {
    finch: await finch(),
    heron: await heron(),
    f15c: await cockpit("f15c"),
    peregrine: await cockpit("peregrine"),
    stormbird: await cockpit("stormbird"),
    aurelia: await cockpit("aurelia"),
  } satisfies Record<AircraftId, MeasuredSeat>;
}

if (import.meta.main) {
  const out = new URL("../src/aircraft/pilot-seats.json", import.meta.url);
  const text = JSON.stringify(await measurePilotSeats(), null, 1) + "\n";
  if (process.argv.includes("--check")) {
    if ((await Bun.file(out).text()) !== text) throw new Error("pilot-seats.json is stale: run bun scripts/measure-pilot-seats.ts");
    console.log("pilot-seats.json is current");
  } else {
    await Bun.write(out, text);
    console.log(text);
  }
}
