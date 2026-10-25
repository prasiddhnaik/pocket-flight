import { Euler, MathUtils, Quaternion, Vector3 } from "three";
import type { AircraftId } from "../src/aircraft/aircraft";
import {
  aircraftDesign,
  massProperties,
  type Loading,
} from "../src/aircraft/aircraft-design";
import {
  aircraftAerodynamics,
  aircraftStallSpeed,
  aircraftThrust,
  airDensity,
} from "../src/flight/aerodynamics";
import { FlightPhysics } from "../src/flight/physics";
import { solveTrim } from "../src/flight/flight-trim";
import { localSoundSpeed } from "../src/flight/engine-map";
import { references } from "../src/flight/flight-reference-data";

export const VALIDATION_VERSION = "fleet-envelope-balance-4";
const zero = new Vector3(),
  neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0, brake: false };
const radians = Math.PI / 180;
export function validateAircraft(id: AircraftId) {
  const design = aircraftDesign(id),
    speed = design.trimSpeed,
    altitude = 1000;
  const gear = id === "finch" || id === "heron" ? 1 : 0;
  const loadings: Loading[] = [
    design.defaultLoading,
    { fuel: 0.1, payload: 1 },
    { fuel: design.defaultLoading.fuel, payload: id === "aurelia" ? 0 : 0.9 },
    { fuel: 0.1, payload: id === "aurelia" ? 0 : 0.9 },
  ];
  const sample = (
    alpha: number,
    balance = design.nominal,
    rates = zero,
    pitch = 0,
    flap = 0,
  ) =>
    aircraftAerodynamics(
      design,
      new Vector3(0, 0, -speed),
      zero,
      new Quaternion().setFromEuler(new Euler(alpha, 0, 0, "YXZ")),
      altitude,
      balance.cg,
      rates,
      { pitch, roll: 0, yaw: 0 },
      { gear, flap, wingDamage: 0, gearDamage: 0 },
    );
  const polars = [0, 1].map((flap) => ({
    flap,
    rows: Array.from({ length: 211 }, (_, i) => {
      const alpha = -45 + i * 0.5,
        a = sample(alpha * radians, undefined, undefined, 0, flap);
      return {
        alpha,
        cl: a.cl,
        cd: a.cd,
        cm:
          a.moment.x /
          (a.dynamicPressure *
            design.geometry.wingArea *
            design.geometry.meanAerodynamicChord),
        stalled: a.stalled,
        separation: a.separation,
        controlEffectiveness: a.controlEffectiveness,
      };
    }),
  }));
  const cgChecks = loadings.map((loading) => {
    const balance = massProperties(design.massBudget, loading),
      t = solveTrim(design, balance, speed, altitude, gear);
    const a = sample(t.alpha, balance),
      step = 1e-4;
    const cmAlpha =
      (sample(t.alpha + step, balance).moment.x -
        sample(t.alpha - step, balance).moment.x) /
      (2 *
        step *
        a.dynamicPressure *
        design.geometry.wingArea *
        design.geometry.meanAerodynamicChord);
    const cmQ =
      (sample(t.alpha, balance, new Vector3(step, 0, 0)).moment.x -
        sample(t.alpha, balance, new Vector3(-step, 0, 0)).moment.x) /
      ((2 *
        step *
        a.dynamicPressure *
        design.geometry.wingArea *
        design.geometry.meanAerodynamicChord ** 2) /
        (2 * speed));
    return {
      loading,
      mass: balance.mass,
      cg: balance.cg.toArray(),
      staticMargin: a.staticMargin,
      cmAlpha,
      cmQ,
      trim: t,
    };
  });
  const disturbances = cgChecks.flatMap((c) =>
    (["pitch", "roll", "yaw"] as const).map((axis) => {
      const p = new FlightPhysics();
      p.aircraftId = id;
      p.configureLoading(c.loading);
      p.reset(true);
      p.position.set(0, altitude, 700);
      p.velocity.set(0, 0, -speed);
      p.pitch = c.trim.alpha;
      p.elevatorTrim = c.trim.pitch;
      p.roll = c.trim.bank;
      p.rollTrim = c.trim.roll;
      p.yawTrim = c.trim.yaw;
      p.throttle = p.enginePower = c.trim.throttle;
      p.beginnerAssist = false;
      p.windOverride = new Vector3();
      if (axis === "pitch") p.pitch += 2 * radians;
      if (axis === "roll") p.angularVelocity.z = 5 * radians;
      if (axis === "yaw") p.yaw = 3 * radians;
      const trace: {
        time: number;
        alpha: number;
        beta: number;
        rates: number[];
        height: number;
        speed: number;
      }[] = [];
      for (let n = 0; n < 1800; n++) {
        p.step(1 / 60, neutral);
        if (n % 12 === 0)
          trace.push({
            time: p.flightTime,
            alpha: p.aerodynamics?.alpha ?? 0,
            beta: p.aerodynamics?.beta ?? 0,
            rates: p.angularVelocity.toArray(),
            height: p.position.y,
            speed: p.airspeed,
          });
      }
      const amplitude = (r: (typeof trace)[number]) =>
        axis === "pitch"
          ? Math.hypot(r.alpha - c.trim.alpha, r.rates[0])
          : axis === "yaw"
            ? Math.hypot(r.beta, r.rates[1])
            : Math.abs(r.rates[2]);
      const rms = (rows: typeof trace) =>
        Math.sqrt(
          rows.reduce((sum, r) => sum + amplitude(r) ** 2, 0) / rows.length,
        );
      const initialRms = rms(trace.slice(0, 25)),
        finalRms = rms(trace.slice(-25));
      return {
        loading: c.loading,
        axis,
        initialRms,
        finalRms,
        ratio: finalRms / Math.max(initialRms, 1e-10),
        bounded:
          trace.every((r) =>
            [r.alpha, r.beta, r.height, r.speed, ...r.rates].every(
              Number.isFinite,
            ),
          ) && p.health === 100,
        trace,
      };
    }),
  );
  const stalls = cgChecks.flatMap((c) =>
    [1, -1].map((sign) => {
      const p = new FlightPhysics();
      p.aircraftId = id;
      p.configureLoading(c.loading);
      p.reset(true);
      p.position.set(0, altitude, 700);
      p.velocity.set(0, 0, -speed);
      p.pitch =
        (sign > 0
          ? (design.aerodynamics.clMax - design.aerodynamics.cl0) /
            design.aerodynamics.liftSlope
          : (design.aerodynamics.clMin - design.aerodynamics.cl0) /
            design.aerodynamics.liftSlope) +
        sign * 10 * radians;
      p.engineOut = true;
      p.beginnerAssist = false;
      p.windOverride = new Vector3();
      let entry = false,
        recoveryTime: number | null = null,
        maximumAlpha = 0,
        minimumEffectiveness = 1,
        lossOfHeight = 0,
        stalledSeconds = 0;
      for (let n = 0; n < 600; n++) {
        p.step(1 / 60, neutral);
        entry ||= p.stall;
        stalledSeconds += p.stall ? 1 / 60 : 0;
        maximumAlpha = Math.max(
          maximumAlpha,
          Math.abs(p.aerodynamics?.alpha ?? 0),
        );
        minimumEffectiveness = Math.min(
          minimumEffectiveness,
          p.aerodynamics?.controlEffectiveness ?? 1,
        );
        lossOfHeight = Math.max(lossOfHeight, altitude - p.position.y);
        if (entry && !p.stall && recoveryTime === null)
          recoveryTime = p.flightTime;
      }
      return {
        loading: c.loading,
        sign,
        entry,
        recoveryTime,
        stalledSeconds,
        maximumAlpha: maximumAlpha / radians,
        minimumEffectiveness,
        lossOfHeight,
        health: p.health,
        stalledAtEnd: p.stall,
      };
    }),
  );
  const poweredRecoveries = cgChecks.map((c) => {
    const p = new FlightPhysics();
    p.aircraftId = id;
    p.configureLoading(c.loading);
    p.reset(true);
    p.position.set(0, altitude, 700);
    p.velocity.set(
      0,
      0,
      -aircraftStallSpeed(design, c.mass, airDensity(altitude)) * 1.1,
    );
    const critical =
      (design.aerodynamics.clMax - design.aerodynamics.cl0) /
      design.aerodynamics.liftSlope;
    p.pitch = critical + 10 * radians;
    p.beginnerAssist = false;
    p.windOverride = new Vector3();
    p.throttle = p.enginePower = 0.5;
    let entry = false,
      firstExit: number | null = null,
      lastStallTime = 0,
      lossOfHeight = 0,
      maximumHeight = altitude;
    for (let n = 0; n < 600; n++) {
      // A declared test-pilot policy, not the game's beginner controller:
      // keep reducing AOA as needed, with pitch-rate feedback and bounded input.
      const command = MathUtils.clamp(
        (critical * 0.6 - (p.aerodynamics?.alpha ?? p.pitch)) * 0.8 -
          p.angularVelocity.x * 0.3,
        -0.25,
        0.15,
      );
      p.step(1 / 60, { ...neutral, pitch: command, throttle: 1 });
      entry ||= p.stall;
      maximumHeight = Math.max(maximumHeight, p.position.y);
      if (p.stall) lastStallTime = p.flightTime;
      if (entry && !p.stall && firstExit === null) firstExit = p.flightTime;
      lossOfHeight = Math.max(lossOfHeight, altitude - p.position.y);
    }
    return {
      loading: c.loading,
      entry,
      firstExit,
      lastStallTime,
      terminalStallFreeSeconds: p.flightTime - lastStallTime,
      lossOfHeight,
      maximumHeight,
      stalledAtEnd: p.stall,
      health: p.health,
    };
  });
  const engine = [0, 1000, 3000, 6000].flatMap((height) =>
    [0, 0.1, 0.2, 0.4, 0.6, 0.8].flatMap((mach) =>
      [0, 0.25, 0.5, 0.88, 1].map((throttle) => ({
        altitude: height,
        mach,
        throttle,
        thrust: aircraftThrust(
          design,
          mach * localSoundSpeed(height),
          throttle,
          airDensity(height),
          height,
        ),
        referenceStatus:
          id === "f15c"
            ? "Estimated twin F100-class subsonic installed map"
            : id === "aurelia"
            ? "Estimated civil map"
            : id === "heron"
              ? "Estimated turboprop altitude lapse, efficiency and static thrust"
            : id === "finch"
              ? "Published altitude power; estimated propeller efficiency/static thrust"
              : mach < 0.2
                ? "Below reference Mach range: boundary held"
                : "Scaled published fighter deck",
      })),
    ),
  );
  const stallSpeeds = cgChecks.map((c) => ({
    loading: c.loading,
    clean: aircraftStallSpeed(design, c.mass, airDensity(altitude)),
    flapped: aircraftStallSpeed(design, c.mass, airDensity(altitude), 1),
    twoG: aircraftStallSpeed(design, c.mass, airDensity(altitude), 0, 2),
  }));
  return {
    version: VALIDATION_VERSION,
    id,
    speed,
    altitude,
    polars,
    cgChecks,
    disturbances,
    stalls,
    poweredRecoveries,
    engine,
    stallSpeeds,
    references,
    limitations: [
      id === "f15c"
        ? "Internal consistency checks for an estimated F-15C reconstruction, not empirical aircraft validation."
        : "Internal consistency and reference transfer checks, not empirical validation of the fictional aircraft.",
      "Attached geometry slope is from main-wing VLM; that solver does not predict stall.",
      "Stall curve transfers approximate NACA 0012 section loss shape. Fleet CLmax/critical alpha and negative-alpha symmetry remain assumptions; no local tip/root progression, dynamic hysteresis, spin or T-tail deep-stall validation.",
      id === "f15c"
        ? "Control attenuation, neutral point and all whole-aircraft stability/control derivatives remain estimates. Thirty-second disturbance decay is not a complete modal or handling-qualities certification."
        : "Control attenuation is estimated. Neutral point, yaw/roll derivatives and civil pitch damping remain estimated. Thirty-second disturbance decay is not a complete modal or handling-qualities certification.",
      id === "f15c"
        ? "Twin F100-class sea-level ratings, density lapse, inlet losses, fuel flow and spool response are estimates. The island cap is Mach 0.7; no transonic/supersonic thrust or intake validation."
        : "Military thrust deck is a published simulator input, scaled to concept ratings. M<0.2 holds a boundary; civil deck, propeller efficiency/static thrust, fuel flow and spool response remain estimated.",
    ],
  };
}
export type Validation = ReturnType<typeof validateAircraft>;
