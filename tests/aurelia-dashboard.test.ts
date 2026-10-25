import { expect, test } from "bun:test";
import * as T from "three";
import {
  aureliaAirframeScale,
  aureliaBodyAt,
} from "../src/aircraft/aurelia/exterior-reference";
import { aureliaCockpitLayout } from "../src/aircraft/aurelia/cockpit-layout";
import { makeAureliaReference } from "../src/aircraft/aurelia/reference-model";

for (const scale of [1, aureliaAirframeScale]) {
  test(`dashboard is lower with a continuous hull-fitted deck at scale ${scale}`, () => {
    const root = makeAureliaReference(scale).root;
    root.updateMatrixWorld(true);
    const panel = root.getObjectByName("Instrument_panel")!;
    const centre = panel.getWorldPosition(new T.Vector3());
    expect(centre.y).toBeCloseTo(1.97 * scale, 8);
    expect(centre.z).toBeCloseTo(aureliaCockpitLayout(scale).panelZ * scale, 8);
    expect(2.075 * scale - centre.y).toBeCloseTo(0.105 * scale, 8);
    expect(panel.getWorldScale(new T.Vector3()).toArray()).toEqual([1, 1, 1]);
    const housing = root.getObjectByName("Dashboard_housing")!;
    const deck = root.getObjectByName("Dashboard_forward_deck") as T.Mesh;
    const top = Number(housing.userData.deckTopY);
    const front = Number(housing.userData.deckFrontZ),
      rear = Number(housing.userData.deckRearZ);
    const ray = new T.Raycaster();
    // Test complete width from both shoulders and centre at every centimetre.
    let probes = 0;
    for (let z = front + 0.01; z < rear - 0.001; z += 0.01) {
      const [rx, ry, cy] = aureliaBodyAt(z);
      const width =
        (rx - 0.015) * Math.sqrt(1 - ((top - cy) / (ry - 0.015)) ** 2);
      for (const fraction of [-0.98, -0.8, -0.5, 0, 0.5, 0.8, 0.98]) {
        ray.set(
          new T.Vector3(
            width * fraction * scale,
            (top + 0.1) * scale,
            z * scale,
          ),
          new T.Vector3(0, -1, 0),
        );
        const hits = ray.intersectObject(deck);
        expect(hits.length, `deck hole x=${fraction} z=${z}`).toBeGreaterThan(
          0,
        );
        expect(hits[0].point.y).toBeCloseTo(top * scale, 6);
        probes++;
      }
    }
    expect(probes).toBeGreaterThan(180);
    expect(top).toBeGreaterThan(aureliaCockpitLayout(scale).panelY);
  });
}
