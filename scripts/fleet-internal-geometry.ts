import * as T from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { Octree } from "three/addons/math/Octree.js";
import { fixedWingSkins } from "../lab/internal-control-link";
import { wingSampler } from "./skin-sampler";
import { runtimeAircraftCatalog as aircraftCatalog, type LabAircraftId } from "../lab/aircraft";
import { aircraftSystems } from "../src/aircraft/aircraft-systems";

export type JetId = Exclude<LabAircraftId, "finch">;
export const layouts = {
  peregrine: {
    centerY: 3.3,
    wallZ: -5.65,
    floorY: 3.74,
    equipmentZ: -4.45,
    equipmentY: 3.7,
    unit: 0.7,
    centerTank: [0, 3.65, 0.8, 1.25, 0.5, 2.0],
  },
  aurelia: {
    centerY: 3.8,
    wallZ: 6.0,
    floorY: 3.02,
    // Compact service installation below the flight deck, ahead of the nose
    // gear sweep. Moving the physical equipment corrects empty-cabin CG.
    equipmentZ: -12.8,
    equipmentY: 3.15,
    unit: 0.6,
    centerTank: null,
  },
  stormbird: {
    centerY: 2.0,
    wallZ: -2.15,
    floorY: 2.135,
    equipmentZ: -1.5,
    equipmentY: 2.0,
    unit: 0.34,
    centerTank: [0, 2.42, 0.9, 1.02, 0.36, 2.9],
  },
} satisfies Record<
  JetId,
  {
    centerY: number;
    wallZ: number;
    floorY: number;
    equipmentZ: number;
    equipmentY: number;
    unit: number;
    centerTank: number[] | null;
  }
>;

export function bodySkin(root: T.Object3D, id: JetId) {
  const name =
    id === "peregrine"
      ? "Sculpted_pressure_fuselage"
      : id === "aurelia"
        ? "Continuous_pressure_shell"
        : "Airframe_mesh_2";
  const source = root.getObjectByName(name) as T.Mesh;
  if (!source?.isMesh) throw new Error(`Missing body skin: ${id} ${name}`);
  const skin = new T.Mesh(
    source.geometry,
    new T.MeshBasicMaterial({ side: T.DoubleSide }),
  );
  skin.matrixAutoUpdate = false;
  skin.matrix.copy(source.matrixWorld);
  skin.updateWorldMatrix(true, false);
  const tree = new Octree().fromGraphNode(skin);
  const centerY = layouts[id].centerY;
  const boundary = (z: number, angle: number) => {
    const direction = new T.Vector3(Math.cos(angle), Math.sin(angle), 0);
    const ray = new T.Ray(new T.Vector3(0, centerY, z), direction),
      triangles: T.Triangle[] = [],
      point = new T.Vector3();
    tree.getRayTriangles(ray, triangles);
    let radius = Infinity;
    for (const triangle of triangles) {
      const at = ray.intersectTriangle(
        triangle.a,
        triangle.b,
        triangle.c,
        false,
        point,
      );
      if (at) radius = Math.min(radius, at.distanceTo(ray.origin));
    }
    if (!Number.isFinite(radius))
      throw new Error(`Open body section: ${id} z=${z} angle=${angle}`);
    return { point: ray.at(radius, new T.Vector3()), radius, direction };
  };
  return {
    boundary,
    contains(p: T.Vector3, clearance = 0.006) {
      const radius = Math.hypot(p.x, p.y - centerY);
      return (
        radius <=
        boundary(p.z, Math.atan2(p.y - centerY, p.x)).radius - clearance
      );
    },
  };
}

function wingChord(root: T.Object3D, wing: T.Object3D) {
  const triangles: T.Vector3[][] = [];
  for (const node of fixedWingSkins(wing)) {
    const positions = node.geometry.getAttribute("position"),
      index = node.geometry.index;
    for (let i = 0; i < (index?.count ?? positions.count); i += 3)
      triangles.push(
        [0, 1, 2].map((j) =>
          new T.Vector3()
            .fromBufferAttribute(positions, index ? index.getX(i + j) : i + j)
            .applyMatrix4(node.matrixWorld),
        ),
      );
  }
  return (x: number) => {
    let leading = Infinity,
      trailing = -Infinity;
    for (const t of triangles)
      for (let i = 0; i < 3; i++) {
        const a = t[i],
          b = t[(i + 1) % 3];
        if ((a.x <= x && b.x > x) || (b.x <= x && a.x > x)) {
          const z = T.MathUtils.lerp(a.z, b.z, (x - a.x) / (b.x - a.x));
          leading = Math.min(leading, z);
          trailing = Math.max(trailing, z);
        }
      }
    if (!Number.isFinite(leading)) throw new Error(`Missing wing station ${x}`);
    return { leading, trailing };
  };
}

export function makeFleetInternals(root: T.Object3D, id: JetId) {
  root.updateWorldMatrix(true, true);
  const layout = layouts[id],
    skin = bodySkin(root, id),
    installation = new T.Group();
  installation.name = "InteriorInstallation";
  const systems = new T.Group();
  systems.name = "InternalSystems";
  const hardware = aircraftSystems[id];
  systems.userData.hardware = hardware;
  systems.userData.mechanical = true;
  systems.userData.packaging_scope =
    "Measured concept packaging; not validated mass, fuel usability or airworthiness";
  installation.add(systems);
  const palette = {
    metal: new T.MeshStandardMaterial({
      name: "Systems | satin aluminium",
      color: "#98a6ab",
      metalness: 0.78,
      roughness: 0.4,
    }),
    frame: new T.MeshStandardMaterial({
      name: "Systems | graphite structure",
      color: "#34434a",
      metalness: 0.28,
      roughness: 0.54,
    }),
    equipment: new T.MeshStandardMaterial({
      name: "Systems | avionics blue grey",
      color: "#526c77",
      metalness: 0.18,
      roughness: 0.54,
    }),
    hose: new T.MeshStandardMaterial({
      name: "Systems | protective sleeves",
      color: "#20272b",
      roughness: 0.85,
    }),
    fluid: new T.MeshStandardMaterial({
      name: "Systems | fuel inspection envelope",
      color: "#b69249",
      transparent: true,
      opacity: 0.24,
      depthWrite: false,
      roughness: 0.7,
      side: T.DoubleSide,
    }),
    hydraulic: new T.MeshStandardMaterial({
      name: "Systems | hydraulic service",
      color: "#628f8d",
      metalness: 0.48,
      roughness: 0.42,
    }),
  };
  const parts: { name: string; region: string; triangles: number }[] = [],
    cells: { name: string; envelopeLitres: number }[] = [];
  function group(name: string, parent: T.Object3D = systems) {
    const g = new T.Group();
    g.name = name;
    parent.add(g);
    return g;
  }
  function add(
    name: string,
    geometry: T.BufferGeometry,
    material: T.Material,
    parent: T.Object3D,
    region = "body",
  ) {
    const node = new T.Mesh(geometry, material);
    node.name = name;
    node.userData.internal = true;
    node.userData.installationRegion = region;
    parent.add(node);
    parts.push({
      name,
      region,
      triangles:
        (geometry.index?.count ?? geometry.getAttribute("position").count) / 3,
    });
    return node;
  }
  function box(
    name: string,
    center: number[],
    size: number[],
    mat: T.Material,
    parent: T.Object3D,
    region = "body",
  ) {
    const geometry = new RoundedBoxGeometry(
      size[0],
      size[1],
      size[2],
      1,
      Math.min(...size) * 0.12,
    );
    geometry.translate(...(center as [number, number, number]));
    return add(name, geometry, mat, parent, region);
  }
  function line(
    name: string,
    points: T.Vector3[],
    radius: number,
    mat: T.Material,
    parent: T.Object3D,
    region = "body",
  ) {
    const closed = points[0].equals(points[points.length - 1]);
    return add(
      name,
      new T.TubeGeometry(
        new T.CatmullRomCurve3(closed ? points.slice(0, -1) : points, closed),
        closed
          ? points.length - 1
          : Math.max(8, points.length * (points.length > 100 ? 1 : 4)),
        radius,
        8,
        closed,
      ),
      mat,
      parent,
      region,
    );
  }
  function cell(
    name: string,
    geometry: T.BufferGeometry,
    parent: T.Object3D,
    region: string,
  ) {
    const p = geometry.getAttribute("position"),
      ix = geometry.index;
    let volume = 0;
    const a = new T.Vector3(),
      b = new T.Vector3(),
      c = new T.Vector3();
    for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
      a.fromBufferAttribute(p, ix ? ix.getX(i) : i);
      b.fromBufferAttribute(p, ix ? ix.getX(i + 1) : i + 1);
      c.fromBufferAttribute(p, ix ? ix.getX(i + 2) : i + 2);
      volume += a.dot(b.cross(c)) / 6;
    }
    const envelopeLitres =
      Math.abs(volume) * 1000 * aircraftCatalog[id].scale ** 3;
    const node = add(name, geometry, palette.fluid, parent, region);
    node.userData.envelopeLitres = envelopeLitres;
    node.userData.volumeBasis =
      "Geometric envelope; unusable fuel and expansion allowance not calibrated";
    cells.push({ name, envelopeLitres });
    return node;
  }

  const wall = group("RearCabinBulkhead", installation);
  let ring: T.Vector3[] = [];
  for (let i = 0; i < 64; i++) {
    const at = skin.boundary(layout.wallZ, (Math.PI * 2 * i) / 64);
    const p = at.point.clone().addScaledVector(at.direction, -0.045);
    ring.push(p);
  }
  const clipped: T.Vector3[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      floor = layout.floorY + 0.015;
    if (a.y >= floor) clipped.push(a);
    if (a.y < floor !== b.y < floor)
      clipped.push(a.clone().lerp(b, (floor - a.y) / (b.y - a.y)));
  }
  ring = clipped;
  const wallLow = Math.min(...ring.map((p) => p.y)),
    wallHigh = Math.max(...ring.map((p) => p.y)),
    wallY = (wallLow + wallHigh) / 2;
  const hatchHeight = Math.min(layout.unit * 0.8, (wallHigh - wallLow) * 0.75);
  const shape = new T.Shape(ring.map((p) => new T.Vector2(p.x, p.y)));
  const wallGeometry = new T.ExtrudeGeometry(shape, {
    depth: 0.024,
    bevelEnabled: false,
    curveSegments: 1,
  });
  wallGeometry.translate(0, 0, layout.wallZ - 0.012);
  add("Fitted aft cabin partition", wallGeometry, palette.frame, wall);
  line(
    "Partition perimeter seal",
    [...ring, ring[0]],
    0.008,
    palette.hose,
    wall,
  );
  box(
    "Bulkhead access panel",
    [0, wallY, layout.wallZ - 0.026],
    [layout.unit * 0.72, hatchHeight, 0.025],
    palette.metal,
    wall,
  );
  box(
    "Access panel inset",
    [0, wallY, layout.wallZ - 0.042],
    [layout.unit * 0.65, hatchHeight * 0.9, 0.008],
    palette.frame,
    wall,
  );
  for (const x of [-1, 1])
    for (const y of [-1, 1])
      box(
        "Captive service fastener",
        [
          x * layout.unit * 0.28,
          wallY + y * hatchHeight * 0.38,
          layout.wallZ - 0.05,
        ],
        [0.008, 0.008, 0.008],
        palette.metal,
        wall,
      );
  wall.userData.inspectionEye = [
    0,
    wallY + 0.1,
    layout.wallZ - (id === "peregrine" ? 0.48 : layout.unit * 1.1),
  ];
  wall.userData.inspectionTarget = [0, wallY, layout.wallZ];
  wall.userData.inspectionFov = 76;
  if (id === "aurelia")
    wall.userData.purpose =
      "Aft passenger-cabin pressure partition and service access";
  else
    wall.userData.purpose = "Separates cockpit and equipment/fuel installation";

  const structure = group("FuselageStructure");
  const frameStations =
    id === "aurelia"
      ? [-6.2, -3.9, -1.6, 0.7, 3, 5.3, 8.8]
      : id === "peregrine"
        ? [-5.3, -3.4, -1.4, 2.9]
        : [-1.9, -0.5, 0.9, 2.3];
  for (const z of frameStations) {
    const points = Array.from({ length: 257 }, (_, i) => {
      const at = skin.boundary(z, (Math.PI * i) / 256);
      const p = at.point.clone().addScaledVector(at.direction, -0.08);
      p.y = Math.max(layout.floorY + 0.04, p.y);
      const atFloor = skin.boundary(z, Math.atan2(p.y - layout.centerY, p.x));
      const radius = Math.hypot(p.x, p.y - layout.centerY);
      if (radius > atFloor.radius - 0.08)
        p.copy(atFloor.point).addScaledVector(atFloor.direction, -0.08);
      return p;
    });
    // Upper cabin frames terminate at the floor; intake/engine ducts below remain separate.
    line("Cabin structural frame " + z, points, 0.01, palette.metal, structure);
  }
  for (const angle of [
    Math.PI * 0.2,
    Math.PI * 0.4,
    Math.PI * 0.6,
    Math.PI * 0.8,
  ]) {
    const points = Array.from({ length: 12 }, (_, i) => {
      const z = T.MathUtils.lerp(
        frameStations[0],
        frameStations[frameStations.length - 1],
        i / 11,
      );
      const at = skin.boundary(z, angle);
      return at.point.clone().addScaledVector(at.direction, -0.08);
    });
    line("Fuselage longeron " + angle, points, 0.008, palette.frame, structure);
  }

  const dry = group(
      id === "aurelia" ? "ForwardEquipmentBay" : "AftEquipmentBay",
    ),
    u = layout.unit,
    z = layout.equipmentZ,
    y = layout.equipmentY;
  box(
    "Isolated equipment tray",
    [0, y - u * 0.35, z],
    [u * 1.35, 0.024, u * 1.45],
    palette.metal,
    dry,
  );
  for (const x of [-0.48, 0.48])
    box(
      "Tray structural bearer",
      [x * u, y - u * 0.38, z],
      [u * 0.06, 0.04, u * 1.5],
      palette.frame,
      dry,
    );
  function support(name: string, top: T.Vector3, parent: T.Object3D) {
    const at = skin.boundary(top.z, Math.atan2(-1, top.x));
    const foot =
      id === "aurelia"
        ? new T.Vector3(top.x, layout.floorY + 0.04, top.z)
        : at.point.clone().addScaledVector(at.direction, -0.065);
    line(
      name + " structural standoff",
      [foot, top],
      u * 0.018,
      palette.metal,
      parent,
    );
    box(
      name + " isolated mounting foot",
      foot.toArray(),
      [0.05, 0.015, 0.05],
      palette.frame,
      parent,
    );
  }
  for (const side of [-1, 1])
    for (const end of [-1, 1])
      support(
        "Equipment tray",
        new T.Vector3(side * u * 0.48, y - u * 0.4, z + end * u * 0.55),
        dry,
      );
  for (let i = 0; i < hardware.batteryCount; i++)
    box(
      `${hardware.model} ${hardware.batteryVolts}V/${hardware.batteryAh}Ah battery ${i + 1}`,
      [
        -u * 0.35,
        y - u * 0.08,
        z - u * 0.18 + (i - (hardware.batteryCount - 1) / 2) * u * 0.29,
      ],
      [
        u * (id === "stormbird" ? 0.51 : 0.48),
        u * 0.46,
        (u * 0.58) / hardware.batteryCount - 0.006,
      ],
      palette.hose,
      dry,
    );
  box(
    hardware.model + " battery isolator cradle",
    [-u * 0.35, y - u * 0.328, z - u * 0.18],
    [u * (id === "stormbird" ? 0.51 : 0.48), u * 0.035, u * 0.5],
    palette.frame,
    dry,
  );
  for (const s of [-1, 1])
    box(
      "Battery retaining strap",
      [-u * 0.35, y + u * 0.16, z - u * 0.18 + s * u * 0.16],
      [u * 0.52, u * 0.035, u * 0.025],
      palette.metal,
      dry,
    );
  for (let i = 0; i < hardware.avionicsModules; i++)
    box(
      `${hardware.model} avionics module ${i + 1}`,
      [
        u * 0.35,
        y +
          ((i - (hardware.avionicsModules - 1) / 2) * u * 0.58) /
            hardware.avionicsModules,
        z,
      ],
      [
        u * (id === "aurelia" ? 0.42 : 0.46),
        (u * 0.52) / hardware.avionicsModules,
        u * (id === "stormbird" ? 0.59 : id === "aurelia" ? 0.56 : 0.65),
      ],
      palette.equipment,
      dry,
    );
  box(
    hardware.model + " electrical bus distribution",
    [-u * 0.34, y - u * 0.11, z + u * 0.42],
    [u * 0.42, u * 0.35, u * 0.22],
    palette.frame,
    dry,
  );
  box(
    hardware.model + " rack heat spreader",
    [u * 0.35, y + u * 0.294, z],
    [
      u * (id === "aurelia" ? 0.42 : 0.46),
      u * 0.04,
      u * (id === "stormbird" ? 0.59 : id === "aurelia" ? 0.56 : 0.65),
    ],
    palette.metal,
    dry,
  );
  for (let i = 0; i < 6; i++)
    box(
      "Avionics cooling fin",
      [u * 0.35, y + u * 0.34, z - u * 0.26 + i * u * 0.1],
      [u * 0.43, u * 0.055, u * 0.015],
      palette.metal,
      dry,
    );
  line(
    "Protected electrical harness",
    [
      new T.Vector3(-u * 0.35, y + u * 0.18, z - u * 0.18),
      new T.Vector3(-u * 0.67, y + u * 0.18, z - u * 0.18),
      new T.Vector3(-u * 0.67, y + u * 0.18, z + u * 0.42),
      new T.Vector3(-u * 0.35, y + u * 0.12, z + u * 0.42),
    ],
    0.008,
    palette.hose,
    dry,
  );
  line(
    "Shielded avionics loom",
    [
      new T.Vector3(u * 0.55, y, z),
      new T.Vector3(u * 0.7, y, z),
      new T.Vector3(u * 0.7, y, z + u * 0.5),
    ],
    0.006,
    palette.hose,
    dry,
  );
  for (const s of [-1, 1])
    for (const t of [-0.18, 0.15, 0.4])
      box(
        "Harness support clamp",
        [s * u * 0.67, y + u * 0.17, z + u * t],
        [0.025, 0.025, 0.016],
        palette.metal,
        dry,
      );
  const pressure = group("HydraulicServiceBay");
  const py = y - u * 0.05,
    pz = z + u * 1.3;
  for (let i = 0; i < hardware.hydraulicCircuits; i++)
    box(
      `${hardware.model} ${hardware.pressureMPa}MPa primary manifold ${i + 1}`,
      [(i - (hardware.hydraulicCircuits - 1) / 2) * u * 0.34, py, pz],
      [
        (u * 0.62) / hardware.hydraulicCircuits,
        u * (id === "aurelia" ? 0.16 : 0.22),
        u * 0.4,
      ],
      palette.hydraulic,
      pressure,
    );
  box(
    "Hydraulic service tray",
    [0, py - u * 0.17, pz],
    [u * 1.0, 0.018, u * 0.8],
    palette.frame,
    pressure,
  );
  for (const side of [-1, 1])
    support(
      "Hydraulic tray",
      new T.Vector3(side * u * 0.4, py - u * 0.19, pz),
      pressure,
    );
  for (let i = 0; i < hardware.accumulatorCount; i++) {
    const s = i % 2 ? 1 : -1;
    const paired = hardware.accumulatorCount > 2;
    const accumulatorZ = pz + (paired ? (i < 2 ? -0.16 : 0.16) * u : 0);
    const geometry = new T.CylinderGeometry(
      u * (paired ? 0.075 : 0.1),
      u * (paired ? 0.075 : 0.1),
      u * (paired ? 0.25 : 0.58),
      12,
    );
    geometry.rotateX(Math.PI / 2);
    geometry.translate(s * u * 0.38, py, accumulatorZ);
    add(
      hardware.model + " hydraulic accumulator " + (i + 1),
      geometry,
      palette.metal,
      pressure,
    );
    line(
      hardware.model + " protected hydraulic feed " + (i + 1),
      [
        new T.Vector3(s * u * 0.38, py, accumulatorZ),
        new T.Vector3(s * u * 0.38, py - u * 0.15, pz + u * 0.45),
        new T.Vector3(s * u * 0.6, py - u * 0.15, pz + u * 0.65),
      ],
      0.004,
      palette.hydraulic,
      pressure,
    );
  }
  if (id === "aurelia")
    box(
      "S32 electric standby hydraulic unit",
      [u * 0.38, py, pz],
      [u * 0.18, u * 0.17, u * 0.48],
      palette.equipment,
      pressure,
    );

  const fuel = group("FuelSystem");
  if (layout.centerTank) {
    const centre = group("CentreFuelBay", fuel);
    const [x, yy, zz, w, h, l] = layout.centerTank;
    const geometry = new RoundedBoxGeometry(w, h, l, 1, 0.04);
    geometry.translate(x, yy, zz);
    cell("Centre fuselage fuel cell", geometry, centre, "body");
    for (const s of [-1, 1]) {
      box(
        "Centre fuel baffle",
        [x, yy, zz + s * l * 0.24],
        [w * 0.94, h * 0.92, 0.012],
        palette.metal,
        centre,
      );
      line(
        "Centre fuel feed " + s,
        [
          new T.Vector3(s * w * 0.3, yy - h * 0.36, zz),
          new T.Vector3(s * w * 0.35, yy - h * 0.36, zz + l * 0.35),
        ],
        0.006,
        palette.hose,
        centre,
      );
      box(
        "Fuel cell isolator " + s,
        [x, yy - h * 0.5 - 0.01, zz + s * l * 0.27],
        [w * 0.75, 0.016, 0.06],
        palette.hose,
        centre,
      );
    }
    box(
      "Fuel collector and pickup",
      [x, yy - h * 0.42, zz],
      [0.09, 0.032, 0.13],
      palette.equipment,
      centre,
    );
  }

  const samplers = new Map<string, ReturnType<typeof wingSampler>>();
  for (const side of ["Left", "Right"]) {
    const wing = root.getObjectByName("Wing_" + side)!;
    const sample = wingSampler(root, wing);
    samplers.set(wing.name, sample);
    const chord = wingChord(root, wing),
      bounds = new T.Box3();
    for (const s of fixedWingSkins(wing))
      bounds.union(new T.Box3().setFromObject(s));
    const sign = side === "Right" ? 1 : -1;
    const rootX = sign === 1 ? bounds.min.x : -bounds.max.x,
      tipX = sign === 1 ? bounds.max.x : -bounds.min.x;
    const x0 = id === "stormbird" ? 2.05 : rootX + (tipX - rootX) * 0.15;
    const x1 = id === "stormbird" ? 5.45 : rootX + (tipX - rootX) * 0.75;
    const xs = Array.from(
      { length: 13 },
      (_, i) => sign * T.MathUtils.lerp(x0, x1, i / 12),
    );
    const margin = id === "aurelia" ? 0.02 : 0.014;
    function volume(stations: number[], from: number, to: number) {
      const positions: number[] = [],
        indices: number[] = [],
        nz = 9;
      for (const layer of [0, 1])
        for (const x of stations) {
          const { leading, trailing } = chord(x);
          for (let i = 0; i < nz; i++) {
            const z = T.MathUtils.lerp(
              leading,
              trailing,
              T.MathUtils.lerp(from, to, i / (nz - 1)),
            );
            const at = sample(x, z);
            if (at.upper - at.lower < margin * 2 + 0.005)
              throw new Error(
                `Insufficient wing depth ${id} ${side} ${x} ${z}`,
              );
            positions.push(x, layer ? at.upper - margin : at.lower + margin, z);
          }
        }
      const n = stations.length * nz,
        quad = (a: number, b: number, c: number, d: number) =>
          indices.push(a, b, c, a, c, d);
      for (let x = 0; x < stations.length - 1; x++)
        for (let j = 0; j < nz - 1; j++) {
          const a = x * nz + j;
          quad(a, a + nz, a + nz + 1, a + 1);
          quad(a + n, a + n + 1, a + n + nz + 1, a + n + nz);
        }
      const boundary = [
        ...Array.from({ length: nz }, (_, i) => i),
        ...Array.from(
          { length: stations.length - 1 },
          (_, i) => (i + 1) * nz + nz - 1,
        ),
        ...Array.from({ length: nz - 1 }, (_, i) => n - 2 - i),
        ...Array.from(
          { length: stations.length - 2 },
          (_, i) => (stations.length - 2 - i) * nz,
        ),
      ];
      for (let i = 0; i < boundary.length; i++) {
        const a = boundary[i],
          b = boundary[(i + 1) % boundary.length];
        quad(a, b, b + n, a + n);
      }
      const geometry = new T.BufferGeometry();
      geometry.setAttribute(
        "position",
        new T.Float32BufferAttribute(positions, 3),
      );
      geometry.setIndex(indices);
      if (sign === -1) {
        const index = geometry.index!;
        for (let i = 0; i < index.count; i += 3) {
          const a = index.getX(i);
          index.setX(i, index.getX(i + 2));
          index.setX(i + 2, a);
        }
      }
      geometry.computeVertexNormals();
      return geometry;
    }
    const structure = group("WingStructure_" + side),
      region = "Wing_" + side;
    add(
      "Front spar " + side,
      volume(xs, 0.215, 0.222),
      palette.metal,
      structure,
      region,
    );
    add(
      "Rear spar " + side,
      volume(xs, 0.735, 0.742),
      palette.metal,
      structure,
      region,
    );
    const wingFuel = group("WetWingFuel_" + side, fuel);
    cell(
      "Integral wing fuel envelope " + side,
      volume(xs, 0.24, 0.7),
      wingFuel,
      region,
    );
    for (let i = 1; i < 12; i += 2) {
      const x = xs[i];
      add(
        "Structural rib " + side + " " + i,
        volume([x - sign * 0.009, x + sign * 0.009], 0.23, 0.72),
        palette.frame,
        structure,
        region,
      );
      add(
        "Fuel baffle " + side + " " + i,
        volume([x - sign * 0.004, x + sign * 0.004], 0.25, 0.69),
        palette.metal,
        wingFuel,
        region,
      );
    }
    const feed: T.Vector3[] = [],
      hydraulic: T.Vector3[] = [],
      vent: T.Vector3[] = [];
    for (const x of xs) {
      const at = chord(x);
      for (const [list, f] of [
        [feed, 0.34],
        [hydraulic, 0.79],
        [vent, 0.63],
      ] as const) {
        const z = T.MathUtils.lerp(at.leading, at.trailing, f),
          section = sample(x, z);
        list.push(new T.Vector3(x, (section.lower + section.upper) / 2, z));
      }
    }
    line(
      "Fuel collector feed " + side,
      feed,
      0.004,
      palette.hose,
      wingFuel,
      region,
    );
    line(
      "Wing vent gallery " + side,
      vent,
      0.003,
      palette.metal,
      wingFuel,
      region,
    );
    line(
      "Trailing edge hydraulic supply " + side,
      hydraulic,
      0.003,
      palette.hydraulic,
      structure,
      region,
    );
    for (let i = 0; i < hardware.fuelPumpsPerWing; i++) {
      const p = feed[i],
        depth = sample(p.x, p.z);
      box(
        `${hardware.model} fuel boost pump ${side} ${i + 1}`,
        p.toArray(),
        [
          id === "aurelia" ? 0.065 : id === "stormbird" ? 0.1 : 0.08,
          Math.min(0.05, (depth.upper - depth.lower) * 0.25),
          id === "stormbird" ? 0.15 : 0.13,
        ],
        palette.equipment,
        wingFuel,
        region,
      );
    }
  }

  // Fit the actual stiffener surfaces into local shell recesses (notably the
  // transport's window belt). A centreline-only fit misses these sharp returns.
  for (const fitted of [structure, wall])
    fitted.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      const positions = node.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const p = new T.Vector3().fromBufferAttribute(positions, i);
        const at = skin.boundary(p.z, Math.atan2(p.y - layout.centerY, p.x));
        if (Math.hypot(p.x, p.y - layout.centerY) > at.radius - 0.025) {
          p.copy(at.point).addScaledVector(at.direction, -0.025);
          positions.setXYZ(i, p.x, p.y, p.z);
        }
      }
      node.geometry.computeVertexNormals();
    });
  installation.updateWorldMatrix(true, true);
  let checked = 0;
  installation.traverse((node) => {
    if (!(node instanceof T.Mesh)) return;
    const region = node.userData.installationRegion,
      p = node.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const point = new T.Vector3()
        .fromBufferAttribute(p, i)
        .applyMatrix4(node.matrixWorld);
      if (region === "body") {
        if (!skin.contains(point, 0.002))
          throw new Error(
            `${id}: ${node.name} exceeds body at ${point.toArray()}`,
          );
      } else {
        const wing = root.getObjectByName(region)!;
        const at = samplers.get(region)!(point.x, point.z);
        if (point.y < at.lower + 0.001 || point.y > at.upper - 0.001)
          throw new Error(
            `${id}: ${node.name} exceeds wing skin at ${point.toArray()}`,
          );
      }
      checked++;
    }
  });
  systems.userData.fuelEnvelopeLitres = cells.reduce(
    (sum, c) => sum + c.envelopeLitres,
    0,
  );
  systems.userData.fuelLayout =
    id === "aurelia"
      ? "Integral wing cells; passenger floor and gear bays preserved"
      : "Integral wing cells and centre fuselage cell";
  systems.userData.physics_mass_updated = false;
  systems.userData.partCount = parts.length;
  return {
    installation,
    report: {
      id,
      parts,
      cells,
      containedVertices: checked,
      fuelEnvelopeLitres: systems.userData.fuelEnvelopeLitres,
      scope:
        "Fitted concept geometry; usable fuel and mass/CG calibration remain separate",
      references: [
        "https://www.airbus.com/en/newsroom/stories/2023-06-the-wonder-of-wings",
      ],
    },
  };
}
