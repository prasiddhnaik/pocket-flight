import * as T from "three";

export type Face = { triangle: T.Triangle; box: T.Box3; part: string };
export type SkinPoint = { at: T.Vector3; part: string };
export function faces(root: T.Object3D, skinned = false) {
  root.updateMatrixWorld(true);
  const result: Face[] = [], points: SkinPoint[] = [];
  root.traverse((node) => {
    if (!(node instanceof T.Mesh) || (skinned && !(node instanceof T.SkinnedMesh))) return;
    if (node instanceof T.SkinnedMesh) node.skeleton.update();
    const g = node.geometry, index = g.index, joints = g.getAttribute("skinIndex"), weights = g.getAttribute("skinWeight");
    const vertices = new Map<number, SkinPoint>();
    const vertex = (i: number) => {
      let point = vertices.get(i);
      if (!point) {
        let part = node.name || node.parent?.name || "mesh";
        if (node instanceof T.SkinnedMesh) {
          let best = 0;
          for (let k = 1; k < 4; k++) if (weights.getComponent(i, k) > weights.getComponent(i, best)) best = k;
          part = node.skeleton.bones[joints.getComponent(i, best)].name;
        }
        point = { at: node.getVertexPosition(i, new T.Vector3()).applyMatrix4(node.matrixWorld), part };
        vertices.set(i, point);
      }
      return point;
    };
    const count = index?.count ?? g.getAttribute("position").count;
    for (let i = 0; i < count; i += 3) {
      const p = [0, 1, 2].map((k) => vertex(index ? index.getX(i + k) : i + k));
      const triangle = new T.Triangle(p[0].at, p[1].at, p[2].at);
      if (triangle.getArea() < 1e-12) continue;
      result.push({ triangle, box: new T.Box3().setFromPoints([triangle.a, triangle.b, triangle.c]), part: p[0].part });
    }
    points.push(...vertices.values());
  });
  return { faces: result, points };
}

/** Small immutable BVH: shared by ray, crossing and nearest-surface checks. */
export class Tree {
  readonly box = new T.Box3();
  readonly children: Tree[] = [];
  readonly items: Face[];
  constructor(items: Face[]) {
    for (const f of items) this.box.union(f.box);
    this.items = items;
    if (items.length > 12) {
      const size = this.box.getSize(new T.Vector3());
      const axis = size.x > size.y && size.x > size.z ? "x" : size.y > size.z ? "y" : "z";
      items.sort((a, b) => a.box.min[axis] + a.box.max[axis] - b.box.min[axis] - b.box.max[axis]);
      const middle = Math.floor(items.length / 2);
      this.children.push(new Tree(items.slice(0, middle)), new Tree(items.slice(middle)));
      this.items = [];
    }
  }
  hit(ray: T.Ray, max = Infinity): { distance: number; face: Face } | undefined {
    const entry = ray.intersectBox(this.box, new T.Vector3());
    if (!entry || (!this.box.containsPoint(ray.origin) && entry.distanceTo(ray.origin) > max)) return;
    let result: { distance: number; face: Face } | undefined;
    for (const child of this.children) {
      const hit = child.hit(ray, max);
      if (hit && hit.distance < max) { result = hit; max = hit.distance; }
    }
    const at = new T.Vector3();
    for (const face of this.items) {
      const { a, b, c } = face.triangle;
      if (!ray.intersectTriangle(a, b, c, false, at)) continue;
      const distance = ray.origin.distanceTo(at);
      if (distance > 1e-7 && distance < max) { result = { distance, face }; max = distance; }
    }
    return result;
  }
  nearest(point: T.Vector3, max: number): number {
    if (this.box.distanceToPoint(point) >= max) return max;
    for (const child of this.children) max = child.nearest(point, max);
    const at = new T.Vector3();
    for (const face of this.items) max = Math.min(max, face.triangle.closestPointToPoint(point, at).distanceTo(point));
    return max;
  }
  crossing(face: Face): Face | undefined {
    if (!this.box.intersectsBox(face.box)) return;
    if (this.children.length) {
      for (const child of this.children) { const found = child.crossing(face); if (found) return found; }
      return;
    }
    return this.items.find((other) => crossings(face.triangle, other.triangle));
  }
}

export function crossings(a: T.Triangle, b: T.Triangle) {
  const edges = (from: T.Triangle, to: T.Triangle) => {
    const vertices = [from.a, from.b, from.c], hit = new T.Vector3();
    return vertices.some((p, i) => {
      const q = vertices[(i + 1) % 3], length = p.distanceTo(q);
      const ray = new T.Ray(p, q.clone().sub(p).normalize());
      return !!ray.intersectTriangle(to.a, to.b, to.c, false, hit) && hit.distanceTo(p) > 1e-7 && hit.distanceTo(p) < length - 1e-7;
    });
  };
  return edges(a, b) || edges(b, a);
}
const axes = [new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0), new T.Vector3(0, 0, 1)];
/** All six first hits must face outwards. Corroborate axial depth with true nearest
 * surface distance: a grazing or unrelated shell cannot produce a deep verdict. */
export function insideDepth(point: T.Vector3, tree: Tree) {
  if (!tree.box.containsPoint(point)) return 0;
  let depth = Infinity;
  for (const axis of axes) for (const sign of [-1, 1]) {
    const direction = axis.clone().multiplyScalar(sign), hit = tree.hit(new T.Ray(point, direction));
    if (!hit || hit.face.triangle.getNormal(new T.Vector3()).dot(direction) <= 1e-6) return 0;
    depth = Math.min(depth, hit.distance);
  }
  return tree.nearest(point, depth);
}
export function hidden(eye: T.Vector3, target: T.Vector3, tree: Tree) {
  return !!tree.hit(new T.Ray(eye, target.clone().sub(eye).normalize()), eye.distanceTo(target) - 1e-4);
}

/** Material batches contain disconnected authored solids. Weld only for topology,
 * then orient each shell by signed volume; imported CAD shells can wind inward. */
export function solidTrees(faces: Face[]) {
  const parents = faces.map((_, i) => i), vertices = new Map<string, number>();
  const find = (i: number): number => {
    while (parents[i] !== i) { parents[i] = parents[parents[i]]; i = parents[i]; }
    return i;
  };
  faces.forEach((f, i) => {
    for (const p of [f.triangle.a, f.triangle.b, f.triangle.c]) {
      const key = `${f.part}:${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)},${Math.round(p.z * 1e6)}`;
      const other = vertices.get(key);
      if (other !== undefined) parents[find(i)] = find(other);
      else vertices.set(key, i);
    }
  });
  const groups = new Map<number, Face[]>();
  faces.forEach((face, i) => { const key = find(i), group = groups.get(key) ?? []; group.push(face); groups.set(key, group); });
  return [...groups.values()].map((group) => {
    const origin = group[0].triangle.a, cross = new T.Vector3();
    const volume = group.reduce((sum, f) => {
      const { a, b, c } = f.triangle;
      return sum + a.clone().sub(origin).dot(cross.crossVectors(b.clone().sub(origin), c.clone().sub(origin)));
    }, 0);
    const oriented = volume < 0 ? group.map((f) => ({ ...f, triangle: new T.Triangle(f.triangle.a, f.triangle.c, f.triangle.b) })) : group;
    return { part: group[0].part, tree: new Tree(oriented) };
  });
}
