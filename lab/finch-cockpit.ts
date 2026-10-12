import * as T from "three";
import type { MechanismPose } from "./mechanics";

/** Articulates only the mounts and pivots exported by the rebuilt cabin. */
export class FinchCockpit {
  private fixed = new T.Vector3();
  private end = new T.Vector3();
  private mount = new T.Vector3();
  private direction = new T.Vector3();
  private overlap = new T.Vector3();
  private localStart = new T.Vector3();
  private localEnd = new T.Vector3();
  private axis = new T.Vector3(0, 1, 0);
  readonly moving: T.Object3D[] = [];
  private canopy: T.Object3D;
  private sticks: T.Object3D[] = [];
  private pedals: { node: T.Object3D; rest: T.Vector3; side: number }[] = [];
  private throttle: T.Object3D;
  private supports: {
    fixed: T.Vector3;
    moving: T.Vector3;
    barrel: T.Mesh;
    piston: T.Mesh;
  }[] = [];

  constructor(private cabin: T.Object3D) {
    const find = (name: string) => {
      const node = cabin.getObjectByName(name);
      if (!node) throw new Error(`Finch cockpit part missing: ${name}`);
      return node;
    };
    this.canopy = find("Canopy");
    this.throttle = find("Throttle");
    this.moving.push(this.canopy, this.throttle);
    const cylinder = new T.CylinderGeometry(1, 1, 1, 24);
    for (const [i, side] of ["Left", "Right"].entries()) {
      const stick = find(`ControlStick_${side}`);
      this.sticks.push(stick);
      this.moving.push(stick);
      for (const foot of [-1, 1]) {
        const node = find(`RudderPedal_${side}_${foot}`);
        this.pedals.push({ node, rest: node.position.clone(), side: foot });
        this.moving.push(node);
      }
      const mounts = this.canopy.userData.supports[i];
      const barrel = find(`Canopy_ram_barrel_${side}`) as T.Mesh;
      const piston = find(`Canopy_ram_piston_${side}`) as T.Mesh;
      // Give these authored ram meshes an explicit unit axis for endpoint motion.
      for (const mesh of [barrel, piston]) {
        mesh.geometry.dispose();
        mesh.geometry = cylinder;
        this.moving.push(mesh);
      }
      this.supports.push({
        fixed: new T.Vector3().fromArray(mounts.fixed),
        moving: new T.Vector3().fromArray(mounts.moving),
        barrel,
        piston,
      });
    }
  }

  apply(pose: MechanismPose) {
    this.canopy.rotation.x = pose.canopy * this.canopy.userData.opening_radians;
    for (const stick of this.sticks) {
      stick.rotation.x = pose.pitch * stick.userData.pitch_radians;
      stick.rotation.z = -pose.roll * stick.userData.roll_radians;
    }
    for (const { node, rest, side } of this.pedals) {
      node.position.copy(rest);
      node.position.z += side * pose.yaw * 0.035;
    }
    this.throttle.rotation.x = -0.55 * pose.power;
    this.cabin.updateWorldMatrix(true, true);
    for (const support of this.supports) {
      const fixed = this.cabin.localToWorld(this.fixed.copy(support.fixed));
      const moving = this.canopy.localToWorld(this.mount.copy(support.moving));
      const direction = this.direction.copy(moving).sub(fixed).normalize();
      const end = this.end.copy(fixed).addScaledVector(direction, 0.28);
      this.segment(support.barrel, fixed, end, 0.015);
      this.segment(
        support.piston,
        this.overlap.copy(end).addScaledVector(direction, -0.025),
        moving,
        0.007,
      );
    }
    this.cabin.updateWorldMatrix(true, true);
  }

  private segment(mesh: T.Mesh, a: T.Vector3, b: T.Vector3, radius: number) {
    const parent = mesh.parent!;
    const start = parent.worldToLocal(this.localStart.copy(a)),
      end = parent.worldToLocal(this.localEnd.copy(b));
    const direction = end.sub(start);
    mesh.position.copy(start).addScaledVector(direction, 0.5);
    const length = direction.length();
    mesh.quaternion.setFromUnitVectors(this.axis, direction.normalize());
    mesh.scale.set(radius, length, radius);
  }
  diagnostics() {
    return {
      canopyAngle: this.canopy.rotation.x,
      stickAngles: this.sticks.map((s) => [s.rotation.x, s.rotation.z]),
    };
  }
}
