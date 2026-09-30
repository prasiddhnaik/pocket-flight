import { MathUtils, Object3D, Vector3 } from "three";
import {
  gearEase,
  gearPhase,
  oleoTravel,
  STORMBIRD_OLEO_TRAVEL,
} from "./stormbird-kinematics";

type Point = [number, number, number];
type Hinge = { name: string; point: Point; axis: Point; angle: number };
type Leg = Hinge & {
  radius: number;
  brace_length: number;
  brace_lead: number;
  brace_branch?: number;
  swivel?: Hinge;
  torque: { a: Point; elbow: Point; b: Point; pin: string };
  start: number;
  end: number;
};
type Door = Omit<Hinge, "angle"> & { open_angle: number };
type Datums = {
  canopy: Hinge;
  legs: Leg[];
  doors: Door[];
  segments: Record<string, [Point, Point]>;
};
const up = new Vector3(0, 1, 0);
const radians = MathUtils.degToRad;
const eased = gearEase;

// All coordinates come from the CAD master. No displaced pivots or hidden tires.
export class StormbirdMechanisms {
  private nodes = new Map<string, Object3D>();
  private data: Datums;
  private travel = 0;
  private pose: [number, number, number] = [1, 0, 0];
  private carriers = new Map<string, { node: Object3D; y: number }>();
  constructor(model: Object3D) {
    model.traverse((node) => this.nodes.set(node.name, node));
    this.data = this.nodes.get("Stormbird_HX40")!.userData.mechanisms as Datums;
    for (const leg of this.data.legs) {
      const node = this.nodes.get(
        leg.name === "Nose_gear" ? "Nose_steering" : leg.name + "_suspension",
      )!;
      this.carriers.set(leg.name, { node, y: node.position.y });
    }
  }
  setSuspension(travel: number) {
    this.travel = MathUtils.clamp(travel, 0, STORMBIRD_OLEO_TRAVEL);
    this.apply(...this.pose);
  }
  reset() {
    this.travel = 0;
    this.apply(1, 0, 0);
  }
  private rotated(point: Vector3, hinge: Hinge, angle: number) {
    const origin = new Vector3().fromArray(hinge.point);
    return point
      .clone()
      .sub(origin)
      .applyAxisAngle(new Vector3().fromArray(hinge.axis), radians(angle))
      .add(origin);
  }
  private hinge(datum: Hinge | Door, degrees: number) {
    this.nodes
      .get(datum.name)!
      .quaternion.setFromAxisAngle(
        new Vector3().fromArray(datum.axis).normalize(),
        radians(degrees),
      );
  }
  private segment(name: string, a: Vector3, b: Vector3) {
    const node = this.nodes.get(name)!;
    const direction = b.clone().sub(a);
    node.position.copy(a);
    node.quaternion.setFromUnitVectors(up, direction.clone().normalize());
  }
  private ram(name: string, a: Vector3, b: Vector3) {
    const length = (part: string) => {
      const [start, end] = this.data.segments[name + part];
      return new Vector3()
        .fromArray(start)
        .distanceTo(new Vector3().fromArray(end));
    };
    const direction = b.clone().sub(a).normalize();
    this.segment(
      name + "_barrel",
      a,
      a.clone().addScaledVector(direction, length("_barrel")),
    );
    this.segment(
      name + "_piston",
      b.clone().addScaledVector(direction, -length("_piston")),
      b,
    );
  }
  apply(gear: number, canopy: number, yaw: number) {
    this.pose = [gear, canopy, yaw];
    const phase = gearPhase(gear);
    const canopyAngle = eased(0, 1, canopy) * this.data.canopy.angle;
    this.hinge(this.data.canopy, canopyAngle);
    for (const label of ["Left", "Right"]) {
      const name = "Canopy_actuator_" + label;
      const a = new Vector3().fromArray(
        this.data.segments[name + "_barrel"][0],
      );
      const b = this.rotated(
        new Vector3().fromArray(this.data.segments[name + "_piston"][1]),
        this.data.canopy,
        canopyAngle,
      );
      this.ram(name, a, b);
    }
    for (const door of this.data.doors) {
      const open = 1 - eased(0.9, 1, phase);
      // Exported geometry is already open; rotate only its delta from that rest pose.
      this.hinge(door, (open - 1) * door.open_angle);
    }
    for (const leg of this.data.legs) {
      const angle = eased(leg.start, leg.end, phase) * leg.angle;
      this.hinge(leg, angle);
      if (leg.swivel)
        this.hinge(leg.swivel, eased(0.3, 0.75, phase) * leg.swivel.angle);
      const a = new Vector3().fromArray(
        this.data.segments[leg.name + "_brace_upper"][0],
      );
      const b = this.rotated(
        new Vector3().fromArray(
          this.data.segments[leg.name + "_brace_lower"][1],
        ),
        leg,
        angle,
      );
      const d = b.clone().sub(a),
        length = d.length();
      const height = Math.sqrt(
        Math.max(0, leg.brace_length ** 2 - length ** 2 / 4),
      );
      // CAD elbow branch transformed from (Y,Z) to game (-Z,Y).
      const elbow = a
        .clone()
        .add(b)
        .multiplyScalar(0.5)
        .add(
          new Vector3(0, -d.z, d.y).multiplyScalar(
            (height / length) * (leg.brace_branch ?? 1),
          ),
        );
      this.segment(leg.name + "_brace_upper", a, elbow);
      this.segment(leg.name + "_brace_lower", elbow, b);
      const name = leg.name + "_actuator";
      const ramA = new Vector3().fromArray(
        this.data.segments[name + "_barrel"][0],
      );
      const ramB = this.rotated(
        new Vector3().fromArray(this.data.segments[name + "_piston"][1]),
        leg,
        angle,
      );
      this.ram(name, ramA, ramB);
      const travel = oleoTravel(this.travel, gear);
      const carrier = this.carriers.get(leg.name)!;
      carrier.node.position.y = carrier.y + travel;
      const ta = new Vector3().fromArray(leg.torque.a);
      const restB = new Vector3().fromArray(leg.torque.b);
      const restElbow = new Vector3().fromArray(leg.torque.elbow);
      const tb = restB.clone().addScaledVector(up, travel);
      const direction = tb.clone().sub(ta),
        distance = direction.length();
      direction.normalize();
      const upper = ta.distanceTo(restElbow),
        lower = restB.distanceTo(restElbow);
      const along = (upper ** 2 - lower ** 2 + distance ** 2) / (2 * distance);
      const perpendicular = restElbow.clone().sub(ta);
      perpendicular
        .addScaledVector(direction, -perpendicular.dot(direction))
        .normalize();
      const torqueElbow = ta
        .clone()
        .addScaledVector(direction, along)
        .addScaledVector(
          perpendicular,
          Math.sqrt(Math.max(0, upper ** 2 - along ** 2)),
        );
      const posedElbow = this.rotated(torqueElbow, leg, angle);
      this.segment(
        leg.name + "_torque_link_upper",
        this.rotated(ta, leg, angle),
        posedElbow,
      );
      this.segment(
        leg.name + "_torque_link_lower",
        posedElbow,
        this.rotated(tb, leg, angle),
      );
      this.nodes.get(leg.torque.pin)!.position.copy(posedElbow);
    }
    // Steering settles to center before the gear enters its wheel well.
    this.nodes.get("Nose_steering")!.rotation.y =
      yaw * 0.35 * (1 - eased(0, 0.15, phase));
  }
}
