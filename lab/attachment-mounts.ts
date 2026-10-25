import * as T from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const alloy = new T.MeshStandardMaterial({
  color: 0x657179,
  metalness: 0.78,
  roughness: 0.42,
});
const seated = new WeakMap<T.Object3D, Set<string>>();
const controlBases = new WeakSet<T.Object3D>();
function appendSeat(node: T.Object3D, geometry: T.BufferGeometry) {
  const existing = node.children.find(
    (c) => c instanceof T.Mesh && c.userData.anchorSeat,
  ) as T.Mesh | undefined;
  if (existing) {
    const merged = mergeGeometries([existing.geometry, geometry]);
    if (!merged) throw new Error("Could not batch actuator anchor seats");
    existing.geometry.dispose();
    geometry.dispose();
    existing.geometry = merged;
  } else {
    const mesh = new T.Mesh(geometry, alloy);
    mesh.name = "Actuator_anchor_seats";
    mesh.userData.anchorSeat = true;
    node.add(mesh);
  }
}
/** Seat a generated actuator's anchor in an existing, rigid structural surface. */
export function seatMechanicalAnchor(
  root: T.Object3D,
  node: T.Object3D,
  point: T.Vector3,
  moving: Set<T.Object3D>,
) {
  const key = point
    .toArray()
    .map((v) => v.toFixed(7))
    .join(",");
  const keys = seated.get(node) ?? new Set<string>();
  if (keys.has(key)) return;
  keys.add(key);
  seated.set(node, keys);
  root.updateWorldMatrix(true, true);
  const origin = root.localToWorld(point.clone()),
    candidates: { mesh: T.Mesh; bound: number }[] = [];
  node.traverse((child) => {
    if (
      !(child instanceof T.Mesh) ||
      child instanceof T.InstancedMesh ||
      child.userData.anchorSeat
    )
      return;
    for (let p: T.Object3D | null = child; p && p !== node; p = p.parent)
      if (moving.has(p) || p.name === "Mechanical_detail_pack") return;
    child.geometry.computeBoundingBox();
    const box = child.geometry
      .boundingBox!.clone()
      .applyMatrix4(child.matrixWorld);
    candidates.push({ mesh: child, bound: box.distanceToPoint(origin) });
  });
  candidates.sort((a, b) => a.bound - b.bound);
  let best = Infinity,
    hit: T.Vector3 | undefined;
  const a = new T.Vector3(),
    b = new T.Vector3(),
    c = new T.Vector3(),
    nearest = new T.Vector3();
  for (const { mesh, bound } of candidates) {
    if (bound > best) break;
    const local = mesh.worldToLocal(origin.clone()),
      p = mesh.geometry.getAttribute("position"),
      ix = mesh.geometry.index;
    const at = (i: number) => (ix ? ix.getX(i) : i);
    for (let i = 0; i < (ix?.count ?? p.count); i += 3) {
      a.fromBufferAttribute(p, at(i));
      b.fromBufferAttribute(p, at(i + 1));
      c.fromBufferAttribute(p, at(i + 2));
      if (b.clone().sub(a).cross(c.clone().sub(a)).lengthSq() < 1e-20) continue;
      new T.Triangle(a, b, c).closestPointToPoint(local, nearest);
      nearest.applyMatrix4(mesh.matrixWorld);
      const gap = nearest.distanceTo(origin);
      if (gap < best) {
        best = gap;
        hit = nearest.clone();
      }
    }
  }
  if (!hit && node.name.startsWith("Mechanical_oleo_") && node.parent) {
    // A suspension carrier contains rotating wheels only. Its upper collar
    // slides over a fixed guide; attaching that collar to a rotating spoke would
    // lose contact as soon as the wheel turns or the oleo compresses.
    const leg = node.parent;
    seatMechanicalAnchor(root, leg, point, moving);
    const center = leg.worldToLocal(origin.clone());
    const guide = new T.CylinderGeometry(0.008, 0.008, 0.44, 12).translate(
      ...center.toArray(),
    );
    appendSeat(leg, guide);
    return;
  }
  if (
    !hit &&
    /^(Mechanical_control_stick|Mechanical_throttle|Mechanical_pedal_)/.test(
      node.name,
    )
  ) {
    if (controlBases.has(node)) return;
    controlBases.add(node);
    const pivot = root.worldToLocal(node.getWorldPosition(new T.Vector3()));
    seatMechanicalAnchor(root, root, pivot, moving);
    if (node.name.startsWith("Mechanical_pedal_")) {
      const rail = new T.CylinderGeometry(0.012, 0.012, 0.2, 16)
        .rotateX(Math.PI / 2)
        .translate(...pivot.toArray());
      appendSeat(root, rail);
    } else {
      // A spherical bearing keeps the stick connected under combined pitch and
      // roll; the throttle uses the same seated pivot with one rotation axis.
      appendSeat(
        root,
        new T.SphereGeometry(0.022, 24, 16).translate(...pivot.toArray()),
      );
    }
    return;
  }
  if (!hit || best < 0.00001) return;
  if (best > 0.8)
    throw new Error(
      `Mechanical anchor lacks a local mount: ${node.name}, ${best} m`,
    );
  const start = node.worldToLocal(origin.clone()),
    end = node.worldToLocal(hit),
    direction = end.clone().sub(start).normalize();
  const radius = 0.008,
    overlap = 0.002;
  start.addScaledVector(direction, -overlap);
  end.addScaledVector(direction, overlap);
  const geometry = new T.CylinderGeometry(
    radius,
    radius,
    start.distanceTo(end),
    12,
  )
    .applyQuaternion(
      new T.Quaternion().setFromUnitVectors(new T.Vector3(0, 1, 0), direction),
    )
    .translate(...start.clone().add(end).multiplyScalar(0.5).toArray());
  appendSeat(node, geometry);
}
