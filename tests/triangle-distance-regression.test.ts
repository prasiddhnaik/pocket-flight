import { expect, test } from "bun:test";
import * as T from "three";
import { distance, tree, type Tri } from "../scripts/triangle-distance";
const tri = (points: number[][]): Tri => {
  const [a, b, c] = points.map((p) => new T.Vector3().fromArray(p));
  return { a, b, c, box: new T.Box3().setFromPoints([a, b, c]) };
};
test("nearly coplanar millimetre triangles cannot invent a zero-distance ray hit", () => {
  const a = tri([
    [0.008861392736434937, 0.505027981386094, -0.7448999995064305],
    [0.00767400860786438, 0.5054919961574343, -0.744899999444086],
    [0.012953996658325195, 0.509691997064518, -0.7448999988797788],
  ]);
  const b = tri([
    [0.014861375093460083, 0.505027981386094, -0.7448999995064305],
    [0.014849990606307983, 0.5054919961574343, -0.744899999444086],
    [0.013673990964889526, 0.5054919961574343, -0.744899999444086],
  ]);
  const result = distance(tree([a]), tree([b]));
  expect(result.metres).toBeGreaterThanOrEqual(
    b.box.min.x - a.box.max.x - 1e-10,
  );
  expect(result.metres).toBeGreaterThan(0.0007);
  expect(
    a.box.distanceToPoint(new T.Vector3().fromArray(result.pa!)),
  ).toBeLessThan(1e-9);
  expect(
    b.box.distanceToPoint(new T.Vector3().fromArray(result.pb!)),
  ).toBeLessThan(1e-9);
});
