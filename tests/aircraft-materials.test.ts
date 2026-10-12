import { test, expect } from "bun:test";
import * as T from "three";
import { refineAircraftMaterials } from "../src/aircraft-materials";

test("finish refinement preserves authored color, textures, sharing and matte rubber", () => {
  const root = new T.Group(),
    map = new T.Texture();
  const paint = new T.MeshStandardMaterial({
    color: "#125665",
    map,
    roughness: 1,
  });
  paint.name = "Paint ceramic";
  const rubber = new T.MeshStandardMaterial({
    color: "#111111",
    roughness: 0.88,
  });
  rubber.name = "Tire rubber";
  const a = new T.Mesh(new T.BoxGeometry(), paint),
    b = a.clone();
  const tire = new T.Mesh(new T.BoxGeometry(), rubber);
  root.add(a, b, tire);
  refineAircraftMaterials(root);
  expect(a.material).toBeInstanceOf(T.MeshPhysicalMaterial);
  expect(a.material).toBe(b.material);
  expect(a.material.map).toBe(map);
  expect(a.material.color.equals(paint.color)).toBe(true);
  expect(tire.material).toBe(rubber);
  expect(rubber.roughness).toBe(0.88);
  const refined = a.material;
  refineAircraftMaterials(root);
  expect(a.material).toBe(refined);
});
