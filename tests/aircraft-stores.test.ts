import { expect, test } from "bun:test";
import { Box3, Mesh, Object3D, Raycaster, Vector3 } from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { addAircraftStores, type StoreLayout, type StoreMount } from "../src/aircraft/aircraft-stores";
import type { AircraftId } from "../src/aircraft/aircraft";
import {
  FINCH_ATTACK_ROOT,
  finchAttackHardpoints,
  finchAttackStores,
  removeRegistration,
} from "../src/aircraft/finch/attack";

const assets = new URL("../public/assets/", import.meta.url);
// The Finch A-2 loads the trainer airframe under its own root name.
const attackFinch = (scene: Object3D) => {
  scene.getObjectByName("Finch_U2")!.name = FINCH_ATTACK_ROOT;
  return finchAttackStores();
};
const models: [string, AircraftId, string, string, ((scene: Object3D) => StoreLayout)?][] = [
  ["f15c", "f15c", "f15c-eagle.glb", "F15C_Eagle"],
  ["peregrine", "peregrine", "peregrine-hx27.glb", "Peregrine_HX27"],
  ["stormbird", "stormbird", "stormbird-hx40.gltf", "Stormbird_HX40"],
  ["finch A-2", "finch", "finch-u2.glb", FINCH_ATTACK_ROOT, attackFinch],
];
// Every joint is built with 25 mm of overlap; allow a little for tessellation.
const TOLERANCE = 0.004;

const load = async (file: string) => (await loadGeometryOnly(new URL(file, assets))).scene;

for (const [label, id, file, airframeName, layout] of models)
  test(`${label}: every store and exterior detail is fixed to its mount, none float`, async () => {
    const scene = await load(file);
    const group = addAircraftStores(scene, id, layout ? layout(scene) : undefined)!;
    expect(group.children.length).toBeGreaterThan(4);
    scene.updateMatrixWorld(true);
    const skin: Mesh[] = [];
    scene.getObjectByName(airframeName)!.traverse((o) => {
      if (o instanceof Mesh) skin.push(o);
    });
    const ray = new Raycaster();
    const hit = (from: Vector3, direction: Vector3) => {
      ray.set(from, direction);
      return ray.intersectObjects(skin, false)[0]?.point;
    };
    const floating: string[] = [];
    group.children.forEach((part, index) => {
      const mount = part.userData.mount as StoreMount;
      const box = new Box3().setFromObject(part);
      const label = `${index}:${part.type}`;
      if (mount instanceof Object3D) {
        const overlap = box.clone().intersect(new Box3().setFromObject(mount));
        const size = overlap.isEmpty() ? new Vector3(-1, -1, -1) : overlap.getSize(new Vector3());
        if (Math.min(size.x, size.y, size.z) < TOLERANCE) floating.push(`${label} misses its parent part`);
        return;
      }
      const contact = part.userData.contact as { x?: number; y?: number; z0: number; z1: number };
      for (let k = 0; k <= 6; k++) {
        const z = contact.z0 + ((contact.z1 - contact.z0) * k) / 6;
        if (mount === "under-skin") {
          const point = hit(new Vector3(contact.x, box.min.y - 1, z), new Vector3(0, 1, 0));
          if (!point || point.y > box.max.y + TOLERANCE) floating.push(`${label} hangs below the skin at z ${z.toFixed(2)}`);
        } else if (mount === "over-skin") {
          const point = hit(new Vector3(contact.x, box.max.y + 1, z), new Vector3(0, -1, 0));
          if (!point || point.y < box.min.y - TOLERANCE) floating.push(`${label} stands above the skin at z ${z.toFixed(2)}`);
        } else {
          const side = Math.sign(box.min.x + box.max.x);
          const point = hit(new Vector3(side * 30, contact.y, z), new Vector3(-side, 0, 0));
          const inner = side > 0 ? box.min.x : -box.max.x;
          if (!point || Math.abs(point.x) < inner - TOLERANCE) floating.push(`${label} stands off the skin at z ${z.toFixed(2)}`);
        }
      }
    });
    expect(floating).toEqual([]);
  });

test("finch A-2: four pylons fitted at the declared hardpoints", async () => {
  const scene = await load("finch-u2.glb");
  const group = addAircraftStores(scene, "finch", attackFinch(scene))!;
  const fitted = new Map<string, number[]>();
  group.children.forEach((part) => {
    const point = part.userData.hardpoint as { id: string; position: number[] } | undefined;
    if (point) fitted.set(point.id, point.position);
  });
  expect([...fitted.keys()].sort()).toEqual(finchAttackHardpoints.map((h) => h.id).sort());
  for (const hardpoint of finchAttackHardpoints)
    hardpoint.position.forEach((value, axis) => expect(Math.abs(fitted.get(hardpoint.id)![axis] - value)).toBeLessThan(0.05));
});

test("finch A-2: a hardpoint rejects stores it cannot carry", () => {
  expect(() => finchAttackStores({ "left-outer": "aim120" })).toThrow(/left-outer cannot carry aim120/);
});

test("finch A-2: civil registration letters are removed, the rest of the frame stays", async () => {
  const scene = await load("finch-u2.glb");
  const frame = scene.getObjectByName("Fuselage_•_Frame") as Mesh;
  const before = frame.geometry.index!.count;
  removeRegistration(scene);
  const after = frame.geometry.index!.count;
  expect(after).toBeLessThan(before);
  // Only the 12 small letter parts go; the canopy frame and fittings remain.
  expect(after).toBeGreaterThan(before * 0.6);
});
