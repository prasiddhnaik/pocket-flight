import * as T from "three";
import { CannonSimulation, cannonPose, muzzleVelocity, projectileAcceleration, type CannonTarget } from "./cannon";
import { ProjectileVisuals } from "./projectile-visuals";
import { CannonFlash } from "./cannon-flash";
import type { FlightPhysics } from "./physics";

type PracticeTarget = CannonTarget & { mesh: T.Group; health: number; respawn: number; flash: number };
type CannonAircraft = Pick<FlightPhysics, "position" | "quaternion" | "velocity" | "angularVelocity" | "wind">;
export class CannonEffects {
  readonly group = new T.Group();
  readonly simulation = new CannonSimulation();
  firing = false;
  private targets: PracticeTarget[] = [];
  private projectiles = new ProjectileVisuals();
  private discharge = new CannonFlash();
  private impactGeometry = new T.SphereGeometry(.24, 8, 6);
  private impactMaterial = new T.MeshBasicMaterial({ color: "#ffd3a0", transparent: true, depthWrite: false });
  private impacts = Array.from({ length: 24 }, () => ({ mesh: new T.Mesh(this.impactGeometry, this.impactMaterial), life: 0 }));
  private velocity = new T.Vector3();
  private wind = new T.Vector3();
  private hud = document.createElement("div");
  private reticle = document.createElement("div");
  private targetsHit = 0;
  private customMuzzle: T.Vector3 | null = null;

  constructor(container: HTMLElement, private readonly surfaceHeight?: (x: number, z: number) => number) {
    this.group.add(this.projectiles.group, this.discharge.group);
    for (const impact of this.impacts) { impact.mesh.visible = false; this.group.add(impact.mesh); }
    this.group.visible = false;
    this.hud.className = "f15c-cannon-status";
    this.hud.setAttribute("aria-live", "polite");
    this.hud.style.display = "none";
    Object.assign(this.reticle.style, { position: "absolute", width: "20px", height: "20px", border: "1px solid #f5efd5", borderRadius: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none", zIndex: "5", display: "none" });
    container.append(this.hud, this.reticle);
  }

  reset(physics: CannonAircraft, practiceTargets = true) {
    this.firing = false;
    this.customMuzzle = null;
    this.simulation.reset();
    this.targetsHit = 0;
    this.targets.forEach(target => {
      this.group.remove(target.mesh);
      target.mesh.traverse(object => { if (object instanceof T.Mesh) { object.geometry.dispose(); (object.material as T.Material).dispose(); } });
    });
    const forward = new T.Vector3(0, 0, -1).applyQuaternion(physics.quaternion);
    const right = new T.Vector3(1, 0, 0).applyQuaternion(physics.quaternion);
    this.targets = practiceTargets ? Array.from({ length: 3 }, (_, i) => {
      const position = physics.position.clone().addScaledVector(forward, 450 + i * 130).addScaledVector(right, (i - 1) * 30);
      position.y = Math.max(physics.position.y, 120);
      const mesh = new T.Group();
      const rim = new T.Mesh(new T.TorusGeometry(12, .6, 8, 48), new T.MeshStandardMaterial({ color: "#eaa354", roughness: .55, emissive: "#61320b", emissiveIntensity: .3 }));
      const center = new T.Mesh(new T.SphereGeometry(4.5, 16, 10), new T.MeshStandardMaterial({ color: "#f1edcd", roughness: .6 }));
      mesh.add(rim, center);
      mesh.position.copy(position);
      mesh.quaternion.copy(physics.quaternion);
      this.group.add(mesh);
      return { id: `practice-${i}`, position, radius: 4.5, mesh, health: 3, respawn: 0, flash: 0 };
    }) : [];
    this.discharge.reset();
    this.projectiles.update([]);
    for (const impact of this.impacts) { impact.life = 0; impact.mesh.visible = false; }
  }

  suspend() { this.firing = false; this.simulation.suspend(); this.discharge.suspend(); }

  step(dt: number, physics: CannonAircraft, firing: boolean, externalTargets?: readonly CannonTarget[], muzzle?: T.Vector3) {
    this.customMuzzle = muzzle?.clone() ?? null;
    this.velocity.copy(muzzle ? physics.angularVelocity.clone().cross(muzzle).applyQuaternion(physics.quaternion).add(physics.velocity) : muzzleVelocity(physics.velocity, physics.angularVelocity, physics.quaternion));
    this.wind.copy(physics.wind);
    for (const impact of this.impacts) {
      impact.life = Math.max(0, impact.life - dt);
      impact.mesh.visible = impact.life > 0;
      impact.mesh.scale.setScalar(.6 + (1 - impact.life / .15) * 3);
    }
    for (const target of this.targets) {
      target.flash = Math.max(0, target.flash - dt);
      if (target.respawn > 0) {
        target.respawn -= dt;
        if (target.respawn <= 0) { target.health = 3; target.mesh.visible = true; }
      }
      target.mesh.scale.setScalar(target.flash > 0 ? 1.12 : 1);
    }
    const pose = cannonPose(physics.position, physics.quaternion);
    if (muzzle) pose.origin.copy(muzzle).applyQuaternion(physics.quaternion).add(physics.position);
    const result = this.simulation.step(dt, { ...pose, firing, velocity: this.velocity }, externalTargets ?? this.targets.filter(target => target.health > 0), { wind: this.wind, surfaceHeight: this.surfaceHeight });
    if (dt > 0) this.firing = firing && (this.simulation.ammunition > 0 || result.fired > 0);
    this.discharge.step(dt, result.fired, this.simulation.shots, pose.origin, pose.direction, this.velocity, this.wind);
    for (const hit of result.hits) {
      const target = this.targets.find(t => t.id === hit.target);
      if (!target || target.health <= 0) continue;
      target.health--; target.flash = .15;
      if (!target.health) { this.targetsHit++; target.mesh.visible = false; target.respawn = 5; }
    }
    for (const point of [...result.impacts, ...result.hits.map(hit => hit.point)]) {
      const impact = this.impacts.find(impact => impact.life === 0);
      if (impact) { impact.life = .15; impact.mesh.position.copy(point); impact.mesh.visible = true; }
    }
    this.projectiles.update(this.simulation.projectiles);
    return result;
  }

  render(visible: boolean, camera: T.Camera, aircraft: T.Object3D, showReticle = true, showStatus = true) {
    this.group.visible = visible;
    this.hud.style.display = this.reticle.style.display = visible ? "block" : "none";
    if (!visible) return;
    if (!showStatus) this.hud.style.display = "none";
    const label = `GUN ${this.simulation.ammunition.toString().padStart(3, "0")} / 940 · HITS ${this.simulation.hits} · TARGETS ${this.targetsHit}`;
    if (this.hud.textContent !== label) this.hud.textContent = label;
    this.hud.title = "Hold J or FIRE · 20 mm · 500 m ballistic reference · Practice targets reset after five seconds";
    // Ballistics use fixed physics steps; presentation follows the same
    // interpolated transform as the visible aircraft and its gun port.
    const pose = cannonPose(aircraft.getWorldPosition(new T.Vector3()), aircraft.getWorldQuaternion(new T.Quaternion()));
    if (this.customMuzzle) pose.origin.copy(this.customMuzzle).applyQuaternion(aircraft.getWorldQuaternion(new T.Quaternion())).add(aircraft.getWorldPosition(new T.Vector3()));
    this.discharge.render(camera, pose.origin, pose.direction);
    if (!showReticle) { this.reticle.style.display = "none"; return; }
    const aim = pose.origin.clone(), velocity = pose.direction.clone().multiplyScalar(1030).add(this.velocity);
    for (let i = 0; i < 180 && aim.clone().sub(pose.origin).dot(pose.direction) < 500; i++) {
      const acceleration = projectileAcceleration(aim, velocity, { wind: this.wind });
      aim.addScaledVector(velocity, 1 / 120).addScaledVector(acceleration, .5 / (120 * 120));
      velocity.addScaledVector(acceleration, 1 / 120);
    }
    aim.project(camera);
    this.reticle.style.left = `${(aim.x + 1) * 50}%`;
    this.reticle.style.top = `${(1 - aim.y) * 50}%`;
    this.reticle.style.borderColor = this.targets.some(target => target.flash > 0) ? "#ffb057" : "#f5efd5";
    if (aim.z > 1 || Math.abs(aim.x) > 1 || Math.abs(aim.y) > 1) this.reticle.style.display = "none";
  }

  dispose() {
    this.projectiles.dispose();
    this.impactGeometry.dispose(); this.impactMaterial.dispose();
    this.discharge.dispose();
    this.targets.forEach(target => target.mesh.traverse(object => { if (object instanceof T.Mesh) { object.geometry.dispose(); (object.material as T.Material).dispose(); } }));
    this.hud.remove(); this.reticle.remove();
  }
}
