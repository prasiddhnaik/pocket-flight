import { expect, test } from "bun:test";
import { TorusGeometry, Vector3 } from "three";
import { FlightPhysics } from "../src/flight/physics";
import { groundAt, runways, runwayLocal } from "../src/world/terrain";
import {
  finchWheels,
  peregrineWheels,
  aureliaWheels,
  gearContactHeight,
} from "../src/aircraft/landing-gear";
import { stormbirdContact } from "../src/aircraft/stormbird/stormbird-contact";

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: true };

test("routine touchdowns tolerate a small bank on pavement and level grass across the fleet", () => {
  for (const id of ["finch", "peregrine", "aurelia", "stormbird"] as const)
    for (const x of [-260, -280])
      for (const roll of [-0.11, 0, 0.11]) {
        const p = new FlightPhysics();
        p.aircraftId = id;
        p.reset(true);
        p.gearPosition = 1;
        p.position.set(x, 0, 260);
        p.pitch = 0.08;
        p.roll = roll;
        p.updateQuaternion();
        const height =
          id === "stormbird"
            ? stormbirdContact(p.position, p.quaternion, 1, 0, 0).height
            : gearContactHeight(
                p.position,
                p.quaternion,
                id === "aurelia"
                  ? aureliaWheels
                  : id === "peregrine"
                    ? peregrineWheels
                    : finchWheels,
              );
        p.position.y = height + 0.015;
        p.velocity.set(0, -1.8, id === "finch" ? -30 : -38);
        p.throttle = 0.12;
        p.step(1 / 60, neutral);
        expect(p.events.some((e) => e.type === "landing")).toBe(true);
        expect(
          p.events.some((e) => e.type === "impact" || e.type === "crash"),
        ).toBe(false);
        expect(p.damage.gear).toBe(0);
        expect(p.health).toBe(100);
      }
});

test("gear damage does not rotate the contact assembly away from its fixed airframe mounts", () => {
  for (const id of ["finch", "peregrine", "aurelia"] as const) {
    const healthy = new FlightPhysics(),
      damaged = new FlightPhysics();
    for (const p of [healthy, damaged]) {
      p.aircraftId = id;
      p.reset();
      p.position.set(-260, 8, 260);
      p.pitch = 0.08;
      p.roll = 0.04;
    }
    damaged.damage.gear = 0.6;
    healthy.step(1 / 60, neutral);
    damaged.step(1 / 60, neutral);
    expect(damaged.position.y).toBeCloseTo(healthy.position.y, 6);
  }
});

test("ground collision uses the rendered runway and apron elevations", () => {
  for (const r of runways) {
    expect(groundAt(r.x, r.z).height).toBeCloseTo(r.y + 0.25, 6);
    const apron = new Vector3(44, 0, 70).applyAxisAngle(
      new Vector3(0, 1, 0),
      r.heading,
    );
    expect(groundAt(r.x + apron.x, r.z + apron.z).height).toBeCloseTo(
      r.y + 0.18,
      6,
    );
  }
});

test("both airfield starts put the tires on pavement and align with the runway", () => {
  for (const short of [false, true]) {
    const p = new FlightPhysics();
    p.reset(false, short);
    const r = runways[short ? 1 : 0];
    expect(runwayLocal(p.position.x, p.position.z, r).x).toBeCloseTo(0, 6);
    expect(p.position.y - 1.367).toBeCloseTo(r.y + 0.25, 6);
  }
});

test("tires stay above pavement while the grounded aircraft pitches and banks", () => {
  const tires = [
    {
      center: new Vector3(-1.22, -1.09, 0.55),
      geometry: new TorusGeometry(0.212, 0.065, 10, 48),
    },
    {
      center: new Vector3(1.22, -1.09, 0.55),
      geometry: new TorusGeometry(0.212, 0.065, 10, 48),
    },
    {
      center: new Vector3(0, -1.12, -2.12),
      geometry: new TorusGeometry(0.177, 0.055, 10, 48),
    },
  ];
  for (const tire of tires) tire.geometry.rotateY(Math.PI / 2);
  for (const short of [false, true])
    for (const pitch of [-0.025, 0, 0.12, 0.23])
      for (const roll of [-0.05, 0, 0.05]) {
        const p = new FlightPhysics();
        p.reset(false, short);
        p.pitch = pitch;
        p.roll = roll;
        p.position.y -= 0.5;
        p.step(1 / 60, neutral);
        let lowest = Infinity;
        for (const tire of tires) {
          const vertices = tire.geometry.attributes.position;
          for (let i = 0; i < vertices.count; i++) {
            const point = new Vector3()
              .fromBufferAttribute(vertices, i)
              .add(tire.center)
              .applyQuaternion(p.quaternion)
              .add(p.position);
            lowest = Math.min(
              lowest,
              point.y - groundAt(point.x, point.z).height,
            );
          }
        }
        expect(lowest).toBeGreaterThan(-0.0001);
        expect(lowest).toBeLessThan(0.003);
      }
  for (const tire of tires) tire.geometry.dispose();
});
