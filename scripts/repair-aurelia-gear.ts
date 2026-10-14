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
  bayOpeningContains,
  aureliaPanels,
  panelHinge,
} from "./aurelia-gear-bays";
import {
  AURELIA_GEAR_STOW_TIME,
  aureliaGearFold,
  aureliaDoorAngle,
  AURELIA_MAIN_GEAR,
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
              bayOpeningContains(b, center.x, center.z) &&
              center.y < b.top - 0.035,
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
    gear.children = gear.children.filter((i: number) => i < firstNode);
    for (const animation of doc.animations) {
      animation.channels = animation.channels.filter(
        (c: any) => c.target.node < firstNode,
      );
      const used = [
        ...new Set(animation.channels.map((c: any) => c.sampler)),
      ] as number[];
      const remap = new Map(used.map((old, index) => [old, index]));
      animation.samplers = used.map((index) => animation.samplers[index]);
      animation.channels.forEach((c: any) => {
        c.sampler = remap.get(c.sampler);
      });
    }
    doc.nodes.length = firstNode;
    doc.meshes.length = firstMesh;
    doc.accessors.length = firstAccessor;
    doc.bufferViews.length = firstView;
    doc.materials.length = firstMaterial;
    doc.buffers.pop();
  }
  // The new, short transverse wells need genuine apertures in the original
  // lower skin as well as in the fairing. Retain the cabin skin above its floor.
  const current = await loadGeometryOnly(
    source,
    false,
    new URL("aurelia-flight.glb", assets),
  );
  current.scene.updateMatrixWorld(true);
  for (const name of [
    "Continuous_pressure_shell",
    "Fuselage | Atlantic blue lacquer",
  ]) {
    const node = doc.nodes.find((n: any) => key(n.name) === key(name));
    const rendered = current.scene.getObjectByName(key(name)) as T.Mesh;
    const p = rendered.geometry.getAttribute("position"),
      ix = rendered.geometry.index!;
    const keep: number[] = [];
    for (let i = 0; i < ix.count; i += 3) {
      const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
      const points = ids.map((id) =>
        new T.Vector3()
          .fromBufferAttribute(p, id)
          .applyMatrix4(rendered.matrixWorld),
      );
      points.push(
        points
          .reduce((sum, point) => sum.add(point), new T.Vector3())
          .multiplyScalar(1 / 3),
      );
      const cut = points.some((point) =>
        aureliaBays.some(
          (b) =>
            bayOpeningContains(b, point.x, point.z) &&
            point.y < (b.side ? 2.38 : b.top) - 0.01,
        ),
      );
      if (!cut) keep.push(...ids);
    }
    const a = doc.accessors[doc.meshes[node.mesh].primitives[0].indices],
      v = doc.bufferViews[a.bufferView];
    const offset = (v.byteOffset ?? 0) + (a.byteOffset ?? 0),
      stride = a.componentType === 5125 ? 4 : 2;
    keep.forEach((value, i) =>
      stride === 4
        ? data.setUint32(offset + i * stride, value, true)
        : data.setUint16(offset + i * stride, value, true),
    );
    a.count = keep.length;
    a.min = [Math.min(...keep)];
    a.max = [Math.max(...keep)];
  }
  const built = compile(doc, makeAureliaGearBays(), "aurelia-gear-bays.bin");
  doc = built.doc;
  delete doc.extras.internal_systems_revision;
  const extraChunks: Uint8Array[] = [built.binary];
  let extraLength = built.binary.length;
  const kitIndex = doc.scenes[doc.scene ?? 0].nodes.pop();
  const landing = doc.nodes.find((n: any) => n.name === "LandingGear");
  landing.children.push(kitIndex);
  const kit = doc.nodes[kitIndex];
  // Preserve this airframe's wheel meshes, but replace the inherited dual-wheel
  // struts with compact trailing-link legs and fixed inboard-folding trunnions.
  for (const [label, side] of [
    ["Left", -1],
    ["Right", 1],
  ] as const) {
    const hinge = doc.nodes.find(
      (n: any) =>
        n.name === `Main gear ${label} retraction hinge` ||
        key(n.name) === `Main_gear_${label}_retraction_hinge`,
    );
    const leg = doc.nodes.find((n: any) => n.name === `Main_gear_${label}`);
    const wheelIndex = leg.children.find((i: number) =>
      /^Main_wheel_/.test(doc.nodes[i].name),
    );
    const wheel = doc.nodes[wheelIndex];
    wheel.translation[0] = 0;
    wheel.name = `Main_wheel_${label}`;
    hinge.translation = [
      side * AURELIA_MAIN_GEAR.x,
      AURELIA_MAIN_GEAR.pivotY,
      AURELIA_MAIN_GEAR.z,
    ];
    leg.translation = [0, 1.1 - AURELIA_MAIN_GEAR.pivotY, 0];
    const strut = doc.nodes.findIndex(
      (n: any) => n.name === `MainStrut_${label}`,
    );
    kit.children = kit.children.filter((i: number) => i !== strut);
    leg.children = [wheelIndex, strut];
  }
  const newDoorNodes: { index: number; side: number; mainSide: number }[] = [];
  for (const p of aureliaPanels) {
    let hingeIndex = doc.nodes.findIndex((n: any) => n.name === p.hingeName);
    if (hingeIndex < 0) {
      hingeIndex = doc.nodes.length;
      doc.nodes.push({ name: p.hingeName });
      landing.children.push(hingeIndex);
      newDoorNodes.push({
        index: hingeIndex,
        side: p.side,
        mainSide: p.bay.side,
      });
    }
    const hinge = doc.nodes[hingeIndex];
    const panelIndex = doc.nodes.findIndex((n: any) => n.name === p.name);
    kit.children = kit.children.filter((n: number) => n !== panelIndex);
    hinge.children = [panelIndex];
    hinge.translation = panelHinge(p).toArray();
    hinge.rotation = new T.Quaternion()
      .setFromAxisAngle(new T.Vector3(0, 0, 1), (p.side * 95 * Math.PI) / 180)
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
          const nose = node.name.startsWith("Nose");
          const angle = door
            ? aureliaDoorAngle(1 - progress, side)
            : aureliaGearFold(1 - progress, nose) *
              (nose ? 1 : node.name.includes("Left") ? -1 : 1);
          values = new T.Quaternion()
            .setFromAxisAngle(
              new T.Vector3(!door && nose ? 1 : 0, 0, door || !nose ? 1 : 0),
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
  // Each short wheel-door leaf has its own native hinge and animation track.
  // Reuse the existing timing samples, with the inboard-opening sign reversed.
  for (const animation of doc.animations) {
    for (const door of newDoorNodes) {
      const sourceChannel = animation.channels.find(
        (c: any) =>
          doc.nodes[c.target.node].name ===
            `Main door hinge ${door.mainSide}` && c.target.path === "rotation",
      );
      if (!sourceChannel) continue;
      const sampler = animation.samplers[sourceChannel.sampler],
        input = floats(sampler.input);
      const values = new Float32Array(input.a.count * 4);
      for (let i = 0; i < input.a.count; i++) {
        const progress =
          data.getFloat32(input.offset + i * 4, true) / AURELIA_GEAR_STOW_TIME;
        new T.Quaternion()
          .setFromAxisAngle(
            new T.Vector3(0, 0, 1),
            aureliaDoorAngle(1 - progress, door.side),
          )
          .toArray(values, i * 4);
      }
      const view = doc.bufferViews.length;
      doc.bufferViews.push({
        buffer: doc.buffers.length - 1,
        byteOffset: extraLength,
        byteLength: values.byteLength,
      });
      const accessor = doc.accessors.length;
      doc.accessors.push({
        bufferView: view,
        componentType: 5126,
        type: "VEC4",
        count: input.a.count,
      });
      extraChunks.push(new Uint8Array(values.buffer));
      extraLength += values.byteLength;
      animation.channels.push({
        sampler: animation.samplers.length,
        target: { node: door.index, path: "rotation" },
      });
      animation.samplers.push({
        input: sampler.input,
        output: accessor,
        interpolation: "LINEAR",
      });
    }
  }
  const external = new Uint8Array(extraLength);
  let externalOffset = 0;
  for (const chunk of extraChunks) {
    external.set(chunk, externalOffset);
    externalOffset += chunk.length;
  }
  doc.buffers[doc.buffers.length - 1].byteLength = external.length;
  await Bun.write(new URL("aurelia-gear-bays.bin", assets), external);
  doc.extras = {
    ...doc.extras,
    gear_bays_revision: AURELIA_BAY_REVISION,
    gear_bays_design:
      "Single-wheel trailing-link mains fold inboard below Y=2.38 pressure floor; shallow wing-body canoe and sequenced flush doors",
  };
  // Retired gear and original cutout panels must not survive as unattached
  // animation targets, which native glTF importers can recreate in the scene.
  if (doc.skins?.length) throw Error("Unexpected skinned aircraft rig");
  const reachable = new Set<number>();
  function visit(index: number) {
    if (reachable.has(index)) return;
    reachable.add(index);
    doc.nodes[index].children?.forEach(visit);
  }
  doc.scenes.forEach((scene: { nodes: number[] }) =>
    scene.nodes.forEach(visit),
  );
  const remap = new Map<number, number>();
  doc.nodes.forEach((_: unknown, index: number) => {
    if (reachable.has(index)) remap.set(index, remap.size);
  });
  doc.nodes = doc.nodes.filter((_: unknown, index: number) =>
    reachable.has(index),
  );
  doc.nodes.forEach((node: { children?: number[] }) => {
    if (node.children)
      node.children = node.children.map((index) => remap.get(index)!);
  });
  doc.scenes.forEach((scene: { nodes: number[] }) => {
    scene.nodes = scene.nodes.map((index) => remap.get(index)!);
  });
  for (const animation of doc.animations) {
    animation.channels = animation.channels.filter(
      (channel: { target: { node: number } }) =>
        reachable.has(channel.target.node),
    );
    animation.channels.forEach((channel: { target: { node: number } }) => {
      channel.target.node = remap.get(channel.target.node)!;
    });
  }
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
  "Single-wheel inboard-folding mains, shallow wing-body canoe and sequenced closing doors; 2026-10-14";
await Bun.write(baselinePath, JSON.stringify(baseline, null, 2));
console.log("AURELIA_GEAR_BAYS_REPAIRED");
