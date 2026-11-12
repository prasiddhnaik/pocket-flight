import { expect, test } from "bun:test";
import * as T from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { measurePilotSeats } from "../scripts/measure-pilot-seats";
import type { AircraftId } from "../src/aircraft/aircraft";
import { ANKLE_FROM_BALL, gripTarget, Pilot, pilotSeats, wristOffset } from "../src/aircraft/pilot";
import seats from "../src/aircraft/pilot-seats.json";
import rig from "../src/aircraft/pilot-rig.json";

const model = () => loadGeometryOnly(new URL("../public/assets/pilot/fighter-pilot.glb", import.meta.url));
const ids: AircraftId[] = ["finch", "heron", "f15c", "peregrine", "stormbird", "aurelia"];

test("the pilot model is rigged, skinned and light enough for every aircraft", async () => {
  const { scene } = await model();
  const bones: string[] = [];
  let skinned = 0, triangles = 0;
  scene.traverse((node) => {
    if (node instanceof T.Bone) bones.push(node.name);
    if (node instanceof T.SkinnedMesh) {
      skinned++;
      triangles += (node.geometry.index?.count ?? 0) / 3;
    }
  });
  for (const name of ["hips", "head", "upperarm_L", "forearm_R", "hand_L", "thigh_R", "shin_L", "foot_R"]) expect(bones).toContain(name);
  expect(skinned).toBe(2);
  expect(triangles).toBe(rig.triangles);
  expect(triangles).toBeLessThan(50000);
});

test("measured seat positions match the current cockpit and aircraft models", async () => {
  expect(JSON.parse(JSON.stringify(await measurePilotSeats()))).toEqual(seats);
});

for (const id of ids)
  test(`the ${id} pilot's eye is the camera and his hands and feet reach the controls`, async () => {
    const group = new T.Group();
    const pilot = new Pilot(group, id, model());
    await pilot.ready;
    const seat = pilotSeats[id];
    for (const firstPerson of [false, true]) {
      pilot.setFirstPerson(firstPerson);
      for (const controls of [{ pitch: 0, roll: 0, yaw: 0, power: 0 }, { pitch: 1, roll: -1, yaw: 1, power: 1 }]) {
        pilot.update(controls);
        // Leaning for a far control moves the head; from the seat it stays round the camera.
        const resting = controls.power === 0;
        if (firstPerson) expect(pilot.locate().distanceTo(new T.Vector3(...seat.eye)), `${id} eye`).toBeLessThan(resting ? 0.06 : 0.08);
        // A few centimetres short is allowed where a control sits beyond a lean and a stretch;
        // at full deflection (the F-15C throttle travels 24 cm) the arm may have to stretch towards it.
        for (const [grip, bone, sign] of [[seat.right, "hand_R", 1], [seat.left, "hand_L", -1]] as const) {
          if (grip.kind === "thigh") continue;
          const wrist = gripTarget(id, grip, controls).add(wristOffset(grip)).add(new T.Vector3(sign * 0.01, 0, 0));
          const hand = pilot.locate(bone), miss = hand.distanceTo(wrist);
          if (resting || miss < 0.05) {
            expect(miss, `${id} ${bone}`).toBeLessThan(0.05);
            continue;
          }
          // Out of reach: the arm is straight and points at the control.
          const side = bone.slice(-1), shoulder = pilot.locate(`upperarm_${side}`), elbow = pilot.locate(`forearm_${side}`);
          expect(shoulder.distanceTo(hand), `${id} ${bone} stretch`).toBeGreaterThan(shoulder.distanceTo(elbow) + elbow.distanceTo(hand) - 0.005);
          expect(hand.clone().sub(shoulder).normalize().dot(wrist.clone().sub(shoulder).normalize()), `${id} ${bone} aim`).toBeGreaterThan(0.999);
        }
        seat.pedals.forEach((pedal, i) => {
          const ball = new T.Vector3(...pedal);
          if (seat.pedalsMove) ball.z -= (i === 0 ? -1 : 1) * controls.yaw * 0.035;
          // A smaller outside figure (the Finch's, under its low canopy) sits back in the seat with its boots short in the footwell.
          const reach = !firstPerson && seat.outsideSize ? 0.2 : 0.035;
          expect(pilot.locate(i === 0 ? "foot_L" : "foot_R").distanceTo(ball.add(ANKLE_FROM_BALL)), `${id} foot ${i}`).toBeLessThan(reach);
        });
      }
    }
    // Sitting, not standing: hips below the eye and knees ahead of the hips.
    const hips = pilot.locate("hips"), knee = pilot.locate("shin_L");
    expect(seat.eye[1] - hips.y).toBeGreaterThan(0.55);
    expect(knee.z).toBeLessThan(hips.z - 0.2);
    expect(pilot.root.getObjectByName("head")!.scale.x).toBeLessThan(0.01);
    pilot.setFirstPerson(false);
    expect(pilot.root.getObjectByName("head")!.scale.x).toBe(1);
  });

// The Aurelia deck in aircraft-group metres: x, up, aft (scripts/cockpit/aurelia.py, shifted by its OFFSET and aureliaFlightOffsetY).
const deck = (x: number, forward: number, up: number) => new T.Vector3(x, up - 1.265, -forward - 0.66);
const TILT_LOWER_EDGE = { forward: 5.897, up: 1.97 };
const TILT_TOP = { forward: 5.976, up: 2.032 };

async function aureliaPilot() {
  const group = new T.Group();
  const pilot = new Pilot(group, "aurelia", model());
  await pilot.ready;
  return { group, pilot };
}
function skin(group: T.Object3D) {
  group.updateMatrixWorld(true);
  const points: { at: T.Vector3; bone: string }[] = [];
  group.traverse((node) => {
    if (!(node instanceof T.SkinnedMesh)) return;
    node.skeleton.update();
    const position = node.geometry.getAttribute("position"), joints = node.geometry.getAttribute("skinIndex"), weights = node.geometry.getAttribute("skinWeight");
    for (let i = 0; i < position.count; i++) {
      let best = 0;
      for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, best)) best = k;
      points.push({ at: node.getVertexPosition(i, new T.Vector3()).applyMatrix4(node.matrixWorld), bone: node.skeleton.bones[joints.getComponent(i, best)].name });
    }
  });
  return points;
}
function drawnTriangles(group: T.Object3D) {
  group.updateMatrixWorld(true);
  const triangles: T.Vector3[][] = [];
  group.traverse((node) => {
    if (!(node instanceof T.SkinnedMesh)) return;
    node.skeleton.update();
    const index = node.geometry.index!;
    const at = (i: number) => node.getVertexPosition(index.getX(i), new T.Vector3()).applyMatrix4(node.matrixWorld);
    for (let i = 0; i < index.count; i += 3) triangles.push([at(i), at(i + 1), at(i + 2)]);
  });
  return triangles;
}

test("the Aurelia pilot sits on the seat with both legs clear of the deck", async () => {
  const { group, pilot } = await aureliaPilot();
  pilot.setFirstPerson(true);
  for (const yaw of [-1, 0, 1]) {
    pilot.update({ pitch: 0, roll: 0, yaw, power: 0.6 });
    const points = skin(group);
    const of = (bone: RegExp) => points.filter((p) => bone.test(p.bone)).map((p) => p.at);
    // On the cushion, not hovering over or sunk through it (pan top 1.994 m).
    const hipsLowest = Math.min(...of(/^hips$/).map((p) => p.y));
    expect(deck(0, 0, 1.994).y - hipsLowest).toBeGreaterThan(0);
    expect(deck(0, 0, 1.994).y - hipsLowest).toBeLessThan(0.03);
    // Heels above the carpet, toes short of the knee wall even with a pedal fully forward.
    const feet = of(/^foot_/);
    expect(Math.min(...feet.map((p) => p.y))).toBeGreaterThan(deck(0, 0, 1.663).y - 0.005);
    expect(Math.min(...feet.map((p) => p.z))).toBeGreaterThan(deck(0, 6.19, 0).z);
    // The shins stay behind the tilt panel's lower edge; a skin-deep touch is allowed.
    for (const p of of(/^(thigh|shin|foot)_/)) {
      const up = p.y + 1.265, forward = -p.z - 0.66;
      if (p.x > -0.136 || up < 1.895 || up > TILT_LOWER_EDGE.up) continue;
      expect(forward).toBeLessThan(TILT_LOWER_EDGE.forward + 0.015);
    }
  }
  // A seated knee, not one folded up against the chest as it was with the pedals under the panel.
  pilot.update({ pitch: 0, roll: 0, yaw: 0, power: 0.6 });
  const hip = pilot.locate("thigh_L"), knee = pilot.locate("shin_L"), ankle = pilot.locate("foot_L");
  expect(T.MathUtils.radToDeg(hip.clone().sub(knee).angleTo(ankle.clone().sub(knee)))).toBeGreaterThan(85);
});

test("from the Aurelia seat the pilot's legs and arms leave the displays and tilt panel in view", async () => {
  const { group, pilot } = await aureliaPilot();
  pilot.setFirstPerson(true);
  const eye = new T.Vector3(...pilotSeats.aurelia.eye);
  const hidden = (target: T.Vector3, triangles: T.Vector3[][]) => {
    const ray = new T.Ray(eye, target.clone().sub(eye).normalize()), reach = eye.distanceTo(target), hit = new T.Vector3();
    return triangles.some(([a, b, c]) => ray.intersectTriangle(a, b, c, false, hit) && hit.distanceTo(eye) < reach);
  };
  // Panel faces, tilted 10 degrees: the four displays with the standby instrument in the middle, then both CDUs.
  const panel = (x: number, v: number) => deck(x, 6.0 + Math.sin(T.MathUtils.degToRad(10)) * v, 2.17 + Math.cos(T.MathUtils.degToRad(10)) * v);
  const displays = [-0.426, -0.178, 0.178, 0.426].flatMap((x) => [-0.08, 0.045, 0.17].flatMap((v) => [-0.1, 0, 0.1].map((dx) => panel(x + dx, v))));
  const tilt = (x: number, drop: number) => deck(x, TILT_TOP.forward - drop * Math.sin(T.MathUtils.degToRad(52)), TILT_TOP.up - drop * Math.cos(T.MathUtils.degToRad(52)));
  const cdus = [-0.068, 0.068].flatMap((x) => [-0.02, -0.04, -0.06].map((drop) => tilt(x, drop)));
  const row = Array.from({ length: 29 }, (_, i) => -0.7 + i * 0.05).flatMap((x) => [0.01, 0.05, 0.09].map((drop) => tilt(x, drop)));
  for (const pitch of [-1, 0, 1])
    for (const roll of [-1, 0, 1])
      for (const power of [0, 1]) {
        pilot.update({ pitch, roll, yaw: 0, power });
        const triangles = drawnTriangles(group);
        // Well under the whole figure: no head, chest or shoulders.
        expect(triangles.length).toBeLessThan(30000);
        for (const point of [...displays, ...cdus]) expect(hidden(point, triangles), `${pitch} ${roll} ${power}`).toBe(false);
      }
  pilot.update({ pitch: 0, roll: 0, yaw: 0, power: 0.6 });
  const resting = drawnTriangles(group);
  for (const point of row) expect(hidden(point, resting)).toBe(false);
  // No shoulders in view: each upper arm is folded into its elbow.
  for (const side of ["L", "R"]) {
    const elbow = pilot.locate(`forearm_${side}`);
    for (const { at, bone } of skin(group)) if (bone === `upperarm_${side}`) expect(at.distanceTo(elbow)).toBeLessThan(0.2);
  }
});

test("outside views get the Aurelia pilot's whole body back, in the airframe's own seat", async () => {
  const { group, pilot } = await aureliaPilot();
  const whole = (await model()).scene.getObjectByProperty("type", "SkinnedMesh") as T.SkinnedMesh;
  const drawn = () => group.getObjectByName(whole.name) as T.SkinnedMesh;
  const count = () => drawn().geometry.index!.count;
  expect(count()).toBe(whole.geometry.index!.count);
  pilot.setFirstPerson(true);
  expect(count()).toBeLessThan(whole.geometry.index!.count / 2);
  pilot.setFirstPerson(false);
  expect(count()).toBe(whole.geometry.index!.count);
  // Centred on the seat (x -0.404), on its cushion (top 0.787 m) and against its backrest.
  pilot.update({ pitch: 0, roll: 0, yaw: 0, power: 0.6 });
  const points = skin(group), of = (bone: RegExp) => points.filter((p) => bone.test(p.bone)).map((p) => p.at);
  const hips = of(/^hips$/);
  expect(Math.abs((Math.min(...hips.map((p) => p.x)) + Math.max(...hips.map((p) => p.x))) / 2 + 0.404)).toBeLessThan(0.01);
  expect(0.787 - Math.min(...hips.map((p) => p.y))).toBeGreaterThan(0);
  expect(0.787 - Math.min(...hips.map((p) => p.y))).toBeLessThan(0.03);
});
