import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { simplify, weld } from "@gltf-transform/functions";
import { MeshoptSimplifier } from "meshoptimizer";
import { fileURLToPath } from "node:url";

// Retain the source scan's material names, UVs and transforms.
// Only simplify geometry; no Blender source or existing runtime asset is rewritten.
const directory = new URL("../public/assets/scenery/", import.meta.url);
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const error = Number(process.argv[2] ?? 0.002);
if (!(error > 0 && error <= 0.01))
  throw new Error("Use a simplification error between 0 and 0.01.");
const document = await io.read(
  fileURLToPath(new URL("coastal-tree-near.glb", directory)),
);
await document.transform(
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.12, error }),
);
// Runtime shares the near tree's actual materials/textures by name. Omitting
// duplicate images avoids another download, decode and GPU texture allocation.
for (const texture of document.getRoot().listTextures()) texture.dispose();
document.getRoot().setExtras({
  ...document.getRoot().getExtras(),
  lodSource: "coastal-tree-near.glb",
  simplification: { ratio: 0.12, error },
});
const path = fileURLToPath(new URL("coastal-tree-mid.glb", directory));
await io.write(path, document);
const triangles = document
  .getRoot()
  .listMeshes()
  .reduce(
    (sum, mesh) =>
      sum +
      mesh
        .listPrimitives()
        .reduce(
          (total, primitive) => total + primitive.getIndices()!.getCount() / 3,
          0,
        ),
    0,
  );
console.log(`Middle tree: ${triangles} triangles; ${path}`);
