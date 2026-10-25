import { JetMotion } from "../src/aircraft/jet-effects";
import { validateReplay, type SavedReplay } from "../src/replay/replay-data";
import { expect, test } from "bun:test";
import { Euler, Group, MathUtils, Quaternion, Vector3 } from "three";
import {
  aircraftDesign,
  massProperties,
} from "../src/aircraft/aircraft-design";
import {
  aircraftAerodynamics,
  aircraftThrust,
  airDensity,
} from "../src/flight/aerodynamics";
import { FlightPhysics } from "../src/flight/physics";
import { solveTrim } from "../src/flight/flight-trim";
import { consumeTankFuel } from "../src/flight/fuel-loading";
import { wheelPose, wheelSupportPoint } from "../src/flight/airframe-contact";
import {
  f15cGear,
  f15cGearState,
  f15cTires,
} from "../src/aircraft/f15c/landing-gear";
import {
  F15CMechanisms,
  f15cControlSurfaces,
} from "../src/aircraft/f15c/mechanisms";
import { wingForAircraft } from "../lab/catalog";
import { runtimeAircraftCatalog } from "../lab/aircraft";
import { validateGear } from "../lab/gear-validation";
import { aircraftNames } from "../src/app/flight-ui";
import { islandEnvelope } from "../src/flight/flight-envelope";
import wingHinges from "../assets/f15c/parts/wings/checks/hinges.json";
import gearHinges from "../assets/f15c/parts/gear/checks/hinges.json";
import wingEvidence from "../assets/f15c/parts/wings/checks/lab-results.json";

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
const d = aircraftDesign("f15c");
test("F-15C loading conserves its own internal fuel, dry mass, symmetry and positive inertia", () => {
  const dry = massProperties(d.massBudget, { fuel: 0, payload: 0 });
  const full = massProperties(d.massBudget, { fuel: 1, payload: 0 });
  expect(dry.mass).toBeCloseTo(12700, 7);
  expect(full.mass - dry.mass).toBeCloseTo(6100, 7);
  expect(d.nominal.mass).toBeLessThan(d.maxTakeoffMass);
  for (const fuel of [0, 0.1, 0.65, 1])
    for (const payload of [0, 1]) {
      const b = massProperties(d.massBudget, { fuel, payload });
      expect(Math.abs(b.cg.x)).toBeLessThan(1e-10);
      expect(b.inertia.determinant()).toBeGreaterThan(0);
      expect(b.inverseInertia.elements.every(Number.isFinite)).toBe(true);
      expect(b.cg.z).toBeGreaterThanOrEqual(d.cgEnvelope[0]);
      expect(b.cg.z).toBeLessThanOrEqual(d.cgEnvelope[1]);
      expect(
        (d.neutralPointZ - b.cg.z) / d.geometry.meanAerodynamicChord,
      ).toBeGreaterThan(0.03);
    }
  const burned = consumeTankFuel(d.fuel.tanks, d.nominal.fuelByTank, 1000);
  expect(
    Object.values(d.nominal.fuelByTank).reduce((a, b) => a + b, 0) -
      Object.values(burned).reduce((a, b) => a + b, 0),
  ).toBeCloseTo(1000, 7);
  expect(burned.left).toBeCloseTo(burned.right, 8);
});

test("F-15C trims all approved load endpoints with finite force and moment residuals", () => {
  for (const fuel of [0, 0.1, 0.65, 1])
    for (const payload of [0, 1]) {
      const balance = massProperties(d.massBudget, { fuel, payload });
      const trim = solveTrim(d, balance, d.trimSpeed, 1000);
      expect(trim.forceResidual).toBeLessThan(1e-5);
      expect(trim.momentResidual).toBeLessThan(1e-5);
      expect(trim.throttle).toBeGreaterThan(0);
      expect(trim.throttle).toBeLessThan(0.88);
      expect(Math.abs(trim.pitch)).toBeLessThan(0.2);
    }
});

test("F-15C has a bounded twin-jet installed map and an effective dissipative speedbrake", () => {
  expect(aircraftThrust(d, 0, 0.88, 1.225, 0)).toBeCloseTo(130000, 6);
  expect(aircraftThrust(d, 0, 1, 1.225, 0)).toBeCloseTo(210000, 6);
  expect(aircraftThrust(d, 0, 0, 1.225, 0)).toBe(0);
  expect(aircraftThrust(d, 145, 1, airDensity(3000), 3000)).toBeLessThan(
    aircraftThrust(d, 145, 1, 1.225, 0),
  );
  const sample = (airbrake: number) =>
    aircraftAerodynamics(
      d,
      new Vector3(0, 0, -145),
      new Vector3(),
      new Quaternion().setFromEuler(new Euler(0.08, 0, 0)),
      1000,
      d.nominal.cg,
      new Vector3(),
      undefined,
      { gear: 0, flap: 0, wingDamage: 0, gearDamage: 0, airbrake },
    );
  const clean = sample(0),
    braking = sample(1);
  expect(braking.drag).toBeGreaterThan(clean.drag * 2);
  expect(braking.lift).toBeCloseTo(clean.lift, 6);
  expect(islandEnvelope.f15c.maximumMach).toBe(0.7);
});

test("F-15C physical wing axes yield symmetric down-flaps, opposing roll and nose-up stabilators", () => {
  const root = new Group();
  for (const hinge of wingHinges.hinges) {
    const node = new Group();
    node.name = hinge.part;
    const axis = new Vector3()
      .fromArray(hinge.end)
      .sub(new Vector3().fromArray(hinge.start));
    node.userData.hinge_axis = [axis.x, axis.z, -axis.y];
    root.add(node);
  }
  for (const name of [
    "Stabilator_Left",
    "Stabilator_Right",
    "Stabilator_shaft_Left",
    "Stabilator_shaft_Right",
    "Rudder_Left",
    "Rudder_Right",
    "Canopy",
    "Airbrake",
  ]) {
    const node = new Group();
    node.name = name;
    root.add(node);
  }
  const mechanisms = new F15CMechanisms(root);
  mechanisms.apply({
    gear: 1,
    roll: 1,
    pitch: 1,
    yaw: 1,
    flaps: 1,
    canopy: 1,
    speedBrake: 1,
  });
  for (const side of ["Left", "Right"]) {
    expect(
      new Vector3(0, 0, 1).applyQuaternion(
        root.getObjectByName(`Flap_${side}`)!.quaternion,
      ).y,
    ).toBeLessThan(-0.3);
    expect(
      new Vector3(0, 0, 1).applyQuaternion(
        root.getObjectByName(`Stabilator_${side}`)!.quaternion,
      ).y,
    ).toBeGreaterThan(0.3);
    expect(
      new Vector3(0, 0, 1).applyQuaternion(
        root.getObjectByName(`Rudder_${side}`)!.quaternion,
      ).x,
    ).toBeGreaterThan(0.3);
  }
  expect(
    new Vector3(0, 0, 1).applyQuaternion(
      root.getObjectByName("Aileron_Left")!.quaternion,
    ).y,
  ).toBeLessThan(-0.2);
  expect(
    new Vector3(0, 0, 1).applyQuaternion(
      root.getObjectByName("Aileron_Right")!.quaternion,
    ).y,
  ).toBeGreaterThan(0.2);
  expect(
    new Vector3(0, 0, -1).applyQuaternion(
      root.getObjectByName("Canopy")!.quaternion,
    ).y,
  ).toBeGreaterThan(0.8);
  expect(
    new Vector3(0, 0, 1).applyQuaternion(
      root.getObjectByName("Airbrake")!.quaternion,
    ).y,
  ).toBeGreaterThan(0.8);
  for (const side of ["Left", "Right"])
    expect(
      root
        .getObjectByName(`Stabilator_shaft_${side}`)!
        .quaternion.angleTo(
          root.getObjectByName(`Stabilator_${side}`)!.quaternion,
        ),
    ).toBeLessThan(1e-7);
  const surfaces = f15cControlSurfaces(mechanisms.parts);
  surfaces.apply({ roll: 0.5, pitch: -0.25, yaw: 0.25 });
  expect(surfaces.snapshot()).toEqual({ roll: 0.5, pitch: -0.25, yaw: 0.25 });
});

test("F-15C runtime gear pivots and axes follow the final CAD hinge metadata", () => {
  for (const datum of f15cGear) {
    const authored = Object.values(gearHinges.gear).find(
      (gear) => gear.group === datum.name,
    )!;
    const point = new Vector3(
      authored.origin[0],
      authored.origin[2] - 2.38,
      -authored.origin[1],
    );
    const axis = new Vector3(
      authored.axis[0],
      authored.axis[2],
      -authored.axis[1],
    ).normalize();
    expect(new Vector3().fromArray(datum.pivot).distanceTo(point)).toBeLessThan(
      1e-12,
    );
    expect(new Vector3().fromArray(datum.axis).distanceTo(axis)).toBeLessThan(
      1e-12,
    );
    expect(datum.travel).toBe(authored.retractedDegrees);
  }
});

test("F-15C wheel contacts follow exact authored hinge paths and preserve the ground datum", () => {
  const down = [0, 1, 2].map((i) => wheelPose("f15c", i, 1));
  for (const pose of down)
    expect(pose.center.y - pose.radius).toBeCloseTo(-2.38, 8);
  expect(down[0].center.x).toBe(-down[1].center.x);
  for (let i = 0; i < 3; i++) {
    const up = wheelPose("f15c", i, 0);
    expect(up.center.y).toBeGreaterThan(down[i].center.y + 1.2);
    expect(up.axle.length()).toBeCloseTo(1, 8);
  }
  expect(f15cGearState(1)).toEqual({ leg: 0, forwardDoor: 0, aftDoor: 1 });
  expect(f15cGearState(0)).toEqual({ leg: 1, forwardDoor: 0, aftDoor: 0 });
});

test("F-15C keeps finite trim flight at 30/60/120Hz and manual gear/flaps work", () => {
  const heights: number[] = [];
  for (const hz of [30, 60, 120]) {
    const p = new FlightPhysics();
    p.aircraftId = "f15c";
    p.windOverride = new Vector3();
    p.reset(true);
    p.position.set(0, 1000, 700);
    p.beginnerAssist = false;
    p.initializeAirStart(145);
    p.setAutomaticConfiguration(false);
    expect(p.toggleGear()).toBe(true);
    expect(p.cycleFlaps()).toBe(true);
    for (let i = 0; i < hz * 12; i++) p.step(1 / hz, neutral);
    expect(
      [
        ...p.position.toArray(),
        ...p.velocity.toArray(),
        ...p.angularVelocity.toArray(),
      ].every(Number.isFinite),
    ).toBe(true);
    expect(p.crashed).toBe(false);
    expect(p.health).toBe(100);
    expect(p.gearPosition).toBeCloseTo(1, 8);
    expect(p.flapPosition).toBeCloseTo(0.65, 4);
    heights.push(p.position.y);
    p.step(1, { ...neutral, brake: true });
    expect(p.airbrakePosition).toBeGreaterThan(0.9);
    p.step(2, neutral);
    expect(p.airbrakePosition).toBeLessThan(0.01);
  }
  expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.5);
});

test("F-15C appears in game and honest wing-only lab catalogs with its measured planform", () => {
  const wing = wingForAircraft("f15c");
  expect(wing.stations).toHaveLength(10);
  expect(wing.stations.at(-1)!.x * 2).toBeCloseTo(d.geometry.span, 6);
  expect(wing.stations[1].y).toBeCloseTo(0.67, 6);
  expect(d.geometry.wingArea).toBeCloseTo(wingEvidence.modeledVlmAreaM2, 8);
  expect(wingEvidence.declaredAerodynamicReferenceAreaM2).toBe(56.49);
  expect(d.geometry.wingArea).toBeGreaterThan(
    wingEvidence.declaredAerodynamicReferenceAreaM2,
  );
  expect(d.aerodynamics.liftSlope).toBeCloseTo(
    wingEvidence.liftSlopePerRadian,
    10,
  );
  expect(runtimeAircraftCatalog.f15c.asset).toBe("f15c-eagle.glb");
  expect(aircraftNames.f15c).toBe("F-15C Eagle");
  expect(wing.assumptions.join(" ")).toContain("no fuselage");
  expect(d.provenance).toContain("no supersonic CFD");
});

test("F-15C finite-width tire support agrees with independent cylinder vertex samples", () => {
  for (const bank of [-0.4, -0.1, 0, 0.1, 0.4])
    for (const extension of [0, 0.5, 1])
      for (let index = 0; index < 3; index++) {
        const orientation = new Quaternion().setFromEuler(
          new Euler(0.12, 0.2, bank),
        );
        const pose = wheelPose("f15c", index, extension);
        const rotation = new Quaternion().setFromUnitVectors(
          new Vector3(1, 0, 0),
          pose.axle,
        );
        const tire = f15cTires[index];
        let minimum = Infinity;
        for (const x of [-tire.halfWidth, tire.halfWidth])
          for (let i = 0; i < 512; i++) {
            const p = new Vector3(
              x,
              tire.radius * Math.cos((i * Math.PI) / 256),
              tire.radius * Math.sin((i * Math.PI) / 256),
            )
              .applyQuaternion(rotation)
              .add(pose.center)
              .applyQuaternion(orientation);
            minimum = Math.min(minimum, p.y);
          }
        expect(
          Math.abs(
            wheelSupportPoint(
              "f15c",
              index,
              extension,
              new Vector3(),
              orientation,
            ).y - minimum,
          ),
        ).toBeLessThan(0.00001);
      }
});

test("F-15C wheels settle, resolve overlap and accept routine touchdowns on both runways", () => {
  const validation = validateGear("f15c");
  for (const check of validation.checks) expect(check.pass).toBe(true);
  expect(validation.minimumClearance).toBeGreaterThan(-0.0001);
}, 30000);

test("F-15C departs Palm Bay intact using ordinary throttle and attitude inputs", () => {
  for (const hz of [30, 60, 120]) {
    const p = new FlightPhysics();
    p.aircraftId = "f15c";
    p.windOverride = new Vector3();
    p.reset();
    let departed = false;
    for (let tick = 0; tick < hz * 25; tick++) {
      const pitch =
        p.airspeed * 1.943844 >= p.profile.rotationKnots
          ? MathUtils.clamp((0.22 - p.pitch) * 3, -0.3, 0.65)
          : 0;
      p.step(1 / hz, { ...neutral, throttle: 1, pitch });
      departed ||= p.events.some((e) => e.type === "takeoff");
    }
    expect(departed).toBe(true);
    expect(p.grounded).toBe(false);
    expect(p.health).toBe(100);
    expect(p.crashed).toBe(false);
    expect(p.position.y).toBeGreaterThan(150);
  }
}, 30000);

test("F-15C replay acceptance preserves schema-one recordings from all older aircraft", () => {
  const saved: SavedReplay = {
    schemaVersion: 1,
    id: "f15c-flight",
    name: "Eagle sortie",
    aircraft: "f15c",
    paint: 0,
    mission: "free",
    createdAt: 1,
    updatedAt: 1,
    duration: 1,
    trimmed: false,
    frames: [0, 1].map((t) => ({
      t,
      worldTime: t,
      p: [0, 1000, -145 * t],
      q: [0, 0, 0, 1],
      throttle: 0.2,
      speed: 145,
      suspension: 0,
      gearDamage: 0,
      propAngle: 0,
      propRpm: 0,
      surfaces: { pitch: 0, roll: 0, yaw: 0 },
      propVisible: false,
      gearVisible: true,
      wings: [true, true],
      engineOut: false,
      night: false,
      ring: 0,
      debris: [],
      jet: { ...new JetMotion() },
    })),
  };
  expect(validateReplay(JSON.parse(JSON.stringify(saved)))).toBe(true);
  for (const aircraft of [
    "finch",
    "peregrine",
    "aurelia",
    "stormbird",
    "heron",
  ] as const) {
    const legacy = structuredClone({ ...saved, aircraft });
    for (const frame of legacy.frames)
      if (frame.jet) Reflect.deleteProperty(frame.jet, "speedBrake");
    expect(validateReplay(legacy)).toBe(true);
  }
  expect(validateReplay({ ...saved, aircraft: "unknown" })).toBe(false);
});

test("F-15C inner gear doors obey exported signed travel and close after stow", () => {
  const root = new Group();
  for (const [name, angle] of [
    ["Door_Left_Inner", -72],
    ["Door_Right_Inner", 68],
    ["Door_Left_Aft", 100],
  ] as const) {
    const node = new Group();
    node.name = name;
    node.userData.hinge_axis = [0, 0, -1];
    node.userData.travel_degrees = [0, angle];
    root.add(node);
  }
  const m = new F15CMechanisms(root);
  const pose = {
    roll: 0,
    pitch: 0,
    yaw: 0,
    gear: 0.5,
    flaps: 0,
    canopy: 0,
    speedBrake: 0,
  };
  m.apply(pose);
  expect(root.getObjectByName("Door_Left_Inner")!.rotation.z).toBeCloseTo(
    MathUtils.degToRad(72),
    7,
  );
  expect(root.getObjectByName("Door_Right_Inner")!.rotation.z).toBeCloseTo(
    MathUtils.degToRad(-68),
    7,
  );
  m.apply({ ...pose, gear: 0 });
  for (const node of root.children)
    expect(node.quaternion.angleTo(new Quaternion())).toBeLessThan(1e-7);
  m.apply({ ...pose, gear: 1 });
  expect(
    root
      .getObjectByName("Door_Left_Inner")!
      .quaternion.angleTo(new Quaternion()),
  ).toBeLessThan(1e-7);
  expect(
    Math.abs(root.getObjectByName("Door_Left_Aft")!.rotation.z),
  ).toBeGreaterThan(1.5);
});
