import { createHash } from "node:crypto";
import { Box3, Mesh, Vector3 } from "three";
import { loadGeometryOnly } from "./geometry-loader";
import { zeroLiftEstimate } from "../lab/aircraft";

const url = new URL("../public/assets/heron-ut9.glb", import.meta.url);
const { scene, sha256 } = await loadGeometryOnly(url);
scene.updateMatrixWorld(true);
const probes: { center: number[]; radius: number; part: string }[] = [];
const groups: [string, string, "x" | "z"][] = [
  ["Fuselage", "body", "z"],
  ["Curved_belly_livery", "body", "z"],
  ["Chin_cowling", "body", "z"],
  ["Cargo_pod", "body", "z"],
  ["Wing_Left", "leftWing", "x"],
  ["Wing_Right", "rightWing", "x"],
  ["Tailplane_Left", "tail", "x"],
  ["Tailplane_Right", "tail", "x"],
  ["Vertical_stabilizer", "tail", "z"],
  ["Propeller", "propeller", "x"],
];
for (const [name, part, axis] of groups) {
  const group = scene.getObjectByName(name);
  if (!group) throw Error(`Missing Heron collision geometry: ${name}`);
  const points: Vector3[] = [];
  group.traverse((node) => {
    if (
      !(node instanceof Mesh) ||
      /strut|light|fairing|attach|hinge/i.test(node.name)
    )
      return;
    const vertices = node.geometry.getAttribute("position");
    for (let i = 0; i < vertices.count; i++)
      points.push(
        new Vector3()
          .fromBufferAttribute(vertices, i)
          .applyMatrix4(node.matrixWorld),
      );
  });
  const bounds = new Box3().setFromPoints(points);
  const count = Math.max(
    1,
    Math.ceil((bounds.max[axis] - bounds.min[axis]) / 0.55),
  );
  for (let i = 0; i < count; i++) {
    const low =
      bounds.min[axis] + ((bounds.max[axis] - bounds.min[axis]) * i) / count;
    const high =
      bounds.min[axis] +
      ((bounds.max[axis] - bounds.min[axis]) * (i + 1)) / count;
    const slice = points.filter(
      (p) => p[axis] >= low - 0.07 && p[axis] <= high + 0.07,
    );
    if (!slice.length) continue;
    for (const coordinate of ["x", "y", "z"] as const)
      for (const direction of [-1, 1]) {
        const p = slice.reduce((a, b) =>
          b[coordinate] * direction > a[coordinate] * direction ? b : a,
        );
        probes.push({
          center: p.toArray().map((n) => +n.toFixed(5)),
          radius: 0.025,
          part,
        });
      }
  }
}
const unique = [
  ...new Map(
    probes.map((p) => [`${p.part}:${p.center.join(",")}`, p]),
  ).values(),
];
await Bun.write(
  new URL("../src/aircraft/heron/collision.json", import.meta.url),
  JSON.stringify(
    { asset: "heron-ut9.glb", sha256, scale: 1, offsetY: 0, probes: unique },
    null,
    2,
  ) + "\n",
);

const transfer = await Bun.file(
  new URL("../assets/heron/GLB/cad-transfer.json", import.meta.url),
).json();
const stations = transfer.wingStations as {
  x: number;
  leading: number;
  chord: number;
  y: number;
  incidence: number;
}[];
const positive = [{ ...stations[0], x: 0 }, ...stations];
let area = 0,
  chordSquared = 0,
  quarterMoment = 0;
for (let i = 1; i < positive.length; i++) {
  const a = positive[i - 1],
    b = positive[i],
    dx = b.x - a.x;
  area += dx * (a.chord + b.chord);
  chordSquared +=
    (2 * dx * (a.chord * a.chord + a.chord * b.chord + b.chord * b.chord)) / 3;
  const qa = a.leading + a.chord / 4,
    qb = b.leading + b.chord / 4;
  quarterMoment +=
    (dx / 3) *
    (2 * qa * a.chord + qa * b.chord + qb * a.chord + 2 * qb * b.chord);
}
const dimensions = new Box3()
  .setFromObject(scene)
  .getSize(new Vector3())
  .toArray();
const measurement = {
  id: "heron",
  name: "Heron UT–9",
  revision: sha256,
  dimensions,
  scale: 1,
  offsetY: 0,
  maxChordAsymmetry: 0,
  meshNames: ["Wing_skin_Left", "Wing_skin_Right"],
  stations: positive.map((s) => ({
    ...s,
    zeroLiftAlpha: zeroLiftEstimate(0.02),
  })),
  wingArea: area,
  meanAerodynamicChord: chordSquared / area,
  quarterChordZ: quarterMoment / area,
  assumptions: [
    "Gross main-wing stations from the original CAD; center section carried through the fuselage.",
    "14% NACA-style thickness, 2% sinusoidal camber; quarter-chord heights, 2.5 degree root incidence and 2.5 degree washout follow the CAD. Section zero-lift angle is a thin-airfoil estimate.",
    "Main wing only; attached flow. No fuselage, tail, propwash, viscous drag or stall-onset solution.",
  ],
};
await Bun.write(
  new URL("../src/aircraft/heron/geometry.json", import.meta.url),
  JSON.stringify(measurement, null, 2) + "\n",
);
const cad = await Bun.file(
  new URL("../assets/heron/checks/connectivity.json", import.meta.url),
).json();
await Bun.write(
  new URL("../public/assets/heron-ut9.cad.json", import.meta.url),
  JSON.stringify(
    {
      name: "Heron UT-9",
      assetSha256: sha256,
      source: "assets/heron/src/heron.py",
      cadVersion: "0.5.1",
      meshDeflectionMm: transfer.meshDeflectionMm,
      normalSource: transfer.normalSource,
      ...cad,
      runtimeDimensions: dimensions,
      wingArea: area,
      collisionProbes: unique.length,
      sourceSha256: createHash("sha256")
        .update(
          await Bun.file(
            new URL("../assets/heron/src/heron.py", import.meta.url),
          ).text(),
        )
        .digest("hex"),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    dimensions,
    wingArea: area,
    meanAerodynamicChord: chordSquared / area,
    collisionProbes: unique.length,
  }),
);
