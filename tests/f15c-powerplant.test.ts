import { expect, test } from "bun:test";
import * as T from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { F15CEffects } from "../src/aircraft/f15c/effects";
import { initialJetInput } from "../src/aircraft/jet-effects";
import { withPresentationDOM } from "./helpers/presentation-dom";
import { F15CPowerplantRig, nozzleAperture } from "../src/aircraft/f15c/powerplant-rig";
import { applyJetReplay } from "../src/replay/replay-jet";
import { JetMotion } from "../src/aircraft/jet-effects";

const asset = new URL("../public/assets/f15c-eagle.glb", import.meta.url);
test("actual F-15 nozzle tips contract at dry power and open in afterburner", () => withPresentationDOM(async () => {
  const { scene } = await loadGeometryOnly(asset);
  const petal = scene.getObjectByName("Divergent_petal_Right_1") as T.Mesh;
  const original = petal.geometry.getAttribute("position").array.slice();
  const effects = new F15CEffects(scene);
  for (let i = 0; i < 60; i++) effects.update(1 / 60, { ...initialJetInput(), throttle: .88, powerResolved: true });
  expect(Array.from(petal.geometry.getAttribute("position").array)).not.toEqual(Array.from(original));
  const dry = petal.geometry.getAttribute("position").array.slice();
  for (let i = 0; i < 120; i++) effects.update(1 / 60, { ...initialJetInput(), throttle: 1, burner: true, powerResolved: true });
  expect(Array.from(petal.geometry.getAttribute("position").array)).not.toEqual(Array.from(dry));
  effects.reset();
  expect(Array.from(petal.geometry.getAttribute("position").array)).toEqual(Array.from(original));
  effects.dispose();
}));
test("every nozzle mesh stays finite and inside its bounds, keeps fixed seats and resets without drift", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const rig = new F15CPowerplantRig(scene);
  const moving = rig.movingRoots.filter((node): node is T.Mesh => node instanceof T.Mesh);
  expect(moving).toHaveLength(156);
  const originals = moving.map(mesh => Float32Array.from(mesh.geometry.getAttribute("position").array));
  const fixed = scene.getObjectByName("Nozzle_reinforcement_Right") as T.Mesh;
  const fixedGeometry = fixed.geometry;
  const v = new T.Vector3(), n = new T.Vector3();
  for (const [power, burner] of [[.88, 0], [1, 1], [0, 1], [.4, .5], [0, 0]]) {
    rig.apply(power, burner, 0);
    for (const [index, mesh] of moving.entries()) {
      const positions = mesh.geometry.getAttribute("position"), normals = mesh.geometry.getAttribute("normal");
      for (let i = 0; i < positions.count; i++) {
        v.fromBufferAttribute(positions, i); n.fromBufferAttribute(normals, i);
        expect(Number.isFinite(v.lengthSq())).toBe(true);
        expect(mesh.geometry.boundingBox!.containsPoint(v)).toBe(true);
        expect(mesh.geometry.boundingSphere!.containsPoint(v)).toBe(true);
        expect(n.length()).toBeCloseTo(1, 5);
        const j = i * 3, original = originals[index];
        expect(v.z).toBe(original[j + 2]);
        if (v.z <= 8.63) expect([v.x, v.y]).toEqual([original[j], original[j + 1]]);
        expect(Math.hypot(v.x - original[j], v.y - original[j + 1])).toBeLessThan(.035001);
      }
    }
    expect(fixed.geometry).toBe(fixedGeometry);
  }
  rig.apply(0, 0, 0);
  moving.forEach((mesh, i) => expect(mesh.geometry.getAttribute("position").array).toEqual(originals[i]));
  const cloned = moving.map(mesh => mesh.geometry);
  let disposed = 0; cloned.forEach(geometry => geometry.addEventListener("dispose", () => disposed++));
  rig.dispose();
  expect(disposed).toBe(156);
  moving.forEach((mesh, i) => expect(mesh.geometry).not.toBe(cloned[i]));
  expect(scene.getObjectByName("Gun_barrel_1")!.parent!.name).toBe("F15C_Eagle");
});
test("nozzle schedule remains bounded during throttle cuts with lingering afterburner", () => {
  for (let power = 0; power <= 1; power += .05) for (let wet = 0; wet <= 1; wet += .05) {
    const area = nozzleAperture(power, wet);
    expect(area.throat).toBeGreaterThanOrEqual(-.012);
    expect(area.throat).toBeLessThanOrEqual(.025);
    expect(Math.abs(area.exit)).toBeLessThanOrEqual(.035);
  }
});
test("gun phase and coast are frame-rate independent; pause and legacy replay seeking are absolute", () => withPresentationDOM(() => {
  const phases: number[] = [];
  for (const fps of [20, 30, 60, 120]) {
    const effects = new F15CEffects(new T.Group());
    for (let i = 0; i < fps; i++) effects.update(1 / fps, { ...initialJetInput(), gunFiring: true });
    expect(effects.motion.gunSpeed * 30 / Math.PI).toBeCloseTo(1000, 4);
    const phase = effects.motion.gunAngle;
    effects.update(0, initialJetInput()); expect(effects.motion.gunAngle).toBe(phase);
    for (let i = 0; i < fps * 2; i++) effects.update(1 / fps, initialJetInput());
    expect(effects.motion.gunSpeed).toBeLessThan(.00001);
    expect(effects.motion.gunAngle).toBeGreaterThan(phase);
    phases.push(effects.motion.gunAngle);
    effects.dispose();
  }
  phases.forEach(phase => expect(phase).toBeCloseTo(phases[0], 10));
  const motion = new JetMotion();
  applyJetReplay(motion, { gunAngle: 12, gunSpeed: 10 }, { gunAngle: 15, gunSpeed: 20 }, .5);
  expect(motion.gunAngle).toBe(13.5);
  applyJetReplay(motion, { rpm: .5 });
  expect(motion.gunAngle).toBe(0); expect(motion.gunSpeed).toBe(0);
  expect(Object.values({ ...motion }).every(Number.isFinite)).toBe(true);
}));
test("rotating actual barrel bores clear the fixed port through a full revolution", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const rig = new F15CPowerplantRig(scene);
  const barrels = Array.from({ length: 6 }, (_, i) => scene.getObjectByName(`Gun_barrel_${i + 1}`) as T.Mesh);
  scene.traverse(node => { if (node instanceof T.Mesh) for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.side = T.DoubleSide; });
  const ray = new T.Raycaster(new T.Vector3(), new T.Vector3(0, 0, 1), 0, .4);
  for (let degrees = 0; degrees <= 360; degrees += 15) {
    rig.apply(0, 0, T.MathUtils.degToRad(degrees)); scene.updateMatrixWorld(true);
    for (const barrel of barrels) {
      barrel.geometry.computeBoundingBox();
      const center = barrel.geometry.boundingBox!.getCenter(new T.Vector3());
      for (const [x, y] of [[0, 0], [.009, 0], [-.009, 0], [0, .009], [0, -.009]]) {
        ray.ray.origin.copy(barrel.localToWorld(new T.Vector3(center.x + x, center.y + y, -2.20)));
        expect(ray.intersectObject(scene, true)).toHaveLength(0);
      }
    }
  }
  rig.dispose();
});
test("actual gun barrels rotate together while their housing stays fixed", () => withPresentationDOM(async () => {
  const { scene } = await loadGeometryOnly(asset);
  const barrel = scene.getObjectByName("Gun_barrel_1")!;
  const housing = scene.getObjectByName("Gun_port_fairing")!;
  scene.updateMatrixWorld(true);
  const initial = barrel.matrixWorld.clone(), fixed = housing.matrixWorld.clone();
  const effects = new F15CEffects(scene);
  effects.update(.017, { ...initialJetInput(), gunFiring: true });
  scene.updateMatrixWorld(true);
  expect(barrel.matrixWorld.equals(initial)).toBe(false);
  expect(housing.matrixWorld.equals(fixed)).toBe(true);
  const frozen = barrel.matrixWorld.clone();
  effects.update(0, initialJetInput()); scene.updateMatrixWorld(true);
  expect(barrel.matrixWorld.equals(frozen)).toBe(true);
  applyJetReplay(effects.motion, { gunAngle: 1.2, gunSpeed: 20 });
  effects.update(0, initialJetInput());
  expect(effects.mechanisms.powerplant.rotor.rotation.z).toBe(-1.2);
  applyJetReplay(effects.motion, {});
  effects.update(0, initialJetInput()); scene.updateMatrixWorld(true);
  expect(barrel.matrixWorld.elements).toEqual(initial.elements);
  expect(housing.matrixWorld.equals(fixed)).toBe(true);
  effects.reset(); scene.updateMatrixWorld(true);
  expect(barrel.matrixWorld.elements).toEqual(initial.elements);
  effects.dispose();
}));
