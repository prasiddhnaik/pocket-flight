import * as T from "three";
import {
  aureliaExteriorReference as reference,
  aureliaInteriorLayout as layout,
  aureliaBodyAt as bodyAt,
  aureliaHullStations as stations,
} from "./exterior-reference";
import { type ExteriorKit, material, tau } from "./exterior-kit";
import type { aureliaCockpitWindows } from "./cockpit-layout";

type Aperture = {
  name: string;
  z: number;
  angle: number;
  halfZ: number;
  halfAngle: number;
  entry?: boolean;
};

/** Pressure shell with real glazing apertures, the airstair entry door, seams and livery. */
export function buildFuselage(
  kit: ExteriorKit,
  noseShift: number,
  cockpitWindows: ReturnType<typeof aureliaCockpitWindows>,
) {
  const { white, blue, silver, dark, glass, group, surface, tube, rod, supported, bearing, box, skin, skinNormals } = kit;
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
  return { fuselage, cockpit, entryLiningGeometry };
}

/** Rear position light and the wing-to-body carry-through fairing. */
export function buildCarryThroughFairing(kit: ExteriorKit, fuselage: T.Group) {
  const { white, mesh, surface } = kit;
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
}
