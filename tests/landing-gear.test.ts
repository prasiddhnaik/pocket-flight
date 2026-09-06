import { expect, test } from "bun:test";
import { TorusGeometry, Vector3 } from "three";
import { FlightPhysics } from "../src/physics";
import { groundAt, runways, runwayLocal } from "../src/terrain";

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: true };

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
