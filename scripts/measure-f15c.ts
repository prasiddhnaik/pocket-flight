import { Box3, Mesh, Vector3 } from "three";
import { loadGeometryOnly } from "./geometry-loader";

// Reproducible, F-15C-only measurement. Existing fleet assets/data are untouched.
const url = new URL("../public/assets/f15c-eagle.glb", import.meta.url);
const { scene, sha256 } = await loadGeometryOnly(url);
scene.updateMatrixWorld(true);
const points = new Map<string, Vector3[]>();
scene.traverse((node) => {
  if (!(node instanceof Mesh)) return;
  const names: string[] = [];
  for (let p: typeof node | null = node; p; p = p.parent as typeof node | null)
    names.push(p.name);
  if (names.some((name) => /^(LandingGear|Gear_|Door_|Wheel_)/.test(name)))
    return;
  const label = names.join(" ");
  const part = /Wing_Left|Flap_Left|Aileron_Left/.test(label)
    ? "leftWing"
    : /Wing_Right|Flap_Right|Aileron_Right/.test(label)
      ? "rightWing"
      : /Fin_|Rudder_|Stabilator_/.test(label)
        ? "tail"
        : /Nozzle|Exhaust|Engine/i.test(label)
          ? "engine"
          : "body";
  const list = points.get(part) ?? [];
  const vertices = node.geometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i++)
    list.push(
      new Vector3()
        .fromBufferAttribute(vertices, i)
        .applyMatrix4(node.matrixWorld),
    );
  points.set(part, list);
});
const probes: { center: number[]; radius: number; part: string }[] = [];
for (const [part, vertices] of points) {
  const axis = part.endsWith("Wing") || part === "tail" ? "x" : "z";
  const box = new Box3().setFromPoints(vertices);
  const count = Math.max(1, Math.ceil((box.max[axis] - box.min[axis]) / 0.5));
  for (let i = 0; i < count; i++) {
    const lo = box.min[axis] + ((box.max[axis] - box.min[axis]) * i) / count;
    const hi =
      box.min[axis] + ((box.max[axis] - box.min[axis]) * (i + 1)) / count;
    const slice = vertices.filter(
      (p) => p[axis] >= lo - 0.05 && p[axis] <= hi + 0.05,
    );
    if (!slice.length) continue;
    for (const coordinate of ["x", "y", "z"] as const)
      for (const sign of [-1, 1]) {
        const p = slice.reduce((a, b) =>
          b[coordinate] * sign > a[coordinate] * sign ? b : a,
        );
        probes.push({
          center: p.toArray().map((v) => +v.toFixed(6)),
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
if (
  unique.length < 50 ||
  !["body", "leftWing", "rightWing", "tail"].every((part) =>
    unique.some((p) => p.part === part),
  )
)
  throw Error("Incomplete F-15C collision measurement");
await Bun.write(
  new URL("../src/aircraft/f15c/collision.json", import.meta.url),
  JSON.stringify(
    {
      asset: "f15c-eagle.glb",
      sha256,
      scale: 1,
      offsetY: 0,
      provenance:
        "Surface extrema sampled from the exact runtime export in 0.5m slices. Finite-radius approximation, not a convex hull or continuous skin collision.",
      dimensions: new Box3()
        .setFromObject(scene)
        .getSize(new Vector3())
        .toArray(),
      probes: unique,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  JSON.stringify({
    asset: url.pathname,
    sha256,
    probes: unique.length,
    classes: [...points.keys()],
  }),
);
