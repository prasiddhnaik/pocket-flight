import * as T from "three";
import {
  aureliaInteriorLayout as layout,
  aureliaFloorHalfWidth,
  aureliaBodyAt as bodyAt,
} from "./exterior-reference";
import { type ExteriorKit, material } from "./exterior-kit";

export function buildForwardLining(
  kit: ExteriorKit,
  fuselage: T.Group,
  entryLiningGeometry: T.BufferGeometry | undefined,
) {
  const { root, surface, rod, supported } = kit;
  // Reuse the actual shell apertures for the cockpit/entry lining. Reversing
  // the fitted inner surface closes the view through back-facing outer paint
  // while preserving the real windshield and entry openings.
  const lining = material("Forward cabin lining", "#dbd7ca", 0.88);
  const outer: { name: string; geometry: T.BufferGeometry }[] = [];
  root.traverse((o) => {
    if (
      o instanceof T.Mesh &&
      /^(Pressure_shell|Windshield.*surround)/.test(o.name)
    )
      outer.push(o);
  });
  if (entryLiningGeometry)
    outer.push({
      name: "Passenger_entry_surround",
      geometry: entryLiningGeometry,
    });
  const limits = [
    new T.Plane(new T.Vector3(0, 0, 1), 6.3),
    new T.Plane(new T.Vector3(0, 0, -1), -3.35),
    new T.Plane(new T.Vector3(0, 1, 0), -layout.floorY + 0.005),
  ];
  for (const source of outer) {
    const p = source.geometry.getAttribute("position"),
      index = source.geometry.index!;
    const vertices: T.Vector3[] = [],
      faces: number[] = [];
    for (let i = 0; i < index.count; i += 3) {
      let polygon = [0, 1, 2].map((j) => {
        const v = new T.Vector3().fromBufferAttribute(p, index.getX(i + j));
        const [rx, ry, cy] = bodyAt(v.z);
        return new T.Vector3(
          (v.x * (rx - 0.016)) / rx,
          cy + ((v.y - cy) * (ry - 0.016)) / ry,
          v.z,
        );
      });
      for (const plane of limits) {
        const clipped: T.Vector3[] = [];
        for (let j = 0; j < polygon.length; j++) {
          const a = polygon[j],
            b = polygon[(j + 1) % polygon.length];
          const da = plane.distanceToPoint(a),
            db = plane.distanceToPoint(b);
          if (da >= 0) clipped.push(a);
          if (da >= 0 !== db >= 0)
            clipped.push(a.clone().lerp(b, da / (da - db)));
        }
        polygon = clipped;
      }
      for (const v of polygon)
        if (v.y < layout.floorY - 0.004)
          v.x = Math.sign(v.x) * aureliaFloorHalfWidth(v.z);
      for (let j = 1; j < polygon.length - 1; j++) {
        if (
          new T.Triangle(polygon[0], polygon[j], polygon[j + 1]).getArea() <
          1e-10
        )
          continue;
        const first = vertices.length;
        vertices.push(polygon[0], polygon[j], polygon[j + 1]);
        faces.push(first, first + 2, first + 1);
      }
    }
    if (vertices.length)
      surface(
        `Forward_liner_${source.name}`,
        vertices,
        faces,
        lining,
        fuselage,
      );
  }
  // Small frame clips support the inset forward lining independently of the
  // removable furniture and the decorative exterior paint strips.
  for (const side of [-1, 1]) {
    const outerFrame = root.getObjectByName(
      `Windshield_${side}_surround`,
    ) as T.Mesh;
    const innerFrame = root.getObjectByName(
      `Forward_liner_Windshield_${side}_surround`,
    ) as T.Mesh;
    const positions = innerFrame.geometry.getAttribute("position");
    const start = new T.Vector3().fromBufferAttribute(positions, 0);
    const p = outerFrame.geometry.getAttribute("position"),
      ix = outerFrame.geometry.index!;
    let closest = new T.Vector3(),
      distance = Infinity;
    for (let i = 0; i < ix.count; i += 3) {
      const [a, b, c] = [0, 1, 2].map((j) =>
        new T.Vector3().fromBufferAttribute(p, ix.getX(i + j)),
      );
      const hit = new T.Triangle(a, b, c).closestPointToPoint(
        start,
        new T.Vector3(),
      );
      if (hit.distanceToSquared(start) < distance) {
        distance = hit.distanceToSquared(start);
        closest = hit;
      }
    }
    supported(
      rod(
        `Forward_liner_frame_clip_${side}`,
        start.toArray(),
        closest.toArray(),
        0.006,
        lining,
        fuselage,
      ),
      "forward lining frame clip",
      [innerFrame.name, outerFrame.name],
    );
  }
  entryLiningGeometry?.dispose();
}
