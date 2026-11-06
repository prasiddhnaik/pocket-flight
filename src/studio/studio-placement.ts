import {
  Box3,
  InstancedMesh,
  Matrix4,
  Mesh,
  SkinnedMesh,
  Vector3,
} from "three";
import type { Object3D } from "three";
import {
  sampleTransform,
  type SceneObject,
  type Transform,
  type Vec3,
} from "./studio-scene";

export type PlacementAction = "beside" | "ground" | "size";

/** Bounds expressed in the supplied frame, including the evaluated mesh pose. */
export function boundsInFrame(root: Object3D, frame: Matrix4): Box3 | null {
  root.updateWorldMatrix(true, true);
  const inverse = frame.clone().invert(),
    bounds = new Box3();
  root.traverseVisible((node) => {
    if (!(node instanceof Mesh)) return;
    let box: Box3 | null;
    if (node instanceof SkinnedMesh || node instanceof InstancedMesh) {
      node.computeBoundingBox();
      box = node.boundingBox;
    } else if (node.geometry.morphAttributes.position?.length) {
      box = new Box3();
      const vertex = new Vector3();
      for (let i = 0; i < node.geometry.attributes.position.count; i++) {
        box.expandByPoint(node.getVertexPosition(i, vertex));
      }
    } else {
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      box = node.geometry.boundingBox;
    }
    if (box)
      bounds.union(
        box
          .clone()
          .applyMatrix4(
            new Matrix4().multiplyMatrices(inverse, node.matrixWorld),
          ),
      );
  });
  return bounds.isEmpty() ||
    ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
    ? null
    : bounds;
}

export function fitObjectSize(
  pose: Transform,
  dimensions: Vec3,
  meters: number,
): Transform | null {
  const largest = Math.max(...dimensions);
  if (
    !Number.isFinite(meters) ||
    meters <= 0 ||
    !Number.isFinite(largest) ||
    largest <= 0
  )
    return null;
  const scale = pose.scale.map((n) => (n * meters) / largest) as Vec3;
  if (!scale.every((n) => Number.isFinite(n) && n >= 0.001 && n <= 10000))
    return null;
  return { ...pose, scale };
}

export function placeBesideAircraft(
  pose: Transform,
  anchor: SceneObject["anchor"],
  origin: Vector3,
  aircraft: Object3D,
): Transform {
  const offset = new Vector3(8, 2, 0);
  const position =
    anchor === "aircraft"
      ? offset
      : offset
          .applyQuaternion(aircraft.quaternion)
          .add(aircraft.position)
          .sub(origin);
  return { ...pose, position: position.toArray() as Vec3 };
}

/** Approximate support height from a 5 × 5 sample of the world-space footprint. */
export function placeOnGround(
  pose: Transform,
  bounds: Box3,
  height: (x: number, z: number) => number,
): Transform | null {
  if (bounds.isEmpty()) return null;
  let top = -Infinity;
  for (let x = 0; x <= 4; x++)
    for (let z = 0; z <= 4; z++) {
      const sample = height(
        bounds.min.x + ((bounds.max.x - bounds.min.x) * x) / 4,
        bounds.min.z + ((bounds.max.z - bounds.min.z) * z) / 4,
      );
      if (!Number.isFinite(sample)) return null;
      top = Math.max(top, sample);
    }
  const y = pose.position[1] + top - bounds.min.y;
  if (!Number.isFinite(y) || Math.abs(y) > 100000) return null;
  return { ...pose, position: [pose.position[0], y, pose.position[2]] };
}

const anchorSize = (root: Object3D, anchor: Object3D) =>
  boundsInFrame(root, anchor.matrixWorld)
    ?.getSize(new Vector3())
    .toArray() as Vec3 | undefined;

/** A visible model's size in its anchor's axes, to the millimeter. */
export function measureObject(root: Object3D | null): Vec3 | null {
  if (!root?.parent?.visible) return null;
  return (
    (anchorSize(root, root.parent)?.map(
      (n) => Math.round(n * 1000) / 1000,
    ) as Vec3) ?? null
  );
}

/** The pose a placement command gives an object, or null if it cannot apply. */
export function placeSceneObject(
  object: SceneObject,
  root: Object3D | null,
  time: number,
  action: PlacementAction,
  scene: {
    origin: Vector3;
    aircraft: Object3D;
    height: (x: number, z: number) => number;
  },
  meters = 0,
): Transform | null {
  if (object.locked || object.kind === "light" || !root?.parent?.visible)
    return null;
  const pose = sampleTransform(object, time);
  if (action === "beside")
    return placeBesideAircraft(
      pose,
      object.anchor,
      scene.origin,
      scene.aircraft,
    );
  if (action === "ground") {
    if (object.anchor !== "world") return null;
    const bounds = boundsInFrame(root, new Matrix4());
    return bounds && placeOnGround(pose, bounds, scene.height);
  }
  const size = anchorSize(root, root.parent);
  return size ? fitObjectSize(pose, size, meters) : null;
}
