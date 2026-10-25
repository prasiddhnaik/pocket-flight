import * as T from "three";
import { detailAureliaCockpit } from "./cockpit-hardware";
import { makeAureliaDashboardHousing } from "./dashboard";
import {
  aureliaBodyAt as hullAt,
  aureliaFloorHalfWidth as floorHalfWidth,
  aureliaInteriorLayout as layout,
} from "./exterior-reference";

import { aureliaCockpitLayout } from "./cockpit-layout";
import { makeAureliaCockpitPartition } from "./cockpit-partition";

type Point = readonly [number, number, number];
const SOURCE =
  "https://www.embraer.com/media/rboe5b55/brochure-phenom-300e-18-fb-eletronic.pdf";

/** Phenom 300E baseline-inspired cabin. SI metres, +Y up, -Z forward. */
export function makeAureliaInterior(airframeScale = 1): T.Group {
  const floorY = layout.floorY;
  const flightDeck = aureliaCockpitLayout(airframeScale);
  const [, nominalHullY, nominalCentre] = hullAt(0);
  const linerInsetY =
    nominalCentre + nominalHullY - floorY - layout.cabinHeight;
  const cabinShift = floorY - 1.32;
  const root = new T.Group();
  root.name = "Interior";
  root.userData = {
    source: SOURCE,
    referencePages: [17, 19, 23],
    units: "metres",
    forward: "-Z",
    cabinWidth: 1.55,
    cabinHeight: layout.cabinHeight,
    floorY,
    passengerSeats: 6,
    pilotSeats: 2,
    minimumAisle: 0.3,
    evidence:
      "Cabin width, height and baseline occupant count are manufacturer values. Furniture dimensions, longitudinal stations and cockpit detail are visual reconstructions. The reference viewer supplies animated demonstration instruments, not certified G3000 software or flight telemetry.",
  };
  const mat = (
    name: string,
    color: string,
    roughness: number,
    metalness = 0,
  ) => {
    const m = new T.MeshStandardMaterial({ color, roughness, metalness });
    m.name = name;
    return m;
  };
  const leather = mat("Warm ivory leather", "#d1c4ad", 0.72);
  const insert = mat("Leather seat inserts", "#b9ac97", 0.82);
  const darkLeather = mat("Cockpit charcoal leather", "#343b3e", 0.87);
  const lining = mat("Pearl cabin lining", "#dbd7ca", 0.88);
  lining.side = T.DoubleSide;
  const carpet = mat("Woven graphite carpet", "#4d514e", 0.98);
  const walnut = mat("Satin dark wood", "#3e3129", 0.4);
  const metal = mat("Brushed nickel", "#a0a7a8", 0.3, 0.78);
  const black = mat("Cockpit nonreflective panels", "#171e22", 0.95);
  const screen = mat("Inactive display placeholders", "#101c24", 0.22, 0.1);
  const seam = mat("Seat stitching", "#998b77", 0.92);
  const lamp = mat("Warm ceiling light diffuser", "#f3e7c9", 0.65);
  lamp.emissive.set("#f0d9a8");
  lamp.emissiveIntensity = 0.28;
  const group = (
    name: string,
    parent: T.Object3D = root,
    position: Point = [0, 0, 0],
  ) => {
    const g = new T.Group();
    g.name = name;
    g.position.fromArray(position);
    parent.add(g);
    return g;
  };
  const mesh = (
    name: string,
    geometry: T.BufferGeometry,
    material: T.Material,
    parent: T.Object3D,
  ) => {
    if (!geometry.index)
      geometry.setIndex(
        Array.from(
          { length: geometry.getAttribute("position").count },
          (_, i) => i,
        ),
      );
    const m = new T.Mesh(geometry, material);
    m.name = name;
    m.castShadow = m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const rounded = (
    name: string,
    size: Point,
    at: Point,
    radius: number,
    material: T.Material,
    parent: T.Object3D,
  ) => {
    const geometry = new T.BoxGeometry(...size, 6, 6, 6),
      p = geometry.getAttribute("position");
    const half = new T.Vector3(...size).multiplyScalar(0.5),
      core = half.clone().addScalar(-radius);
    const v = new T.Vector3(),
      c = new T.Vector3();
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i);
      c.copy(v).clamp(core.clone().negate(), core);
      v.sub(c).normalize().multiplyScalar(radius).add(c);
      p.setXYZ(i, v.x, v.y, v.z);
    }
    geometry.computeVertexNormals();
    const m = mesh(name, geometry, material, parent);
    m.position.fromArray(at);
    return m;
  };
  const line = (
    name: string,
    points: T.Vector3[],
    radius: number,
    material: T.Material,
    parent: T.Object3D,
    closed = false,
  ) =>
    mesh(
      name,
      new T.TubeGeometry(
        new T.CatmullRomCurve3(points, closed),
        Math.max(12, points.length * 3),
        radius,
        6,
        closed,
      ),
      material,
      parent,
    );
  const rod = (
    name: string,
    a: Point,
    b: Point,
    radius: number,
    material: T.Material,
    parent: T.Object3D,
  ) => {
    const start = new T.Vector3(...a),
      end = new T.Vector3(...b),
      d = end.clone().sub(start);
    const m = mesh(
      name,
      new T.CylinderGeometry(radius, radius, d.length(), 10),
      material,
      parent,
    );
    m.position.copy(start.add(end).multiplyScalar(0.5));
    m.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), d.normalize());
    return m;
  };
  const surface = (
    name: string,
    vertices: T.Vector3[],
    indices: number[],
    material: T.Material,
    parent: T.Object3D,
  ) => {
    const g = new T.BufferGeometry().setFromPoints(vertices);
    g.setIndex(indices);
    g.computeVertexNormals();
    return mesh(name, g, material, parent);
  };
  // Upholstery has a genuine 0.30 m clear aisle; trim remains outboard of it.
  const cabin = group("Cabin"),
    cockpit = group("Flight_deck"),
    seats = group("Passenger_seats", cabin);
  function floor(
    name: string,
    start: number,
    end: number,
    parent: T.Object3D,
    tunnel = false,
  ) {
    const outline: T.Vector2[] = [];
    for (const side of [-1, 1])
      for (let i = 0; i <= 64; i++) {
        const z = T.MathUtils.lerp(start, end, (side < 0 ? i : 64 - i) / 64);
        outline.push(new T.Vector2(side * floorHalfWidth(z), z));
      }
    if (tunnel)
      outline.push(
        new T.Vector2(flightDeck.tunnelHalfWidth, start),
        new T.Vector2(flightDeck.tunnelHalfWidth, -4.8 - flightDeck.noseShift),
        new T.Vector2(-flightDeck.tunnelHalfWidth, -4.8 - flightDeck.noseShift),
        new T.Vector2(-flightDeck.tunnelHalfWidth, start),
      );
    const geometry = new T.ExtrudeGeometry(new T.Shape(outline), {
      depth: layout.floorThickness,
      bevelEnabled: false,
      steps: 1,
    })
      .rotateX(Math.PI / 2)
      .translate(0, floorY, 0);
    return mesh(name, geometry, carpet, parent);
  }
  floor("Cabin_floor", -3.35, 2.9, cabin);
  const station = (z: number, angle: number, outer = false) => {
    const [hullX, hullY, cy] = hullAt(z);
    const rx = hullX - (outer ? 0.008 : 0.125),
      ry = hullY - (outer ? 0.008 : linerInsetY);
    return new T.Vector3(rx * Math.sin(angle), cy + ry * Math.cos(angle), z);
  };
  floor("Entry_vestibule_floor", -3.99, -3.35, cabin);
  const windows = Array.from({ length: 6 }, (_, i) => -2.9 + i * 1.04);
  // The liner is tessellated around openings. Reveals connect it to the exterior glazing.
  for (const side of [-1, 1]) {
    const sideName = side < 0 ? "Left" : "Right";
    const wall = group(`Cabin_liner_${sideName}`, cabin);
    // Close the space between the curved liner and the narrower, lower floor.
    const skirt: T.Vector3[] = [],
      skirtIndices: number[] = [];
    for (let i = 0; i <= 80; i++) {
      const z = T.MathUtils.lerp(-3.35, 2.9, i / 80);
      skirt.push(
        station(z, side * 2.25),
        new T.Vector3(side * floorHalfWidth(z), floorY - 0.005, z),
      );
      if (i) {
        const a = (i - 1) * 2;
        skirtIndices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    surface(`Lower_liner_skirt_${sideName}`, skirt, skirtIndices, lining, wall);
    const zCuts = [
      -3.35,
      ...windows.flatMap((z) => [z - 0.27, z + 0.27]),
      2.9,
    ].sort((a, b) => a - b);
    const aCuts = [0, 0.945, 1.515, 2.25];
    for (let zi = 0; zi < zCuts.length - 1; zi++)
      for (let ai = 0; ai < aCuts.length - 1; ai++) {
        const z0 = zCuts[zi],
          z1 = zCuts[zi + 1],
          a0 = aCuts[ai],
          a1 = aCuts[ai + 1];
        const windowZ = windows.find((z) => z > z0 && z < z1);
        const isWindow = windowZ !== undefined && ai === 1;
        const outer: T.Vector2[] = [];
        const edges = [
          [z0, a0, z1, a0],
          [z1, a0, z1, a1],
          [z1, a1, z0, a1],
          [z0, a1, z0, a0],
        ];
        for (const [u0, v0, u1, v1] of edges) {
          const n = Math.max(2, Math.ceil(Math.hypot(u1 - u0, v1 - v0) / 0.1));
          for (let j = 0; j < n; j++)
            outer.push(
              new T.Vector2(
                T.MathUtils.lerp(u0, u1, j / n),
                T.MathUtils.lerp(v0, v1, j / n),
              ),
            );
        }
        const aperture: T.Vector2[] = [];
        if (isWindow)
          for (let i = 0; i < 48; i++) {
            const a = (i * Math.PI * 2) / 48,
              c = Math.cos(a),
              s = Math.sin(a);
            aperture.push(
              new T.Vector2(
                windowZ + 0.225 * Math.sign(c) * Math.abs(c) ** 0.56,
                1.23 + 0.235 * Math.sign(s) * Math.abs(s) ** 0.56,
              ),
            );
          }
        const points = [...outer, ...aperture];
        const indices = T.ShapeUtils.triangulateShape(
          outer,
          aperture.length ? [aperture] : [],
        )
          .filter(([a, b, c]) => {
            // Collinear parameter-space edges curve after projection onto the hull.
            // Discard their zero-area slivers before they can fold the liner normals.
            const u = points[b].clone().sub(points[a]),
              v = points[c].clone().sub(points[a]);
            return Math.abs(u.cross(v)) > 1e-12;
          })
          .flat();
        surface(
          `Liner_panel_${sideName}_${zi}_${ai}`,
          points.map((p) => station(p.x, p.y * side)),
          indices,
          lining,
          wall,
        );
        if (isWindow) {
          const revealPoints = [
            ...aperture.map((p) => station(p.x, p.y * side)),
            ...aperture.map((p) => station(p.x, p.y * side, true)),
          ];
          const ix: number[] = [];
          for (let i = 0; i < 48; i++) {
            const n = (i + 1) % 48;
            ix.push(i, n, i + 48, n, n + 48, i + 48);
          }
          const reveal = surface(
            `Window_reveal_${sideName}_${windows.indexOf(windowZ) + 1}`,
            revealPoints,
            ix,
            lining,
            wall,
          );
          reveal.userData = { windowZ, opening: true };
          line(
            `Window_trim_${sideName}_${windows.indexOf(windowZ) + 1}`,
            aperture.map((p) => station(p.x, p.y * side)),
            0.007,
            metal,
            wall,
            true,
          );
        }
      }
    const upper = Array.from({ length: 18 }, (_, i) =>
      station(-3.2 + i * 0.35, side * 0.61),
    );
    line(`Ceiling_light_${sideName}`, upper, 0.014, lamp, wall);
    const rail = Array.from({ length: 18 }, (_, i) => {
      const z = -3.2 + i * 0.35,
        [, ry, cy] = hullAt(z);
      return station(
        z,
        side * Math.acos((floorY + 0.51 - cy) / (ry - linerInsetY)),
      );
    });
    line(`Sidewall_wood_rail_${sideName}`, rail, 0.025, walnut, wall);
    for (const z of [-1.35, 0.5]) {
      const panel = rounded(
        `Upper_control_panel_${sideName}_${z}`,
        [0.13, 0.022, 0.28],
        [side * 0.43, station(z, side * 0.61).y - 0.002, z],
        0.009,
        metal,
        wall,
      );
      panel.rotation.z = -side * 0.49;
      for (let i = 0; i < 3; i++)
        rounded(
          `Control_key_${sideName}_${z}_${i}`,
          [0.022, 0.013, 0.022],
          [side * 0.43, station(z, side * 0.61).y - 0.02, z - 0.07 + i * 0.07],
          0.004,
          black,
          wall,
        );
    }
  }
  function passengerSeat(
    name: string,
    x: number,
    z: number,
    rearFacing: boolean,
  ) {
    const seat = group(name, seats, [x, floorY, z]);
    seat.rotation.y = rearFacing ? Math.PI : 0;
    seat.userData = {
      role: "passenger-seat",
      direction: rearFacing ? "+Z" : "-Z",
      cushionWidth: 0.43,
      overallWidth: 0.54,
    };
    const pedestal = rounded(
      "Pedestal",
      [0.31, 0.37, 0.37],
      [0, 0.18, 0.015],
      0.035,
      metal,
      seat,
    );
    // The narrow mounting foot reaches the floor; the wider upper pedestal
    // follows the available fuselage width rather than projecting through it.
    const mount = pedestal.geometry.getAttribute("position");
    for (let i = 0; i < mount.count; i++) {
      const height = mount.getY(i) + 0.185;
      mount.setX(
        i,
        mount.getX(i) *
          T.MathUtils.lerp(
            0.12 / 0.31,
            1,
            T.MathUtils.smoothstep(height, 0, 0.16),
          ),
      );
    }
    pedestal.geometry.computeVertexNormals();
    rounded(
      "Seat_base",
      [0.44, 0.13, 0.55],
      [0, 0.38, -0.005],
      0.045,
      darkLeather,
      seat,
    );
    rounded(
      "Seat_cushion",
      [0.43, 0.14, 0.51],
      [0, 0.485, -0.025],
      0.055,
      leather,
      seat,
    );
    rounded(
      "Cushion_insert",
      [0.337, 0.032, 0.37],
      [0, 0.558, -0.035],
      0.012,
      insert,
      seat,
    );
    const back = group("Reclined_backrest", seat, [0, 0.72, 0.215]);
    back.rotation.x = 0.09;
    rounded(
      "Backrest_shell",
      [0.445, 0.63, 0.14],
      [0, 0.125, 0],
      0.055,
      leather,
      back,
    );
    rounded(
      "Backrest_insert",
      [0.34, 0.47, 0.04],
      [0, 0.1, -0.076],
      0.017,
      insert,
      back,
    );
    rounded(
      "Headrest",
      [0.32, 0.2, 0.16],
      [0, 0.47, 0.016],
      0.06,
      leather,
      back,
    );
    for (const side of [-1, 1]) {
      rounded(
        `Armrest_${side}`,
        [0.07, 0.085, 0.4],
        [side * 0.235, 0.66, -0.015],
        0.028,
        leather,
        seat,
      );
      rod(
        `Armrest_support_${side}`,
        [side * 0.23, 0.4, 0.11],
        [side * 0.23, 0.64, 0.11],
        0.012,
        metal,
        seat,
      );
      line(
        `Cushion_stitch_${side}`,
        [
          new T.Vector3(side * 0.17, 0.557, -0.2),
          new T.Vector3(side * 0.17, 0.56, 0.14),
        ],
        0.0016,
        seam,
        seat,
      );
      const belt = rounded(
        `Lap_belt_${side}`,
        [0.16, 0.012, 0.03],
        [side * 0.095, 0.569, 0.075],
        0.004,
        darkLeather,
        seat,
      );
      belt.rotation.y = side * 0.25;
    }
    rounded(
      "Belt_buckle",
      [0.035, 0.014, 0.038],
      [0, 0.579, 0.075],
      0.005,
      metal,
      seat,
    );
    return seat;
  }
  for (const side of [-1, 1]) {
    const sideName = side < 0 ? "Left" : "Right";
    passengerSeat(
      `Passenger_seat_club_forward_${sideName}`,
      side * 0.42,
      -2.22,
      true,
    );
    passengerSeat(
      `Passenger_seat_club_aft_${sideName}`,
      side * 0.42,
      -0.55,
      false,
    );
    passengerSeat(`Passenger_seat_aft_${sideName}`, side * 0.42, 1.02, false);
    // Flush stowed tables remain in their sidewall pockets and do not block the aisle.
    const table = group(`Stowed_table_${sideName}`, cabin, [
      side * 0.714,
      1.97,
      -1.38,
    ]);
    rounded(
      "Folded_table_leaf",
      [0.024, 0.32, 0.59],
      [0, 0, 0],
      0.01,
      walnut,
      table,
    );
    table.userData = { role: "stowed-table", estimated: true };
    rounded(
      "Table_latch",
      [0.016, 0.025, 0.07],
      [-side * 0.02, 0.1, 0],
      0.005,
      metal,
      table,
    );
  }
  const refreshment = group("Forward_refreshment_center", cabin);
  rounded(
    "Refreshment_cabinet",
    [0.32, 0.54, 0.43],
    [0.51, 1.78, -3.09],
    0.035,
    walnut,
    refreshment,
  );
  rounded(
    "Refreshment_counter",
    [0.35, 0.035, 0.46],
    [0.51, 2.06, -3.09],
    0.015,
    metal,
    refreshment,
  );
  for (const z of [-3.19, -2.99])
    rounded(
      `Cabinet_pull_${z}`,
      [0.12, 0.014, 0.012],
      [0.51, 1.89, z],
      0.004,
      metal,
      refreshment,
    );
  const locker = group("Forward_locker", cabin);
  rounded(
    "Locker_cabinet",
    [0.24, 0.59, 0.38],
    [-0.55, 1.8, -3.1],
    0.03,
    walnut,
    locker,
  );
  rounded(
    "Locker_pull",
    [0.012, 0.12, 0.014],
    [-0.423, 1.9, -3.1],
    0.004,
    metal,
    locker,
  );
  const lav = group("Aft_lavatory", cabin);
  function fittedBulkhead(name: string, z: number, doorway = false) {
    const halfFloor = floorHalfWidth(z);
    const contour = [new T.Vector2(-halfFloor, floorY - 0.008)];
    for (let i = 0; i <= 80; i++) {
      const p = station(z, T.MathUtils.lerp(-2.25, 2.25, i / 80));
      contour.push(new T.Vector2(p.x, p.y));
    }
    contour.push(new T.Vector2(halfFloor, floorY - 0.008));
    if (doorway)
      contour.push(
        new T.Vector2(0.235, floorY - 0.008),
        new T.Vector2(0.235, floorY + 1.25),
        new T.Vector2(-0.235, floorY + 1.25),
        new T.Vector2(-0.235, floorY - 0.008),
      );
    const geometry = new T.ExtrudeGeometry(new T.Shape(contour), {
      depth: 0.045,
      bevelEnabled: false,
      steps: 1,
    });
    geometry.translate(0, 0, z - 0.0225);
    return mesh(name, geometry, lining, lav);
  }
  fittedBulkhead("Lavatory_bulkhead_frame", 1.89, true);
  rounded(
    "Toilet_base",
    [0.28, 0.29, 0.39],
    [-0.32, 1.485, 2.4],
    0.065,
    lining,
    lav,
  );
  rounded(
    "Closed_toilet_lid",
    [0.3, 0.055, 0.4],
    [-0.32, 1.66, 2.4],
    0.025,
    leather,
    lav,
  );
  rounded("Vanity", [0.27, 0.44, 0.4], [0.36, 1.68, 2.42], 0.025, walnut, lav);
  rounded(
    "Vanity_counter",
    [0.29, 0.035, 0.43],
    [0.36, 1.9, 2.42],
    0.015,
    metal,
    lav,
  );
  fittedBulkhead("Baggage_separation", 2.86);
  // The viewer binds demonstration avionics to these mounted glass surfaces.
  // A narrow opening is reserved under the centre-console gear tunnel.
  floor("Cockpit_floor", flightDeck.floorFrontZ, -3.99, cockpit, true);
  for (const side of [-1, 1]) {
    const pilot = group(`Pilot_seat_${side < 0 ? "Left" : "Right"}`, cockpit, [
      side * flightDeck.seatX,
      1.47,
      flightDeck.seatZ,
    ]);
    pilot.userData = { role: "pilot-seat", direction: "-Z" };
    rounded(
      "Pilot_pedestal",
      [0.25, 0.24, 0.32],
      [0, 0.11, 0],
      0.025,
      metal,
      pilot,
    );
    rounded(
      "Pilot_cushion",
      [0.37, 0.13, 0.4],
      [0, 0.29, -0.055],
      0.045,
      darkLeather,
      pilot,
    );
    const back = rounded(
      "Pilot_backrest",
      [0.36, 0.55, 0.12],
      [0, 0.59, 0.17],
      0.045,
      darkLeather,
      pilot,
    );
    back.rotation.x = 0.08;
    rounded(
      "Pilot_headrest",
      [0.25, 0.17, 0.13],
      [0, 0.91, 0.19],
      0.045,
      darkLeather,
      pilot,
    );
    for (const arm of [-1, 1])
      rounded(
        `Pilot_armrest_${arm}`,
        [0.045, 0.055, 0.27],
        [arm * 0.192, 0.45, 0],
        0.018,
        darkLeather,
        pilot,
      );
    // Yokes, not sidesticks: the real Phenom flight deck uses conventional paired controls.
    const yoke = group(`Yoke_${side < 0 ? "Left" : "Right"}`, cockpit, [
      side * flightDeck.seatX,
      1.96,
      flightDeck.yokeZ,
    ]);
    rod(
      "Yoke_column",
      [0, floorY - yoke.position.y - 0.002, 0.1],
      [0, 0, 0],
      0.022,
      black,
      yoke,
    );
    rounded(
      "Yoke_floor_bearing",
      [0.1, 0.035, 0.1],
      [0, floorY - yoke.position.y + 0.01, 0.1],
      0.008,
      black,
      yoke,
    );
    line(
      "Yoke_grip",
      [
        new T.Vector3(-0.115, 0.045, 0),
        new T.Vector3(-0.11, -0.025, 0),
        new T.Vector3(0, -0.065, 0),
        new T.Vector3(0.11, -0.025, 0),
        new T.Vector3(0.115, 0.045, 0),
      ],
      0.014,
      black,
      yoke,
    );
    for (const pedal of [-1, 1]) {
      const p = rounded(
        `Rudder_pedal_${side}_${pedal}`,
        [0.09, 0.12, 0.024],
        [
          side * flightDeck.pedalX + pedal * flightDeck.pedalSpacing,
          1.59,
          flightDeck.pedalZ,
        ],
        0.012,
        metal,
        cockpit,
      );
      p.rotation.x = -0.28;
    }
  }
  const { panelY, panelZ, panelTilt } = flightDeck;
  const panel = group("Instrument_panel", cockpit, [0, panelY, panelZ]);
  panel.rotation.x = panelTilt;
  cockpit.add(makeAureliaDashboardHousing(airframeScale, black));
  rounded(
    "Instrument_panel_structure",
    [1.06, 0.34, 0.09],
    [0, 0, 0],
    0.035,
    black,
    panel,
  );
  rounded(
    "Glare_shield",
    [1.09, 0.045, 0.2],
    [0, 0.18, 0.015],
    0.02,
    black,
    panel,
  );
  for (let i = 0; i < 3; i++) {
    const g = group(`Display_placeholder_${i + 1}`, panel, [
      (i - 1) * 0.34,
      0,
      0.054,
    ]);
    g.userData = {
      avionicsDisplay: i === 1 ? "mfd" : "pfd",
      purpose: i === 1 ? "Multifunction display" : "Primary flight display",
    };
    rounded(
      "Display_bezel",
      [0.322, 0.218, 0.025],
      [0, 0, 0],
      0.012,
      darkLeather,
      g,
    );
    rounded(
      "Inactive_screen",
      [0.286, 0.18, 0.006],
      [0, 0, 0.014],
      0.003,
      screen,
      g,
    );
  }
  const pedestal = group("Centre_pedestal", cockpit);
  const console = rounded(
    "Centre_console",
    [0.245, 0.3, 0.9],
    [0, 1.61, -5.06],
    0.025,
    black,
    pedestal,
  );
  // Open-bottom console shroud around the reserved gear tunnel. A solid box
  // would put its bottom and forward faces through the retracted strut.
  const consolePositions = console.geometry.getAttribute("position");
  const consoleIndex = console.geometry.index!;
  const consoleFaces: number[] = [];
  for (let i = 0; i < consoleIndex.count; i += 3) {
    const vertices = [0, 1, 2].map((j) =>
      new T.Vector3().fromBufferAttribute(
        consolePositions,
        consoleIndex.getX(i + j),
      ),
    );
    const normal = vertices[1]
      .clone()
      .sub(vertices[0])
      .cross(vertices[2].clone().sub(vertices[0]))
      .normalize();
    if (normal.y < -0.2 || normal.z < -0.2) continue;
    consoleFaces.push(
      consoleIndex.getX(i),
      consoleIndex.getX(i + 1),
      consoleIndex.getX(i + 2),
    );
  }
  console.geometry.setIndex(consoleFaces);
  for (const side of [-1, 1]) {
    const touch = rounded(
      `Touch_controller_placeholder_${side}`,
      [0.1, 0.015, 0.13],
      [side * 0.16, 1.91, -5.21],
      0.006,
      screen,
      pedestal,
    );
    touch.rotation.x = 0.55;
    rod(
      `Thrust_lever_${side}`,
      [side * 0.034, 1.77, -4.98],
      [side * 0.034, 1.88, -5.02],
      0.009,
      metal,
      pedestal,
    );
    rounded(
      `Thrust_grip_${side}`,
      [0.04, 0.035, 0.055],
      [side * 0.034, 1.88, -5.02],
      0.012,
      black,
      pedestal,
    );
  }
  detailAureliaCockpit(cockpit, panel, pedestal, {
    rounded,
    rod,
    black,
    metal,
  });
  // Preserve floor-relative furniture heights when raising the cabin datum.
  for (const name of [
    "Forward_refreshment_center",
    "Forward_locker",
    "Stowed_table_Left",
    "Stowed_table_Right",
    "Toilet_base",
    "Closed_toilet_lid",
    "Vanity",
    "Vanity_counter",
  ])
    root.getObjectByName(name)!.position.y += cabinShift;
  root.updateMatrixWorld(true);
  for (const name of [
    "Refreshment_cabinet",
    "Locker_cabinet",
    "Vanity",
    "Toilet_base",
  ]) {
    const furniture = root.getObjectByName(name)!;
    const bounds = new T.Box3().setFromObject(furniture);
    const size = bounds.getSize(new T.Vector3());
    const centre = bounds.getCenter(new T.Vector3());
    const bottom = floorY - 0.008,
      top = bounds.min.y + 0.008;
    const geometry = new T.BoxGeometry(size.x, top - bottom, size.z, 4, 4, 4);
    geometry.translate(centre.x, (top + bottom) / 2, centre.z);
    const p = geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const limit = floorHalfWidth(p.getZ(i)) - 0.005;
      const footX = T.MathUtils.clamp(p.getX(i), -limit, limit);
      p.setX(
        i,
        T.MathUtils.lerp(
          footX,
          p.getX(i),
          (p.getY(i) - bottom) / (top - bottom),
        ),
      );
    }
    geometry.computeVertexNormals();
    geometry.applyMatrix4(furniture.parent!.matrixWorld.clone().invert());
    mesh(
      `${name}_floor_plinth`,
      geometry,
      name === "Toilet_base" ? lining : walnut,
      furniture.parent!,
    );
  }
  // Fixed mounting material is separate from the walking floor and moving controls.
  // Fit each outer edge to its actual lining rather than a guessed cabin width.
  function sideBracket(
    name: string,
    side: number,
    innerX: number,
    y: number,
    height: number,
    z: number,
    depth: number,
    insetX: number,
    insetY: number,
    material: T.Material,
    parent: T.Object3D,
  ) {
    const geometry = new T.BoxGeometry(1, height, depth, 1, 2, 2);
    const p = geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const py = y + p.getY(i),
        pz = z + p.getZ(i);
      const [rx, ry, cy] = hullAt(pz);
      const edge =
        (rx - insetX) *
          Math.sqrt(Math.max(0, 1 - ((py - cy) / (ry - insetY)) ** 2)) +
        0.003;
      p.setXYZ(
        i,
        side * T.MathUtils.lerp(innerX, edge, p.getX(i) + 0.5),
        py,
        pz,
      );
    }
    if (side < 0) {
      const index = geometry.index!;
      for (let i = 0; i < index.count; i += 3) {
        const b = index.getX(i + 1);
        index.setX(i + 1, index.getX(i + 2));
        index.setX(i + 2, b);
      }
    }
    geometry.computeVertexNormals();
    return mesh(name, geometry, material, parent);
  }
  for (const side of [-1, 1]) {
    const label = side < 0 ? "Left" : "Right";
    for (const pedal of [-1, 1]) {
      const x = side * flightDeck.pedalX + pedal * flightDeck.pedalSpacing;
      rounded(
        `Rudder_pedal_mount_${side}_${pedal}`,
        [0.055, 0.025, 0.08],
        [x, floorY + 0.01, flightDeck.pedalZ - 0.01],
        0.005,
        black,
        cockpit,
      );
      rod(
        `Rudder_pedal_link_${side}_${pedal}`,
        [x, floorY + 0.018, flightDeck.pedalZ - 0.025],
        [x, 1.56, flightDeck.pedalZ + 0.009],
        0.012,
        metal,
        cockpit,
      );
    }
    // The angled controller sits in a cantilevered console housing. Its lower
    // footprint remains on the console roof, clear of the centre gear tunnel.
    const touch = pedestal.getObjectByName(
      `Touch_controller_placeholder_${side}`,
    )!;
    const corners = [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ] as const;
    const points = corners.map(
      ([x, z]) =>
        new T.Vector3(side * 0.075 + x * 0.04, 1.75, -5.21 + z * 0.06),
    );
    points.push(
      ...corners.map(([x, z]) =>
        new T.Vector3(x * 0.048, -0.005, z * 0.063)
          .applyEuler(touch.rotation)
          .add(touch.position),
      ),
    );
    const faces = [0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6];
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      faces.push(i, i + 4, j, j, i + 4, j + 4);
    }
    surface(`Touch_controller_housing_${side}`, points, faces, black, pedestal);
    rounded(
      `Thrust_lever_pivot_${side}`,
      [0.05, 0.035, 0.055],
      [side * 0.034, 1.762, -4.98],
      0.006,
      black,
      pedestal,
    );
    const table = cabin.getObjectByName(`Stowed_table_${label}`)!;
    for (const dz of [-0.16, 0.16])
      sideBracket(
        `Table_liner_mount_${label}_${dz}`,
        side,
        0.716,
        table.position.y,
        0.065,
        table.position.z + dz,
        0.055,
        0.125,
        linerInsetY,
        metal,
        cabin,
      );
  }
  for (const y of [1.86, 1.94])
    rod(
      `Locker_pull_standoff_${y}`,
      [-0.432, y, -3.1],
      [-0.421, y, -3.1],
      0.004,
      metal,
      locker,
    );
  for (const dx of [-0.075, 0.075])
    for (const dz of [-0.11, 0.11])
      rounded(
        `Toilet_seat_buffer_${dx}_${dz}`,
        [0.035, 0.012, 0.035],
        [-0.32 + dx, 1.63 + cabinShift, 2.4 + dz],
        0.004,
        lining,
        lav,
      );
  rod(
    "Toilet_lid_hinge",
    [-0.43, 1.635 + cabinShift, 2.55],
    [-0.21, 1.635 + cabinShift, 2.55],
    0.009,
    metal,
    lav,
  );
  // Base-side leaves carry the hinge pin into the toilet shell. The seat
  // buffers carry the closed lid; they are not a substitute for its hinge.
  for (const dx of [-0.075, 0.075])
    rod(
      `Toilet_hinge_base_leaf_${dx}`,
      [-0.32 + dx, 1.615 + cabinShift, 2.535],
      [-0.32 + dx, 1.635 + cabinShift, 2.55],
      0.009,
      metal,
      lav,
    );
  // Mount the existing pulls on the visible inboard cabinet face; the original
  // coordinates buried them entirely inside the solid cabinet.
  for (const z of [-3.19, -2.99]) {
    const pull = refreshment.getObjectByName(`Cabinet_pull_${z}`)!;
    pull.position.x = 0.334;
    pull.rotation.y = Math.PI / 2;
    for (const dz of [-0.04, 0.04])
      rod(
        `Cabinet_pull_standoff_${z}_${dz}`,
        [0.355, 1.89, z + dz],
        [0.333, 1.89, z + dz],
        0.0045,
        metal,
        refreshment,
      );
  }
  // The parent supplies the envelope scale. Counter-scale complete fittings
  // around their mounts so dimensions and internal contacts stay unchanged.
  if (airframeScale !== 1) {
    root.updateMatrixWorld(true);
    function preserve(object: T.Object3D, anchor: T.Vector3) {
      const parent = object.parent!;
      const mount = group(`${object.name}_mount`, parent);
      mount.position.copy(parent.worldToLocal(anchor.clone()));
      mount.updateMatrixWorld(true);
      mount.attach(object);
      mount.scale.setScalar(1 / airframeScale);
      mount.userData.preservedFitting = true;
    }
    function floorAnchor(object: T.Object3D) {
      const anchor = object.getWorldPosition(new T.Vector3());
      anchor.y = floorY;
      return anchor;
    }
    for (const seat of seats.children.slice())
      preserve(seat, floorAnchor(seat));
    for (const label of ["Left", "Right"]) {
      for (const name of [`Pilot_seat_${label}`, `Yoke_${label}`]) {
        const object = root.getObjectByName(name)!;
        preserve(object, floorAnchor(object));
      }
      const table = root.getObjectByName(`Stowed_table_${label}`)!;
      preserve(table, table.getWorldPosition(new T.Vector3()));
      const wall = root.getObjectByName(`Cabin_liner_${label}`)!;
      for (const z of [-1.35, 0.5]) {
        const control = root.getObjectByName(
          `Upper_control_panel_${label}_${z}`,
        )!;
        const controls = group(`Cabin_controls_${label}_${z}`, wall);
        controls.attach(control);
        for (let i = 0; i < 3; i++)
          controls.attach(
            root.getObjectByName(`Control_key_${label}_${z}_${i}`)!,
          );
        preserve(controls, control.getWorldPosition(new T.Vector3()));
      }
    }
    for (const object of [refreshment, locker, pedestal]) {
      const anchor = new T.Box3()
        .setFromObject(object)
        .getCenter(new T.Vector3());
      anchor.y = floorY;
      preserve(object, anchor);
    }
    preserve(panel, panel.getWorldPosition(new T.Vector3()));
    const lavatoryFittings = group("Lavatory_fittings", lav);
    for (const child of lav.children.slice())
      if (
        child !== lavatoryFittings &&
        !/bulkhead|separation/i.test(child.name)
      )
        lavatoryFittings.attach(child);
    preserve(lavatoryFittings, new T.Vector3(0, floorY, 2.4));
    for (const side of [-1, 1])
      for (const pedal of [-1, 1]) {
        const assembly = group(`Pedal_assembly_${side}_${pedal}`, cockpit);
        for (const name of [
          "Rudder_pedal",
          "Rudder_pedal_mount",
          "Rudder_pedal_link",
        ])
          assembly.attach(root.getObjectByName(`${name}_${side}_${pedal}`)!);
        preserve(
          assembly,
          new T.Vector3(
            side * flightDeck.pedalX + pedal * flightDeck.pedalSpacing,
            floorY,
            flightDeck.pedalZ,
          ),
        );
      }
    root.userData.floorY = floorY * airframeScale;
    root.userData.cabinWidth = 1.55 * airframeScale;
    root.userData.cabinHeight = layout.cabinHeight * airframeScale;
  }
  // Move the complete preserved pedestal with the seats and panel. Its original
  // dimensions and internal contacts remain intact as the nose well moves forward.
  pedestal.position.z -= flightDeck.controlsShift * airframeScale;
  cockpit.add(
    makeAureliaCockpitPartition({
      lining,
      metal,
    }),
  );
  root.updateMatrixWorld(true);
  return root;
}
