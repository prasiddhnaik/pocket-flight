import * as T from "three";

export const AURELIA_BAY_REVISION = 9;
// Native GLB coordinates. The occupied passenger floor starts at Y=2.38.
export const aureliaBays = [
  {
    name: "MainBay_Left",
    ceiling: "MainBayCeiling_Left",
    x: -2.15,
    half: 0.64,
    bottom: 1.18,
    top: 2.36,
    aftTop: 2.36,
    front: 0.04,
    back: 3.58,
    side: -1,
  },
  {
    name: "MainBay_Right",
    ceiling: "MainBayCeiling_Right",
    x: 2.15,
    half: 0.64,
    bottom: 1.18,
    top: 2.36,
    aftTop: 2.36,
    front: 0.04,
    back: 3.58,
    side: 1,
  },
  {
    name: "NoseBay",
    ceiling: "NoseBayCeiling",
    x: 0,
    half: 0.52,
    bottom: 1.46,
    top: 2.76,
    aftTop: 2.31,
    front: -11.3,
    back: -8.06,
    side: 0,
  },
] as const;
type Bay = (typeof aureliaBays)[number];
export function bayCeilingHeight(b: Bay, z: number) {
  return T.MathUtils.lerp(
    b.top,
    b.aftTop,
    T.MathUtils.clamp((z - b.front) / (b.back - b.front), 0, 1),
  );
}

// The authored pressure-shell stations, converted from Blender's forward +Y
// to GLB's forward -Z. Fairing ends return to this surface with zero taper slope.
const hullStations = [
  [-16.2, 0.015, 0.02, 3.35],
  [-15.2, 0.43, 0.36, 3.42],
  [-13.7, 0.95, 0.76, 3.59],
  [-12, 1.45, 1.27, 3.74],
  [-10, 1.95, 1.73, 3.84],
  [-7.3, 2.25, 1.94, 3.88],
  [-3, 2.36, 2.01, 3.88],
  [2, 2.35, 2, 3.88],
  [5.4, 2.18, 1.88, 3.91],
  [8, 1.67, 1.51, 3.97],
  [10.5, 1.05, 1.06, 4.01],
  [13, 0.45, 0.54, 4.04],
  [15.3, 0.035, 0.065, 4.07],
];
function hull(z: number) {
  const i = Math.max(
    0,
    hullStations.findIndex(
      (s, j) =>
        j < hullStations.length - 1 && z >= s[0] && z <= hullStations[j + 1][0],
    ),
  );
  const a = hullStations[Math.max(0, i - 1)],
    b = hullStations[i],
    c = hullStations[i + 1],
    d = hullStations[Math.min(hullStations.length - 1, i + 2)];
  const t = T.MathUtils.clamp((z - b[0]) / (c[0] - b[0]), 0, 1);
  return [1, 2, 3].map(
    (j) =>
      0.5 *
      (2 * b[j] +
        (-a[j] + c[j]) * t +
        (2 * a[j] - 5 * b[j] + 4 * c[j] - d[j]) * t * t +
        (-a[j] + 3 * b[j] - 3 * c[j] + d[j]) * t * t * t),
  );
}
export function bellyDoorHeight(b: Bay, x: number) {
  return b.side
    ? 1.18 + 0.05 * (Math.abs(x) / 2.79) ** 4
    : 1.46 + 0.008 * (Math.abs(x) / 0.52) ** 4;
}
export function bellyDoorHinge(b: Bay, side: number) {
  const x = b.x + side * b.half;
  return new T.Vector3(x, bellyDoorHeight(b, x), (b.front + b.back) / 2);
}
const smooth = (t: number) => {
  t = T.MathUtils.clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export function fairingFullness(b: Bay, z: number) {
  const lead = b.side ? 3.6 : 2.25,
    trail = b.side ? 3.8 : 2.4;
  return (
    smooth((z - (b.front - lead)) / (lead - 0.16)) *
    smooth((b.back + trail - z) / (trail - 0.16))
  );
}

export function makeAureliaGearBays() {
  const root = new T.Group();
  root.name = "AureliaGearBays";
  root.userData = {
    revision: AURELIA_BAY_REVISION,
    units: "native GLB",
    floorY: 2.38,
    description:
      "Continuous wing-body belly fairing with flush curved doors and sealed underfloor liners",
  };
  const paint = new T.MeshStandardMaterial({
    name: "Gear fairing | Atlantic blue lacquer",
    color: new T.Color(0.00913405884, 0.04231141135, 0.06480326504),
    metalness: 0.5,
    roughness: 0.24,
    side: T.DoubleSide,
  });
  const lining = new T.MeshStandardMaterial({
    name: "Gear bays | pressure floor",
    color: "#687574",
    metalness: 0.45,
    roughness: 0.6,
    side: T.DoubleSide,
  });
  const mesh = (
    name: string,
    vertices: number[][],
    indices: number[],
    material = paint,
  ) => {
    const g = new T.BufferGeometry();
    g.setAttribute(
      "position",
      new T.Float32BufferAttribute(vertices.flat(), 3),
    );
    g.setIndex(indices);
    g.computeVertexNormals();
    const m = new T.Mesh(g, material);
    m.name = name;
    return m;
  };
  const panel = (name: string, vertices: number[][]) =>
    mesh(name, vertices, [0, 1, 2, 0, 2, 3], lining);
  // One continuous lower envelope, following business-jet belly / wing-body
  // fairings. The shallow nose keel flows into the main fairing without pods.
  const main = aureliaBays[0],
    nose = aureliaBays[2];
  const bottomColumns = Array.from({ length: 33 }, (_, i) => (2.79 * i) / 32);
  bottomColumns.push(1.51);
  bottomColumns.sort((a, b) => a - b);
  const front = nose.front - 2.25,
    back = main.back + 3.8;
  const zs = [nose.front, nose.back, main.front, main.back];
  for (let i = 0; i <= 112; i++) zs.push(front + ((back - front) * i) / 112);
  zs.sort((a, b) => a - b);
  const sideSteps = 20,
    columns = bottomColumns.length + sideSteps;
  const positions: number[][] = [],
    indices: number[] = [];
  for (const side of [-1, 1]) {
    const offset = positions.length;
    for (const z of zs) {
      const [rx, rz, zc] = hull(z),
        rimY = Math.max(zc - rz + 0.1, 3.2),
        rimX = rx * Math.sqrt(1 - ((rimY - zc) / rz) ** 2);
      const blend = smooth(
        (z - (nose.back + 0.16)) / (main.front - 0.16 - nose.back - 0.16),
      );
      const nosePoints = [
        [0.52, bellyDoorHeight(nose, 0.52)],
        [0.66, 1.49],
        [0.87, 1.66],
        [1.15, 2.08],
        [1.2, 2.5],
        [rimX - 0.06, rimY + 0.035],
      ];
      const mainPoints = [
        [2.79, bellyDoorHeight(main, 2.79)],
        [2.94, 1.25],
        [3.08, 1.5],
        [3.2, 1.93],
        [3.06, 2.4],
        [2.65, 2.85],
        [rimX - 0.06, rimY + 0.035],
      ];
      const curve = (ps: number[][]) =>
        new T.CatmullRomCurve3(
          ps.map((p) => new T.Vector3(p[0], p[1], 0)),
          false,
          "centripetal",
        )
          .getPoints(sideSteps)
          .slice(1);
      const mainSection = bottomColumns
        .map((x) => new T.Vector3(x, bellyDoorHeight(main, x), 0))
        .concat(curve(mainPoints));
      const noseSection = bottomColumns
        .map(
          (x) =>
            new T.Vector3(
              (x * 0.52) / 2.79,
              bellyDoorHeight(nose, (x * 0.52) / 2.79),
              0,
            ),
        )
        .concat(curve(nosePoints));
      const fullness =
        smooth((z - front) / (2.25 - 0.16)) * smooth((back - z) / (3.8 - 0.16));
      const angle = Math.acos(T.MathUtils.clamp((zc - rimY) / rz, -1, 1));
      mainSection.forEach((p, j) => {
        const desired = noseSection[j].clone().lerp(p, blend),
          theta = (angle * j) / (columns - 1);
        const originalX = rx * Math.sin(theta) * 0.995,
          originalY = zc - rz * Math.cos(theta) + 0.025;
        positions.push([
          side * T.MathUtils.lerp(originalX, desired.x, fullness),
          T.MathUtils.lerp(originalY, desired.y, fullness),
          z,
        ]);
      });
    }
    for (let row = 1; row < zs.length; row++)
      for (let col = 0; col < columns - 1; col++) {
        const z = (zs[row - 1] + zs[row]) / 2,
          x = (bottomColumns[col] + bottomColumns[col + 1]) / 2;
        if (
          col < bottomColumns.length - 1 &&
          ((z > nose.front && z < nose.back) ||
            (z > main.front && z < main.back && x > 1.51))
        )
          continue;
        const a = offset + (row - 1) * columns + col,
          c = offset + row * columns + col;
        indices.push(
          ...(side === 1
            ? [a, a + 1, c + 1, a, c + 1, c]
            : [a, c + 1, a + 1, a, c, c + 1]),
        );
      }
  }
  root.add(mesh("Integrated_belly_fairing", positions, indices));
  for (const b of aureliaBays) {
    const bay = new T.Group();
    bay.name = b.name;
    const lo = b.x - b.half,
      hi = b.x + b.half;
    const roof = [
      [lo - 0.025, bayCeilingHeight(b, b.front) - 0.0125, b.front - 0.025],
      [hi + 0.025, bayCeilingHeight(b, b.front) - 0.0125, b.front - 0.025],
      [hi + 0.025, bayCeilingHeight(b, b.back) - 0.0125, b.back + 0.025],
      [lo - 0.025, bayCeilingHeight(b, b.back) - 0.0125, b.back + 0.025],
    ];
    bay.add(panel(b.ceiling, roof));
    for (const x of [lo, hi])
      bay.add(
        panel(`${b.name}_inner_side_${x}`, [
          [x, bellyDoorHeight(b, x) + 0.035, b.front],
          [x, bayCeilingHeight(b, b.front) - 0.0125, b.front],
          [x, bayCeilingHeight(b, b.back) - 0.0125, b.back],
          [x, bellyDoorHeight(b, x) + 0.035, b.back],
        ]),
      );
    for (const z of [b.front, b.back])
      bay.add(
        panel(`${b.name}_inner_end_${z}`, [
          [lo, bellyDoorHeight(b, lo) + 0.035, z],
          [hi, bellyDoorHeight(b, hi) + 0.035, z],
          [hi, bayCeilingHeight(b, z) - 0.0125, z],
          [lo, bayCeilingHeight(b, z) - 0.0125, z],
        ]),
      );
    root.add(bay);
    for (const side of b.side ? [b.side] : [-1, 1]) {
      const hinge = bellyDoorHinge(b, side),
        width = b.side ? 2 * b.half : b.half;
      const vertices: number[][] = [],
        indices: number[] = [];
      const nx = 24,
        nz = 16,
        gap = 0.006;
      for (const depth of [0, 0.028])
        for (let row = 0; row <= nz; row++)
          for (let col = 0; col <= nx; col++) {
            const x = hinge.x - side * (gap / 2 + ((width - gap) * col) / nx),
              z = b.front + gap / 2 + ((b.back - b.front - gap) * row) / nz;
            vertices.push([
              x - hinge.x,
              bellyDoorHeight(b, x) + depth - hinge.y,
              z - hinge.z,
            ]);
          }
      const n = (nx + 1) * (nz + 1);
      for (const layer of [0, n])
        for (let row = 0; row < nz; row++)
          for (let col = 0; col < nx; col++) {
            const a = layer + row * (nx + 1) + col,
              c = a + nx + 1;
            indices.push(
              ...((layer === 0 ? side === -1 : side === 1)
                ? [a, a + 1, c + 1, a, c + 1, c]
                : [a, c + 1, a + 1, a, c, c + 1]),
            );
          }
      // Closed sandwich edges, rather than paper-thin panels.
      const edge = (a: number, c: number) =>
        indices.push(a, c, c + n, a, c + n, a + n);
      for (let j = 0; j < nx; j++) {
        edge(j, j + 1);
        edge(n - nx - 1 + j, n - nx + j);
      }
      for (let j = 0; j < nz; j++) {
        edge(j * (nx + 1), (j + 1) * (nx + 1));
        edge(j * (nx + 1) + nx, (j + 1) * (nx + 1) + nx);
      }
      root.add(mesh(`${b.name}_door_${side}`, vertices, indices));
    }
  }
  return root;
}
