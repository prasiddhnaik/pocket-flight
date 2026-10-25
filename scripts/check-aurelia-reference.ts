import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as T from "three";
import { makeAureliaReference } from "../src/aircraft/aurelia/reference-model";
import { aureliaAirframeScale } from "../src/aircraft/aurelia/exterior-reference";
import {
  neutralExteriorPose,
  poseAureliaExterior,
} from "../src/aircraft/aurelia/exterior-mechanisms";
import { aircraftMeshes } from "./aurelia-attachments";
import { loadGeometryOnly } from "./geometry-loader";

const option = (flag: string, fallback: string) => {
  const index = Bun.argv.indexOf(flag);
  return index < 0 ? fallback : Bun.argv[index + 1];
};
const output = resolve(option("--out", "output/aurelia-reference-check"));
const { scene, sha256 } = await loadGeometryOnly(
  new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
);
const source = makeAureliaReference().root;
const sourceMeshes = aircraftMeshes(source),
  exported = aircraftMeshes(scene);
assert.equal(sourceMeshes.length, exported.length);
const poses = [
  { name: "neutral", pose: neutralExteriorPose() },
  { name: "entry-open", pose: { ...neutralExteriorPose(), entry: 1 } },
  {
    name: "mid-travel",
    pose: {
      gear: 0.5,
      entry: 0.5,
      cockpitDoor: 0.5,
      flaps: 0.5,
      roll: -0.5,
      pitch: 0.5,
      yaw: -0.5,
      steering: 1,
      fan: 1,
    },
  },
  {
    name: "endpoints",
    pose: {
      gear: 1,
      entry: 1,
      cockpitDoor: 1,
      flaps: 1,
      roll: 1,
      pitch: -1,
      yaw: 1,
      steering: -1,
      fan: 2.3,
    },
  },
];
const parity = poses.map(({ name, pose }) => {
  poseAureliaExterior(source, pose);
  poseAureliaExterior(scene, pose);
  let maximumErrorMetres = 0,
    vertices = 0;
  for (let i = 0; i < sourceMeshes.length; i++) {
    const a = sourceMeshes[i],
      b = exported[i];
    const sanitized = T.PropertyBinding.sanitizeNodeName(a.name);
    assert(
      b.name === sanitized || b.name.startsWith(sanitized + "_"),
      `Mesh order: ${a.name}`,
    );
    const pa = a.geometry.getAttribute("position"),
      pb = b.geometry.getAttribute("position");
    assert.equal(pa.count, pb.count);
    for (let j = 0; j < pa.count; j++) {
      const va = new T.Vector3()
        .fromBufferAttribute(pa, j)
        .applyMatrix4(a.matrixWorld);
      const vb = new T.Vector3()
        .fromBufferAttribute(pb, j)
        .applyMatrix4(b.matrixWorld);
      maximumErrorMetres = Math.max(maximumErrorMetres, va.distanceTo(vb));
      vertices++;
    }
  }
  assert(maximumErrorMetres < 1e-5, `${name}: source/export mismatch`);
  return { name, vertices, maximumErrorMetres };
});
poseAureliaExterior(scene, neutralExteriorPose());
const beforePath = option("--before", "");
const before = beforePath
  ? await loadGeometryOnly(pathToFileURL(resolve(beforePath)))
  : undefined;
const fittings = [];
for (const mesh of exported) {
  let preserved = false;
  for (let parent: T.Object3D | null = mesh; parent; parent = parent.parent)
    preserved ||= parent.userData.preservedFitting === true;
  if (!preserved) continue;
  const scale = mesh.getWorldScale(new T.Vector3());
  assert(
    scale.distanceTo(new T.Vector3(1, 1, 1)) < 1e-6,
    `${mesh.name}: fitting was resized`,
  );
  let dimensionErrorMetres = 0;
  if (before) {
    const original = before.scene.getObjectByName(mesh.name);
    assert(
      original instanceof T.Mesh,
      `${mesh.name}: original fitting missing`,
    );
    const size = (part: T.Object3D) =>
      new T.Box3().setFromObject(part).getSize(new T.Vector3());
    dimensionErrorMetres = size(mesh).distanceTo(size(original));
    assert(
      dimensionErrorMetres < 1e-6,
      `${mesh.name}: changed fitting dimensions`,
    );
  }
  fittings.push({
    name: mesh.name,
    worldScale: scale.toArray(),
    dimensionErrorMetres,
  });
}
assert.equal(
  fittings.length,
  318,
  "Check every preserved fitting mesh, including cockpit controls",
);
const exhausts = [];
for (const label of ["Left", "Right"]) {
  const engine = scene.getObjectByName(`Engine_${label}`)!;
  let shallowestHitZ = -Infinity;
  for (const radius of [0.12, 0.2, 0.26])
    for (let i = 0; i < 72; i++) {
      const angle = (i * Math.PI) / 36;
      const origin = engine.localToWorld(
        new T.Vector3(radius * Math.cos(angle), radius * Math.sin(angle), 1.3),
      );
      const direction = new T.Vector3(0, 0, -1).transformDirection(
        engine.matrixWorld,
      );
      const hit = new T.Raycaster(origin, direction, 0, 2).intersectObject(
        engine,
        true,
      )[0];
      assert(hit, `${label}: engine interior missing`);
      const z = engine.worldToLocal(hit.point.clone()).z;
      assert(
        z < 0.3 && z > -0.1,
        `${label}: outlet obstruction at radius ${radius}, angle ${angle}`,
      );
      shallowestHitZ = Math.max(shallowestHitZ, z);
    }
  exhausts.push({
    label,
    probes: 216,
    minimumRecessMetres: (1.18 - shallowestHitZ) * aureliaAirframeScale,
  });
}
const dimensions = new T.Box3().setFromObject(scene).getSize(new T.Vector3());
const report = {
  sha256,
  beforeSha256: before?.sha256,
  airframeScale: aureliaAirframeScale,
  dimensionsMetres: dimensions.toArray(),
  meshes: exported.length,
  parity,
  preservedFittingMeshes: fittings.length,
  fittings,
  exhausts,
};
await mkdir(output, { recursive: true });
await Bun.write(
  resolve(output, "geometry.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  "AURELIA_REFERENCE_VERIFIED",
  JSON.stringify({ ...report, fittings: undefined }),
);
