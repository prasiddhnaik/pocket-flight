import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { random, terrainSurfaceHeight } from "./terrain";

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

/** Tileable ripples: slope in red and green, height in blue. Built from whole-number waves so it wraps. */
export function waveNormals(size = 256, seed = 311) {
  const rng = random(seed);
  const waves = Array.from({ length: 42 }, () => {
    let fx = 0,
      fy = 0;
    while (!fx && !fy) {
      fx = Math.round((rng() - 0.5) * 26);
      fy = Math.round((rng() - 0.5) * 26);
    }
    const amplitude = 1 / (Math.hypot(fx, fy) + 1.5) ** 1.15;
    return { fx, fy, amplitude, phase: rng() * Math.PI * 2 };
  });
  const samples = new Float32Array(size * size * 3);
  let slopeRange = 1e-6,
    heightRange = 1e-6;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      let height = 0,
        sx = 0,
        sy = 0;
      for (const w of waves) {
        const angle = (2 * Math.PI * (w.fx * x + w.fy * y)) / size + w.phase;
        const c = Math.cos(angle);
        height += w.amplitude * Math.sin(angle);
        sx += w.amplitude * w.fx * c;
        sy += w.amplitude * w.fy * c;
      }
      const at = (y * size + x) * 3;
      samples[at] = sx;
      samples[at + 1] = sy;
      samples[at + 2] = height;
      slopeRange = Math.max(slopeRange, Math.abs(sx), Math.abs(sy));
      heightRange = Math.max(heightRange, Math.abs(height));
    }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    data[i * 4] = 127.5 + (127.5 * samples[i * 3]) / slopeRange;
    data[i * 4 + 1] = 127.5 + (127.5 * samples[i * 3 + 1]) / slopeRange;
    data[i * 4 + 2] = 127.5 + (127.5 * samples[i * 3 + 2]) / heightRange;
    data[i * 4 + 3] = 255;
  }
  const texture = new T.DataTexture(data, size, size, T.RGBAFormat, T.UnsignedByteType);
  texture.wrapS = texture.wrapT = T.RepeatWrapping;
  texture.minFilter = T.LinearMipmapLinearFilter;
  texture.magFilter = T.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** A coconut palm: one leaning, tapered trunk and a full crown of arching fronds, 12 m tall at scale 1. */
export function palmGeometry() {
  const HEIGHT = 12,
    LEAN = 0.55,
    RINGS = 9,
    SIDES = 8;
  const trunkAt = (t: number) => LEAN * t * t;
  const positions: number[] = [],
    indices: number[] = [];
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    // A flared foot, then a slow taper, with a slight swell partway up as real trunks have.
    const radius = 0.2 + 0.11 * (1 - t) + 0.24 * Math.exp(-t * 16) + 0.015 * Math.sin(t * 9);
    for (let k = 0; k < SIDES; k++) {
      const a = (k / SIDES) * Math.PI * 2;
      positions.push(trunkAt(t) + Math.cos(a) * radius, t * HEIGHT, Math.sin(a) * radius);
    }
  }
  for (let i = 0; i < RINGS; i++)
    for (let k = 0; k < SIDES; k++) {
      const a = i * SIDES + k,
        b = i * SIDES + ((k + 1) % SIDES);
      indices.push(a, a + SIDES, b, b, a + SIDES, b + SIDES);
    }
  const trunk = new T.BufferGeometry();
  trunk.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  trunk.setIndex(indices);
  trunk.computeVertexNormals();

  const crown = new T.Vector3(trunkAt(1), HEIGHT, 0);
  const fronds: T.BufferGeometry[] = [];
  const COUNT = 12,
    SEGMENTS = 8;
  for (let f = 0; f < COUNT; f++) {
    const angle = (f / COUNT) * Math.PI * 2 + (f % 2) * 0.22;
    const young = f % 3 === 0;
    const length = (young ? 4.9 : 5.9) + Math.sin(f * 2.4) * 0.4;
    const rise = young ? 1.55 : 0.85;
    const droop = young ? 1.5 : 3.1;
    const dx = Math.cos(angle),
      dz = Math.sin(angle);
    const verts: number[] = [],
      colours: number[] = [],
      idx: number[] = [];
    for (let i = 0; i <= SEGMENTS; i++) {
      const t = i / SEGMENTS;
      const along = t * length;
      const y = crown.y + rise * Math.sin(t * Math.PI * 0.62) - droop * t * t;
      // Leaflets bunch along the frond, which the alternating width suggests at this distance.
      const width = 0.7 * Math.sin(Math.PI * t ** 0.7) ** 0.7 * (i % 2 ? 1 : 0.68);
      const cx = crown.x + dx * along,
        cz = crown.z + dz * along;
      verts.push(
        cx - dz * width, y - 0.26 * width, cz + dx * width,
        cx, y, cz,
        cx + dz * width, y - 0.26 * width, cz - dx * width,
      );
      const green = 0.8 + 0.5 * t;
      colours.push(0.17 * green, 0.38 * green, 0.08 * green, 0.24, 0.42, 0.11, 0.17 * green, 0.38 * green, 0.08 * green);
    }
    for (let i = 0; i < SEGMENTS; i++) {
      const a = i * 3;
      idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(verts, 3));
    geometry.setAttribute("color", new T.Float32BufferAttribute(colours, 3));
    geometry.setIndex(idx);
    geometry.computeVertexNormals();
    fronds.push(geometry);
  }
  return { trunk, fronds: mergeGeometries(fronds)! };
}
