import * as T from "three";
import {
  aureliaExteriorReference as reference,
} from "./exterior-reference";
import { type ExteriorKit } from "./exterior-kit";

/** T-tail: fin, rudder, tailplanes and elevators with their hinges. */
export function buildEmpennage(kit: ExteriorKit) {
  const { white, blue, group, controlHinges, foil } = kit;
  const tail = group("Empennage");
  const finSections = [
    [2.6, 0, 4.52, 2.96],
    [4.94, 0, 5.76, 1.44],
    [5.1, 0, 5.94, 1.22],
  ] as const;
  function vertical(o: T.Mesh, pivot = new T.Vector3()) {
    const p = o.geometry.getAttribute("position");
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i),
        y = p.getY(i);
      p.setXYZ(i, y - pivot.x, x - pivot.y, p.getZ(i) - pivot.z);
    }
    const index = o.geometry.index!;
    for (let i = 0; i < index.count; i += 3) {
      const b = index.getX(i + 1);
      index.setX(i + 1, index.getX(i + 2));
      index.setX(i + 2, b);
    }
    o.geometry.computeVertexNormals();
  }
  vertical(foil("Vertical_stabilizer", finSections, 0.09, blue, tail, 0, 0.73));
  const finPivot = new T.Vector3(0, 2.6, 4.52 + 2.96 * 0.75);
  const rudder = group("Rudder", tail, finPivot.toArray());
  rudder.userData.hingeAxis = new T.Vector3(
    0,
    2.5,
    5.94 + 1.22 * 0.75 - finPivot.z,
  )
    .normalize()
    .toArray();
  vertical(
    foil("Rudder_skin", finSections, 0.09, blue, rudder, 0.75, 1),
    finPivot,
  );
  controlHinges(
    "Rudder_hinge",
    rudder,
    tail,
    [0.18, 0.52, 0.85].map((t) => {
      const point = finPivot
        .clone()
        .addScaledVector(
          new T.Vector3().fromArray(rudder.userData.hingeAxis as number[]),
          t * 2.5,
        );
      point.z -= 0.07;
      return point;
    }),
    "Vertical_stabilizer",
    "Rudder_skin",
  );
  for (const side of [-1, 1]) {
    const label = side < 0 ? "Left" : "Right",
      parent = group(`Tailplane_${label}`, tail);
    const sections = [
      [side * 0.06, 5.01, 5.73, 1.48],
      [side * 1.5, 5.01, 6.28, 1.03],
      [side * (reference.tailSpan / 2), 5.01, 6.92, 0.47],
    ] as const;
    foil(`Tailplane_skin_${label}`, sections, 0.075, white, parent, 0, 0.68);
    const a = sections[0],
      b = sections[2],
      pivot = new T.Vector3(a[0], a[1], a[2] + a[3] * 0.7);
    const elevator = group(`Elevator_${label}`, parent, pivot.toArray());
    elevator.userData.hingeAxis = new T.Vector3(
      b[0] - a[0],
      0,
      b[2] + b[3] * 0.7 - pivot.z,
    )
      .normalize()
      .multiplyScalar(side)
      .toArray();
    foil(
      `Elevator_skin_${label}`,
      sections,
      0.075,
      white,
      elevator,
      0.7,
      1,
      pivot,
    );
    controlHinges(
      `Elevator_hinge_${label}`,
      elevator,
      parent,
      [0.45, 1.5, 2.6].map((x) => {
        const t = (x - Math.abs(a[0])) / (Math.abs(b[0]) - Math.abs(a[0]));
        return new T.Vector3(
          side * x,
          5.01,
          T.MathUtils.lerp(a[2] + a[3] * 0.66, b[2] + b[3] * 0.66, t),
        );
      }),
      `Tailplane_skin_${label}`,
      `Elevator_skin_${label}`,
    );
  }
}
