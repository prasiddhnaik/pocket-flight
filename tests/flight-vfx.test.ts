import { expect, test } from "bun:test";
import { Points, Quaternion, Vector3 } from "three";
import { FlightVfx, tireContactPoints, type VfxInput } from "../src/flight/flight-vfx";
import { groundAt } from "../src/world/terrain";

function input(id: VfxInput["id"] = "finch"): VfxInput {
  return {
    id,
    time: 0,
    position: new Vector3(-260, 4, 260),
    rotation: new Quaternion(),
    velocity: new Vector3(0, 0, -40),
    wind: new Vector3(2, 0, 1),
    damage: 0,
    speed: 40,
    grounded: true,
    load: 1,
    suspension: 0,
  };
}
function positions(vfx: FlightVfx) {
  const points = vfx.group.children[0] as Points;
  return Array.from(points.geometry.getAttribute("position").array).slice(
    0,
    points.geometry.drawRange.count * 3,
  );
}

test("touchdown puffs originate at transformed tire contacts across the fleet and expire", () => {
  for (const id of ["finch", "peregrine", "aurelia", "stormbird"] as const) {
    const vfx = new FlightVfx(),
      i = input(id);
    i.rotation.setFromAxisAngle(new Vector3(0, 1, 0), 0.6);
    const contacts = tireContactPoints(i);
    for (const point of contacts)
      expect(point.y).toBeCloseTo(groundAt(point.x, point.z).height + 0.055, 6);
    vfx.touchdown(i, 1.8);
    vfx.render(0.15, 900);
    expect(vfx.stats.clouds.active).toBe(contacts.length * 7);
    expect(vfx.stats.sparks.active).toBe(0);
    vfx.render(4, 900);
    expect(vfx.stats.drawCalls).toBe(0);
    vfx.dispose();
  }
});

test("moving the aircraft cannot drag previously emitted smoke; seeking restores identical poses", () => {
  const vfx = new FlightVfx(),
    i = input();
  i.damage = 0.8;
  vfx.step(1 / 60, i);
  vfx.render(0.5, 900);
  const before = positions(vfx);
  i.position.addScalar(500);
  i.rotation.setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
  vfx.render(0.5, 900);
  expect(positions(vfx)).toEqual(before);
  vfx.render(1, 900);
  expect(positions(vfx)).not.toEqual(before);
  vfx.render(0.5, 900);
  expect(positions(vfx)).toEqual(before);
  vfx.render(-1, 900);
  expect(vfx.stats.clouds.active).toBe(0);
  vfx.dispose();
});

test("wake emission uses elapsed time rather than render frame count", () => {
  const counts = [];
  for (const hz of [30, 60, 120]) {
    const vfx = new FlightVfx(),
      i = input("peregrine");
    i.damage = 0.8;
    for (let step = 1; step <= hz * 3; step++) {
      i.time = step / hz;
      vfx.step(1 / hz, i);
    }
    counts.push(vfx.stats.clouds.emitted);
    vfx.dispose();
  }
  expect(counts).toEqual([180, 180, 180]);
});

test("effect history, visible particles and draw calls stay bounded under sustained overload", () => {
  const vfx = new FlightVfx(),
    i = input("peregrine");
  i.damage = 1;
  i.grounded = false;
  i.load = 4;
  i.speed = 200;
  i.position.y = 2500;
  for (let step = 1; step <= 360 * 60; step++) {
    i.time = step / 60;
    vfx.step(1 / 60, i);
  }
  vfx.render(i.time, 900);
  expect(vfx.stats.clouds.retained).toBe(8192);
  expect(vfx.stats.clouds.active).toBeLessThanOrEqual(512);
  expect(vfx.stats.drawCalls).toBe(1);
  const full = vfx.stats.clouds.active;
  vfx.render(i.time, 900, true);
  expect(vfx.stats.clouds.active).toBeLessThan(full);
  vfx.reset();
  vfx.render(i.time, 900);
  expect(vfx.stats.drawCalls).toBe(0);
  vfx.dispose();
});

test("water and parked contacts produce no tire smoke; hard pavement impacts produce brief sparks", () => {
  const vfx = new FlightVfx(),
    i = input();
  i.velocity.setScalar(0);
  vfx.touchdown(i, 2);
  expect(vfx.stats.clouds.emitted).toBe(0);
  i.position.set(3500, 0, 3500);
  i.velocity.z = -30;
  vfx.touchdown(i, 2);
  expect(vfx.stats.clouds.emitted).toBe(0);
  i.position.set(-260, 4, 260);
  vfx.impact(i, 0.8);
  vfx.render(0.1, 900);
  expect(vfx.stats.sparks.active).toBe(20);
  expect(vfx.stats.drawCalls).toBe(2);
  vfx.render(1, 900);
  expect(vfx.stats.sparks.active).toBe(0);
  vfx.dispose();
});
