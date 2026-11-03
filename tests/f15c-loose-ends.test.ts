import { expect, test } from "bun:test";
import { Group, Vector3 } from "three";
import { chartRegion, navigationLabel } from "../src/aircraft/cockpit-displays";
import { replayAircraftName } from "../src/flight/combat/tape";
import { F15C_MUZZLE } from "../src/flight/cannon";
import { inspectionShot } from "../src/flight/f15c-inspection";
import { rangeLayout } from "../src/world/range-island";
import { rangeRunway, runways } from "../src/world/terrain";

test("the inspection camera never moves the gun's firing point, however long it runs", () => {
  const start = F15C_MUZZLE.clone();
  const root = new Group();
  root.position.set(2980, 14, -2026);
  root.updateMatrixWorld(true);
  let shot = inspectionShot(root, "gun");
  for (let frame = 0; frame < 120; frame++) shot = inspectionShot(root, "gun");
  expect(F15C_MUZZLE.distanceTo(start)).toBe(0);
  // Looking at the muzzle from about a metre away, right beside the aircraft.
  const muzzle = start.clone().add(root.position);
  expect(shot.target.distanceTo(muzzle)).toBeLessThan(1e-6);
  expect(shot.position.distanceTo(muzzle)).toBeLessThan(1.5);
});

test("the nozzle close-up frames the nozzles next to the aircraft", () => {
  const root = new Group();
  root.position.set(100, 50, 200);
  root.updateMatrixWorld(true);
  const shot = inspectionShot(root, "nozzle");
  expect(shot.position.distanceTo(root.position)).toBeLessThan(15);
  expect(shot.target.distanceTo(new Vector3(100, 49.76, 207.5))).toBeLessThan(0.01);
});

test("the cockpit map shows whichever island the aircraft is nearest", () => {
  expect(chartRegion(-260, 260).id).toBe("palm-bay");
  const anvil = chartRegion(rangeLayout.centre.x, rangeLayout.centre.z);
  expect(anvil.id).toBe("anvil-key");
  expect(anvil.centerX).toBe(rangeLayout.centre.x);
  expect(anvil.centerZ).toBe(rangeLayout.centre.z);
  expect(anvil.size).toBe(rangeLayout.size);
  expect(chartRegion(rangeLayout.centre.x - 600, rangeLayout.centre.z + 300).id).toBe("anvil-key");
  expect(chartRegion(900, -300).id).toBe("palm-bay");
});

test("replay lists name the A-2 when it was flown, and the Finch otherwise", () => {
  expect(replayAircraftName({ aircraft: "finch", mission: "free", variant: "attack" })).toBe("Finch A–2");
  expect(replayAircraftName({ aircraft: "finch", mission: "combat" })).toBe("Finch A–2");
  expect(replayAircraftName({ aircraft: "finch", mission: "free" })).not.toContain("A–2");
  expect(replayAircraftName({ aircraft: "f15c", mission: "combat" })).toBe("F-15C Eagle");
});

test("the navigation label names the nearest airfield and its true distance", () => {
  const palm = runways[0];
  expect(navigationLabel(palm.x, palm.z)).toBe("PALM BAY · 0.0 NM");
  expect(navigationLabel(palm.x - 1852, palm.z)).toBe("PALM BAY · 1.0 NM");
  expect(navigationLabel(rangeRunway.x, rangeRunway.z)).toBe("ANVIL KEY · 0.0 NM");
  expect(navigationLabel(rangeRunway.x, rangeRunway.z - 926)).toBe("ANVIL KEY · 0.5 NM");
});
