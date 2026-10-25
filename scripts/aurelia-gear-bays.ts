import * as T from "three";

// Layout reference: Cessna Citation CJ4 Specification & Description, §7.
// Single main wheels retract inboard; Aurelia's dimensions and twin nose gear
// remain aircraft-specific. https://africair.com/wp-content/uploads/2016/03/SD-CJ4-Unit-0200-to-TBD-2015-Oct.pdf

export const AURELIA_BAY_REVISION = 23;
// Native GLB coordinates. The occupied passenger floor starts at Y=2.38.
export const aureliaBays = [
  {
    name: "MainBay_Left",
    ceiling: "MainBayCeiling_Left",
    x: -2.18,
    half: 1.24,
    bottom: 1.79,
    top: 2.36,
    aftTop: 2.36,
    front: 0.32,
    back: 1.88,
    side: -1,
  },
  {
    name: "MainBay_Right",
    ceiling: "MainBayCeiling_Right",
    x: 2.18,
    half: 1.24,
    bottom: 1.79,
    top: 2.36,
    aftTop: 2.36,
    front: 0.32,
    back: 1.88,
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
export const aureliaBodyCenter = (z: number) => hull(z)[2];
export function bellyDoorHeight(b: Bay, x: number) {
  return b.side
    ? 1.79 + 0.07 * (Math.abs(x) / 3.42) ** 2
    : 1.46 + 0.008 * (Math.abs(x) / 0.52) ** 4;
}
export const aureliaPanels = aureliaBays.flatMap((bay) => {
  if (!bay.side)
    return [-1, 1].map((side) => ({
      bay,
      name: `${bay.name}_door_${side}`,
      hingeName: `Nose door hinge ${side}`,
      minX: side < 0 ? -bay.half : 0,
      maxX: side < 0 ? 0 : bay.half,
      front: bay.front,
      back: bay.back,
      radius: 0.24,
      side,
    }));
  const side = bay.side;
  const limits = (inner: number, outer: number) =>
    side > 0 ? { minX: inner, maxX: outer } : { minX: -outer, maxX: -inner };
  return [
    {
      bay,
      name: `${bay.name}_door_${side}`,
      hingeName: `Main door hinge ${side}`,
      ...limits(2.2, 3.42),
      front: 0.66,
      back: 1.28,
      radius: 0.08,
      side,
    },
    ...[0, 1].map((leaf) => ({
      bay,
      name: `${bay.name}_tire_door_${side}_${leaf}`,
      hingeName: `Main tire door hinge ${side} ${leaf}`,
      ...limits(0.94, 2.2),
      front: 0.48 + leaf * 0.62,
      back: 1.1 + leaf * 0.62,
      radius: 0.08,
      side: -side,
    })),
  ];
});
export type DoorPanel = (typeof aureliaPanels)[number];
export function panelHinge(p: DoorPanel) {
  const x = p.side > 0 ? p.maxX : p.minX;
  return new T.Vector3(x, bellyDoorHeight(p.bay, x), (p.front + p.back) / 2);
}
export function bellyDoorHinge(b: Bay, side: number) {
  return panelHinge(
    aureliaPanels.find(
      (p) =>
        p.bay === b &&
        p.hingeName === `${b.side ? "Main" : "Nose"} door hinge ${side}`,
    )!,
  );
}
export function bayOpeningContains(b: Bay, x: number, z: number) {
  return aureliaPanels
    .filter((p) => p.bay === b)
    .some((p) => {
      const r = p.radius,
        dx = Math.max(p.minX + r - x, 0, x - (p.maxX - r)),
        dz = Math.max(p.front + r - z, 0, z - (p.back - r));
      return dx * dx + dz * dz <= r * r;
    });
}
function roundPanelPoint(
  x: number,
  z: number,
  minX: number,
  maxX: number,
  minZ: number,
  maxZ: number,
  radius: number,
) {
  const cx = T.MathUtils.clamp(x, minX + radius, maxX - radius),
    cz = T.MathUtils.clamp(z, minZ + radius, maxZ - radius),
    dx = x - cx,
    dz = z - cz,
    distance = Math.hypot(dx, dz);
  return distance > radius
    ? { x: cx + (dx * radius) / distance, z: cz + (dz * radius) / distance }
    : { x, z };
}
const smooth = (t: number) => {
  t = T.MathUtils.clamp(t, 0, 1);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export function fairingFullness(b: Bay, z: number) {
  // A single shallow canoe fairs into the wing roots. Upright aft-folded
  // tires previously forced two deep pods; the inboard fold removes that depth.
  const lead = b.side ? 2.35 : 0.78,
    trail = b.side ? 3.25 : 0.88;
  return (
    smooth((z - (b.front - lead)) / lead) * smooth((b.back + trail - z) / trail)
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
  // One continuous lower envelope. The shallow main canoe blends into the
  // wing roots; the existing nose keel is fitted separately at the forward bay.
  const main = aureliaBays[0],
    nose = aureliaBays[2];
  const bottomColumns = Array.from({ length: 49 }, (_, i) => (3.42 * i) / 48);
  bottomColumns.push(0.94, 2.2);
  bottomColumns.sort((a, b) => a - b);
  const front = nose.front - 0.78,
    back = main.back + 3.25;
  const zs = [
    nose.front,
    nose.back,
    main.front,
    main.back,
    ...aureliaPanels
      .filter((p) => p.bay.side)
      .flatMap((p) => [p.front, p.back]),
  ];
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
        [3.42, bellyDoorHeight(main, 3.42)],
        [3.56, 1.98],
        [3.67, 2.22],
        [3.68, 2.43],
        [3.05, 2.5],
        [2.86, 2.79],
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
              (x * 0.52) / 3.42,
              bellyDoorHeight(nose, (x * 0.52) / 3.42),
              0,
            ),
        )
        .concat(curve(nosePoints));
      const noseFullness = fairingFullness(nose, z);
      const mainFullness = fairingFullness(main, z);
      const fullness = Math.max(noseFullness, mainFullness);
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
          (bayOpeningContains(nose, side * x, z) ||
            aureliaPanels.some(
              (p) =>
                p.bay.side &&
                side * x > p.minX &&
                side * x < p.maxX &&
                z > p.front &&
                z < p.back,
            ))
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
  // Conforming quarter-circle corners replace the staircase left by dropping
  // whole grid cells at a rounded opening. The door meets this fixed skin along
  // a smooth perimeter rather than overlapping coarse corner triangles.
  for (const p of aureliaPanels.filter((p) => p.bay.side)) {
    const b = p.bay,
      radius = p.radius;
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const x = sx < 0 ? p.minX : p.maxX,
          z = sz < 0 ? p.front : p.back;
        const corner = positions.length;
        positions.push([x, bellyDoorHeight(b, x), z]);
        for (let i = 0; i <= 16; i++) {
          const angle = (i * Math.PI) / 32;
          const px = x - sx * radius + sx * radius * Math.cos(angle);
          const pz = z - sz * radius + sz * radius * Math.sin(angle);
          positions.push([px, bellyDoorHeight(b, px), pz]);
        }
        for (let i = 0; i < 16; i++) {
          const a = corner + 1 + i,
            c = a + 1;
          indices.push(...(sx * sz > 0 ? [corner, c, a] : [corner, a, c]));
        }
      }
  }
  root.add(mesh("Integrated_belly_fairing", positions, indices));
  // Dedicated single-wheel trailing-link mains, sized for this airframe.
  // Coordinates are relative to the retained Main_gear groups (Y=1.10 down).
  const titanium = new T.MeshStandardMaterial({
    name: "Main gear | satin titanium",
    color: "#819397",
    metalness: 0.78,
    roughness: 0.32,
  });
  const chrome = new T.MeshStandardMaterial({
    name: "Main gear | oleo piston",
    color: "#d6e0dd",
    metalness: 0.95,
    roughness: 0.18,
  });
  for (const label of ["Left", "Right"]) {
    const strut = new T.Group();
    strut.name = `MainStrut_${label}`;
    const tube = (
      name: string,
      a: number[],
      b: number[],
      radius: number,
      material = titanium,
    ) => {
      const start = new T.Vector3().fromArray(a),
        end = new T.Vector3().fromArray(b);
      const direction = end.clone().sub(start);
      const geometry = new T.CylinderGeometry(
        radius,
        radius,
        direction.length(),
        16,
      );
      geometry.applyQuaternion(
        new T.Quaternion().setFromUnitVectors(
          new T.Vector3(0, 1, 0),
          direction.normalize(),
        ),
      );
      const center = start.clone().add(end).multiplyScalar(0.5);
      geometry.translate(center.x, center.y, center.z);
      const part = new T.Mesh(geometry, material);
      part.name = `${label}_${name}`;
      strut.add(part);
    };
    tube("upper_oleo", [0, 0.98, -0.15], [0, -0.14, -0.15], 0.105);
    tube("trunnion_bearing", [0, 0.98, -0.34], [0, 0.98, 0.04], 0.135);
    tube("upper_collar", [0, 0.72, -0.15], [0, 0.81, -0.15], 0.124);
    tube("gland_collar", [0, -0.16, -0.15], [0, -0.06, -0.15], 0.125);
    tube("piston_wiper", [0, -0.175, -0.15], [0, -0.155, -0.15], 0.095);
    tube(
      "polished_piston",
      [0, -0.12, -0.15],
      [0, -0.38, -0.15],
      0.064,
      chrome,
    );
    tube("trailing_link", [0, -0.38, -0.15], [0, -0.59, 0], 0.076);
    tube("short_axle", [-0.14, -0.59, 0], [0.14, -0.59, 0], 0.085);
    tube("torque_link_upper", [0, 0.02, -0.25], [0, -0.19, -0.36], 0.025);
    tube("torque_link_lower", [0, -0.19, -0.36], [0, -0.4, -0.25], 0.025);
    for (const [index, y, z] of [
      [0, 0.02, -0.25],
      [1, -0.19, -0.36],
      [2, -0.4, -0.25],
    ])
      tube(
        `torque_pivot_${index}`,
        [-0.055, y, z],
        [0.055, y, z],
        0.036,
        chrome,
      );
    tube("axle_hub", [-0.2, -0.59, 0], [0.2, -0.59, 0], 0.12);
    // The rotor and caliper sit beside the tire; they do not enlarge the tire.
    const side = label === "Left" ? -1 : 1;
    tube(
      "brake_rotor",
      [side * 0.145, -0.59, 0],
      [side * 0.18, -0.59, 0],
      0.285,
      chrome,
    );
    tube(
      "brake_caliper",
      [side * 0.2, -0.48, 0.16],
      [side * 0.2, -0.48, 0.32],
      0.06,
    );
    const hose = new T.CatmullRomCurve3([
      new T.Vector3(-side * 0.08, 0.5, -0.25),
      new T.Vector3(-side * 0.12, -0.1, -0.28),
      new T.Vector3(-side * 0.14, -0.42, -0.18),
      new T.Vector3(side * 0.2, -0.48, 0.22),
    ]);
    const hoseMesh = new T.Mesh(
      new T.TubeGeometry(hose, 18, 0.012, 6, false),
      new T.MeshStandardMaterial({ color: "#263034", roughness: 0.8 }),
    );
    hoseMesh.name = `${label}_brake_hose`;
    strut.add(hoseMesh);
    root.add(strut);
  }
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
    for (const p of aureliaPanels.filter((p) => p.bay === b)) {
      const side = p.side,
        hinge = panelHinge(p),
        width = p.maxX - p.minX;
      const vertices: number[][] = [],
        indices: number[] = [];
      const nx = 24,
        nz = 16,
        gap = 0.006;
      const minX = Math.min(hinge.x, hinge.x - side * width) + gap / 2,
        maxX = Math.max(hinge.x, hinge.x - side * width) - gap / 2,
        minZ = p.front + gap / 2,
        maxZ = p.back - gap / 2,
        radius = p.radius;
      for (const depth of [0, 0.028])
        for (let row = 0; row <= nz; row++)
          for (let col = 0; col <= nx; col++) {
            const point = roundPanelPoint(
              hinge.x - side * (gap / 2 + ((width - gap) * col) / nx),
              minZ + ((maxZ - minZ) * row) / nz,
              minX,
              maxX,
              minZ,
              maxZ,
              radius,
            );
            vertices.push([
              point.x - hinge.x,
              bellyDoorHeight(b, point.x) + depth - hinge.y,
              point.z - hinge.z,
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
      root.add(mesh(p.name, vertices, indices));
    }
  }
  return root;
}
