import { expect, test } from "bun:test";
import * as T from "three";
import { aircraftCatalog } from "../lab/aircraft";
import { AircraftMechanics } from "../lab/mechanics";
import { bodySkin, type JetId } from "../scripts/fleet-internal-geometry";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { wingSampler } from "../scripts/skin-sampler";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import baseline from "./fixtures/fleet-internals-baseline.json";
import { originalFleetDocument } from "../scripts/fleet-internal-baseline";
import { aircraftSystems } from "../src/aircraft-systems";
const hash = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");

async function document(url: URL) {
  const bytes = new Uint8Array(await Bun.file(url).arrayBuffer());
  const length = url.pathname.endsWith(".glb")
    ? new DataView(bytes.buffer).getUint32(12, true)
    : 0;
  return {
    doc: JSON.parse(
      new TextDecoder().decode(length ? bytes.slice(20, 20 + length) : bytes),
    ),
    binary: length ? bytes.slice(28 + length) : null,
  };
}

for (const id of ["peregrine", "aurelia", "stormbird"] as JetId[]) {
  test(`${id}: exported internal parts fit the body and wings; original rig is preserved`, async () => {
    const filename = aircraftCatalog[id].asset;
    const current = await document(
      new URL(`../public/assets/${filename}`, import.meta.url),
    );
    const original = baseline.aircraft[id];
    const recovered = originalFleetDocument(current.doc, id);
    expect(recovered.scenes[recovered.scene ?? 0].nodes).toEqual(
      original.sceneRoots,
    );
    expect(recovered.extras.internal_systems_revision).toBeUndefined();
    for (const [key, field] of Object.entries(original.fields)) {
      expect(recovered[key].length).toBe(field.count);
      expect(hash(JSON.stringify(recovered[key]))).toBe(field.sha256);
    }
    for (const [key, field] of Object.entries(original.fields)) {
      expect(hash(JSON.stringify(current.doc[key].slice(0, field.count)))).toBe(
        field.sha256,
      );
    }
    for (const buffer of original.buffers) {
      const bytes = buffer.uri
        ? new Uint8Array(
            await Bun.file(
              new URL(`../public/assets/${buffer.uri}`, import.meta.url),
            ).arrayBuffer(),
          )
        : current.binary!;
      expect(hash(bytes)).toBe(buffer.sha256);
    }
    expect(hash(JSON.stringify(current.doc.animations ?? []))).toBe(
      original.animationsSha256,
    );
    expect(
      current.doc.scenes[current.doc.scene ?? 0].nodes.slice(
        0,
        original.sceneRoots.length,
      ),
    ).toEqual(original.sceneRoots);
    const { scene } = await loadGeometryOnly(
      new URL(`../public/assets/${filename}`, import.meta.url),
      true,
    );
    scene.updateWorldMatrix(true, true);
    const skin = bodySkin(scene, id);
    if (id === "aurelia") {
      const bays = ["ForwardEquipmentBay", "HydraulicServiceBay"].map((name) =>
        new T.Box3().setFromObject(scene.getObjectByName(name)!, true),
      );
      scene.getObjectByName("Cockpit")!.traverse((node) => {
        if (node instanceof T.Mesh) {
          const occupied = new T.Box3().setFromObject(node, true);
          for (const bay of bays)
            expect(bay.intersectsBox(occupied)).toBe(false);
        }
      });
    }
    const samplers = new Map(
      ["Left", "Right"].map((side) => {
        const name = `Wing_${side}`;
        return [name, wingSampler(scene, scene.getObjectByName(name)!)];
      }),
    );
    let checked = 0,
      clearance = Infinity;
    scene.getObjectByName("InteriorInstallation")!.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      const positions = node.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        const p = new T.Vector3()
          .fromBufferAttribute(positions, i)
          .applyMatrix4(node.matrixWorld);
        if (node.userData.installationRegion === "body")
          expect(skin.contains(p, 0.001)).toBe(true);
        else {
          const at = samplers.get(node.userData.installationRegion)!(p.x, p.z);
          clearance = Math.min(clearance, p.y - at.lower, at.upper - p.y);
        }
        checked++;
      }
    });
    expect(checked).toBeGreaterThan(20000);
    expect(clearance).toBeGreaterThan(0.001);
    const systems = scene.getObjectByName("InternalSystems")!;
    const hardware = aircraftSystems[id];
    expect(systems.userData.hardware).toEqual(hardware);
    const parts: string[] = [];
    systems.traverse((node) => {
      if (node instanceof T.Mesh) parts.push(...node.userData.parts);
    });
    expect(
      parts.filter(
        (name) =>
          name.startsWith(hardware.model) && name.includes("Ah battery "),
      ),
    ).toHaveLength(hardware.batteryCount);
    expect(
      parts.filter(
        (name) =>
          name.startsWith(hardware.model) && name.includes("avionics module"),
      ),
    ).toHaveLength(hardware.avionicsModules);
    expect(
      parts.filter(
        (name) =>
          name.startsWith(hardware.model) &&
          name.includes("hydraulic accumulator"),
      ),
    ).toHaveLength(hardware.accumulatorCount);
    expect(
      parts.filter(
        (name) =>
          name.startsWith(hardware.model) && name.includes("fuel boost pump"),
      ),
    ).toHaveLength(hardware.fuelPumpsPerWing * 2);
    expect(systems.userData.partCount).toBeGreaterThan(75);
    expect(systems.userData.physics_mass_updated).toBe(false);
    expect(systems.userData.fuelEnvelopeLitres).toBeGreaterThan(100);
    const wall = scene.getObjectByName("RearCabinBulkhead")!;
    const eye = new T.Vector3().fromArray(wall.userData.inspectionEye);
    const target = new T.Vector3().fromArray(wall.userData.inspectionTarget);
    const ray = new T.Raycaster(eye, target.sub(eye).normalize());
    const proxies: T.Mesh[] = [],
      material = new T.MeshBasicMaterial({ side: T.DoubleSide });
    scene.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      const proxy = new T.Mesh(node.geometry, material);
      proxy.name = node.name;
      proxy.matrixWorld.copy(node.matrixWorld);
      proxies.push(proxy);
    });
    expect(ray.intersectObjects(proxies, false)[0]?.object.name).toStartWith(
      "RearCabinBulkhead",
    );
    material.dispose();
    for (const [name, anchor] of Object.entries(original.anchors)) {
      const a = scene.getObjectByName(name)!;
      expect(a.matrixWorld.elements).toEqual(anchor.matrix);
      const box = new T.Box3().setFromObject(a, true);
      expect(box.min.toArray()).toEqual(anchor.min);
      expect(box.max.toArray()).toEqual(anchor.max);
    }
  }, 30000);

  test(`${id}: rendered actuator surfaces remain inside the wing throughout control travel`, async () => {
    const { scene, animations } = await loadGeometryOnly(
      new URL(`../public/assets/${aircraftCatalog[id].asset}`, import.meta.url),
      true,
    );
    const rig = new AircraftMechanics(scene, id, animations);
    const samplers = new Map(
      ["Left", "Right"].map((side) => {
        const wing = scene.getObjectByName(`Wing_${side}`)!;
        return [wing, wingSampler(scene, wing)];
      }),
    );
    const partition = scene.getObjectByName("RearCabinBulkhead")!;
    const original = partition.matrixWorld.clone();
    let checked = 0,
      clearance = Infinity;
    for (const roll of [-1, 0, 1])
      for (const flaps of [0, 0.5, 1]) {
        rig.apply(
          {
            gear: 1,
            compression: 0,
            roll,
            flaps,
            pitch: 0,
            yaw: 0,
            canopy: 0,
            power: 0,
          },
          0,
        );
        scene.traverse((node) => {
          if (!(node instanceof T.InstancedMesh)) return;
          const links = node.userData.internalControlInstances as
            { index: number; control: string }[] | undefined;
          for (const link of links ?? []) {
            const wing = scene.getObjectByName(link.control)!.parent!;
            const transform = new T.Matrix4();
            node.getMatrixAt(link.index, transform);
            transform.premultiply(node.matrixWorld);
            const positions = node.geometry.getAttribute("position");
            for (let i = 0; i < positions.count; i++) {
              const p = new T.Vector3()
                .fromBufferAttribute(positions, i)
                .applyMatrix4(transform);
              const at = samplers.get(wing)!(p.x, p.z);
              clearance = Math.min(clearance, p.y - at.lower, at.upper - p.y);
              checked++;
            }
          }
        });
      }
    console.log(
      id,
      "actuator vertices",
      checked,
      "minimum native clearance",
      clearance,
    );
    expect(checked).toBeGreaterThan(10000);
    expect(clearance).toBeGreaterThan(0.002);
    expect(partition.matrixWorld.elements).toEqual(original.elements);
    const driver = scene.getObjectByName("Internal_actuator_Aileron_Right")!;
    const rotation = driver.quaternion.clone();
    rig.apply(
      {
        gear: 1,
        compression: 0,
        roll: -1,
        flaps: 0,
        pitch: 0,
        yaw: 0,
        canopy: 0,
        power: 0,
      },
      0,
    );
    expect(driver.quaternion.equals(rotation)).toBe(false);
    expect(rig.diagnostics().internalSystems?.rearBulkhead).toBe(true);
    const installed: T.Box3[] = [];
    for (const name of [
      "FuelSystem",
      id === "aurelia" ? "ForwardEquipmentBay" : "AftEquipmentBay",
      "HydraulicServiceBay",
    ]) {
      scene.getObjectByName(name)!.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        if (
          name === "FuelSystem" &&
          typeof node.userData.envelopeLitres !== "number"
        )
          return;
        installed.push(new T.Box3().setFromObject(node, true));
      });
    }
    let gearChecks = 0;
    for (let step = 0; step <= 10; step++) {
      rig.apply(
        {
          gear: step / 10,
          compression: 0,
          roll: 0,
          flaps: 0,
          pitch: 0,
          yaw: 0,
          canopy: 0,
          power: 0,
        },
        0,
      );
      scene.getObjectByName("LandingGear")!.traverse((node) => {
        if (!(node instanceof T.Mesh)) return;
        const bounds = new T.Box3().setFromObject(node, true);
        for (const installation of installed) {
          // A broad curved outer fairing has a mostly empty bounding box.
          // Test its actual triangles against equipment volumes after the broad phase.
          if (
            /belly_fairing/.test(node.name) &&
            bounds.intersectsBox(installation)
          ) {
            const p = node.geometry.getAttribute("position"),
              ix = node.geometry.index!;
            const triangle = new T.Triangle();
            for (let i = 0; i < ix.count; i += 3) {
              [triangle.a, triangle.b, triangle.c].forEach((v, j) =>
                v
                  .fromBufferAttribute(p, ix.getX(i + j))
                  .applyMatrix4(node.matrixWorld),
              );
              expect(installation.intersectsTriangle(triangle)).toBe(false);
            }
          } else expect(bounds.intersectsBox(installation)).toBe(false);
          gearChecks++;
        }
      });
    }
    expect(gearChecks).toBeGreaterThan(500);
  }, 30000);
}

test("external GLB system buffers are loaded and included in geometry revision hashes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "fleet-internal-hash-"));
  try {
    const asset = new URL(
      "../public/assets/peregrine-hx27.glb",
      import.meta.url,
    );
    const bytes = new Uint8Array(await Bun.file(asset).arrayBuffer());
    const length = new DataView(bytes.buffer).getUint32(12, true);
    const doc = JSON.parse(
      new TextDecoder().decode(bytes.slice(20, 20 + length)),
    );
    const filename = doc.buffers[1].uri;
    const buffer = new Uint8Array(
      await Bun.file(new URL(filename, asset)).arrayBuffer(),
    );
    const copy = new URL(`file://${directory}/plane.glb`);
    await Bun.write(copy, bytes);
    await Bun.write(join(directory, filename), buffer);
    const before = await loadGeometryOnly(copy);
    expect(before.scene.getObjectByName("InternalSystems")).toBeTruthy();
    expect(before.sha256).toBe(
      createHash("sha256").update(bytes).update(buffer).digest("hex"),
    );
    buffer[0] ^= 1; // A tiny finite coordinate change only in the copied buffer.
    await Bun.write(join(directory, filename), buffer);
    const after = await loadGeometryOnly(copy);
    expect(after.sha256).not.toBe(before.sha256);
    expect(after.sha256).toBe(
      createHash("sha256").update(bytes).update(buffer).digest("hex"),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
