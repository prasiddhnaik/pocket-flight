import * as T from "three";
import { terrainSurfaceHeight } from "./terrain";

export function villageRoof(width: number, depth: number) {
  const profile = new T.Shape();
  profile.moveTo(-width / 2 - 0.9, 0);
  profile.lineTo(width / 2 + 0.9, 0);
  profile.lineTo(0, width * 0.42);
  profile.closePath();
  const geometry = new T.ExtrudeGeometry(profile, {
    depth: depth + 1.8,
    steps: 1,
    bevelEnabled: true,
    bevelThickness: 0.1,
    bevelSize: 0.1,
    bevelSegments: 2,
  });
  geometry.translate(0, 0, -(depth + 1.8) / 2);
  return geometry;
}

export function hangarRoof() {
  const geometry = new T.CylinderGeometry(
    12,
    12,
    26,
    24,
    1,
    false,
    Math.PI / 2,
    Math.PI,
  );
  geometry.rotateX(Math.PI / 2);
  return geometry;
}

export function groundPath(points: T.Vector3[], width: number) {
  const curve = new T.CatmullRomCurve3(points);
  const steps = Math.ceil(curve.getLength());
  const columns = Math.ceil(width);
  const vertices: number[] = [],
    indices: number[] = [];
  const pts = curve.getSpacedPoints(steps);
  for (let i = 0; i <= steps; i++) {
    const p = pts[i];
    const dir = pts[Math.min(i + 1, steps)]
      .clone()
      .sub(pts[Math.max(0, i - 1)])
      .normalize();
    for (let j = 0; j <= columns; j++) {
      const offset = (j / columns - 0.5) * width;
      const x = p.x + dir.z * offset,
        z = p.z - dir.x * offset;
      vertices.push(x, terrainSurfaceHeight(x, z) + 0.35, z);
      if (i < steps && j < columns) {
        const a = i * (columns + 1) + j,
          b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute("position", new T.Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}
