import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { aircraftCatalog } from "../lab/aircraft";
import {
  bodyMesh,
  otherAircraft,
  type OtherAircraft,
} from "./fleet-attachment-model";
import { loadGeometryOnly } from "./geometry-loader";
import { compile, glb, type Doc } from "./gltf-installation";
import { boxDistSq } from "./triangle-distance";
import {
  mountSurfaces,
  nearestMount,
  nearestSurface,
  type MountSurface,
} from "./fleet-mount-surfaces";

const i = Bun.argv.indexOf("--aircraft"),
  id = Bun.argv[i + 1] as OtherAircraft;
assert(
  i >= 0 && otherAircraft.includes(id),
  "Select Finch, Peregrine or Stormbird; Aurelia is excluded",
);
const out = "output/fleet-attachment-repair";
await mkdir(out, { recursive: true });
const asset = "public/assets/" + aircraftCatalog[id].asset;
const baseline = out + "/before/" + asset;
assert(await Bun.file(baseline).exists(), "Capture the repair baseline first");
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const currentAssetSha = sha(
  new Uint8Array(await Bun.file(asset).arrayBuffer()),
);
const guardFile = Bun.file(`${out}/${id}-installation.json`);
const previous = (await guardFile.exists())
  ? await guardFile.json()
  : undefined;
const baselineAssetSha = sha(
  new Uint8Array(await Bun.file(baseline).arrayBuffer()),
);
assert(
  currentAssetSha === baselineAssetSha ||
    currentAssetSha === previous?.assetSha,
  "Aircraft changed since this repair baseline; preserve the new edits before rebuilding",
);
if (previous)
  assert.equal(
    sha(
      new Uint8Array(
        await Bun.file(
          `public/assets/${id}-attachment-mounts.bin`,
        ).arrayBuffer(),
      ),
    ),
    previous.supportSha,
    "Mount geometry changed since the last installation",
  );
// Read the current accepted asset, never a stale authoring export. Repeated runs
// use the immutable task baseline and produce the same append-only installation.
const loaded = await loadGeometryOnly(
  new URL("../" + baseline, import.meta.url),
  false,
  new URL("../" + asset, import.meta.url),
);
const root = loaded.scene;
const dynamic =
  /^(?:(?:Aileron|Flap|Elevator|Rudder|Canard)(?:_(?:Left|Right))?|Propeller|Compressor_-?1|Fan_(?:Left|Right)|(?:Wheel_|Nose_wheel_|Main_wheel_|Nose_gear_wheel_|Main_gear_(?:Left|Right)_wheel_).+|Suspension_.+|Front_Wheel_Steering|Canopy|ControlStick_.+|RudderPedal_.+|Throttle|(?:Nose|Main)_door_.+|Main_gear_(?:Left|Right)|Nose_steering|Nose_gear)$/;
function ownerOf(mesh: T.Object3D) {
  for (let n: T.Object3D | null = mesh; n && n !== root; n = n.parent)
    if (
      (dynamic.test(n.name) ||
        (id === "stormbird" &&
          /_(?:actuator_(?:barrel|piston)|brace_(?:upper|lower)|torque_link_(?:upper|lower)|scissor_pin|suspension)$/.test(
            n.name,
          ))) &&
      !(n instanceof T.Mesh)
    )
      return n;
  return root;
}
const surfaces = mountSurfaces(root, ownerOf),
  owners = new Map<T.Object3D, MountSurface[]>();
for (const s of surfaces) {
  const list = owners.get(s.owner) ?? [];
  list.push(s);
  owners.set(s.owner, list);
}
const packages = new Map<T.Object3D, T.Group>();
const material = new T.MeshStandardMaterial({
  name: id + "_mounting_alloy",
  color: 0x657179,
  metalness: 0.78,
  roughness: 0.42,
});
const backing = new T.MeshStandardMaterial({
  name: id + "_seated_backing",
  color: 0x293137,
  metalness: 0.35,
  roughness: 0.65,
});
const repairs: unknown[] = [];
function addMount(
  owner: T.Object3D,
  a: T.Vector3,
  b: T.Vector3,
  name: string,
  radius: number,
) {
  const direction = b.clone().sub(a),
    gap = direction.length();
  assert(gap > 1e-9 && gap < 0.8, `Unreviewed mount span ${gap}: ${name}`);
  direction.normalize();
  const overlap = Math.min(0.003, Math.max(0.00015, radius * 0.15));
  const start = a.clone().addScaledVector(direction, -overlap),
    end = b.clone().addScaledVector(direction, overlap);
  const geometry = new T.CylinderGeometry(
    radius,
    radius,
    start.distanceTo(end),
    12,
    1,
    false,
  );
  const matrix = new T.Matrix4().compose(
    start.clone().add(end).multiplyScalar(0.5),
    new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), direction),
    new T.Vector3(1, 1, 1),
  );
  geometry
    .applyMatrix4(matrix)
    .applyMatrix4(owner.matrixWorld.clone().invert());
  const mesh = new T.Mesh(geometry, gap < 0.01 ? backing : material);
  mesh.name = name;
  mesh.userData.attachmentRepair = { span: gap, owner: owner.name };
  const group = packages.get(owner) ?? new T.Group();
  group.name = id + "_authored_mounts_" + (owner.name || "airframe");
  group.add(mesh);
  packages.set(owner, group);
}
for (const [owner, parts] of owners) {
  const parent = parts.map((_, i) => i);
  const find = (i: number): number =>
    parent[i] === i ? i : (parent[i] = find(parent[i]));
  for (let i = 0; i < parts.length; i++)
    for (let j = 0; j < i; j++)
      if (
        find(i) !== find(j) &&
        boxDistSq(parts[i].box, parts[j].box) < 1e-10 &&
        nearestMount(parts[i], parts[j], 0.000010001).metres <= 0.00001
      )
        parent[find(i)] = find(j);
  const clusters = new Map<number, MountSurface[]>();
  for (let i = 0; i < parts.length; i++) {
    const list = clusters.get(find(i)) ?? [];
    list.push(parts[i]);
    clusters.set(find(i), list);
  }
  const groups = [...clusters.values()].sort(
    (a, b) =>
      b.reduce((n, s) => n + s.triangles.length, 0) -
      a.reduce((n, s) => n + s.triangles.length, 0),
  );
  const joined = groups.map((_, i) => i),
    get = (i: number): number =>
      joined[i] === i ? i : (joined[i] = get(joined[i]));
  const groupOf = new Map(
    groups.flatMap((g, i) => g.map((s) => [s, i] as const)),
  );
  for (let i = 0; i < groups.length; i++) {
    const sources = parts.filter((s) => get(groupOf.get(s)!) === get(i));
    const targets = parts.filter((s) => get(groupOf.get(s)!) !== get(i));
    if (!targets.length) break;
    const edge = nearestSurface(sources, targets);
    const structural =
      /Gear|gear|Equipment|Fuel|Bulkhead|WingStructure/.test(edge.a.name) &&
      !/legend|Markings|Livery|Seals|stitch/i.test(edge.a.name);
    const radius = structural
      ? T.MathUtils.clamp(edge.metres * 0.25, 0.003, 0.025)
      : T.MathUtils.clamp(edge.metres * 0.18, 0.0008, 0.012);
    const name =
      (edge.metres < 0.01 ? "Seated_backing_" : "Mounting_foot_") +
      repairs.length;
    if (edge.metres > 0.00001) addMount(owner, edge.pa, edge.pb, name, radius);
    if (edge.metres > 0.00001)
      repairs.push({
        owner: owner.name || "airframe",
        name,
        from: edge.a.name,
        to: edge.b.name,
        metres: edge.metres,
        radius,
        pa: edge.pa.toArray(),
        pb: edge.pb.toArray(),
      });
    joined[get(groupOf.get(edge.a)!)] = get(groupOf.get(edge.b)!);
  }
  console.log(
    id,
    owner.name || "airframe",
    parts.length,
    "surfaces",
    groups.length - 1,
    "local mounts",
  );
  await Bun.sleep(0);
  Bun.gc(true);
}
function bakedPart(
  owner: T.Object3D,
  geometry: T.BufferGeometry,
  name: string,
) {
  geometry.applyMatrix4(owner.matrixWorld.clone().invert());
  const mesh = new T.Mesh(geometry, material);
  mesh.name = name;
  const group = packages.get(owner) ?? new T.Group();
  group.name = id + "_authored_mounts_" + (owner.name || "airframe");
  group.add(mesh);
  packages.set(owner, group);
  return mesh;
}
function bearing(name: string, axis: T.Vector3) {
  const owner = root.getObjectByName(name)!;
  assert(owner, "Missing hinge " + name);
  const fixedOwner = ownerOf(owner.parent!);
  const center = owner.localToWorld(new T.Vector3());
  const worldAxis = axis.clone().transformDirection(owner.matrixWorld);
  const geometry = new T.CylinderGeometry(0.022, 0.022, 0.08, 24)
    .applyQuaternion(
      new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), worldAxis),
    )
    .translate(...center.toArray());
  const probe = new T.Mesh(geometry);
  probe.name = name + "_bearing_probe";
  const bearingSurface = mountSurfaces(probe, () => owner);
  for (const [carrier, targets] of [
    [owner, owners.get(owner)!],
    [fixedOwner, owners.get(fixedOwner)!],
  ] as const) {
    const edge = nearestSurface(bearingSurface, targets);
    if (edge.metres > 0.00001)
      addMount(
        carrier,
        edge.pa,
        edge.pb,
        name + "_hinge_lug_" + (carrier === owner ? "moving" : "fixed"),
        0.018,
      );
    bakedPart(
      carrier,
      geometry.clone(),
      name + "_hinge_pin_" + (carrier === owner ? "moving" : "fixed"),
    );
  }
  repairs.push({
    joint: name,
    kind: "coaxial hinge pin with fixed and moving lugs",
    center: center.toArray(),
    axis: worldAxis.toArray(),
  });
}
if (id === "peregrine") {
  for (const side of ["Left", "Right"]) {
    bearing("Elevator_" + side, new T.Vector3(1, 0, 0));
    bearing("Main_door_" + side, new T.Vector3(0, 0, 1));
  }
}
if (id === "stormbird") {
  const data = root.getObjectByName("Stormbird_HX40")!.userData.mechanisms;
  bearing(
    "Nose_gear",
    new T.Vector3().fromArray(
      data.legs.find((l: { name: string }) => l.name === "Nose_gear").axis,
    ),
  );
  for (const leg of ["Nose_gear", "Main_gear_Left", "Main_gear_Right"]) {
    const barrel = root.getObjectByName(leg + "_actuator_barrel")!;
    const piston = root.getObjectByName(leg + "_actuator_piston")!;
    const barrelMesh = barrel.children.find(
      (n) => n instanceof T.Mesh,
    ) as T.Mesh;
    const pistonMesh = piston.children.find(
      (n) => n instanceof T.Mesh,
    ) as T.Mesh;
    barrelMesh.geometry.computeBoundingBox();
    pistonMesh.geometry.computeBoundingBox();
    const barrelBox = barrelMesh.geometry.boundingBox!,
      pistonBox = pistonMesh.geometry.boundingBox!;
    const length = barrelBox.max.y,
      outer = Math.max(Math.abs(barrelBox.min.x), barrelBox.max.x) + 0.001,
      inner = Math.min(Math.abs(pistonBox.min.x), pistonBox.max.x) - 0.001;
    const profile = [
      [inner, -0.012],
      [outer, -0.012],
      [outer, 0.012],
      [inner, 0.012],
      [inner, -0.012],
    ].map(([r, y]) => new T.Vector2(r, y));
    const geometry = new T.LatheGeometry(profile, 32)
      .translate(0, length - 0.012, 0)
      .applyMatrix4(barrel.matrixWorld);
    bakedPart(barrel, geometry, leg + "_actuator_guide_gland");
  }
}
if (id === "finch") {
  bearing("Canopy", new T.Vector3(1, 0, 0));
  const canopy = root.getObjectByName("Canopy")!,
    cabin = canopy.parent!;
  for (const [index, support] of canopy.userData.supports.entries())
    for (const [carrier, point, targets] of [
      [
        root,
        cabin.localToWorld(new T.Vector3().fromArray(support.fixed)),
        owners.get(root)!,
      ],
      [
        canopy,
        canopy.localToWorld(new T.Vector3().fromArray(support.moving)),
        owners.get(canopy)!,
      ],
    ] as const) {
      const ball = new T.SphereGeometry(0.018, 16, 12).translate(
        ...point.toArray(),
      );
      const probe = new T.Mesh(ball),
        edge = nearestSurface(
          mountSurfaces(probe, () => carrier),
          targets,
        );
      if (edge.metres > 0.00001)
        addMount(
          carrier,
          point,
          edge.pb,
          `Canopy_ram_eye_${index}_${carrier === root ? "fixed" : "moving"}`,
          0.012,
        );
      bakedPart(
        carrier,
        ball,
        `Canopy_ram_eyelet_${index}_${carrier === root ? "fixed" : "moving"}`,
      );
    }
  // Pedals translate on longitudinal guides. A fixed rail spans both extremes,
  // and the existing pedal pivot serves as its moving carriage.
  for (const side of ["Left", "Right"])
    for (const foot of [-1, 1]) {
      const name = `RudderPedal_${side}_${foot}`,
        owner = root.getObjectByName(name)!;
      const edge = nearestSurface(owners.get(owner)!, owners.get(root)!);
      const railAxis = new T.Vector3(0, 0, 1).transformDirection(
        owner.matrixWorld,
      );
      const a = edge.pa.clone().addScaledVector(railAxis, -0.06),
        b = edge.pa.clone().addScaledVector(railAxis, 0.06);
      addMount(root, a, b, name + "_longitudinal_guide", 0.008);
      addMount(root, a, edge.pb, name + "_guide_floor_bracket", 0.012);
      repairs.push({ joint: name, kind: "pedal guide", travel: 0.07 });
    }
}
// Material/mesh/buffer data from the accepted asset remain byte-for-byte intact.
// The new mounting geometry is appended under the original rigid owner.
const bytes = new Uint8Array(await Bun.file(baseline).arrayBuffer()),
  isGLB = asset.endsWith(".glb");
const len = isGLB ? new DataView(bytes.buffer).getUint32(12, true) : 0;
let doc: Doc = JSON.parse(
  new TextDecoder().decode(isGLB ? bytes.slice(20, 20 + len) : bytes),
);
const originalNodes = doc.nodes.length;
const installation = new T.Group();
installation.name = id + "_attachment_repairs";
const destinations: number[] = [];
for (const [owner, group] of packages) {
  // Batch only parts with the same rigid owner and material. The attachment
  // checker still splits and tests every disconnected triangle island.
  const children = [...group.children] as T.Mesh[];
  group.clear();
  for (const mat of [material, backing]) {
    const parts = children.filter((m) => m.material === mat);
    if (!parts.length) continue;
    const geometry = mergeGeometries(parts.map((m) => m.geometry));
    assert(geometry);
    const mesh = new T.Mesh(geometry, mat);
    mesh.name = owner.name + "_mounts_" + mat.name;
    mesh.userData.parts = parts.map((m) => m.name);
    group.add(mesh);
  }
  if (owner === root) destinations.push(-1);
  else {
    const found = doc.nodes
      .map((n, i) => (n.name === owner.name ? i : -1))
      .filter((i) => i >= 0);
    assert.equal(found.length, 1, "Ambiguous owner " + owner.name);
    destinations.push(found[0]);
  }
  installation.add(group);
}
const filename = id + "-attachment-mounts.bin";
const compiled = compile(doc, installation, filename);
doc = compiled.doc;
const installationIndex = originalNodes,
  children = doc.nodes[installationIndex].children!;
for (let i = 0; i < children.length; i++)
  if (destinations[i] >= 0) {
    const target = doc.nodes[destinations[i]];
    target.children ??= [];
    target.children.push(children[i]);
  }
doc.nodes[installationIndex].children = children.filter(
  (_, i) => destinations[i] < 0,
);
doc.extras = { ...doc.extras, attachmentRepairRevision: 1 };
await Bun.write(
  out + "/" + id + "-mounts.json",
  JSON.stringify(repairs, null, 2),
);
await Bun.write(out + "/" + id + "-candidate.json", JSON.stringify(doc));
if (Bun.argv.includes("--write")) {
  assert.equal(
    sha(new Uint8Array(await Bun.file(asset).arrayBuffer())),
    currentAssetSha,
    "Aircraft changed while the repair was being prepared",
  );
  await Bun.write("public/assets/" + filename, compiled.binary);
  const outputBytes = isGLB
    ? glb(doc, bytes.slice(28 + len))
    : new TextEncoder().encode(JSON.stringify(doc));
  await Bun.write(asset, outputBytes);
  await Bun.write(
    guardFile,
    JSON.stringify(
      { assetSha: sha(outputBytes), supportSha: sha(compiled.binary) },
      null,
      2,
    ),
  );
  // Refresh only this model's revision; retain all fuel and mass measurements.
  const revision = createHash("sha256").update(outputBytes);
  for (const [index, buffer] of doc.buffers.entries())
    if (!(isGLB && index === 0 && !buffer.uri))
      revision.update(
        new Uint8Array(
          await Bun.file("public/assets/" + buffer.uri).arrayBuffer(),
        ),
      );
  const calibrationPath = "src/aircraft/fuel-mass-calibration.json";
  const calibrationText = await Bun.file(calibrationPath).text();
  const calibration = JSON.parse(calibrationText);
  await Bun.write(
    calibrationPath,
    calibrationText.replace(
      calibration.aircraft[id].assetRevision,
      revision.digest("hex"),
    ),
  );
  console.log("INSTALLED", id, repairs.length, "mounts");
} else console.log("PLAN_ONLY", id, repairs.length, "mounts");
