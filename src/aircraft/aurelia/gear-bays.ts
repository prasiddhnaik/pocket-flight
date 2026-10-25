import * as T from "three";
import { aureliaBodyAt } from "./exterior-reference";

type Paints = {
  white: T.MeshStandardMaterial;
  blue: T.MeshStandardMaterial;
  well: T.MeshStandardMaterial;
  dark: T.MeshStandardMaterial;
  silver: T.MeshStandardMaterial;
};

/** Enclosed nose well. The raised forward pocket reserves the folded tire and
 * the narrow aft tunnel sits beneath the centre console, between the pedals. */
export function fitAureliaNoseBay(
  gear: T.Group,
  paints: Paints,
  shift = 0,
  lift = 0,
) {
  const lining = paints.well.clone();
  lining.side = T.DoubleSide;
  const roofPaint = paints.dark.clone();
  roofPaint.side = T.DoubleSide;
  const profile = [
    [-6.3, 2.04, 0.14],
    [-5.64, 2.04, 0.14],
    [-5.5, 1.84, 0.12],
    [-5.3, 1.69, 0.12],
    [-5, 1.52, 0.12],
    [-4.8, 1.42, 0.12],
    [-4.1, 1.42, 0.12],
  ];
  const rows: T.Vector3[][] = [];
  for (let i = 0; i <= 110; i++) {
    const z = T.MathUtils.lerp(-6.3, -4.1, i / 110);
    let p = 0;
    while (p < profile.length - 2 && z > profile[p + 1][0]) p++;
    const a = profile[p],
      b = profile[p + 1],
      t = (z - a[0]) / (b[0] - a[0]);
    const nominalTop = T.MathUtils.lerp(a[1], b[1], t),
      width = T.MathUtils.lerp(a[2], b[2], t);
    const [rx, ry, cy] = aureliaBodyAt(z - shift);
    const halfHeight = ry * Math.sqrt(Math.max(0, 1 - (width / rx) ** 2));
    // The wheel pocket follows the tapered nose rather than a square roof that
    // would project through the skin after relocation.
    const top = Math.min(
      nominalTop + lift * T.MathUtils.clamp((nominalTop - 1.42) / 0.62, 0, 1),
      cy + halfHeight - 0.008,
    );
    const lower = Math.max(1.41, cy - halfHeight + 0.005);
    const rimX = rx * Math.sin(2.8),
      rimY = cy + ry * Math.cos(2.8) + 0.001;
    rows.push([
      new T.Vector3(-rimX, rimY, z),
      new T.Vector3(-width, lower, z),
      new T.Vector3(-width, top, z),
      new T.Vector3(width, top, z),
      new T.Vector3(width, lower, z),
      new T.Vector3(rimX, rimY, z),
    ]);
  }
  function panel(
    name: string,
    vertices: T.Vector3[],
    indices: number[],
    paint: T.Material,
  ) {
    const geometry = new T.BufferGeometry().setFromPoints(vertices);
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, paint);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    gear.add(mesh);
  }
  for (let band = 0; band < 5; band++) {
    const points: T.Vector3[] = [],
      indices: number[] = [];
    for (let i = 0; i < rows.length; i++) {
      points.push(rows[i][band], rows[i][band + 1]);
      if (i) {
        const a = (i - 1) * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    panel(
      band === 2 ? "Nose_bay_roof" : `Nose_bay_liner_${band}`,
      points,
      indices,
      band === 2 ? roofPaint : lining,
    );
  }
  for (const [label, row] of [
    ["front", rows[0]],
    ["aft", rows.at(-1)!],
  ] as const) {
    const shape = row.map((p) => new T.Vector2(p.x, p.y));
    const faces = T.ShapeUtils.triangulateShape(shape, []);
    panel(
      `Nose_bay_bulkhead_${label}`,
      row,
      faces.flatMap(([a, b, c]) => (label === "aft" ? [a, c, b] : [a, b, c])),
      lining,
    );
  }
}
/** Fitted main wells. The outline contains the folded wheel and the inboard-folding leg. */
export function fitAureliaMainBays(
  root: T.Group,
  gear: T.Group,
  paints: Paints,
) {
  root.updateMatrixWorld(true);
  const skin: T.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.Mesh && /^(Wing_skin|Wing_body_carry)/.test(o.name))
      skin.push(o);
  });
  const samples = new Map<string, { y: number; paint: T.Material }>();
  function underside(x: number, z: number) {
    const key = `${x.toFixed(7)}:${z.toFixed(7)}`;
    const saved = samples.get(key);
    if (saved) return saved;
    const hits = new T.Raycaster(
      new T.Vector3(x, 0.3, z),
      new T.Vector3(0, 1, 0),
      0,
      1.1,
    ).intersectObjects(skin, false);
    if (!hits.length) throw new Error(`Missing gear-bay skin at ${x},${z}`);
    const hit = hits[0],
      result = {
        y: hit.point.y,
        paint: (hit.object as T.Mesh).material as T.Material,
      };
    samples.set(key, result);
    return result;
  }
  function clip(polygon: T.Vector3[], plane: T.Plane, inside = true) {
    const out: T.Vector3[] = [];
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i],
        b = polygon[(i + 1) % polygon.length],
        da = plane.distanceToPoint(a),
        db = plane.distanceToPoint(b);
      const keepA = inside ? da >= 0 : da <= 0,
        keepB = inside ? db >= 0 : db <= 0;
      if (keepA) out.push(a);
      if (keepA !== keepB) out.push(a.clone().lerp(b, da / (da - db)));
    }
    const area = new T.Vector3();
    for (let i = 1; i < out.length - 1; i++)
      area.add(
        out[i]
          .clone()
          .sub(out[0])
          .cross(out[i + 1].clone().sub(out[0])),
      );
    return area.lengthSq() > 1e-16 ? out : [];
  }
  function geometry(points: number[], reverse = false) {
    const g = new T.BufferGeometry();
    g.setAttribute("position", new T.Float32BufferAttribute(points, 3));
    const index = Array.from({ length: points.length / 3 }, (_, i) => i);
    if (reverse)
      for (let i = 0; i < index.length; i += 3)
        [index[i + 1], index[i + 2]] = [index[i + 2], index[i + 1]];
    g.setIndex(index);
    g.computeVertexNormals();
    return g;
  }
  function mesh(
    name: string,
    points: number[],
    material: T.Material,
    parent: T.Object3D,
    reverse = false,
  ) {
    const m = new T.Mesh(geometry(points, reverse), material);
    m.name = name;
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  }
  function fan(points: T.Vector3[], output: number[]) {
    for (let i = 1; i < points.length - 1; i++)
      output.push(
        ...points[0].toArray(),
        ...points[i].toArray(),
        ...points[i + 1].toArray(),
      );
  }
  const lowerFaces: {
    mesh: T.Mesh;
    triangle: T.Vector3[];
    normals: T.Vector3[];
    bounds: T.Box3;
    prism: T.Plane[];
  }[] = [];
  for (const source of skin) {
    const p = source.geometry.getAttribute("position"),
      n = source.geometry.getAttribute("normal"),
      ix = source.geometry.index!;
    for (let i = 0; i < ix.count; i += 3) {
      const triangle = [0, 1, 2].map((j) =>
        new T.Vector3().fromBufferAttribute(p, ix.getX(i + j)),
      );
      const normal = triangle[1]
        .clone()
        .sub(triangle[0])
        .cross(triangle[2].clone().sub(triangle[0]))
        .normalize();
      if (normal.y >= -0.01) continue;
      const bounds = new T.Box3().setFromPoints(triangle);
      if (
        bounds.max.z < 0.46 ||
        bounds.min.z > 1.18 ||
        bounds.min.x > 1.92 ||
        bounds.max.x < -1.92 ||
        bounds.min.y > 1.29
      )
        continue;
      const prism = triangle.map((a, j) => {
        const b = triangle[(j + 1) % 3],
          inward = new T.Vector3(a.z - b.z, 0, b.x - a.x).normalize();
        return new T.Plane(inward, -inward.dot(a));
      });
      const above = new T.Plane().setFromNormalAndCoplanarPoint(
        normal.negate(),
        triangle[0],
      );
      above.constant -= 0.00001;
      prism.push(above);
      lowerFaces.push({
        mesh: source,
        triangle,
        normals: [0, 1, 2].map((j) =>
          new T.Vector3().fromBufferAttribute(n, ix.getX(i + j)),
        ),
        bounds,
        prism,
      });
    }
  }
  const outlines: { planes: T.Plane[]; box: T.Box3 }[] = [];
  for (const side of [-1, 1]) {
    const label = side < 0 ? "Left" : "Right";
    const outline = Array.from({ length: 48 }, (_, i) => {
      const a = (i * Math.PI) / 24,
        quadrant = Math.floor(i / 12),
        mid = ((quadrant + 0.5) * Math.PI) / 2;
      return new T.Vector3(
        side * (1.24 + Math.sign(Math.cos(mid)) * 0.44 + 0.24 * Math.cos(a)),
        0,
        0.82 + Math.sign(Math.sin(mid)) * 0.12 + 0.24 * Math.sin(a),
      );
    });
    if (side < 0) outline.reverse();
    const planes = outline.map((a, i) => {
      const b = outline[(i + 1) % outline.length],
        n = new T.Vector3(a.z - b.z, 0, b.x - a.x).normalize();
      return new T.Plane(n, -n.dot(a));
    });
    outlines.push({
      planes: [
        ...planes,
        new T.Plane(new T.Vector3(0, -1, 0), 1.29),
        new T.Plane(new T.Vector3(0, 1, 0), 1),
      ],
      box: new T.Box3(
        new T.Vector3(side < 0 ? -1.92 : 0.56, -1, 0.46),
        new T.Vector3(side < 0 ? -0.56 : 1.92, 1.29, 1.18),
      ),
    });
    const ceiling: number[] = [],
      walls: number[] = [];
    function grid(extra: T.Plane[], emit: (polygon: T.Vector3[]) => void) {
      for (let i = 0; i < 34; i++)
        for (let j = 0; j < 18; j++) {
          const x0 = side * (0.56 + i * 0.04),
            x1 = side * (0.56 + (i + 1) * 0.04),
            z0 = 0.46 + j * 0.04,
            z1 = z0 + 0.04;
          let cell = [
            new T.Vector3(x0, 0, z0),
            new T.Vector3(x1, 0, z0),
            new T.Vector3(x1, 0, z1),
            new T.Vector3(x0, 0, z1),
          ];
          if (side < 0) cell.reverse();
          for (const p of [...planes, ...extra]) cell = clip(cell, p);
          if (cell.length >= 3) emit(cell);
        }
    }
    grid([], (polygon) =>
      fan(
        polygon.map((p) => new T.Vector3(p.x, 1.29, p.z)),
        ceiling,
      ),
    );
    mesh(`Main_bay_roof_${label}`, ceiling, paints.well, gear);
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i],
        b = outline[(i + 1) % outline.length];
      const a0 = new T.Vector3(a.x, underside(a.x, a.z).y + 0.003, a.z),
        b0 = new T.Vector3(b.x, underside(b.x, b.z).y + 0.003, b.z);
      fan(
        [a0, b0, new T.Vector3(b.x, 1.29, b.z), new T.Vector3(a.x, 1.29, a.z)],
        walls,
      );
    }
    const wall = mesh(`Main_bay_liner_${label}`, walls, paints.well, gear);
    wall.material.side = T.DoubleSide;
    for (const inner of [true, false]) {
      const pivotX = side * (inner ? 0.53 : 1.95),
        pivot = new T.Vector3(pivotX, underside(pivotX, 0.82).y, 0.82);
      const hinge = new T.Group();
      hinge.name = inner
        ? `Main_door_hinge_${label}`
        : `Main_outer_door_hinge_${label}`;
      hinge.position.copy(pivot);
      gear.add(hinge);
      const tag = `${label}_${inner ? "inner" : "outer"}`;
      const pin = new T.Mesh(
        new T.CylinderGeometry(0.014, 0.014, 0.26, 12),
        paints.silver,
      );
      pin.name = `Main_door_pin_${tag}`;
      pin.rotation.x = Math.PI / 2;
      pin.position.copy(pivot);
      gear.add(pin);
      for (const z of [-0.08, 0.08]) {
        const edgeX = side * (inner ? 0.56 : 1.92);
        const end = new T.Vector3(
          edgeX,
          underside(edgeX, 0.82 + z).y + 0.003,
          0.82 + z,
        ).sub(pivot);
        const start = new T.Vector3(0, 0, z);
        const delta = end.clone().sub(start);
        const leaf = new T.Mesh(
          new T.BoxGeometry(delta.length() + 0.016, 0.014, 0.045),
          paints.silver,
        );
        leaf.name = `Main_door_hinge_leaf_${tag}_${z < 0 ? "front" : "aft"}`;
        leaf.position.copy(start.clone().add(end).multiplyScalar(0.5));
        leaf.quaternion.setFromUnitVectors(
          new T.Vector3(1, 0, 0),
          delta.normalize(),
        );
        hinge.add(leaf);
      }
      // Fixed clevises tie the pin to the fitted bay wall. Moving leaves bridge
      // the previous 30 mm gap between each hinge axis and its door skin.
      for (const z of [-0.13, 0.13]) {
        const edgeX = side * (inner ? 0.56 : 1.92);
        const anchor = new T.Vector3(
          edgeX,
          underside(edgeX, 0.82 + z).y + 0.018,
          0.82 + z,
        );
        const centre = pivot.clone().add(new T.Vector3(0, 0, z));
        const delta = anchor.clone().sub(centre);
        const clevis = new T.Mesh(
          new T.BoxGeometry(delta.length() + 0.018, 0.018, 0.025),
          paints.well,
        );
        clevis.name = `Main_door_clevis_${tag}_${z < 0 ? "front" : "aft"}`;
        clevis.position.copy(anchor.add(centre).multiplyScalar(0.5));
        clevis.quaternion.setFromUnitVectors(
          new T.Vector3(1, 0, 0),
          delta.normalize(),
        );
        gear.add(clevis);
      }
      const panel: number[][] = [[], []],
        back: number[] = [];
      const divider = new T.Plane(
        new T.Vector3(side * (inner ? -1 : 1), 0, 0),
        inner ? 1.24 - 0.002 : -1.24 - 0.002,
      );
      const panelNormals: number[][] = [[], []];
      // The outer faces are the actual removed skin triangles, including their
      // original paint and interpolated normals. Closed doors reconstruct that
      // surface exactly instead of approximating it with a floating flat lid.
      for (const face of lowerFaces) {
        if (!face.bounds.intersectsBox(outlines.at(-1)!.box)) continue;
        const paint = face.mesh.material === paints.blue ? 1 : 0;
        let polygon = face.triangle;
        for (const plane of [
          ...planes,
          divider,
          new T.Plane(new T.Vector3(0, -1, 0), 1.29),
        ])
          polygon = clip(polygon, plane);
        let fragments = polygon.length >= 3 ? [polygon] : [];
        // Where fairing and wing overlap, keep only the outer lower surface;
        // hidden internal wing faces are not part of a physical door panel.
        // Compare meshes so changing the fairing paint cannot change the clipping.
        for (const other of lowerFaces) {
          if (!fragments.length) break;
          if (
            other.mesh === face.mesh ||
            other.bounds.max.x < face.bounds.min.x ||
            other.bounds.min.x > face.bounds.max.x ||
            other.bounds.max.z < face.bounds.min.z ||
            other.bounds.min.z > face.bounds.max.z
          )
            continue;
          if (
            face.triangle.every((p) => other.prism[3].distanceToPoint(p) <= 0)
          )
            continue;
          const next: T.Vector3[][] = [];
          for (const fragment of fragments) {
            let remainder = fragment;
            for (const plane of other.prism) {
              const distances = remainder.map((p) => plane.distanceToPoint(p));
              if (distances.every((d) => d >= -1e-9)) continue;
              if (distances.every((d) => d <= 1e-9)) {
                next.push(remainder);
                remainder = [];
                break;
              }
              const outside = clip(remainder, plane, false);
              if (outside.length >= 3) next.push(outside);
              remainder = clip(remainder, plane);
              if (remainder.length < 3) break;
            }
          }
          fragments = next;
        }
        for (const fragment of fragments)
          for (let j = 1; j < fragment.length - 1; j++)
            for (const v of [fragment[0], fragment[j], fragment[j + 1]]) {
              panel[paint].push(...v.clone().sub(pivot).toArray());
              const weights = T.Triangle.getBarycoord(
                v,
                face.triangle[0],
                face.triangle[1],
                face.triangle[2],
                new T.Vector3(),
              );
              const normal = weights
                ? face.normals[0]
                    .clone()
                    .multiplyScalar(weights.x)
                    .addScaledVector(face.normals[1], weights.y)
                    .addScaledVector(face.normals[2], weights.z)
                    .normalize()
                : face.normals[0];
              panelNormals[paint].push(...normal.toArray());
            }
      }
      grid([divider], (polygon) =>
        fan(
          polygon.map((p) =>
            new T.Vector3(p.x, underside(p.x, p.z).y + 0.008, p.z).sub(pivot),
          ),
          back,
        ),
      );
      if (panel[0].length + panel[1].length > 100000)
        throw new Error("Gear door polygon budget exceeded");
      const prefix = inner
        ? `Main_bay_door_${label}`
        : `Main_outer_bay_door_${label}`;
      for (const paint of [0, 1])
        if (panel[paint].length) {
          const name = prefix + (paint && panel[0].length ? "_paint" : "");
          const outside = mesh(
            name,
            panel[paint],
            paint ? paints.blue : paints.white,
            hinge,
          );
          outside.geometry.setAttribute(
            "normal",
            new T.Float32BufferAttribute(panelNormals[paint], 3),
          );
        }
      mesh(`${prefix}_inner`, back, paints.well, hinge, true);
      const lip = clip(outline, divider),
        rim: number[] = [];
      for (let i = 0; i < lip.length; i++) {
        const a = lip[i],
          b = lip[(i + 1) % lip.length],
          a0 = new T.Vector3(a.x, underside(a.x, a.z).y, a.z).sub(pivot),
          b0 = new T.Vector3(b.x, underside(b.x, b.z).y, b.z).sub(pivot);
        fan(
          [
            a0,
            b0,
            b0.clone().add(new T.Vector3(0, 0.008, 0)),
            a0.clone().add(new T.Vector3(0, 0.008, 0)),
          ],
          rim,
        );
      }
      mesh(`${prefix}_edge`, rim, paints.well, hinge);
    }
  }
  // Remove only the fitted lower aperture, keeping the existing skin and normals outside it.
  for (const target of skin) {
    const p = target.geometry.getAttribute("position"),
      n = target.geometry.getAttribute("normal"),
      index = target.geometry.index!;
    const points: number[] = [],
      normals: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      const source = [0, 1, 2].map((j) =>
          new T.Vector3().fromBufferAttribute(p, index.getX(i + j)),
        ),
        sourceNormals = [0, 1, 2].map((j) =>
          new T.Vector3().fromBufferAttribute(n, index.getX(i + j)),
        );
      let fragments = [source];
      for (const { planes, box } of outlines) {
        const next: T.Vector3[][] = [];
        for (const polygon of fragments) {
          if (!new T.Box3().setFromPoints(polygon).intersectsBox(box)) {
            next.push(polygon);
            continue;
          }
          let remainder = polygon;
          for (const plane of planes) {
            const outside = clip(remainder, plane, false);
            if (outside.length >= 3) next.push(outside);
            remainder = clip(remainder, plane);
            if (remainder.length < 3) break;
          }
        }
        fragments = next;
      }
      for (const polygon of fragments)
        for (let j = 1; j < polygon.length - 1; j++)
          for (const v of [polygon[0], polygon[j], polygon[j + 1]]) {
            const weights = T.Triangle.getBarycoord(
              v,
              source[0],
              source[1],
              source[2],
              new T.Vector3(),
            );
            const normal = weights
              ? sourceNormals[0]
                  .clone()
                  .multiplyScalar(weights.x)
                  .addScaledVector(sourceNormals[1], weights.y)
                  .addScaledVector(sourceNormals[2], weights.z)
                  .normalize()
              : sourceNormals[0];
            points.push(...v.toArray());
            normals.push(...normal.toArray());
          }
    }
    const g = geometry(points);
    g.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
    target.geometry.dispose();
    target.geometry = g;
  }
}
