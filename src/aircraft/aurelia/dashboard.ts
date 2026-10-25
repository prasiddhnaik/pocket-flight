import * as T from "three";
import { aureliaBodyAt } from "./exterior-reference";
import { aureliaCockpitLayout } from "./cockpit-layout";

/** Hull-sized coaming behind the independently sized instrument panel. */
export function makeAureliaDashboardHousing(
  scale: number,
  material: T.Material,
) {
  const root = new T.Group();
  root.name = "Dashboard_housing";
  const { panelY, panelZ } = aureliaCockpitLayout(scale);
  // Match the forward lining, inside the pressure skin. Fitting the cover to
  // the outer paint surface makes its black edge visible through that paint.
  const inset = 0.015;
  const top = panelY + 0.178 / scale;
  const rear = panelZ - 0.06 / scale;
  // End the deck where its top reaches the tapered nose shell.
  let front = -7.5,
    inside = -5.5;
  for (let i = 0; i < 50; i++) {
    const z = (front + inside) / 2;
    const [, ry, cy] = aureliaBodyAt(z);
    if (cy + ry - inset < top) front = z;
    else inside = z;
  }
  function fittedBox(
    name: string,
    y0: number,
    y1: number,
    z0: number,
    z1: number,
    steps: number,
  ) {
    const geometry = new T.BoxGeometry(2, 1, 1, 32, 4, steps);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const y = T.MathUtils.lerp(y0, y1, positions.getY(i) + 0.5);
      const z = T.MathUtils.lerp(z0, z1, positions.getZ(i) + 0.5);
      const [rx, ry, cy] = aureliaBodyAt(z);
      const width =
        (rx - inset) *
        Math.sqrt(Math.max(0, 1 - ((y - cy) / (ry - inset)) ** 2));
      positions.setXYZ(i, positions.getX(i) * width, y, z);
    }
    geometry.computeVertexNormals();
    const mesh = new T.Mesh(geometry, material);
    mesh.name = name;
    mesh.castShadow = mesh.receiveShadow = true;
    root.add(mesh);
  }
  fittedBox(
    "Dashboard_forward_deck",
    top - 0.035 / scale,
    top,
    inside,
    rear,
    96,
  );
  fittedBox(
    "Dashboard_full_width_fascia",
    panelY - 0.16 / scale,
    top,
    rear - 0.035,
    rear,
    4,
  );
  root.userData = {
    panelY,
    deckTopY: top,
    deckFrontZ: inside,
    deckRearZ: rear,
  };
  return root;
}
