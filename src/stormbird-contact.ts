import { MathUtils, Quaternion, Vector3 } from "three";
import geometry from "./stormbird-geometry.json";
import { groundAt } from "./terrain";
import { gearEase, gearPhase, oleoTravel } from "./stormbird-kinematics";

const point = new Vector3(),
  axle = new Vector3(),
  up = new Vector3();
const bodyRotation = new Quaternion(),
  fold = new Quaternion(),
  swivel = new Quaternion();
const axis = new Vector3(),
  pivot = new Vector3();

// Rigid tire profiles and neutral-airframe convex hull from the saved CAD mesh.
// Terrain contact is sampled at the lowest airframe point and each tire center.
export function stormbirdContact(
  position: Vector3,
  rotation: Quaternion,
  extension: number,
  compression: number,
  steering: number,
) {
  bodyRotation.copy(rotation);
  up.set(0, 1, 0).applyQuaternion(bodyRotation.clone().invert());
  let lowest = geometry.bodyHull[0],
    minimum = Infinity;
  for (const p of geometry.bodyHull) {
    const height =
      p[0] * up.x + (p[1] - geometry.centerOffsetY) * up.y + p[2] * up.z;
    if (height < minimum) {
      minimum = height;
      lowest = p;
    }
  }
  point.fromArray(lowest);
  point.y -= geometry.centerOffsetY;
  point.applyQuaternion(bodyRotation);
  const bodyHeight =
    groundAt(position.x + point.x, position.z + point.z).height - point.y;
  let wheelHeight = -Infinity;
  const phase = gearPhase(extension);
  for (const wheel of geometry.wheels) {
    const leg = geometry.legs.find((l) => l.name === wheel.leg)!;
    point.fromArray(wheel.center);
    axle.set(1, 0, 0);
    point.y += oleoTravel(compression, extension);
    const turn = leg.swivel;
    if (turn) {
      swivel.setFromAxisAngle(
        axis.fromArray(turn.axis).normalize(),
        MathUtils.degToRad(turn.angle) * gearEase(0.3, 0.75, phase),
      );
      pivot.fromArray(turn.point);
      point.sub(pivot).applyQuaternion(swivel).add(pivot);
      axle.applyQuaternion(swivel);
    } else {
      swivel.setFromAxisAngle(
        axis.set(0, 1, 0),
        steering * 0.35 * (1 - gearEase(0, 0.15, phase)),
      );
      // Twin nose wheel centers turn around the strut centerline.
      pivot.set(0, point.y, leg.point[2]);
      point.sub(pivot).applyQuaternion(swivel).add(pivot);
      axle.applyQuaternion(swivel);
    }
    fold.setFromAxisAngle(
      axis.fromArray(leg.axis).normalize(),
      MathUtils.degToRad(leg.angle) * gearEase(leg.start, leg.end, phase),
    );
    pivot.fromArray(leg.point);
    point.sub(pivot).applyQuaternion(fold).add(pivot);
    point.y -= geometry.centerOffsetY;
    point.applyQuaternion(bodyRotation);
    axle.applyQuaternion(fold).applyQuaternion(bodyRotation);
    const axial = Math.abs(axle.y),
      radial = Math.sqrt(Math.max(0, 1 - axial ** 2));
    let support = 0;
    for (const [a, r] of wheel.profile)
      support = Math.max(support, a * axial + r * radial);
    wheelHeight = Math.max(
      wheelHeight,
      groundAt(position.x + point.x, position.z + point.z).height -
        point.y +
        support,
    );
  }
  return {
    height: Math.max(bodyHeight, wheelHeight),
    wheelSupported: wheelHeight > bodyHeight,
    downlocked: extension >= 0.9999,
  };
}
