import { beforeAll, expect, test } from "bun:test";
import * as T from "three";
import { makeAureliaExterior } from "../src/aircraft/aurelia/exterior";
import { makeAureliaInterior } from "../src/aircraft/aurelia/interior";
import { makeAureliaReference } from "../src/aircraft/aurelia/reference-model";
import {
  aureliaBodyAt,
  aureliaExteriorReference as reference,
  aureliaInteriorLayout as layout,
  aureliaAirframeScale,
} from "../src/aircraft/aurelia/exterior-reference";
import {
  neutralExteriorPose,
  poseAureliaExterior,
} from "../src/aircraft/aurelia/exterior-mechanisms";
import { aureliaCockpitLayout } from "../src/aircraft/aurelia/cockpit-layout";
import { distance, tree, triangles } from "../scripts/triangle-distance";
import { loadGeometryOnly } from "../scripts/geometry-loader";

let root: T.Group;
beforeAll(() => {
  root = makeAureliaExterior().root;
  root.add(makeAureliaInterior());
  poseAureliaExterior(root, neutralExteriorPose());
});
function bounds(name: string) {
  return new T.Box3().setFromObject(root.getObjectByName(name)!);
}
function point(name: string) {
  const node = root.getObjectByName(name)!;
  const mesh = node.children.find((o) => o instanceof T.Mesh) as T.Mesh;
  mesh.geometry.computeBoundingBox();
  return mesh.geometry
    .boundingBox!.getCenter(new T.Vector3())
    .applyMatrix4(mesh.matrixWorld);
}
function vertices(node: T.Object3D) {
  const out: T.Vector3[] = [];
  node.traverse((o) => {
    if (o instanceof T.Mesh) {
      const p = o.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++)
        out.push(
          new T.Vector3().fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld),
        );
    }
  });
  return out;
}

test("assembled SI aircraft matches the chosen manufacturer dimension callouts", () => {
  poseAureliaExterior(root, neutralExteriorPose());
  const box = new T.Box3().setFromObject(root),
    size = box.getSize(new T.Vector3());
  expect(size.x).toBeCloseTo(reference.span, 4);
  expect(size.y).toBeCloseTo(reference.height, 4);
  expect(size.z).toBeCloseTo(reference.length, 4);
  expect(box.min.y).toBeGreaterThan(-0.00001);
  for (const name of ["Main_wheel_Left", "Main_wheel_Right", "Nose_wheel"])
    expect(bounds(name).min.y).toBeCloseTo(0, 5);
});

test("all mesh positions and normals remain finite, with outward fuselage normals", () => {
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    for (const key of ["position", "normal"]) {
      const attribute = o.geometry.getAttribute(key);
      expect(attribute, `${o.name}: ${key}`).toBeDefined();
      if (!Array.from(attribute.array).every(Number.isFinite))
        throw new Error(`${o.name}: non-finite ${key}`);
    }
  });
  const shell = root.getObjectByName("Pressure_shell_upper") as T.Mesh,
    p = shell.geometry.getAttribute("position"),
    n = shell.geometry.getAttribute("normal");
  for (let i = 0; i < p.count; i += 29) {
    if (Math.abs(p.getZ(i)) > 7.8) continue;
    const [, , y] = aureliaBodyAt(p.getZ(i));
    expect(n.getX(i) * p.getX(i) + n.getY(i) * (p.getY(i) - y)).toBeGreaterThan(
      0,
    );
  }
});

test("preserves the user's shorter white wing-to-body fairing", () => {
  const fairing = root.getObjectByName(
    "Wing_body_carry_through_fairing",
  ) as T.Mesh;
  const box = new T.Box3().setFromObject(fairing);
  // The visible skin is trimmed inside these design stations at the hull joint.
  expect(box.min.z).toBeGreaterThanOrEqual(-1.700001);
  expect(box.max.z).toBeLessThanOrEqual(2.650001);
  const paint = fairing.material as T.MeshStandardMaterial;
  const wing = root.getObjectByName("Wing_skin_Left_0") as T.Mesh;
  expect(paint).toBe(wing.material);
});

test("all cabin openings see the interior through genuinely translucent glazing", () => {
  for (const side of [-1, 1])
    for (let i = 0; i < 6; i++) {
      const z = -2.9 + i * 1.04,
        x = side * 2;
      const pane = root.getObjectByName(
        `Cabin_window_${side < 0 ? "Left" : "Right"}_${i + 1}`,
      ) as T.Mesh;
      const m = pane.material as T.MeshStandardMaterial;
      expect(m.transparent).toBe(true);
      expect(m.opacity).toBeLessThan(0.5);
      expect(m.depthWrite).toBe(false);
      const [rx, ry, cy] = aureliaBodyAt(z),
        y = cy + ry * Math.cos(1.23);
      const ray = new T.Raycaster(
        new T.Vector3(x, y, z),
        new T.Vector3(-side, 0, 0),
        0,
        2 - rx * Math.sin(1.23) + 0.03,
      );
      const hits = ray.intersectObject(root.getObjectByName("Fuselage")!, true);
      expect(hits.some((hit) => hit.object.name === pane.name)).toBe(true);
      expect(
        hits.some((hit) => hit.object.name.startsWith("Pressure_shell")),
      ).toBe(false);
    }
});

test("conventional control directions follow handbook section 10.1", () => {
  poseAureliaExterior(root, neutralExteriorPose());
  const baseline = new Map(
    [
      "Aileron_Left",
      "Aileron_Right",
      "Elevator_Left",
      "Elevator_Right",
      "Rudder",
    ].map((name) => [name, point(name)]),
  );
  poseAureliaExterior(root, {
    ...neutralExteriorPose(),
    roll: 1,
    pitch: 1,
    yaw: 1,
  });
  expect(point("Aileron_Right").y).toBeGreaterThan(
    baseline.get("Aileron_Right")!.y,
  );
  expect(point("Aileron_Left").y).toBeLessThan(baseline.get("Aileron_Left")!.y);
  for (const side of ["Left", "Right"])
    expect(point(`Elevator_${side}`).y).toBeGreaterThan(
      baseline.get(`Elevator_${side}`)!.y,
    );
  expect(point("Rudder").x).toBeGreaterThan(baseline.get("Rudder")!.x);
  poseAureliaExterior(root, { ...neutralExteriorPose(), flaps: 1 });
  for (const side of ["Left", "Right"]) {
    const flap = root.getObjectByName(`Flap_${side}`)!;
    const rest = flap.userData.restPosition as number[];
    expect(flap.position.z - rest[2]).toBeCloseTo(0.18, 6);
    expect(flap.position.y).toBeLessThan(rest[1]);
  }
});

test("absolute mechanism poses scrub both directions and reset without drift", () => {
  poseAureliaExterior(root, neutralExteriorPose());
  const baseline = new Map<string, number[]>();
  root.traverse((o) => {
    if (o instanceof T.Group) baseline.set(o.name, o.matrix.toArray());
  });
  for (let i = 0; i < 25; i++)
    poseAureliaExterior(root, {
      gear: (i % 11) / 10,
      flaps: (i % 7) / 6,
      roll: Math.sin(i),
      pitch: Math.cos(i),
      yaw: Math.sin(i / 2),
      steering: Math.cos(i),
      fan: i,
      entry: (i % 5) / 4,
    });
  poseAureliaExterior(root, neutralExteriorPose());
  root.traverse((o) => {
    const previous = baseline.get(o.name);
    if (previous)
      o.matrix
        .toArray()
        .forEach((v, i) => expect(v).toBeCloseTo(previous[i], 9));
  });
});

test("all gear tires stay below their reserved roof or ahead of the cockpit floor", () => {
  for (let step = 0; step <= 100; step++) {
    poseAureliaExterior(root, { ...neutralExteriorPose(), gear: step / 100 });
    for (const side of ["Left", "Right"])
      expect(bounds(`Main_wheel_${side}`).max.y).toBeLessThan(1.285);
    const nose = bounds("Nose_wheel");
    // The forward-folding nose wheel enters the empty nose volume, clear of the floor at z=-5.50.
    if (nose.max.y > 1.427) expect(nose.max.z).toBeLessThan(-5.5);
    for (const side of ["Left", "Right"])
      expect(bounds(`Main_bay_door_${side}`).min.y).toBeGreaterThan(0.2);
  }
  poseAureliaExterior(root, { ...neutralExteriorPose(), gear: 0 });
  for (const p of vertices(root.getObjectByName("Nose_wheel")!)) {
    const [rx, ry, y] = aureliaBodyAt(p.z);
    expect((p.x / rx) ** 2 + ((p.y - y) / ry) ** 2).toBeLessThan(1);
  }
});

test("carry-through fairing never emerges through the cabin centre aisle", () => {
  const fairing = root.getObjectByName("Wing_body_carry_through_fairing")!;
  for (const z of [-1, 0, 0.6, 1, 1.5, 2]) {
    const ray = new T.Raycaster(
      new T.Vector3(0, 3, z),
      new T.Vector3(0, -1, 0),
    );
    for (const hit of ray.intersectObject(fairing, true))
      expect(hit.point.y).toBeLessThan(1.3);
  }
});

test("front floor edges are enclosed by inward-facing cabin walls", () => {
  poseAureliaExterior(root, neutralExteriorPose());
  const lining: T.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.Mesh && o.name.startsWith("Forward_liner"))
      lining.push(o);
  });
  for (const z of [-5, -4.6, -4.2, -3.5])
    for (const y of [layout.floorY + 0.02, layout.floorY + 0.25])
      for (const side of [-1, 1]) {
        const hits = new T.Raycaster(
          new T.Vector3(0, y, z),
          new T.Vector3(side, 0, 0),
          0,
          1,
        ).intersectObjects(lining, false);
        expect(hits.length, `front lining ${z},${y},${side}`).toBeGreaterThan(
          0,
        );
      }
});

test("open airstair has even rises and runs, and is interlocked with down gear", () => {
  poseAureliaExterior(root, { ...neutralExteriorPose(), entry: 1 });
  const steps = [1, 2, 3, 4].map((i) =>
    bounds(`Airstair_tread_${i}`).getCenter(new T.Vector3()),
  );
  for (let i = 1; i < steps.length; i++) {
    expect(steps[i - 1].y - steps[i].y).toBeCloseTo(
      layout.floorY / (layout.stairCount + 1),
      6,
    );
    expect(steps[i - 1].x - steps[i].x).toBeCloseTo(layout.stairRun, 6);
  }
  const rise = layout.floorY / (layout.stairCount + 1);
  expect(layout.floorY - (steps[0].y + 0.0175)).toBeCloseTo(rise, 6);
  expect(steps.at(-1)!.y + 0.0175).toBeCloseTo(rise, 6);
  for (let i = 0; i <= 100; i++) {
    poseAureliaExterior(root, { ...neutralExteriorPose(), entry: i / 100 });
    expect(
      bounds("Passenger_entry_hinge").min.y,
      `entry ground clearance at ${i}%`,
    ).toBeGreaterThan(0.025);
  }
  poseAureliaExterior(root, { ...neutralExteriorPose(), gear: 0, entry: 1 });
  expect(
    root
      .getObjectByName("Passenger_entry_hinge")!
      .quaternion.angleTo(new T.Quaternion()),
  ).toBeCloseTo(0, 10);
});

test("actual GLB reimport preserves dimensions, interior, pivot metadata and gear animation", async () => {
  const root = makeAureliaReference().root;
  poseAureliaExterior(root, neutralExteriorPose());
  const { scene, animations } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
    true,
  );
  expect(scene.getObjectByName("Interior")).toBeDefined();
  for (const name of [
    "Cockpit_floor",
    "Instrument_panel",
    "Pilot_seat_Left",
    "Passenger_seat_club_forward_Left",
    "Aft_lavatory",
  ]) {
    const expected = root
      .getObjectByName(name)!
      .getWorldPosition(new T.Vector3());
    expect(
      scene
        .getObjectByName(name)!
        .getWorldPosition(new T.Vector3())
        .distanceTo(expected),
    ).toBeLessThan(1e-6);
  }
  expect(animations).toHaveLength(1);
  expect(scene.getObjectByName("Flap_Left")!.userData.hingeAxis).toHaveLength(
    3,
  );
  for (const gear of [1, 0.75, 0.5, 0.25, 0]) {
    poseAureliaExterior(root, { ...neutralExteriorPose(), gear });
    poseAureliaExterior(scene, { ...neutralExteriorPose(), gear });
    for (const name of ["Main_wheel_Left", "Main_wheel_Right", "Nose_wheel"]) {
      const expected = root
        .getObjectByName(name)!
        .getWorldPosition(new T.Vector3());
      expect(
        scene
          .getObjectByName(name)!
          .getWorldPosition(new T.Vector3())
          .distanceTo(expected),
      ).toBeLessThan(0.000001);
    }
  }
  const mixer = new T.AnimationMixer(scene),
    action = mixer.clipAction(animations[0]);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  mixer.setTime(6);
  scene.updateMatrixWorld(true);
  expect(
    scene.getObjectByName("Main_wheel_Left")!.getWorldPosition(new T.Vector3())
      .y,
  ).toBeCloseTo(1.18 * aureliaAirframeScale, 4);
  const source = new Uint8Array(
    await Bun.file(
      new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
    ).arrayBuffer(),
  );
  const length = new DataView(source.buffer).getUint32(12, true);
  const doc = JSON.parse(
    new TextDecoder().decode(source.slice(20, 20 + length)),
  ) as { materials: { name?: string; alphaMode?: string }[] };
  expect(
    doc.materials.find((m) => m.name === "Smoked cockpit glazing")!.alphaMode,
  ).toBe("BLEND");
});

test("shell and airfoil triangle winding agrees with outward shading normals", () => {
  root.traverse((o) => {
    if (
      !(o instanceof T.Mesh) ||
      !/^(Pressure_shell|Wing_skin|Vertical_stabilizer|Rudder_skin|Tailplane_skin|Elevator_skin)/.test(
        o.name,
      )
    )
      return;
    const p = o.geometry.getAttribute("position"),
      n = o.geometry.getAttribute("normal"),
      ix = o.geometry.index!;
    for (let i = 0; i < ix.count; i += 3) {
      const ids = [ix.getX(i), ix.getX(i + 1), ix.getX(i + 2)];
      const [a, b, c] = ids.map((j) =>
        new T.Vector3().fromBufferAttribute(p, j),
      );
      const face = b.sub(a).cross(c.sub(a));
      if (face.lengthSq() < 1e-16) continue;
      const normal = ids
        .reduce(
          (sum, j) => sum.add(new T.Vector3().fromBufferAttribute(n, j)),
          new T.Vector3(),
        )
        .normalize();
      if (face.normalize().dot(normal) < -1e-5)
        throw new Error(`${o.name} triangle ${i / 3}: reversed face`);
    }
  });
});

function edgeCrossing(moving: T.Mesh, target: T.Mesh) {
  const position = moving.geometry.getAttribute("position"),
    ix = moving.geometry.index!;
  const movingBox = new T.Box3().setFromObject(moving).expandByScalar(1e-6);
  const positions = target.geometry.getAttribute("position"),
    indices = target.geometry.index!;
  const candidates: number[] = [];
  for (let i = 0; i < indices.count; i += 3) {
    const [a, b, c] = [0, 1, 2].map((j) =>
      new T.Vector3()
        .fromBufferAttribute(positions, indices.getX(i + j))
        .applyMatrix4(target.matrixWorld),
    );
    if (movingBox.intersectsTriangle(new T.Triangle(a, b, c)))
      candidates.push(...a.toArray(), ...b.toArray(), ...c.toArray());
  }
  if (!candidates.length) return false;
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    "position",
    new T.Float32BufferAttribute(candidates, 3),
  );
  const probe = new T.MeshBasicMaterial({ side: T.DoubleSide }),
    candidateMesh = new T.Mesh(geometry, probe);
  try {
    for (let i = 0; i < ix.count; i += 3)
      for (let j = 0; j < 3; j++) {
        const a = new T.Vector3()
          .fromBufferAttribute(position, ix.getX(i + j))
          .applyMatrix4(moving.matrixWorld);
        const b = new T.Vector3()
          .fromBufferAttribute(position, ix.getX(i + ((j + 1) % 3)))
          .applyMatrix4(moving.matrixWorld);
        const delta = b.sub(a),
          length = delta.length();
        if (
          length > 2e-5 &&
          new T.Raycaster(
            a,
            delta.divideScalar(length),
            1e-5,
            length - 1e-5,
          ).intersectObject(candidateMesh, false).length
        )
          return true;
      }
    return false;
  } finally {
    geometry.dispose();
    probe.dispose();
  }
}

test("indexed wing and bay faces clear the tire during the gear cycle", () => {
  const targets: T.Mesh[] = [];
  root.traverse((o) => {
    if (
      o instanceof T.Mesh &&
      /^(Wing_skin_Right|Main_bay_door_Right|Main_outer_bay_door_Right|Main_bay_roof_Right|Wing_body_carry)/.test(
        o.name,
      )
    )
      targets.push(o);
  });
  const tire = root.getObjectByName("Main_wheel_Right_tire") as T.Mesh;
  for (let i = 0; i <= 20; i++) {
    poseAureliaExterior(root, { ...neutralExteriorPose(), gear: i / 20 });
    const tireBox = new T.Box3().setFromObject(tire);
    for (const target of targets) {
      if (!tireBox.intersectsBox(new T.Box3().setFromObject(target))) continue;
      expect(edgeCrossing(tire, target), `gear=${i / 20}: ${target.name}`).toBe(
        false,
      );
    }
  }
});

test("control surfaces retain operating clearance at both travel limits", () => {
  for (const input of [-1, -0.5, 0, 0.5, 1]) {
    poseAureliaExterior(root, {
      ...neutralExteriorPose(),
      roll: input,
      pitch: input,
      yaw: input,
      flaps: (input + 1) / 2,
    });
    for (const name of [
      "Aileron_skin_Right",
      "Flap_skin_Right",
      "Elevator_skin_Right",
      "Rudder_skin",
    ]) {
      const moving = root.getObjectByName(name) as T.Mesh;
      root.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        const relevant =
          name.startsWith("Aileron") || name.startsWith("Flap")
            ? /^Wing_skin_Right/.test(o.name)
            : name.startsWith("Elevator")
              ? o.name === "Tailplane_skin_Right"
              : o.name === "Vertical_stabilizer";
        if (relevant)
          expect(
            edgeCrossing(moving, o),
            `${name} at ${input}: ${o.name}`,
          ).toBe(false);
      });
    }
  }
});

test("wheel wells are fitted recesses rather than oversized square boxes", () => {
  const roof = root.getObjectByName("Main_bay_roof_Right") as T.Mesh;
  const size = new T.Box3().setFromObject(roof).getSize(new T.Vector3());
  expect(size.z).toBeLessThan(0.78);
  expect(roof.geometry.type).not.toBe("BoxGeometry");
});
test("folded airstair does not poke outside the closed pressure skin", () => {
  poseAureliaExterior(root, neutralExteriorPose());
  for (let i = 1; i <= 4; i++) {
    const m = root.getObjectByName(`Airstair_tread_${i}`) as T.Mesh,
      p = m.geometry.getAttribute("position");
    for (let j = 0; j < p.count; j++) {
      const v = new T.Vector3()
        .fromBufferAttribute(p, j)
        .applyMatrix4(m.matrixWorld);
      // The aperture sits in the constant-section pressure body.
      expect((v.x / 0.9) ** 2 + ((v.y - 2.08) / 0.94) ** 2).toBeLessThan(1);
    }
  }
});
test("entry panel follows the curved hull between vertices, without inward flat facets", () => {
  poseAureliaExterior(root, neutralExteriorPose());
  const m = root.getObjectByName("Passenger_entry_door") as T.Mesh,
    p = m.geometry.getAttribute("position"),
    ix = m.geometry.index!;
  for (let i = 0; i < ix.count; i += 3) {
    const c = new T.Vector3();
    for (let j = 0; j < 3; j++)
      c.add(
        new T.Vector3()
          .fromBufferAttribute(p, ix.getX(i + j))
          .applyMatrix4(m.matrixWorld),
      );
    c.multiplyScalar(1 / 3);
    const [rx, ry, cy] = aureliaBodyAt(c.z);
    const q = Math.sqrt((c.x / rx) ** 2 + ((c.y - cy) / ry) ** 2);
    expect(1 - q).toBeLessThan(0.003);
  }
});

test("closed main doors hide the whole retracted gear, without the old exposed leg or tire", () => {
  poseAureliaExterior(root, { ...neutralExteriorPose(), gear: 0 });
  const targets: T.Mesh[] = [];
  root.traverse((o) => {
    if (
      o instanceof T.Mesh &&
      /^(Wing_skin|Wing_body_carry|Main_oleo|Main_piston|Main_fork|Torque_link|Main_wheel|Main_bay|Main_outer_bay)/.test(
        o.name,
      )
    )
      targets.push(o);
  });
  for (const side of [-1, 1])
    for (let i = 0; i < 20; i++)
      for (let j = 0; j < 10; j++) {
        const x = side * (0.58 + (i * 1.32) / 19),
          z = 0.49 + (j * 0.66) / 9;
        if (Math.abs(Math.abs(x) - 1.24) < 0.004) continue; // Deliberate four-millimetre door seam.
        const hits = new T.Raycaster(
          new T.Vector3(x, 0, z),
          new T.Vector3(0, 1, 0),
          0,
          1.5,
        ).intersectObjects(targets, false);
        if (!hits.length) continue;
        expect(
          /^(Main_oleo|Main_piston|Main_fork|Torque_link|Main_wheel|Main_bay_roof|Main_bay_liner)/.test(
            hits[0].object.name,
          ),
          `visible from below at ${x},${z}: ${hits[0].object.name}`,
        ).toBe(false);
      }
});

test("main inner doors open before folding and all main panels close after stow", () => {
  poseAureliaExterior(root, { ...neutralExteriorPose(), gear: 0.84 });
  expect(
    root
      .getObjectByName("Main_door_hinge_Right")!
      .quaternion.angleTo(new T.Quaternion()),
  ).toBeGreaterThan(1.9);
  expect(
    root
      .getObjectByName("Main_gear_Right_retraction_hinge")!
      .quaternion.angleTo(new T.Quaternion()),
  ).toBeCloseTo(0, 6);
  poseAureliaExterior(root, { ...neutralExteriorPose(), gear: 0 });
  for (const side of ["Left", "Right"])
    for (const name of ["Main_door_hinge", "Main_outer_door_hinge"])
      expect(
        root
          .getObjectByName(`${name}_${side}`)!
          .quaternion.angleTo(new T.Quaternion()),
      ).toBeCloseTo(0, 6);
});

test("entry door and surround continue the belly paint across the opening", () => {
  poseAureliaExterior(root, neutralExteriorPose());
  root.traverse((o) => {
    if (
      !(o instanceof T.Mesh) ||
      !/^Passenger_entry_(door|surround)(?:_livery)?$/.test(o.name)
    )
      return;
    const p = o.geometry.getAttribute("position"),
      ix = o.geometry.index!,
      material = o.material as T.MeshStandardMaterial;
    for (let i = 0; i < ix.count; i += 3) {
      const center = new T.Vector3();
      for (let j = 0; j < 3; j++)
        center.add(
          new T.Vector3()
            .fromBufferAttribute(p, ix.getX(i + j))
            .applyMatrix4(o.matrixWorld),
        );
      center.multiplyScalar(1 / 3);
      const [rx, ry, cy] = aureliaBodyAt(center.z),
        angle = Math.atan2(center.x / rx, (center.y - cy) / ry);
      if (angle < -2.03)
        expect(material.name).toBe("Aurelia deep Atlantic paint");
      if (angle > -2.01) expect(material.name).toBe("Porcelain aircraft paint");
    }
  });
});

test("entry surround fills all four outer corners without the previous open slivers", () => {
  poseAureliaExterior(root, neutralExteriorPose());
  const frames: T.Object3D[] = [];
  root.traverse((o) => {
    if (/^Passenger_entry_surround/.test(o.name)) frames.push(o);
  });
  for (const z of [-3.82 - 0.369, -3.82 + 0.369])
    for (const angle of [-1.6 - 0.89, -1.6 + 0.89]) {
      const [rx, ry, cy] = aureliaBodyAt(z),
        surface = new T.Vector3(
          rx * Math.sin(angle),
          cy + ry * Math.cos(angle),
          z,
        ),
        normal = new T.Vector3(Math.sin(angle), Math.cos(angle), 0).normalize();
      const hits = new T.Raycaster(
        surface.clone().addScaledVector(normal, 0.03),
        normal.negate(),
        0,
        0.04,
      ).intersectObjects(frames, false);
      expect(hits.length, `entry-frame corner ${z},${angle}`).toBeGreaterThan(
        0,
      );
    }
});

test("nose well encloses the aperture instead of exposing the flight deck after GLB import", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  poseAureliaExterior(scene, neutralExteriorPose());
  const well: T.Mesh[] = [];
  scene.traverse((o) => {
    if (o instanceof T.Mesh && /^Nose_bay_(roof|liner|bulkhead)/.test(o.name))
      well.push(o);
  });
  for (const z of [-6.2, -6, -5.7, -5.4, -5, -4.6, -4.2])
    for (const x of [-0.1, 0, 0.1]) {
      const hits = new T.Raycaster(
        new T.Vector3(
          x,
          0.8,
          z - aureliaCockpitLayout(aureliaAirframeScale).noseShift,
        ).multiplyScalar(aureliaAirframeScale),
        new T.Vector3(0, 1, 0),
        0,
        1.5,
      ).intersectObjects(well, false);
      expect(hits.length, `enclosed nose bay at ${x},${z}`).toBeGreaterThan(0);
    }
  for (const side of [-1, 1]) {
    const hits = new T.Raycaster(
      new T.Vector3(
        0,
        1.4,
        -5.8 - aureliaCockpitLayout(aureliaAirframeScale).noseShift,
      ).multiplyScalar(aureliaAirframeScale),
      new T.Vector3(side, 0, 0),
      0,
      0.5,
    ).intersectObjects(well, false);
    expect(hits.length, `nose bay side ${side}`).toBeGreaterThan(0);
  }
  for (const [y, z, direction] of [
    [1.6, -6.1, -1],
    [1.35, -4.3, 1],
  ]) {
    const hits = new T.Raycaster(
      new T.Vector3(
        0,
        y,
        z - aureliaCockpitLayout(aureliaAirframeScale).noseShift,
      ).multiplyScalar(aureliaAirframeScale),
      new T.Vector3(0, 0, direction),
      0,
      0.3,
    ).intersectObjects(well, false);
    expect(hits.length, `nose bay end ${direction}`).toBeGreaterThan(0);
  }
});

test("main and nose door panels have material connecting their hinge axes to the skins", () => {
  const mounts = [
    ...["Left", "Right"].flatMap((label) => [
      { name: `Main_outer_door_hinge_${label}`, stations: [-0.08, 0.08] },
      { name: `Main_door_hinge_${label}`, stations: [-0.08, 0.08] },
    ]),
  ];
  for (const mount of mounts) {
    const hinge = root.getObjectByName(mount.name)!;
    for (const z of mount.stations) {
      const origin = hinge.localToWorld(new T.Vector3(0, 0.035, z));
      const direction = new T.Vector3(0, -1, 0).transformDirection(
        hinge.matrixWorld,
      );
      const hits = new T.Raycaster(origin, direction, 0, 0.07).intersectObject(
        hinge,
        true,
      );
      expect(
        hits.length,
        `${hinge.name}: hinge connection at ${z}`,
      ).toBeGreaterThan(0);
    }
  }
});

test("relocated nose-door leaves physically meet their hinge pins", () => {
  for (const side of [-1, 1])
    for (let i = 0; i < 2; i++) {
      const pin = root.getObjectByName(`Nose_door_pin_${side}_${i}`) as T.Mesh;
      const leaf = root.getObjectByName(
        `Nose_door_leaf_${side}_${i}`,
      ) as T.Mesh;
      expect(
        distance(tree(triangles(pin)), tree(triangles(leaf))).metres,
      ).toBeLessThan(0.00001);
    }
});

test("nose hardware clears the cockpit floor and console throughout retraction after GLB import", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  const targets = ["Cockpit_floor", "Centre_console"].map(
    (name) => scene.getObjectByName(name) as T.Mesh,
  );
  const moving: T.Mesh[] = [];
  scene.getObjectByName("Nose_gear_retraction_hinge")!.traverse((o) => {
    if (o instanceof T.Mesh) moving.push(o);
  });
  for (let i = 0; i <= 100; i++) {
    poseAureliaExterior(scene, { ...neutralExteriorPose(), gear: i / 100 });
    for (const part of moving)
      for (const target of targets)
        if (
          new T.Box3()
            .setFromObject(part)
            .intersectsBox(new T.Box3().setFromObject(target))
        )
          expect(
            edgeCrossing(part, target),
            `${part.name} / ${target.name} at ${i}%`,
          ).toBe(false);
  }
});

test("nose bay panels continue the blue belly paint when closed", () => {
  for (const side of [-1, 1]) {
    const panel = root.getObjectByName(`Nose_bay_door_${side}`) as T.Mesh;
    expect((panel.material as T.MeshStandardMaterial).name).toBe(
      "Aurelia deep Atlantic paint",
    );
  }
});

test("both wings and tail controls clear fixed skins throughout 41 travel samples after GLB import", async () => {
  const { scene: root } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  const targets: T.Mesh[] = [];
  root.traverse((o) => {
    if (
      o instanceof T.Mesh &&
      /^(Wing_skin|Tailplane_skin|Vertical_stabilizer)/.test(o.name)
    )
      targets.push(o);
  });
  for (let i = 0; i <= 40; i++) {
    const input = i / 20 - 1;
    poseAureliaExterior(root, {
      ...neutralExteriorPose(),
      roll: input,
      pitch: input,
      yaw: input,
      flaps: i / 40,
    });
    for (const name of [
      "Aileron_skin_Left",
      "Aileron_skin_Right",
      "Flap_skin_Left",
      "Flap_skin_Right",
      "Elevator_skin_Left",
      "Elevator_skin_Right",
      "Rudder_skin",
    ]) {
      const moving = root.getObjectByName(name) as T.Mesh;
      const box = new T.Box3().setFromObject(moving);
      for (const target of targets)
        if (box.intersectsBox(new T.Box3().setFromObject(target)))
          expect(
            edgeCrossing(moving, target),
            `${name} sample ${i}: ${target.name}`,
          ).toBe(false);
    }
  }
});

test("both main and nose gear hardware clear bay skins through 101 samples after GLB import", async () => {
  const { scene: root } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  const moving: T.Mesh[] = [],
    targets: T.Mesh[] = [];
  root.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    if (
      /^(Main_oleo.*|Main_piston.*|Main_fork.*|Torque_link.*|Main_wheel_.*|Nose_wheel.*|Nose_fork.*|Nose_piston|Nose_oleo)$/.test(
        o.name,
      )
    )
      moving.push(o);
    if (
      /^(Wing_skin|Main_bay_door|Main_outer_bay_door|Main_bay_roof|Wing_body_carry|Nose_bay_door|Nose_bay_roof|Nose_bay_liner|Nose_bay_bulkhead|Nose_door_(pin|clevis|leaf)|Main_door_(pin|clevis|hinge_leaf)|Pressure_shell)/.test(
        o.name,
      )
    )
      targets.push(o);
  });
  for (const steering of [-1, 1])
    for (let i = 0; i <= 100; i++) {
      poseAureliaExterior(root, {
        ...neutralExteriorPose(),
        gear: i / 100,
        steering,
      });
      for (const part of moving) {
        const box = new T.Box3().setFromObject(part);
        for (const target of targets)
          if (box.intersectsBox(new T.Box3().setFromObject(target)))
            expect(
              edgeCrossing(part, target),
              `${part.name} gear ${i}%: ${target.name}`,
            ).toBe(false);
      }
    }
}, 30000);

test("entry panel and treads clear shell and vestibule through 101 poses", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  const moving: T.Mesh[] = [],
    targets: T.Mesh[] = [];
  scene.getObjectByName("Passenger_entry_hinge")!.traverse((o) => {
    if (o instanceof T.Mesh) moving.push(o);
  });
  scene.traverse((o) => {
    if (
      o instanceof T.Mesh &&
      /^(Pressure_shell|Forward_liner|Liner_panel|Entry_vestibule_floor|Cabin_floor|Cockpit_floor|Refreshment_cabinet|Locker_cabinet)/.test(
        o.name,
      )
    )
      targets.push(o);
  });
  for (let i = 0; i <= 100; i++) {
    poseAureliaExterior(scene, { ...neutralExteriorPose(), entry: i / 100 });
    for (const part of moving) {
      const box = new T.Box3().setFromObject(part);
      for (const target of targets)
        if (box.intersectsBox(new T.Box3().setFromObject(target)))
          expect(
            edgeCrossing(part, target),
            `${part.name} entry ${i / 100}: ${target.name}`,
          ).toBe(false);
    }
  }
}, 30000);

test("both fan rotors clear ducts and nacelles through a full revolution", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  for (let i = 0; i <= 40; i++) {
    poseAureliaExterior(scene, {
      ...neutralExteriorPose(),
      fan: (i * Math.PI) / 20,
    });
    for (const side of ["Left", "Right"]) {
      const targets = [
        `Nacelle_${side}`,
        `Intake_duct_${side}`,
        `Intake_lip_${side}`,
      ].map((name) => scene.getObjectByName(name) as T.Mesh);
      scene.getObjectByName(`Fan_${side}`)!.traverse((o) => {
        if (!(o instanceof T.Mesh) || o.name.startsWith("Fan_back")) return;
        const box = new T.Box3().setFromObject(o);
        for (const target of targets)
          if (box.intersectsBox(new T.Box3().setFromObject(target)))
            expect(
              edgeCrossing(o, target),
              `${o.name} fan phase ${i}: ${target.name}`,
            ).toBe(false);
      });
    }
  }
}, 30000);

test("baked gear clip agrees with shared controller at every exported key in both directions", async () => {
  const url = new URL(
    "../public/assets/aurelia-phenom300e.glb",
    import.meta.url,
  );
  const { scene, animations } = await loadGeometryOnly(url, true),
    { scene: expected } = await loadGeometryOnly(url);
  const mixer = new T.AnimationMixer(scene),
    action = mixer.clipAction(animations[0]);
  action.setLoop(T.LoopOnce, 1);
  action.clampWhenFinished = true;
  action.play();
  for (const time of [
    ...Array.from({ length: 121 }, (_, i) => i / 20),
    ...Array.from({ length: 121 }, (_, i) => (120 - i) / 20),
  ]) {
    // Re-enable after a clamped endpoint, so reverse seeking evaluates the clip.
    action.paused = false;
    action.enabled = true;
    mixer.setTime(time);
    scene.updateMatrixWorld(true);
    poseAureliaExterior(expected, {
      ...neutralExteriorPose(),
      gear: 1 - time / 6,
    });
    scene.traverse((o) => {
      if (!/retraction_hinge|door_hinge/.test(o.name)) return;
      const target = expected.getObjectByName(o.name)!;
      expect(
        o.quaternion.angleTo(target.quaternion),
        `${o.name} t=${time}`,
      ).toBeLessThan(0.001);
    });
  }
});

test("every imported mesh has consistent winding for visible area triangles", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  scene.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const p = o.geometry.getAttribute("position"),
      n = o.geometry.getAttribute("normal"),
      ix = o.geometry.index!;
    for (let i = 0; i < ix.count; i += 3) {
      const ids = [0, 1, 2].map((j) => ix.getX(i + j)),
        [a, b, c] = ids.map((j) => new T.Vector3().fromBufferAttribute(p, j));
      const face = b.sub(a).cross(c.sub(a));
      // Below one square millimetre, Float32 clipping slivers have no stable face direction.
      if (face.length() < 2e-6) continue;
      const normal = ids
        .reduce(
          (sum, j) => sum.add(new T.Vector3().fromBufferAttribute(n, j)),
          new T.Vector3(),
        )
        .normalize();
      expect(
        face.normalize().dot(normal),
        `${o.name} triangle ${i / 3}`,
      ).toBeGreaterThanOrEqual(-1e-5);
    }
  });
});

test("airstair treads do not pierce their own exterior door panel", () => {
  poseAureliaExterior(root, neutralExteriorPose());
  const panels = ["Passenger_entry_door", "Passenger_entry_door_livery"].map(
    (name) => root.getObjectByName(name) as T.Mesh,
  );
  for (let i = 1; i <= 4; i++)
    for (const panel of panels)
      expect(
        edgeCrossing(
          root.getObjectByName(`Airstair_tread_${i}`) as T.Mesh,
          panel,
        ),
        `Tread ${i}: ${panel.name}`,
      ).toBe(false);
});

test("all six flap fairings stay joined to the flap skin throughout travel after export", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  poseAureliaExterior(scene, neutralExteriorPose());
  const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
  const mounts = ["Left", "Right"].flatMap((side) => {
    const flap = scene.getObjectByName(`Flap_${side}`)!;
    return ["21", "31", "4"].map((x) => {
      const fairing = scene.getObjectByName(
        `Flap_track_fairing_${side}_${x}`,
      ) as T.Mesh;
      const box = new T.Box3().setFromObject(fairing),
        center = box.getCenter(new T.Vector3());
      const points = [-0.015, 0, 0.015].flatMap((dx) =>
        [-0.255, -0.22, -0.185].map((dz) => {
          const point = flap.worldToLocal(
            new T.Vector3(center.x + dx, 0, center.z + dz),
          );
          point.y = -1;
          return point;
        }),
      );
      return {
        flap,
        fairing,
        points,
        skin: scene.getObjectByName(`Flap_skin_${side}`) as T.Mesh,
      };
    });
  });
  try {
    for (let i = 0; i <= 20; i++) {
      poseAureliaExterior(scene, { ...neutralExteriorPose(), flaps: i / 20 });
      for (const { flap, fairing, skin, points } of mounts) {
        const probes = [fairing, skin].map((mesh) => {
          const probe = new T.Mesh(mesh.geometry, material);
          probe.matrixAutoUpdate = false;
          probe.matrixWorld.copy(mesh.matrixWorld);
          return probe;
        });
        const direction = new T.Vector3(0, 1, 0).transformDirection(
          flap.matrixWorld,
        );
        for (const point of points) {
          const ray = new T.Raycaster(
            point.clone().applyMatrix4(flap.matrixWorld),
            direction,
            0,
            2,
          );
          const body = ray.intersectObject(probes[0]),
            wing = ray.intersectObject(probes[1]);
          expect(
            body.length,
            `${fairing.name}: missing housing at ${i / 20}`,
          ).toBeGreaterThan(0);
          expect(
            wing.length,
            `${fairing.name}: no mounting skin at ${i / 20}`,
          ).toBeGreaterThan(0);
          const gap = wing[0].distance - body.at(-1)!.distance;
          expect(
            gap,
            `${fairing.name} at flap ${i / 20}: attachment gap ${gap} m`,
          ).toBeLessThanOrEqual(0.005);
          expect(
            gap,
            `${fairing.name}: housing penetrates too far into flap`,
          ).toBeGreaterThanOrEqual(-0.008);
        }
      }
    }
  } finally {
    material.dispose();
  }
});

test("attached flap fairings clear the fixed wing through full flap travel", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/aurelia-phenom300e.glb", import.meta.url),
  );
  const fixed: T.Mesh[] = [],
    fairings: T.Mesh[] = [];
  scene.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    if (o.name.startsWith("Wing_skin")) fixed.push(o);
    if (o.name.startsWith("Flap_track_fairing")) fairings.push(o);
  });
  for (let i = 0; i <= 20; i++) {
    poseAureliaExterior(scene, { ...neutralExteriorPose(), flaps: i / 20 });
    for (const fairing of fairings) {
      const box = new T.Box3().setFromObject(fairing);
      for (const skin of fixed)
        if (box.intersectsBox(new T.Box3().setFromObject(skin)))
          expect(
            edgeCrossing(fairing, skin),
            `${fairing.name} at ${i / 20}: ${skin.name}`,
          ).toBe(false);
    }
  }
});
