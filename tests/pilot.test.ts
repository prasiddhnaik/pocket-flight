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
          expect(pilot.locate(i === 0 ? "foot_L" : "foot_R").distanceTo(ball.add(ANKLE_FROM_BALL)), `${id} foot ${i}`).toBeLessThan(0.035);
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
