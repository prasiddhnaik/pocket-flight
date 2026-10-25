import { readFile } from "node:fs/promises";
import { Document, NodeIO, VertexLayout } from "@gltf-transform/core";
import { dedup, prune } from "@gltf-transform/functions";
import { fileURLToPath } from "node:url";

type Point = [number, number, number];
type Part = { name: string; parents: string[]; color: number[]; vertices: Point[]; normals: Point[]; faces: Point[] };
type Mechanism = { origin: Point; axis: Point; travel: [number, number] };
const transfer: { parts: Part[]; mechanisms: Record<string, Mechanism>; gunMuzzle: Point; stepSha256: string } = JSON.parse(await readFile(new URL("../assets/f15c/GLB/cad-transfer.json", import.meta.url), "utf8"));
const doc = new Document(), scene = doc.createScene("F-15C Eagle"), buffer = doc.createBuffer();
const root = doc.createNode("F15C_Eagle").setExtras({ cadSource: "assets/f15c/STEP/f15c.step", stepSha256: transfer.stepSha256, gunMuzzle: transfer.gunMuzzle, units: "m" });
scene.addChild(root);
const nodes = new Map([["F15C_Eagle", root]]), origins = new Map<string, Point>([["F15C_Eagle", [0, 0, 0]]]);
function ensure(name: string, parent = "F15C_Eagle") {
  const found = nodes.get(name);
  if (found) return found;
  const parentNode = ensure(parent), previous = origins.get(parent)!;
  const mechanism = transfer.mechanisms[name], origin = mechanism?.origin ?? previous;
  const node = doc.createNode(name).setTranslation(origin.map((n, i) => n - previous[i]) as Point);
  if (mechanism) node.setExtras({ hinge_axis: mechanism.axis, travel_degrees: mechanism.travel, hinge: mechanism.origin });
  parentNode.addChild(node); nodes.set(name, node); origins.set(name, origin);
  return node;
}
ensure("LandingGear"); ensure("Wing_Left"); ensure("Wing_Right");
const materials = new Map<string, ReturnType<Document["createMaterial"]>>();
for (const part of transfer.parts) {
  let parent = "F15C_Eagle";
  // Keep meaningful authored part containers; discard repeated staged assembly wrappers.
  for (const name of part.parents) {
    if (/^(Gear_(Nose|Left|Right)|LandingGear|Canopy|Airbrake|Cockpit_fixed)$/.test(name)) {
      ensure(name, name.startsWith("Gear_") ? "LandingGear" : parent); parent = name;
    }
  }
  const wing = /^(Wing_fixed|Flap|Aileron)(?:_hinge)?_(Left|Right)$/.exec(part.name);
  if (wing) { parent = `Wing_${wing[2]}`; ensure(parent); }
  const wheel = /^(Nose|Left|Right)_(Tire|Wheel_hub|Hub_cap_(-1|1)|Hub_bolt_(-1|1)_[0-5])$/.exec(part.name);
  if (wheel) { const gear = `Gear_${wheel[1]}`; ensure(gear, "LandingGear"); parent = `Wheel_${wheel[1]}`; ensure(parent, gear); }
  if (transfer.mechanisms[part.name]) {
    ensure(part.name, part.name.startsWith("Door_") ? "LandingGear" : parent); parent = part.name;
  }
  const origin = origins.get(parent) ?? [0, 0, 0];
  const glass = /glass/i.test(part.name), rubber = /tire|seal/i.test(part.name), metal = /Nozzle|nozzle|petal|actuator|hinge|shaft|bearing|collar|rail|hub|Hub|rim|Oleo|oleo|strut|Torque|trunnion|Mount|HUD_support|Gun_(barrel|muzzle_face|retainer|hub)|M61_/.test(part.name);
  const key = `${part.color.join(",")}:${glass}:${rubber}:${metal}`;
  let material = materials.get(key);
  if (!material) {
    material = doc.createMaterial(glass ? "Glass • F-15C canopy" : metal ? "Metal • F-15C fittings" : rubber ? "Rubber • F-15C tire" : "Paint • F-15C gray")
      .setBaseColorFactor([part.color[0], part.color[1], part.color[2], glass ? .24 : 1])
      .setMetallicFactor(metal ? .65 : .04).setRoughnessFactor(glass ? .09 : rubber ? .9 : metal ? .4 : .53);
    if (glass) material.setAlphaMode("BLEND").setDoubleSided(true);
    materials.set(key, material);
  }
  const primitive = doc.createPrimitive().setMaterial(material)
    .setAttribute("POSITION", doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array(part.vertices.flatMap(p => p.map((n, i) => n - origin[i])))))
    .setAttribute("NORMAL", doc.createAccessor().setType("VEC3").setBuffer(buffer).setArray(new Float32Array(part.normals.flat())))
    .setIndices(doc.createAccessor().setType("SCALAR").setBuffer(buffer).setArray(new Uint32Array(part.faces.flat())));
  ensure(parent).addChild(doc.createNode(part.name === parent ? `${part.name}_skin` : part.name).setMesh(doc.createMesh(part.name).addPrimitive(primitive)));
}
await doc.transform(dedup(), prune());
await new NodeIO().setVertexLayout(VertexLayout.SEPARATE).write(fileURLToPath(new URL("../public/assets/f15c-eagle.glb", import.meta.url)), doc);
console.log(`F-15C: ${transfer.parts.length} named CAD leaves, ${Object.keys(transfer.mechanisms).length} hinges, ${materials.size} materials.`);
