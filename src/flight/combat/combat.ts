import { Camera, Group, Object3D, PerspectiveCamera, Vector3 } from "three";
import { combatAircraft } from "../../aircraft/weapons/combat-loadouts";
import { CombatHud } from "../../hud/combat-hud";
import type { CannonHit } from "../cannon";
import { CombatSimulation, REARM_TIME, RearmCrew, type WeaponPose } from "./simulation";
import { stores } from "./loadout";
import { rangeTargets } from "./range";
import { CombatVisuals } from "./visuals";
import { captureCombat, encodeBlast, ReplayCombat, type CombatFrame } from "./tape";

export type CombatAudio = {
  seeker(state: "off" | "search" | "lock", time: number): void;
  blast(distance: number): void;
  launch(): void;
};
const ROCKET_SPEED = stores["rocket-pod-7"].speed;

export class CombatRange {
  readonly group = new Group();
  readonly replayGroup = new Group();
  private replay: { combat: ReplayCombat; frames: readonly { t: number; combat?: CombatFrame }[] } | null = null;
  private blasts: number[][] = [];
  private id = "";
  private aircraft: Object3D | null = null;
  simulation: CombatSimulation | null = null;
  gun = new Vector3();
  hasGun = false;
  private hud: CombatHud;
  private visuals: CombatVisuals | null = null;
  private feedback = "";
  private feedbackTime = 0;
  private time = 0;
  private viewScale = 600;
  private crew = new RearmCrew();
  constructor(
    container: HTMLElement,
    private readonly height: (x: number, z: number) => number,
    private readonly water: (x: number, z: number) => boolean = () => false,
    private readonly audio?: CombatAudio,
    private readonly onRearm?: () => void,
  ) {
    this.hud = new CombatHud(container);
  }
  start(id: string, aircraft: Object3D, _pose: WeaponPose) {
    this.stop();
    const configuration = combatAircraft(id, aircraft);
    if (!configuration) return false;
    this.id = id;
    this.aircraft = aircraft;
    this.hasGun = configuration.gun !== null;
    this.gun.fromArray(configuration.gun ?? [0, 0, 0]);
    this.simulation = new CombatSimulation(
      configuration.hardpoints,
      configuration.loadout,
      rangeTargets(this.height),
    );
    this.visuals = new CombatVisuals(this.simulation, aircraft, this.water, configuration.keepStores);
    this.group.add(this.visuals.group);
    this.visuals.update(0, []);
    return true;
  }
  stop() {
    this.endReplay();
    this.blasts = [];
    this.visuals?.dispose();
    this.visuals = null;
    this.simulation = null;
    this.suspend();
    this.feedback = "";
    this.feedbackTime = 0;
    this.crew = new RearmCrew();
    this.group.visible = false;
    this.hud.hide();
  }
  suspend() {
    this.simulation?.suspend();
    this.hud.suspend();
    this.audio?.seeker("off", 0);
  }
  gunPressed() {
    return this.hud.pressed("gun");
  }
  targets() {
    return this.simulation?.targets.filter((target) => target.health > 0) ?? [];
  }
  private note(text: string) {
    this.feedback = text;
    this.feedbackTime = 1.4;
  }
  step(
    dt: number,
    pose: WeaponPose,
    keys: ReadonlySet<string>,
    allowed: boolean,
    gunHits: readonly CannonHit[],
    grounded = false,
    pavement = false,
  ) {
    const simulation = this.simulation;
    if (!simulation) return;
    this.time += dt;
    const impacts = [
      ...simulation.gunHits(gunHits),
      ...simulation.step(dt, pose, this.height),
    ];
    if (this.crew.step(dt, pose.velocity.length(), grounded, pavement)) {
      simulation.rearm();
      this.onRearm?.();
      this.note("REARMED");
    }
    for (const [kind, key] of [
      ["rocket", "KeyK"],
      ["missile", "KeyL"],
    ] as const) {
      const pressed = allowed && (keys.has(key) || this.hud.pressed(kind));
      if (simulation.trigger(kind, pressed, pose)) {
        this.note(kind === "rocket" ? "ROCKET AWAY" : "FOX TWO");
        this.audio?.launch();
      }
    }
    if (impacts.length) {
      this.note(
        impacts.some((impact) => impact.destroyed)
          ? "TARGET DESTROYED"
          : impacts.some((impact) => impact.target)
            ? "HIT"
            : "IMPACT",
      );
      for (const impact of impacts) {
        if (impact.warhead) this.audio?.blast(impact.point.distanceTo(pose.position));
        const blast = this.visuals?.blastFor(impact);
        if (blast) this.blasts.push(encodeBlast(blast));
      }
    }
    this.feedbackTime = Math.max(0, this.feedbackTime - dt);
    const missiles = simulation.ammunition("missile") > 0;
    this.audio?.seeker(
      !allowed || !missiles || !simulation.lock ? "off" : simulation.locked ? "lock" : "search",
      this.time,
    );
    this.visuals?.update(dt, impacts, this.viewScale);
  }
  /** The sandbox's state for a replay frame; takes the blasts since the last call. */
  capture(): CombatFrame | undefined {
    if (!this.simulation) return undefined;
    const frame = captureCombat(this.simulation, this.blasts);
    this.blasts = [];
    return frame;
  }
  beginReplay(frames: readonly { t: number; combat?: CombatFrame }[]) {
    this.endReplay();
    if (!this.simulation || !this.aircraft) return;
    const combat = new ReplayCombat(this.id, this.aircraft, this.height, this.water, (point) =>
      this.audio?.blast(point.distanceTo(this.aircraft!.position)),
    );
    this.replayGroup.add(combat.visuals.group);
    this.replay = { combat, frames };
  }
  poseReplay(time: number) {
    this.replay?.combat.pose(this.replay.frames, time, this.viewScale, true);
  }
  endReplay() {
    this.replay?.combat.dispose();
    this.replay = null;
  }
  /** Where a rocket fired now would land, flying the same ballistic path. */
  private rocketImpact(pose: WeaponPose) {
    const point = pose.position.clone();
    const velocity = new Vector3(0, 0, -ROCKET_SPEED)
      .applyQuaternion(pose.quaternion)
      .add(pose.velocity);
    const step = 0.05;
    for (let t = 0; t < 8; t += step) {
      point.addScaledVector(velocity, step);
      velocity.y -= 9.81 * step;
      if (point.y <= this.height(point.x, point.z)) return point;
    }
    return null;
  }
  render(
    visible: boolean,
    ammunition: number,
    camera: Camera,
    pose: WeaponPose,
    showRange = visible,
    bufferHeight = 0,
  ) {
    this.group.visible = showRange;
    this.visuals?.show(showRange);
    this.replay?.combat.visuals.show(true);
    if (bufferHeight && camera instanceof PerspectiveCamera)
      this.viewScale = bufferHeight / (2 * Math.tan((camera.fov * Math.PI) / 360));
    // This is a boresight only. The separate cannon reticle predicts gun drop.
    const aim = this.simulation
      ? new Vector3(0, 0, -1000)
          .applyQuaternion(pose.quaternion)
          .add(pose.position)
      : null;
    const seekerEdge = aim
      ? new Vector3(0, Math.tan((12 * Math.PI) / 180) * 1000, -1000)
          .applyQuaternion(pose.quaternion)
          .add(pose.position)
      : null;
    this.hud.render(
      visible,
      this.simulation,
      this.hasGun ? ammunition : null,
      camera,
      pose.position,
      aim,
      seekerEdge,
      visible && this.simulation && this.simulation.ammunition("rocket") > 0 ? this.rocketImpact(pose) : null,
      this.feedbackTime > 0 ? this.feedback : "",
      this.crew.progress > 0 ? Math.ceil(REARM_TIME - this.crew.progress) : 0,
    );
  }
  dispose() {
    this.stop();
    this.hud.dispose();
  }
}
