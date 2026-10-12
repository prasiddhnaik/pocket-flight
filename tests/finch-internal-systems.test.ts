import { expect, test } from "bun:test";
import * as T from "three";
import { loadGeometryOnly } from "../scripts/geometry-loader";
import { AircraftMechanics } from "../lab/mechanics";
import { wingSection } from "../lab/internal-control-link";

test("Finch wing-control hardware stays inside the skin at both control limits", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/finch-u2.glb", import.meta.url),
  );
  const rig = new AircraftMechanics(scene, "finch");
  let checked = 0;
  let minimumClearance = Infinity;
  for (const roll of [-1, 1])
    for (const flaps of [0, 1]) {
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
            const skin = wingSection(scene, wing, p.x, p.z);
            minimumClearance = Math.min(
              minimumClearance,
              p.y - skin.lower,
              skin.upper - p.y,
            );
            checked++;
          }
        }
      });
    }
  expect(checked).toBeGreaterThan(5000);
  // Verifies the cylinder surfaces, not just the commanded endpoints.
  expect(minimumClearance).toBeGreaterThan(0.004);
});

test("exported Finch retains the fixed rear partition and fitted internal system hierarchy", async () => {
  const { scene } = await loadGeometryOnly(
    new URL("../public/assets/finch-u2.glb", import.meta.url),
  );
  scene.updateWorldMatrix(true, true);
  const partition = scene.getObjectByName("RearCabinBulkhead")!;
  const fuel = scene.getObjectByName("BellyFuelBay")!;
  const dry = scene.getObjectByName("AftEquipmentBay")!;
  expect(partition).toBeTruthy();
  expect(fuel).toBeTruthy();
  expect(dry).toBeTruthy();
  const wallBounds = new T.Box3().setFromObject(partition);
  const fuelBounds = new T.Box3().setFromObject(fuel);
  const dryBounds = new T.Box3().setFromObject(dry);
  expect(wallBounds.max.y).toBeGreaterThan(0.45);
  expect(wallBounds.min.z).toBeGreaterThan(0.6);
  expect(fuelBounds.max.y).toBeLessThan(-0.28);
  expect(dryBounds.min.y).toBeGreaterThan(-0.19);
  expect(fuel.userData.envelope_litres).toBeGreaterThan(80);
  expect(fuel.userData.usable_fuel_litres).toBeLessThan(
    fuel.userData.envelope_litres,
  );
  expect(fuel.userData.physics_mass_updated).toBe(false);
  const original = partition.matrixWorld.clone();
  const rig = new AircraftMechanics(scene, "finch");
  rig.apply(
    {
      gear: 1,
      compression: 1,
      roll: 1,
      flaps: 1,
      pitch: 1,
      yaw: 1,
      canopy: 1,
      power: 1,
    },
    3,
  );
  expect(partition.matrixWorld.elements).toEqual(original.elements);
});
