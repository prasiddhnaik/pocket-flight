import { Quaternion, Vector3 } from "three";

// Public nominal calibre/cadence/velocity; drag and lifetime are game approximations,
// not ammunition-specific firing tables. All motion is in metres and seconds.
export const F15C_CANNON = { capacity: 940, roundsPerSecond: 100, muzzleSpeed: 1030, diameter: .02, projectileLength: .065, lifetime: 3, maximumProjectiles: 384, drag: .00025 } as const;
export const F15C_MUZZLE = new Vector3(2, .66, -2.05);
export type CannonTarget = { id: string; position: Vector3; radius: number };
export type CannonInput = { firing: boolean; origin: Vector3; direction: Vector3; velocity: Vector3 };
export type Projectile = { id: number; position: Vector3; velocity: Vector3; age: number };
export type CannonHit = { target: string; point: Vector3 };
export type CannonStep = { fired: number; hits: CannonHit[]; impacts: Vector3[] };
export type CannonEnvironment = { wind?: Vector3; surfaceHeight?: (x: number, z: number) => number; airDensity?: (altitude: number) => number };
const STEP = 1 / 300;
const GRAVITY = new Vector3(0, -9.81, 0);

export function muzzleVelocity(velocity: Vector3, bodyRate: Vector3, quaternion: Quaternion) {
  return bodyRate.clone().cross(F15C_MUZZLE).applyQuaternion(quaternion).add(velocity);
}
export function projectileAcceleration(position: Vector3, velocity: Vector3, environment: CannonEnvironment = {}) {
  const air = velocity.clone().sub(environment.wind ?? new Vector3());
  const density = environment.airDensity?.(position.y) ?? 1.225 * Math.exp(-Math.max(0, position.y) / 8500);
  return air.multiplyScalar(-F15C_CANNON.drag * Math.max(0, density) / 1.225 * air.length()).add(GRAVITY);
}
function surfaceIntersection(from: Vector3, to: Vector3, height: (x: number, z: number) => number) {
  if (from.y <= height(from.x, from.z)) return 0;
  // At 300 Hz the segment is only a few metres; include its midpoint for crests.
  const point = new Vector3();
  let lo = 0;
  for (const hi of [.5, 1]) {
    point.lerpVectors(from, to, hi);
    if (point.y <= height(point.x, point.z)) {
      let upper = hi;
      for (let j = 0; j < 10; j++) {
        const mid = (lo + upper) / 2;
        point.lerpVectors(from, to, mid);
        if (point.y <= height(point.x, point.z)) upper = mid; else lo = mid;
      }
      return upper;
    }
    lo = hi;
  }
  return null;
}

export function segmentSphere(from: Vector3, to: Vector3, center: Vector3, radius: number) {
  const delta = to.clone().sub(from), offset = from.clone().sub(center);
  const c = offset.lengthSq() - radius * radius;
  if (c <= 0) return 0;
  const a = delta.lengthSq();
  if (a === 0) return null;
  const b = offset.dot(delta), discriminant = b * b - a * c;
  if (discriminant < 0) return null;
  const t = (-b - Math.sqrt(discriminant)) / a;
  return t >= 0 && t <= 1 ? t : null;
}

export function cannonPose(position: Vector3, quaternion: Quaternion) {
  return {
    origin: F15C_MUZZLE.clone().applyQuaternion(quaternion).add(position),
    direction: new Vector3(0, 0, -1).applyQuaternion(quaternion).normalize(),
  };
}

export class CannonSimulation {
  ammunition: number = F15C_CANNON.capacity;
  projectiles: Projectile[] = [];
  hits = 0;
  shots = 0;
  private accumulator = 0;
  private cooldown = 0;
  private sequence = 0;

  reset() {
    this.ammunition = F15C_CANNON.capacity;
    this.projectiles = [];
    this.hits = this.shots = this.accumulator = this.cooldown = this.sequence = 0;
  }

  suspend() {
    this.accumulator = this.cooldown = 0;
  }

  step(dt: number, input: CannonInput, targets: readonly CannonTarget[], environment: CannonEnvironment = {}): CannonStep {
    const result: CannonStep = { fired: 0, hits: [], impacts: [] };
    if (!Number.isFinite(dt) || dt <= 0) return result;
    this.accumulator += Math.min(dt, 1);
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP;
      if (input.firing && this.ammunition > 0 && this.cooldown <= 1e-9) {
        if (this.projectiles.length === F15C_CANNON.maximumProjectiles) this.projectiles.shift();
        // Callers supply the aircraft pose at the end of this physics interval.
        // Backtrack to this emission time rather than stacking a whole frame's
        // rounds at the same moving muzzle position.
        this.projectiles.push({ id: ++this.sequence, position: input.origin.clone().addScaledVector(input.velocity, -(this.accumulator + STEP)),
          velocity: input.direction.clone().normalize().multiplyScalar(F15C_CANNON.muzzleSpeed).add(input.velocity), age: 0 });
        this.ammunition--; this.shots++; result.fired++;
        this.cooldown = 1 / F15C_CANNON.roundsPerSecond;
      }
      this.cooldown = Math.max(0, this.cooldown - STEP);
      const alive: Projectile[] = [];
      for (const projectile of this.projectiles) {
        const acceleration = projectileAcceleration(projectile.position, projectile.velocity, environment);
        const midpointVelocity = projectile.velocity.clone().addScaledVector(acceleration, STEP / 2);
        const end = projectile.position.clone().addScaledVector(midpointVelocity, STEP);
        const ground = environment.surfaceHeight ? surfaceIntersection(projectile.position, end, environment.surfaceHeight) : null;
        let nearest: { target: CannonTarget; t: number } | undefined;
        for (const target of targets) {
          const t = segmentSphere(projectile.position, end, target.position, target.radius);
          if (t !== null && (!nearest || t < nearest.t)) nearest = { target, t };
        }
        if (ground !== null && (!nearest || ground <= nearest.t)) {
          result.impacts.push(projectile.position.clone().lerp(end, ground));
          continue;
        }
        if (nearest) {
          this.hits++;
          result.hits.push({ target: nearest.target.id, point: projectile.position.clone().lerp(end, nearest.t) });
          continue;
        }
        projectile.velocity.addScaledVector(projectileAcceleration(projectile.position.clone().lerp(end, .5), midpointVelocity, environment), STEP);
        projectile.position.copy(end);
        projectile.age += STEP;
        if (projectile.age < F15C_CANNON.lifetime) alive.push(projectile);
      }
      this.projectiles = alive;
    }
    return result;
  }
}
