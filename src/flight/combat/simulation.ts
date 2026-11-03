import { Quaternion, Vector3 } from "three";
import { segmentSphere, type CannonHit } from "../cannon";
import {
  stores,
  validateLoadout,
  type Hardpoint,
  type Loadout,
  type WeaponKind,
} from "./loadout";

export type TargetOrbit = {
  x: number;
  z: number;
  radius: number;
  altitude: number;
  speed: number;
  direction: number;
  phase: number;
};
export type CombatTarget = {
  id: string;
  kind: "air" | "ground";
  position: Vector3;
  radius: number;
  health: number;
  respawn: number;
  /** Dummy model name, ground point and heading; simple shapes stand in without them. */
  model?: string;
  base?: Vector3;
  heading?: number;
  maxHealth?: number;
  respawnTime?: number;
  /** Air dummies fly this circuit. */
  orbit?: TargetOrbit;
  velocity?: Vector3;
};
export type WeaponPose = {
  position: Vector3;
  quaternion: Quaternion;
  velocity: Vector3;
};
export type Ordnance = {
  id: number;
  kind: WeaponKind;
  position: Vector3;
  velocity: Vector3;
  age: number;
  target: string | null;
  damage: number;
  lifetime: number;
};
export type Station = {
  hardpoint: Hardpoint;
  store: string;
  remaining: number;
};
export type CombatImpact = {
  point: Vector3;
  target: string | null;
  destroyed: boolean;
  /** Warheads explode; absent for gun hits. */
  warhead?: WeaponKind;
  /** Blast damage to a neighbour of the main impact. */
  splash?: boolean;
};
const STEP = 1 / 120;
const FORWARD = new Vector3(0, 0, -1);
/** Time on target before the seeker reports a lock. */
export const LOCK_TIME = 1;
const SEEKER_CONE = Math.cos((12 * Math.PI) / 180);
// A seeker already tracking holds on a little wider than it can acquire.
const SEEKER_HOLD = Math.cos((16 * Math.PI) / 180);
const MISSILE_TURN = (70 * Math.PI) / 180;
const MISSILE_GIMBAL = Math.cos((75 * Math.PI) / 180);
const BLAST_RADIUS = 18;

/** Air target closest to the boresight; the one already tracked wins while it stays in the hold cone. */
export function lockCandidate(
  pose: WeaponPose,
  targets: readonly CombatTarget[],
  tracking: string | null = null,
) {
  const forward = FORWARD.clone().applyQuaternion(pose.quaternion);
  let best: CombatTarget | null = null;
  let bestAim = SEEKER_CONE;
  for (const target of targets) {
    if (target.kind !== "air" || target.health <= 0) continue;
    const delta = target.position.clone().sub(pose.position);
    const range = delta.length();
    if (range < 30 || range >= 2500) continue;
    const aim = delta.normalize().dot(forward);
    if (target.id === tracking && aim >= SEEKER_HOLD) return target;
    if (aim >= bestAim) {
      best = target;
      bestAim = aim;
    }
  }
  return best;
}

export function moveOrbit(target: CombatTarget, time: number) {
  const { orbit } = target;
  if (!orbit) return;
  const angle = orbit.phase + (orbit.direction * orbit.speed * time) / orbit.radius;
  target.position.set(
    orbit.x + Math.sin(angle) * orbit.radius,
    orbit.altitude,
    orbit.z + Math.cos(angle) * orbit.radius,
  );
  (target.velocity ??= new Vector3()).set(
    Math.cos(angle) * orbit.speed * orbit.direction,
    0,
    -Math.sin(angle) * orbit.speed * orbit.direction,
  );
}

function groundIntersection(
  from: Vector3,
  to: Vector3,
  height: (x: number, z: number) => number,
): number | null {
  if (from.y <= height(from.x, from.z)) return 0;
  const point = new Vector3();
  let lower = 0;
  // Small fixed steps plus quarter samples catch intervening crests.
  for (const upper of [0.25, 0.5, 0.75, 1]) {
    point.lerpVectors(from, to, upper);
    if (point.y <= height(point.x, point.z)) {
      let high = upper;
      for (let i = 0; i < 12; i++) {
        const middle = (lower + high) / 2;
        point.lerpVectors(from, to, middle);
        if (point.y <= height(point.x, point.z)) high = middle;
        else lower = middle;
      }
      return high;
    }
    lower = upper;
  }
  return null;
}

/** High ground between a blast and a target shelters the target. */
function sheltered(from: Vector3, to: Vector3, height: (x: number, z: number) => number) {
  const point = new Vector3();
  // A blast starts just above the surface it struck.
  const origin = from.clone().setY(from.y + 1);
  for (const along of [0.25, 0.5, 0.75]) {
    point.lerpVectors(origin, to, along);
    if (point.y < height(point.x, point.z)) return true;
  }
  return false;
}

/** Stopped this long on a runway or apron, the crew has the aircraft rearmed. */
export const REARM_TIME = 3;
// A bounce is not a sortie: the wheels must leave the ground for this long.
const SORTIE_TIME = 2;
const STOPPED_SPEED = 1.5;

/** Rearming takes a real sortie and a full stop: nothing else reloads the stores. */
export class RearmCrew {
  /** Seconds spent working on the aircraft; zero when it is not being rearmed. */
  progress = 0;
  private airborne = 0;
  private flown = false;
  /** Returns true on the step the aircraft is rearmed. */
  step(dt: number, speed: number, grounded: boolean, pavement: boolean) {
    this.airborne = grounded ? 0 : this.airborne + dt;
    if (this.airborne >= SORTIE_TIME) this.flown = true;
    if (!this.flown || !grounded || !pavement || speed > STOPPED_SPEED) {
      this.progress = 0;
      return false;
    }
    this.progress += dt;
    if (this.progress < REARM_TIME) return false;
    this.flown = false;
    this.progress = 0;
    return true;
  }
}

export class CombatSimulation {
  readonly stations: Station[];
  projectiles: Ordnance[] = [];
  hits = 0;
  destroyed = 0;
  lock: string | null = null;
  lockTime = 0;
  private time = 0;
  private sequence = 0;
  private accumulator = 0;
  private held = { rocket: false, missile: false };
  private nextStation = { rocket: 0, missile: 0 };
  constructor(
    hardpoints: readonly Hardpoint[],
    loadout: readonly Loadout[number][],
    readonly targets: CombatTarget[],
  ) {
    const errors = validateLoadout(hardpoints, loadout);
    if (errors.length) throw new Error(errors.join("; "));
    this.stations = loadout.map((load) => ({
      hardpoint: hardpoints.find((point) => point.id === load.hardpoint)!,
      store: load.store,
      remaining: stores[load.store].rounds,
    }));
    for (const target of targets) moveOrbit(target, 0);
  }
  get clock() {
    return this.time;
  }
  get locked() {
    return this.lock !== null && this.lockTime >= LOCK_TIME;
  }
  rearm() {
    for (const station of this.stations)
      station.remaining = stores[station.store].rounds;
    this.nextStation = { rocket: 0, missile: 0 };
  }
  ammunition(kind: WeaponKind) {
    return this.stations.reduce(
      (sum, station) =>
        sum + (stores[station.store].kind === kind ? station.remaining : 0),
      0,
    );
  }
  suspend() {
    this.held = { rocket: false, missile: false };
    this.accumulator = 0;
    this.lock = null;
    this.lockTime = 0;
  }
  /** Edge-triggered release: a held key cannot dump the whole loadout. */
  trigger(kind: WeaponKind, pressed: boolean, pose: WeaponPose) {
    const rising = pressed && !this.held[kind];
    this.held[kind] = pressed;
    if (!rising || (kind === "missile" && !this.locked))
      return false;
    const candidates = this.stations.filter(
      (station) => stores[station.store].kind === kind && station.remaining > 0,
    );
    if (!candidates.length) return false;
    const station = candidates[this.nextStation[kind]++ % candidates.length];
    station.remaining--;
    const store = stores[station.store];
    const direction = FORWARD.clone().applyQuaternion(pose.quaternion);
    const position = new Vector3(...station.hardpoint.position)
      .applyQuaternion(pose.quaternion)
      .add(pose.position);
    this.projectiles.push({
      id: ++this.sequence,
      kind,
      position,
      velocity: direction.multiplyScalar(store.speed).add(pose.velocity),
      age: 0,
      target: kind === "missile" ? this.lock : null,
      damage: store.damage,
      lifetime: store.lifetime,
    });
    return true;
  }
  damage(id: string, amount: number, point: Vector3): CombatImpact | null {
    const target = this.targets.find(
      (target) => target.id === id && target.health > 0,
    );
    if (!target) return null;
    this.hits++;
    target.health = Math.max(0, target.health - amount);
    if (!target.health) {
      this.destroyed++;
      target.respawn = target.respawnTime ?? 5;
    }
    return { point: point.clone(), target: id, destroyed: target.health === 0 };
  }
  /** A warhead's blast hurts everything close by, less with distance. */
  private blast(point: Vector3, damage: number, hit: string | null, height: (x: number, z: number) => number) {
    const impacts: CombatImpact[] = [];
    for (const target of this.targets) {
      if (target.health <= 0 || target.id === hit) continue;
      const distance = target.position.distanceTo(point) - target.radius;
      if (distance >= BLAST_RADIUS || sheltered(point, target.position, height)) continue;
      const amount = Math.ceil(damage * (1 - Math.max(0, distance) / BLAST_RADIUS));
      const impact = this.damage(target.id, amount, target.position);
      if (impact) impacts.push({ ...impact, splash: true });
    }
    return impacts;
  }
  gunHits(hits: readonly CannonHit[]) {
    return hits.flatMap((hit) => {
      const impact = this.damage(hit.target, 1, hit.point);
      return impact ? [impact] : [];
    });
  }
  step(
    dt: number,
    pose: WeaponPose,
    height: (x: number, z: number) => number,
  ): CombatImpact[] {
    const impacts: CombatImpact[] = [];
    if (!Number.isFinite(dt) || dt <= 0) return impacts;
    this.accumulator += Math.min(dt, 0.25);
    while (this.accumulator + 1e-10 >= STEP) {
      this.accumulator -= STEP;
      this.time += STEP;
      for (const target of this.targets) {
        moveOrbit(target, this.time);
        if (target.health > 0) continue;
        target.respawn = Math.max(0, target.respawn - STEP);
        if (target.respawn === 0) target.health = target.maxHealth ?? 3;
      }
      const candidate = lockCandidate(pose, this.targets, this.lock)?.id ?? null;
      this.lockTime =
        candidate && candidate === this.lock
          ? Math.min(LOCK_TIME, this.lockTime + STEP)
          : 0;
      this.lock = candidate;
      this.projectiles = this.projectiles.filter((round) => {
        if (round.kind === "missile") {
          const target = this.targets.find(
            (target) => target.id === round.target && target.health > 0,
          );
          if (target) {
            const direction = round.velocity.clone().normalize();
            // Lead the target by the time of flight still to go.
            const toGo = target.position.distanceTo(round.position) / round.velocity.length();
            const desired = target.position
              .clone()
              .addScaledVector(target.velocity ?? new Vector3(), toGo)
              .sub(round.position)
              .normalize();
            if (desired.dot(direction) < MISSILE_GIMBAL) round.target = null;
            else
              round.velocity.applyQuaternion(
                new Quaternion().rotateTowards(
                  new Quaternion().setFromUnitVectors(direction, desired),
                  MISSILE_TURN * STEP,
                ),
              );
          }
        }
        const acceleration = round.kind === "rocket" ? -9.81 : 0;
        const end = round.position
          .clone()
          .addScaledVector(round.velocity, STEP);
        end.y += acceleration * 0.5 * STEP * STEP;
        const ground = groundIntersection(round.position, end, height);
        let nearest: { target: CombatTarget; fraction: number } | null = null;
        for (const target of this.targets) {
          if (
            target.health <= 0 ||
            (round.kind === "missile" && target.kind !== "air")
          )
            continue;
          const fraction = segmentSphere(
            round.position,
            end,
            target.position,
            target.radius,
          );
          if (fraction !== null && (!nearest || fraction < nearest.fraction))
            nearest = { target, fraction };
        }
        if (ground !== null && (!nearest || ground <= nearest.fraction)) {
          const point = round.position.clone().lerp(end, ground);
          impacts.push({ point, target: null, destroyed: false, warhead: round.kind });
          impacts.push(...this.blast(point, round.damage, null, height));
          return false;
        }
        if (nearest) {
          const point = round.position.clone().lerp(end, nearest.fraction);
          const impact = this.damage(nearest.target.id, round.damage, point);
          if (impact) impacts.push({ ...impact, warhead: round.kind });
          impacts.push(...this.blast(point, round.damage, nearest.target.id, height));
          return false;
        }
        round.position.copy(end);
        round.velocity.y += acceleration * STEP;
        round.age += STEP;
        return round.age < round.lifetime;
      });
    }
    return impacts;
  }
}
