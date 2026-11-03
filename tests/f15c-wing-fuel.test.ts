import { expect, test } from "bun:test";
import { Box3, DoubleSide, Group, Mesh, MeshBasicMaterial, Raycaster, Vector3 } from "three";
import { f15cFuel } from "../src/aircraft/f15c/fuel";
import { F15CFuelCutaway, fuelLevelAt } from "../src/aircraft/f15c/fuel-cutaway";
import { tankState } from "../src/flight/fuel-loading";
import { aircraftDesign, massProperties } from "../src/aircraft/aircraft-design";
import { initialPreviewSettings, previewCapabilities } from "../src/viewers/aircraft-preview";
import { loadGeometryOnly } from "../scripts/geometry-loader";

const asset = new URL("../public/assets/f15c-eagle.glb", import.meta.url);
const solid = new MeshBasicMaterial({ side: DoubleSide });
const LITRES_NEEDED = 1350 / 0.8 + 25;
const SIDES = [["Left", -1, "left"], ["Right", 1, "right"]] as const;
const load = async () => {
  const { scene } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  return scene;
};
const mesh = (scene: Group, name: string) => {
  const node = scene.getObjectByName(name);
  expect(node).toBeInstanceOf(Mesh);
  return node as Mesh;
};
const litres = (part: Mesh) => {
  const position = part.geometry.getAttribute("position");
  const index = part.geometry.index!;
  const a = new Vector3(), b = new Vector3(), c = new Vector3();
  let volume = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(position, index.getX(i));
    b.fromBufferAttribute(position, index.getX(i + 1));
    c.fromBufferAttribute(position, index.getX(i + 2));
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return Math.abs(volume) * 1000;
};
const bladders = (scene: Group, side: string) => [1, 2, 3].map((n) => mesh(scene, `Wing_fuel_cell_${side}_${n}`));

for (const [side, sign, id] of SIDES) {
  test(`${side} wing holds three separate bladders with room for its fuel`, async () => {
    const scene = await load();
    const cells = bladders(scene, side);
    const total = cells.reduce((sum, cell) => sum + litres(cell), 0);
    expect(total).toBeGreaterThanOrEqual(LITRES_NEEDED);
    const boxes = cells.map((cell) => new Box3().setFromObject(cell));
    boxes.sort((a, b) => Math.abs(a.min.x + a.max.x) - Math.abs(b.min.x + b.max.x));
    for (let i = 1; i < 3; i++) {
      const inner = sign > 0 ? boxes[i - 1].max.x : -boxes[i - 1].min.x;
      const outer = sign > 0 ? boxes[i].min.x : -boxes[i].max.x;
      // A rib stands between neighbouring bladders.
      expect(outer - inner).toBeGreaterThan(0.02);
    }
    const tank = f15cFuel.tanks.find((candidate) => candidate.id === id)!;
    expect(tank.envelopeLitres).toBeGreaterThanOrEqual(LITRES_NEEDED);
    expect(Math.abs(tank.envelopeLitres - total) / total).toBeLessThan(0.03);
  }, 60000);

  test(`${side} wing skin encloses every bladder and fuel line`, async () => {
    const scene = await load();
    const wing = mesh(scene, `Wing_fixed_${side}`);
    wing.material = solid;
    const ray = new Raycaster();
    const vertex = new Vector3();
    let checked = 0;
    for (const part of [...bladders(scene, side), mesh(scene, `Wing_fuel_line_${side}_1`), mesh(scene, `Wing_fuel_line_${side}_2`)]) {
      const position = part.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i += Math.ceil(position.count / 120)) {
        vertex.fromBufferAttribute(position, i).applyMatrix4(part.matrixWorld);
        ray.set(vertex.clone().setY(8), new Vector3(0, -1, 0));
        const above = ray.intersectObject(wing)[0];
        ray.set(vertex.clone().setY(-8), new Vector3(0, 1, 0));
        const below = ray.intersectObject(wing)[0];
        expect(above?.point.y).toBeGreaterThan(vertex.y);
        expect(below?.point.y).toBeLessThan(vertex.y);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(100);
  }, 60000);

  test(`${side} wing bladders connect to each other and feed the fuselage`, async () => {
    const scene = await load();
    const feed = new Box3().setFromObject(mesh(scene, `Wing_fuel_feed_${side}`));
    const body = new Box3().setFromObject(scene.getObjectByName("Fuselage")!);
    expect(feed.intersectsBox(body)).toBe(true);
    const cells = bladders(scene, side).map((cell) => new Box3().setFromObject(cell));
    expect(feed.intersectsBox(cells[0])).toBe(true);
    for (const [line, a, b] of [[1, 0, 1], [2, 1, 2]] as const) {
      const box = new Box3().setFromObject(mesh(scene, `Wing_fuel_line_${side}_${line}`));
      expect(box.intersectsBox(cells[a])).toBe(true);
      expect(box.intersectsBox(cells[b])).toBe(true);
    }
  });

  test(`${side} wing fuel in the flight model sits inside the bladders at every level`, async () => {
    const scene = await load();
    const cells = bladders(scene, side).map((cell) => new Box3().setFromObject(cell));
    const all = cells.reduce((box, cell) => box.union(cell), new Box3());
    const tank = f15cFuel.tanks.find((candidate) => candidate.id === id)!;
    let previous = -Infinity;
    for (const sample of tank.samples) {
      const center = new Vector3().fromArray(sample.center);
      expect(all.containsPoint(center)).toBe(true);
      expect(sample.level).toBeGreaterThanOrEqual(previous);
      previous = sample.level;
    }
    expect(all.containsPoint(new Vector3().fromArray(tank.residual.center))).toBe(true);
    expect(tank.usableLitres).toBe(1350 / 0.8);
    expect(tank.usableLitres * tank.densityKgPerLitre).toBe(1350);
    expect(tankState(tank, 0.5).center[1]).toBeLessThan(tankState(tank, 1).center[1]);
  });
}

test("the two wing tanks mirror exactly, so the aircraft stays balanced", () => {
  const left = f15cFuel.tanks.find((tank) => tank.id === "left")!;
  const right = f15cFuel.tanks.find((tank) => tank.id === "right")!;
  left.samples.forEach((sample, i) => {
    expect(sample.center[0]).toBe(-right.samples[i].center[0]);
    expect(sample.center.slice(1)).toEqual(right.samples[i].center.slice(1));
  });
  const design = aircraftDesign("f15c");
  for (const fuel of [0, 0.25, 0.44, 0.65, 1]) {
    const balance = massProperties(design.massBudget, { fuel, payload: 1 });
    expect(Math.abs(balance.cg.x)).toBeLessThan(1e-9);
    // Still stable, with the same 3% floor the flight tests use.
    expect((design.neutralPointZ - balance.cg.z) / design.geometry.meanAerodynamicChord).toBeGreaterThan(0.03);
  }
});

test("the viewer offers the fuel system on the F-15C only, off by default", () => {
  expect(previewCapabilities("f15c").fuelSystem).toBe(true);
  expect(previewCapabilities("peregrine").fuelSystem).toBe(false);
  const state = initialPreviewSettings();
  expect(state.fuelSystem).toBe(false);
  expect(state.fuelLevel).toBe(1);
});

test("fuel stays hidden until the cutaway opens, and the wing skin is restored after", async () => {
  const scene = await load();
  const cutaway = new F15CFuelCutaway(scene);
  const wing = mesh(scene, "Wing_fixed_Left");
  const paint = wing.material;
  const cell = mesh(scene, "Wing_fuel_cell_Left_1");
  scene.updateMatrixWorld(true);
  expect(cell.visible).toBe(false);
  cutaway.setEnabled(true);
  expect(cell.visible).toBe(true);
  expect(wing.material).not.toBe(paint);
  expect((wing.material as MeshBasicMaterial).transparent).toBe(true);
  cutaway.setEnabled(false);
  expect(cell.visible).toBe(false);
  expect(wing.material).toBe(paint);
  cutaway.dispose();
  expect(wing.material).toBe(paint);
});

test("the fuel surface rises with the level and follows the flight model's tank", async () => {
  const left = f15cFuel.tanks.find((tank) => tank.id === "left")!;
  expect(fuelLevelAt(left, 0)).toBeCloseTo(left.samples[0].level, 6);
  expect(fuelLevelAt(left, 1)).toBeCloseTo(left.samples.at(-1)!.level, 6);
  expect(fuelLevelAt(left, 0.5)).toBeGreaterThan(fuelLevelAt(left, 0.25));
  const scene = await load();
  const cutaway = new F15CFuelCutaway(scene);
  cutaway.setEnabled(true);
  cutaway.setLevel(1);
  const full = cutaway.surfaceHeight;
  cutaway.setLevel(0.2);
  expect(cutaway.surfaceHeight).toBeLessThan(full);
  cutaway.dispose();
});
