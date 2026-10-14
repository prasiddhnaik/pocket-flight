import * as T from "three";
export type Doc = {
  nodes: {
    name?: string;
    children?: number[];
    mesh?: number;
    extras?: Record<string, unknown>;
  }[];
  meshes: {
    primitives: {
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
    }[];
  }[];
  materials: unknown[];
  accessors: Record<string, unknown>[];
  bufferViews: Record<string, number>[];
  buffers: { uri?: string; byteLength: number }[];
  scenes: { nodes: number[] }[];
  scene?: number;
  extras?: Record<string, unknown>;
};
export function compile(base: Doc, installation: T.Object3D, filename: string) {
  const doc: Doc = structuredClone(base),
    buffer = doc.buffers.length,
    chunks: Uint8Array[] = [],
    materialIds = new Map<T.Material, number>();
  let bytes = 0;
  function attribute(values: Float32Array | Uint32Array, type: string) {
    const data = new Uint8Array(
        values.buffer,
        values.byteOffset,
        values.byteLength,
      ),
      view = doc.bufferViews.length;
    doc.bufferViews.push({
      buffer,
      byteOffset: bytes,
      byteLength: data.length,
      target: type === "SCALAR" ? 34963 : 34962,
    });
    chunks.push(data);
    bytes += data.length;
    const accessor: Record<string, unknown> = {
      bufferView: view,
      componentType: type === "SCALAR" ? 5125 : 5126,
      count: values.length / (type === "SCALAR" ? 1 : 3),
      type,
    };
    if (type === "VEC3") {
      accessor.min = [0, 1, 2].map((k) => {
        let v = Infinity;
        for (let i = k; i < values.length; i += 3) v = Math.min(v, values[i]);
        return v;
      });
      accessor.max = [0, 1, 2].map((k) => {
        let v = -Infinity;
        for (let i = k; i < values.length; i += 3) v = Math.max(v, values[i]);
        return v;
      });
    }
    doc.accessors.push(accessor);
    return doc.accessors.length - 1;
  }
  function material(source: T.MeshStandardMaterial) {
    const known = materialIds.get(source);
    if (known !== undefined) return known;
    const index = doc.materials.length;
    doc.materials.push({
      name: source.name,
      pbrMetallicRoughness: {
        baseColorFactor: [...source.color.toArray(), source.opacity],
        metallicFactor: source.metalness,
        roughnessFactor: source.roughness,
      },
      ...(source.transparent ? { alphaMode: "BLEND" } : {}),
      doubleSided: source.side === T.DoubleSide,
    });
    materialIds.set(source, index);
    return index;
  }
  function node(source: T.Object3D): number {
    const index = doc.nodes.length,
      item: Doc["nodes"][number] = {
        name: source.name,
        extras: structuredClone(source.userData),
      };
    doc.nodes.push(item);
    if (source instanceof T.Mesh) {
      const geometry = source.geometry;
      const position = geometry.getAttribute("position").array as Float32Array,
        normal = geometry.getAttribute("normal").array as Float32Array;
      if (!position.every(Number.isFinite) || !normal.every(Number.isFinite))
        throw new Error("Nonfinite internal geometry");
      item.mesh = doc.meshes.length;
      doc.meshes.push({
        primitives: [
          {
            attributes: {
              POSITION: attribute(position, "VEC3"),
              NORMAL: attribute(normal, "VEC3"),
            },
            material: material(source.material as T.MeshStandardMaterial),
            ...(geometry.index
              ? {
                  indices: attribute(
                    new Uint32Array(geometry.index.array),
                    "SCALAR",
                  ),
                }
              : {}),
          },
        ],
      });
    }
    if (source.children.length) item.children = source.children.map(node);
    return index;
  }
  doc.scenes[doc.scene ?? 0].nodes.push(node(installation));
  doc.buffers.push({ uri: filename, byteLength: bytes });
  doc.extras = { ...doc.extras, internal_systems_revision: 1 };
  const binary = new Uint8Array(bytes);
  let offset = 0;
  for (const data of chunks) {
    binary.set(data, offset);
    offset += data.length;
  }
  return { doc, binary };
}
export function glb(doc: Doc, binary: Uint8Array) {
  const json = new TextEncoder().encode(JSON.stringify(doc)),
    length = Math.ceil(json.length / 4) * 4;
  const out = new Uint8Array(28 + length + binary.length),
    header = new DataView(out.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, out.length, true);
  header.setUint32(12, length, true);
  header.setUint32(16, 0x4e4f534a, true);
  out.fill(32, 20, 20 + length);
  out.set(json, 20);
  header.setUint32(20 + length, binary.length, true);
  header.setUint32(24 + length, 0x004e4942, true);
  out.set(binary, 28 + length);
  return out;
}
