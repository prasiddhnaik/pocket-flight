import * as T from "three";
import { aureliaCockpitLayout, aureliaCockpitWindows } from "./cockpit-layout";
import { fitAureliaMainBays, fitAureliaNoseBay } from "./gear-bays";
import {
  aureliaExteriorReference as reference,
  exteriorGear,
  aureliaInteriorLayout as layout,
  aureliaFloorHalfWidth,
  aureliaBodyAt as bodyAt,
  aureliaHullStations as stations,
} from "./exterior-reference";

type Point = readonly [number, number, number];
type Aperture = {
  name: string;
  z: number;
  angle: number;
  halfZ: number;
  halfAngle: number;
  entry?: boolean;
};
const tau = Math.PI * 2;
const material = (
  name: string,
  color: string,
  roughness = 0.35,
  metalness = 0.05,
) => {
  const m = new T.MeshStandardMaterial({ color, roughness, metalness });
  m.name = name;
  return m;
};

/** SI metres, +Y up, -Z forward. Surface stations are documented visual estimates. */
export function makeAureliaExterior(airframeScale = 1) {
  const { noseShift, noseLift } = aureliaCockpitLayout(airframeScale);
  const cockpitWindows = aureliaCockpitWindows(airframeScale);
  const root = new T.Group();
  root.name = "Aurelia_Phenom300E";
  root.userData = {
    reference,
    units: "metres",
    forward: "-Z",
    revision: reference.revision,
  };
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
  const fuselage = group("Fuselage"),
    cockpit = group("Cockpit");
  const openings: Aperture[] = [];
  for (const side of [-1, 1]) {
    for (let i = 0; i < reference.cabinWindowsPerSide; i++)
      openings.push({
        name: `Cabin_window_${side < 0 ? "Left" : "Right"}_${i + 1}`,
        z: -2.9 + i * 1.04,
        angle: side * 1.23,
        halfZ: 0.225,
        halfAngle: 0.235,
      });
    openings.push({
      name: `Windshield_${side}`,
      ...cockpitWindows.windshield,
      angle: side * cockpitWindows.windshield.angle,
    });
    openings.push({
      name: `Cockpit_side_window_${side}`,
      ...cockpitWindows.sideWindow,
      angle: side * cockpitWindows.sideWindow.angle,
    });
  }
  openings.push({
    name: "Passenger_entry",
    z: -3.82,
    angle: -1.6,
    halfZ: 0.32,
    halfAngle: 0.85,
    entry: true,
  });
  const zCuts = [
    ...new Set([
      -7.955,
      7.955,
      -6.3 - noseShift,
      -4.1 - noseShift,
      ...stations.map((s) => s[0]),
      ...openings.flatMap((w) => [
        w.z - w.halfZ - 0.055,
        w.z + w.halfZ + 0.055,
      ]),
    ]),
  ].sort((a, b) => a - b);
  const angleCuts = [
    ...new Set([
      -Math.PI,
      0,
      Math.PI,
      -2.8,
      2.8,
      -2.02,
      2.02,
      ...openings.flatMap((w) => [
        w.angle - w.halfAngle - 0.05,
        w.angle + w.halfAngle + 0.05,
      ]),
    ]),
  ].sort((a, b) => a - b);
  // Triangulated parameter-space panels make real glazing apertures, rather than decals over an opaque shell.
  const bodyPoints: T.Vector3[][] = [[], []],
    bodyIndices: number[][] = [[], []];
  for (let zi = 0; zi < zCuts.length - 1; zi++)
    for (let ai = 0; ai < angleCuts.length - 1; ai++) {
      const z0 = zCuts[zi],
        z1 = zCuts[zi + 1],
        a0 = angleCuts[ai],
        a1 = angleCuts[ai + 1];
      if (
        z0 >= -6.3 - noseShift &&
        z1 <= -4.1 - noseShift &&
        Math.abs((a0 + a1) / 2) > 2.8
      )
        continue;
      const opening = openings.find(
        (w) => w.z > z0 && w.z < z1 && w.angle > a0 && w.angle < a1,
      );
      // Aperture bounds may cross neighbouring parameter panels. Exclude only the interior; add their exact surrounds below.
      const inside = openings.some(
        (w) =>
          Math.abs((z0 + z1) / 2 - w.z) < w.halfZ + 0.055 &&
          Math.abs((a0 + a1) / 2 - w.angle) < w.halfAngle + 0.05,
      );
      if (inside && !opening) continue;
      if (opening) continue;
      const nz = Math.max(1, Math.ceil((z1 - z0) / 0.12)),
        na = Math.max(1, Math.ceil((a1 - a0) / 0.07));
      const positions: T.Vector3[] = [],
        indices: number[] = [];
      for (let u = 0; u <= nz; u++)
        for (let v = 0; v <= na; v++)
          positions.push(
            skin(
              T.MathUtils.lerp(z0, z1, u / nz),
              T.MathUtils.lerp(a0, a1, v / na),
            ),
          );
      for (let u = 0; u < nz; u++)
        for (let v = 0; v < na; v++) {
          const a = u * (na + 1) + v,
            b = a + na + 1;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      const paint = Math.abs((a0 + a1) / 2) > 2.02 ? 1 : 0,
        offset = bodyPoints[paint].length;
      bodyPoints[paint].push(...positions);
      bodyIndices[paint].push(...indices.map((i) => i + offset));
    }
  skinNormals(
    surface(
      "Pressure_shell_upper",
      bodyPoints[0],
      bodyIndices[0],
      white,
      fuselage,
    ),
  );
  skinNormals(
    surface(
      "Pressure_shell_lower",
      bodyPoints[1],
      bodyIndices[1],
      blue,
      fuselage,
    ),
  );
  function entrySkin(
    name: string,
    parameters: T.Vector2[],
    indices: number[],
    parent: T.Object3D,
    pivot = new T.Vector3(),
    offset = 0,
  ) {
    const positions: T.Vector3[][] = [[], []],
      faces: number[][] = [[], []];
    function split(polygon: T.Vector2[], lower: boolean) {
      const out: T.Vector2[] = [];
      for (let i = 0; i < polygon.length; i++) {
        const a = polygon[i],
          b = polygon[(i + 1) % polygon.length],
          da = a.y + 2.02,
          db = b.y + 2.02;
        const keepA = lower ? da <= 0 : da >= 0,
          keepB = lower ? db <= 0 : db >= 0;
        if (keepA) out.push(a);
        if (keepA !== keepB) out.push(a.clone().lerp(b, da / (da - db)));
      }
      return out;
    }
    for (let i = 0; i < indices.length; i += 3)
      for (const paint of [0, 1]) {
        const polygon = split(
          indices.slice(i, i + 3).map((j) => parameters[j]),
          paint === 1,
        );
        for (let j = 1; j < polygon.length - 1; j++) {
          const u = polygon[j].clone().sub(polygon[0]),
            v = polygon[j + 1].clone().sub(polygon[0]);
          if (Math.abs(u.cross(v)) < 1e-12) continue;
          const first = positions[paint].length;
          positions[paint].push(
            ...[polygon[0], polygon[j], polygon[j + 1]].map((p) =>
              skin(p.x, p.y, offset),
            ),
          );
          faces[paint].push(first, first + 1, first + 2);
        }
      }
    for (const paint of [0, 1]) {
      const panel = surface(
        name + (paint ? "_livery" : ""),
        positions[paint],
        faces[paint],
        paint ? blue : white,
        parent,
      );
      skinNormals(panel);
      panel.geometry.translate(-pivot.x, -pivot.y, -pivot.z);
    }
  }
  let entryLiningGeometry: T.BufferGeometry | undefined;
  for (const w of openings) {
    const boundary: T.Vector2[] = [],
      outer: T.Vector2[] = [],
      // A small fitted overlap bridges the different triangle spacing of the
      // shell and cockpit jamb, preventing a hairline gap at their shared edge.
      rz =
        w.halfZ + 0.055 + (w.name.startsWith("Cabin") || w.entry ? 0 : 0.002),
      ra =
        w.halfAngle +
        0.05 +
        (w.name.startsWith("Cabin") || w.entry ? 0 : 0.003);
    const corners = [
      [-rz, -ra],
      [rz, -ra],
      [rz, ra],
      [-rz, ra],
    ];
    for (let edge = 0; edge < 4; edge++)
      for (let j = 0; j < 24; j++) {
        const a = corners[edge],
          b = corners[(edge + 1) % 4];
        const u = T.MathUtils.lerp(a[0], b[0], j / 24),
          v = T.MathUtils.lerp(a[1], b[1], j / 24);
        const scale =
          (Math.abs(u / w.halfZ) ** (2 / 0.56) +
            Math.abs(v / w.halfAngle) ** (2 / 0.56)) **
          (-0.56 / 2);
        outer.push(new T.Vector2(w.z + u, w.angle + v));
        boundary.push(new T.Vector2(w.z + u * scale, w.angle + v * scale));
      }
    if (w.entry) {
      // Keep the exact rectangular outer edge shared with the shell. Intersect
      // each radial ray with a rounded rectangle to form the inner door edge.
      for (let i = 0; i < outer.length; i++) {
        const u = outer[i].x - w.z,
          v = outer[i].y - w.angle;
        let low = 0,
          high = 1;
        for (let j = 0; j < 36; j++) {
          const scale = (low + high) / 2;
          const x = Math.max(0, Math.abs(u * scale) - (w.halfZ - 0.07)) / 0.07;
          const y =
            Math.max(0, Math.abs(v * scale) - (w.halfAngle - 0.085)) / 0.085;
          if (x * x + y * y <= 1) low = scale;
          else high = scale;
        }
        boundary[i].set(w.z + u * low, w.angle + v * low);
      }
    }
    const count = boundary.length;
    const points = [...outer, ...boundary].map((p) => skin(p.x, p.y));
    const ix: number[] = [];
    for (let j = 0; j < count; j++) {
      const k = (j + 1) % count;
      ix.push(j, k, j + count, k, k + count, j + count);
    }
    if (w.entry) {
      entrySkin(`${w.name}_surround`, [...outer, ...boundary], ix, fuselage);
      // The inner header opens out toward the shell: a bevel gives the folded
      // stairs room to sweep through the doorway without cutting the paint.
      entryLiningGeometry = new T.BufferGeometry().setFromPoints(
        [
          ...outer,
          ...boundary.map((p, i) =>
            p
              .clone()
              .lerp(
                outer[i],
                0.7 * T.MathUtils.clamp((p.y - w.angle) / 0.4, 0, 1),
              ),
          ),
        ].map((p) => skin(p.x, p.y)),
      );
      entryLiningGeometry.setIndex(ix);
    } else
      skinNormals(
        surface(
          `${w.name}_surround`,
          points,
          ix,
          white,
          w.name.startsWith("Cabin") ? fuselage : cockpit,
        ),
      );
    const pane = [
      skin(w.z, w.angle, -0.004),
      ...boundary.map((p) => skin(p.x, p.y, -0.002)),
    ];
    if (w.entry) {
      const pivot = skin(w.z, w.angle - w.halfAngle, -0.004),
        door = group("Passenger_entry_hinge", fuselage, pivot.toArray());
      // Small parameter-space cells follow the hull between vertices, so the stairs cannot protrude through a flattened panel.
      const parameters: T.Vector2[] = [],
        triangles: number[] = [];
      for (let zi = 0; zi < 20; zi++)
        for (let ai = 0; ai < 48; ai++) {
          let polygon = [
            new T.Vector2(
              w.z - w.halfZ + (zi * w.halfZ) / 10,
              w.angle - w.halfAngle + (ai * w.halfAngle) / 24,
            ),
            new T.Vector2(
              w.z - w.halfZ + ((zi + 1) * w.halfZ) / 10,
              w.angle - w.halfAngle + (ai * w.halfAngle) / 24,
            ),
            new T.Vector2(
              w.z - w.halfZ + ((zi + 1) * w.halfZ) / 10,
              w.angle - w.halfAngle + ((ai + 1) * w.halfAngle) / 24,
            ),
            new T.Vector2(
              w.z - w.halfZ + (zi * w.halfZ) / 10,
              w.angle - w.halfAngle + ((ai + 1) * w.halfAngle) / 24,
            ),
          ];
          for (let edge = 0; edge < count; edge++) {
            const a = boundary[edge],
              b = boundary[(edge + 1) % count],
              out: T.Vector2[] = [];
            const distance = (p: T.Vector2) =>
              (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
            for (let j = 0; j < polygon.length; j++) {
              const p = polygon[j],
                q = polygon[(j + 1) % polygon.length],
                dp = distance(p),
                dq = distance(q);
              if (dp >= 0) out.push(p);
              if (dp >= 0 !== dq >= 0)
                out.push(p.clone().lerp(q, dp / (dp - dq)));
            }
            polygon = out;
            if (polygon.length < 3) break;
          }
          for (let j = 1; j < polygon.length - 1; j++) {
            const first = parameters.length;
            parameters.push(polygon[0], polygon[j], polygon[j + 1]);
            triangles.push(first, first + 1, first + 2);
          }
        }
      entrySkin(
        "Passenger_entry_door",
        parameters,
        triangles,
        door,
        pivot,
        -0.001,
      );
      const innerFaces = [...triangles];
      for (let i = 0; i < innerFaces.length; i += 3)
        [innerFaces[i + 1], innerFaces[i + 2]] = [
          innerFaces[i + 2],
          innerFaces[i + 1],
        ];
      const lining = material("Entry door interior lining", "#d4d0c5", 0.65);
      surface(
        "Passenger_entry_door_inner",
        parameters.map((p) => skin(p.x, p.y, -0.014).sub(pivot)),
        innerFaces,
        lining,
        door,
      );
      const edgePoints: T.Vector3[] = [],
        edgeFaces: number[] = [];
      for (let i = 0; i < count; i++) {
        const a = boundary[i],
          b = boundary[(i + 1) % count],
          first = edgePoints.length;
        edgePoints.push(
          skin(a.x, a.y, -0.001).sub(pivot),
          skin(b.x, b.y, -0.001).sub(pivot),
          skin(a.x, a.y, -0.014).sub(pivot),
          skin(b.x, b.y, -0.014).sub(pivot),
        );
        edgeFaces.push(
          first,
          first + 1,
          first + 2,
          first + 2,
          first + 1,
          first + 3,
        );
      }
      surface("Passenger_entry_door_edge", edgePoints, edgeFaces, lining, door);
      for (let step = 0; step < layout.stairCount; step++) {
        // Keep the rigid tread clear of both the curved panel and the upper jamb.
        const open = new T.Vector3(
          pivot.x - 0.205 - step * layout.stairRun,
          layout.floorY -
            ((step + 1) * layout.floorY) / (layout.stairCount + 1) -
            0.0175,
          w.z,
        );
        const p = open
          .sub(pivot)
          .applyAxisAngle(new T.Vector3(0, 0, 1), -layout.entryAngle);
        const stair = box(
          `Airstair_tread_${step + 1}`,
          [0.18, 0.035, 0.5],
          p.toArray(),
          dark,
          door,
        );
        stair.rotation.z = -layout.entryAngle;
      }
      // A rigid side frame carries every tread. Short triangulated standoffs
      // seat into the actual curved inner panel; all parts fold with the door.
      for (const side of [-1, 1]) {
        const railPoints = Array.from(
          { length: layout.stairCount },
          (_, step) => {
            const tread = door.getObjectByName(`Airstair_tread_${step + 1}`)!;
            return tread.position
              .clone()
              .add(
                new T.Vector3(0, -0.012, side * 0.225).applyAxisAngle(
                  new T.Vector3(0, 0, 1),
                  -layout.entryAngle,
                ),
              );
          },
        );
        const railName = `Airstair_stringer_${side}`;
        for (let i = 0; i < railPoints.length - 1; i++)
          supported(
            rod(
              `${railName}_${i}`,
              railPoints[i].toArray(),
              railPoints[i + 1].toArray(),
              0.012,
              silver,
              door,
            ),
            "stair side stringer",
            [`Airstair_tread_${i + 1}`, `Airstair_tread_${i + 2}`],
          );
        for (const [i, point] of railPoints.entries()) {
          const world = point.clone().add(pivot),
            [rx, ry, cy] = bodyAt(world.z);
          const angle = T.MathUtils.clamp(
            Math.atan2(world.x / rx, (world.y - cy) / ry),
            w.angle - w.halfAngle + 0.045,
            w.angle + w.halfAngle - 0.045,
          );
          const seat = skin(world.z, angle, -0.014).sub(pivot);
          supported(
            rod(
              `Airstair_frame_brace_${side}_${i}`,
              point.toArray(),
              seat.toArray(),
              0.01,
              silver,
              door,
            ),
            "stair panel standoff",
            [railName, "Passenger_entry_door_inner"],
          );
        }
      }
      // Two supported barrels on the existing Z hinge. Decorative paint is
      // deliberately excluded from the door's physical load path.
      const fixedShell = fuselage.getObjectByName(
        "Pressure_shell_lower",
      ) as T.Mesh;
      const shellPositions = fixedShell.geometry.getAttribute("position");
      const shellIndex = fixedShell.geometry.index!;
      for (const [i, z] of [-0.22, 0.22].entries()) {
        const centre = pivot.clone().add(new T.Vector3(0, 0, z));
        // The aft fixed leaf sits beyond the door's rounded jamb. Running it
        // radially through the door at the moving barrel would block rotation.
        const leafZ = i === 1 ? w.halfZ + 0.03 : z;
        const bracketCentre = pivot.clone().add(new T.Vector3(0, 0, leafZ));
        const nominalSeat = skin(w.z + leafZ, w.angle - w.halfAngle - 0.035);
        const shellSeat = new T.Vector3();
        let nearestShellDistance = Infinity;
        // Fit the bracket to the trimmed, faceted shell that is actually
        // exported. Its analytic hull point alone can land inside the seal.
        for (let j = 0; j < shellIndex.count; j += 3) {
          const vertices = [0, 1, 2].map((k) =>
            new T.Vector3().fromBufferAttribute(
              shellPositions,
              shellIndex.getX(j + k),
            ),
          );
          const candidate = new T.Triangle(
            ...(vertices as [T.Vector3, T.Vector3, T.Vector3]),
          ).closestPointToPoint(nominalSeat, new T.Vector3());
          const separation = candidate.distanceToSquared(nominalSeat);
          if (separation < nearestShellDistance) {
            nearestShellDistance = separation;
            shellSeat.copy(candidate);
          }
        }
        if (!Number.isFinite(nearestShellDistance))
          throw new Error("Missing entry hinge seat");
        shellSeat.addScaledVector(
          shellSeat.clone().sub(bracketCentre).normalize(),
          0.002,
        );
        const pinName = `Entry_hinge_pin_${i}`;
        supported(
          rod(
            pinName,
            centre
              .clone()
              .add(new T.Vector3(0, 0, -0.035))
              .toArray(),
            (i === 1
              ? bracketCentre
              : centre.clone().add(new T.Vector3(0, 0, 0.035))
            ).toArray(),
            0.012,
            silver,
            fuselage,
          ),
          "entry hinge pin",
          [`Entry_hinge_knuckle_${i}`],
        );
        supported(
          rod(
            `Entry_hinge_bracket_${i}`,
            bracketCentre.toArray(),
            shellSeat.toArray(),
            0.012,
            silver,
            fuselage,
          ),
          "entry frame bracket",
          [pinName, "Pressure_shell_lower"],
        );
        bearing(
          `Entry_hinge_knuckle_${i}`,
          new T.Vector3(0, 0, z),
          new T.Vector3(0, 0, 1),
          0.016,
          door,
          [pinName, "Passenger_entry_door_edge"],
        );
      }
      const handle = skin(w.z + 0.16, -1.4, 0.004).sub(pivot);
      box(
        "Entry_recessed_handle",
        [0.008, 0.025, 0.08],
        handle.toArray(),
        silver,
        door,
      );
    } else {
      const faces: number[] = [];
      if (!w.name.startsWith("Cabin")) {
        // Curved cockpit glazing follows the hull between its enlarged edges.
        // A single flat fan would cut inward through the dashboard cover.
        pane.length = 0;
        pane.push(skin(w.z, w.angle, -0.002));
        const rings = 8;
        for (let ring = 1; ring <= rings; ring++)
          for (const p of boundary)
            pane.push(
              skin(
                T.MathUtils.lerp(w.z, p.x, ring / rings),
                T.MathUtils.lerp(w.angle, p.y, ring / rings),
                -0.002,
              ),
            );
        for (let j = 0; j < count; j++)
          faces.push(0, j + 1, ((j + 1) % count) + 1);
        for (let ring = 1; ring < rings; ring++)
          for (let j = 0; j < count; j++) {
            const a = 1 + (ring - 1) * count + j,
              b = 1 + (ring - 1) * count + ((j + 1) % count);
            faces.push(a, a + count, b, b, a + count, b + count);
          }
      } else
        for (let j = 0; j < count; j++)
          faces.push(0, j + 1, ((j + 1) % count) + 1);
      skinNormals(
        surface(
          w.name,
          pane,
          faces,
          glass,
          w.name.startsWith("Cabin") ? fuselage : cockpit,
        ),
      );
    }
    tube(
      `${w.name}_seal`,
      boundary.map((p) => skin(p.x, p.y, 0.002)),
      w.entry ? 0.003 : 0.006,
      dark,
      fuselage,
      true,
    );
  }
  // Door seams and service hatches follow the pressure shell, without raised ornamental piping.
  function hatch(
    name: string,
    z: number,
    angle: number,
    halfZ: number,
    halfAngle: number,
  ) {
    const points = Array.from({ length: 64 }, (_, j) => {
      const a = (j * tau) / 64,
        c = Math.cos(a),
        s = Math.sin(a);
      return skin(
        z + halfZ * Math.sign(c) * Math.abs(c) ** 0.35,
        angle + halfAngle * Math.sign(s) * Math.abs(s) ** 0.35,
        0.003,
      );
    });
    tube(name, points, 0.004, dark, fuselage, true);
  }
  hatch("Aft_baggage_hatch", 3.52, -1.62, 0.48, 0.43);
  tube(
    "Radome_seam",
    Array.from({ length: 96 }, (_, i) => skin(-6.88, (i * tau) / 96, 0.003)),
    0.003,
    dark,
    fuselage,
    true,
  );
  for (const side of [-1, 1])
    tube(
      `Paint_sweep_${side}`,
      Array.from({ length: 100 }, (_, i) => {
        const z = -6.6 + (i * 13.5) / 99;
        return skin(
          z,
          side * (2.0 - 0.1 * Math.exp(-(((z - 4) / 2) ** 2))),
          0.004,
        );
      }),
      0.009,
      silver,
      fuselage,
    );

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
  const wingStations = [
    [0.78, 1.16, -1.02, 3.12],
    [2, 1.21, -0.56, 2.55],
    [4.3, 1.37, 0.42, 1.72],
    [6.75, 1.56, 1.56, 0.94],
    [7.26, 1.62, 1.85, 0.67],
  ] as const;
  function wingSection(
    x: number,
    side: number,
  ): [number, number, number, number] {
    let i = 0;
    while (i < wingStations.length - 2 && x > wingStations[i + 1][0]) i++;
    const a = wingStations[i],
      b = wingStations[i + 1],
      t = (x - a[0]) / (b[0] - a[0]);
    return [
      side * x,
      T.MathUtils.lerp(a[1], b[1], t),
      T.MathUtils.lerp(a[2], b[2], t),
      T.MathUtils.lerp(a[3], b[3], t),
    ];
  }
  for (const side of [-1, 1]) {
    const label = side < 0 ? "Left" : "Right",
      wing = group(`Wing_${label}`);
    const cuts = [0.78, 1, 1.02, 2, 2.14, 4.15, 4.3, 4.4, 6.6, 6.75, 7.26];
    for (let i = 0; i < cuts.length - 1; i++) {
      const low = cuts[i],
        high = cuts[i + 1],
        flap = low >= 1 && high <= 4.15,
        aileron = low >= 4.4 && high <= 6.6;
      const section = [wingSection(low, side), wingSection(high, side)];
      foil(
        `Wing_skin_${label}_${i}`,
        section,
        0.12,
        white,
        wing,
        0,
        flap ? 0.71 : aileron ? 0.72 : 1,
      );
    }
    for (const [kind, low, high, hinge] of [
      ["Flap", 1, 4.15, 0.72],
      ["Aileron", 4.4, 6.6, 0.76],
    ] as const) {
      const sections = [
        low + 0.045,
        ...(kind === "Flap" ? [2] : []),
        high - 0.045,
      ].map((x) => wingSection(x, side));
      const a = sections[0],
        b = sections.at(-1)!;
      const pivot = new T.Vector3(a[0], a[1], a[2] + a[3] * hinge),
        end = new T.Vector3(b[0], b[1], b[2] + b[3] * hinge);
      const g = group(`${kind}_${label}`, wing, pivot.toArray());
      const axis = end.sub(pivot).normalize().multiplyScalar(side);
      g.userData.hingeAxis = axis.toArray();
      g.userData.restPosition = pivot.toArray();
      foil(`${kind}_skin_${label}`, sections, 0.12, white, g, hinge, 1, pivot);
    }
    const aileron = root.getObjectByName(`Aileron_${label}`)!;
    controlHinges(
      `Aileron_hinge_${label}`,
      aileron,
      wing,
      [4.65, 5.45, 6.35].map((x) => {
        const section = wingSection(x, side);
        return new T.Vector3(
          section[0],
          section[1],
          section[2] + section[3] * 0.7,
        );
      }),
      `Wing_skin_${label}`,
      `Aileron_skin_${label}`,
    );
    const movingFlap = root.getObjectByName(`Flap_${label}`)!;
    const flapAxis = new T.Vector3()
      .fromArray(movingFlap.userData.hingeAxis as number[])
      .normalize();
    const trackDirection = new T.Vector3(0, -0.045, 0.18);
    const trackNormal = flapAxis.clone().cross(trackDirection).normalize();
    if (trackNormal.y > 0) trackNormal.negate();
    for (const [i, x] of [1.06, 4.09].entries()) {
      const along = (side * x - movingFlap.position.x) / flapAxis.x;
      const hingePoint = movingFlap.position
        .clone()
        .addScaledVector(flapAxis, along);
      const outside = flapAxis
        .clone()
        .multiplyScalar((side * (i === 0 ? -0.04 : 0.035)) / flapAxis.x);
      const rest = hingePoint
        .clone()
        .add(outside)
        // The short root carriage fits between the wing root and flap inside
        // the hollow fairing. The outboard carriage hangs beneath its hinge.
        .add(new T.Vector3(0, i === 0 ? 0.015 : -0.1, 0));
      const carriage = group(
        `Flap_carriage_${label}_${i}`,
        wing,
        rest.toArray(),
      );
      carriage.userData.restPosition = rest.toArray();
      const pinName = `Flap_hinge_pin_${label}_${i}`;
      supported(
        rod(
          pinName,
          hingePoint
            .clone()
            .sub(rest)
            .addScaledVector(flapAxis, -0.055)
            .toArray(),
          hingePoint
            .clone()
            .sub(rest)
            .addScaledVector(flapAxis, 0.055)
            .toArray(),
          i === 0 ? 0.012 : 0.007,
          silver,
          carriage,
        ),
        "sliding flap hinge pin",
        [`Flap_hinge_knuckle_${label}_${i}`],
      );
      bearing(
        `Flap_hinge_knuckle_${label}_${i}`,
        hingePoint.clone().sub(movingFlap.position),
        flapAxis,
        i === 0 ? 0.017 : 0.01,
        movingFlap,
        [pinName, `Flap_skin_${label}`],
        i === 0 ? 0.006 : 0.004,
      );
      supported(
        rod(
          `Flap_carriage_upright_${label}_${i}`,
          [0, 0, 0],
          hingePoint.clone().add(outside).sub(rest).toArray(),
          0.012,
          silver,
          carriage,
        ),
        "flap carriage upright",
        [pinName, `Flap_track_roller_${label}_${i}`],
      );
      supported(
        rod(
          `Flap_track_roller_${label}_${i}`,
          flapAxis
            .clone()
            .multiplyScalar(i === 0 ? -0.016 : -0.047)
            .toArray(),
          flapAxis
            .clone()
            .multiplyScalar(i === 0 ? 0.016 : 0.047)
            .toArray(),
          0.014,
          silver,
          carriage,
          trackNormal,
        ),
        "captured flap track roller",
        [`Flap_track_rail_${label}_${i}`],
      );
      for (const railSide of [-1, 1]) {
        const offset = flapAxis
          .clone()
          .multiplyScalar(railSide * (i === 0 ? 0.01 : 0.032))
          .addScaledVector(trackNormal, 0.014 + 0.009);
        const start = rest
          .clone()
          .add(offset)
          .addScaledVector(trackDirection, -0.08);
        const finish = rest
          .clone()
          .add(offset)
          .addScaledVector(trackDirection, 1.08);
        const railName = `Flap_track_rail_${label}_${i}_${railSide}`;
        supported(
          rod(
            railName,
            start.toArray(),
            finish.toArray(),
            0.009,
            silver,
            wing,
            trackNormal.clone().negate(),
          ),
          "fixed flap track",
          [`Flap_track_roller_${label}_${i}`],
        );
        const section = wingSection(Math.abs(rest.x + offset.x), side);
        const anchor = new T.Vector3(
          section[0],
          section[1],
          section[2] + section[3] * 0.69,
        );
        supported(
          rod(
            `Flap_track_bracket_${label}_${i}_${railSide}`,
            start.toArray(),
            anchor.toArray(),
            0.014,
            silver,
            wing,
          ),
          "wing flap-track bracket",
          [railName, `Wing_skin_${label}`],
        );
      }
    }
    foil(
      `Winglet_${label}`,
      [
        [side * 7.26, 1.62, 1.85, 0.67],
        [side * 7.48, 2.03, 2.12, 0.52],
        [side * (reference.span / 2), 2.67, 2.55, 0.24],
      ],
      0.09,
      blue,
      wing,
    );
    const flap = root.getObjectByName(`Flap_${label}`)!;
    const flapSkin = root.getObjectByName(`Flap_skin_${label}`) as T.Mesh;
    root.updateMatrixWorld(true);
    for (const [x, z] of [
      [2.1, 1.83],
      [3.1, 1.99],
      [4, 2.13],
    ]) {
      const centreY = wingSection(x, side)[1] - 0.14;
      const geometry = new T.SphereGeometry(1, 16, 10)
        .scale(0.065, 0.1, 0.48)
        .translate(side * x, centreY, z);
      const positions = geometry.getAttribute("position");
      // Fit the housing's upper saddle to the actual underside triangles, rather
      // than leaving an ellipsoid below the wing centreline. A 3 mm overlap seals
      // the joint; the housing is carried by the flap throughout its travel.
      for (let i = 0; i < positions.count; i++) {
        const upper = (positions.getY(i) - centreY) / 0.1;
        if (upper <= 0.3) continue;
        const ray = new T.Raycaster(
          new T.Vector3(positions.getX(i), -1, positions.getZ(i)),
          new T.Vector3(0, 1, 0),
          0,
          4,
        );
        const skin = ray.intersectObject(flapSkin, false)[0];
        if (skin)
          positions.setY(
            i,
            T.MathUtils.lerp(
              positions.getY(i),
              skin.point.y + 0.003,
              T.MathUtils.smoothstep(upper, 0.3, 0.75),
            ),
          );
      }
      geometry.translate(-flap.position.x, -flap.position.y, -flap.position.z);
      geometry.computeVertexNormals();
      mesh(`Flap_track_fairing_${label}_${x}`, geometry, white, flap);
    }
    const navigation = material(
      `Navigation_${label}`,
      side < 0 ? "#ec2727" : "#29ca79",
      0.12,
    );
    navigation.emissive.copy(navigation.color);
    navigation.emissiveIntensity = 0.65;
    const lamp = mesh(
      `Wingtip_light_${label}`,
      new T.SphereGeometry(0.028, 12, 8),
      navigation,
      wing,
    );
    lamp.position.set(side * 7.74, 2.55, 2.63);
  }
  const positionLight = material("White rear position light", "#ffffff", 0.15);
  positionLight.emissive.set("#ffffff");
  positionLight.emissiveIntensity = 0.65;
  const rearLamp = mesh(
    "Rear_position_light",
    new T.SphereGeometry(0.025, 12, 8),
    positionLight,
    fuselage,
  );
  rearLamp.position.set(0, 2.35, 7.93);
  const carryPoints: T.Vector3[] = [],
    carryIndices: number[] = [];
  const carry = [
    [-1.7, 0.03, 0.01],
    [-1.1, 0.98, 0.19],
    [0.6, 1.5, 0.23],
    [1.6, 1.42, 0.23],
    [2.2, 0.45, 0.08],
    [2.65, 0.02, 0.01],
  ];
  for (let i = 0; i < 81; i++) {
    const z = T.MathUtils.lerp(carry[0][0], carry.at(-1)![0], i / 80);
    let k = 0;
    while (k < carry.length - 2 && z > carry[k + 1][0]) k++;
    const a = carry[k],
      b = carry[k + 1],
      t = (z - a[0]) / (b[0] - a[0]);
    const width = T.MathUtils.lerp(a[1], b[1], t),
      height = T.MathUtils.lerp(a[2], b[2], t);
    for (let j = 0; j < 64; j++)
      carryPoints.push(
        new T.Vector3(
          width * Math.sin((j * tau) / 64),
          1.22 + height * Math.cos((j * tau) / 64),
          z,
        ),
      );
  }
  for (let i = 0; i < 80; i++)
    for (let j = 0; j < 64; j++) {
      const a = i * 64 + j,
        b = i * 64 + ((j + 1) % 64),
        p = carryPoints[a].clone().add(carryPoints[b]).multiplyScalar(0.5);
      const [bodyX, bodyY, bodyCenter] = bodyAt(p.z);
      if ((p.x / bodyX) ** 2 + ((p.y - bodyCenter) / bodyY) ** 2 < 1.005)
        continue;
      carryIndices.push(a, a + 64, b, b, a + 64, b + 64);
    }
  surface(
    "Wing_body_carry_through_fairing",
    carryPoints,
    carryIndices,
    white,
    fuselage,
  );
  const tail = group("Empennage");
  const finSections = [
    [2.6, 0, 4.52, 2.96],
    [4.94, 0, 5.76, 1.44],
    [5.1, 0, 5.94, 1.22],
  ] as const;
  function vertical(o: T.Mesh, pivot = new T.Vector3()) {
    const p = o.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i);
      p.setXYZ(i, y - pivot.x, x - pivot.y, p.getZ(i) - pivot.z);
    }
    const index = o.geometry.index!;
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    o.geometry.computeVertexNormals();
  }
  vertical(foil("Vertical_stabilizer", finSections, 0.09, blue, tail, 0, 0.73));
  const finPivot = new T.Vector3(0, 2.6, 4.52 + 2.96 * 0.75);
  const rudder = group("Rudder", tail, finPivot.toArray());
  rudder.userData.hingeAxis = new T.Vector3(
    0,
    2.5,
    5.94 + 1.22 * 0.75 - finPivot.z,
  )
    .normalize()
    .toArray();
  vertical(
    foil("Rudder_skin", finSections, 0.09, blue, rudder, 0.75, 1),
    finPivot,
  );
  controlHinges(
    "Rudder_hinge",
    rudder,
    tail,
    [0.18, 0.52, 0.85].map((t) => {
      const point = finPivot
        .clone()
        .addScaledVector(
          new T.Vector3().fromArray(rudder.userData.hingeAxis as number[]),
          t * 2.5,
        );
      point.z -= 0.07;
      return point;
    }),
    "Vertical_stabilizer",
    "Rudder_skin",
  );
  for (const side of [-1, 1]) {
    const label = side < 0 ? "Left" : "Right",
      parent = group(`Tailplane_${label}`, tail);
    const sections = [
      [side * 0.06, 5.01, 5.73, 1.48],
      [side * 1.5, 5.01, 6.28, 1.03],
      [side * (reference.tailSpan / 2), 5.01, 6.92, 0.47],
    ] as const;
    foil(`Tailplane_skin_${label}`, sections, 0.075, white, parent, 0, 0.68);
    const a = sections[0],
      b = sections[2],
      pivot = new T.Vector3(a[0], a[1], a[2] + a[3] * 0.7);
    const elevator = group(`Elevator_${label}`, parent, pivot.toArray());
    elevator.userData.hingeAxis = new T.Vector3(
      b[0] - a[0],
      0,
      b[2] + b[3] * 0.7 - pivot.z,
    )
      .normalize()
      .multiplyScalar(side)
      .toArray();
    foil(
      `Elevator_skin_${label}`,
      sections,
      0.075,
      white,
      elevator,
      0.7,
      1,
      pivot,
    );
    controlHinges(
      `Elevator_hinge_${label}`,
      elevator,
      parent,
      [0.45, 1.5, 2.6].map((x) => {
        const t = (x - Math.abs(a[0])) / (Math.abs(b[0]) - Math.abs(a[0]));
        return new T.Vector3(
          side * x,
          5.01,
          T.MathUtils.lerp(a[2] + a[3] * 0.66, b[2] + b[3] * 0.66, t),
        );
      }),
      `Tailplane_skin_${label}`,
      `Elevator_skin_${label}`,
    );
  }
  // Open annular nacelles: an inlet lip, dark duct, visible fan and separate exhaust.
  for (const side of [-1, 1]) {
    const label = side < 0 ? "Left" : "Right",
      engine = group(`Engine_${label}`, root, [side * 1.3, 2.78, 3.6]);
    const ringProfile = [
      new T.Vector2(0.35, -1.0),
      new T.Vector2(0.42, -0.98),
      new T.Vector2(0.46, -0.85),
      new T.Vector2(0.48, -0.45),
      new T.Vector2(0.46, 0.35),
      new T.Vector2(0.36, 1.0),
      new T.Vector2(0.3, 1.08),
    ];
    const nacelle = mesh(
      `Nacelle_${label}`,
      new T.LatheGeometry(ringProfile, 64),
      white,
      engine,
    );
    nacelle.geometry.rotateX(Math.PI / 2);
    const duct = mesh(
      `Intake_duct_${label}`,
      new T.CylinderGeometry(0.33, 0.35, 0.48, 48, 1, true),
      dark,
      engine,
    );
    duct.geometry.rotateX(Math.PI / 2);
    duct.position.z = -0.75;
    duct.material.side = T.DoubleSide;
    const lip = mesh(
      `Intake_lip_${label}`,
      new T.TorusGeometry(0.385, 0.035, 12, 64),
      silver,
      engine,
    );
    lip.position.z = -0.99;
    const fan = group(`Fan_${label}`, engine, [0, 0, -0.56]);
    const back = mesh(
      `Fan_back_${label}`,
      new T.CircleGeometry(0.33, 48),
      dark,
      fan,
    );
    back.rotation.y = Math.PI;
    for (let j = 0; j < 22; j++) {
      const blade = box(
          `Fan_blade_${label}_${j}`,
          [0.025, 0.23, 0.035],
          [0, 0, 0],
          silver,
          fan,
        ),
        a = (j * tau) / 22;
      blade.position.set(Math.sin(a) * 0.205, Math.cos(a) * 0.205, -0.01);
      blade.rotation.z = -a + 0.35;
    }
    const spinner = mesh(
      `Fan_spinner_${label}`,
      new T.ConeGeometry(0.115, 0.2, 32),
      silver,
      fan,
    );
    spinner.geometry.rotateX(-Math.PI / 2);
    spinner.position.z = -0.075;
    supported(
      rod(`Fan_shaft_${label}`, [0, 0, 0], [0, 0, 0.28], 0.07, silver, fan),
      "fan shaft",
      [`Fan_back_${label}`, `Fan_rear_bearing_${label}`],
    );
    bearing(
      `Fan_rear_bearing_${label}`,
      new T.Vector3(0, 0, -0.3),
      new T.Vector3(0, 0, 1),
      0.071,
      engine,
      [`Fan_shaft_${label}`],
    );
    for (let i = 0; i < 3; i++) {
      const angle = (i * tau) / 3;
      const direction = new T.Vector3(Math.sin(angle), Math.cos(angle), 0);
      const ray = new T.Ray(new T.Vector3(0, 0, -0.3), direction);
      const positions = nacelle.geometry.getAttribute("position");
      const index = nacelle.geometry.index!;
      let radius = Infinity;
      for (let j = 0; j < index.count; j += 3) {
        const points = [0, 1, 2].map((k) =>
          new T.Vector3().fromBufferAttribute(positions, index.getX(j + k)),
        );
        const hit = ray.intersectTriangle(
          points[0],
          points[1],
          points[2],
          false,
          new T.Vector3(),
        );
        if (hit) radius = Math.min(radius, hit.distanceTo(ray.origin));
      }
      if (!Number.isFinite(radius)) throw new Error("Missing fan stator seat");
      supported(
        rod(
          `Fan_stator_support_${label}_${i}`,
          [Math.sin(angle) * 0.072, Math.cos(angle) * 0.072, -0.3],
          [direction.x * radius, direction.y * radius, -0.3],
          0.012,
          silver,
          engine,
        ),
        "rear bearing stator",
        [`Fan_rear_bearing_${label}`, `Nacelle_${label}`],
      );
    }
    const exhaust = mesh(
      `Exhaust_${label}`,
      new T.CylinderGeometry(0.31, 0.29, 0.32, 40, 1, true),
      silver,
      engine,
    );
    exhaust.geometry.rotateX(Math.PI / 2);
    exhaust.position.z = 1.02;
    const outlet = mesh(
      `Exhaust_dark_${label}`,
      new T.CircleGeometry(0.27, 48),
      dark,
      engine,
    );
    // The dark engine interior is recessed, leaving the outlet visibly open.
    outlet.position.z = 0.22;
    const collar = mesh(
      `Exhaust_mount_collar_${label}`,
      new T.TorusGeometry(0.3, 0.009, 10, 48),
      silver,
      engine,
    );
    collar.position.z = 1.08;
    supported(collar, "exhaust installation collar", [
      `Exhaust_${label}`,
      `Nacelle_${label}`,
    ]);
    const outletLiner = mesh(
      `Exhaust_inner_liner_${label}`,
      new T.CylinderGeometry(0.295, 0.27, 0.96, 48, 1, true),
      dark,
      engine,
    );
    outletLiner.geometry.rotateX(Math.PI / 2);
    outletLiner.position.z = 0.7;
    outletLiner.material.side = T.DoubleSide;
    supported(outletLiner, "exhaust inner sleeve", [
      `Exhaust_dark_${label}`,
      `Exhaust_exit_lip_${label}`,
    ]);
    const exitLip = mesh(
      `Exhaust_exit_lip_${label}`,
      new T.RingGeometry(0.295, 0.31, 48),
      silver,
      engine,
    );
    exitLip.position.z = 1.18;
    supported(exitLip, "finite-thickness nozzle lip", [
      exhaust.name,
      outletLiner.name,
    ]);
    const centrebody = mesh(
      `Exhaust_centrebody_${label}`,
      new T.ConeGeometry(0.1, 0.4, 40),
      silver,
      engine,
    );
    centrebody.geometry.rotateX(Math.PI / 2);
    centrebody.position.z = 0.42;
    supported(centrebody, "recessed exhaust centrebody", [outlet.name]);
    for (let i = 0; i < 3; i++) {
      const angle = (i * tau) / 3;
      supported(
        rod(
          `Exhaust_stator_${label}_${i}`,
          [Math.sin(angle) * 0.09, Math.cos(angle) * 0.09, 0.25],
          [Math.sin(angle) * 0.271, Math.cos(angle) * 0.271, 0.25],
          0.008,
          silver,
          engine,
        ),
        "exhaust centrebody support",
        [centrebody.name, outletLiner.name],
      );
    }
    const pylon = mesh(
      `Engine_pylon_${label}`,
      new T.BoxGeometry(0.72, 0.15, 1.24, 1, 4, 32),
      white,
      engine,
    );
    pylon.geometry.rotateZ(-side * 0.1);
    pylon.geometry.translate(-side * 0.48, -0.13, 0.1);
    const vertices = pylon.geometry.getAttribute("position");
    const skin = nacelle.geometry.getAttribute("position");
    const indices = nacelle.geometry.index!;
    const skinTriangles = Array.from({ length: indices.count / 3 }, (_, i) =>
      [0, 1, 2].map((k) =>
        new T.Vector3().fromBufferAttribute(skin, indices.getX(i * 3 + k)),
      ),
    );
    const seats = new Map<string, number>();
    const hitPoint = new T.Vector3();
    for (let i = 0; i < vertices.count; i++) {
      if (-side * vertices.getX(i) > 0.49) continue;
      const key = `${vertices.getY(i)},${vertices.getZ(i)}`;
      const ray = new T.Ray(
        new T.Vector3(0, vertices.getY(i), vertices.getZ(i)),
        new T.Vector3(-side, 0, 0),
      );
      let seat = seats.get(key) ?? Infinity;
      if (!Number.isFinite(seat)) {
        for (const [a, b, c] of skinTriangles) {
          const hit = ray.intersectTriangle(a, b, c, false, hitPoint);
          if (hit) seat = Math.min(seat, Math.abs(hit.x));
        }
        seats.set(key, seat);
      }
      if (!Number.isFinite(seat)) throw new Error("Missing engine pylon seat");
      // End at the actual nacelle triangles, with 2 mm of installation overlap.
      // A full-width box passed through the nacelle and blocked the exhaust.
      vertices.setX(
        i,
        -side * Math.max(-side * vertices.getX(i), seat - 0.002),
      );
    }
    pylon.geometry.computeVertexNormals();
  }
  const gear = group("LandingGear");
  function wheel(
    name: string,
    radius: number,
    width: number,
    parent: T.Object3D,
    position: Point,
  ) {
    const g = group(name, parent, position);
    const tire = mesh(
      `${name}_tire`,
      new T.TorusGeometry(radius * 0.73, radius * 0.27, 12, 48),
      rubber,
      g,
    );
    tire.rotation.y = Math.PI / 2;
    tire.scale.z = width / (radius * 0.54);
    for (const side of [-1, 1]) {
      const hub = mesh(
        `${name}_hub_${side}`,
        new T.CylinderGeometry(radius * 0.48, radius * 0.48, 0.025, 32),
        silver,
        g,
      );
      hub.rotation.z = Math.PI / 2;
      hub.position.x = side * width * 0.48;
    }
    const rimProfile = [
      new T.Vector2(radius * 0.45, -width * 0.48),
      new T.Vector2(radius * 0.7, -width * 0.48),
      new T.Vector2(radius * 0.48, -width * 0.1),
      new T.Vector2(radius * 0.48, width * 0.1),
      new T.Vector2(radius * 0.7, width * 0.48),
      new T.Vector2(radius * 0.45, width * 0.48),
      new T.Vector2(radius * 0.45, -width * 0.48),
    ];
    const rim = mesh(
      `${name}_rim_barrel`,
      new T.LatheGeometry(rimProfile, 48),
      silver,
      g,
    );
    rim.geometry.rotateZ(-Math.PI / 2);
    supported(rim, "wheel bead-fitting rim", [
      `${name}_tire`,
      `${name}_hub_-1`,
      `${name}_hub_1`,
    ]);
    supported(
      rod(
        `${name}_axle`,
        [-width * (name === "Nose_wheel" ? 0.62 : 0.545), 0, 0],
        [width * (name === "Nose_wheel" ? 0.62 : 0.545), 0, 0],
        0.035,
        silver,
        g,
      ),
      "wheel axle",
      [`${name}_hub_-1`, `${name}_hub_1`],
    );
    return g;
  }
  for (const side of [-1, 1]) {
    const label = side < 0 ? "Left" : "Right",
      pivot = exteriorGear.mainPivot;
    const leg = group(`Main_gear_${label}_retraction_hinge`, gear, [
      side * pivot[0],
      pivot[1],
      pivot[2],
    ]);
    rod(`Main_oleo_${label}`, [0, 0, 0], [0, -0.72, 0], 0.047, white, leg);
    rod(
      `Main_piston_${label}`,
      [0, -0.52, 0],
      [0, -0.88, 0],
      0.029,
      silver,
      leg,
    );
    rod(
      `Main_fork_${label}`,
      [0, -0.74, 0.07],
      [0, -0.88, 0],
      0.025,
      silver,
      leg,
    );
    rod(
      `Torque_link_upper_${label}`,
      [0, -0.35, 0.04],
      [0, -0.52, 0.16],
      0.014,
      silver,
      leg,
    );
    rod(
      `Torque_link_lower_${label}`,
      [0, -0.52, 0.16],
      [0, -0.69, 0.04],
      0.014,
      silver,
      leg,
    );
    wheel(
      `Main_wheel_${label}`,
      exteriorGear.mainRadius,
      exteriorGear.mainWidth,
      leg,
      [0, -0.88, 0],
    );
  }
  const noseInstallation = group("Nose_gear_installation", gear, [
    0,
    0,
    -noseShift,
  ]);
  const noseSkin = (z: number, angle: number, inset = 0) =>
    skin(z - noseShift, angle, inset).add(new T.Vector3(0, 0, noseShift));
  const nose = group("Nose_gear_retraction_hinge", noseInstallation, [
    exteriorGear.nosePivot[0],
    exteriorGear.nosePivot[1] + noseLift,
    exteriorGear.nosePivot[2],
  ]);
  // Hinge sits inside the pressure skin; extend the leg to preserve ground contact.
  rod("Nose_oleo", [0, 0, 0], [0, -0.75, -0.3], 0.037, white, nose);
  rod(
    "Nose_piston",
    [0, -0.6, -0.23],
    [0, -0.93 - noseLift, -0.385],
    0.025,
    silver,
    nose,
  );
  const steering = group("Nose_steering", nose, [0, -1.07 - noseLift, -0.45]);
  for (const side of [-1, 1])
    rod(
      `Nose_fork_${side}`,
      [side * 0.1, 0.15, 0],
      [side * 0.1, 0, 0],
      0.018,
      silver,
      steering,
    );
  supported(
    rod(
      "Nose_fork_crown",
      [-0.1, 0.15, 0],
      [0.1, 0.15, 0],
      0.024,
      silver,
      steering,
    ),
    "nose fork crown",
    ["Nose_fork_-1", "Nose_fork_1", "Nose_steering_spindle"],
  );
  supported(
    rod(
      "Nose_steering_spindle",
      [0, -0.9, -0.385],
      [0, -0.92 - noseLift, -0.45],
      0.025,
      silver,
      nose,
    ),
    "steering spindle",
    ["Nose_piston", "Nose_fork_crown"],
  );
  wheel(
    "Nose_wheel",
    exteriorGear.noseRadius,
    exteriorGear.noseWidth,
    steering,
    [0, 0, 0],
  );
  for (const side of [-1, 1]) {
    const pivot = noseSkin(-5.1, side * 2.8),
      door = group(
        `Nose_door_hinge_${side}`,
        noseInstallation,
        pivot.toArray(),
      );
    const points: T.Vector3[] = [],
      ix: number[] = [];
    for (let i = 0; i <= 32; i++)
      for (let j = 0; j <= 8; j++)
        points.push(
          noseSkin(
            -6.295 + (i * 2.19) / 32,
            side * T.MathUtils.lerp(2.8, Math.PI - 0.005, j / 8),
            -0.001,
          ).sub(pivot),
        );
    for (let i = 0; i < 32; i++)
      for (let j = 0; j < 8; j++) {
        const a = i * 9 + j;
        ix.push(
          ...(side > 0
            ? [a, a + 9, a + 1, a + 1, a + 9, a + 10]
            : [a, a + 1, a + 9, a + 1, a + 10, a + 9]),
        );
      }
    const panelPaint = blue.clone();
    panelPaint.side = T.DoubleSide;
    surface(`Nose_bay_door_${side}`, points, ix, panelPaint, door);
    for (const [i, z] of [-5.85, -4.55].entries()) {
      const axis = new T.Vector3(pivot.x, pivot.y, z);
      const rim = noseSkin(z, side * 2.8, -0.001);
      rod(
        `Nose_door_pin_${side}_${i}`,
        [axis.x, axis.y, z - 0.055],
        [axis.x, axis.y, z + 0.055],
        0.012,
        silver,
        noseInstallation,
      );
      rod(
        `Nose_door_clevis_${side}_${i}`,
        axis.toArray(),
        rim
          .clone()
          .add(new T.Vector3(0, 0.012, 0))
          .toArray(),
        0.012,
        well,
        noseInstallation,
      );
      rod(
        `Nose_door_leaf_${side}_${i}`,
        axis.sub(pivot).toArray(),
        rim.sub(pivot).toArray(),
        0.009,
        silver,
        door,
      );
    }
  }
  fitAureliaNoseBay(noseInstallation, palettes, noseShift, noseLift);
  fitAureliaMainBays(root, gear, palettes);
  for (const side of [-1, 1]) {
    const label = side < 0 ? "Left" : "Right";
    const at = new T.Vector3(
      side * exteriorGear.mainPivot[0],
      exteriorGear.mainPivot[1],
      exteriorGear.mainPivot[2],
    );
    const pinName = `Main_trunnion_pin_${label}`;
    supported(
      rod(
        pinName,
        at
          .clone()
          .add(new T.Vector3(0, 0, -0.13))
          .toArray(),
        at
          .clone()
          .add(new T.Vector3(0, 0, 0.13))
          .toArray(),
        0.025,
        silver,
        gear,
      ),
      "main trunnion pin",
      [`Main_oleo_${label}`],
    );
    for (const z of [-0.095, 0.095]) {
      const anchor = at.clone().add(new T.Vector3(0, 0, z));
      supported(
        rod(
          `Main_trunnion_mount_${label}_${z}`,
          anchor.toArray(),
          [anchor.x, 1.294, anchor.z],
          0.027,
          well,
          gear,
        ),
        "fixed trunnion mount",
        [pinName, `Main_bay_roof_${label}`],
      );
    }
  }
  const nosePin = new T.Vector3(...exteriorGear.nosePivot).add(
    new T.Vector3(0, noseLift, 0),
  );
  supported(
    rod(
      "Nose_trunnion_pin",
      nosePin
        .clone()
        .add(new T.Vector3(-0.105, 0, 0))
        .toArray(),
      nosePin
        .clone()
        .add(new T.Vector3(0.105, 0, 0))
        .toArray(),
      0.025,
      silver,
      noseInstallation,
    ),
    "nose trunnion pin",
    ["Nose_oleo"],
  );
  for (const x of [-0.085, 0.085])
    supported(
      rod(
        `Nose_trunnion_mount_${x}`,
        [x, nosePin.y, nosePin.z],
        [x, 1.424, nosePin.z],
        0.023,
        well,
        noseInstallation,
      ),
      "fixed nose trunnion mount",
      ["Nose_trunnion_pin", "Nose_bay_roof"],
    );
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
  root.updateMatrixWorld(true);
  return { root, palettes };
}
