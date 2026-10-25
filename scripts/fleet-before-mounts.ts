import assert from "node:assert/strict";
import type { Doc } from "./gltf-installation";

/** Read-only validation projection. Never use this to bypass rebuild guards. */
export function fleetBeforeMounts(source: Doc, id: string): Doc {
  if (!source.extras?.attachmentRepairRevision) return source;
  assert.equal(
    source.extras.attachmentRepairRevision,
    1,
    "Unknown attachment revision",
  );
  const doc = structuredClone(source),
    root = doc.nodes.findIndex((n) => n.name === id + "_attachment_repairs");
  assert(root >= 0, "Missing authored mount root");
  const scene = doc.scenes[doc.scene ?? 0];
  assert.equal(scene.nodes.at(-1), root, "Unknown later scene edits");
  assert.equal(
    doc.buffers.at(-1)?.uri,
    id + "-attachment-mounts.bin",
    "Unknown later buffer edits",
  );
  const added = doc.nodes.slice(root);
  for (const node of added)
    assert(
      node.name === id + "_attachment_repairs" ||
        node.name?.startsWith(id + "_authored_mounts_") ||
        new RegExp("_mounts_" + id + "_(mounting_alloy|seated_backing)$").test(
          node.name ?? "",
        ),
      "Unknown later node: " + node.name,
    );
  const meshStart = Math.min(
    ...added.flatMap((n) => (n.mesh === undefined ? [] : [n.mesh])),
  );
  assert(Number.isInteger(meshStart));
  const primitives = doc.meshes.slice(meshStart).flatMap((m) => m.primitives);
  const materialStart = Math.min(
    ...primitives.flatMap((p) =>
      p.material === undefined ? [] : [p.material],
    ),
  );
  const accessorStart = Math.min(
    ...primitives.flatMap((p) => [
      ...Object.values(p.attributes),
      ...(p.indices === undefined ? [] : [p.indices]),
    ]),
  );
  const viewStart = Math.min(
    ...doc.accessors.slice(accessorStart).map((a) => Number(a.bufferView)),
  );
  for (const view of doc.bufferViews.slice(viewStart))
    assert.equal(
      view.buffer,
      doc.buffers.length - 1,
      "Mounts reference a preserved buffer",
    );
  doc.nodes = doc.nodes.slice(0, root);
  for (const node of doc.nodes)
    if (node.children) node.children = node.children.filter((i) => i < root);
  scene.nodes = scene.nodes.filter((i) => i !== root);
  doc.meshes = doc.meshes.slice(0, meshStart);
  doc.materials = doc.materials.slice(0, materialStart);
  doc.accessors = doc.accessors.slice(0, accessorStart);
  doc.bufferViews = doc.bufferViews.slice(0, viewStart);
  doc.buffers.pop();
  delete doc.extras!.attachmentRepairRevision;
  return doc;
}
