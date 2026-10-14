import * as T from "three";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { loadGeometryOnly } from "./geometry-loader";
import { originalFleetDocument } from "./fleet-internal-baseline";
import { connectedSurfaces } from "./geometry-components";
import { compile, glb } from "./gltf-installation";
import {
  aureliaBays,
  makeAureliaGearBays,
  AURELIA_BAY_REVISION,
  bellyDoorHinge,
} from "./aurelia-gear-bays";
import {
  AURELIA_GEAR_STOW_TIME,
  aureliaGearFold,
  aureliaDoorAngle,
} from "../src/aurelia-motion";

const assets = new URL("../public/assets/", import.meta.url);
const saved = new URL(
  "../output/fleet-internals-before/aurelia-flight.glb",
  import.meta.url,
);
await mkdir(new URL("../output/fleet-internals-before/", import.meta.url), {
  recursive: true,
});
const source = (await Bun.file(saved).exists())
  ? saved
  : new URL("aurelia-flight.glb", assets);
const bytes = new Uint8Array(await Bun.file(source).arrayBuffer());
const length = new DataView(bytes.buffer).getUint32(12, true);
let doc = originalFleetDocument(
  JSON.parse(new TextDecoder().decode(bytes.slice(20, 20 + length))),
  "aurelia",
);
const binary = bytes.slice(28 + length),
  data = new DataView(binary.buffer);
const key = (name: string) => name.replace(/\s/g, "_");
const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");

if (doc.extras?.gear_bays_revision !== AURELIA_BAY_REVISION) {
  if (!doc.extras?.gear_bays_revision) {
    const { scene } = await loadGeometryOnly(
      source,
      false,
      new URL("aurelia-flight.glb", assets),
    );
    scene.updateMatrixWorld(true);
    // Remove only the two decorative leg-mounted panels. They would rotate
    // through the pressure floor when the complete strut folds aft.
    function retainIndices(node: any, keep: number[]) {
      const a = doc.accessors[doc.meshes[node.mesh].primitives[0].indices];
      const view = doc.bufferViews[a.bufferView];
      if (view.buffer !== 0) throw Error("Expected original embedded indices");
      const offset = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
      const stride = a.componentType === 5125 ? 4 : 2;
      keep.forEach((v, i) =>
        stride === 4
          ? data.setUint32(offset + i * stride, v, true)
          : data.setUint16(offset + i * stride, v, true),
      );
      a.count = keep.length;
      a.min = [Math.min(...keep)];
      a.max = [Math.max(...keep)];
    }
    for (const side of ["Left", "Right"]) {
      const node = doc.nodes.find(
        (n: any) => n.name === `Main_gear_${side} | Atlantic blue lacquer`,
      );
      const parts = connectedSurfaces(
        scene.getObjectByName(key(node.name)) as T.Mesh,
      );
      const oldDoor = parts.filter(
        (p) => p.bounds.getSize(new T.Vector3()).z > 1.8,
      );
      if (oldDoor.length !== 1) throw Error(`${side}: unexpected leg panels`);
      retainIndices(
        node,
        parts.filter((p) => !oldDoor.includes(p)).flatMap((p) => p.indices),
      );
    }
    // Cut the actual lower skins at the bay openings. The new bay ceilings and
    // liners isolate these unpressurised spaces from the occupied pressure cabin.
    for (const name of [
      "Continuous_pressure_shell",
      "Fuselage | Atlantic blue lacquer",
    ]) {
      const node = doc.nodes.find((n: any) => key(n.name) === key(name));
      const mesh = scene.getObjectByName(key(name)) as T.Mesh;
      const pos = mesh.geometry.getAttribute("position"),
        ix = mesh.geometry.index!;
      const keep: number[] = [];
      for (let i = 0; i < ix.count; i += 3) {
        const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
        const center = ids
          .reduce(
            (p, id) =>
              p.add(
                new T.Vector3()
                  .fromBufferAttribute(pos, id)
                  .applyMatrix4(mesh.matrixWorld),
              ),
            new T.Vector3(),
          )
          .multiplyScalar(1 / 3);
        if (
          !aureliaBays.some(
            (b) =>
              Math.abs(center.x - b.x) < b.half &&
              center.y < b.top - 0.035 &&
              center.z > b.front &&
              center.z < b.back,
          )
        )
          keep.push(...ids);
      }
      retainIndices(node, keep);
    }
  } else {
    // Rebuild only the generated installation, preserving the repaired base rig.
    const firstNode = doc.nodes.findIndex(
      (n: any) => n.name === "AureliaGearBays",
    );
    const firstMesh = Math.min(
      ...doc.nodes
        .slice(firstNode)
        .flatMap((n: any) => (n.mesh === undefined ? [] : [n.mesh])),
    );
    const primitives = doc.meshes
      .slice(firstMesh)
      .flatMap((m: any) => m.primitives);
    const firstAccessor = Math.min(
      ...primitives.flatMap((p: any) => [
        ...Object.values(p.attributes),
        ...(p.indices === undefined ? [] : [p.indices]),
      ]),
    );
    const firstView = Math.min(
      ...doc.accessors.slice(firstAccessor).map((a: any) => a.bufferView),
    );
    const firstMaterial = Math.min(...primitives.map((p: any) => p.material));
    const gear = doc.nodes.find((n: any) => n.name === "LandingGear");
    gear.children = gear.children.filter((i: number) => i !== firstNode);
    doc.nodes.length = firstNode;
    doc.meshes.length = firstMesh;
    doc.accessors.length = firstAccessor;
    doc.bufferViews.length = firstView;
    doc.materials.length = firstMaterial;
    doc.buffers.pop();
  }
  const built = compile(doc, makeAureliaGearBays(), "aurelia-gear-bays.bin");
  doc = built.doc;
  delete doc.extras.internal_systems_revision;
  await Bun.write(new URL("aurelia-gear-bays.bin", assets), built.binary);
  const kitIndex = doc.scenes[doc.scene ?? 0].nodes.pop();
  const landing = doc.nodes.find((n: any) => n.name === "LandingGear");
  landing.children.push(kitIndex);
  const kit = doc.nodes[kitIndex];
  for (const b of aureliaBays)
    for (const side of b.side ? [b.side] : [-1, 1]) {
      const hinge = doc.nodes.find(
        (n: any) => n.name === `${b.side ? "Main" : "Nose"} door hinge ${side}`,
      );
      const panelIndex = doc.nodes.findIndex(
        (n: any) => n.name === `${b.name}_door_${side}`,
      );
      kit.children = kit.children.filter((n: number) => n !== panelIndex);
      hinge.children = [panelIndex];
      hinge.translation = bellyDoorHinge(b, side).toArray();
      hinge.rotation = new T.Quaternion()
        .setFromAxisAngle(new T.Vector3(0, 0, 1), (side * 95 * Math.PI) / 180)
        .toArray();
    }
  function floats(index: number) {
    const a = doc.accessors[index],
      v = doc.bufferViews[a.bufferView];
    if (v.buffer !== 0 || a.componentType !== 5126)
      throw Error("Unexpected animation buffer");
    return { a, offset: (v.byteOffset ?? 0) + (a.byteOffset ?? 0) };
  }
  for (const animation of doc.animations)
    for (const channel of animation.channels) {
      const node = doc.nodes[channel.target.node];
      if (!/retraction hinge|door hinge/.test(node.name)) continue;
      const sampler = animation.samplers[channel.sampler];
      if (sampler.interpolation && sampler.interpolation !== "LINEAR")
        throw Error("Unexpected gear interpolation");
      const input = floats(sampler.input),
        output = floats(sampler.output);
      for (let i = 0; i < input.a.count; i++) {
        const progress =
          data.getFloat32(input.offset + i * 4, true) / AURELIA_GEAR_STOW_TIME;
        let values: number[];
        if (channel.target.path === "translation") values = node.translation;
        else {
          const door = /door hinge/.test(node.name),
            side = node.name.endsWith("-1") ? -1 : 1;
          const angle = door
            ? aureliaDoorAngle(1 - progress, side)
            : aureliaGearFold(1 - progress, node.name.startsWith("Nose"));
          values = new T.Quaternion()
            .setFromAxisAngle(
              new T.Vector3(door ? 0 : 1, 0, door ? 1 : 0),
              angle,
            )
            .toArray();
        }
        values.forEach((v, j) =>
          data.setFloat32(output.offset + (i * values.length + j) * 4, v, true),
        );
      }
      delete output.a.min;
      delete output.a.max;
    }
  doc.extras = {
    ...doc.extras,
    gear_bays_revision: AURELIA_BAY_REVISION,
    gear_bays_design:
      "Fixed trunnions; aft-folding dual wheels below Y=2.38 cabin floor; closed belly doors after gear clears",
  };
}
await Bun.write(saved, glb(doc, binary));
// This is an intentional base-airframe repair. Preserve the immutable baseline
// contract for subsequent internal-system rebuilds with the new gear revision.
const baselinePath = new URL(
  "../tests/fixtures/fleet-internals-baseline.json",
  import.meta.url,
);
const baseline = await Bun.file(baselinePath).json();
const original = baseline.aircraft.aurelia;
for (const field of Object.keys(original.fields))
  original.fields[field] = {
    count: doc[field].length,
    sha256: hash(JSON.stringify(doc[field])),
  };
original.buffers = await Promise.all(
  doc.buffers.map(async (b: any) => ({
    ...b,
    sha256: hash(
      b.uri
        ? new Uint8Array(await Bun.file(new URL(b.uri, assets)).arrayBuffer())
        : binary,
    ),
  })),
);
original.animationsSha256 = hash(JSON.stringify(doc.animations));
original.sceneRoots = [...doc.scenes[doc.scene ?? 0].nodes];
const { scene } = await loadGeometryOnly(
  saved,
  true,
  new URL("aurelia-flight.glb", assets),
);
scene.updateMatrixWorld(true);
for (const [name, anchor] of Object.entries(original.anchors) as [
  string,
  any,
][]) {
  const node = scene.getObjectByName(name)!;
  const box = new T.Box3().setFromObject(node, true);
  anchor.matrix = [...node.matrixWorld.elements];
  anchor.min = box.min.toArray();
  anchor.max = box.max.toArray();
}
original.gearRepair =
  "Aft-folding underfloor bays, fixed mounts and sequenced closing doors; 2026-10-13";
await Bun.write(baselinePath, JSON.stringify(baseline, null, 2));
console.log("AURELIA_GEAR_BAYS_REPAIRED");
