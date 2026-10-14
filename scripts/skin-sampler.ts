import * as T from "three";
import { Octree } from "three/addons/math/Octree.js";
import { fixedWingSkins } from "../lab/internal-control-link";

/** Offline exact triangle queries, indexed for full rendered-vertex audits. */
export function wingSampler(root: T.Object3D, wing: T.Object3D) {
  const group = new T.Group();
  const inverse = root.matrixWorld.clone().invert();
  for (const source of fixedWingSkins(wing)) {
    const proxy = new T.Mesh(source.geometry);
    proxy.matrixAutoUpdate = false;
    proxy.matrix.multiplyMatrices(inverse, source.matrixWorld);
    group.add(proxy);
  }
  const top = new T.Box3().setFromObject(group).max.y + 1;
  const tree = new Octree().fromGraphNode(group);
  return (x: number, z: number) => {
    const ray = new T.Ray(new T.Vector3(x, top, z), new T.Vector3(0, -1, 0));
    const triangles: T.Triangle[] = [],
      point = new T.Vector3();
    tree.getRayTriangles(ray, triangles);
    let lower = Infinity,
      upper = -Infinity,
      count = 0;
    for (const t of triangles) {
      if (!ray.intersectTriangle(t.a, t.b, t.c, false, point)) continue;
      lower = Math.min(lower, point.y);
      upper = Math.max(upper, point.y);
      count++;
    }
    if (count < 2) throw new Error(`No closed wing at ${x}, ${z}`);
    return { lower, upper };
  };
}
