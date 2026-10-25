import * as T from "three";
import {
  aureliaBodyAt,
  aureliaFloorHalfWidth,
  aureliaInteriorLayout,
} from "./exterior-reference";

/** Nominal metres. The partition follows the airframe; the walking datum stays unchanged. */
export const aureliaCockpitPartition = {
  z: -4.45,
  thickness: 0.05,
  openingWidth: 0.52,
  openingHeight: 1.28,
  floorClearance: 0.006,
  edgeClearance: 0.004,
  cornerRadius: 0.085,
  openAngle: -Math.PI / 2,
  latchRelease: 0.1,
} as const;

/** Release the paddle and latch before moving the door; reverse scrubbing closes before relatching. */
export function aureliaCockpitDoorTravel(amount: number) {
  const value = T.MathUtils.clamp(amount, 0, 1);
  const release = T.MathUtils.smoothstep(
    value,
    0,
    aureliaCockpitPartition.latchRelease,
  );
  return {
    release,
    angle:
      aureliaCockpitPartition.openAngle *
      T.MathUtils.clamp(
        (value - aureliaCockpitPartition.latchRelease) /
          (1 - aureliaCockpitPartition.latchRelease),
        0,
        1,
      ),
  };
}

export function poseAureliaCockpitDoor(root: T.Object3D, amount: number) {
  const travel = aureliaCockpitDoorTravel(amount);
  const hinge = root.getObjectByName("Cockpit_door_hinge");
  if (!hinge) return;
  hinge.rotation.y = travel.angle;
  for (const side of [-1, 1]) {
    const paddle = root.getObjectByName(`Cockpit_latch_paddle_${side}`);
    if (paddle) paddle.rotation.x = side * travel.release * 0.38;
  }
  const bolt = root.getObjectByName("Cockpit_latch_bolt");
  if (bolt) bolt.position.x = -0.516 + travel.release * 0.014;
}

/** A visual privacy partition, not a certified flight-deck security door. */
export function makeAureliaCockpitPartition(materials: {
  lining: T.Material;
  metal: T.Material;
}) {
  const p = aureliaCockpitPartition;
  const floor = aureliaInteriorLayout.floorY;
  const half = p.openingWidth / 2;
  const aluminium = new T.MeshStandardMaterial({
    name: "Cockpit door satin aluminium",
    color: "#96a2a8",
    roughness: 0.64,
    metalness: 0.68,
  });
  const recess = new T.MeshStandardMaterial({
    name: "Cockpit door recessed latch pocket",
    color: "#303b42",
    roughness: 0.62,
    metalness: 0.5,
  });
  const frameFinish = new T.MeshStandardMaterial({
    name: "Cockpit door anodized frame",
    color: "#69777e",
    roughness: 0.58,
    metalness: 0.68,
  });
  const gasket = new T.MeshStandardMaterial({
    name: "Cockpit door elastomer gasket",
    color: "#242b2d",
    roughness: 0.96,
  });
  const root = new T.Group();
  root.name = "Cockpit_partition";
  root.userData = {
    role: "cockpit-partition",
    estimated: true,
    ...p,
    references: [
      "https://www.safran-group.com/products-services/reinforced-cockpit-doors",
      "https://nasisystems.com/flight-deck.html",
    ],
    reconstruction:
      "Custom Aurelia interior door. Flush paddle and lower panel follow Safran product imagery; inspection port and exposed hinge fittings follow NASI installed-door imagery. Dimensions are fitted to this cabin, not OEM engineering data.",
  };
  const add = (
    name: string,
    geometry: T.BufferGeometry,
    material: T.Material,
    parent: T.Object3D = root,
  ) => {
    if (!geometry.index)
      geometry.setIndex(
        Array.from(
          { length: geometry.getAttribute("position").count },
          (_, i) => i,
        ),
      );
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  };
  const upperEdge = (w: number, top: number, radius: number) => {
    const points: T.Vector2[] = [];
    for (const side of [1, -1])
      for (let i = 0; i <= 12; i++) {
        const angle = (side === 1 ? 0 : Math.PI / 2) + ((i / 12) * Math.PI) / 2;
        points.push(
          new T.Vector2(
            side * (w - radius) + radius * Math.cos(angle),
            top - radius + radius * Math.sin(angle),
          ),
        );
      }
    return points;
  };
  const extrude = (points: T.Vector2[], depth: number) =>
    new T.ExtrudeGeometry(new T.Shape(points), {
      depth,
      bevelEnabled: false,
      steps: 1,
    });
  const box = (
    name: string,
    size: [number, number, number],
    at: [number, number, number],
    material: T.Material,
    parent: T.Object3D = root,
  ) => {
    const mesh = add(name, new T.BoxGeometry(...size), material, parent);
    mesh.position.fromArray(at);
    return mesh;
  };
  const rectangle = (
    x: number,
    y: number,
    width: number,
    height: number,
    radius: number,
  ) => {
    const shape = new T.Shape();
    const left = x - width / 2,
      right = x + width / 2,
      bottom = y - height / 2,
      top = y + height / 2;
    shape.moveTo(left + radius, bottom);
    shape.lineTo(right - radius, bottom);
    shape.quadraticCurveTo(right, bottom, right, bottom + radius);
    shape.lineTo(right, top - radius);
    shape.quadraticCurveTo(right, top, right - radius, top);
    shape.lineTo(left + radius, top);
    shape.quadraticCurveTo(left, top, left, top - radius);
    shape.lineTo(left, bottom + radius);
    shape.quadraticCurveTo(left, bottom, left + radius, bottom);
    return shape;
  };
  const profile = (shape: T.Shape, depth: number, z: number) =>
    new T.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: false,
      steps: 1,
      curveSegments: 8,
    }).translate(0, 0, z);
  const ring = (
    x: number,
    y: number,
    width: number,
    height: number,
    border: number,
    radius: number,
  ) => {
    const shape = rectangle(x, y, width, height, radius);
    shape.holes.push(
      rectangle(
        x,
        y,
        width - border * 2,
        height - border * 2,
        Math.max(0.001, radius - border),
      ),
    );
    return shape;
  };
  // The edge embeds into the inset forward liner, while staying inside the skin.
  // Extend the jambs below the carpet surface; there is no raised threshold.
  const [rx, ry, cy] = aureliaBodyAt(p.z);
  const angle = Math.acos((floor - 0.005 - cy) / (ry - 0.009));
  const contour = [new T.Vector2(-aureliaFloorHalfWidth(p.z), floor - 0.008)];
  for (let i = 0; i <= 96; i++) {
    const a = T.MathUtils.lerp(-angle, angle, i / 96);
    contour.push(
      new T.Vector2(
        (rx - 0.009) * Math.sin(a),
        cy + (ry - 0.009) * Math.cos(a),
      ),
    );
  }
  contour.push(
    new T.Vector2(aureliaFloorHalfWidth(p.z), floor - 0.008),
    new T.Vector2(half, floor - 0.008),
    ...upperEdge(half, floor + p.openingHeight, p.cornerRadius),
    new T.Vector2(-half, floor - 0.008),
  );
  const wall = new T.ExtrudeGeometry(new T.Shape(contour), {
    depth: p.thickness,
    bevelEnabled: false,
    steps: 1,
  }).translate(0, 0, p.z - p.thickness / 2);
  add("Cockpit_partition_wall", wall, materials.lining);
  const frame = [
    new T.Vector2(half + 0.018, floor - 0.008),
    ...upperEdge(
      half + 0.018,
      floor + p.openingHeight + 0.018,
      p.cornerRadius + 0.018,
    ),
    new T.Vector2(-half - 0.018, floor - 0.008),
    new T.Vector2(-half, floor - 0.008),
    ...upperEdge(half, floor + p.openingHeight, p.cornerRadius).reverse(),
    new T.Vector2(half, floor - 0.008),
  ];
  add(
    "Cockpit_door_frame",
    extrude(frame, p.thickness + 0.008).translate(
      0,
      0,
      p.z - p.thickness / 2 - 0.004,
    ),
    frameFinish,
  );
  // A rebated stop carries the seal behind the closing face, leaving the floor flush.
  const seal = [
    new T.Vector2(half + 0.004, floor - 0.005),
    ...upperEdge(
      half + 0.004,
      floor + p.openingHeight + 0.004,
      p.cornerRadius + 0.004,
    ),
    new T.Vector2(-half - 0.004, floor - 0.005),
    new T.Vector2(-half + 0.008, floor - 0.005),
    ...upperEdge(
      half - 0.008,
      floor + p.openingHeight - 0.008,
      p.cornerRadius - 0.008,
    ).reverse(),
    new T.Vector2(half - 0.008, floor - 0.005),
  ];
  add(
    "Cockpit_door_gasket",
    extrude(seal, 0.004).translate(0, 0, p.z + 0.0155),
    gasket,
  );
  const hinge = new T.Group();
  hinge.name = "Cockpit_door_hinge";
  hinge.position.set(half, floor, p.z - 0.04);
  hinge.userData = { hingeAxis: [0, 1, 0], openAngle: p.openAngle };
  root.add(hinge);
  const width = p.openingWidth - 2 * p.edgeClearance;
  const pocketX = -width + 0.105;
  const port = { x: -half, y: 1.015, radius: 0.0125 };
  const panel = { x: -half, y: 0.245, width: 0.386, height: 0.32 };
  const leafShape = (inset = 0) => {
    const right = half - p.edgeClearance - inset;
    const bottom = p.floorClearance + inset;
    const top = p.openingHeight - p.edgeClearance - inset;
    const radius = p.cornerRadius - p.edgeClearance - inset;
    const points = [
      new T.Vector2(right, bottom),
      ...upperEdge(right, top, radius),
      new T.Vector2(-right, bottom),
    ];
    const shape = new T.Shape(
      points.map((point) => point.add(new T.Vector2(-half, 0))),
    );
    const sight = new T.Path();
    sight.absarc(port.x, port.y, port.radius, 0, Math.PI * 2, true);
    shape.holes.push(
      rectangle(pocketX, 0.69, 0.086, 0.112, 0.009),
      rectangle(panel.x, panel.y, panel.width, panel.height, 0.012),
      sight,
    );
    return shape;
  };
  const leafGeometry = (depth: number, z: number, inset = 0) =>
    new T.ExtrudeGeometry(leafShape(inset), {
      depth,
      bevelEnabled: false,
      steps: 1,
    }).translate(0, 0, z);
  add("Cockpit_door_leaf", leafGeometry(0.032, 0.024), materials.metal, hinge);
  add(
    "Cockpit_door_flightdeck_face",
    leafGeometry(0.0015, 0.023, 0.012),
    aluminium,
    hinge,
  );
  add(
    "Cockpit_door_passenger_face",
    leafGeometry(0.0015, 0.0555, 0.012),
    aluminium,
    hinge,
  );
  box(
    "Cockpit_latch_recess",
    [0.09, 0.116, 0.014],
    [pocketX, 0.69, 0.04],
    recess,
    hinge,
  );
  add(
    "Cockpit_lower_panel_mount",
    profile(
      ring(
        panel.x,
        panel.y,
        panel.width + 0.012,
        panel.height + 0.012,
        0.015,
        0.015,
      ),
      0.012,
      0.032,
    ),
    frameFinish,
    hinge,
  );
  add(
    "Cockpit_lower_panel",
    profile(
      rectangle(
        panel.x,
        panel.y,
        panel.width - 0.004,
        panel.height - 0.004,
        0.01,
      ),
      0.03,
      0.025,
    ),
    aluminium,
    hinge,
  );
  for (const side of [-1, 1])
    add(
      `Cockpit_lower_panel_gasket_${side}`,
      profile(
        ring(
          panel.x,
          panel.y,
          panel.width + 0.002,
          panel.height + 0.002,
          0.004,
          0.013,
        ),
        0.002,
        side > 0 ? 0.0545 : 0.0235,
      ),
      gasket,
      hinge,
    );
  // The inspection barrel and lenses occupy a genuine bore through both door skins.
  const barrel = new T.Shape();
  barrel.absarc(port.x, port.y, 0.014, 0, Math.PI * 2, false);
  const bore = new T.Path();
  bore.absarc(port.x, port.y, 0.0095, 0, Math.PI * 2, true);
  barrel.holes.push(bore);
  add(
    "Cockpit_inspection_port_barrel",
    profile(barrel, 0.038, 0.021),
    materials.metal,
    hinge,
  );
  const glass = new T.MeshStandardMaterial({
    name: "Cockpit inspection optics",
    color: "#182e38",
    roughness: 0.18,
    metalness: 0.15,
    transparent: true,
    opacity: 0.78,
    side: T.DoubleSide,
  });
  for (const side of [-1, 1]) {
    const lens = add(
      `Cockpit_inspection_lens_${side}`,
      new T.CircleGeometry(0.01, 24),
      glass,
      hinge,
    );
    lens.position.set(port.x, port.y, 0.04 + side * 0.019);
    const bezel = add(
      `Cockpit_inspection_bezel_${side}`,
      new T.TorusGeometry(0.0115, 0.0025, 8, 24),
      frameFinish,
      hinge,
    );
    bezel.position.copy(lens.position);
  }
  const screw = (name: string, x: number, y: number, z: number) => {
    const head = add(
      name,
      new T.CylinderGeometry(0.003, 0.002, 0.003, 12),
      materials.metal,
      hinge,
    );
    head.rotation.x = Math.PI / 2;
    head.position.set(x, y, z);
    return head;
  };
  for (const side of [-1, 1])
    for (const dx of [-1, 1])
      for (const dy of [-1, 1])
        screw(
          `Cockpit_panel_fastener_${side}_${dx}_${dy}`,
          panel.x + dx * (panel.width / 2 - 0.014),
          panel.y + dy * (panel.height / 2 - 0.014),
          0.04 + side * 0.015,
        );
  for (const [i, y] of [0.18, 0.64, 1.1].entries()) {
    box(
      `Cockpit_hinge_frame_leaf_${i}`,
      [0.048, 0.065, 0.014],
      [half + 0.022, floor + y, p.z - 0.029],
      materials.metal,
    );
    const pin = add(
      `Cockpit_hinge_pin_${i}`,
      new T.CylinderGeometry(0.0105, 0.0105, 0.08, 16),
      materials.metal,
    );
    pin.position.set(half, floor + y, p.z - 0.04);
    const knuckle = add(
      `Cockpit_hinge_knuckle_${i}`,
      new T.CylinderGeometry(0.014, 0.014, 0.06, 16),
      materials.metal,
      hinge,
    );
    knuckle.position.set(0, y, 0);
    box(
      `Cockpit_hinge_door_leaf_${i}`,
      [0.058, 0.045, 0.02],
      [-0.024, y, 0.019],
      materials.metal,
      hinge,
    );
  }
  for (const side of [-1, 1]) {
    add(
      `Cockpit_handle_mount_${side}`,
      profile(
        ring(pocketX, 0.69, 0.096, 0.126, 0.011, 0.012),
        0.004,
        side > 0 ? 0.054 : 0.022,
      ),
      materials.metal,
      hinge,
    );
    const z = 0.04 + side * 0.0135;
    const pin = add(
      `Cockpit_latch_pivot_${side}`,
      new T.CylinderGeometry(0.0045, 0.0045, 0.077, 16),
      materials.metal,
      hinge,
    );
    pin.rotation.z = Math.PI / 2;
    pin.position.set(pocketX, 0.653, z);
    const paddle = new T.Group();
    paddle.name = `Cockpit_latch_paddle_${side}`;
    paddle.position.copy(pin.position);
    hinge.add(paddle);
    add(
      `Cockpit_handle_${side}`,
      profile(rectangle(0, 0.035, 0.063, 0.075, 0.006), 0.004, -0.002),
      aluminium,
      paddle,
    );
    for (const dy of [-1, 1])
      screw(
        `Cockpit_latch_fastener_${side}_${dy}`,
        pocketX,
        0.69 + dy * 0.055,
        side > 0 ? 0.058 : 0.022,
      );
  }
  // A supported edge bolt retracts into the lock case before the hinge moves.
  box(
    "Cockpit_latch_case",
    [0.082, 0.095, 0.028],
    [-0.469, 0.69, 0.018],
    frameFinish,
    hinge,
  );
  box(
    "Cockpit_latch_bolt",
    [0.02, 0.014, 0.004],
    [-0.516, 0.69, 0.008],
    materials.metal,
    hinge,
  );
  // Surface-mounted strike with a real channel ahead of the fixed jamb.
  // The bolt slides inside it, rather than penetrating the bulkhead or frame.
  box(
    "Cockpit_latch_strike_backplate",
    [0.026, 0.034, 0.004],
    [-half - 0.014, floor + 0.69, p.z - 0.027],
    frameFinish,
  );
  box(
    "Cockpit_latch_strike_lip",
    [0.024, 0.034, 0.003],
    [-half - 0.016, floor + 0.69, p.z - 0.0365],
    materials.metal,
  );
  for (const side of [-1, 1])
    box(
      `Cockpit_latch_strike_bridge_${side}`,
      [0.024, 0.006, 0.012],
      [-half - 0.016, floor + 0.69 + side * 0.012, p.z - 0.032],
      frameFinish,
    );
  return root;
}
