import * as T from "three";
import {
  mergeGeometries,
  mergeVertices,
} from "three/addons/utils/BufferGeometryUtils.js";
import { mkdir } from "node:fs/promises";
import { runtimeAircraftCatalog as aircraftCatalog } from "../lab/aircraft";
import { loadGeometryOnly } from "./geometry-loader";
import { makeFleetInternals, type JetId } from "./fleet-internal-geometry";
import { compile, glb, type Doc } from "./gltf-installation";
import { originalFleetDocument } from "./fleet-internal-baseline";

// Append the installation without re-exporting the original rig, materials or
// animation tracks. Small external buffers keep existing GLBs below 8 MB.
const root = new URL("../", import.meta.url),
  assets = new URL("public/assets/", root);
const backup = new URL("output/fleet-internals-before/", root),
  native = new URL("output/fleet-internals-native/", root);
await Promise.all([
  mkdir(backup, { recursive: true }),
  mkdir(native, { recursive: true }),
]);

function compact(source: T.Object3D) {
  const result = new T.Group();
  result.name = source.name;
  result.userData = structuredClone(source.userData);
  const batches = new Map<string, T.Mesh[]>();
  for (const child of source.children) {
    if (!(child instanceof T.Mesh)) {
      result.add(compact(child));
      continue;
    }
    const key =
      (child.material as T.Material).uuid +
      ":" +
      child.userData.installationRegion;
    const list = batches.get(key) ?? [];
    list.push(child);
    batches.set(key, list);
  }
  for (const list of batches.values()) {
    const geometries = list.map((m) => {
      const g = m.geometry.index
        ? m.geometry.toNonIndexed()
        : m.geometry.clone();
      g.deleteAttribute("uv");
      return g;
    });
    const geometry = mergeGeometries(geometries);
    geometries.forEach((g) => g.dispose());
    if (!geometry)
      throw new Error("Internal geometry attributes cannot be batched");
    const indexed = mergeVertices(geometry, 1e-7);
    geometry.dispose();
    const mesh = new T.Mesh(indexed, list[0].material);
    mesh.name = source.name + " • " + (list[0].material as T.Material).name;
    mesh.userData = { ...list[0].userData, parts: list.map((m) => m.name) };
    result.add(mesh);
  }
  return result;
}

const reports = [];
for (const id of ["peregrine", "aurelia", "stormbird"] as JetId[]) {
  const filename = aircraftCatalog[id].asset,
    path = new URL(filename, assets),
    saved = new URL(filename, backup);
  if (!(await Bun.file(saved).exists())) {
    const source = new Uint8Array(await Bun.file(path).arrayBuffer());
    const length = filename.endsWith("glb")
      ? new DataView(source.buffer).getUint32(12, true)
      : 0;
    const installed = JSON.parse(
      new TextDecoder().decode(length ? source.slice(20, 20 + length) : source),
    );
    const original = originalFleetDocument(installed, id);
    await Bun.write(
      saved,
      length
        ? glb(original, source.slice(28 + length))
        : JSON.stringify(original),
    );
  }
  const bytes = new Uint8Array(await Bun.file(saved).arrayBuffer()),
    isGlb = filename.endsWith("glb");
  const jsonLength = isGlb ? new DataView(bytes.buffer).getUint32(12, true) : 0;
  const doc: Doc = JSON.parse(
    new TextDecoder().decode(isGlb ? bytes.slice(20, 20 + jsonLength) : bytes),
  );
  const { scene } = await loadGeometryOnly(path);
  const { installation, report } = makeFleetInternals(scene, id);
  const addedName = filename.replace(/\.(glb|gltf)$/, "-internals.bin");
  const runtime = compile(doc, compact(installation), addedName);
  await Bun.write(new URL(addedName, assets), runtime.binary);
  await Bun.write(
    path,
    isGlb
      ? glb(runtime.doc, bytes.slice(28 + jsonLength))
      : JSON.stringify(runtime.doc),
  );
  const editable = compile(doc, installation, id + "-editable.bin");
  if (isGlb) {
    editable.doc.buffers[0].uri = id + "-base.bin";
    for (const buffer of editable.doc.buffers.slice(1, -1))
      buffer.uri = "../../public/assets/" + buffer.uri;
    await Bun.write(
      new URL(id + "-base.bin", native),
      bytes.slice(28 + jsonLength),
    );
  } else
    for (const buffer of editable.doc.buffers.slice(0, -1))
      buffer.uri = "../../public/assets/" + buffer.uri;
  await Bun.write(new URL(id + "-editable.bin", native), editable.binary);
  await Bun.write(
    new URL(id + "-editable.gltf", native),
    JSON.stringify(editable.doc),
  );
  const verified = await loadGeometryOnly(path);
  if (
    !verified.scene.getObjectByName("InternalSystems") ||
    !verified.scene.getObjectByName("RearCabinBulkhead")
  )
    throw new Error("Installation lost during serialization");
  reports.push({
    ...report,
    sha256: verified.sha256,
    runtimeBufferBytes: runtime.binary.length,
    assetBytes: await Bun.file(path).size,
  });
  console.log(
    id,
    report.parts.length,
    "parts;",
    report.containedVertices,
    "contained vertices;",
    Math.round(report.fuelEnvelopeLitres),
    "litre envelope",
  );
}
await Bun.write(
  new URL("assets/fleet-internals-validation.json", root),
  JSON.stringify(reports, null, 2),
);
console.log("FLEET_INTERNAL_SYSTEMS_BUILT");
