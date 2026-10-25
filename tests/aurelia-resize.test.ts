import { expect, test } from "bun:test";
import * as T from "three";
import { makeAureliaReference } from "../src/aircraft/aurelia/reference-model";
import {
  aureliaAirframeScale,
  aureliaInteriorLayout,
} from "../src/aircraft/aurelia/exterior-reference";

test("the enlarged airframe retains furniture dimensions and a single raised floor datum", () => {
  const baseline = makeAureliaReference(1).root;
  const resized = makeAureliaReference().root;
  baseline.updateMatrixWorld(true);
  resized.updateMatrixWorld(true);
  const size = (o: T.Object3D) =>
    new T.Box3().setFromObject(o).getSize(new T.Vector3());
  expect(
    size(resized).distanceTo(
      size(baseline).multiplyScalar(aureliaAirframeScale),
    ),
  ).toBeLessThan(1e-6);
  for (const name of [
    "Passenger_seat_club_forward_Left",
    "Pilot_seat_Left",
    "Forward_refreshment_center",
    "Forward_locker",
    "Stowed_table_Left",
    "Instrument_panel",
    "Centre_pedestal",
    "Yoke_Left",
    "Closed_toilet_lid",
    "Vanity",
  ]) {
    const before = size(baseline.getObjectByName(name)!);
    const after = size(resized.getObjectByName(name)!);
    expect(
      after.distanceTo(before),
      `${name} unchanged dimensions`,
    ).toBeLessThan(1e-6);
  }
  for (const name of ["Cockpit_floor", "Entry_vestibule_floor", "Cabin_floor"])
    expect(
      new T.Box3().setFromObject(resized.getObjectByName(name)!).max.y,
    ).toBeCloseTo(aureliaInteriorLayout.floorY * aureliaAirframeScale, 6);
}, 30000);

test("the requested airframe is ten percent larger than the previous 105 percent variant", () => {
  expect(aureliaAirframeScale / 1.05).toBeCloseTo(1.1, 12);
});

test("both exhausts have a recessed annular outlet instead of a disk at the lip", () => {
  const { root } = makeAureliaReference();
  root.updateMatrixWorld(true);
  for (const label of ["Left", "Right"]) {
    const engine = root.getObjectByName(`Engine_${label}`)!;
    for (const radius of [0.12, 0.2, 0.26])
      for (let i = 0; i < 24; i++) {
        const angle = (i * Math.PI) / 12;
        const origin = engine.localToWorld(
          new T.Vector3(
            radius * Math.cos(angle),
            radius * Math.sin(angle),
            1.3,
          ),
        );
        const direction = new T.Vector3(0, 0, -1).transformDirection(
          engine.matrixWorld,
        );
        const hits = new T.Raycaster(origin, direction, 0, 2).intersectObject(
          engine,
          true,
        );
        expect(hits.length).toBeGreaterThan(0);
        const hit = engine.worldToLocal(hits[0].point.clone());
        expect(
          hit.z,
          `${label}, radius ${radius}: visible exhaust depth`,
        ).toBeLessThan(0.3);
        expect(
          hit.z,
          `${label}: engine interior is closed at depth`,
        ).toBeGreaterThan(-0.1);
      }
  }
}, 30000);
