// Reproducible game export from the labeled, tessellated CAD master.
// Fixed components share meshes by material; movable components keep local pivots.
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Quaternion, Vector3 } from "three";

type Point = [number, number, number];
type Part = {
  name: string;
  parents: string[];
  color: number[];
  vertices: Point[];
  faces: Point[];
};
type Node = {
  name: string;
  children?: number[];
  translation?: Point;
  mesh?: number;
  rotation?: [number, number, number, number];
  extras?: object;
};
const root = resolve(import.meta.dir, "..");
const transfer = JSON.parse(
  await readFile(
    resolve(root, "assets/stormbird/GLB/cad-transfer.json"),
    "utf8",
  ),
) as {
  parts: Part[];
  hinges: Record<string, { point: Point; axis: Point }>;
  mechanisms: { segments: Record<string, [Point, Point]> };
};
const nodes: Node[] = [
  {
    name: "Stormbird_HX40",
    children: [],
    extras: { mechanisms: transfer.mechanisms },
  },
];
const orientations = new Map<string, Quaternion>();
const origins = new Map<string, Point>([["Stormbird_HX40", [0, 0, 0]]]);
const nodeIds = new Map([["Stormbird_HX40", 0]]);
const surfaces = /^(Aileron|Flap|Elevator|Rudder|Canard)_(Left|Right)$/;
function hinge(name: string): Point {
  if (transfer.hinges[name]) return transfer.hinges[name].point;
  if (name.endsWith("_suspension"))
    return transfer.hinges[name.replace("_suspension", "")].point;
  if (transfer.mechanisms.segments[name])
    return transfer.mechanisms.segments[name][0];
  if (
    surfaces.test(name) ||
    /^(Canopy|Compressor_|Nose_steering|Main_gear_|Nose_gear|Main_door_|Nose_door_)/.test(
      name,
    )
  )
    throw new Error(`Missing CAD hinge datum: ${name}`);
  return [0, 0, 0];
}
function ensure(name: string, parent = "Stormbird_HX40") {
  if (nodeIds.has(name)) return nodeIds.get(name)!;
  const parentId = ensure(parent);
  const origin = hinge(name),
    parentOrigin = origins.get(parent)!;
  const segment = transfer.mechanisms.segments[name];
  const orientation = segment
    ? new Quaternion().setFromUnitVectors(
        new Vector3(0, 1, 0),
        new Vector3()
          .fromArray(segment[1])
          .sub(new Vector3().fromArray(segment[0]))
          .normalize(),
      )
    : undefined;
  if (orientation) orientations.set(name, orientation);
  const id = nodes.length;
  nodes.push({
    name,
    children: [],
    ...(orientation
      ? { rotation: orientation.toArray() as [number, number, number, number] }
      : {}),
    translation: origin.map((n, i) => n - parentOrigin[i]) as Point,
    ...(transfer.hinges[name]
      ? {
          extras: {
            hinge_glTF: origin,
            hinge_axis: transfer.hinges[name].axis,
          },
        }
      : {}),
  });
  nodeIds.set(name, id);
  origins.set(name, origin);
  nodes[parentId].children!.push(id);
  return id;
}
ensure("Airframe");
ensure("Wing_Left");
ensure("Wing_Right");
ensure("LandingGear");
const batches = new Map<
  string,
  { node: string; material: number; positions: number[]; indices: number[] }
>();
const materials: object[] = [];
const materialIds = new Map<string, number>();
for (const part of transfer.parts) {
  let parent = "Stormbird_HX40";
  for (const name of part.parents.slice(1)) {
    if (
      (name.includes("_wheel_") || name.endsWith("_swivel")) &&
      /^Main_gear_(Left|Right)$/.test(parent)
    ) {
      ensure(parent + "_suspension", parent);
      parent += "_suspension";
    }
    ensure(name, parent);
    parent = name;
  }
  let name = parent === "Stormbird_HX40" ? "Airframe" : parent;
  if (
    surfaces.test(part.name) ||
    /^(Main_door_(Left|Right)_(Left|Right)|Nose_door_(Left|Right))$/.test(
      part.name,
    )
  ) {
    const wingParent = /^(Aileron|Flap)_/.test(part.name)
      ? `Wing_${part.name.split("_")[1]}`
      : parent;
    ensure(part.name, wingParent);
    name = part.name;
  }
  if (
    transfer.mechanisms.segments[part.name] ||
    part.name.endsWith("_scissor_pin")
  ) {
    ensure(part.name, "LandingGear");
    name = part.name;
  } else if (
    /^Main_gear_(Left|Right)$/.test(parent) &&
    /_(piston|lower_collar|axle|fork_|fork_bridge_|brake_)/.test(part.name)
  ) {
    ensure(parent + "_suspension", parent);
    name = parent + "_suspension";
  }
  const glass = part.name === "Canopy_glazing";
  const key = glass ? "Glass • Stormbird canopy" : part.color.join(",");
  let material = materialIds.get(key);
  if (material === undefined) {
    material = materials.length;
    materialIds.set(key, material);
    const rubber = part.color[0] < 0.015;
    const metal =
      part.color[0] > 0.3 && Math.abs(part.color[0] - part.color[2]) < 0.14;
    materials.push({
      name: glass ? key : `Stormbird alloy ${material}`,
      pbrMetallicRoughness: {
        baseColorFactor: [...part.color.slice(0, 3), glass ? 0.34 : 1],
        metallicFactor: glass ? 0.15 : rubber ? 0.02 : metal ? 0.42 : 0.22,
        roughnessFactor: glass ? 0.09 : rubber ? 0.82 : 0.34,
      },
      ...(glass ? { alphaMode: "BLEND", doubleSided: true } : {}),
    });
  }
  const batchKey = `${name}:${material}`;
  let batch = batches.get(batchKey);
  if (!batch) {
    batch = { node: name, material, positions: [], indices: [] };
    batches.set(batchKey, batch);
  }
  const offset = batch.positions.length / 3,
    origin = origins.get(name)!;
  const inverse = orientations.get(name)?.clone().invert();
  for (const point of part.vertices) {
    const local = new Vector3()
      .fromArray(point)
      .sub(new Vector3().fromArray(origin));
    if (inverse) local.applyQuaternion(inverse);
    batch.positions.push(...local.toArray());
  }
  for (const face of part.faces)
    batch.indices.push(...face.map((n) => n + offset));
}
const views: object[] = [],
  accessors: object[] = [],
  meshes: object[] = [],
  chunks: Buffer[] = [];
let bytes = 0;
function accessor(
  data: Float32Array | Uint32Array,
  type: string,
  bounds?: { min: number[]; max: number[] },
) {
  const buffer = Buffer.from(data.buffer),
    padded = Buffer.alloc(Math.ceil(buffer.length / 4) * 4);
  buffer.copy(padded);
  chunks.push(padded);
  const bufferView = views.length;
  views.push({ buffer: 0, byteOffset: bytes, byteLength: buffer.length });
  bytes += padded.length;
  const id = accessors.length;
  accessors.push({
    bufferView,
    componentType: data instanceof Float32Array ? 5126 : 5125,
    count: data.length / (type === "VEC3" ? 3 : 1),
    type,
    ...bounds,
  });
  return id;
}
const a = new Vector3(),
  b = new Vector3(),
  c = new Vector3(),
  n = new Vector3();
let triangles = 0;
for (const batch of batches.values()) {
  const p = new Float32Array(batch.positions),
    normals = new Float32Array(p.length);
  const min = [Infinity, Infinity, Infinity],
    max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) {
    if (!Number.isFinite(p[i]))
      throw new Error(`Nonfinite vertex in ${batch.node}`);
    min[i % 3] = Math.min(min[i % 3], p[i]);
    max[i % 3] = Math.max(max[i % 3], p[i]);
  }
  for (let i = 0; i < batch.indices.length; i += 3) {
    const ids = batch.indices.slice(i, i + 3);
    a.fromArray(p, ids[0] * 3);
    b.fromArray(p, ids[1] * 3);
    c.fromArray(p, ids[2] * 3);
    n.crossVectors(b.sub(a), c.sub(a));
    for (const id of ids)
      for (let axis = 0; axis < 3; axis++)
        normals[id * 3 + axis] += n.getComponent(axis);
  }
  for (let i = 0; i < normals.length; i += 3) {
    n.fromArray(normals, i).normalize();
    n.toArray(normals, i);
  }
  const primitive = {
    attributes: {
      POSITION: accessor(p, "VEC3", { min, max }),
      NORMAL: accessor(normals, "VEC3"),
    },
    indices: accessor(new Uint32Array(batch.indices), "SCALAR"),
    material: batch.material,
  };
  const mesh = meshes.length;
  meshes.push({ name: batch.node, primitives: [primitive] });
  const node = nodes.length;
  nodes.push({ name: `${batch.node}_mesh_${batch.material}`, mesh });
  nodes[nodeIds.get(batch.node)!].children!.push(node);
  triangles += batch.indices.length / 3;
}
const binary = Buffer.concat(chunks);
const document = {
  asset: {
    version: "2.0",
    generator: "Stormbird build123d CAD → Pocket Flight",
  },
  scene: 0,
  scenes: [{ nodes: [0] }],
  nodes,
  meshes,
  materials,
  accessors,
  bufferViews: views,
  buffers: [{ byteLength: binary.length }],
};
const json = Buffer.from(JSON.stringify(document));
const jsonChunk = Buffer.alloc(Math.ceil(json.length / 4) * 4, 0x20);
json.copy(jsonChunk);
const header = Buffer.alloc(20);
header.writeUInt32LE(0x46546c67);
header.writeUInt32LE(2, 4);
header.writeUInt32LE(28 + jsonChunk.length + binary.length, 8);
header.writeUInt32LE(jsonChunk.length, 12);
header.writeUInt32LE(0x4e4f534a, 16);
const binHeader = Buffer.alloc(8);
binHeader.writeUInt32LE(binary.length);
binHeader.writeUInt32LE(0x004e4942, 4);
const output = resolve(root, "public/assets/stormbird-hx40.glb");
const file = Buffer.concat([header, jsonChunk, binHeader, binary]);
await writeFile(output, file);
await writeFile(
  resolve(root, "assets/stormbird/GLB/Stormbird-HX40-game.glb"),
  file,
);
const report = {
  output,
  nodes: nodes.length,
  meshes: meshes.length,
  materials: materials.length,
  triangles,
  vertices: [...batches.values()].reduce(
    (n, b) => n + b.positions.length / 3,
    0,
  ),
  bytes: 28 + jsonChunk.length + binary.length,
  pivots: Object.fromEntries(origins),
};
await mkdir(resolve(root, "assets/stormbird/validation"), { recursive: true });
await writeFile(
  resolve(root, "assets/stormbird/validation/game-export.json"),
  JSON.stringify(report, null, 2),
);
console.log(JSON.stringify(report));
