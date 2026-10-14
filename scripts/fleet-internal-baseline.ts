import { createHash } from "node:crypto";
import baseline from "../tests/fixtures/fleet-internals-baseline.json";
import type { JetId } from "./fleet-internal-geometry";

/** Recover the preserved original document when a checkout has no local backup. */
export function originalFleetDocument(source: any, id: JetId) {
  if (!source.extras?.internal_systems_revision) return source;
  const original = baseline.aircraft[id],
    doc = structuredClone(source);
  const roots = doc.scenes[doc.scene ?? 0].nodes;
  if (
    roots.length !== original.sceneRoots.length + 1 ||
    doc.nodes[roots.at(-1)].name !== "InteriorInstallation" ||
    doc.buffers.length !== original.buffers.length + 1
  )
    throw Error(
      `${id}: installation has subsequent edits; preserve those before rebuilding`,
    );
  for (const [key, field] of Object.entries(original.fields)) {
    const retained = doc[key].slice(0, field.count);
    const hash = createHash("sha256")
      .update(JSON.stringify(retained))
      .digest("hex");
    if (hash !== field.sha256)
      throw Error(
        `${id}: original ${key} changed; cannot recover the baseline`,
      );
    doc[key] = retained;
  }
  doc.scenes[doc.scene ?? 0].nodes = original.sceneRoots;
  delete doc.extras.internal_systems_revision;
  return doc;
}
