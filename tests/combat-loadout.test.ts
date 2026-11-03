import { expect, test } from "bun:test";
import { Vector3 } from "three";
import { validateLoadout } from "../src/flight/combat/loadout";
import { segmentSphere } from "../src/flight/cannon";
test("loadouts reject duplicates and incompatible stores", () => {
  const stations = [
    {
      id: "left",
      position: [1, 0, 0] as [number, number, number],
      loads: ["rocket"],
    },
  ];
  expect(
    validateLoadout(stations, [{ hardpoint: "left", store: "rocket" }]),
  ).toEqual([]);
  expect(
    validateLoadout(stations, [{ hardpoint: "left", store: "air-to-air" }]),
  ).toHaveLength(1);
  expect(
    validateLoadout(stations, [
      { hardpoint: "left", store: "rocket" },
      { hardpoint: "left", store: "rocket" },
    ]),
  ).toHaveLength(1);
});
test("swept hits catch a target between frame endpoints", () => {
  expect(
    segmentSphere(
      new Vector3(0, 0, 0),
      new Vector3(0, 0, -100),
      new Vector3(0, 0, -50),
      2,
    ),
  ).toBeCloseTo(0.48);
});

test("loadout rejects missing stations, unknown stores and non-finite coordinates", () => {
  expect(
    validateLoadout([], [{ hardpoint: "missing", store: "rocket" }]),
  ).toHaveLength(1);
  expect(
    validateLoadout(
      [{ id: "bad", position: [NaN, 0, 0], loads: ["unknown"] }],
      [{ hardpoint: "bad", store: "unknown" }],
    ),
  ).toHaveLength(2);
});

import { Group, Object3D } from "three";
import {
  combatAircraft,
  registerCombatAircraft,
} from "../src/aircraft/weapons/combat-loadouts";
import { storePhysicsDelta } from "../src/flight/combat/loadout";

test("fighter stations are data in aircraft metres including model scale and offset", () => {
  const root = new Group(),
    model = new Group(),
    left = new Object3D(),
    right = new Object3D();
  root.position.set(100, 50, 60);
  model.scale.setScalar(0.5);
  model.position.y = -2;
  left.position.set(-4, 1, 2);
  right.position.set(4, 1, 2);
  left.userData.weaponStore = right.userData.weaponStore = true;
  model.add(left, right);
  root.add(model);
  const config = combatAircraft("peregrine", root)!;
  expect(config.hardpoints[0].position).toEqual([-2, -1.5, 1]);
  expect(config.loadout).toHaveLength(2);
  expect(validateLoadout(config.hardpoints, config.loadout)).toEqual([]);
});

test("attack Finch consumes its declared compatible stations without an aircraft-union change", () => {
  const config = combatAircraft("finch-attack", new Group())!;
  expect(config.gun).toBeNull();
  expect(config.loadout).toHaveLength(4);
  expect(config.loadout.filter((load) => load.store === "rocket-pod-7").map((load) => load.hardpoint)).toEqual(["left-outer", "right-outer"]);
  expect(config.loadout.filter((load) => load.store === "air-to-air").map((load) => load.hardpoint)).toEqual(["left-inner", "right-inner"]);
  expect(validateLoadout(config.hardpoints, config.loadout)).toEqual([]);
});

test("registration consumes external hardpoint data and rejects invalid loadouts", () => {
  const config = {
    hardpoints: [
      {
        id: "left-outer",
        position: [-3, -0.2, 0] as [number, number, number],
        loads: ["rocket"],
      },
    ],
    loadout: [{ hardpoint: "left-outer", store: "rocket" }],
    gun: null,
  };
  registerCombatAircraft("external-test", config);
  expect(combatAircraft("external-test", new Group())).toBe(config);
  expect(() =>
    registerCombatAircraft("invalid-test", {
      ...config,
      loadout: [{ hardpoint: "left-outer", store: "air-to-air" }],
    }),
  ).toThrow();
});

test("store mass and drag are disabled in the default configuration", () => {
  expect(storePhysicsDelta([{ hardpoint: "left", store: "rocket" }])).toEqual({
    massKg: 0,
    dragArea: 0,
  });
  expect(
    storePhysicsDelta([{ hardpoint: "left", store: "rocket" }], true),
  ).toEqual({ massKg: 60, dragArea: 0.035 });
});
