import * as T from "three";
import { rangeTargetModel } from "../../world/range-scenery";
import { Explosions, type BlastSurface } from "./explosions";
import { stores } from "./loadout";
import type { CombatImpact, CombatSimulation, CombatTarget } from "./simulation";

export type Blast = { point: T.Vector3; surface: BlastSurface; size: number };
type TargetVisual = { target: CombatTarget; live: T.Object3D; wreck: T.Object3D | null };

/** Separate rocket/missile bodies: cannon projectiles retain their original visuals. */
export class CombatVisuals {
  readonly group = new T.Group();
  readonly mounted = new T.Group();
  private targetVisuals: TargetVisual[] = [];
  private explosions = new Explosions();
  private burnTime = 0;
  private trailTime = 0;
  private char = new T.MeshStandardMaterial({ color: "#14110e", roughness: 1 });
  private finGeometry = new T.BoxGeometry(0.34, 0.015, 0.22);
  private mounts: T.Group[] = [];
  private body = new T.CylinderGeometry(0.09, 0.09, 1.5, 10);
  private nose = new T.ConeGeometry(0.09, 0.3, 10);
  private pod = new T.CylinderGeometry(0.17, 0.17, 1.6, 12);
  private targetGeometry = new T.SphereGeometry(7, 16, 12);
  private groundGeometry = new T.BoxGeometry(10, 10, 10);
  private paint = new T.MeshStandardMaterial({
    color: "#d3d8ce",
    roughness: 0.5,
  });
  private podPaint = new T.MeshStandardMaterial({
    color: "#566151",
    roughness: 0.8,
  });
  private groundPaint = new T.MeshStandardMaterial({
    color: "#f5a14a",
    emissive: "#7d3100",
    emissiveIntensity: 0.5,
  });
  private airPaint = new T.MeshStandardMaterial({
    color: "#8ee3ef",
    emissive: "#246879",
    emissiveIntensity: 0.5,
    wireframe: true,
  });
  private flamePaint = new T.MeshBasicMaterial({
    color: "#ff8b22",
    toneMapped: false,
  });
  private flameGeometry = new T.ConeGeometry(0.2, 2, 8);
  private rounds = new Map<number, T.Group>();
  private hidden: { node: T.Object3D; visible: boolean }[] = [];

  constructor(
    private readonly simulation: CombatSimulation,
    private readonly aircraft: T.Object3D,
    private readonly water: (x: number, z: number) => boolean = () => false,
    /** Modelled stores that stay on the aircraft, such as the A-2's rocket pods. */
    private readonly keepStores: readonly string[] = [],
  ) {
    aircraft.updateWorldMatrix(true, true);
    aircraft.traverse((node) => {
      if (node.userData.weaponStore === true && !keepStores.includes(node.userData.storeLoad)) {
        this.hidden.push({ node, visible: node.visible });
        node.visible = false;
      }
    });
    this.targetVisuals = simulation.targets.map((target) => this.targetVisual(target));
    this.group.add(this.explosions.group);
    this.mounts = simulation.stations.map((station) => {
      const group = new T.Group();
      group.name = `Combat_store_${station.hardpoint.id}`;
      group.position.fromArray(this.mountPoint(station.hardpoint.id, station.hardpoint.position));
      if (keepStores.includes(station.store)) return group;
      if (stores[station.store].kind === "rocket") {
        const pod = new T.Mesh(this.pod, this.podPaint);
        pod.rotation.x = Math.PI / 2;
        group.add(pod);
      } else group.add(this.weapon(false));
      this.mounted.add(group);
      return group;
    });
    aircraft.add(this.mounted);
  }
  /** Hangs a missile body on the pylon's keel when the model has one for this station. */
  private mountPoint(id: string, fallback: readonly number[]): readonly number[] {
    let point = fallback;
    this.aircraft.traverse((node) => {
      const hardpoint = node.userData.hardpoint as { id: string; position: [number, number, number] } | undefined;
      if (hardpoint?.id !== id || !node.parent) return;
      const local = this.aircraft.worldToLocal(node.parent.localToWorld(new T.Vector3(...hardpoint.position)));
      point = [local.x, local.y - 0.065, local.z - 0.3];
    });
    return point;
  }
  private targetVisual(target: CombatTarget): TargetVisual {
    const model = rangeTargetModel(target.model);
    const live = model
      ? model.clone(true)
      : new T.Mesh(
          target.kind === "air" ? this.targetGeometry : this.groundGeometry,
          target.kind === "air" ? this.airPaint : this.groundPaint,
        );
    live.name = `Combat_${target.id}`;
    live.position.copy(target.base ?? target.position);
    live.rotation.y = target.heading ?? 0;
    this.group.add(live);
    // A wreck is the same dummy, burnt and slumped where it stood.
    let wreck: T.Object3D | null = null;
    if (model && target.kind === "ground") {
      wreck = model.clone(true);
      wreck.traverse((part) => {
        if (part instanceof T.Mesh) part.material = this.char;
      });
      wreck.position.copy(live.position);
      wreck.rotation.set(0.07, live.rotation.y + 0.12, -0.09);
      wreck.scale.set(1, target.model === "barge" ? 0.8 : 0.62, 1);
      wreck.visible = false;
      this.group.add(wreck);
    }
    return { target, live, wreck };
  }
  private surface(impact: CombatImpact): BlastSurface {
    const hit = impact.target && this.simulation.targets.find((target) => target.id === impact.target);
    if (hit) return hit.kind === "air" ? "air" : "ground";
    return this.water(impact.point.x, impact.point.z) ? "water" : "ground";
  }
  private weapon(powered: boolean) {
    const group = new T.Group();
    const body = new T.Mesh(this.body, this.paint);
    body.rotation.x = Math.PI / 2;
    const nose = new T.Mesh(this.nose, this.paint);
    nose.rotation.x = -Math.PI / 2;
    nose.position.z = -0.9;
    group.add(body, nose);
    for (const [z, roll] of [[0.6, 0], [0.6, Math.PI / 2], [-0.45, 0], [-0.45, Math.PI / 2]]) {
      const fins = new T.Mesh(this.finGeometry, this.paint);
      fins.position.z = z;
      fins.rotation.z = roll;
      group.add(fins);
    }
    if (powered) {
      const flame = new T.Mesh(this.flameGeometry, this.flamePaint);
      flame.rotation.x = -Math.PI / 2;
      flame.position.z = 1.7;
      group.add(flame);
    }
    return group;
  }
  /** @param viewScale pixels per metre at one metre from the camera. */
  update(dt: number, impacts: readonly CombatImpact[], viewScale = 600) {
    this.burnTime -= dt;
    const burning = this.burnTime <= 0;
    if (burning) this.burnTime = 0.22;
    for (const { target, live, wreck } of this.targetVisuals) {
      const alive = target.health > 0;
      live.visible = alive;
      if (target.orbit && target.velocity) {
        live.position.copy(target.position);
        // Nose along the circuit, banked into the turn.
        live.rotation.set(0, Math.atan2(-target.velocity.x, -target.velocity.z), target.orbit.direction * 0.3, "YXZ");
      }
      if (wreck) wreck.visible = !alive;
      if (wreck && !alive && burning) this.explosions.burn(wreck.position.clone().setY(wreck.position.y + 2));
    }
    this.mounts.forEach((mesh, index) => {
      const station = this.simulation.stations[index];
      mesh.visible =
        station.remaining > 0 || stores[station.store].kind === "rocket";
    });
    for (const [id, mesh] of this.rounds) {
      if (!this.simulation.projectiles.some((round) => round.id === id)) {
        this.group.remove(mesh);
        this.rounds.delete(id);
      }
    }
    this.trailTime -= dt;
    const trailing = this.trailTime <= 0;
    if (trailing) this.trailTime = 0.03;
    for (const round of this.simulation.projectiles) {
      if (trailing) this.explosions.trail(round.position, round.kind === "missile");
      let mesh = this.rounds.get(round.id);
      if (!mesh) {
        mesh = this.weapon(true);
        this.rounds.set(round.id, mesh);
        this.group.add(mesh);
      }
      mesh.position.copy(round.position);
      mesh.quaternion.setFromUnitVectors(
        new T.Vector3(0, 0, -1),
        round.velocity.clone().normalize(),
      );
    }
    for (const impact of impacts) {
      const blast = this.blastFor(impact);
      if (blast) this.explode(blast);
    }
    this.explosions.update(dt, viewScale);
  }
  /** Warheads explode, and so does anything destroyed; other gun hits only spark. */
  blastFor(impact: CombatImpact): Blast | null {
    if (!impact.warhead && !impact.destroyed) return null;
    return {
      point: impact.point,
      surface: this.surface(impact),
      size: impact.warhead === "rocket" ? 1 : 1.25,
    };
  }
  explode({ point, surface, size }: Blast) {
    this.explosions.blast(point, surface, size);
  }
  scorch({ point, size }: Blast) {
    this.explosions.scorch(point, size);
  }
  clearEffects() {
    this.explosions.clear();
  }
  show(active: boolean) {
    this.group.visible = this.mounted.visible = active;
    this.hidden.forEach(({ node, visible }) => {
      node.visible = active ? false : visible;
    });
  }
  dispose() {
    this.hidden.forEach(({ node, visible }) => {
      node.visible = visible;
    });
    this.mounted.removeFromParent();
    this.group.removeFromParent();
    for (const geometry of [
      this.body,
      this.nose,
      this.pod,
      this.targetGeometry,
      this.groundGeometry,
      this.flameGeometry,
      this.finGeometry,
    ])
      geometry.dispose();
    for (const material of [
      this.paint,
      this.podPaint,
      this.groundPaint,
      this.airPaint,
      this.flamePaint,
      this.char,
    ])
      material.dispose();
    this.explosions.dispose();
  }
}
