import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Box3, DoubleSide, Mesh, MeshBasicMaterial, Object3D, Raycaster, Vector3 } from "three";
import { F15CMechanisms } from "../src/aircraft/f15c/mechanisms";
import { F15C_NOZZLE, f15cGeometry } from "../src/aircraft/f15c/design";
import { f15cLayout } from "../src/aircraft/f15c/effects";
import { f15cEmissionDatum } from "../src/flight/flight-vfx";
import { backupSkinScene, frozenFlightGeometry, skinBuildCommand } from "../scripts/f15c-skin-step";
import { validateReplay } from "../src/replay/replay-data";
import { loadGeometryOnly } from "../scripts/geometry-loader";

const asset = new URL("../public/assets/f15c-eagle.glb", import.meta.url);

test("flight numbers are frozen", () => {
  expect(f15cGeometry.wingArea).toBe(61.56022521316562);
  expect(f15cGeometry.meanAerodynamicChord).toBe(5.250250398235864);
  expect(f15cGeometry.quarterChordZ).toBe(1.2957202936056007);
});

test("model stays within budget", async () => {
  const { scene } = await loadGeometryOnly(asset);
  let triangles = 0;
  scene.traverse((node) => {
    if (!(node instanceof Mesh)) return;
    triangles += (node.geometry.index?.count ?? node.geometry.getAttribute("position").count) / 3;
  });
  expect(triangles).toBeLessThanOrEqual(506380);
  expect(statSync(asset).size).toBeLessThanOrEqual(13416284);
});

// The geometry-only loader leaves meshes without materials, which rays skip.
const solid = new MeshBasicMaterial({ side: DoubleSide });
const meshes = (scene: Object3D, match: RegExp) => {
  const found: Mesh[] = [];
  scene.traverse((node) => {
    // A part with two finishes loads as a group of one mesh per finish.
    if (!(node instanceof Mesh) || !(match.test(node.name) || match.test(node.parent?.name ?? ""))) return;
    node.material = solid;
    found.push(node);
  });
  return found;
};
const rayUp = new Vector3(0, 1, 0);
const rayDown = new Vector3(0, -1, 0);

const closedBelly = (scene: Object3D) => {
  new F15CMechanisms(scene).apply({ roll: 0, pitch: 0, yaw: 0, gear: 0, flaps: 0, canopy: 0, speedBrake: 0 });
  scene.updateMatrixWorld(true);
  return meshes(scene, /^(Fuselage|Door_.*_skin)$/);
};

test("closed doors sit flush", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const belly = closedBelly(scene);
  const ray = new Raycaster();
  const height = (x: number, z: number) => {
    ray.set(new Vector3(x, -6, z), rayUp);
    return ray.intersectObjects(belly, false)[0]?.point.y;
  };
  let checked = 0;
  for (const door of meshes(scene, /^Door_.*_skin$/)) {
    const box = new Box3().setFromObject(door);
    for (let k = 1; k < 8; k++) {
      const u = box.min.x + ((box.max.x - box.min.x) * k) / 8;
      const v = box.min.z + ((box.max.z - box.min.z) * k) / 8;
      for (const [inX, inZ, outX, outZ] of [
        [box.min.x + 0.01, v, box.min.x - 0.03, v],
        [box.max.x - 0.01, v, box.max.x + 0.03, v],
        [u, box.min.z + 0.01, u, box.min.z - 0.03],
        [u, box.max.z - 0.01, u, box.max.z + 0.03],
      ]) {
        const inside = height(inX, inZ),
          outside = height(outX, outZ);
        expect(inside).toBeDefined();
        expect(outside).toBeDefined();
        expect(Math.abs(inside! - outside!)).toBeLessThan(0.03);
        checked++;
      }
    }
  }
  expect(checked).toBeGreaterThan(200);
}, 120000);

test("the belly has no open holes with the gear up", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const belly = closedBelly(scene);
  const ray = new Raycaster();
  const holes: string[] = [];
  for (const sign of [-1, 1])
    for (let x = 0.12; x < 1.17; x += 0.07)
      for (let z = -0.2; z < 2.82; z += 0.1) {
        ray.set(new Vector3(sign * x, -6, z), rayUp);
        const hit = ray.intersectObjects(belly, false)[0];
        if (!hit || hit.point.y > -0.5) holes.push(`${(sign * x).toFixed(2)},${z.toFixed(2)}:${hit?.point.y.toFixed(2)}`);
      }
  expect(holes).toEqual([]);
}, 120000);

test("the main gear is mounted in the body", async () => {
  const { scene } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  const body = meshes(scene, /^Fuselage$/);
  const ray = new Raycaster();
  for (const name of ["Mount_Left", "Mount_Right"]) {
    const centre = new Box3().setFromObject(scene.getObjectByName(name)!).getCenter(new Vector3());
    // Inside solid body, a ray leaves through the skin in every direction without meeting a well first.
    for (const direction of [rayUp, rayDown, new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, 1), new Vector3(0, 0, -1)]) {
      ray.set(centre, direction);
      const hit = ray.intersectObjects(body, false)[0];
      expect(hit).toBeDefined();
      expect(hit.face!.normal.clone().transformDirection(hit.object.matrixWorld).dot(direction)).toBeGreaterThan(0);
    }
  }
});

test("aft gear doors stay clear of the aft body missiles at every gear position", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const mechanisms = new F15CMechanisms(scene);
  for (const gear of [1, 0.5, 0]) {
    mechanisms.apply({ roll: 0, pitch: 0, yaw: 0, gear, flaps: 0, canopy: 0, speedBrake: 0 });
    scene.updateMatrixWorld(true);
    for (const [side, sign] of [["Left", -1], ["Right", 1]] as const) {
      const door = new Box3().setFromObject(scene.getObjectByName(`Door_${side}_Aft_skin`)!);
      const station = scene.getObjectByName(`Store_aim120_${side}_aft`)!.getWorldPosition(new Vector3());
      const missileInner = Math.abs(station.x) - 0.089;
      const reach = sign > 0 ? door.max.x : -door.min.x;
      expect(reach).toBeLessThan(missileInner);
      // Opening swings it down, not up into the well.
      if (gear === 1) expect(door.min.y).toBeLessThan(-1.15);
    }
  }
});

test("gear folds inside the body", async () => {
  const { scene } = await loadGeometryOnly(asset);
  const mechanisms = new F15CMechanisms(scene);
  mechanisms.apply({ roll: 0, pitch: 0, yaw: 0, gear: 0, flaps: 0, canopy: 0, speedBrake: 0 });
  scene.updateMatrixWorld(true);
  const closedBelow = meshes(scene, /^(Fuselage|Door_.*_skin)$/);
  const closedAbove = meshes(scene, /^(Fuselage|Airbrake_panel|Gun_port_fairing|Wing_fixed_(Left|Right))$/);
  const ray = new Raycaster();
  const vertex = new Vector3();
  let checked = 0;
  for (const part of meshes(scene, /^(Nose|Left|Right)_Tire$/)) {
    const position = part.geometry.getAttribute("position");
    const step = Math.ceil(position.count / 24);
    for (let i = 0; i < position.count; i += step) {
      vertex.fromBufferAttribute(position, i).applyMatrix4(part.matrixWorld);
      ray.set(new Vector3(vertex.x, -6, vertex.z), rayUp);
      const below = ray.intersectObjects(closedBelow, false)[0];
      expect(below).toBeDefined();
      expect(below.point.y).toBeLessThan(vertex.y + 0.03);
      ray.set(new Vector3(vertex.x, 8, vertex.z), rayDown);
      const above = ray.intersectObjects(closedAbove, false)[0];
      expect(above).toBeDefined();
      expect(above.point.y).toBeGreaterThan(vertex.y - 0.03);
      checked++;
    }
  }
  expect(checked).toBeGreaterThan(40);
}, 120000);

test("a saved replay from before the new skin still plays", async () => {
  const frame = (t: number) => ({
    t,
    worldTime: t,
    p: [0, 10, 0],
    q: [0, 0, 0, 1],
    throttle: 0.5,
    speed: 100,
    suspension: 0,
    gearDamage: 0,
    propAngle: 0,
    propRpm: 0,
    surfaces: { pitch: 0, roll: 0, yaw: 0 },
    propVisible: true,
    gearVisible: true,
    wings: [true, true],
    engineOut: false,
    night: false,
    ring: 0,
    jet: { rpm: 0.6, burner: 0, gear: 1, flaps: 0, canopy: 0, speedBrake: 0, gunAngle: 1.2, gunSpeed: 100 },
    debris: [],
  });
  const replay = { schemaVersion: 1, id: "old", name: "Old", aircraft: "f15c", paint: 0, mission: "free", createdAt: 1, updatedAt: 1, duration: 1, trimmed: false, frames: [frame(0), frame(1)] };
  expect(validateReplay(replay)).toBe(true);
  const { scene } = await loadGeometryOnly(asset);
  const mechanisms = new F15CMechanisms(scene);
  expect(() => mechanisms.apply({ roll: 1, pitch: 1, yaw: 1, gear: 0.5, flaps: 1, canopy: 1, speedBrake: 1, power: 1, burner: 1, gunAngle: 1.2 })).not.toThrow();
  for (const name of ["Rudder_Left", "Aileron_Right", "Flap_Left", "Stabilator_Right", "Airbrake", "Canopy", "Gear_Nose", "Door_Nose_Forward"])
    expect(scene.getObjectByName(name)).toBeDefined();
});

test("stations sit where the references put them", async () => {
  const { scene } = await loadGeometryOnly(asset);
  scene.updateMatrixWorld(true);
  const at = (name: string) => {
    const node = scene.getObjectByName(name);
    expect(node).toBeDefined();
    return node!.getWorldPosition(new Vector3());
  };
  for (const [side, sign] of [["Left", -1], ["Right", 1]] as const) {
    for (const [slot, x] of [["inner", 2.55], ["outer", 3.03]] as const) {
      const station = at(`Store_aim9_${side}_${slot}`);
      expect(station.x * sign).toBeCloseTo(x, 1);
      // Noses reach about 0.9 m ahead of the leading edge there.
      expect(station.z).toBeCloseTo(-0.92, 1);
    }
    const forward = at(`Store_aim120_${side}_fwd`), aft = at(`Store_aim120_${side}_aft`);
    expect(forward.x * sign).toBeCloseTo(1.25, 1);
    expect(aft.x * sign).toBeLessThan(1.3);
    expect(forward.z).toBeCloseTo(-1.75, 1);
    expect(aft.z).toBeCloseTo(2.2, 1);
    for (const part of [`Pylon_${side}`, `Pylon_rail_${side}_inner`, `Pylon_rail_${side}_outer`, `Launcher_${side}_fwd`, `Launcher_${side}_aft`])
      expect(scene.getObjectByName(part)).toBeInstanceOf(Mesh);
  }
});

test("damage smoke, contrails and wingtip vortices start at the new nozzles and wing tips", () => {
  expect(f15cEmissionDatum.exhaust).toEqual([F15C_NOZZLE.x, F15C_NOZZLE.y, F15C_NOZZLE.exit]);
  expect(f15cEmissionDatum.wing).toEqual([...f15cLayout.wingtip]);
});

test("a CAD rebuild keeps the frozen flight numbers", () => {
  const current = { wingArea: 61.56, stations: [{ x: 0 }], revision: "kept" };
  expect(frozenFlightGeometry(current, { wingArea: 50, stations: [{ x: 1 }], revision: "new" })).toBe(current);
  const next = { wingArea: 50, stations: [], revision: "new" };
  expect(frozenFlightGeometry(current, next, true)).toBe(next);
});

test("a skin build fails loudly and keeps the previous hand-editable scene", () => {
  const args = skinBuildCommand("blender", "skin.py");
  const flag = args.indexOf("--python-exit-code");
  // The flag must come before --python, and be non-zero.
  expect(flag).toBeGreaterThan(0);
  expect(Number(args[flag + 1])).toBeGreaterThan(0);
  expect(flag).toBeLessThan(args.indexOf("--python"));
  const folder = mkdtempSync(join(tmpdir(), "f15c-skin-"));
  const blend = join(folder, "skin.blend");
  const backups = join(folder, "backups");
  expect(backupSkinScene(blend, backups, 1)).toBeNull();
  writeFileSync(blend, "sculpted");
  const saved = backupSkinScene(blend, backups, 2)!;
  expect(readFileSync(saved, "utf8")).toBe("sculpted");
  writeFileSync(blend, "rebuilt");
  expect(readFileSync(backupSkinScene(blend, backups, 3)!, "utf8")).toBe("rebuilt");
  expect(readFileSync(saved, "utf8")).toBe("sculpted");
  rmSync(folder, { recursive: true });
});
