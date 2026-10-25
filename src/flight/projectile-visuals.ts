import * as T from "three";
import { F15C_CANNON, type Projectile } from "./cannon";
import { ProjectileTracers } from "./projectile-tracers";

// External visual only: an uncased projectile, with a pointed nose along +Y.
export function projectileGeometry() {
  const r = F15C_CANNON.diameter / 2, half = F15C_CANNON.projectileLength / 2;
  return new T.LatheGeometry([
    new T.Vector2(0, -half), new T.Vector2(r * .8, -half),
    new T.Vector2(r, -half + .005), new T.Vector2(r, half - .022),
    new T.Vector2(r * .8, half - .012), new T.Vector2(r * .4, half - .003), new T.Vector2(0, half),
  ], 12);
}
export class ProjectileVisuals {
  readonly group = new T.Group();
  readonly rounds = new T.InstancedMesh(projectileGeometry(), new T.MeshStandardMaterial({ color: "#a58e68", metalness: .75, roughness: .32 }), F15C_CANNON.maximumProjectiles);
  private tracers = new ProjectileTracers();
  private transform = new T.Object3D();
  constructor() {
    this.rounds.name = "20mm_projectile_bodies";
    this.rounds.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.rounds.count = 0;
    this.rounds.frustumCulled = false;
    this.group.add(this.rounds, this.tracers.mesh);
  }
  update(projectiles: readonly Projectile[]) {
    projectiles.forEach((round, i) => {
      this.transform.position.copy(round.position);
      this.transform.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), round.velocity.clone().normalize());
      this.transform.updateMatrix();
      this.rounds.setMatrixAt(i, this.transform.matrix);
    });
    this.rounds.count = projectiles.length;
    this.rounds.instanceMatrix.needsUpdate = true;
    this.tracers.update(projectiles);
  }
  dispose() {
    this.rounds.geometry.dispose(); this.rounds.material.dispose();
    this.tracers.dispose(); this.rounds.dispose();
  }
}
