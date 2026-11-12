import { expect, test } from "bun:test";
import * as T from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { JET_CENTER, JET_SCALE } from "../src/aircraft/aircraft";
import { STORMBIRD_CENTER } from "../src/aircraft/stormbird/stormbird-config";

type Point = [number, number, number];
type FitMap = {
  id: string;
  parts: { name: string; material: string; min: Point; max: Point }[];
  surfaces: { id: string; surface: string; corners: [Point, Point, Point] }[];
};
const sceneY = { aurelia: -1.265, f15c: 0, peregrine: -JET_CENTER * JET_SCALE, stormbird: -STORMBIRD_CENTER };
for (const id of ["aurelia", "f15c", "peregrine", "stormbird"] as const) {
  test(`${id} fit map names parts and matches every shipped screen in aircraft metres`, async () => {
    const map: FitMap = await Bun.file(new URL(`../assets/${id}/cockpit/fit-map.json`, import.meta.url)).json();
    expect(Object.keys(map).sort()).toEqual(["id", "parts", "surfaces"]);
    expect(map.id).toBe(id);
    expect(map.parts.some((part) => part.name.startsWith("Seat_"))).toBe(true);
    for (const part of map.parts) {
      expect(Object.keys(part).sort()).toEqual(["material", "max", "min", "name"]);
      for (let axis = 0; axis < 3; axis++) {
        expect(Number.isFinite(part.min[axis])).toBe(true);
        expect(part.min[axis]!).toBeLessThanOrEqual(part.max[axis]!);
      }
    }
    const { scene } = await loadGeometryOnly(new URL(`../public/assets/cockpits/${id}.glb`, import.meta.url));
    scene.getObjectByName(`${id}_cockpit`)!.scale.setScalar(1);
    scene.position.y = sceneY[id];
    scene.updateMatrixWorld(true);
    const screens: string[] = [];
    scene.traverse((node) => { if (node.name.startsWith("Screen_") || node.name.includes("_Screen_")) {
      if (!(node instanceof T.Mesh)) screens.push(node.name);
    } });
    expect(map.surfaces.filter((surface) => surface.id.includes("Screen_")).map((surface) => surface.id).sort()).toEqual(screens.sort());
    for (const surface of map.surfaces.filter((surface) => surface.id.includes("Screen_"))) {
      const [a, b, c] = surface.corners.map((point) => new T.Vector3(...point));
      const box = new T.Box3().setFromPoints([a!, b!, c!, b!.clone().add(c!).sub(a!)]);
      const shipped = new T.Box3().setFromObject(scene.getObjectByName(surface.id)!);
      expect(box.min.distanceTo(shipped.min)).toBeLessThan(0.0002);
      expect(box.max.distanceTo(shipped.max)).toBeLessThan(0.0002);
    }
  });
}
