import { Box3, Mesh, Vector3 } from "three";
import { loadGeometryOnly } from "./geometry-loader";
import { aircraftCatalog } from "../lab/aircraft";
import type { AircraftId } from "../src/aircraft";
import type { ContactPart } from "../src/airframe-contact";
// Offline metrology; no render mesh queries in the physics loop. The release
// uses compound spheres and sampled skin points, not triangle-exact collisions.
const models: Record<string, unknown> = {};
for (const id of [
  "aurelia",
  "finch",
  "peregrine",
  "stormbird",
] as AircraftId[]) {
  const config = aircraftCatalog[id];
  const { scene, sha256 } = await loadGeometryOnly(
    new URL("../public/assets/" + config.asset, import.meta.url),
  );
  scene.scale.setScalar(config.scale);
  scene.position.y = config.offsetY;
  scene.updateMatrixWorld(true);
  const probes: { center: number[]; radius: number; part: ContactPart }[] = [];
  const groups: [string, ContactPart][] = [
    ["AureliaGearBays", "body"],
    [id === "stormbird" ? "Airframe" : "Fuselage", "body"],
    ["Wing_Left", "leftWing"],
    ["Wing_Right", "rightWing"],
    ["Tailplane_Left", "tail"],
    ["Tailplane_Right", "tail"],
    ["Elevator_Left", "tail"],
    ["Elevator_Right", "tail"],
    ["Engine_Left", "engine"],
    ["Engine_Right", "engine"],
    ["Propeller", "propeller"],
  ];
  for (const [name, part] of groups) {
    const group = scene.getObjectByName(name);
    if (!group) continue;
    const points: Vector3[] = [];
    group.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const vertices = node.geometry.getAttribute("position");
      for (let i = 0; i < vertices.count; i++)
        points.push(
          new Vector3()
            .fromBufferAttribute(vertices, i)
            .applyMatrix4(node.matrixWorld),
        );
    });
    if (!points.length) continue;
    const axis =
      part === "leftWing" || part === "rightWing" || part === "tail"
        ? "x"
        : "z";
    const box = new Box3().setFromPoints(points);
    const count = Math.max(
      1,
      Math.ceil((box.max[axis] - box.min[axis]) / 0.75),
    );
    for (let i = 0; i < count; i++) {
      const lo = box.min[axis] + ((box.max[axis] - box.min[axis]) * i) / count;
      const hi =
        box.min[axis] + ((box.max[axis] - box.min[axis]) * (i + 1)) / count;
      const slice = points.filter(
        (p) => p[axis] >= lo - 0.12 && p[axis] <= hi + 0.12,
      );
      if (!slice.length) continue;
      const b = new Box3().setFromPoints(slice),
        center = b.getCenter(new Vector3());
      const add = (p: Vector3, radius: number) =>
        probes.push({
          center: p.toArray().map((n) => +n.toFixed(5)),
          radius: +radius.toFixed(5),
          part,
        });
      if (axis === "z") {
        const radius = Math.max(
          0.07,
          Math.min(0.95, (b.max.y - b.min.y) / 2, (b.max.x - b.min.x) / 2),
        );
        add(center, radius);
        // Skin extrema retain narrow nose/tail/belly contact that a middle
        // sphere would miss. Keep their actual XYZ, rather than a box corner.
        for (const direction of ["low", "high", "left", "right"] as const) {
          const p = slice.reduce((a, p) =>
            direction === "low"
              ? p.y < a.y
                ? p
                : a
              : direction === "high"
                ? p.y > a.y
                  ? p
                  : a
                : direction === "left"
                  ? p.x < a.x
                    ? p
                    : a
                  : p.x > a.x
                    ? p
                    : a,
          );
          add(p, 0.025);
        }
      } else {
        const chord = b.max.z - b.min.z;
        const chordCount = Math.max(1, Math.ceil(chord / 0.7));
        for (let j = 0; j <= chordCount; j++) {
          const z = b.min.z + (chord * j) / chordCount;
          const nearby = slice.filter((p) => Math.abs(p.z - z) < 0.35);
          if (!nearby.length) continue;
          const low = nearby.reduce((a, p) => (p.y < a.y ? p : a));
          add(new Vector3(center.x, low.y + 0.11, z), 0.11);
        }
        add(
          slice.reduce((a, p) => (p.y > a.y ? p : a)),
          0.025,
        );
      }
    }
  }
  models[id] = {
    asset: config.asset,
    sha256,
    scale: config.scale,
    offsetY: config.offsetY,
    probes,
  };
  console.log(id, probes.length, "proxies");
}
await Bun.write(
  new URL("../src/airframe-collision.json", import.meta.url),
  JSON.stringify({ model: "island-collision-1", models }),
);
