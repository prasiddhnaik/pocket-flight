import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { Box3, type Mesh, Vector3 } from "three";
import {
  aircraftDesign,
  massProperties,
} from "../src/aircraft/aircraft-design";
import { aircraftStallSpeed, aircraftThrust } from "../src/flight/aerodynamics";
import { FlightPhysics } from "../src/flight/physics";
import { wheelPose } from "../src/flight/airframe-contact";
import { advancePropeller } from "../src/aircraft/finch/propeller";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { wingForAircraft } from "../lab/catalog";
import collision from "../src/aircraft/heron/collision.json";

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
const asset = new URL("../public/assets/heron-ut9.glb", import.meta.url);

test("Heron's shipped model matches the exact CAD contact validation", async () => {
  const report = await Bun.file(
    new URL("../public/assets/heron-ut9.cad.json", import.meta.url),
  ).json();
  expect(report.assetSha256).toBe(
    createHash("sha256")
      .update(new Uint8Array(await Bun.file(asset).arrayBuffer()))
      .digest("hex"),
  );
  expect(report.solidCount).toBeGreaterThan(100);
  expect(report.connectedSolids).toBe(report.solidCount);
  expect(report.floating).toEqual([]);
  expect(report.floorEnclosed).toBe(true);
  expect(Object.keys(report.pathsToBody)).toHaveLength(report.solidCount);
  for (const path of Object.values(report.pathsToBody) as string[][])
    expect(path[0]).toStartWith("Fuselage#");
});

test("Heron's runtime CAD export retains controls, propeller, scale and wheel datums", async () => {
  const { scene } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  for (const name of [
    "Fuselage",
    "Wing_Left",
    "Wing_Right",
    "LandingGear",
    "Propeller",
    "Aileron_Left",
    "Aileron_Right",
    "Flap_Left",
    "Flap_Right",
    "Elevator",
    "Rudder",
    "Front_Wheel_Steering",
  ])
    expect(scene.getObjectByName(name)).toBeDefined();
  const size = new Box3().setFromObject(scene).getSize(new Vector3());
  expect(size.x).toBeCloseTo(15.87, 2);
  expect(size.y).toBeCloseTo(4.7, 2);
  expect(size.z).toBeCloseTo(12.67, 2);
  for (const [i, name] of [
    "Wheel_Main_Left",
    "Wheel_Main_Right",
    "Wheel_Front",
  ].entries()) {
    expect(
      scene
        .getObjectByName(name)!
        .getWorldPosition(new Vector3())
        .distanceTo(wheelPose("heron", i, 1).center),
    ).toBeLessThan(1e-5);
    expect(
      wheelPose("heron", i, 0).center.distanceTo(
        wheelPose("heron", i, 1).center,
      ),
    ).toBe(0);
  }
  expect(
    scene
      .getObjectByName("Propeller")!
      .children.filter((n) => n.name.startsWith("Propeller_Blade_")),
  ).toHaveLength(4);
});

test("Heron's collision envelope reaches the painted belly behind the cargo pod", async () => {
  const { scene } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  const cargo = new Box3().setFromObject(scene.getObjectByName("Cargo_pod")!);
  const rear = cargo.max.z + 0.55;
  const belly = scene.getObjectByName("Curved_belly_livery")!;
  const positions = (belly as Mesh).geometry.getAttribute("position");
  const point = new Vector3();
  let underside = Infinity;
  for (let i = 0; i < positions.count; i++) {
    point.fromBufferAttribute(positions, i).applyMatrix4(belly.matrixWorld);
    if (point.z > rear) underside = Math.min(underside, point.y);
  }
  const probes = collision.probes.filter(
    (p) => p.part === "body" && p.center[2] > rear,
  );
  expect(Number.isFinite(underside)).toBe(true);
  expect(probes.length).toBeGreaterThan(0);
  expect(Math.min(...probes.map((p) => p.center[1]))).toBeLessThan(
    underside + 0.05,
  );
});

test("Heron's brake discs turn with the wheels while calipers and hoses stay on their mounts", async () => {
  const { scene } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  for (const side of ["Left", "Right"]) {
    const wheel = scene.getObjectByName(`Wheel_Main_${side}`)!;
    const disc = scene.getObjectByName(`Brake_disc_${side}`)!;
    const caliper = scene.getObjectByName(`Brake_caliper_${side}`)!;
    const hose = scene.getObjectByName(`Brake_hose_${side}`)!;
    expect(disc.parent).toBe(wheel);
    expect(caliper.parent).toBe(wheel.parent);
    expect(hose.parent).toBe(wheel.parent);
    const discBefore = disc.matrixWorld.clone();
    const caliperBefore = caliper.matrixWorld.clone();
    const hoseBefore = hose.matrixWorld.clone();
    wheel.rotation.x += Math.PI / 3;
    scene.updateMatrixWorld(true);
    expect(disc.matrixWorld.equals(discBefore)).toBe(false);
    expect(caliper.matrixWorld.equals(caliperBefore)).toBe(true);
    expect(hose.matrixWorld.equals(hoseBefore)).toBe(true);
  }
});

test("Heron keeps fixed gear while operating flaps in manual and automatic modes", () => {
  const p = new FlightPhysics();
  p.aircraftId = "heron";
  p.reset(true);
  expect(p.jet).toBe(false);
  expect(p.gearPosition).toBe(1);
  p.setAutomaticConfiguration(false);
  expect(p.toggleGear()).toBe(false);
  expect(p.gearTarget).toBe(1);
  expect(p.cycleFlaps()).toBe(true);
  expect(p.flapCommand).toBe(0.65);
  expect(p.cycleFlaps()).toBe(true);
  expect(p.flapCommand).toBe(1);
  for (let i = 0; i < 180; i++) p.step(1 / 60, neutral);
  expect(p.flapPosition).toBeGreaterThan(0.99);
  expect(p.gearPosition).toBe(1);
});

test("Heron loading conserves fuel mass and has a usable positive inertia tensor", () => {
  const d = aircraftDesign("heron");
  const full = massProperties(d.massBudget, { fuel: 1, payload: 1 });
  const dry = massProperties(d.massBudget, { fuel: 0, payload: 1 });
  expect(full.mass - dry.mass).toBeCloseTo(d.fuel.usableFuelKg, 6);
  expect(d.nominal.mass).toBeLessThan(d.maxTakeoffMass);
  expect(full.inertia.determinant()).toBeGreaterThan(0);
  expect(Math.abs(full.cg.x)).toBeLessThan(1e-9);
  expect(aircraftStallSpeed(d, full.mass, 1.225, 1)).toBeLessThan(
    aircraftStallSpeed(d, full.mass, 1.225, 0),
  );
});

test("Heron uses shaft power without jet thrust or afterburner", () => {
  const d = aircraftDesign("heron");
  expect(d.propulsion.kind).toBe("propeller");
  expect(d.propulsion.afterburningThrust).toBe(0);
  expect(aircraftThrust(d, 0, 1, 1.225)).toBeGreaterThan(10_000);
  expect(aircraftThrust(d, 70, 1, 1.225)).toBeLessThan(
    aircraftThrust(d, 35, 1, 1.225),
  );
  let pose = { angle: 0, rpm: 0 };
  for (let i = 0; i < 600; i++)
    pose = advancePropeller(
      pose,
      { throttle: 1, airspeed: 0, damage: 0, engineOut: false, crashed: false },
      1 / 60,
      { idleRpm: 600, maxRpm: 1900 },
    );
  expect(pose.rpm).toBeCloseTo(1900, 2);
});

test("Heron's wing is available to the private wind tunnel", () => {
  const wing = wingForAircraft("heron");
  expect(wing.stations.length).toBeGreaterThanOrEqual(5);
  expect(wing.stations.at(-1)!.x).toBeCloseTo(15.87 / 2, 3);
});

test("Heron can depart Palm Bay on its own wheels and remain intact", () => {
  for (const hz of [30, 60, 120]) {
    const p = new FlightPhysics();
    p.aircraftId = "heron";
    p.reset();
    const departureAltitude = p.position.y;
    let tookOff = false;
    for (let n = 0; n < hz * 25; n++) {
      p.step(1 / hz, {
        ...neutral,
        throttle: 1,
        pitch: p.airspeed * 1.943844 >= p.profile.rotationKnots ? 1 : 0,
      });
      tookOff ||= p.events.some((e) => e.type === "takeoff");
    }
    expect(tookOff).toBe(true);
    expect(p.crashed).toBe(false);
    expect(p.grounded).toBe(false);
    expect(p.health).toBe(100);
    expect(p.position.y - departureAltitude).toBeGreaterThan(40);
    expect(p.gearPosition).toBe(1);
  }
}, 30000);
