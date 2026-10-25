import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Document, NodeIO, VertexLayout } from "@gltf-transform/core";
import { dedup, prune } from "@gltf-transform/functions";
import { Matrix4, Quaternion, Vector3 } from "three";

type Point = [number, number, number];
type CadPart = {
  name: string;
  parents: string[];
  color: number[];
  vertices: Point[];
  normals: Point[];
  faces: Point[];
};
const transfer = JSON.parse(
  await readFile(
    new URL("../assets/heron/GLB/cad-transfer.json", import.meta.url),
    "utf8",
  ),
) as {
  parts: CadPart[];
  hinges: Record<string, Point>;
  hingeAxes: Record<string, Point>;
  sourceSha256: string;
};
const doc = new Document();
const scene = doc.createScene("Heron UT-9");
const buffer = doc.createBuffer();
const root = doc.createNode("Heron_UT9").setExtras({
  cadSource: "assets/heron/src/heron.py",
  sourceSha256: transfer.sourceSha256,
});
scene.addChild(root);
const nodes = new Map([["Heron_UT9", root]]);
const origins = new Map<string, Point>([["Heron_UT9", [0, 0, 0]]]);
const rotations = new Map([["Heron_UT9", new Quaternion()]]);
function ensure(name: string, parent = "Heron_UT9") {
  const found = nodes.get(name);
  if (found) return found;
  const parentNode = ensure(parent);
  const origin = transfer.hinges[name] ?? [0, 0, 0];
  const before = origins.get(parent)!;
  const parentRotation = rotations.get(parent)!;
  const offset = new Vector3(...origin)
    .sub(new Vector3(...before))
    .applyQuaternion(parentRotation.clone().invert())
    .toArray() as Point;
  const node = doc.createNode(name);
  let rotation = parentRotation;
  const axis = transfer.hingeAxes[name];
  if (axis) {
    const x = new Vector3(...axis).normalize();
    const z = new Vector3().crossVectors(x, new Vector3(0, 1, 0)).normalize();
    const y = new Vector3().crossVectors(z, x).normalize();
    rotation = new Quaternion().setFromRotationMatrix(
      new Matrix4().makeBasis(x, y, z),
    );
    const relative = parentRotation.clone().invert().multiply(rotation);
    const mount = doc
      .createNode(`${name}_mount`)
      .setTranslation(offset)
      .setRotation(relative.toArray());
    parentNode.addChild(mount);
    mount.addChild(node);
  } else {
    node.setTranslation(offset);
    parentNode.addChild(node);
  }
  if (transfer.hinges[name])
    node.setExtras({ hinge: origin, ...(axis ? { hingeAxis: axis } : {}) });
  nodes.set(name, node);
  origins.set(name, origin);
  rotations.set(name, rotation);
  return node;
}
ensure("LandingGear");
const materials = new Map<string, ReturnType<Document["createMaterial"]>>();
for (const part of transfer.parts) {
  let parent = "Heron_UT9";
  for (const name of part.parents.slice(1)) {
    ensure(name, parent);
    parent = name;
  }
  const controlled = /^(Aileron|Flap)_(Left|Right)$|^Rudder$/.test(part.name);
  if (controlled) {
    ensure(part.name, parent);
    parent = part.name;
  }
  const origin = origins.get(parent)!;
  const inverse = rotations.get(parent)!.clone().invert();
  const positions = new Float32Array(
    part.vertices.flatMap((p) =>
      new Vector3(...p)
        .sub(new Vector3(...origin))
        .applyQuaternion(inverse)
        .toArray(),
    ),
  );
  const indices = new Uint32Array(part.faces.flat());
  const glass = /window|Windshield/.test(part.name);
  const rubber = /tire|hose|seal|Cooling_slot/.test(part.name);
  const metal =
    /axle|shaft|hinge|oleo|hub|handle|spar|bezel|pedestal|fastener|Fuel_cap|Pitot|Brake_disc|Brake_mount|Beacon_base/.test(
      part.name,
    );
  const key = `${part.color.join(",")}:${glass}:${rubber}:${metal}`;
  let material = materials.get(key);
  if (!material) {
    material = doc
      .createMaterial(
        glass
          ? "Glazing • Heron flush tinted windows"
          : rubber
            ? "Rubber • utility tire"
            : metal
              ? "Metal • airframe fittings"
              : "Paint • Heron glacier white, navy and copper",
      )
      .setBaseColorFactor([
        part.color[0],
        part.color[1],
        part.color[2],
        glass ? 0.68 : 1,
      ])
      .setMetallicFactor(metal ? 0.65 : 0.05)
      .setRoughnessFactor(rubber ? 0.9 : glass ? 0.12 : 0.36);
    if (glass) material.setAlphaMode("BLEND").setDoubleSided(true);
    materials.set(key, material);
  }
  const primitive = doc
    .createPrimitive()
    .setAttribute(
      "POSITION",
      doc
        .createAccessor()
        .setType("VEC3")
        .setArray(positions)
        .setBuffer(buffer),
    )
    .setIndices(
      doc
        .createAccessor()
        .setType("SCALAR")
        .setArray(indices)
        .setBuffer(buffer),
    )
    .setMaterial(material);
  // Surface derivatives preserve smooth CAD curvature on long, thin triangles.
  const normals = new Float32Array(
    part.normals.flatMap((p) =>
      new Vector3(...p).applyQuaternion(inverse).toArray(),
    ),
  );
  primitive.setAttribute(
    "NORMAL",
    doc.createAccessor().setType("VEC3").setArray(normals).setBuffer(buffer),
  );
  ensure(parent).addChild(
    doc
      .createNode(part.name === parent ? part.name + "_skin" : part.name)
      .setMesh(doc.createMesh(part.name).addPrimitive(primitive)),
  );
}
await doc.transform(dedup(), prune());
await new NodeIO()
  .setVertexLayout(VertexLayout.SEPARATE)
  .write(
    fileURLToPath(new URL("../public/assets/heron-ut9.glb", import.meta.url)),
    doc,
  );
console.log(
  `Heron game asset: ${transfer.parts.length} CAD leaves, ${materials.size} materials, hinged controls and propeller.`,
);
