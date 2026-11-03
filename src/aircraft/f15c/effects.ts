import { Group, MathUtils, type AnimationClip } from "three";
import { JetEffects, type JetInput, type JetLayout } from "../jet-effects";
import { nozzleAperture } from "./powerplant-rig";
import { F15CMechanisms } from "./mechanisms";
import { F15C_NOZZLE } from "./design";
import { GunSpool, gunCurves } from "./gun-spool";
import { F15CFuelCutaway } from "./fuel-cutaway";

export const f15cLayout: JetLayout = {
  exhaust: [F15C_NOZZLE.x, F15C_NOZZLE.y, F15C_NOZZLE.exit],
  wingtip: [6.45, -0.06, 3.85],
  noseGear: [0, -0.47, -5],
  mainGear: [0.6, -0.31, 1.94],
  canopy: [0, 0.3781, -3.13],
  flameRadius: F15C_NOZZLE.radius,
  flameLength: 5.8,
  flameEmission: 1.0,
  flameLight: 0.6,
  flameStyle: "afterburner",
  flameBlending: "normal",
  afterburnerBand: [.88, 1],
  lamps: [
    [-6.4, -0.05, 3.85, "#ff3425", "nav"],
    [6.4, -0.05, 3.85, "#39ffa9", "nav"],
    [0, 0.72, -0.6, "#ff4e37", "beacon"],
    [0, -0.32, 8.06, "#ffffff", "tail"],
    [0, -1.7, -4.8, "#fff1d5", "landing"],
  ],
};
export class F15CEffects {
  // Visuals use an isolated group: legacy jet pivot discovery cannot reparent
  // or overwrite the exact CAD hinges in the aircraft's authored hierarchy.
  readonly group = new Group();
  readonly mechanisms: F15CMechanisms;
  private readonly visuals: JetEffects;
  readonly motion;
  private readonly spool: GunSpool;
  readonly fuelCutaway: F15CFuelCutaway;
  constructor(readonly model: Group, clips: readonly AnimationClip[] = []) {
    this.group.name = "F15C_twin_jet_effects";
    model.add(this.group);
    this.visuals = new JetEffects(this.group, f15cLayout);
    this.motion = this.visuals.motion;
    const curves = gunCurves(clips);
    this.spool = new GunSpool(curves);
    this.mechanisms = new F15CMechanisms(model, curves);
    this.fuelCutaway = new F15CFuelCutaway(model);
  }
  setAtmosphericEffects(value: boolean) {
    this.visuals.setAtmosphericEffects(value);
  }
  setReducedMotion(value: boolean) {
    this.visuals.setReducedMotion(value);
  }
  setSuspension(_value: number) {
    /* Rigid authored gear; no validated oleo articulation. */
  }
  touchdown() {
    this.visuals.touchdown();
  }
  reset() {
    this.visuals.reset();
    this.motion.speedBrake = 0;
    this.pose();
  }
  dispose() {
    this.fuelCutaway.dispose();
    this.mechanisms.powerplant.dispose();
    this.visuals.dispose();
    this.group.removeFromParent();
  }
  update(dt: number, input: JetInput) {
    this.visuals.update(dt, input);
    if (dt > 0) {
      // Each step continues from the recorded speed, so live and replayed motion agree.
      const before = this.motion.gunSpeed;
      this.spool.seek(before);
      this.spool.step(dt, input.gunFiring === true);
      this.motion.gunSpeed = this.spool.speed;
      this.motion.gunAngle += ((before + this.spool.speed) / 2) * dt;
      this.motion.speedBrake = MathUtils.damp(
        this.motion.speedBrake,
        MathUtils.clamp(input.speedBrake ?? 0, 0, 1),
        3,
        dt,
      );
      if (input.grounded)
        this.motion.wheelDistance += (input.groundSpeed ?? 0) * dt;
    }
    this.pose();
  }
  private pose() {
    const s = this.motion;
    this.mechanisms.apply({
      gear: s.gear,
      flaps: s.flaps,
      roll: s.roll,
      pitch: s.pitch,
      yaw: s.yaw,
      canopy: s.canopy,
      speedBrake: s.speedBrake,
      power: s.rpm, burner: s.burner, gunAngle: s.gunAngle, gunSpeed: s.gunSpeed,
    });
    this.visuals.setExhaustScale((F15C_NOZZLE.radius + nozzleAperture(s.rpm, s.burner).exit) / F15C_NOZZLE.radius);
    for (const side of ["Nose", "Left", "Right"]) {
      const wheel = this.mechanisms.parts.get(`Wheel_${side}`);
      if (wheel)
        wheel.rotation.x = -s.wheelDistance / (side === "Nose" ? 0.27 : 0.38);
    }
  }
}
