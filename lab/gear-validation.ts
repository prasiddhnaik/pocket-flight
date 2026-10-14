import { Quaternion, TorusGeometry, Vector3 } from "three";
import type { AircraftId } from "../src/aircraft";
import { aircraftWheels, wheelPose } from "../src/airframe-contact";
import { groundAt } from "../src/terrain";
import { FlightPhysics } from "../src/physics";
import geometry from "../src/stormbird-geometry.json";

// Independent vertex sampling of measured rigid tire geometry, rather than
// reusing the contact solver's support-point calculation for its verdict.
const vertices = new Map<AircraftId, Vector3[][]>();
function tireVertices(id: AircraftId) {
  if (vertices.has(id)) return vertices.get(id)!;
  const result = aircraftWheels[id].map((wheel, index) => {
    if (id === "stormbird") {
      return geometry.wheels[index].profile.flatMap(([a, radius]) =>
        [-a, a].flatMap((x) =>
          Array.from(
            { length: 64 },
            (_, i) =>
              new Vector3(
                x,
                radius * Math.cos((i * Math.PI) / 32),
                radius * Math.sin((i * Math.PI) / 32),
              ),
          ),
        ),
      );
    }
    const mesh = new TorusGeometry(wheel.major, wheel.minor, 12, 64);
    mesh.rotateY(Math.PI / 2);
    const attribute = mesh.getAttribute("position"),
      points = [];
    for (let i = 0; i < attribute.count; i++)
      points.push(new Vector3().fromBufferAttribute(attribute, i));
    mesh.dispose();
    return points;
  });
  vertices.set(id, result);
  return result;
}
export function sampledTireClearance(p: FlightPhysics) {
  let lowest = Infinity;
  tireVertices(p.aircraftId).forEach((points, index) => {
    const pose = wheelPose(p.aircraftId, index, p.gearPosition);
    const rotation = new Quaternion().setFromUnitVectors(
      new Vector3(1, 0, 0),
      pose.axle,
    );
    for (const vertex of points) {
      const world = vertex
        .clone()
        .applyQuaternion(rotation)
        .add(pose.center)
        .applyQuaternion(p.quaternion)
        .add(p.position);
      lowest = Math.min(lowest, world.y - groundAt(world.x, world.z).height);
    }
  });
  return lowest;
}
export function validateGear(id: AircraftId) {
  const cases = [];
  for (const hz of [30, 60, 120])
    for (const short of [false, true])
      for (const pitch of [-0.025, 0, 0.12])
        for (const roll of [-0.05, 0, 0.05]) {
          const p = new FlightPhysics();
          p.aircraftId = id;
          p.reset(false, short);
          p.windOverride = new Vector3();
          p.beginnerAssist = false;
          p.pitch = pitch;
          p.roll = roll;
          p.position.y -= 0.5;
          p.step(1 / hz, {
            pitch: 0,
            roll: 0,
            yaw: 0,
            throttle: 0,
            brake: true,
          });
          cases.push({
            hz,
            short,
            pitch,
            roll,
            clearance: sampledTireClearance(p),
            verticalSpeed: p.velocity.y,
            health: p.health,
          });
        }
  const p = new FlightPhysics();
  p.aircraftId = id;
  p.reset();
  p.windOverride = new Vector3();
  p.beginnerAssist = false;
  const settle = [];
  for (let n = 0; n < 240; n++) {
    p.step(1 / 60, { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: true });
    if (n % 12 === 0)
      settle.push({
        time: n / 60,
        clearance: sampledTireClearance(p),
        verticalSpeed: p.velocity.y,
      });
  }
  const overlapPass = cases.every(
    (c) =>
      c.clearance >= -1e-4 &&
      c.clearance < 0.003 &&
      c.verticalSpeed < 0.25 &&
      c.health === 100,
  );
  const settlePass = settle.every(
    (c) =>
      c.clearance >= -1e-4 &&
      c.clearance < 0.003 &&
      Math.abs(c.verticalSpeed) < 0.1,
  );
  const touchdowns = [];
  for (const hz of [30, 60, 120])
    for (const short of [false, true])
      for (const roll of [-0.025, 0, 0.025]) {
        const landing = new FlightPhysics();
        landing.aircraftId = id;
        landing.reset(false, short);
        const position = landing.position.clone();
        landing.reset(true, short);
        landing.position.copy(position).y += 0.25;
        landing.pitch = 0;
        landing.roll = roll;
        landing.gearPosition = 1;
        landing.windOverride = new Vector3();
        landing.beginnerAssist = false;
        landing.engineOut = true;
        landing.velocity.set(0, -1.2, 0);
        let landed = false;
        for (let n = 0; n < hz; n++) {
          landing.step(1 / hz, {
            pitch: 0,
            roll: 0,
            yaw: 0,
            throttle: 0,
            brake: true,
          });
          landed ||= landing.events.some((e) => e.type === "landing");
        }
        touchdowns.push({
          hz,
          short,
          roll,
          landed,
          grounded: landing.grounded,
          health: landing.health,
          clearance: sampledTireClearance(landing),
        });
      }
  return {
    id,
    cases,
    settle,
    touchdowns,
    minimumClearance: Math.min(
      ...cases.map((c) => c.clearance),
      ...settle.map((c) => c.clearance),
    ),
    maximumClearance: Math.max(
      ...cases.map((c) => c.clearance),
      ...settle.map((c) => c.clearance),
    ),
    checks: [
      {
        name: "Rigid tire surfaces clear pavement after 0.5 m overlap at 30/60/120 Hz",
        pass: overlapPass,
      },
      {
        name: "Four seconds of settled wheel contact stay above pavement without bounce",
        pass: settlePass,
      },
      {
        name: "Routine 1.2 m/s touchdowns remain mounted and undamaged on both runways",
        pass: touchdowns.every(
          (c) =>
            c.landed && c.grounded && c.health === 100 && c.clearance >= -1e-4,
        ),
      },
    ],
  };
}
