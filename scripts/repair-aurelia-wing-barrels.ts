import * as T from "three";
import { loadGeometryOnly } from "./geometry-loader";
import { connectedSurfaces } from "./geometry-components";

// Repair the preserved base, then fleet:internals reuses it on every rebuild.
const path = new URL(
  "../output/fleet-internals-before/aurelia-flight.glb",
  import.meta.url,
);
const bytes = new Uint8Array(await Bun.file(path).arrayBuffer()),
  view = new DataView(bytes.buffer);
const length = view.getUint32(12, true),
  doc = JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + length)));
if (!doc.extras?.enclosed_wing_mechanisms_revision) {
  const { scene } = await loadGeometryOnly(path);
  scene.updateWorldMatrix(true, true);
  for (const side of ["Left", "Right"]) {
    const node = doc.nodes.find(
      (n: { name?: string }) =>
        n.name?.startsWith(`Wing_${side}`) && /Machined titanium/.test(n.name),
    );
    const mesh = scene.getObjectByName(node.name.replace(/\s/g, "_")) as T.Mesh;
    if (!mesh) throw Error("Missing original wing titanium mesh");
    const parts = connectedSurfaces(mesh),
      barrels = parts.filter((p) => {
        const s = p.bounds.getSize(new T.Vector3());
        return (
          s.x > 0.17 &&
          s.x < 0.19 &&
          s.y > 0.07 &&
          s.y < 0.08 &&
          s.z > 0.07 &&
          s.z < 0.08
        );
      });
    if (barrels.length !== 5)
      throw Error(`${side}: unexpected original actuator geometry`);
    const keep = parts
      .filter((p) => !barrels.includes(p))
      .flatMap((p) => p.indices);
    const a = doc.accessors[doc.meshes[node.mesh].primitives[0].indices],
      b = doc.bufferViews[a.bufferView];
    if (b.buffer !== 0)
      throw Error("Expected the original embedded mesh buffer");
    const offset = 28 + length + (b.byteOffset ?? 0) + (a.byteOffset ?? 0),
      stride = a.componentType === 5125 ? 4 : 2;
    if (a.componentType !== 5125 && a.componentType !== 5123)
      throw Error("Unsupported index type");
    keep.forEach((v, i) =>
      stride === 4
        ? view.setUint32(offset + i * stride, v, true)
        : view.setUint16(offset + i * stride, v, true),
    );
    a.count = keep.length;
    if (a.min) a.min = [Math.min(...keep)];
    if (a.max) a.max = [Math.max(...keep)];
    node.extras = {
      ...node.extras,
      wing_hardware_repair:
        "Removed five exposed decorative hinge barrels; live actuators installed inside measured fixed wing",
    };
    console.log(
      side,
      "removed",
      barrels.reduce((n, p) => n + p.indices.length / 3, 0),
      "barrel triangles; preserved",
      keep.length / 3,
      "cap triangles",
    );
  }
  doc.extras = { ...doc.extras, enclosed_wing_mechanisms_revision: 1 };
  const json = new TextEncoder().encode(JSON.stringify(doc)),
    size = Math.ceil(json.length / 4) * 4,
    bin = bytes.slice(28 + length);
  const output = new Uint8Array(28 + size + bin.length),
    header = new DataView(output.buffer);
  header.setUint32(0, 0x46546c67, true);
  header.setUint32(4, 2, true);
  header.setUint32(8, output.length, true);
  header.setUint32(12, size, true);
  header.setUint32(16, 0x4e4f534a, true);
  output.fill(32, 20, 20 + size);
  output.set(json, 20);
  header.setUint32(20 + size, bin.length, true);
  header.setUint32(24 + size, 0x004e4942, true);
  output.set(bin, 28 + size);
  await Bun.write(path, output);
}
console.log("AURELIA_WING_BARRELS_REPAIRED");
