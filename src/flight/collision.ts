import { Quaternion, Vector3 } from "three";
import type { ContactProbe } from "./airframe-contact";
import type { Obstacle } from "../world/world";
import { groundHeight, maximumGroundHeight } from "../world/terrain";
import { terrainNormal } from "./wheel-contact";
import { ObstacleIndex, type CollisionObstacles } from "./obstacle-index";

export type SweptImpact = {
  fraction: number;
  point: Vector3;
  normal: Vector3;
  probe: ContactProbe;
  obstacle?: string;
  penetration?: number;
};

// Exact segment vs expanded vertical cylinder (the world's scenery proxy).
function cylinderEntry(
  a: Vector3,
  b: Vector3,
  obstacle: Obstacle,
  radius: number,
) {
  const delta = b.clone().sub(a),
    x = a.x - obstacle.x,
    z = a.z - obstacle.z;
  const r = obstacle.radius + radius,
    A = delta.x ** 2 + delta.z ** 2,
    B = 2 * (x * delta.x + z * delta.z),
    C = x * x + z * z - r * r;
  let lo = 0,
    hi = 1;
  if (A < 1e-12) {
    if (C > 0) return null;
  } else {
    const discriminant = B * B - 4 * A * C;
    if (discriminant < 0) return null;
    lo = Math.max(lo, (-B - Math.sqrt(discriminant)) / (2 * A));
    hi = Math.min(hi, (-B + Math.sqrt(discriminant)) / (2 * A));
  }
  const bottom = groundHeight(obstacle.x, obstacle.z) - radius,
    top = obstacle.y + radius;
  if (Math.abs(delta.y) < 1e-12) {
    if (a.y < bottom || a.y > top) return null;
  } else {
    const near = (bottom - a.y) / delta.y,
      far = (top - a.y) / delta.y;
    lo = Math.max(lo, Math.min(near, far));
    hi = Math.min(hi, Math.max(near, far));
  }
  if (lo > hi || lo > 1 || hi < 0) return null;
  const point = a.clone().addScaledVector(delta, lo);
  const normal =
    Math.abs(point.y - top) < 1e-5
      ? new Vector3(0, 1, 0)
      : Math.abs(point.y - bottom) < 1e-5
        ? new Vector3(0, -1, 0)
        : new Vector3(
            point.x - obstacle.x,
            0,
            point.z - obstacle.z,
          ).normalize();
  if (normal.lengthSq() < 0.5) normal.copy(delta).negate().normalize();
  const penetration =
    lo === 0
      ? Math.max(0, r - Math.hypot(point.x - obstacle.x, point.z - obstacle.z))
      : 0;
  return { fraction: lo, normal, penetration };
}

export function sweepAirframe(
  start: Vector3,
  startQ: Quaternion,
  end: Vector3,
  endQ: Quaternion,
  probes: ContactProbe[],
  obstacles: CollisionObstacles,
): SweptImpact | null {
  const angle = startQ.angleTo(endQ);
  const segments = Math.max(
    1,
    Math.min(
      32,
      Math.max(Math.ceil(angle / 0.08), Math.ceil(start.distanceTo(end) / 1.5)),
    ),
  );
  let hit: SweptImpact | null = null;
  // Broad phase includes the entire rotating aircraft, not just its origin.
  const reach = Math.max(...probes.map((p) => p.center.length() + p.radius));
  const candidates = obstacles instanceof ObstacleIndex
    ? obstacles.query(Math.min(start.x, end.x) - reach, Math.max(start.x, end.x) + reach,
        Math.min(start.z, end.z) - reach, Math.max(start.z, end.z) + reach)
    : obstacles;
  const nearby = candidates.filter(
    (o) =>
      o.x >= Math.min(start.x, end.x) - reach - o.radius &&
      o.x <= Math.max(start.x, end.x) + reach + o.radius &&
      o.z >= Math.min(start.z, end.z) - reach - o.radius &&
      o.z <= Math.max(start.z, end.z) + reach + o.radius &&
      Math.min(start.y, end.y) - reach < o.y,
  );
  const terrainRelevant = Math.min(start.y, end.y) - reach <= maximumGroundHeight(
    Math.min(start.x, end.x) - reach, Math.max(start.x, end.x) + reach,
    Math.min(start.z, end.z) - reach, Math.max(start.z, end.z) + reach,
  );
  if (!nearby.length && !terrainRelevant) return null;
  for (const probe of probes) {
    let a = probe.center.clone().applyQuaternion(startQ).add(start);
    for (let i = 1; i <= segments; i++) {
      const q = startQ.clone().slerp(endQ, i / segments);
      const b = probe.center
        .clone()
        .applyQuaternion(q)
        .add(start.clone().lerp(end, i / segments));
      // Rotation follows an arc; the sagitta padding covers its chord error.
      const padding =
        probe.center.length() * (1 - Math.cos(angle / segments / 2));
      const radius = probe.radius + padding;
      const record = (
        fraction: number,
        normal: Vector3,
        obstacle?: string,
        penetration = 0,
      ) => {
        const total = (i - 1 + fraction) / segments;
        if (hit && total >= hit.fraction) return;
        const point = a
          .clone()
          .lerp(b, fraction)
          .addScaledVector(normal, -probe.radius);
        hit = { fraction: total, point, normal, probe, obstacle, penetration };
      };
      for (const o of nearby) {
        const entry = cylinderEntry(a, b, o, radius);
        if (entry)
          record(entry.fraction, entry.normal, o.label, entry.penetration);
      }
      // Terrain proxy follows the paved/terrain ground function used by wheels.
      // Intermediate samples limit tunnelling over slopes; bisection finds TOI.
      const clearance = (t: number) => {
        const p = a.clone().lerp(b, t);
        return p.y - radius - groundHeight(p.x, p.z);
      };
      if (probe.terrain === false || !terrainRelevant) {
        a = b;
        continue;
      }
      if (clearance(0) <= 0) record(0, terrainNormal(a.x, a.z));
      else if (clearance(0.5) <= 0 || clearance(1) <= 0) {
        let lo = 0,
          hi = clearance(0.5) <= 0 ? 0.5 : 1;
        for (let j = 0; j < 10; j++) {
          const middle = (lo + hi) / 2;
          if (clearance(middle) > 0) lo = middle;
          else hi = middle;
        }
        const p = a.clone().lerp(b, hi);
        record(hi, terrainNormal(p.x, p.z));
      }
      a = b;
    }
  }
  return hit;
}
