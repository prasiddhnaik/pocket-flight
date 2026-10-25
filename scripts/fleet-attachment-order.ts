import * as T from "three";

/** Test small mounts before dense skins; only the offline traversal order changes. */
export function orderFleetAttachmentChecks(root: T.Object3D) {
  const weights = new Map<T.Object3D, number>();
  function weight(node: T.Object3D): number {
    const own =
      node instanceof T.Mesh
        ? (node.geometry.index?.count ??
          node.geometry.getAttribute("position").count)
        : 0;
    const total =
      own + node.children.reduce((n, child) => n + weight(child), 0);
    weights.set(node, total);
    return total;
  }
  weight(root);
  root.traverse((node) =>
    node.children.sort((a, b) => weights.get(a)! - weights.get(b)!),
  );
}
