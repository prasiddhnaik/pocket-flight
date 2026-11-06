import { Vector3, Quaternion, Euler, MathUtils } from "three";
import { groundAt, groundHeight, runways } from "../world/terrain";
import type { CollisionObstacles } from "./obstacle-index";
import type { AircraftId } from "../aircraft/aircraft";
import { flightProfiles } from "./flight-profiles";
import { stormbirdContact } from "../aircraft/stormbird/stormbird-contact";
import { STORMBIRD_GEAR_SECONDS } from "../aircraft/stormbird/stormbird-kinematics";
import {
  airDensity,
  aircraftAerodynamics,
  aircraftStallSpeed,
  aircraftThrust,
  GRAVITY,
} from "./aerodynamics";
import { aircraftDesign, massProperties } from "../aircraft/aircraft-design";
import type { Loading } from "../aircraft/aircraft-design";
import { consumeTankFuel } from "./fuel-loading";
import { advanceOrientation, integrateAngularVelocity } from "./rigid-body";
import { solveTrim } from "./flight-trim";
import { aircraftWheels, airframeProbes, wheelPose, wheelSupportPoint } from "./airframe-contact";
import type { ContactPart } from "./airframe-contact";
import {
  applyContactImpulse,
  inverseContactMass,
  pointVelocity,
  solveWheelContacts,
  resolveWheelPenetration,
} from "./wheel-contact";
import type { ContactBody, WheelContact } from "./wheel-contact";
import { sweepAirframe } from "./collision";
import { hasSpeedBrake, islandEnvelope, islandSpeedProtection } from "./flight-envelope";
import {
  peregrineWheels,
  aureliaWheels,
  finchWheels,
  gearContactHeight,
} from "../aircraft/landing-gear";
export type Controls = {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  brake: boolean;
};
export type Damage = {
  gear: number;
  wing: number;
  engine: number;
  propeller: number;
};
export type FlightEvent = {
  type: "landing" | "impact" | "crash" | "takeoff";
  severity: number;
  runway?: string;
  sink?: number;
  accuracy?: number;
  part?: ContactPart;
  point?: number[];
  normal?: number[];
  impulse?: number;
  tick?: number;
};
const CLOSED_THROTTLE = 0.05;
const GO_AROUND_THROTTLE = 0.7;

export class FlightPhysics {
  aircraftId: AircraftId = "finch";
  get jet() {
    return this.design.propulsion.kind === "jet";
  }
  get hasFlaps() {
    return this.aircraftId !== "finch";
  }
  get profile() {
    return flightProfiles[this.aircraftId];
  }
  private contactHeight() {
    if (this.aircraftId === "stormbird") return this.stormbirdContact().height;
    if (this.aircraftId === "f15c") {
      return Math.max(...aircraftWheels.f15c.map((_, index) => {
        const point = wheelSupportPoint("f15c", index, this.gearPosition, new Vector3(this.position.x, 0, this.position.z), this.quaternion);
        return groundAt(point.x, point.z).height - point.y;
      }));
    }
    const extended = gearContactHeight(
      this.position,
      this.quaternion,
      aircraftWheels[this.aircraftId],
    );
    if (!this.jet) return extended;
    // Conservative fuselage support for the two legacy jet rigs. Stormbird
    // above uses its authored articulated tire profiles and measured body hull.
    const belly = groundAt(this.position.x, this.position.z).height + 0.8;
    return MathUtils.lerp(
      belly,
      extended,
      MathUtils.smoothstep(this.gearPosition, 0.03, 0.98),
    );
  }
  private stormbirdContact() {
    return stormbirdContact(
      this.position,
      this.quaternion,
      this.gearPosition,
      this.suspension,
      this.gearSteering,
    );
  }
  get gearCommand() {
    if (!this.jet) return true;
    if (!this.automaticConfiguration) return this.manualGearTarget >= 0.5;
    return this.automaticGearTarget;
  }
  private automaticGearTarget = true;
  /** The throttle was closed in flight. Stays set through the rollout until a go-around. */
  slowingToLand = false;
  automaticConfiguration = true;
  private manualGearTarget = 1;
  private manualFlapTarget = 0;
  setAutomaticConfiguration(enabled: boolean) {
    if (enabled === this.automaticConfiguration) return;
    // Holding the current actuator position avoids a jump or surprise command
    // when changing to manual halfway through a deployment.
    this.manualGearTarget = this.gearPosition;
    this.manualFlapTarget = this.flapPosition;
    this.automaticConfiguration = enabled;
  }
  get gearTarget() {
    if (!this.jet) return 1;
    return this.automaticConfiguration
      ? this.gearCommand
        ? 1
        : 0
      : this.manualGearTarget;
  }
  get flapCommand() {
    return this.hasFlaps
      ? this.automaticConfiguration
        ? this.automaticGearTarget
          ? this.slowingToLand ? this.landingFlaps : this.aircraftId === "heron" ? 0.5 : 0.65
          : 0
        : this.manualFlapTarget
      : 0;
  }
  // Flaps come out as the aircraft slows, so they don't balloon it at high speed.
  private get landingFlaps() {
    const clean = this.profile.stallSpeed;
    return MathUtils.clamp((clean * 2.4 - this.airspeed) / (clean * 0.6), 0, 1);
  }
  toggleGear() {
    if (!this.jet || this.automaticConfiguration) return false;
    // A squat switch blocks retraction with weight on the wheels.
    if (this.grounded && this.manualGearTarget > 0.5) return false;
    this.manualGearTarget = this.manualGearTarget > 0.5 ? 0 : 1;
    return true;
  }
  cycleFlaps() {
    if (!this.hasFlaps || this.automaticConfiguration) return false;
    const current = this.manualFlapTarget;
    this.manualFlapTarget = current < 0.3 ? 0.65 : current < 0.85 ? 1 : 0;
    return true;
  }
  gearPosition = 1;
  airbrakePosition = 0;
  liftDumpPosition = 0;
  gearSteering = 0;
  position = new Vector3();
  velocity = new Vector3();
  quaternion = new Quaternion();
  private attitude = new Euler(0, 0, 0, "YXZ");
  private attitudeDirty = false;
  get pitch() {
    return this.attitude.x;
  }
  set pitch(value: number) {
    this.attitude.x = value;
    this.attitudeDirty = true;
  }
  get roll() {
    return this.attitude.z;
  }
  set roll(value: number) {
    this.attitude.z = value;
    this.attitudeDirty = true;
  }
  get yaw() {
    return this.attitude.y;
  }
  set yaw(value: number) {
    this.attitude.y = value;
    this.attitudeDirty = true;
  }
  throttle = 0;
  enginePower = 0;
  airspeed = 0;
  grounded = true;
  crashed = false;
  stall = false;
  damage: Damage = { gear: 0, wing: 0, engine: 0, propeller: 0 };
  wingDamage = { left: 0, right: 0 };
  detachedWings = { left: false, right: false };
  wheelContacts: WheelContact[] = [];
  simulationTick = 0;
  speedProtectionActive = false;
  private contactCooldown = new Map<ContactPart, number>();
  private probes = airframeProbes("finch");
  wind = new Vector3(1.8, 0, 0.7);
  windOverride: Vector3 | null = null;
  verticalSpeed = 0;
  distance = 0;
  flightTime = 0;
  airborneTime = 0;
  lastImpact = 0;
  suspension = 0;
  events: FlightEvent[] = [];
  strongWind = false;
  engineOut = false;
  beginnerAssist = true;
  get design() {
    return aircraftDesign(this.aircraftId);
  }
  private loading: Loading = aircraftDesign("finch").defaultLoading;
  private loadingAircraft: AircraftId = "finch";
  massProperties = massProperties(
    aircraftDesign("finch").massBudget,
    aircraftDesign("finch").defaultLoading,
  );
  private tankFuelKg = { ...this.massProperties.fuelByTank };
  private massOverride: number | null = null;
  get loadedMass() {
    return this.massOverride ?? this.massProperties.mass;
  }
  set loadedMass(value: number) {
    if (!Number.isFinite(value) || value <= 0)
      throw new RangeError("Mass must be positive and finite.");
    this.massOverride = value;
  }
  installedThrust = 0;
  fuelKg = this.massProperties.fuelKg;
  private fuelUpdateTime = 0;
  configureLoading(loading: Loading) {
    const balance = massProperties(this.design.massBudget, loading);
    const [forward, aft] = this.design.cgEnvelope;
    if (balance.cg.z < forward || balance.cg.z > aft)
      throw new RangeError("Loading is outside the declared CG envelope.");
    this.massProperties = balance;
    this.fuelUpdateTime = 0;
    this.loading = {
      ...loading,
      tanks: loading.tanks ? { ...loading.tanks } : undefined,
    };
    this.loadingAircraft = this.aircraftId;
    this.tankFuelKg = { ...balance.fuelByTank };
    this.massOverride = null;
    this.fuelKg = balance.fuelKg;
  }
  /** Tanks back to the configured load, for a stop at the ramp. */
  refuel() {
    this.configureLoading(this.loading);
  }
  get stallSpeed() {
    return aircraftStallSpeed(
      this.design,
      this.loadedMass,
      airDensity(this.position.y),
      this.flapPosition,
    );
  }
  angularVelocity = new Vector3();
  surfaces = { pitch: 0, roll: 0, yaw: 0 };
  flapPosition = 0;
  elevatorTrim = 0;
  rollTrim = 0;
  yawTrim = 0;
  aerodynamics: ReturnType<typeof aircraftAerodynamics> | null = null;
  private groundTime = 0;
  private announcedAirborne = false;
  private recordLanding(
    sink: number,
    severity: number,
    point: Vector3,
    part: ContactPart = "gear",
  ) {
    const ground = groundAt(point.x, point.z),
      runway = ground.runway;
    const accuracy = runway
      ? Math.max(
          0,
          1 -
            Math.abs(
              (this.position.x - runway.x) * Math.cos(runway.heading) -
                (this.position.z - runway.z) * Math.sin(runway.heading),
            ) /
              (runway.width / 2),
        )
      : 0;
    this.events.push({
      type: "landing",
      severity,
      runway: runway?.name,
      sink,
      accuracy,
      part,
      tick: this.simulationTick,
    });
  }
  reset(airStart = false, short = false, runway?: (typeof runways)[number]) {
    this.configureLoading(
      this.loadingAircraft === this.aircraftId
        ? this.loading
        : this.design.defaultLoading,
    );
    this.fuelUpdateTime = 0;
    this.installedThrust = 0;
    const r = runway ?? (short ? runways[1] : runways[0]);
    // Palm Bay departs toward open water. Air starts keep the landing approach.
    const direction = airStart ? 1 : r.departureDirection;
    this.yaw = r.heading + (direction < 0 ? Math.PI : 0);
    this.pitch = airStart ? -0.015 : 0;
    this.roll = 0;
    const spawnDistance = airStart ? 570 : r.length / 2 - 36;
    this.position.set(
      r.x + Math.sin(r.heading) * spawnDistance * direction,
      r.y + (airStart ? 73 : 0),
      r.z + Math.cos(r.heading) * spawnDistance * direction,
    );
    this.velocity.set(0, 0, 0);
    this.wind.copy(
      this.windOverride ?? new Vector3(this.strongWind ? 8 : 0.65, 0, 0.5),
    );
    this.airspeed = this.wind.length();
    this.verticalSpeed = 0;
    this.throttle = airStart ? 0.46 : 0;
    this.enginePower = this.throttle;
    this.grounded = !airStart;
    this.crashed = false;
    this.stall = false;
    this.aerodynamics = null;
    this.damage = { gear: 0, wing: 0, engine: 0, propeller: 0 };
    this.wingDamage = { left: 0, right: 0 };
    this.detachedWings = { left: false, right: false };
    this.wheelContacts = [];
    this.contactCooldown.clear();
    this.simulationTick = 0;
    this.speedProtectionActive = false;
    this.probes = airframeProbes(this.aircraftId);
    this.distance = 0;
    this.flightTime = 0;
    this.airborneTime = airStart ? 5 : 0;
    this.groundTime = 0;
    this.announcedAirborne = airStart;
    this.angularVelocity.set(0, 0, 0);
    this.surfaces = { pitch: 0, roll: 0, yaw: 0 };
    this.flapPosition = this.hasFlaps && !airStart ? this.aircraftId === "heron" ? 0.5 : 0.65 : 0;
    this.lastImpact = 0;
    this.events = [];
    this.engineOut = false;
    this.suspension = 0;
    this.gearPosition = this.jet && airStart ? 0 : 1;
    this.airbrakePosition = 0;
    this.liftDumpPosition = 0;
    this.automaticGearTarget = this.gearPosition > 0.5;
    this.slowingToLand = false;
    this.gearSteering = 0;
    this.manualGearTarget = this.gearPosition;
    this.manualFlapTarget = this.flapPosition;
    this.elevatorTrim = this.rollTrim = this.yawTrim = 0;
    if (airStart) {
      this.initializeAirStart(
        Math.max(this.design.trimSpeed, this.stallSpeed * 1.4),
      );
    }
    this.updateQuaternion();
    if (!airStart) this.position.y = this.contactHeight();
  }
  initializeAirStart(speed: number) {
    const trim = solveTrim(
      this.design,
      this.massProperties,
      speed,
      this.position.y,
      this.jet ? this.gearPosition : 1,
      this.flapPosition,
    );
    this.pitch = trim.alpha;
    this.roll = trim.bank;
    this.rollTrim = trim.roll;
    this.yawTrim = trim.yaw;
    this.elevatorTrim = trim.pitch;
    this.surfaces = { pitch: trim.pitch, roll: trim.roll, yaw: trim.yaw };
    this.angularVelocity.set(0, 0, 0);
    this.throttle = this.enginePower = trim.throttle;
    this.velocity
      .set(-Math.sin(this.yaw) * speed, 0, -Math.cos(this.yaw) * speed)
      .add(this.wind);
    this.airspeed = speed;
    this.updateQuaternion();
    return trim;
  }
  updateQuaternion() {
    this.quaternion.setFromEuler(this.attitude);
    this.attitudeDirty = false;
  }
  get health() {
    return Math.max(
      0,
      100 -
        (this.damage.gear * 0.18 +
          this.damage.wing * 0.36 +
          this.damage.engine * 0.24 +
          this.damage.propeller * 0.22) *
          100,
    );
  }
  impact(
    severity: number,
    part: keyof Damage = "gear",
    contact?: Omit<FlightEvent, "type" | "severity">,
  ) {
    const contactPart = contact?.part ?? (part === "wing" ? "body" : part);
    if (
      (this.contactCooldown.get(contactPart) ?? 0) > this.flightTime ||
      this.crashed
    )
      return;
    this.contactCooldown.set(contactPart, this.flightTime + 0.7);
    if (part === "gear" && severity < 0.85) severity *= this.profile.gearDamage;
    this.damage[part] = MathUtils.clamp(this.damage[part] + severity, 0, 1);
    if (part === "wing") {
      if (severity > 0.8 && contactPart === "leftWing")
        this.detachedWings.left = true;
      if (severity > 0.8 && contactPart === "rightWing")
        this.detachedWings.right = true;
      if (contactPart === "leftWing")
        this.wingDamage.left = Math.min(1, this.wingDamage.left + severity);
      else if (contactPart === "rightWing")
        this.wingDamage.right = Math.min(1, this.wingDamage.right + severity);
      else this.wingDamage.left = this.wingDamage.right = this.damage.wing;
      // Keep the existing HUD/score contract; aerodynamics retains each side.
      this.damage.wing = Math.max(this.wingDamage.left, this.wingDamage.right);
    }
    this.lastImpact = 0.7;
    if (part === "gear") {
      this.damage.propeller = Math.min(
        1,
        this.damage.propeller + Math.max(0, severity - 0.4) * 0.8,
      );
      this.damage.engine = Math.min(
        1,
        this.damage.engine + Math.max(0, severity - 0.5) * 0.4,
      );
    }
    if (severity > 0.85 || this.damage.wing > 0.9) {
      this.crashed = true;
      this.damage.engine = 1;
      this.throttle = 0;
      this.events.push({
        type: "crash",
        severity,
        tick: this.simulationTick,
        ...contact,
      });
    } else
      this.events.push({
        type: "impact",
        severity,
        tick: this.simulationTick,
        ...contact,
      });
  }
  step(dt: number, input: Controls, obstacles: CollisionObstacles = []) {
    this.events = [];
    if (!Number.isFinite(dt) || dt < 0)
      throw new RangeError("Time step must be finite and nonnegative.");
    const steps = Math.ceil(dt * 120);
    for (let i = 0; i < steps; i++)
      this.integrateStep(dt / steps, input, obstacles);
  }
  private integrateStep(dt: number, input: Controls, obstacles: CollisionObstacles) {
    this.simulationTick++;
    this.flightTime += dt;
    this.lastImpact = Math.max(0, this.lastImpact - dt);
    this.throttle = MathUtils.clamp(
      this.throttle + input.throttle * dt * 0.4,
      0,
      1,
    );
    this.enginePower = MathUtils.damp(
      this.enginePower,
      this.engineOut || this.crashed || this.fuelKg <= 0 ? 0 : this.throttle,
      this.profile.engineResponse,
      dt,
    );
    if (this.attitudeDirty) this.updateQuaternion();
    resolveWheelPenetration(
      this.position,
      this.quaternion,
      this.aircraftId,
      this.jet ? this.gearPosition : 1,
    );
    const prev = this.position.clone();
    const gust = this.strongWind ? 7 : 1.5;
    this.wind.set(
      (this.strongWind ? 8 : 0.65) +
        Math.sin(this.flightTime * 0.65) * gust * 0.28,
      Math.sin(this.flightTime * 1.4) * gust * 0.06,
      0.5 + Math.sin(this.flightTime * 0.37) * gust * 0.2,
    );
    if (this.windOverride) this.wind.copy(this.windOverride);
    const air = this.velocity.clone().sub(this.wind);
    const speed = air.length();
    this.airspeed = speed;
    // Engine-out glides stay clean so they keep their range.
    if (this.engineOut || this.crashed || this.fuelKg <= 0 || this.throttle > GO_AROUND_THROTTLE)
      this.slowingToLand = false;
    else if (!this.grounded && this.throttle <= CLOSED_THROTTLE)
      this.slowingToLand = true;
    if (this.hasFlaps) {
      if (this.automaticConfiguration) {
        const agl =
          this.position.y - groundHeight(this.position.x, this.position.z);
        if (this.slowingToLand || this.grounded || agl < 35 || speed < this.stallSpeed * 1.5)
          this.automaticGearTarget = true;
        else if (agl > 60 && speed > this.stallSpeed * 1.65)
          this.automaticGearTarget = false;
      }
      const seconds =
        this.aircraftId === "stormbird" ? STORMBIRD_GEAR_SECONDS : 2.5;
      this.gearPosition += MathUtils.clamp(
        this.gearTarget - this.gearPosition,
        -dt / seconds,
        dt / seconds,
      );
      this.flapPosition = MathUtils.damp(
        this.flapPosition,
        this.flapCommand,
        2,
        dt,
      );
      this.gearSteering = MathUtils.damp(
        this.gearSteering,
        -MathUtils.clamp(input.yaw + input.roll * 0.6, -1, 1),
        7,
        dt,
      );
    }
    if (!this.hasFlaps)
      this.gearSteering = MathUtils.damp(
        this.gearSteering,
        -MathUtils.clamp(input.yaw + input.roll * 0.6, -1, 1),
        7,
        dt,
      );
    const tanks = this.design.fuel.tanks;
    const storedFuel = Object.values(this.tankFuelKg).reduce(
      (sum, kg) => sum + kg,
      0,
    );
    // Preserve the existing public fuel cutoff control, including test/engine-out scenarios.
    if (this.fuelKg < storedFuel) {
      this.tankFuelKg = consumeTankFuel(
        tanks,
        this.tankFuelKg,
        storedFuel - Math.max(0, this.fuelKg),
      );
    }
    if (!this.engineOut && !this.crashed) {
      const burn =
        this.design.propulsion.fuelRate *
        this.enginePower *
        (1 +
          MathUtils.smoothstep(this.enginePower, 0.88, 1) *
            (this.profile.afterburner ? 1 : 0)) *
        dt;
      this.tankFuelKg = consumeTankFuel(tanks, this.tankFuelKg, burn);
    }
    this.fuelKg = Object.values(this.tankFuelKg).reduce(
      (sum, kg) => sum + kg,
      0,
    );
    this.fuelUpdateTime += dt;
    if (
      this.fuelUpdateTime >= 0.25 ||
      (this.fuelKg === 0 && this.massProperties.fuelKg > 0)
    ) {
      const fractions = Object.fromEntries(
        tanks.map((t) => [
          t.id,
          this.tankFuelKg[t.id] / (t.usableLitres * t.densityKgPerLitre),
        ]),
      );
      this.massProperties = massProperties(this.design.massBudget, {
        ...this.loading,
        tanks: fractions,
      });
      this.fuelUpdateTime = 0;
    }
    this.verticalSpeed = this.velocity.y;
    if (this.attitudeDirty) this.updateQuaternion();
    this.airbrakePosition = hasSpeedBrake(this.aircraftId)
      ? MathUtils.damp(this.airbrakePosition, input.brake ? 1 : 0, 3, dt)
      : 0;
    // Braking on the wheels spoils the wing, so the weight lands on the brakes.
    this.liftDumpPosition = MathUtils.damp(
      this.liftDumpPosition,
      this.grounded && input.brake ? 1 : 0,
      6,
      dt,
    );
    const design = this.design,
      balance = this.massProperties;
    const config = {
      gear: this.jet ? this.gearPosition : 1,
      flap: this.flapPosition,
      wingDamage: this.damage.wing,
      gearDamage: this.damage.gear,
      airbrake: this.airbrakePosition,
      liftDump: this.liftDumpPosition,
      leftWingDamage:
        this.wingDamage.left ||
        (this.wingDamage.right === 0 ? this.damage.wing : 0),
      rightWingDamage:
        this.wingDamage.right ||
        (this.wingDamage.left === 0 ? this.damage.wing : 0),
      leftWingDetached: this.detachedWings.left,
      rightWingDetached: this.detachedWings.right,
    };
    const baseAero = aircraftAerodynamics(
      design,
      this.velocity,
      this.wind,
      this.quaternion,
      this.position.y,
      balance.cg,
      this.angularVelocity,
      undefined,
      config,
    );
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    const protection = islandSpeedProtection(this.aircraftId, baseAero.mach);
    this.speedProtectionActive = protection.active;
    const thrust =
      this.engineOut || this.crashed || this.fuelKg <= 0
        ? 0
        : aircraftThrust(design, speed, this.enginePower, baseAero.density) *
          protection.thrustScale *
          (1 - this.damage.engine * 0.85) *
          (this.jet ? 1 : 1 - this.damage.propeller * 0.8);
    this.installedThrust = thrust;
    const thrustMoment = new Vector3()
      .fromArray(design.propulsion.thrustCenter)
      .sub(balance.cg)
      .cross(new Vector3(0, 0, -thrust));
    const wheels = aircraftWheels[this.aircraftId];
    const mainGearZ = Math.max(...wheels.map((w) => w.center.z));
    const normalLoad = this.grounded
      ? Math.max(
          0,
          this.loadedMass * GRAVITY - baseAero.force.y - forward.y * thrust,
        )
      : 0;
    const mainWheels = wheels.filter(
      (w) => Math.abs(w.center.z - mainGearZ) < 0.01,
    );
    const mainPoint = new Vector3(
      0,
      mainWheels.reduce((sum, w) => sum + w.center.y - w.major - w.minor, 0) /
        mainWheels.length,
      mainGearZ,
    );
    const groundMoment = mainPoint
      .sub(balance.cg)
      .cross(
        new Vector3(0, normalLoad, 0).applyQuaternion(
          this.quaternion.clone().invert(),
        ),
      );
    // Once the nose wheel supports the aircraft, reactions balance across the
    // gear. A main-gear-only estimate would falsely command nose-up elevator.
    if (
      this.grounded &&
      input.pitch <= 0 &&
      this.wheelContacts.some(
        (c) => wheels[c.index].center.z < -1 && c.load > 0,
      )
    )
      groundMoment.set(0, 0, 0);
    let command = {
      pitch: MathUtils.clamp(input.pitch + this.elevatorTrim, -1, 1),
      roll: MathUtils.clamp(input.roll + this.rollTrim, -1, 1),
      yaw: MathUtils.clamp(input.yaw + this.yawTrim, -1, 1),
    };
    if (this.beginnerAssist && !this.crashed) {
      const flightPath = Math.atan2(air.y, Math.hypot(air.x, air.z));
      const requiredCL =
        (this.loadedMass * GRAVITY) /
        (Math.max(1, baseAero.dynamicPressure * design.geometry.wingArea) *
          Math.max(0.3, Math.cos(this.roll)));
      const targetAlpha = MathUtils.clamp(
        (requiredCL -
          design.aerodynamics.cl0 -
          design.aerodynamics.flapLift * this.flapPosition) /
          design.aerodynamics.liftSlope,
        -0.04,
        baseAero.positiveStall * 0.82,
      );
      let pitchRate = input.pitch * this.profile.pitchRate;
      if (!input.pitch && this.grounded) pitchRate = -this.pitch * 1.5;
      if (!input.pitch && !this.grounded)
        pitchRate = (flightPath + targetAlpha - this.pitch) * 0.9;
      if (input.pitch > 0) {
        const rotation = this.stallSpeed * 1.2;
        const limit = this.grounded
          ? speed < rotation
            ? 0.05
            : 0.21
          : Math.min(
              design.assistClimbPitch,
              flightPath + baseAero.positiveStall * 0.82,
            );
        pitchRate = Math.min(pitchRate, (limit - this.pitch) * 3);
        if (
          this.position.y - groundHeight(this.position.x, this.position.z) <
          15
        ) {
          // Assistance commands elevator authority to protect tail clearance.
          // Manual flying uses the same contacts and can still strike the tail.
          for (const probe of this.probes) {
            if (
              probe.center.z < 2 ||
              probe.part === "leftWing" ||
              probe.part === "rightWing"
            )
              continue;
            const lever = new Vector3(1, 0, 0)
              .cross(probe.center.clone().sub(balance.cg))
              .applyQuaternion(this.quaternion).y;
            if (lever >= -0.1) continue;
            const world = probe.center
              .clone()
              .applyQuaternion(this.quaternion)
              .add(this.position);
            const clearance =
              world.y - probe.radius - groundHeight(world.x, world.z);
            pitchRate = Math.min(
              pitchRate,
              Math.max(
                -0.2,
                ((clearance - 0.06) / 0.45 + this.velocity.y) / -lever,
              ),
            );
          }
        }
      }
      const rollRate = input.roll
        ? -input.roll * this.profile.rollRate
        : -this.roll * this.profile.bankRecovery;
      const yawRate = !this.grounded
        ? (Math.tan(this.roll) * GRAVITY) / Math.max(speed, 19) -
          input.yaw * this.profile.rudderRate
        : 0;
      const desiredRate = new Vector3(pitchRate, yawRate, rollRate);
      const desiredAcceleration = desiredRate
        .sub(this.angularVelocity)
        .multiplyScalar(4);
      const requiredMoment = desiredAcceleration
        .applyMatrix3(balance.inertia)
        .add(
          this.angularVelocity
            .clone()
            .cross(this.angularVelocity.clone().applyMatrix3(balance.inertia)),
        )
        .sub(baseAero.moment)
        .sub(thrustMoment)
        .sub(groundMoment);
      const qS = baseAero.dynamicPressure * design.geometry.wingArea;
      if (qS > 1)
        command = {
          pitch: MathUtils.clamp(
            requiredMoment.x /
              (qS *
                design.geometry.meanAerodynamicChord *
                design.moments.elevator),
            -1,
            1,
          ),
          roll: MathUtils.clamp(
            -requiredMoment.z /
              (qS * design.geometry.span * design.moments.aileron),
            -1,
            1,
          ),
          yaw: MathUtils.clamp(
            -requiredMoment.y /
              (qS * design.geometry.span * design.moments.rudder),
            -1,
            1,
          ),
        };
    }
    if (this.crashed) command = { pitch: 0, roll: 0, yaw: 0 };
    for (const axis of ["pitch", "roll", "yaw"] as const)
      this.surfaces[axis] += MathUtils.clamp(
        command[axis] - this.surfaces[axis],
        -dt * 3,
        dt * 3,
      );
    const aero = aircraftAerodynamics(
      design,
      this.velocity,
      this.wind,
      this.quaternion,
      this.position.y,
      balance.cg,
      this.angularVelocity,
      this.surfaces,
      config,
    );
    this.aerodynamics = aero;
    this.stall = !this.grounded && speed > 1 && aero.stalled;
    const moment = aero.moment.clone().add(thrustMoment);
    const inertia = balance.inertia
      .clone()
      .multiplyScalar(this.loadedMass / balance.mass);
    const inverseInertia = inertia.clone().invert();
    const body: ContactBody = {
      position: this.position,
      quaternion: this.quaternion,
      velocity: this.velocity,
      angularVelocity: this.angularVelocity,
      mass: this.loadedMass,
      cg: balance.cg,
      inverseInertia,
    };
    integrateAngularVelocity(
      this.angularVelocity,
      moment,
      inertia,
      inverseInertia,
      dt,
    );
    const accel = new Vector3(0, -GRAVITY, 0)
      .addScaledVector(aero.force, 1 / this.loadedMass)
      .addScaledVector(forward, thrust / this.loadedMass)
      .addScaledVector(
        aero.direction,
        (-aero.dynamicPressure *
          design.geometry.wingArea *
          protection.dragCoefficient) /
          this.loadedMass,
      );
    this.velocity.addScaledVector(accel, dt);
    const wasGrounded = this.grounded;
    this.wheelContacts = solveWheelContacts(
      body,
      this.aircraftId,
      this.jet ? this.gearPosition : 1,
      this.gearSteering,
      input.brake,
      this.damage.gear,
      dt,
    );
    const supported = this.wheelContacts.filter(
      (c) => c.load > this.loadedMass * GRAVITY * 0.003,
    );
    this.grounded = supported.length > 0;
    if (this.grounded) {
      this.announcedAirborne = false;
      const sink = Math.max(...supported.map((c) => c.closingSpeed));
      this.suspension = Math.min(
        0.16,
        Math.max(...supported.map((c) => c.compression)),
      );
      if (!wasGrounded && this.airborneTime > 1.2) {
        const landing = supported.reduce((a, b) => (a.load > b.load ? a : b));
        const point = landing.point
          .clone()
          .applyQuaternion(this.quaternion)
          .add(this.position);
        const ground = groundAt(point.x, point.z);
        const severity =
          Math.max(0, (sink - 2.7) / 9) * (ground.runway ? 1 : 1.25);
        if (!landing.locked)
          this.impact(Math.max(0.4, severity), "gear", { part: "gear" });
        else if (severity > 0.05)
          this.impact(severity, "gear", {
            part: "gear",
            point: point.toArray(),
            impulse: landing.load * dt,
          });
        this.recordLanding(sink, severity, point);
      }
      if (supported.some((c) => c.water))
        this.impact(1.2, "propeller", { part: "body" });
      this.groundTime += dt;
      this.airborneTime = 0;
    } else {
      if (
        !this.announcedAirborne &&
        !this.crashed &&
        this.airborneTime > 0.15 &&
        this.position.y > this.contactHeight() + 0.3
      ) {
        this.events.push({
          type: "takeoff",
          severity: 0,
          tick: this.simulationTick,
        });
        this.groundTime = 0;
        this.announcedAirborne = true;
      }
      this.airborneTime += dt;
      this.suspension = MathUtils.damp(this.suspension, 0, 7, dt);
    }
    // Advance to the earliest structural hit, apply a COM impulse and continue
    // the remaining time. Four contacts bound work for a multi-part crash.
    const collisionProbes = [
      ...this.probes.filter(
        (p) =>
          !(p.part === "leftWing" && this.detachedWings.left) &&
          !(p.part === "rightWing" && this.detachedWings.right),
      ),
      ...wheels.map((_, index) => {
        const pose = wheelPose(this.aircraftId, index, this.gearPosition);
        return {
          center: pose.center,
          radius: pose.radius,
          part: "gear" as const,
          terrain: false,
        };
      }),
    ];
    let remaining = dt;
    for (let iteration = 0; iteration < 4 && remaining > 1e-6; iteration++) {
      const start = this.position.clone(),
        startQ = this.quaternion.clone();
      const com = start.clone().add(balance.cg.clone().applyQuaternion(startQ));
      const nextQ = startQ.clone();
      advanceOrientation(nextQ, this.angularVelocity, remaining);
      const next = com
        .clone()
        .addScaledVector(this.velocity, remaining)
        .sub(balance.cg.clone().applyQuaternion(nextQ));
      const hit = sweepAirframe(
        start,
        startQ,
        next,
        nextQ,
        collisionProbes,
        obstacles,
      );
      if (!hit) {
        this.position.copy(next);
        this.quaternion.copy(nextQ);
        break;
      }
      this.quaternion.copy(startQ).slerp(nextQ, hit.fraction);
      this.position
        .copy(com)
        .addScaledVector(this.velocity, remaining * hit.fraction)
        .sub(balance.cg.clone().applyQuaternion(this.quaternion));
      const point = hit.point
        .clone()
        .sub(this.position)
        .applyQuaternion(this.quaternion.clone().invert());
      const contactVelocity = pointVelocity(body, point);
      const closing = Math.max(0, -contactVelocity.dot(hit.normal));
      const impulse =
        (closing * 1.08) / inverseContactMass(body, point, hit.normal);
      applyContactImpulse(
        body,
        point,
        hit.normal.clone().multiplyScalar(impulse),
      );
      const tangent = pointVelocity(body, point).addScaledVector(
        hit.normal,
        -pointVelocity(body, point).dot(hit.normal),
      );
      if (tangent.lengthSq() > 1e-8) {
        const direction = tangent.clone().normalize();
        const friction = Math.min(
          impulse * 0.45,
          tangent.length() / inverseContactMass(body, point, direction),
        );
        applyContactImpulse(body, point, direction.multiplyScalar(-friction));
      }
      // Numerical overlap correction follows the struck surface normal only.
      // It never levels the airplane or erases angular/lateral velocity.
      let correction = 0.003 + (hit.obstacle ? (hit.penetration ?? 0) : 0);
      if (!hit.obstacle) {
        if (!this.grounded && !wasGrounded && this.airborneTime > 1.2) {
          this.recordLanding(
            closing,
            Math.max(0, (closing - 0.75) / 12),
            hit.point,
            hit.probe.part,
          );
          this.airborneTime = 0;
          this.announcedAirborne = false;
        }
        const center = hit.probe.center
          .clone()
          .applyQuaternion(this.quaternion)
          .add(this.position);
        correction += Math.max(
          0,
          groundAt(center.x, center.z).height + hit.probe.radius - center.y,
        );
        this.grounded = true;
      }
      this.position.addScaledVector(hit.normal, Math.min(0.3, correction));
      if (closing > 0.75) {
        const part = hit.probe.part;
        const damagePart =
          part === "engine" || part === "propeller" || part === "gear"
            ? part
            : "wing";
        const severity = Math.max(
          0.08,
          (closing - 0.75) / (hit.obstacle ? 22 : 12),
        );
        this.impact(severity, damagePart, {
          part,
          point: hit.point.toArray(),
          normal: hit.normal.toArray(),
          impulse,
        });
      }
      if (groundAt(hit.point.x, hit.point.z).water && !hit.obstacle)
        this.impact(1.2, "propeller", { part: "body" });
      remaining *= 1 - hit.fraction;
    }
    resolveWheelPenetration(
      this.position,
      this.quaternion,
      this.aircraftId,
      this.jet ? this.gearPosition : 1,
    );
    this.attitude.setFromQuaternion(this.quaternion, "YXZ");
    this.attitudeDirty = false;
    this.verticalSpeed = this.velocity.y;
    this.distance += this.position.distanceTo(prev);
    const ceiling = islandEnvelope[this.aircraftId].maximumAltitude;
    if (this.position.y > ceiling) {
      this.position.y = ceiling;
      this.velocity.y = Math.min(0, this.velocity.y);
    }
  }
}
