import { BufferGeometry, InstancedMesh, Matrix4, Mesh, Object3D } from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Bake compatible static meshes into root coordinates. Keep glazing separate
// for transparent sorting, and preserve movable chamber hardware and wing filters.
export function batchStaticMeshes(
  root: Object3D,
  movable = /^(Fan_Rotor|Pitch_Rig)$/,
) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const groups = new Map<string, { meshes: Mesh[]; wing: boolean }>();
  root.traverse((node) => {
    if (
      !(node instanceof Mesh) ||
      node instanceof InstancedMesh ||
      Array.isArray(node.material) ||
      node.material.transparent ||
      node.type !== "Mesh" ||
      node.matrixWorld.determinant() < 0 ||
      Object.keys(node.geometry.morphAttributes).length
    )
      return;
    let wing = false;
    for (
      let ancestor: Object3D | null = node;
      ancestor && ancestor !== root;
      ancestor = ancestor.parent
    ) {
      if (
        !ancestor.visible ||
        ancestor.userData.mechanical ||
        movable.test(ancestor.name)
      )
        return;
      if (/^Wing_(Left|Right)$/.test(ancestor.name)) wing = true;
    }
    const attributes = Object.keys(node.geometry.attributes)
      .sort()
      .map((name) => {
        const a = node.geometry.getAttribute(name);
        return `${name}:${a.itemSize}:${a.normalized}:${a.array.constructor.name}`;
      })
      .join("|");
    const key = `${node.material.uuid}:${wing}:${!!node.userData.internal}:${node.castShadow}:${node.receiveShadow}:${node.renderOrder}:${!!node.geometry.index}:${attributes}`;
    const group = groups.get(key) ?? { meshes: [], wing };
    group.meshes.push(node);
    groups.set(key, group);
  });
  const retired = new Set<BufferGeometry>();
  let removed = 0;
  for (const { meshes, wing } of groups.values()) {
    if (meshes.length < 2) continue;
    const baked = meshes.map((mesh) =>
      mesh.geometry
        .clone()
        .applyMatrix4(
          new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld),
        ),
    );
    const geometry = mergeGeometries(baked);
    baked.forEach((g) => g.dispose());
    if (!geometry) continue;
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const source = meshes[0];
    if (Array.isArray(source.material)) {
      geometry.dispose();
      continue;
    }
    const batch = new Mesh(geometry, source.material);
    batch.name = `Static_batch_${source.material.name}`;
    batch.castShadow = source.castShadow;
    batch.receiveShadow = source.receiveShadow;
    batch.renderOrder = source.renderOrder;
    batch.userData.mainWing = wing;
    batch.userData.internal = !!source.userData.internal;
    root.add(batch);
    for (const mesh of meshes) {
      mesh.removeFromParent();
      retired.add(mesh.geometry);
    }
    removed += meshes.length - 1;
  }
  root.traverse((node) => {
    if (node instanceof Mesh) retired.delete(node.geometry);
  });
  retired.forEach((g) => g.dispose());
  return removed;
}
