import * as T from "three";

const RING_RADIUS = 19;
/** A path segment within this distance of a ring centre counts as a pass. */
const PASS_RADIUS = 18.8;

/** The gold checkpoint rings for the current mission route. */
export class MissionRings {
  readonly group = new T.Group();
  rings: T.Group[] = [];

  build(points: T.Vector3[], start: T.Vector3) {
    this.clear();
    this.group.visible = true;
    points.forEach((p, i) => {
      const ring = new T.Group();
      ring.position.copy(p);
      const direction = p.clone().sub(i ? points[i - 1] : start).normalize();
      ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), direction);
      ring.add(
        new T.Mesh(
          new T.TorusGeometry(RING_RADIUS, 0.55, 10, 72),
          new T.MeshStandardMaterial({
            color: "#ffdb83",
            emissive: "#ecab41",
            emissiveIntensity: 0.5,
            transparent: true,
            opacity: 1,
          }),
        ),
        new T.Mesh(
          new T.TorusGeometry(18.1, 0.1, 6, 64),
          new T.MeshBasicMaterial({ color: "#fff4c2", transparent: true, opacity: 0.6 }),
        ),
      );
      for (let a = 0; a < 4; a++) {
        const tick = new T.Mesh(
          new T.BoxGeometry(2, 0.7, 0.7),
          new T.MeshBasicMaterial({ color: "#fff3c8" }),
        );
        const angle = (a * Math.PI) / 2;
        tick.position.set(Math.cos(angle) * RING_RADIUS, Math.sin(angle) * RING_RADIUS, 0);
        tick.rotation.z = angle;
        ring.add(tick);
      }
      this.rings.push(ring);
      this.group.add(ring);
    });
  }

  /** Hide passed rings and dim every ring but the next one. */
  show(next: number) {
    this.rings.forEach((ring, i) => {
      ring.visible = i >= next;
      for (const o of ring.children)
        if (o instanceof T.Mesh) (o.material as T.MeshStandardMaterial).opacity = i === next ? 1 : 0.3;
    });
  }

  clear() {
    for (const ring of this.rings)
      ring.traverse((c) => {
        if (c instanceof T.Mesh) {
          c.geometry.dispose();
          (c.material as T.Material).dispose();
        }
      });
    this.group.clear();
    this.rings = [];
  }
}

/** True when the segment flown this step passes through the ring at `target`. */
export function passedRing(previous: T.Vector3, current: T.Vector3, target: T.Vector3) {
  const segment = current.clone().sub(previous);
  const t = T.MathUtils.clamp(
    target.clone().sub(previous).dot(segment) / Math.max(0.0001, segment.lengthSq()),
    0,
    1,
  );
  return previous.clone().addScaledVector(segment, t).distanceTo(target) < PASS_RADIUS;
}
