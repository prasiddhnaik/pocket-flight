import { expect, test } from "bun:test";
import { DoubleSide, Mesh, MeshStandardMaterial, Raycaster, Vector3 } from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { connectedSurfaces } from "../scripts/geometry-components";

const asset = new URL("../public/assets/finch-u2.glb", import.meta.url);

test("Finch cooling slots follow the cowling skin with outward faces", async () => {
  const { scene } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  const skin = scene.getObjectByName("Fuselage_•_Paint") as Mesh;
  (skin.material as MeshStandardMaterial).side = DoubleSide;
  const ray = new Raycaster();
  for (const [side, sign] of [["Left", -1], ["Right", 1]] as const) {
    const slots = scene.getObjectByName(`Cowling_cooling_slots_${side}`) as Mesh;
    expect(slots).toBeInstanceOf(Mesh);
    expect(connectedSurfaces(slots)).toHaveLength(5);
    const position = slots.geometry.getAttribute("position");
    const normals = slots.geometry.getAttribute("normal");
    for (let i = 0; i < position.count; i++) {
      const p = new Vector3().fromBufferAttribute(position, i).applyMatrix4(slots.matrixWorld);
      const n = new Vector3().fromBufferAttribute(normals, i).transformDirection(slots.matrixWorld);
      expect(n.x * sign).toBeGreaterThan(0.8);
      ray.set(p.clone().add(new Vector3(sign, 0, 0)), new Vector3(-sign, 0, 0));
      const hit = ray.intersectObject(skin, false)[0];
      expect(hit).toBeDefined();
      expect(Math.abs(hit.distance - 1)).toBeLessThan(0.001);
    }
  }
});

test("Finch exhaust is short and hollow, with no solid cap across the bore", async () => {
  const { scene } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  const pipe = scene.getObjectByName("Finch_short_hollow_exhaust") as Mesh;
  expect(pipe).toBeInstanceOf(Mesh);
  expect(pipe.userData.exposed_length_m).toBeLessThan(0.1);
  expect(pipe.userData.bore_diameter_m).toBeCloseTo(0.046, 6);
  const convert = ([x, y, z]: number[]) => new Vector3(x, z, -y);
  const outlet = convert(pipe.userData.outlet_center_blender_m);
  const direction = convert(pipe.userData.outlet_direction_blender).normalize();
  (pipe.material as MeshStandardMaterial).side = DoubleSide;
  const ray = new Raycaster(outlet.clone().addScaledVector(direction, 0.05), direction.negate(), 0, 0.16);
  expect(ray.intersectObject(pipe, false)).toHaveLength(0);
});

test("Finch composite tail no longer carries decorative circumferential hoops", async () => {
  const { scene } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  const seams = scene.getObjectByName("Fuselage_•_Seals") as Mesh;
  const hoops = connectedSurfaces(seams).filter(({ bounds }) =>
    bounds.min.z > 1.5 && bounds.max.z - bounds.min.z < 0.01,
  );
  expect(hoops).toHaveLength(0);
});
