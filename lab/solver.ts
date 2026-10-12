import { Vector3 } from "three";

export type Vec3 = [number, number, number];
export type WingStation = {
  x: number;
  y: number;
  leading: number;
  chord: number;
  zeroLiftAlpha: number;
};
export type WingGeometry = {
  name: string;
  revision: string;
  assumptions: string[];
  stations: WingStation[];
};
export type Conditions = { speed: number; density: number; alpha: number };
export type Panel = {
  a: Vec3;
  b: Vec3;
  control: Vec3;
  normal: Vec3;
  gamma: number;
  x: number;
  width: number;
  chord: number;
  liftPerSpan: number;
};
export type Solution = {
  geometry: WingGeometry;
  conditions: Conditions;
  panels: Panel[];
  freestream: Vec3;
  span: number;
  area: number;
  aspectRatio: number;
  dynamicPressure: number;
  cl: number;
  cdi: number;
  lift: number;
  inducedDrag: number;
  efficiency: number | null;
  residual: number;
  core: number;
  wakeLength: number;
};
export const SOLVER_VERSION = "horseshoe-vlm-1.0";
export const LIMITS = {
  minAlpha: -8,
  maxAlpha: 8,
  minSpeed: 5,
  maxSpeed: 80,
  minDensity: 0.5,
  maxDensity: 1.4,
};
const radians = Math.PI / 180;
const vector = (p: Vec3) => new Vector3(...p);

function validate(
  geometry: WingGeometry,
  conditions: Conditions,
  count: number,
) {
  if (!Number.isInteger(count) || count < 12 || count > 160 || count % 2)
    throw new Error("Use an even panel count from 12 to 160.");
  const { speed, density, alpha } = conditions;
  if (
    ![speed, density, alpha].every(Number.isFinite) ||
    speed < LIMITS.minSpeed ||
    speed > LIMITS.maxSpeed ||
    density < LIMITS.minDensity ||
    density > LIMITS.maxDensity ||
    alpha < LIMITS.minAlpha ||
    alpha > LIMITS.maxAlpha
  )
    throw new Error(
      "Unsupported condition: speed 5–80 m/s, density 0.5–1.4 kg/m³, angle −8° to +8°.",
    );
  if (geometry.stations.length < 2 || geometry.stations[0].x !== 0)
    throw new Error(
      "Wing stations must start at the centreline and include a tip.",
    );
  for (const [i, s] of geometry.stations.entries()) {
    if (
      !Object.values(s).every(Number.isFinite) ||
      s.chord <= 0 ||
      Math.abs(s.zeroLiftAlpha) > 8 ||
      (i > 0 && s.x <= geometry.stations[i - 1].x)
    )
      throw new Error(
        "Invalid wing station: finite data, positive chords and increasing span positions required.",
      );
  }
}

export function wingSection(geometry: WingGeometry, x: number): WingStation {
  const spanX = Math.abs(x),
    stations = geometry.stations;
  const end = stations.findIndex((s) => s.x >= spanX);
  if (end <= 0) return { ...stations[end === 0 ? 0 : stations.length - 1], x };
  const a = stations[end - 1],
    b = stations[end],
    t = (spanX - a.x) / (b.x - a.x);
  return {
    x,
    y: a.y + (b.y - a.y) * t,
    leading: a.leading + (b.leading - a.leading) * t,
    chord: a.chord + (b.chord - a.chord) * t,
    zeroLiftAlpha: a.zeroLiftAlpha + (b.zeroLiftAlpha - a.zeroLiftAlpha) * t,
  };
}

// Finite-segment Biot–Savart, unit circulation. A small core regularizes display
// samples on a filament; collocation points are away from the bound vortex.
function segment(point: Vector3, a: Vector3, b: Vector3, core: number) {
  const r1 = point.clone().sub(a),
    r2 = point.clone().sub(b),
    r0 = b.clone().sub(a);
  const cross = r1.clone().cross(r2);
  if (r1.lengthSq() < 1e-18 || r2.lengthSq() < 1e-18) return new Vector3();
  const scale =
    r0.dot(r1.normalize().sub(r2.normalize())) /
    (4 * Math.PI * (cross.lengthSq() + core ** 2 * r0.lengthSq()));
  return cross.multiplyScalar(scale);
}

function horseshoe(
  point: Vector3,
  panel: Panel,
  wakeLength: number,
  core: number,
) {
  const a = vector(panel.a),
    b = vector(panel.b);
  const farA = a.clone().add(new Vector3(0, 0, wakeLength));
  const farB = b.clone().add(new Vector3(0, 0, wakeLength));
  return segment(point, farA, a, core)
    .add(segment(point, a, b, core))
    .add(segment(point, b, farB, core));
}

function linearSolve(matrix: number[][], rhs: number[]) {
  const n = rhs.length,
    rows = matrix.map((row, i) => [...row, rhs[i]]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let j = i + 1; j < n; j++)
      if (Math.abs(rows[j][i]) > Math.abs(rows[pivot][i])) pivot = j;
    if (Math.abs(rows[pivot][i]) < 1e-12)
      throw new Error(
        "The wing influence matrix is singular; inspect geometry and panel resolution.",
      );
    [rows[i], rows[pivot]] = [rows[pivot], rows[i]];
    for (let j = i + 1; j < n; j++) {
      const factor = rows[j][i] / rows[i][i];
      rows[j][i] = 0;
      for (let k = i + 1; k <= n; k++) rows[j][k] -= factor * rows[i][k];
    }
  }
  const result = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let value = rows[i][n];
    for (let j = i + 1; j < n; j++) value -= rows[i][j] * result[j];
    result[i] = value / rows[i][i];
  }
  return result;
}

export function solveWing(
  geometry: WingGeometry,
  conditions: Conditions,
  count = 48,
): Solution {
  validate(geometry, conditions, count);
  const semiSpan = geometry.stations.at(-1)!.x,
    span = 2 * semiSpan;
  const core = span * 1e-6,
    wakeLength = span * 200;
  let area = 0;
  for (let i = 1; i < geometry.stations.length; i++) {
    const a = geometry.stations[i - 1],
      b = geometry.stations[i];
    area += (a.chord + b.chord) * (b.x - a.x);
  }
  const aspectRatio = span ** 2 / area;
  const alpha = conditions.alpha * radians;
  const freestream: Vec3 = [
    0,
    conditions.speed * Math.sin(alpha),
    conditions.speed * Math.cos(alpha),
  ];
  const panels: Panel[] = Array.from({ length: count }, (_, i) => {
    const x0 = -semiSpan * Math.cos((Math.PI * i) / count),
      x1 = -semiSpan * Math.cos((Math.PI * (i + 1)) / count);
    const a = wingSection(geometry, x0),
      b = wingSection(geometry, x1),
      mid = wingSection(geometry, (x0 + x1) / 2);
    const normal = new Vector3(-(b.y - a.y) / (x1 - x0), 1, 0)
      .normalize()
      .toArray() as Vec3;
    return {
      a: [x0, a.y, a.leading + a.chord / 4],
      b: [x1, b.y, b.leading + b.chord / 4],
      control: [mid.x, mid.y, mid.leading + mid.chord * 0.75],
      normal,
      gamma: 0,
      x: mid.x,
      width: x1 - x0,
      chord: mid.chord,
      liftPerSpan: 0,
    };
  });
  const matrix = panels.map((target) =>
    panels.map((source) =>
      horseshoe(vector(target.control), source, wakeLength, core).dot(
        vector(target.normal),
      ),
    ),
  );
  const rhs = panels.map(
    (p) =>
      -vector(freestream).dot(vector(p.normal)) +
      conditions.speed *
        Math.sin(wingSection(geometry, p.x).zeroLiftAlpha * radians),
  );
  const circulation = linearSolve(matrix, rhs);
  const residual =
    Math.max(
      ...matrix.map((row, i) =>
        Math.abs(
          row.reduce((sum, value, j) => sum + value * circulation[j], 0) -
            rhs[i],
        ),
      ),
    ) / conditions.speed;
  if (residual > 1e-7 || !circulation.every(Number.isFinite))
    throw new Error("Numerical solution failed its residual check.");
  let lift = 0,
    inducedDrag = 0;
  for (const [i, panel] of panels.entries()) {
    panel.gamma = circulation[i];
    // Wind-axis lift: rotate the freestream Kutta–Joukowski force from
    // body coordinates; rho * V * Gamma is the vertical component in the tunnel.
    panel.liftPerSpan = conditions.density * conditions.speed * panel.gamma;
    lift += panel.liftPerSpan * panel.width;
    // Trefftz-plane wake velocity: infinite trailing lines. The induced velocity
    // at the wing is half the far-wake velocity; do not use collocation downwash.
    let wakeX = 0,
      wakeY = 0;
    for (const [j, source] of panels.entries()) {
      for (const [endpoint, sign] of [
        [source.b, 1],
        [source.a, -1],
      ] as const) {
        const dx = panel.x - endpoint[0],
          dy = panel.control[1] - endpoint[1];
        const factor =
          (sign * circulation[j]) / (2 * Math.PI * (dx * dx + dy * dy));
        wakeX -= factor * dy;
        wakeY += factor * dx;
      }
    }
    inducedDrag -=
      (conditions.density *
        panel.gamma *
        (wakeY * panel.width - wakeX * (panel.b[1] - panel.a[1]))) /
      2;
  }
  if (inducedDrag < -1e-8)
    throw new Error(
      "Negative induced drag indicates an invalid numerical solution.",
    );
  inducedDrag = Math.max(0, inducedDrag);
  const dynamicPressure = 0.5 * conditions.density * conditions.speed ** 2;
  const cl = lift / (dynamicPressure * area),
    cdi = inducedDrag / (dynamicPressure * area);
  return {
    geometry,
    conditions: { ...conditions },
    panels,
    freestream,
    span,
    area,
    aspectRatio,
    dynamicPressure,
    cl,
    cdi,
    lift,
    inducedDrag,
    efficiency: cdi > 1e-12 ? cl ** 2 / (Math.PI * aspectRatio * cdi) : null,
    residual,
    core,
    wakeLength,
  };
}

// For this linear, fixed-geometry model, circulation scales with V and forces
// scale with rho*V². Cache the reference solve without rounding inputs.
const referenceSolutions = new WeakMap<WingGeometry, Map<string, Solution>>();
export function cachedSolveWing(
  geometry: WingGeometry,
  conditions: Conditions,
  count = 48,
): Solution {
  validate(geometry, conditions, count);
  let cache = referenceSolutions.get(geometry);
  if (!cache) referenceSolutions.set(geometry, (cache = new Map()));
  const key = JSON.stringify([conditions.alpha, count, geometry.stations]);
  let reference = cache.get(key);
  if (!reference) {
    reference = solveWing(
      geometry,
      { ...conditions, speed: 30, density: 1.225 },
      count,
    );
    if (cache.size >= 32) cache.delete(cache.keys().next().value!);
    cache.set(key, reference);
  }
  const velocityScale = conditions.speed / reference.conditions.speed;
  const forceScale =
    (conditions.density / reference.conditions.density) * velocityScale ** 2;
  return {
    ...reference,
    geometry,
    conditions: { ...conditions },
    freestream: reference.freestream.map((v) => v * velocityScale) as Vec3,
    panels: reference.panels.map((panel) => ({
      ...panel,
      a: [...panel.a] as Vec3,
      b: [...panel.b] as Vec3,
      control: [...panel.control] as Vec3,
      normal: [...panel.normal] as Vec3,
      gamma: panel.gamma * velocityScale,
      liftPerSpan: panel.liftPerSpan * forceScale,
    })),
    dynamicPressure: reference.dynamicPressure * forceScale,
    lift: reference.lift * forceScale,
    inducedDrag: reference.inducedDrag * forceScale,
  };
}

// Allocation-free segment accumulation keeps dense display traces responsive.
function addFilament(
  out: Vec3,
  p: Vec3,
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  gamma: number,
  core: number,
) {
  const x1 = p[0] - ax,
    y1 = p[1] - ay,
    z1 = p[2] - az,
    x2 = p[0] - bx,
    y2 = p[1] - by,
    z2 = p[2] - bz;
  const l1 = Math.hypot(x1, y1, z1),
    l2 = Math.hypot(x2, y2, z2);
  if (l1 < 1e-9 || l2 < 1e-9) return;
  const rx = bx - ax,
    ry = by - ay,
    rz = bz - az;
  const cx = y1 * z2 - z1 * y2,
    cy = z1 * x2 - x1 * z2,
    cz = x1 * y2 - y1 * x2;
  const scale =
    (gamma *
      (rx * (x1 / l1 - x2 / l2) +
        ry * (y1 / l1 - y2 / l2) +
        rz * (z1 / l1 - z2 / l2))) /
    (4 *
      Math.PI *
      (cx * cx +
        cy * cy +
        cz * cz +
        core * core * (rx * rx + ry * ry + rz * rz)));
  out[0] += cx * scale;
  out[1] += cy * scale;
  out[2] += cz * scale;
}
export function velocityAt(
  solution: Solution,
  point: Vec3,
  core = solution.core,
): Vec3 {
  const velocity: Vec3 = [...solution.freestream];
  for (const { a, b, gamma } of solution.panels) {
    addFilament(
      velocity,
      point,
      a[0],
      a[1],
      a[2] + solution.wakeLength,
      a[0],
      a[1],
      a[2],
      gamma,
      core,
    );
    addFilament(
      velocity,
      point,
      a[0],
      a[1],
      a[2],
      b[0],
      b[1],
      b[2],
      gamma,
      core,
    );
    addFilament(
      velocity,
      point,
      b[0],
      b[1],
      b[2],
      b[0],
      b[1],
      b[2] + solution.wakeLength,
      gamma,
      core,
    );
  }
  return velocity;
}
