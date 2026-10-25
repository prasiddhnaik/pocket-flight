import * as T from "three";
export type Tri = { a: T.Vector3; b: T.Vector3; c: T.Vector3; box: T.Box3 };
export type Tree = { box: T.Box3; left?: Tree; right?: Tree; tri?: Tri[] };
export function triangles(mesh: T.Mesh): Tri[] {
  const p = mesh.geometry.getAttribute("position"),
    ix = mesh.geometry.index;
  const result: Tri[] = [];
  for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) =>
      new T.Vector3()
        .fromBufferAttribute(p, ix ? ix.getX(i + j) : i + j)
        .applyMatrix4(mesh.matrixWorld),
    );
    if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-20) continue;
    result.push({ a, b, c, box: new T.Box3().setFromPoints([a, b, c]) });
  }
  return result;
}
export function tree(tri: Tri[]): Tree {
  const box = new T.Box3();
  for (const t of tri) box.union(t.box);
  if (tri.length < 12) return { box, tri };
  const size = box.getSize(new T.Vector3());
  const axis =
    size.x >= size.y && size.x >= size.z ? "x" : size.y >= size.z ? "y" : "z";
  tri.sort(
    (a, b) =>
      a.box.min[axis] + a.box.max[axis] - (b.box.min[axis] + b.box.max[axis]),
  );
  const k = tri.length >> 1;
  return { box, left: tree(tri.slice(0, k)), right: tree(tri.slice(k)) };
}
export function boxDistSq(a: T.Box3, b: T.Box3) {
  let d = 0;
  for (const k of ["x", "y", "z"] as const) {
    const gap = Math.max(0, a.min[k] - b.max[k], b.min[k] - a.max[k]);
    d += gap * gap;
  }
  return d;
}
const edgeP = new T.Vector3(),
  edgeQ = new T.Vector3();
function segSeg(a: T.Vector3, b: T.Vector3, c: T.Vector3, d: T.Vector3) {
  const u = b.clone().sub(a),
    v = d.clone().sub(c),
    w = a.clone().sub(c);
  const aa = u.dot(u),
    bb = u.dot(v),
    cc = v.dot(v),
    dd = u.dot(w),
    ee = v.dot(w),
    D = aa * cc - bb * bb;
  let sN = D,
    sD = D,
    tN = D,
    tD = D;
  if (D < 1e-16) {
    sN = 0;
    sD = 1;
    tN = ee;
    tD = cc;
  } else {
    sN = bb * ee - cc * dd;
    tN = aa * ee - bb * dd;
    if (sN < 0) {
      sN = 0;
      tN = ee;
      tD = cc;
    } else if (sN > sD) {
      sN = sD;
      tN = ee + bb;
      tD = cc;
    }
  }
  if (tN < 0) {
    tN = 0;
    if (-dd < 0) sN = 0;
    else if (-dd > aa) sN = sD;
    else {
      sN = -dd;
      sD = aa;
    }
  } else if (tN > tD) {
    tN = tD;
    if (-dd + bb < 0) sN = 0;
    else if (-dd + bb > aa) sN = sD;
    else {
      sN = -dd + bb;
      sD = aa;
    }
  }
  const sc = Math.abs(sN) < 1e-16 ? 0 : sN / sD,
    tc = Math.abs(tN) < 1e-16 ? 0 : tN / tD;
  edgeP.copy(a).addScaledVector(u, sc);
  edgeQ.copy(c).addScaledVector(v, tc);
  return edgeP.distanceToSquared(edgeQ);
}
function triDist(a: Tri, b: Tri) {
  const av = [a.a, a.b, a.c],
    bv = [b.a, b.b, b.c];
  let best = Infinity;
  let pa: T.Vector3 | undefined, pb: T.Vector3 | undefined;
  const point = new T.Vector3();
  for (const [vs, t, rev] of [
    [av, b, false],
    [bv, a, true],
  ] as const) {
    const tr = new T.Triangle(t.a, t.b, t.c);
    for (const v of vs) {
      tr.closestPointToPoint(v, point);
      const d = v.distanceToSquared(point);
      if (d < best) {
        best = d;
        pa = (rev ? point : v).clone();
        pb = (rev ? v : point).clone();
      }
    }
    for (let i = 0; i < 3; i++) {
      const start = vs[i],
        end = vs[(i + 1) % 3],
        dir = end.clone().sub(start),
        len = dir.length();
      // A nearly coplanar ray can divide roundoff by a vanishing plane
      // denominator and invent a hit outside both triangles. Coplanar contact
      // is already covered by the vertex/edge distances below.
      const normal = t.b.clone().sub(t.a).cross(t.c.clone().sub(t.a));
      if (Math.abs(dir.dot(normal)) <= len * normal.length() * 1e-12) continue;
      const ray = new T.Ray(start, dir.divideScalar(len));
      const hit = ray.intersectTriangle(t.a, t.b, t.c, false, point);
      if (hit && hit.distanceToSquared(start) <= len * len + 1e-16) {
        return { sq: 0, pa: hit.clone(), pb: hit.clone() };
      }
    }
  }
  for (let i = 0; i < 3; i++)
    for (let j = 0; j < 3; j++) {
      const d = segSeg(av[i], av[(i + 1) % 3], bv[j], bv[(j + 1) % 3]);
      if (d < best) {
        best = d;
        pa = edgeP.clone();
        pb = edgeQ.clone();
      }
    }
  return { sq: best, pa: pa!, pb: pb! };
}
export function distance(a: Tree, b: Tree, limit = Infinity) {
  let best = limit * limit,
    pa: T.Vector3 | undefined,
    pb: T.Vector3 | undefined,
    checked = 0;
  const stack: [Tree, Tree][] = [[a, b]];
  while (stack.length) {
    const [x, y] = stack.pop()!;
    if (boxDistSq(x.box, y.box) > best + 1e-18) continue;
    if (x.tri && y.tri) {
      for (const u of x.tri)
        for (const v of y.tri) {
          if (boxDistSq(u.box, v.box) > best + 1e-18) continue;
          checked++;
          const r = triDist(u, v);
          if (r.sq < best) {
            best = r.sq;
            pa = r.pa;
            pb = r.pb;
            if (best < 1e-18)
              return {
                metres: Math.sqrt(best),
                pa: pa.toArray(),
                pb: pb.toArray(),
                checked,
              };
          }
        }
    } else if (
      !x.tri &&
      (y.tri ||
        x.box.getSize(new T.Vector3()).lengthSq() >
          y.box.getSize(new T.Vector3()).lengthSq())
    ) {
      const pairs: [Tree, Tree][] = [
        [x.left!, y],
        [x.right!, y],
      ];
      pairs.sort(
        (p, q) => boxDistSq(q[0].box, q[1].box) - boxDistSq(p[0].box, p[1].box),
      );
      stack.push(...pairs);
    } else {
      const pairs: [Tree, Tree][] = [
        [x, y.left!],
        [x, y.right!],
      ];
      pairs.sort(
        (p, q) => boxDistSq(q[0].box, q[1].box) - boxDistSq(p[0].box, p[1].box),
      );
      stack.push(...pairs);
    }
  }
  return {
    metres: Math.sqrt(best),
    pa: pa?.toArray(),
    pb: pb?.toArray(),
    checked,
  };
}
