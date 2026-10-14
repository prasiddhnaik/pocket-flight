import * as T from "three";

export function fixedWingSkins(wing: T.Object3D) {
  const meshes: T.Mesh[] = [];
  wing.traverse((node) => {
    if (
      node instanceof T.Mesh &&
      /^Wing.*(?:Paint|Airframe|Pearl|mesh_10$)/i.test(node.name)
    )
      meshes.push(node);
  });
  if (!meshes.length) throw new Error(`No fixed wing skin: ${wing.name}`);
  return meshes;
}
const sections = new WeakMap<T.Object3D, { skins: T.Mesh[]; top: number }>();

/** Sample the actual fixed wing skin in aircraft coordinates, without changing materials. */
export function wingSection(
  root: T.Object3D,
  wing: T.Object3D,
  x: number,
  z: number,
) {
  let section = sections.get(wing);
  if (!section) {
    const inverse = root.matrixWorld.clone().invert();
    const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
    const skins = fixedWingSkins(wing).map((node) => {
      const skin = new T.Mesh(node.geometry, material);
      skin.matrixWorld.multiplyMatrices(inverse, node.matrixWorld);
      return skin;
    });
    const box = new T.Box3();
    for (const skin of skins) {
      skin.geometry.computeBoundingBox();
      box.union(
        skin.geometry.boundingBox!.clone().applyMatrix4(skin.matrixWorld),
      );
    }
    material.dispose(); // CPU raycasting only; this material never allocates GPU resources.
    section = { skins, top: box.max.y + 1 };
    sections.set(wing, section);
  }
  const ray = new T.Raycaster(
    new T.Vector3(x, section.top, z),
    new T.Vector3(0, -1, 0),
  );
  const hits: number[] = [];
  for (const skin of section.skins) {
    for (const hit of ray.intersectObject(skin, false)) hits.push(hit.point.y);
  }
  if (hits.length < 2) throw new Error(`No closed wing skin at ${x}, ${z}`);
  return { lower: Math.min(...hits), upper: Math.max(...hits) };
}

export function internalControlMount(
  root: T.Object3D,
  control: T.Object3D,
  trainer = true,
) {
  const inverse = root.matrixWorld.clone().invert();
  const hinge = control.getWorldPosition(new T.Vector3()).applyMatrix4(inverse);
  const box = new T.Box3().setFromObject(control).applyMatrix4(inverse);
  const center = box.getCenter(new T.Vector3());
  const x = trainer
    ? T.MathUtils.lerp(hinge.x, center.x, 0.3)
    : hinge.x +
      Math.sign(center.x - hinge.x || hinge.x) *
        Math.min(0.15, box.getSize(new T.Vector3()).x * 0.06);
  const wing = control.parent!;
  // The horn projects forward into the wing. Its short radius stays inside the
  // skin throughout rotation; the trainer uses a pushrod, not a hydraulic ram.
  let movingZ = hinge.z - 0.055;
  if (!trainer) {
    let found = false;
    for (const inset of [0.3, 0.45, 0.65, 0.85, 1.2]) {
      try {
        const at = wingSection(root, wing, x, hinge.z - inset);
        wingSection(root, wing, x, hinge.z - inset - 0.29);
        if (at.upper - at.lower < 0.07) continue;
        movingZ = hinge.z - inset;
        found = true;
        break;
      } catch {
        /* Try a deeper trailing-edge installation, never an exterior fallback. */
      }
    }
    if (!found) throw new Error(`No internal actuator bay for ${control.name}`);
  }
  const fixedZ = movingZ - (trainer ? 0.215 : 0.29);
  const movingSkin = wingSection(root, wing, x, movingZ);
  const fixedSkin = wingSection(root, wing, x, fixedZ);
  const moving = new T.Vector3(
    x,
    (movingSkin.lower + movingSkin.upper) / 2,
    movingZ,
  );
  const fixed = new T.Vector3(
    x,
    (fixedSkin.lower + fixedSkin.upper) / 2,
    fixedZ,
  );
  const thickness = Math.min(
    movingSkin.upper - movingSkin.lower,
    fixedSkin.upper - fixedSkin.lower,
  );
  return {
    fixed,
    moving,
    wing,
    radius: trainer ? 0.005 : Math.min(0.025, thickness * 0.13),
    pivot: trainer ? undefined : moving.clone().add(new T.Vector3(0, 0, 0.04)),
  };
}
