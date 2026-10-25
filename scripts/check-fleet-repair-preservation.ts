import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { aircraftCatalog } from "../lab/aircraft";
import { otherAircraft } from "./fleet-attachment-model";

const out = "output/fleet-attachment-repair";
const hashes: Record<string, string> = await Bun.file(
  out + "/before/hashes.json",
).json();
const changed: string[] = [];
const allowed = new Set([
  "public/assets/finch-u2.glb",
  "public/assets/peregrine-hx27.glb",
  "public/assets/stormbird-hx40.gltf",
  "lab/mechanics.ts",
  "scripts/triangle-distance.ts",
  "scripts/measure-finch.ts",
  "src/aircraft/fuel-mass-calibration.json",
  "scripts/check-fleet-attachments.ts",
  "scripts/check-fleet-lab-attachments.ts",
  "tests/fleet-internal-systems.test.ts",
]);
for (const [path, hash] of Object.entries(hashes)) {
  const actual = createHash("sha256")
    .update(new Uint8Array(await Bun.file(path).arrayBuffer()))
    .digest("hex");
  if (actual !== hash) {
    assert(allowed.has(path), "Unrelated edit changed: " + path);
    changed.push(path);
  }
}
const calibrationPath = "src/aircraft/fuel-mass-calibration.json";
const oldCalibration = await Bun.file(
  out + "/before/fuel-mass-calibration.json",
).json();
const currentCalibration = await Bun.file(calibrationPath).json();
for (const id of otherAircraft)
  currentCalibration.aircraft[id].assetRevision =
    oldCalibration.aircraft[id].assetRevision;
assert.deepEqual(
  currentCalibration,
  oldCalibration,
  "Calibration changes must only refresh the three asset hashes",
);
const mechanicsSource = (await Bun.file("lab/mechanics.ts").text())
  .replace('import { seatMechanicalAnchor } from "./attachment-mounts";\n', "")
  .replace(
    '    if (this.id !== "aurelia")\n      seatMechanicalAnchor(this.root, node, point, this.moving);\n',
    "",
  );
assert.equal(
  createHash("sha256").update(mechanicsSource).digest("hex"),
  hashes["lab/mechanics.ts"],
  "Existing viewer edits must be preserved around the new mount hook",
);
function document(bytes: Uint8Array, isGlb: boolean) {
  const length = isGlb ? new DataView(bytes.buffer).getUint32(12, true) : 0;
  return {
    doc: JSON.parse(
      new TextDecoder().decode(isGlb ? bytes.slice(20, 20 + length) : bytes),
    ),
    bin: isGlb ? bytes.slice(28 + length) : null,
  };
}
const models = [];
for (const id of otherAircraft) {
  const path = "public/assets/" + aircraftCatalog[id].asset,
    isGlb = path.endsWith(".glb");
  const before = document(
      new Uint8Array(await Bun.file(out + "/before/" + path).arrayBuffer()),
      isGlb,
    ),
    after = document(new Uint8Array(await Bun.file(path).arrayBuffer()), isGlb);
  if (before.bin)
    assert.deepEqual(after.bin, before.bin, "Original binary changed: " + id);
  for (const [key, value] of Object.entries(before.doc.extras ?? {}))
    assert.deepEqual(
      after.doc.extras[key],
      value,
      id + " original metadata changed: " + key,
    );
  for (const key of [
    "asset",
    "extensionsUsed",
    "extensionsRequired",
    "extensions",
    "scene",
  ])
    assert.deepEqual(
      after.doc[key],
      before.doc[key],
      id + " document field changed: " + key,
    );
  for (const key of [
    "meshes",
    "materials",
    "accessors",
    "bufferViews",
    "buffers",
    "animations",
    "images",
    "textures",
    "samplers",
  ])
    if (before.doc[key])
      assert.deepEqual(
        after.doc[key].slice(0, before.doc[key].length),
        before.doc[key],
        id + " original " + key + " changed",
      );
  for (let i = 0; i < before.doc.nodes.length; i++) {
    const original = before.doc.nodes[i],
      current = structuredClone(after.doc.nodes[i]);
    if (original.children)
      current.children = current.children.slice(0, original.children.length);
    else delete current.children;
    assert.deepEqual(current, original, id + " original node changed " + i);
  }
  for (let i = 0; i < before.doc.scenes.length; i++)
    assert.deepEqual(
      after.doc.scenes[i].nodes.slice(0, before.doc.scenes[i].nodes.length),
      before.doc.scenes[i].nodes,
    );
  models.push({
    id,
    originalNodesPreserved: before.doc.nodes.length,
    originalMeshesPreserved: before.doc.meshes.length,
    addedMeshes: after.doc.meshes.length - before.doc.meshes.length,
  });
}
const evidence = {
  pass: true,
  filesChecked: Object.keys(hashes).length,
  protectedFilesUnchanged: Object.keys(hashes).length - changed.length,
  changedExistingFiles: changed,
  aureliaUnchanged: true,
  models,
};
await Bun.write(out + "/preservation.json", JSON.stringify(evidence, null, 2));
console.log("FLEET_REPAIR_PRESERVATION", JSON.stringify(evidence));
