import { Vector3, Quaternion, Euler, MathUtils } from "three";
import { groundAt, runways, terrainHeight } from "./terrain";
import type { Obstacle } from "./world";
import { gearContactHeight } from "./landing-gear";
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
};
export class FlightPhysics {
  position = new Vector3();
  velocity = new Vector3();
  quaternion = new Quaternion();
  pitch = 0;
  roll = 0;
  yaw = 0;
  throttle = 0;
  airspeed = 0;
  grounded = true;
  crashed = false;
  stall = false;
  damage: Damage = { gear: 0, wing: 0, engine: 0, propeller: 0 };
  wind = new Vector3(1.8, 0, 0.7);
  verticalSpeed = 0;
  distance = 0;
  flightTime = 0;
  airborneTime = 0;
  lastImpact = 0;
  suspension = 0;
  events: FlightEvent[] = [];
  strongWind = false;
  engineOut = false;
  private groundTime = 0;
  private pitchRate = 0;
  private rollRate = 0;
  reset(airStart = false, short = false) {
    const r = short ? runways[1] : runways[0];
    this.yaw = r.heading;
    this.pitch = airStart ? -0.015 : 0;
    this.roll = 0;
    const spawnDistance = airStart ? 570 : r.length / 2 - 36;
    this.position.set(
      r.x + Math.sin(r.heading) * spawnDistance,
      r.y + (airStart ? 73 : 0),
      r.z + Math.cos(r.heading) * spawnDistance,
    );
    this.velocity.set(
      -Math.sin(this.yaw) * (airStart ? 34 : 0),
      airStart ? -1 : 0,
      -Math.cos(this.yaw) * (airStart ? 34 : 0),
    );
    this.throttle = airStart ? 0.46 : 0;
    this.grounded = !airStart;
    this.crashed = false;
    this.stall = false;
    this.damage = { gear: 0, wing: 0, engine: 0, propeller: 0 };
    this.distance = 0;
    this.flightTime = 0;
    this.airborneTime = airStart ? 5 : 0;
    this.groundTime = 0;
    this.pitchRate = 0;
    this.rollRate = 0;
    this.lastImpact = 0;
    this.events = [];
    this.engineOut = false;
    this.suspension = 0;
    this.updateQuaternion();
    if (!airStart)
      this.position.y = gearContactHeight(this.position, this.quaternion);
  }
  updateQuaternion() {
    this.quaternion.setFromEuler(
      new Euler(this.pitch, this.yaw, this.roll, "YXZ"),
    );
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
  impact(severity: number, part: keyof Damage = "gear") {
    if (this.lastImpact > 0.15 || this.crashed) return;
    this.damage[part] = MathUtils.clamp(this.damage[part] + severity, 0, 1);
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
      this.events.push({ type: "crash", severity });
    } else this.events.push({ type: "impact", severity });
  }
  step(dt: number, input: Controls, obstacles: Obstacle[] = []) {
    this.events = [];
    this.flightTime += dt;
    this.lastImpact = Math.max(0, this.lastImpact - dt);
    this.throttle = MathUtils.clamp(
      this.throttle + input.throttle * dt * 0.4,
      0,
      1,
    );
    const prev = this.position.clone();
    const surface = groundAt(this.position.x, this.position.z);
    const gust = this.strongWind ? 7 : 1.5;
    this.wind.set(
      (this.strongWind ? 8 : 0.65) +
        Math.sin(this.flightTime * 0.65) * gust * 0.28,
      Math.sin(this.flightTime * 1.4) * gust * 0.06,
      0.5 + Math.sin(this.flightTime * 0.37) * gust * 0.2,
    );
    const air = this.velocity.clone().sub(this.wind);
    const speed = air.length();
    this.airspeed = speed;
    this.verticalSpeed = this.velocity.y;
    if (this.crashed) {
      this.velocity.y -= 9.81 * dt;
      this.velocity.multiplyScalar(Math.exp(-dt * (this.grounded ? 2 : 0.18)));
      this.position.addScaledVector(this.velocity, dt);
      this.roll += dt * 0.4 * Math.min(1, speed / 20);
      if (this.position.y < surface.height + 0.6) {
        this.position.y = surface.height + 0.6;
        this.velocity.y = Math.abs(this.velocity.y) * 0.2;
        this.grounded = true;
      }
      this.updateQuaternion();
      return;
    }
    const authority =
      MathUtils.clamp(speed / 24, 0.25, 1.2) * (1 - this.damage.wing * 0.55);
    const pitchTarget = input.pitch * 0.5 * authority;
    this.pitchRate = MathUtils.damp(this.pitchRate, pitchTarget, 5, dt);
    this.pitch += this.pitchRate * dt;
    if (!input.pitch && !this.grounded)
      this.pitch = MathUtils.damp(
        this.pitch,
        this.engineOut ? -0.065 : 0.025,
        0.24,
        dt,
      );
    this.pitch = MathUtils.clamp(this.pitch, -0.85, 1.05);
    this.rollRate = MathUtils.damp(
      this.rollRate,
      -input.roll * 1.2 * authority,
      4.5,
      dt,
    );
    this.roll += this.rollRate * dt;
    if (!input.roll)
      this.roll = MathUtils.damp(this.roll, 0, this.grounded ? 5 : 1.15, dt);
    this.roll = MathUtils.clamp(this.roll, -1.22, 1.22);
    if (this.grounded) {
      this.roll = MathUtils.damp(this.roll, 0, 9, dt);
      this.yaw -=
        (input.yaw * 0.6 + input.roll * 0.37) * dt * Math.min(1, speed / 8);
      this.pitch = MathUtils.clamp(this.pitch, -0.025, 0.23);
    } else {
      this.yaw +=
        ((Math.tan(this.roll) * 9.81) / Math.max(speed, 19) -
          input.yaw * 0.26) *
        dt;
      this.roll += this.damage.wing * 0.07 * dt;
      this.pitch += Math.sin(this.flightTime * 2.1) * gust * 0.00055;
    }
    this.updateQuaternion();
    const forward = new Vector3(0, 0, -1).applyQuaternion(this.quaternion);
    const right = new Vector3(1, 0, 0).applyQuaternion(this.quaternion);
    const dir = speed > 1 ? air.clone().divideScalar(speed) : forward.clone();
    const pathAngle = Math.asin(MathUtils.clamp(dir.y, -1, 1));
    const aoa = this.pitch - pathAngle;
    this.stall = !this.grounded && (speed < 17 || Math.abs(aoa) > 0.36);
    const stalledFactor =
      Math.abs(aoa) > 0.32
        ? Math.max(0.16, 1 - (Math.abs(aoa) - 0.32) * 2.4)
        : 1;
    const trim = 9.81 / (0.027 * Math.max(27, speed) ** 2);
    const cl = MathUtils.clamp(trim + aoa * 3.7, -0.75, 1.65) * stalledFactor;
    const lift = 0.027 * speed * speed * cl * (1 - this.damage.wing * 0.62);
    const drag =
      (0.0016 +
        0.0005 * cl * cl +
        this.damage.gear * 0.002 +
        this.damage.wing * 0.004 +
        (this.stall ? 0.007 : 0)) *
      speed *
      speed;
    const engine = this.engineOut
      ? 0
      : this.throttle *
        8.5 *
        (1 - Math.min(0.65, speed / 95)) *
        (1 - this.damage.engine * 0.85) *
        (1 - this.damage.propeller * 0.8);
    const liftDir = new Vector3().crossVectors(right, dir).normalize();
    const accel = new Vector3(0, -9.81, 0)
      .addScaledVector(liftDir, lift)
      .addScaledVector(forward, engine)
      .addScaledVector(dir, -drag);
    // Damped sideslip and coordinated turns keep banked flight readable for new pilots.
    const slip = air.dot(right);
    accel.addScaledVector(right, -slip * 1.8);
    if (this.stall) {
      this.pitch -= dt * 0.09;
      this.roll += Math.sin(this.flightTime * 5) * dt * 0.03;
    }
    if (this.grounded) {
      accel.y = Math.max(0, accel.y);
      const friction = input.brake ? 7 : surface.runway ? 0.7 : 2.5;
      const horizontal = new Vector3(this.velocity.x, 0, this.velocity.z);
      if (horizontal.length() > 0.05)
        accel.addScaledVector(
          horizontal.normalize(),
          -Math.min(friction, speed / Math.max(dt, 0.001)),
        );
    }
    this.velocity.addScaledVector(accel, dt);
    if (this.grounded) {
      const sideSpeed = this.velocity.dot(right);
      this.velocity.addScaledVector(right, -sideSpeed * Math.min(1, dt * 12));
    }
    this.position.addScaledVector(this.velocity, dt);
    const next = groundAt(this.position.x, this.position.z);
    const bottom = gearContactHeight(
      this.position,
      this.quaternion,
      this.damage.gear,
    );
    if (this.position.y <= bottom) {
      const slopeX =
        (terrainHeight(this.position.x + 2, this.position.z) -
          terrainHeight(this.position.x - 2, this.position.z)) /
        4;
      const slopeZ =
        (terrainHeight(this.position.x, this.position.z + 2) -
          terrainHeight(this.position.x, this.position.z - 2)) /
        4;
      const closingSpeed =
        Math.max(
          0,
          this.velocity.x * slopeX + this.velocity.z * slopeZ - this.velocity.y,
        ) / Math.sqrt(1 + slopeX * slopeX + slopeZ * slopeZ);
      const sink = Math.max(0, -this.velocity.y);
      const wasAirborne = !this.grounded;
      if (!next.runway && !next.water && closingSpeed > 9 && speed > 15)
        this.impact(Math.min(1.3, closingSpeed / 15), "wing");
      if (wasAirborne && this.airborneTime > 1.2) {
        const bank = Math.abs(this.roll),
          rough = next.runway ? 0 : 0.15;
        const severity = Math.max(0, (sink - 2.7) / 9) + bank * 0.6 + rough;
        if (next.water) {
          this.impact(1.1, "propeller");
        } else if (sink > 12 || bank > 0.95 || this.pitch < -0.3) {
          this.impact(1.1, "wing");
        } else if (severity > 0.05) {
          this.impact(severity, "gear");
        }
        this.suspension = Math.min(0.52, sink * 0.065);
        const accuracy = next.runway
          ? Math.max(
              0,
              1 -
                Math.abs(
                  (this.position.x - next.runway.x) *
                    Math.cos(next.runway.heading) -
                    (this.position.z - next.runway.z) *
                      Math.sin(next.runway.heading),
                ) /
                  (next.runway.width / 2),
            )
          : 0;
        this.events.push({
          type: "landing",
          severity,
          runway: next.runway?.name,
          sink,
          accuracy,
        });
      }
      this.position.y = bottom;
      this.velocity.y = 0;
      this.grounded = true;
      this.groundTime += dt;
      if (next.water && !this.crashed) this.impact(1.2, "propeller");
      if (this.pitch < -0.1 && speed > 20) this.impact(0.4, "propeller");
    } else {
      if (this.grounded && this.position.y > bottom + 0.25) {
        this.grounded = false;
        this.groundTime = 0;
        this.events.push({ type: "takeoff", severity: 0 });
      }
      if (!this.grounded) this.airborneTime += dt;
    }
    for (const o of obstacles) {
      if (
        this.position.y < o.y + 1 &&
        Math.hypot(this.position.x - o.x, this.position.z - o.z) <
          o.radius + 1.8
      ) {
        this.impact(speed > 18 ? 1.2 : 0.25, "wing");
        this.velocity.multiplyScalar(0.65);
        break;
      }
    }
    this.suspension = MathUtils.damp(this.suspension, 0, 7, dt);
    this.distance += this.position.distanceTo(prev);
    if (this.position.y > 1800) {
      this.position.y = 1800;
      this.velocity.y = Math.min(0, this.velocity.y);
    }
  }
}
