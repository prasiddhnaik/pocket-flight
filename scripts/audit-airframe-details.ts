import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const repairs = await Bun.file(`${root}output/fleet-detail-repairs.json`).json();
const evidence = [];
function read(bytes: Buffer) {
  const size = bytes.readUInt32LE(12);
  return { doc: JSON.parse(bytes.subarray(20, 20 + size).toString()), binary: bytes.subarray(28 + size) };
}
function same(a: unknown, b: unknown, label: string) {
  if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error(`Unexpected change: ${label}`);
}
for (const repair of repairs) {
  const before = read(Buffer.from(await Bun.file(`${root}output/fleet-detail-before/${repair.asset}`).arrayBuffer()));
  const bytes = Buffer.from(await Bun.file(`${root}public/assets/${repair.asset}`).arrayBuffer());
  const after = read(bytes);
  const changed = new Set<string>(repair.changed.map((r: { name: string }) => r.name));
  same(before.doc.nodes.length, after.doc.nodes.length, "node count");
  for (const key of ["animations", "skins", "scenes", "materials", "images", "textures"]) same(before.doc[key], after.doc[key], key);
  if (!after.binary.subarray(0, before.binary.length).equals(before.binary)) throw new Error("Original buffers changed");
  let untouchedMeshes = 0;
  before.doc.nodes.forEach((node: any, i: number) => {
    const next = structuredClone(after.doc.nodes[i]);
    if (next.extras) {
      delete next.extras.surface_detail; delete next.extras.surface_orientation;
      if (!Object.keys(next.extras).length && !node.extras) delete next.extras;
    }
    same(node, next, `rig ${node.name}`);
    if (node.mesh !== undefined && !changed.has(node.name)) {
      same(before.doc.meshes[node.mesh], after.doc.meshes[node.mesh], `mesh ${node.name}`);
      untouchedMeshes++;
    }
    if (repair.changed.some((r: any) => r.name === node.name && r.components_flipped))
      same(before.doc.meshes[node.mesh].primitives[0].attributes.POSITION, after.doc.meshes[node.mesh].primitives[0].attributes.POSITION, `airfoil positions ${node.name}`);
  });
  evidence.push({ asset: repair.asset, changedMeshes: changed.size, untouchedMeshes, preservedHierarchy: true, preservedOriginalBuffers: true, preservedAnimationClips: before.doc.animations?.length ?? 0, sha256: createHash("sha256").update(bytes).digest("hex") });
}
const measured = await Bun.file(`${root}lab/fleet-geometry.json`).json();
const previous = JSON.parse(execFileSync("git", ["show", "HEAD:lab/fleet-geometry.json"], { cwd: root, encoding: "utf8" }));
const rounded = (fleet: any[]) => JSON.parse(JSON.stringify(fleet.map(({ revision, ...geometry }) => geometry), (_key, value) => typeof value === "number" ? Math.round(value * 1e9) / 1e9 : value));
same(rounded(previous), rounded(measured), "measured wing geometry and dimensions");
await Bun.write(`${root}output/fleet-detail-preservation.json`, JSON.stringify({ evidence, unchangedFleetDimensionsAndSections: true, measurementToleranceMetres: 1e-9 }, null, 2));
console.log(`${evidence.length} assets passed preservation checks; rig, dimensions, wing stations and unaffected meshes retained.`);
