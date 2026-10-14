import * as T from "three";

/** Connected triangle surfaces, welding authoring seams for offline measurement. */
export function connectedSurfaces(mesh: T.Mesh) {
  const p = mesh.geometry.getAttribute("position"),
    ix = mesh.geometry.index;
  const roots = Int32Array.from({ length: p.count }, (_, i) => i),
    keys = new Map<string, number>();
  const find = (i: number): number => {
    while (roots[i] !== i) {
      roots[i] = roots[roots[i]];
      i = roots[i];
    }
    return i;
  };
  for (let i = 0; i < p.count; i++) {
    const key = [p.getX(i), p.getY(i), p.getZ(i)]
      .map((v) => Math.round(v * 1e6))
      .join(",");
    const before = keys.get(key);
    if (before === undefined) keys.set(key, i);
    else roots[find(i)] = find(before);
  }
  const count = ix?.count ?? p.count,
    at = (i: number) => (ix ? ix.getX(i) : i);
  for (let i = 0; i < count; i += 3) {
    const a = find(at(i));
    roots[find(at(i + 1))] = a;
    roots[find(at(i + 2))] = a;
  }
  const groups = new Map<
    number,
    { indices: number[]; triangles: T.Vector3[][]; bounds: T.Box3 }
  >();
  for (let i = 0; i < count; i += 3) {
    const key = find(at(i)),
      g = groups.get(key) ?? {
        indices: [],
        triangles: [],
        bounds: new T.Box3(),
      };
    const triangle = [0, 1, 2].map((j) =>
      new T.Vector3()
        .fromBufferAttribute(p, at(i + j))
        .applyMatrix4(mesh.matrixWorld),
    );
    g.indices.push(at(i), at(i + 1), at(i + 2));
    g.triangles.push(triangle);
    triangle.forEach((v) => g.bounds.expandByPoint(v));
    groups.set(key, g);
  }
  return [...groups.values()];
}
