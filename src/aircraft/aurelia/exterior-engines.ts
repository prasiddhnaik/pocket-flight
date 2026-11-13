import * as T from "three";
import { type ExteriorKit, tau } from "./exterior-kit";

/** Open annular nacelles: an inlet lip, dark duct, visible fan and separate exhaust. */
export function buildEngines(kit: ExteriorKit) {
  const { root, white, silver, dark, group, mesh, rod, supported, bearing, box, skin } = kit;
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
}
