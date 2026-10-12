import { Box3, Matrix4, Mesh, Object3D, Vector3 } from "three";
import { velocityAt, wingSection, type Solution, type Vec3 } from "./solver";

export type EnvelopeData = {
  min: Vec3;
  max: Vec3;
  nx: number;
  nz: number;
  originX: number;
  originZ: number;
  lower: Float32Array;
  upper: Float32Array;
};

// Conservative obstacle envelope rasterized from every aircraft triangle in
// body coordinates. Each occupied X/Z column contains the triangle's entire Y
// range, including overlapping body/wing/tail meshes and open authoring seams.
// This is a display collision model, not a pressure or viscous-flow solver.
export class AirframeEnvelope {
  readonly bounds: Box3;
  readonly cell = 0.16;
  private nx: number;
  private nz: number;
  private lower: Float32Array;
  private upper: Float32Array;
  private originX: number;
  private originZ: number;

  constructor(root: Object3D | EnvelopeData) {
    if (!(root instanceof Object3D)) {
      this.bounds = new Box3(
        new Vector3(...root.min),
        new Vector3(...root.max),
      );
      this.nx = root.nx;
      this.nz = root.nz;
      this.originX = root.originX;
      this.originZ = root.originZ;
      this.lower = root.lower;
      this.upper = root.upper;
      return;
    }
    root.updateWorldMatrix(true, true);
    const inverse = root.matrixWorld.clone().invert(),
      meshes: { xyz: Float32Array; indices: ArrayLike<number> | null }[] = [];
    this.bounds = new Box3();
    root.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const position = node.geometry.getAttribute("position");
      if (!position) return;
      const transform = new Matrix4().multiplyMatrices(
          inverse,
          node.matrixWorld,
        ),
        point = new Vector3();
      const xyz = new Float32Array(position.count * 3);
      for (let i = 0; i < position.count; i++) {
        point.fromBufferAttribute(position, i).applyMatrix4(transform);
        if (!point.toArray().every(Number.isFinite))
          throw new Error("Invalid aircraft collision geometry.");
        this.bounds.expandByPoint(point);
        xyz.set(point.toArray(), i * 3);
      }
      meshes.push({ xyz, indices: node.geometry.index?.array ?? null });
    });
    if (this.bounds.isEmpty())
      throw new Error("Aircraft has no collision geometry.");
    this.originX = this.bounds.min.x - this.cell;
    this.originZ = this.bounds.min.z - this.cell;
    this.nx = Math.ceil((this.bounds.max.x - this.originX) / this.cell) + 1;
    this.nz = Math.ceil((this.bounds.max.z - this.originZ) / this.cell) + 1;
    this.lower = new Float32Array(this.nx * this.nz).fill(Infinity);
    this.upper = new Float32Array(this.nx * this.nz).fill(-Infinity);
    for (const { xyz, indices } of meshes) {
      const count = indices?.length ?? xyz.length / 3;
      for (let i = 0; i < count; i += 3) {
        const a = (indices?.[i] ?? i) * 3,
          b = (indices?.[i + 1] ?? i + 1) * 3,
          c = (indices?.[i + 2] ?? i + 2) * 3;
        const x0 = Math.floor(
            (Math.min(xyz[a], xyz[b], xyz[c]) - this.originX) / this.cell,
          ),
          x1 = Math.floor(
            (Math.max(xyz[a], xyz[b], xyz[c]) - this.originX) / this.cell,
          );
        const z0 = Math.floor(
            (Math.min(xyz[a + 2], xyz[b + 2], xyz[c + 2]) - this.originZ) /
              this.cell,
          ),
          z1 = Math.floor(
            (Math.max(xyz[a + 2], xyz[b + 2], xyz[c + 2]) - this.originZ) /
              this.cell,
          );
        const low = Math.min(xyz[a + 1], xyz[b + 1], xyz[c + 1]),
          high = Math.max(xyz[a + 1], xyz[b + 1], xyz[c + 1]);
        for (let z = z0; z <= z1; z++)
          for (let x = x0; x <= x1; x++) {
            const index = z * this.nx + x;
            this.lower[index] = Math.min(this.lower[index], low);
            this.upper[index] = Math.max(this.upper[index], high);
          }
      }
    }
  }

  toData(): EnvelopeData {
    return {
      min: this.bounds.min.toArray() as Vec3,
      max: this.bounds.max.toArray() as Vec3,
      nx: this.nx,
      nz: this.nz,
      originX: this.originX,
      originZ: this.originZ,
      lower: this.lower,
      upper: this.upper,
    };
  }

  range(x0: number, x1: number, z0: number, z1: number, margin = 0) {
    const ix0 = Math.max(
        0,
        Math.floor((x0 - margin - this.originX) / this.cell),
      ),
      ix1 = Math.min(
        this.nx - 1,
        Math.floor((x1 + margin - this.originX) / this.cell),
      );
    const iz0 = Math.max(
        0,
        Math.floor((z0 - margin - this.originZ) / this.cell),
      ),
      iz1 = Math.min(
        this.nz - 1,
        Math.floor((z1 + margin - this.originZ) / this.cell),
      );
    let lower = Infinity,
      upper = -Infinity;
    for (let z = iz0; z <= iz1; z++)
      for (let x = ix0; x <= ix1; x++) {
        const index = z * this.nx + x;
        lower = Math.min(lower, this.lower[index]);
        upper = Math.max(upper, this.upper[index]);
      }
    return { lower, upper };
  }
  contains(p: Vec3, margin = 0) {
    const { lower, upper } = this.range(p[0], p[0], p[2], p[2], margin);
    return p[1] >= lower - margin && p[1] <= upper + margin;
  }
  // A sufficient clearance check: the entire line lies above/below every
  // occupied column in its projected footprint. Conservative false positives
  // are preferable to drawing an intersection through the rendered aircraft.
  segmentClear(a: Vec3, b: Vec3, side: number, margin = 0.075) {
    const r = this.range(
      Math.min(a[0], b[0]),
      Math.max(a[0], b[0]),
      Math.min(a[2], b[2]),
      Math.max(a[2], b[2]),
      margin,
    );
    return side > 0
      ? Math.min(a[1], b[1]) > r.upper + margin
      : Math.max(a[1], b[1]) < r.lower - margin;
  }
}

export type AirflowPath = {
  points: Vec3[];
  distances: number[];
  length: number;
  wake: boolean;
};
export type AirflowResult = {
  paths: AirflowPath[];
  rejected: number;
  checkedSegments: number;
  direction: string;
  model: string;
};
const clearance = 0.13;

// Approximate far-wake roll-up. Strength and lateral centroid come from the
// solved circulation; the finite core and roll-up distance are display
// assumptions. Quantitative lift/drag remain the original wing solution.
export function wakeModel(solution: Solution) {
  const rootGamma =
    (solution.panels[solution.panels.length / 2 - 1].gamma +
      solution.panels[solution.panels.length / 2].gamma) /
    2;
  const halfIntegral = solution.panels
    .filter((p) => p.x > 0)
    .reduce((sum, p) => sum + p.gamma * p.width, 0);
  const x =
    Math.abs(rootGamma) > 1e-6
      ? Math.min(
          solution.span * 0.48,
          Math.max(solution.span * 0.25, Math.abs(halfIntegral / rootGamma)),
        )
      : solution.span * 0.4;
  const trailing = Math.max(
    ...solution.geometry.stations.map((s) => s.leading + s.chord),
  );
  return {
    gamma: rootGamma,
    x,
    y: wingSection(solution.geometry, x).y,
    trailing,
  };
}

export function displayVelocity(
  solution: Solution,
  p: Vec3,
  wake = wakeModel(solution),
): Vec3 {
  const base = velocityAt(solution, p, 0.09);
  const alpha = (solution.conditions.alpha * Math.PI) / 180;
  const downstream = p[2] - wake.trailing;
  const blend = Math.max(0, Math.min(1, (downstream - 0.8) / 3));
  if (!blend) return base;
  const smooth = blend * blend * (3 - 2 * blend),
    rolled: Vec3 = [...solution.freestream];
  const centerY =
    wake.y + Math.tan(alpha) * downstream - solution.cl * 0.035 * downstream;
  for (const sign of [-1, 1]) {
    const dx = p[0] - sign * wake.x,
      dy = (p[1] - centerY) * Math.cos(alpha);
    const factor =
      (sign * wake.gamma) / (2 * Math.PI * (dx * dx + dy * dy + 0.22 ** 2));
    rolled[0] -= factor * dy;
    rolled[1] += factor * dx * Math.cos(alpha);
    rolled[2] -= factor * dx * Math.sin(alpha);
  }
  return base.map((v, i) => v * (1 - smooth) + rolled[i] * smooth) as Vec3;
}

function routeOutside(
  raw: Vec3[],
  envelope: AirframeEnvelope,
  side: number,
): Vec3[] {
  const needed = raw.map((p) => {
    const r = envelope.range(p[0], p[0], p[2], p[2], clearance);
    return Math.max(
      0,
      side > 0 ? r.upper + clearance - p[1] : p[1] - r.lower + clearance,
    );
  });
  let routed: Vec3[] = [];
  for (let pass = 0; pass < 4; pass++) {
    // Smooth maximum anticipates an obstacle before the nose/leading edge.
    // At the obstacle itself it never undercuts the required displacement.
    routed = raw.map((p, i) => {
      let displacement = needed[i];
      for (let j = Math.max(0, i - 24); j < Math.min(raw.length, i + 25); j++) {
        const distance = (p[2] - raw[j][2]) / 1.15;
        displacement = Math.max(
          displacement,
          needed[j] * Math.exp(-distance * distance),
        );
      }
      return [p[0], p[1] + side * displacement, p[2]];
    });
    let clear = true;
    for (let i = 1; i < routed.length; i++) {
      const a = routed[i - 1],
        b = routed[i];
      if (envelope.segmentClear(a, b, side)) continue;
      clear = false;
      const r = envelope.range(
        Math.min(a[0], b[0]),
        Math.max(a[0], b[0]),
        Math.min(a[2], b[2]),
        Math.max(a[2], b[2]),
        clearance,
      );
      for (const index of [i - 1, i])
        needed[index] = Math.max(
          needed[index],
          side > 0
            ? r.upper + clearance + 0.04 - raw[index][1]
            : raw[index][1] - r.lower + clearance + 0.04,
        );
    }
    if (clear) return routed;
  }
  return [];
}

export function traceAirflow(
  solution: Solution,
  envelope: AirframeEnvelope,
): AirflowResult {
  const paths: AirflowPath[] = [],
    wake = wakeModel(solution);
  const alpha = (solution.conditions.alpha * Math.PI) / 180,
    rootY = solution.geometry.stations[0].y;
  const start = envelope.bounds.min.z - 4,
    end = Math.min(18.8, envelope.bounds.max.z + 9);
  const extent = solution.span / 2; // Seed the stream from wingtip to wingtip.
  const seeds: { p: Vec3; side: number; wake: boolean }[] = [];
  for (const offset of [-0.6, 0.55])
    for (let i = 0; i < 23; i++) {
      seeds.push({
        p: [
          -extent + (2 * extent * i) / 22,
          rootY + offset + Math.tan(alpha) * start,
          start,
        ],
        side: Math.sign(offset),
        wake: false,
      });
    }
  // Outer sheets widen the visible flow vertically as well as across the span.
  // Keep the finer near-aircraft probes for body deflection and wing downwash.
  for (const offset of [-2.2, 2.7])
    for (let i = 0; i < 19; i++) {
      seeds.push({
        p: [
          -extent + (2 * extent * i) / 18,
          rootY + offset + Math.tan(alpha) * start,
          start,
        ],
        side: Math.sign(offset),
        wake: false,
      });
    }
  for (const x of [-1.2, -0.65, -0.22, 0.22, 0.65, 1.2])
    for (const offset of [-0.3, 0.28, 0.95]) {
      seeds.push({
        p: [x, rootY + offset + Math.tan(alpha) * start, start],
        side: Math.sign(offset),
        wake: false,
      });
    }
  // Additional wake probes expose the counter-rotating pair downstream, rather
  // than inventing a swirl around the whole aircraft or the propeller.
  const wakeStart = Math.max(wake.trailing + 1.4, envelope.bounds.max.z - 1);
  for (const sign of [-1, 1])
    for (let i = 0; i < 10; i++) {
      const theta = (i * Math.PI * 2) / 10 + 0.15;
      seeds.push({
        p: [
          sign * wake.x + Math.cos(theta) * 0.52,
          wake.y +
            Math.tan(alpha) * (wakeStart - wake.trailing) +
            Math.sin(theta) * 0.52,
          wakeStart,
        ],
        side: Math.sin(theta) >= 0 ? 1 : -1,
        wake: true,
      });
    }
  let rejected = 0,
    checkedSegments = 0;
  for (const seed of seeds) {
    const raw: Vec3[] = [seed.p];
    for (let i = 0; i < 270 && raw.at(-1)![2] < end; i++) {
      const p = raw.at(-1)!,
        v1 = displayVelocity(solution, p, wake);
      const dt = 0.16 / Math.max(solution.conditions.speed, Math.hypot(...v1));
      const half = p.map((v, k) => v + (v1[k] * dt) / 2) as Vec3;
      const v = displayVelocity(solution, half, wake);
      // Fixed downstream marching avoids reversed traces near an unresolved
      // filament. This and solid-body routing are visualization constraints.
      v[2] = Math.max(solution.conditions.speed * 0.3, v[2]);
      const next = p.map((value, k) => value + v[k] * dt) as Vec3;
      if (
        !next.every(Number.isFinite) ||
        Math.abs(next[0]) > 8.5 ||
        Math.abs(next[1]) > 7
      )
        break;
      raw.push(next);
    }
    const points = routeOutside(raw, envelope, seed.side);
    if (points.length < 5) {
      rejected++;
      continue;
    }
    const distances = [0];
    for (let i = 1; i < points.length; i++) {
      if (!envelope.segmentClear(points[i - 1], points[i], seed.side))
        throw new Error("Airflow line intersects aircraft envelope.");
      checkedSegments++;
      distances.push(
        distances[i - 1] +
          Math.hypot(...points[i].map((v, k) => v - points[i - 1][k])),
      );
    }
    paths.push({
      points,
      distances,
      length: distances.at(-1)!,
      wake: seed.wake,
    });
  }
  return {
    paths,
    rejected,
    checkedSegments,
    direction: "Inlet → nose → tail → downstream extraction fan",
    model:
      "Mesh-envelope routing with circulation-based approximate wake roll-up; illustrative full-aircraft airflow, not CFD.",
  };
}

export function samplePath(
  path: AirflowPath,
  distance: number,
  out: Vec3 = [0, 0, 0],
): Vec3 {
  const d = Math.max(0, Math.min(path.length, distance));
  let lo = 0,
    hi = path.distances.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.distances[mid] > d) hi = mid;
    else lo = mid;
  }
  const t =
    (d - path.distances[lo]) /
    Math.max(1e-9, path.distances[hi] - path.distances[lo]);
  for (let i = 0; i < 3; i++)
    out[i] = path.points[lo][i] + (path.points[hi][i] - path.points[lo][i]) * t;
  return out;
}
