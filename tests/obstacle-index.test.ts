import { expect, test } from "bun:test";
import { Quaternion, Vector3 } from "three";
import { ObstacleIndex } from "../src/flight/obstacle-index";
import { sweepAirframe } from "../src/flight/collision";
import { FlightPhysics } from "../src/flight/physics";
import type { Obstacle } from "../src/world/world";

test("grid covers negative cells, large obstacle radii, and boundaries in source order", () => {
  const obstacles: Obstacle[] = [
    { x: 128, z: 0, y: 250, radius: 140, label: "wide" },
    { x: -128, z: -128, y: 250, radius: 1, label: "corner" },
    { x: 0, z: 0, y: 250, radius: 1, label: "origin" },
  ];
  const index = new ObstacleIndex(obstacles);
  expect(index.query(-1, 1, -1, 1)).toEqual([obstacles[0], obstacles[2]]);
  expect(index.query(-129, -128, -129, -128)).toEqual([obstacles[1]]);
  expect(index.query(-1000, 1000, -1000, 1000)).toEqual(obstacles);
  expect(new ObstacleIndex([]).query(0, 1, 0, 1)).toEqual([]);
});

test("indexed and exhaustive sweeps produce identical impacts, including rotation and terrain", () => {
  let seed = 731;
  const random = () =>
    (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  const obstacles: Obstacle[] = Array.from({ length: 500 }, (_, i) => ({
    x: random() * 1200 - 600,
    z: random() * 1200 - 600,
    y: 100 + random() * 150,
    radius: 2 + random() * 20,
    label: `obstacle-${i}`,
  }));
  const index = new ObstacleIndex(obstacles);
  const probes = [
    { center: new Vector3(0, 0, 0), radius: 1, part: "body" as const },
    { center: new Vector3(12, 0, 0), radius: 0.5, part: "leftWing" as const },
  ];
  let impacts = 0;
  for (let i = 0; i < 350; i++) {
    const start = new Vector3(
      random() * 1400 - 700,
      random() * 280,
      random() * 1400 - 700,
    );
    const end = start
      .clone()
      .add(
        new Vector3(
          random() * 100 - 50,
          random() * 40 - 20,
          random() * 100 - 50,
        ),
      );
    const startQ = new Quaternion().setFromAxisAngle(
      new Vector3(0, 1, 0),
      random() * Math.PI * 2,
    );
    const endQ = startQ
      .clone()
      .multiply(
        new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), random() * 0.5),
      );
    const exhaustive = sweepAirframe(
      start,
      startQ,
      end,
      endQ,
      probes,
      obstacles,
    );
    const indexed = sweepAirframe(start, startQ, end, endQ, probes, index);
    expect(indexed).toEqual(exhaustive);
    if (exhaustive) impacts++;
  }
  expect(impacts).toBeGreaterThan(20);
});

test("an equal-time collision keeps the original obstacle ordering", () => {
  const obstacles: Obstacle[] = ["first", "second"].map((label) => ({
    x: 0,
    z: 0,
    y: 200,
    radius: 5,
    label,
  }));
  const hit = sweepAirframe(
    new Vector3(-10, 150, 0),
    new Quaternion(),
    new Vector3(10, 150, 0),
    new Quaternion(),
    [{ center: new Vector3(), radius: 1, part: "body" }],
    new ObstacleIndex(obstacles),
  );
  expect(hit?.obstacle).toBe("first");
});

test.each([
  "finch",
  "peregrine",
  "aurelia",
  "stormbird",
  "heron",
  "f15c",
] as const)("%s simulation remains identical with indexed scenery", (id) => {
  const obstacles: Obstacle[] = Array.from({ length: 500 }, (_, i) => ({
    x: (i % 25) * 40 - 500,
    z: Math.floor(i / 25) * 40 - 400,
    y: 140,
    radius: 4,
    label: `tree-${i}`,
  }));
  const exhaustive = new FlightPhysics(),
    indexed = new FlightPhysics();
  for (const physics of [exhaustive, indexed]) {
    physics.aircraftId = id;
    physics.reset(true);
    physics.position.set(0, 135, 0);
    physics.initializeAirStart(physics.design.trimSpeed);
  }
  const index = new ObstacleIndex(obstacles);
  const controls = {
    pitch: 0.1,
    roll: -0.1,
    yaw: 0.05,
    throttle: 0.1,
    brake: false,
  };
  for (let i = 0; i < 30; i++) {
    exhaustive.step(1 / 60, controls, obstacles);
    indexed.step(1 / 60, controls, index);
    expect(indexed.position).toEqual(exhaustive.position);
    expect(indexed.quaternion).toEqual(exhaustive.quaternion);
    expect(indexed.velocity).toEqual(exhaustive.velocity);
    expect(indexed.damage).toEqual(exhaustive.damage);
    expect(indexed.events).toEqual(exhaustive.events);
  }
});
