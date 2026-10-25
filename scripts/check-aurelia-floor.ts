import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import * as T from "three";
import { makeAureliaReference } from "../src/aircraft/aurelia/reference-model";
import {
  aureliaBodyAt,
  aureliaAirframeScale as scale,
  aureliaInteriorLayout as layout,
} from "../src/aircraft/aurelia/exterior-reference";
import { aureliaCockpitLayout } from "../src/aircraft/aurelia/cockpit-layout";
import { loadGeometryOnly } from "./geometry-loader";

const names = ["Cockpit_floor", "Entry_vestibule_floor", "Cabin_floor"];
const tolerance = 0.00001; // 0.01 mm in the digital model.
const source = makeAureliaReference().root;
source.updateMatrixWorld(true);
const floorY = layout.floorY * scale;
const imported = await loadGeometryOnly(
  new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
);
const manifest = (await Bun.file(
  new URL("../output/aurelia-phenom/geometry.json", import.meta.url),
).json()) as { sha256: string };
assert.equal(
  imported.sha256,
  manifest.sha256,
  "Audit must use the current exported asset",
);
const floors = (root: T.Object3D) =>
  names.map((name) => {
    const object = root.getObjectByName(name);
    assert(object instanceof T.Mesh, name);
    return object;
  });
const points: T.Vector2[] = [];
const cockpit = aureliaCockpitLayout(scale);
for (let i = 0; i <= 910; i++) {
  const z = -6.25 + i * 0.01;
  const [rx, ry, cy] = aureliaBodyAt(z);
  const safeWidth = Math.min(
    0.61,
    rx *
      Math.sqrt(1 - ((layout.floorY - layout.floorThickness - cy) / ry) ** 2) -
      0.06,
  );
  for (const fraction of [-0.9, -0.6, -0.3, 0, 0.3, 0.6, 0.9]) {
    const x = safeWidth * fraction;
    if (
      z < -4.8 - cockpit.noseShift &&
      Math.abs(x) < cockpit.tunnelHalfWidth + 0.001
    )
      continue; // Reserved console tunnel.
    points.push(new T.Vector2(x, z));
  }
}
// Sample directly on each joint and 0.01 mm to either side, independently of the grid.
for (const z of [-3.99, -3.35])
  for (const dz of [-0.00001, 0, 0.00001])
    for (const x of [-0.5, -0.3, 0, 0.3, 0.5])
      points.push(new T.Vector2(x, z + dz));

for (const point of points) point.multiplyScalar(scale);

function stats(heights: number[]) {
  const minimum = Math.min(...heights),
    maximum = Math.max(...heights);
  const maxError = Math.max(...heights.map((y) => Math.abs(y - floorY)));
  assert(
    maximum - minimum < tolerance,
    `Floor height spread: ${maximum - minimum} m`,
  );
  assert(maxError < tolerance, `Floor datum error: ${maxError} m`);
  return {
    probes: heights.length,
    minimumY: minimum,
    maximumY: maximum,
    heightSpreadMetres: maximum - minimum,
    maximumDatumErrorMetres: maxError,
  };
}

// Pass 1: Three.js triangle-ray intersections on the generated source model.
const sourceFloors = floors(source),
  sourceHeights: number[] = [];
for (const p of points) {
  const hits = new T.Raycaster(
    new T.Vector3(p.x, floorY + 0.1, p.y),
    new T.Vector3(0, -1, 0),
    0,
    0.2,
  ).intersectObjects(sourceFloors);
  assert(hits.length, `Source floor hole at ${p.x},${p.y}`);
  sourceHeights.push(hits[0].point.y);
}
const sourceStats = stats(sourceHeights);
let maxHullQ = 0;
for (const floor of sourceFloors) {
  const p = floor.geometry.getAttribute("position");
  for (let i = 0; i < p.count; i++) {
    const v = new T.Vector3()
      .fromBufferAttribute(p, i)
      .applyMatrix4(floor.matrixWorld);
    v.divideScalar(scale);
    const [rx, ry, cy] = aureliaBodyAt(v.z);
    maxHullQ = Math.max(maxHullQ, (v.x / rx) ** 2 + ((v.y - cy) / ry) ** 2);
  }
}
assert(maxHullQ < 1, "Floor must stay inside the pressure-body envelope");
const roof = new T.Box3().setFromObject(
  source.getObjectByName("Cabin_liner_Right")!,
);
const centreCabinHeight = roof.max.y - floorY;
assert(
  Math.abs(centreCabinHeight - layout.cabinHeight * scale) < tolerance,
  "Cabin headroom must follow the enlarged envelope",
);

// Pass 2: Independently project decoded GLB triangles into X/Z and solve their
// barycentric coordinates. This does not use Raycaster or the floor builder.
type Triangle = [T.Vector3, T.Vector3, T.Vector3];
const tops: Triangle[] = [];
for (const floor of floors(imported.scene)) {
  const p = floor.geometry.getAttribute("position"),
    index = floor.geometry.index!;
  for (let i = 0; i < index.count; i += 3) {
    const triangle = [0, 1, 2].map((j) =>
      new T.Vector3()
        .fromBufferAttribute(p, index.getX(i + j))
        .applyMatrix4(floor.matrixWorld),
    ) as Triangle;
    const normal = triangle[1]
      .clone()
      .sub(triangle[0])
      .cross(triangle[2].clone().sub(triangle[0]));
    if (normal.y > 0 && normal.y / normal.length() > 0.999) tops.push(triangle);
  }
}
const exportedHeights: number[] = [];
for (const p of points) {
  let height: number | undefined;
  for (const [a, b, c] of tops) {
    const denominator = (b.z - c.z) * (a.x - c.x) + (c.x - b.x) * (a.z - c.z);
    if (Math.abs(denominator) < 1e-14) continue;
    const u =
      ((b.z - c.z) * (p.x - c.x) + (c.x - b.x) * (p.y - c.z)) / denominator;
    const v =
      ((c.z - a.z) * (p.x - c.x) + (a.x - c.x) * (p.y - c.z)) / denominator;
    const w = 1 - u - v;
    if (Math.min(u, v, w) >= -1e-8) {
      height = u * a.y + v * b.y + w * c.y;
      break;
    }
  }
  assert(height !== undefined, `Exported floor hole at ${p.x},${p.y}`);
  exportedHeights.push(height);
}
const exportedStats = stats(exportedHeights);
const result = {
  assetSha256: imported.sha256,
  airframeScale: scale,
  targetFloorY: floorY,
  digitalToleranceMetres: tolerance,
  sourceRaycast: sourceStats,
  exportedBarycentric: exportedStats,
  maximumFloorHullQ: maxHullQ,
  maximumCabinHeightMetres: centreCabinHeight,
  airstairRiseMetres: floorY / (layout.stairCount + 1),
  scope:
    "Static walking-floor geometry. Motion clearance and visual inspection are separate verification passes.",
};
const outputFlag = Bun.argv.indexOf("--out");
const output = resolve(
  outputFlag < 0 ? "output/aurelia-level-floor" : Bun.argv[outputFlag + 1],
);
await mkdir(output, { recursive: true });
await Bun.write(resolve(output, "math.json"), JSON.stringify(result, null, 2));
console.log("AURELIA_FLOOR_MATH_VERIFIED", JSON.stringify(result));
