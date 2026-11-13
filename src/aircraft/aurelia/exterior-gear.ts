import * as T from "three";
import {
  exteriorGear,
} from "./exterior-reference";
import { type ExteriorKit, type Point } from "./exterior-kit";
import { fitAureliaMainBays, fitAureliaNoseBay } from "./gear-bays";

/** Retractable main and nose gear, nose bay doors, wheel wells and trunnions. */
export function buildLandingGear(kit: ExteriorKit, noseShift: number, noseLift: number) {
  const { root, white, blue, silver, rubber, well, palettes, group, mesh, surface, rod, supported, skin } = kit;
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
}
