import { describe, expect, test } from "bun:test";
import * as T from "three";
import {
  aureliaBodyAt as hullAt,
  aureliaInteriorLayout as layout,
} from "../src/aircraft/aurelia/exterior-reference";
import { makeAureliaInterior } from "../src/aircraft/aurelia/interior";

import {
  aureliaCockpitLayout,
  aureliaPilotEye,
} from "../src/aircraft/aurelia/cockpit-layout";

function meshes(root: T.Object3D) {
  const result: T.Mesh[] = [];
  root.traverse((o) => {
    if (o instanceof T.Mesh) result.push(o);
  });
  return result;
}

describe("Phenom-derived interior geometry", () => {
  test("all seat pedestals meet the actual floor at their mounting footprint", () => {
    const root = makeAureliaInterior();
    root.traverse((seat) => {
      const pilot = seat.userData.role === "pilot-seat";
      if (!pilot && seat.userData.role !== "passenger-seat") return;
      const pedestal = seat.getObjectByName(
        pilot ? "Pilot_pedestal" : "Pedestal",
      )!;
      const floor = root.getObjectByName(
        pilot ? "Cockpit_floor" : "Cabin_floor",
      )!;
      const box = new T.Box3().setFromObject(pedestal);
      const centre = box.getCenter(new T.Vector3());
      for (const dx of [-0.035, 0, 0.035])
        for (const dz of [-0.06, 0, 0.06]) {
          const hit = new T.Raycaster(
            new T.Vector3(centre.x + dx, box.min.y + 0.01, centre.z + dz),
            new T.Vector3(0, -1, 0),
            0,
            0.25,
          ).intersectObject(floor, true)[0];
          expect(hit, `${seat.name}: floor under mount`).toBeDefined();
          expect(
            hit?.distance,
            `${seat.name}: pedestal-to-floor gap`,
          ).toBeLessThanOrEqual(0.014);
        }
    });
  });
  test("lower cabin lining joins the floor without open side strips", () => {
    const root = makeAureliaInterior();
    for (const z of [-3.2, -2.2, -1.2, 0, 1, 2, 2.8])
      for (const y of [
        layout.floorY + 0.02,
        layout.floorY + 0.08,
        layout.floorY + 0.14,
      ])
        for (const side of [-1, 1]) {
          const liner = root.getObjectByName(
            `Cabin_liner_${side < 0 ? "Left" : "Right"}`,
          )!;
          const hits = new T.Raycaster(
            new T.Vector3(0, y, z),
            new T.Vector3(side, 0, 0),
            0,
            1,
          ).intersectObject(liner, true);
          expect(hits.length, `lower wall ${side},${y},${z}`).toBeGreaterThan(
            0,
          );
        }
  });
  test("walking floors have one common height and no step or open joint", () => {
    const root = makeAureliaInterior();
    const floors = [
      "Cockpit_floor",
      "Entry_vestibule_floor",
      "Cabin_floor",
    ].map((name) => root.getObjectByName(name)!);
    const heights: number[] = [];
    for (const x of [-0.3, 0, 0.3])
      for (let i = 0; i <= 300; i++) {
        const z = T.MathUtils.lerp(-4.7, 2.8, i / 300);
        const hits = new T.Raycaster(
          new T.Vector3(x, 1.8, z),
          new T.Vector3(0, -1, 0),
          0,
          0.6,
        ).intersectObjects(floors, true);
        expect(hits.length, `floor coverage ${x},${z}`).toBeGreaterThan(0);
        heights.push(hits[0].point.y);
      }
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.00001);
    expect(root.getObjectByName("Cockpit_step_riser")).toBeUndefined();
  });
  test("the level floor preserves the 1.50 m maximum cabin headroom", () => {
    const root = makeAureliaInterior();
    const floor = new T.Box3().setFromObject(
      root.getObjectByName("Cabin_floor")!,
    );
    const lining = new T.Box3().setFromObject(
      root.getObjectByName("Cabin_liner_Right")!,
    );
    expect(lining.max.y - floor.max.y).toBeCloseTo(1.5, 5);
  });
  test("aft separation closes the floor, side and ceiling gaps", () => {
    const root = makeAureliaInterior();
    const bulkhead = root.getObjectByName("Baggage_separation")!;
    for (const [x, y] of [
      [0, layout.floorY + 0.02],
      [-0.3, layout.floorY + 0.04],
      [0.3, layout.floorY + 0.04],
      [0, 2.92],
      [-0.3, 2.8],
      [0.3, 2.8],
      [-0.62, 2.1],
      [0.62, 2.1],
    ]) {
      const hits = new T.Raycaster(
        new T.Vector3(x, y, 2.75),
        new T.Vector3(0, 0, 1),
        0,
        0.2,
      ).intersectObject(bulkhead, true);
      expect(hits.length, `aft closure ${x},${y}`).toBeGreaterThan(0);
    }
  });
  test("fixed cabin furniture has supports down to the floor", () => {
    const root = makeAureliaInterior();
    for (const [name, side, z] of [
      ["Forward_refreshment_center", 1, -3.09],
      ["Forward_locker", -1, -3.1],
      ["Aft_lavatory", 1, 2.42],
      ["Aft_lavatory", -1, 2.4],
    ] as const) {
      const hits = new T.Raycaster(
        new T.Vector3(0, layout.floorY + 0.01, z),
        new T.Vector3(side, 0, 0),
        0,
        0.75,
      ).intersectObject(root.getObjectByName(name)!, true);
      expect(hits.length, `${name}: floor support`).toBeGreaterThan(0);
    }
  });
  test("returns the named SI interior and documented seat arrangement", () => {
    const root = makeAureliaInterior();
    expect(root.name).toBe("Interior");
    expect(root.userData.cabinWidth).toBe(1.55);
    expect(root.userData.cabinHeight).toBe(1.5);
    const passengers: T.Object3D[] = [],
      pilots: T.Object3D[] = [];
    root.traverse((o) => {
      if (o.userData.role === "passenger-seat") passengers.push(o);
      if (o.userData.role === "pilot-seat") pilots.push(o);
    });
    expect(passengers).toHaveLength(6);
    expect(pilots).toHaveLength(2);
    expect(
      passengers.filter((o) => o.userData.direction === "+Z"),
    ).toHaveLength(2);
    expect(root.getObjectByName("Forward_refreshment_center")).toBeDefined();
    expect(root.getObjectByName("Aft_lavatory")).toBeDefined();
    const displays: T.Object3D[] = [];
    root.traverse((o) => {
      if (o.userData.avionicsDisplay) displays.push(o);
    });
    expect(displays).toHaveLength(5);
  });
  test("has finite positions and normals on every mesh", () => {
    for (const m of meshes(makeAureliaInterior()))
      for (const key of ["position", "normal"]) {
        const p = m.geometry.getAttribute(key);
        expect(p, m.name + " " + key).toBeDefined();
        for (let i = 0; i < p.array.length; i++)
          if (!Number.isFinite(p.array[i]))
            throw Error(m.name + " " + key + " non-finite at " + i);
      }
  });
  test("sampled vertices fit the exterior pressure-shell envelope", () => {
    const root = makeAureliaInterior(),
      v = new T.Vector3();
    let max = 0;
    const failures: string[] = [];
    for (const m of meshes(root)) {
      const p = m.geometry.getAttribute("position");
      for (let i = 0; i < p.count; i++) {
        v.fromBufferAttribute(p, i).applyMatrix4(m.matrixWorld);
        const [rx, ry, cy] = hullAt(v.z);
        const q = (v.x / rx) ** 2 + ((v.y - cy) / ry) ** 2;
        max = Math.max(max, q);
        if (q > 1.008) {
          failures.push(
            `${m.name}: ${v
              .toArray()
              .map((n) => n.toFixed(3))
              .join(",")} q=${q.toFixed(4)}`,
          );
          break;
        }
      }
    }
    expect(failures.join("\n")).toBe("");
    expect(max).toBeLessThanOrEqual(1.008);
  });
  test("seat envelopes preserve a 0.30 m centre aisle", () => {
    const root = makeAureliaInterior();
    root.traverse((o) => {
      if (o.userData.role !== "passenger-seat") return;
      const b = new T.Box3().setFromObject(o);
      expect(
        Math.min(Math.abs(b.min.x), Math.abs(b.max.x)),
      ).toBeGreaterThanOrEqual(0.149);
    });
    for (const name of [
      "Forward_refreshment_center",
      "Stowed_table_Left",
      "Stowed_table_Right",
    ]) {
      const o = root.getObjectByName(name);
      expect(o).toBeDefined();
      if (!o) continue;
      const b = new T.Box3().setFromObject(o);
      expect(Math.min(Math.abs(b.min.x), Math.abs(b.max.x))).toBeGreaterThan(
        0.15,
      );
    }
  });
  test("declared seated occupant reference volumes fit the pressure shell", () => {
    const root = makeAureliaInterior(),
      v = new T.Vector3();
    const sphere = new T.SphereGeometry(1, 16, 10);
    const people: { name: string; head: T.Vector3; feet: T.Vector3[] }[] = [];
    root.traverse((o) => {
      if (o.userData.role === "passenger-seat") {
        const forward = o.userData.direction === "-Z" ? -1 : 1;
        people.push({
          name: o.name,
          head: new T.Vector3(
            o.position.x,
            layout.floorY + 1.19,
            o.position.z - forward * 0.12,
          ),
          feet: [-1, 1].map(
            (side) =>
              new T.Vector3(
                o.position.x + side * 0.09,
                layout.floorY + 0.11,
                o.position.z + forward * 0.7,
              ),
          ),
        });
      }
      if (o.userData.role === "pilot-seat")
        people.push({
          name: o.name,
          head: new T.Vector3(...aureliaPilotEye(1, Math.sign(o.position.x))),
          feet: [-1, 1].map(
            (side) =>
              new T.Vector3(
                Math.sign(o.position.x) * aureliaCockpitLayout(1).pedalX +
                  side * aureliaCockpitLayout(1).pedalSpacing,
                1.57,
                aureliaCockpitLayout(1).pedalZ,
              ),
          ),
        });
    });
    expect(people).toHaveLength(8);
    for (const person of people) {
      const positions = sphere.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        v.fromBufferAttribute(positions, i)
          .multiplyScalar(0.1)
          .add(person.head);
        const [rx, ry, cy] = hullAt(v.z);
        expect(
          (v.x / rx) ** 2 + ((v.y - cy) / ry) ** 2,
          person.name + " head reference",
        ).toBeLessThan(1);
      }
      for (const foot of person.feet) {
        const [rx, ry, cy] = hullAt(foot.z);
        expect(
          (foot.x / rx) ** 2 + ((foot.y - cy) / ry) ** 2,
          person.name + " pedal/foot reference",
        ).toBeLessThan(1);
      }
    }
    sphere.dispose();
  });
  test("twelve reveal groups match exterior aperture centres", () => {
    const root = makeAureliaInterior(),
      reveals: T.Object3D[] = [];
    root.traverse((o) => {
      if (o.userData.opening) reveals.push(o);
    });
    expect(reveals).toHaveLength(12);
    for (let i = 0; i < 6; i++)
      expect(
        reveals.filter(
          (o) => Math.abs(o.userData.windowZ - (-2.9 + i * 1.04)) < 1e-8,
        ),
      ).toHaveLength(2);
    for (const reveal of reveals) {
      const b = new T.Box3().setFromObject(reveal);
      expect(b.max.z - b.min.z).toBeCloseTo(0.45, 5);
    }
    for (const side of [-1, 1])
      for (let i = 0; i < 6; i++) {
        const z = -2.9 + i * 1.04,
          liner = root.getObjectByName(
            "Cabin_liner_" + (side < 0 ? "Left" : "Right"),
          );
        expect(liner).toBeDefined();
        if (!liner) continue;
        const direction = new T.Vector3(
          side * 0.775 * Math.sin(1.23),
          0.74 * Math.cos(1.23),
          0,
        ).normalize();
        const ray = new T.Raycaster(
          new T.Vector3(0, 2.08, z),
          direction,
          0,
          1.1,
        );
        expect(
          ray.intersectObject(liner, true),
          "open window ray " + side + " " + i,
        ).toHaveLength(0);
      }
  });
});
