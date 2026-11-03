import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { refineAircraftMaterials } from "../src/aircraft/aircraft-materials";
import { expect, test } from "bun:test";
import { Box3, Mesh, MeshStandardMaterial, Color, Vector3 } from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { F15CMechanisms } from "../src/aircraft/f15c/mechanisms";
import { wheelPose } from "../src/flight/airframe-contact";
import collision from "../src/aircraft/f15c/collision.json";
import { F15C_MUZZLE } from "../src/flight/cannon";

const asset = new URL("../public/assets/f15c-eagle.glb", import.meta.url);
test("F-15C console cover stays inside the closed canopy front bow", async () => {
  const { scene } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  const cover = scene.getObjectByName("Instrument_coaming");
  expect(cover).toBeInstanceOf(Mesh);
  if (!(cover instanceof Mesh)) throw new Error("Missing console cover mesh");
  const vertices = cover.geometry.getAttribute("position");
  let checked = 0;
  for (let i = 0; i < vertices.count; i++) {
    const p = new Vector3()
      .fromBufferAttribute(vertices, i)
      .applyMatrix4(cover.matrixWorld);
    if (-p.z < 5.6) continue;
    // Canopy front-bow aperture from the Blender skin, inset 8 mm.
    const x = p.x / (0.47 - 0.008);
    const z = (p.y - 0.3781) / (0.79 - 0.008);
    expect(x * x + z * z).toBeLessThan(1);
    checked++;
  }
  expect(checked).toBeGreaterThan(10);
});

test("F-15C runtime export retains SI dimensions, finite normals and required authored pivots", async () => {
  const { scene, sha256 } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  const size = new Box3().setFromObject(scene).getSize(new Vector3());
  expect(size.x).toBeCloseTo(13.04925, 3);
  expect(size.y).toBeCloseTo(5.6261, 3);
  expect(size.z).toBeCloseTo(19.431, 3);
  for (const name of [
    "Wing_Left",
    "Wing_Right",
    "LandingGear",
    "Aileron_Left",
    "Aileron_Right",
    "Flap_Left",
    "Flap_Right",
    "Stabilator_Left",
    "Stabilator_Right",
    "Stabilator_shaft_Left",
    "Stabilator_shaft_Right",
    "Rudder_Left",
    "Rudder_Right",
    "Canopy",
    "Airbrake",
    "Gear_Nose",
    "Gear_Left",
    "Gear_Right",
    "Wheel_Nose",
    "Wheel_Left",
    "Wheel_Right",
    "Door_Left_Inner",
    "Door_Right_Inner",
  ])
    expect(scene.getObjectByName(name)).toBeDefined();
  let vertices = 0;
  scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    for (const attribute of [
      node.geometry.getAttribute("position"),
      node.geometry.getAttribute("normal"),
    ]) {
      expect(attribute).toBeDefined();
      for (let i = 0; i < attribute.count; i++)
        expect(
          [attribute.getX(i), attribute.getY(i), attribute.getZ(i)].every(
            Number.isFinite,
          ),
        ).toBe(true);
    }
    vertices += node.geometry.getAttribute("position").count;
  });
  expect(vertices).toBeGreaterThan(10000);
  expect(collision.sha256).toBe(sha256);
  expect(collision.probes.length).toBeGreaterThan(100);
  const gunMuzzle = scene.getObjectByName("F15C_Eagle")!.userData.gunMuzzle;
  expect(
    new Vector3().fromArray(gunMuzzle).distanceTo(F15C_MUZZLE),
  ).toBeLessThan(1e-6);
  for (let i = 1; i <= 6; i++)
    expect(scene.getObjectByName(`Gun_barrel_${i}`)).toBeDefined();
  // Every moving part turns about the hinge it declares.
  for (const name of ["Airbrake", "Canopy", "Rudder_Left", "Flap_Right", "Aileron_Left", "Stabilator_Right"]) {
    const node = scene.getObjectByName(name)!;
    expect(
      node
        .getWorldPosition(new Vector3())
        .distanceTo(new Vector3().fromArray(node.userData.hinge)),
    ).toBeLessThan(1e-5);
  }
});

test("F-15C rendered wheel carriers exactly follow flight contact kinematics through the full cycle", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const mechanisms = new F15CMechanisms(scene);
  for (const extension of [1, 0.9, 0.75, 0.5, 0.25, 0.1, 0, 0.5, 1]) {
    mechanisms.apply({
      gear: extension,
      roll: 0,
      pitch: 0,
      yaw: 0,
      flaps: 0,
      canopy: 0,
      speedBrake: 0,
    });
    scene.updateMatrixWorld(true);
    for (const [index, name] of [
      "Wheel_Left",
      "Wheel_Right",
      "Wheel_Nose",
    ].entries()) {
      const wheel = scene.getObjectByName(name)!;
      const expected = wheelPose("f15c", index, extension);
      expect(
        wheel.getWorldPosition(new Vector3()).distanceTo(expected.center),
      ).toBeLessThan(0.00001);
      expect(
        new Box3()
          .setFromObject(wheel)
          .getCenter(new Vector3())
          .distanceTo(expected.center),
      ).toBeLessThan(0.0001);
    }
  }
});

test("F-15C Vulcan has six longer gunmetal-grey barrels with the firing point ahead of their tips", async () => {
  const { scene } = await new GLTFLoader().parseAsync(
    await Bun.file(asset).arrayBuffer(),
    "",
  );
  refineAircraftMaterials(scene);
  scene.updateMatrixWorld(true);
  for (let i = 1; i <= 6; i++) {
    const barrel = scene.getObjectByName(`Gun_barrel_${i}`)!;
    const size = new Box3().setFromObject(barrel).getSize(new Vector3());
    expect(size.z).toBeGreaterThan(0.46);
    expect(size.z).toBeLessThan(0.47);
    const face = new Box3().setFromObject(
      scene.getObjectByName(`Gun_muzzle_face_${i}`)!,
    );
    expect(face.min.z).toBeCloseTo(F15C_MUZZLE.z + 0.027, 3);
    expect(face.min.z - F15C_MUZZLE.z).toBeGreaterThan(0.02);
  }
  let checked = 0;
  scene.traverse((node) => {
    if (
      !(node instanceof Mesh) ||
      !/^(Gun_(barrel|muzzle_face|support|recess_liner)|M61_)/.test(node.name)
    )
      return;
    expect(node.material).toBeInstanceOf(MeshStandardMaterial);
    const material = node.material as MeshStandardMaterial;
    if (/^Gun_(barrel|muzzle_face)_/.test(node.name)) {
      const expected = new Color("#353E43");
      for (const channel of ["r", "g", "b"] as const)
        expect(material.color[channel]).toBeCloseTo(expected[channel], 6);
    } else {
      expect(
        Math.max(material.color.r, material.color.g, material.color.b),
      ).toBeLessThan(0.05);
    }
    expect(material.roughness).toBeGreaterThanOrEqual(0.75);
    checked++;
  });
  // Eighteen gun parts plus the blurred barrel cylinder.
  expect(checked).toBe(19);
});
