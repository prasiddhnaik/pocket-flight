import { expect, test } from "bun:test";
import { Box3, DoubleSide, Mesh, Raycaster, Vector3 } from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";

const assets = new URL(process.env.AIRFRAME_ASSET_ROOT ?? "../public/assets/", import.meta.url);
function part(scene: import("three").Object3D, name: string) {
  const found = scene.getObjectByName(name.replaceAll(" ", "_"));
  if (!(found instanceof Mesh)) throw new Error("Missing detail " + name);
  return found;
}

for (const [id, skinMaterial, jointMaterial] of [
  ["peregrine-hx27", "Airframe | ceramic blue-grey", "Panel seals | graphite"],
  ["aurelia-flight", "Pearl | warm ceramic white", "Panel seals | warm graphite"],
]) {
  test(`${id}: panel joints follow both actual wing skins within 1.2 mm`, async () => {
    const { scene } = await loadGeometryOnly(new URL(`${id}.glb`, assets));
    scene.updateMatrixWorld(true);
    let maximum = 0;
    for (const side of ["Left", "Right"]) {
      const skin = part(scene, `Wing_${side} | ${skinMaterial}`);
      (skin.material as import("three").MeshStandardMaterial).side = DoubleSide;
      const detail = part(scene, `Wing_${side} | ${jointMaterial}`);
      const positions = detail.geometry.getAttribute("position"), point = new Vector3();
      const ray = new Raycaster();
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(detail.matrixWorld);
        ray.set(point.clone().add(new Vector3(0, 1, 0)), new Vector3(0, -1, 0));
        const hit = ray.intersectObject(skin, false)[0];
        expect(hit).toBeDefined();
        maximum = Math.max(maximum, Math.abs(hit.distance - 1));
      }
    }
    expect(maximum).toBeLessThan(.0012);
  });
}

test("Peregrine glazing bows use thin frame profiles, not round tubes", async () => {
  const { scene } = await loadGeometryOnly(new URL("peregrine-hx27.glb", assets));
  scene.updateMatrixWorld(true);
  for (const name of ["Canopy forward arch", "Windscreen rear arch"]) {
    const size = new Box3().setFromObject(part(scene, name)).getSize(new Vector3());
    expect(size.z).toBeGreaterThan(.039);
    expect(size.z).toBeLessThan(.041);
  }
});

test("Aurelia fuel access panels close the old exposed rings", async () => {
  const { scene } = await loadGeometryOnly(new URL("aurelia-flight.glb", assets));
  scene.updateMatrixWorld(true);
  for (const sign of [-1, 1]) {
    const side = sign < 0 ? "Left" : "Right";
    const cap = part(scene, `Wing_${side} | Machined titanium`);
    (cap.material as import("three").MeshStandardMaterial).side = DoubleSide;
    const hit = new Raycaster(new Vector3(sign * 10.7, 20, 3.84), new Vector3(0, -1, 0)).intersectObject(cap, false)[0];
    expect(hit).toBeDefined();
    expect(hit.point.y).toBeGreaterThan(3.5);
    expect(hit.point.y).toBeLessThan(3.9);
  }
});

test("Aurelia closed wing skins have outward orientation", async () => {
  const { scene } = await loadGeometryOnly(new URL("aurelia-flight.glb", assets));
  scene.updateMatrixWorld(true);
  for (const side of ["Left", "Right"]) {
    const skin = part(scene, `Wing_${side} | Pearl | warm ceramic white`);
    const a = skin.geometry.getAttribute("position"), indices = skin.geometry.index!;
    let volume = 0;
    for (let i = 0; i < indices.count; i += 3) {
      const p = [0, 1, 2].map((j) => new Vector3().fromBufferAttribute(a, indices.getX(i + j)).applyMatrix4(skin.matrixWorld));
      volume += p[0].dot(p[1].clone().cross(p[2])) / 6;
    }
    expect(volume).toBeGreaterThan(0);
  }
});
