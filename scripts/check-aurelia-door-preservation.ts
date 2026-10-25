import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type * as T from "three";
import { aircraftMeshes, objectPath } from "./aurelia-attachments";
import { loadGeometryOnly } from "./geometry-loader";

const option = (flag: string, fallback: string) => {
  const index = Bun.argv.indexOf(flag);
  return index < 0 ? fallback : Bun.argv[index + 1];
};
const baseline = resolve(
  option("--before", "output/aurelia-door-realism/before"),
);
const output = resolve(option("--out", "output/aurelia-door-realism"));
const asset = resolve("public/assets/aurelia-phenom300e.glb");
const originals: Record<string, string> = await Bun.file(
  resolve(baseline, "source-hashes.json"),
).json();
const allowed = new Set([
  "src/aircraft/aurelia/cockpit-partition.ts",
  "src/aircraft/aurelia/exterior-mechanisms.ts",
  "tests/aurelia-partition.test.ts",
]);
const changedSources: string[] = [];
for (const [path, original] of Object.entries(originals)) {
  const hash = createHash("sha256")
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest("hex");
  if (hash !== original) {
    assert(allowed.has(path), `Unrelated source changed: ${path}`);
    changedSources.push(path);
  }
}

type ExportMaterial = Record<string, unknown>;
type ExportDocument = {
  nodes: { name: string; mesh?: number }[];
  meshes: { primitives: { material?: number }[] }[];
  materials: ExportMaterial[];
};
async function materials(path: string) {
  const bytes = await Bun.file(path).arrayBuffer();
  const jsonLength = new DataView(bytes).getUint32(12, true);
  const data: ExportDocument = JSON.parse(
    new TextDecoder().decode(new Uint8Array(bytes, 20, jsonLength)),
  );
  return new Map(
    data.nodes
      .filter((node) => node.mesh !== undefined)
      .map((node) => [
        node.name,
        data.meshes[node.mesh!].primitives.map((primitive) =>
          primitive.material === undefined
            ? null
            : data.materials[primitive.material],
        ),
      ]),
  );
}
const [before, after, beforeMaterials, afterMaterials] = await Promise.all([
  loadGeometryOnly(pathToFileURL(resolve(baseline, "aircraft.glb"))),
  loadGeometryOnly(pathToFileURL(asset)),
  materials(resolve(baseline, "aircraft.glb")),
  materials(asset),
]);
const isDoor = (mesh: T.Object3D) => {
  for (let object: T.Object3D | null = mesh; object; object = object.parent)
    if (object.name === "Cockpit_partition") return true;
  return false;
};
const preserved = (root: T.Object3D) =>
  new Map(
    aircraftMeshes(root)
      .filter((mesh) => !isDoor(mesh))
      .map((mesh) => [objectPath(mesh), mesh]),
  );
const prior = preserved(before.scene),
  current = preserved(after.scene);
assert.deepEqual(
  [...current.keys()],
  [...prior.keys()],
  "Non-door mesh inventory or hierarchy changed",
);
let vertices = 0;
for (const [path, original] of prior) {
  const mesh = current.get(path)!;
  assert.deepEqual(
    mesh.matrixWorld.elements,
    original.matrixWorld.elements,
    `${path}: transform changed`,
  );
  assert.deepEqual(
    Object.keys(mesh.geometry.attributes),
    Object.keys(original.geometry.attributes),
    `${path}: attribute set changed`,
  );
  for (const name of Object.keys(original.geometry.attributes)) {
    const a = mesh.geometry.getAttribute(name),
      b = original.geometry.getAttribute(name);
    assert.equal(a.itemSize, b.itemSize, `${path}: ${name} item size changed`);
    assert.deepEqual(a.array, b.array, `${path}: ${name} geometry changed`);
  }
  assert.deepEqual(
    mesh.geometry.index?.array,
    original.geometry.index?.array,
    `${path}: topology changed`,
  );
  assert.deepEqual(
    afterMaterials.get(mesh.name),
    beforeMaterials.get(original.name),
    `${path}: material changed`,
  );
  vertices += mesh.geometry.getAttribute("position").count;
}
const result = {
  pass: true,
  beforeSha256: before.sha256,
  afterSha256: after.sha256,
  sourceFilesChecked: Object.keys(originals).length,
  changedSources,
  unchangedMeshes: prior.size,
  unchangedVertices: vertices,
  checks: [
    "mesh inventory",
    "hierarchy",
    "world transforms",
    "all vertex attributes",
    "indices",
    "materials",
    "source hashes",
  ],
};
await mkdir(output, { recursive: true });
await Bun.write(
  resolve(output, "preservation.json"),
  JSON.stringify(result, null, 2) + "\n",
);
console.log("AURELIA_DOOR_PRESERVATION", JSON.stringify(result));
