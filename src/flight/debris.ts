import * as T from "three";
import { disposeAircraft, type AircraftModel } from "../aircraft/aircraft";
import { terrainHeight } from "../world/terrain";
import type { ContactPart } from "./airframe-contact";
import type { FlightPhysics } from "./physics";

type Piece = { mesh: T.Object3D; v: T.Vector3; spin: T.Vector3; life: number };
export type DebrisPose = { p: T.Vector3; q: T.Quaternion; visible: boolean };

const jitter = (scale: number) => (Math.random() - 0.5) * scale;

/** Fragments thrown off by impacts, including a torn-off wing on heavy strikes. */
export class DebrisField {
  private pieces: Piece[] = [];

  constructor(private scene: T.Scene) {}

  spawn(
    physics: FlightPhysics,
    aircraft: AircraftModel,
    severity: number,
    struckPart?: ContactPart,
    point?: number[],
  ) {
    const p = physics;
    const count = severity > 0.8 ? 14 : 5;
    for (let i = 0; i < count; i++) {
      const mesh = new T.Mesh(
        new T.BoxGeometry(0.15 + Math.random() * 1.5, 0.12, 0.4 + Math.random()),
        new T.MeshStandardMaterial({
          color: i % 2 ? "#e9b751" : "#65716d",
          metalness: 0.2,
          roughness: 0.5,
        }),
      );
      mesh.position
        .copy(point ? new T.Vector3().fromArray(point) : p.position)
        .add(new T.Vector3(jitter(4), 0, jitter(3)));
      this.add({
        mesh,
        v: p.velocity
          .clone()
          .multiplyScalar(0.5)
          .add(new T.Vector3(jitter(14), 3 + Math.random() * 7, jitter(14))),
        spin: new T.Vector3(Math.random() * 5, Math.random() * 5, Math.random() * 5),
        life: 20,
      });
    }
    if (severity > 0.8 && (struckPart === "leftWing" || struckPart === "rightWing")) {
      const wing = aircraft.wings[struckPart === "leftWing" ? 0 : 1];
      if (!wing.visible) return;
      const part = wing.clone(true);
      part.traverse((object) => {
        if (object instanceof T.Mesh) {
          object.geometry = object.geometry.clone();
          object.material = Array.isArray(object.material)
            ? object.material.map((material) => material.clone())
            : object.material.clone();
        }
      });
      part.position.copy(p.position);
      part.quaternion.copy(p.quaternion);
      this.add({
        mesh: part,
        v: p.velocity.clone().multiplyScalar(0.65).add(new T.Vector3(7, 8, 0)),
        spin: new T.Vector3(1, 2, 1),
        life: 30,
      });
      wing.visible = false;
    }
    if (p.damage.propeller > 0.8) aircraft.propeller.visible = false;
  }

  private add(piece: Piece) {
    this.scene.add(piece.mesh);
    this.pieces.push(piece);
  }

  /** Ballistic fall with a damped bounce off the terrain. */
  step(dt: number) {
    for (const d of this.pieces) {
      d.life -= dt;
      d.v.y -= 9.81 * dt;
      d.mesh.position.addScaledVector(d.v, dt);
      d.mesh.rotation.x += d.spin.x * dt;
      d.mesh.rotation.y += d.spin.y * dt;
      d.mesh.rotation.z += d.spin.z * dt;
      const floor = Math.max(0, terrainHeight(d.mesh.position.x, d.mesh.position.z)) + 0.2;
      if (d.mesh.position.y < floor) {
        d.mesh.position.y = floor;
        d.v.y = Math.abs(d.v.y) * 0.25;
        d.v.multiplyScalar(0.8);
        d.spin.multiplyScalar(0.8);
      }
    }
  }

  capture(): DebrisPose[] {
    return this.pieces.map((d) => ({
      p: d.mesh.position.clone(),
      q: d.mesh.quaternion.clone(),
      visible: d.mesh.visible,
    }));
  }

  apply(poses: DebrisPose[]) {
    this.pieces.forEach((d, i) => {
      const pose = poses[i];
      d.mesh.visible = !!pose?.visible;
      if (pose) {
        d.mesh.position.copy(pose.p);
        d.mesh.quaternion.copy(pose.q);
      }
    });
  }

  clear() {
    for (const d of this.pieces) {
      this.scene.remove(d.mesh);
      disposeAircraft(d.mesh, false);
    }
    this.pieces = [];
  }
}
