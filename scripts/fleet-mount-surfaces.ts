import * as T from "three";
import {
  boxDistSq,
  distance,
  tree,
  type Tree,
  type Tri,
} from "./triangle-distance";
import { objectPath } from "./aurelia-attachments";

export type MountSurface = {
  name: string;
  mesh: T.Mesh;
  owner: T.Object3D;
  box: T.Box3;
  triangles: Tri[];
  tree?: Tree;
};
export function mountSurfaces(
  root: T.Object3D,
  ownerOf: (m: T.Mesh) => T.Object3D,
) {
  root.updateMatrixWorld(true);
  const surfaces: MountSurface[] = [];
  root.traverse((mesh) => {
    if (!(mesh instanceof T.Mesh)) return;
    const p = mesh.geometry.getAttribute("position"),
      ix = mesh.geometry.index;
    const parents: number[] = [],
      faces: number[][] = [],
      keys = new Map<string, number>();
    const find = (i: number): number =>
      parents[i] === i ? i : (parents[i] = find(parents[i]));
    for (let offset = 0; offset < (ix?.count ?? p.count); offset += 3) {
      const face = [0, 1, 2].map((j) =>
        ix ? ix.getX(offset + j) : offset + j,
      );
      const [a, b, c] = face.map((i) =>
        new T.Vector3().fromBufferAttribute(p, i),
      );
      if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-20) continue;
      const id = faces.length;
      faces.push(face);
      parents.push(id);
      for (const i of face) {
        const key = [p.getX(i), p.getY(i), p.getZ(i)].join(",");
        const before = keys.get(key);
        if (before === undefined) keys.set(key, id);
        else parents[find(id)] = find(before);
      }
    }
    const groups = new Map<number, number[]>();
    for (let i = 0; i < faces.length; i++) {
      const k = find(i),
        list = groups.get(k) ?? [];
      list.push(...faces[i]);
      groups.set(k, list);
    }
    let part = 0;
    for (const indices of groups.values()) {
      const triangles: Tri[] = [],
        box = new T.Box3();
      for (let i = 0; i < indices.length; i += 3) {
        const [a, b, c] = [0, 1, 2].map((j) =>
          new T.Vector3()
            .fromBufferAttribute(p, indices[i + j])
            .applyMatrix4(mesh.matrixWorld),
        );
        const bounds = new T.Box3().setFromPoints([a, b, c]);
        box.union(bounds);
        triangles.push({ a, b, c, box: bounds });
      }
      surfaces.push({
        name:
          objectPath(mesh) +
          (groups.size > 1 ? `#surface-${++part}/${groups.size}` : ""),
        mesh,
        owner: ownerOf(mesh),
        box,
        triangles,
      });
    }
  });
  return surfaces;
}
export function surfaceTree(surface: MountSurface) {
  return (surface.tree ??= tree(surface.triangles));
}
export function nearestMount(
  a: MountSurface,
  b: MountSurface,
  limit = Infinity,
) {
  return distance(surfaceTree(a), surfaceTree(b), limit);
}
export function nearestSurface(
  sources: MountSurface[],
  targets: MountSurface[],
) {
  const pairs = sources
    .flatMap((a) =>
      targets
        .filter((b) => a !== b)
        .map((b) => ({ a, b, bound: boxDistSq(a.box, b.box) })),
    )
    .sort((a, b) => a.bound - b.bound);
  let metres = Infinity,
    best:
      | {
          a: MountSurface;
          b: MountSurface;
          pa: T.Vector3;
          pb: T.Vector3;
          metres: number;
        }
      | undefined;
  for (const { a, b, bound } of pairs) {
    if (bound > metres * metres) break;
    const d = nearestMount(a, b, metres);
    if (d.metres < metres && d.pa && d.pb) {
      metres = d.metres;
      best = {
        a,
        b,
        pa: new T.Vector3().fromArray(d.pa),
        pb: new T.Vector3().fromArray(d.pb),
        metres,
      };
    }
  }
  if (!best) throw new Error("No finite mount candidate");
  return best;
}
