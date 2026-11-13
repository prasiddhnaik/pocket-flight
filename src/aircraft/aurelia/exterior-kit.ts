import * as T from "three";
import { aureliaBodyAt as bodyAt } from "./exterior-reference";

export type Point = readonly [number, number, number];
export const tau = Math.PI * 2;
export const material = (
  name: string,
  color: string,
  roughness = 0.35,
  metalness = 0.05,
) => {
  const m = new T.MeshStandardMaterial({ color, roughness, metalness });
  m.name = name;
  return m;
};


/** Shared materials and mesh helpers for the Aurelia exterior; every part is parented under `root`. */
export function makeExteriorKit(root: T.Group) {
  const white = material("Porcelain aircraft paint", "#e8e9e5", 0.25);
  const blue = material("Aurelia deep Atlantic paint", "#173447", 0.28, 0.16);
  const silver = material("Polished aluminium", "#a5b0b5", 0.22, 0.82);
  const dark = material("Engine duct and seals", "#15212a", 0.68);
  const glass = material("Smoked cockpit glazing", "#1c3543", 0.12, 0.3);
  glass.transparent = true;
  glass.opacity = 0.38;
  glass.side = T.DoubleSide;
  glass.depthWrite = false;
  const rubber = material("Tire rubber", "#20252a", 0.9);
  const well = material("Gear bay interior", "#9caaa4", 0.7);
  const palettes = { white, blue, silver, dark, glass, rubber, well };

  function group(
    name: string,
    parent: T.Object3D = root,
    position: Point = [0, 0, 0],
  ) {
    const g = new T.Group();
    g.name = name;
    g.position.fromArray(position);
    parent.add(g);
    return g;
  }
  function mesh(
    name: string,
    geometry: T.BufferGeometry,
    m: T.Material,
    parent: T.Object3D = root,
  ) {
    const o = new T.Mesh(geometry, m);
    o.name = name;
    o.castShadow = o.receiveShadow = true;
    parent.add(o);
    return o;
  }
  function surface(
    name: string,
    points: T.Vector3[],
    faces: number[],
    m: T.Material,
    parent: T.Object3D = root,
  ) {
    const g = new T.BufferGeometry();
    g.setFromPoints(points);
    g.setIndex(faces);
    g.computeVertexNormals();
    return mesh(name, g, m, parent);
  }
  function tube(
    name: string,
    points: T.Vector3[],
    radius: number,
    m: T.Material,
    parent: T.Object3D = root,
    closed = false,
  ) {
    return mesh(
      name,
      new T.TubeGeometry(
        new T.CatmullRomCurve3(points, closed),
        Math.max(8, points.length * 2),
        radius,
        6,
        closed,
      ),
      m,
      parent,
    );
  }
  function rod(
    name: string,
    a: Point,
    b: Point,
    radius: number,
    m: T.Material,
    parent: T.Object3D,
    contactNormal?: T.Vector3,
  ) {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b),
      d = end.clone().sub(start);
    const o = mesh(
      name,
      new T.CylinderGeometry(radius, radius, d.length(), 16),
      m,
      parent,
    );
    o.position.copy(start.add(end).multiplyScalar(0.5));
    o.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    if (contactNormal) {
      // Put a polygon vertex on the tangency normal. The two convex cylinders
      // then share a support plane instead of crossing or leaving a facet gap.
      const local = contactNormal
        .clone()
        .applyQuaternion(o.quaternion.clone().invert());
      o.geometry.rotateY(Math.atan2(local.x, local.z));
    }
    return o;
  }
  function supported<TObject extends T.Object3D>(
    object: TObject,
    kind: string,
    contacts: string[],
  ): TObject {
    object.userData.attachment = { kind, intentionalContacts: contacts };
    return object;
  }
  function bearing(
    name: string,
    at: T.Vector3,
    axis: T.Vector3,
    radius: number,
    parent: T.Object3D,
    contacts: string[],
    tubeRadius = 0.006,
  ) {
    const ring = mesh(
      name,
      new T.TorusGeometry(radius, tubeRadius, 10, 24),
      silver,
      parent,
    );
    ring.position.copy(at);
    ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), axis);
    return supported(ring, "rotary bearing", contacts);
  }
  function controlHinges(
    name: string,
    moving: T.Object3D,
    parent: T.Object3D,
    anchors: T.Vector3[],
    fixedSkin: string,
    movingSkin: string,
  ) {
    const axis = new T.Vector3()
      .fromArray(moving.userData.hingeAxis as number[])
      .normalize();
    for (const [i, anchor] of anchors.entries()) {
      const compactTip =
        name.startsWith("Elevator_hinge") && i === anchors.length - 1;
      const point = moving.position
        .clone()
        .addScaledVector(axis, anchor.clone().sub(moving.position).dot(axis));
      const pinName = `${name}_pin_${i}`;
      supported(
        rod(
          pinName,
          point.clone().addScaledVector(axis, -0.04).toArray(),
          point.clone().addScaledVector(axis, 0.04).toArray(),
          compactTip ? 0.003 : 0.012,
          silver,
          parent,
          compactTip
            ? new T.Vector3(1, 0, 0).applyQuaternion(
                new T.Quaternion().setFromUnitVectors(
                  new T.Vector3(0, 0, 1),
                  axis,
                ),
              )
            : undefined,
        ),
        "fixed hinge pin",
        [`${name}_knuckle_${i}`, movingSkin],
      );
      supported(
        rod(
          `${name}_bracket_${i}`,
          anchor.toArray(),
          point.toArray(),
          compactTip ? 0.006 : 0.014,
          silver,
          parent,
        ),
        "hinge bracket",
        [fixedSkin, pinName],
      );
      bearing(
        `${name}_knuckle_${i}`,
        point.clone().sub(moving.position),
        axis,
        compactTip ? 0.006 : 0.016,
        moving,
        [pinName, movingSkin],
        compactTip ? 0.003 : 0.006,
      );
    }
  }
  function box(
    name: string,
    dimensions: Point,
    position: Point,
    m: T.Material,
    parent: T.Object3D,
  ) {
    const o = mesh(name, new T.BoxGeometry(...dimensions), m, parent);
    o.position.fromArray(position);
    return o;
  }
  function skin(z: number, angle: number, offset = 0) {
    const [rx, ry, center] = bodyAt(z);
    return new T.Vector3(
      (rx + offset) * Math.sin(angle),
      center + (ry + offset) * Math.cos(angle),
      z,
    );
  }
  function skinNormals(o: T.Mesh) {
    const p = o.geometry.getAttribute("position"),
      normals: number[] = [];
    for (let i = 0; i < p.count; i++) {
      const z = p.getZ(i),
        [rx, ry, center] = bodyAt(z),
        angle = Math.atan2(p.getX(i) / rx, (p.getY(i) - center) / ry);
      const z0 = Math.max(-7.955, z - 0.001),
        z1 = Math.min(7.955, z + 0.001);
      const along = skin(z1, angle)
        .sub(skin(z0, angle))
        .divideScalar(z1 - z0);
      const around = new T.Vector3(
        rx * Math.cos(angle),
        -ry * Math.sin(angle),
        0,
      );
      normals.push(...along.cross(around).normalize().toArray());
    }
    o.geometry.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  }
  function foil(
    name: string,
    sections: readonly (readonly [number, number, number, number])[],
    thickness: number,
    m: T.Material,
    parent: T.Object3D,
    lo = 0,
    hi = 1,
    pivot = new T.Vector3(),
  ) {
    const points: T.Vector3[] = [],
      ix: number[] = [],
      steps = 28;
    for (const [x, y, leading, chord] of sections)
      for (const face of [1, -1])
        for (let j = 0; j <= steps; j++) {
          const u = T.MathUtils.lerp(
            lo,
            hi,
            (1 - Math.cos((j * Math.PI) / steps)) / 2,
          );
          const t =
            5 *
            thickness *
            (0.2969 * Math.sqrt(u) -
              0.126 * u -
              0.3516 * u ** 2 +
              0.2843 * u ** 3 -
              0.1036 * u ** 4);
          const camber =
            /Vertical_stabilizer|Rudder_skin|Tailplane_skin|Elevator_skin/.test(
              name,
            )
              ? 0
              : 0.018;
          points.push(
            new T.Vector3(
              x,
              y + chord * (camber * Math.sin(Math.PI * u) + face * t),
              leading + chord * u,
            ).sub(pivot),
          );
        }
    const stride = (steps + 1) * 2;
    for (let s = 0; s < sections.length - 1; s++)
      for (let f = 0; f < 2; f++)
        for (let j = 0; j < steps; j++) {
          const a = s * stride + f * (steps + 1) + j,
            b = a + stride;
          ix.push(
            ...(f
              ? [a, b, a + 1, a + 1, b, b + 1]
              : [a, a + 1, b, a + 1, b + 1, b]),
          );
        }
    // Separate cap vertices preserve hard edge normals instead of smoothing through the cuts.
    function cap(a: number, b: number, c: number, d: number) {
      const first = points.length;
      points.push(...[a, b, c, d].map((i) => points[i].clone()));
      ix.push(first, first + 1, first + 2, first + 2, first + 1, first + 3);
    }
    for (const s of [0, sections.length - 1])
      for (let j = 0; j < steps; j++) {
        const a = s * stride + j,
          b = a + steps + 1;
        if (s === 0) cap(a, b, a + 1, b + 1);
        else cap(a, a + 1, b, b + 1);
      }
    // Close both chordwise cut faces so deflected flaps expose solid edges.
    for (let s = 0; s < sections.length - 1; s++)
      for (const j of [0, steps]) {
        const a = s * stride + j,
          b = a + steps + 1;
        if (j === 0) cap(a, a + stride, b, b + stride);
        else cap(a, b, a + stride, b + stride);
      }
    const o = surface(name, points, ix, m, parent);
    // Section order is mirrored on the port wing; normals must remain outward.
    if (sections[1][0] < sections[0][0]) {
      const index = o.geometry.index!;
      for (let j = 0; j < index.count; j += 3) {
        const b = index.getX(j + 1);
        index.setX(j + 1, index.getX(j + 2));
        index.setX(j + 2, b);
      }
      o.geometry.computeVertexNormals();
    }
    return o;
  }
  return {
    root,
    white,
    blue,
    silver,
    dark,
    glass,
    rubber,
    well,
    palettes,
    group,
    mesh,
    surface,
    tube,
    rod,
    supported,
    bearing,
    controlHinges,
    box,
    skin,
    skinNormals,
    foil,
  };
}

export type ExteriorKit = ReturnType<typeof makeExteriorKit>;
