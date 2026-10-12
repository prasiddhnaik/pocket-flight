import * as T from "three";

/** Sample the actual fixed wing skin in aircraft coordinates, without changing materials. */
export function wingSection(
  root: T.Object3D,
  wing: T.Object3D,
  x: number,
  z: number,
) {
  const inverse = root.matrixWorld.clone().invert();
  const ray = new T.Raycaster(new T.Vector3(x, 4, z), new T.Vector3(0, -1, 0));
  const material = new T.MeshBasicMaterial({ side: T.DoubleSide });
  const hits: number[] = [];
  wing.traverse((node) => {
    if (!(node instanceof T.Mesh) || !/Paint/.test(node.name)) return;
    const skin = new T.Mesh(node.geometry, material);
    skin.matrixWorld.multiplyMatrices(inverse, node.matrixWorld);
    for (const hit of ray.intersectObject(skin, false)) hits.push(hit.point.y);
  });
  material.dispose();
  if (hits.length < 2) throw new Error(`No closed wing skin at ${x}, ${z}`);
  return { lower: Math.min(...hits), upper: Math.max(...hits) };
}

export function internalControlMount(root: T.Object3D, control: T.Object3D) {
  const inverse = root.matrixWorld.clone().invert();
  const hinge = control.getWorldPosition(new T.Vector3()).applyMatrix4(inverse);
  const box = new T.Box3().setFromObject(control).applyMatrix4(inverse);
  const x = T.MathUtils.lerp(hinge.x, box.getCenter(new T.Vector3()).x, 0.3);
  const wing = control.parent!;
  // The horn projects forward into the wing. Its short radius stays inside the
  // skin throughout rotation; the trainer uses a pushrod, not a hydraulic ram.
  const movingZ = hinge.z - 0.055;
  const fixedZ = hinge.z - 0.27;
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
  return { fixed, moving, wing };
}
