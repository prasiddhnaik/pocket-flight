import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import * as T from "three";
import { makeAureliaReference } from "../src/aircraft/aurelia/reference-model";
import {
  aureliaExteriorReference,
  aureliaAirframeScale,
} from "../src/aircraft/aurelia/exterior-reference";
import {
  neutralExteriorPose,
  poseAureliaExterior,
} from "../src/aircraft/aurelia/exterior-mechanisms";
import { compile, glb, type Doc } from "./gltf-installation";

const destination = new URL(
  "../public/assets/aurelia-phenom300e.glb",
  import.meta.url,
);
const { root } = makeAureliaReference();
poseAureliaExterior(root, neutralExteriorPose());
const base: Doc = {
  nodes: [],
  meshes: [],
  materials: [],
  accessors: [],
  bufferViews: [],
  buffers: [],
  scenes: [{ nodes: [] }],
};
const result = compile(base, root, "aurelia-phenom300e.bin");
const objects: T.Object3D[] = [];
root.traverse((o) => objects.push(o));
// The existing installation serializer stores geometry. The complete exterior
// additionally needs its local pivot transforms for independent GLB consumers.
objects.forEach((o, i) =>
  Object.assign(result.doc.nodes[i], {
    translation: o.position.toArray(),
    rotation: o.quaternion.toArray(),
    scale: o.scale.toArray(),
  }),
);
delete result.doc.buffers[0].uri;
const chunks = [result.binary];
const materials: T.MeshStandardMaterial[] = [];
root.traverse((o) => {
  if (
    o instanceof T.Mesh &&
    !materials.includes(o.material as T.MeshStandardMaterial)
  )
    materials.push(o.material as T.MeshStandardMaterial);
});
materials.forEach((m, i) => {
  if (m.emissiveIntensity > 0 && m.emissive.getHex() !== 0)
    Object.assign(result.doc.materials[i] as object, {
      emissiveFactor: m.emissive
        .clone()
        .multiplyScalar(m.emissiveIntensity)
        .toArray(),
    });
});
let bytes = result.binary.length;
function attribute(values: number[], type: "SCALAR" | "VEC4") {
  const source = new Float32Array(values),
    binary = new Uint8Array(source.buffer);
  const view = result.doc.bufferViews.length;
  result.doc.bufferViews.push({
    buffer: 0,
    byteOffset: bytes,
    byteLength: binary.length,
  });
  chunks.push(binary);
  bytes += binary.length;
  result.doc.accessors.push({
    bufferView: view,
    componentType: 5126,
    count: source.length / (type === "VEC4" ? 4 : 1),
    type,
    ...(type === "SCALAR"
      ? { min: [Math.min(...values)], max: [Math.max(...values)] }
      : {}),
  });
  return result.doc.accessors.length - 1;
}
const times = Array.from({ length: 121 }, (_, i) => i / 20);
const timeAccessor = attribute(times, "SCALAR");
const moving = objects
  .map((o, i) => ({ o, i }))
  .filter(({ o }) => /retraction_hinge|^(Main|Nose).*door_hinge/.test(o.name));
const poses = new Map(moving.map(({ o }) => [o, [] as number[]]));
for (const time of times) {
  poseAureliaExterior(root, { ...neutralExteriorPose(), gear: 1 - time / 6 });
  moving.forEach(({ o }) => poses.get(o)!.push(...o.quaternion.toArray()));
}
const samplers = moving.map(({ o }) => ({
  input: timeAccessor,
  output: attribute(poses.get(o)!, "VEC4"),
  interpolation: "LINEAR",
}));
const channels = moving.map(({ i }, sampler) => ({
  sampler,
  target: { node: i, path: "rotation" },
}));
Object.assign(result.doc, {
  asset: {
    version: "2.0",
    generator: "Pocket Flight reproducible Phenom exterior",
  },
  animations: [{ name: "Gear_retract_6s", samplers, channels }],
});
const sourceFiles = [
  "src/aircraft/aurelia/exterior-reference.ts",
  "src/aircraft/aurelia/exterior.ts",
  "src/aircraft/aurelia/gear-bays.ts",
  "src/aircraft/aurelia/exterior-mechanisms.ts",
  "src/aircraft/aurelia/interior.ts",
  "src/aircraft/aurelia/cockpit-hardware.ts",
  "src/aircraft/aurelia/dashboard.ts",
  "src/aircraft/aurelia/cockpit-layout.ts",
  "src/aircraft/aurelia/cockpit-partition.ts",
  "src/aircraft/aurelia/reference-model.ts",
  "scripts/build-aurelia-exterior.ts",
];
const sourceHasher = new Bun.CryptoHasher("sha256");
for (const path of sourceFiles) {
  sourceHasher.update(path);
  sourceHasher.update(
    await Bun.file(new URL("../" + path, import.meta.url)).arrayBuffer(),
  );
}
const sourceFingerprint = sourceHasher.digest("hex");
result.doc.extras = {
  aureliaExteriorReference,
  airframeScale: aureliaAirframeScale,
  sourceFingerprint,
  scope:
    "Exterior, visual interior and working mechanisms. Flight calibration is a separate milestone.",
};
result.doc.buffers[0].byteLength = bytes;
const binary = new Uint8Array(bytes);
let offset = 0;
for (const chunk of chunks) {
  binary.set(chunk, offset);
  offset += chunk.length;
}
await Bun.write(destination, glb(result.doc, binary));
poseAureliaExterior(root, neutralExteriorPose());
const size = new T.Box3().setFromObject(root).getSize(new T.Vector3());
let triangles = 0;
root.traverse((o) => {
  if (o instanceof T.Mesh)
    triangles +=
      (o.geometry.index?.count ?? o.geometry.getAttribute("position").count) /
      3;
});
await mkdir(new URL("../output/aurelia-phenom/", import.meta.url), {
  recursive: true,
});
await Bun.write(
  new URL("../output/aurelia-phenom/geometry.json", import.meta.url),
  JSON.stringify(
    {
      reference: aureliaExteriorReference,
      airframeScale: aureliaAirframeScale,
      sourceFiles,
      sourceFingerprint,
      asset: fileURLToPath(destination),
      sha256: new Bun.CryptoHasher("sha256")
        .update(await Bun.file(destination).arrayBuffer())
        .digest("hex"),
      dimensions: { span: size.x, height: size.y, length: size.z },
      meshes: objects.filter((o) => o instanceof T.Mesh).length,
      triangles,
      bytes: await Bun.file(destination).size,
      animation: "Gear_retract_6s",
    },
    null,
    2,
  ),
);
console.log(
  "AURELIA_EXTERIOR_BUILT",
  JSON.stringify({
    dimensions: size.toArray(),
    triangles,
    bytes: await Bun.file(destination).size,
  }),
);
