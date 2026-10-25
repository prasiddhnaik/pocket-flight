import type { Obstacle } from "../world/world";

export type CollisionObstacles = readonly Obstacle[] | ObstacleIndex;

/** Broad phase for scenery that is static after its assets finish loading. */
export class ObstacleIndex {
  private readonly cells = new Map<string, number[]>();
  constructor(
    private readonly obstacles: readonly Obstacle[],
    private readonly cellSize = 128,
  ) {
    for (let i = 0; i < obstacles.length; i++) {
      const o = obstacles[i];
      for (
        let x = this.cell(o.x - o.radius);
        x <= this.cell(o.x + o.radius);
        x++
      ) {
        for (
          let z = this.cell(o.z - o.radius);
          z <= this.cell(o.z + o.radius);
          z++
        ) {
          const key = `${x},${z}`;
          const bucket = this.cells.get(key);
          if (bucket) bucket.push(i);
          else this.cells.set(key, [i]);
        }
      }
    }
  }

  private cell(value: number) {
    return Math.floor(value / this.cellSize);
  }

  query(
    minX: number,
    maxX: number,
    minZ: number,
    maxZ: number,
  ): readonly Obstacle[] {
    const x0 = this.cell(minX),
      x1 = this.cell(maxX),
      z0 = this.cell(minZ),
      z1 = this.cell(maxZ);
    const overlaps = (o: Obstacle) =>
      o.x + o.radius >= minX &&
      o.x - o.radius <= maxX &&
      o.z + o.radius >= minZ &&
      o.z - o.radius <= maxZ;
    // Long teleports are cheaper to check directly than to walk empty cells.
    if ((x1 - x0 + 1) * (z1 - z0 + 1) > this.cells.size)
      return this.obstacles.filter(overlaps);
    const found = new Set<number>();
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        for (const i of this.cells.get(`${x},${z}`) ?? []) found.add(i);
      }
    // Keep equal-time impacts deterministic, matching the original array scan.
    return [...found]
      .sort((a, b) => a - b)
      .map((i) => this.obstacles[i])
      .filter(overlaps);
  }
}
