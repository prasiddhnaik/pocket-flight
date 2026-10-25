import { Group, MathUtils } from "three";
import { JetEffects, type JetInput, type JetLayout } from "../jet-effects";
import { nozzleAperture } from "./powerplant-rig";
import { F15CMechanisms } from "./mechanisms";

export const f15cLayout: JetLayout = {
  exhaust: [1.025, -0.125, 9.431],
  wingtip: [6.45, 0.6, 4.2],
  noseGear: [0, -0.47, -5],
  mainGear: [0.6, -0.31, 1.94],
  canopy: [0, 1.04, -3.13],
  flameRadius: 0.57,
  flameLength: 3.6,
  flameEmission: 1.35,
  flameLight: 0.35,
  flameStyle: "f100",
  flameBlending: "normal",
  afterburnerBand: [.88, 1],
  lamps: [
    [-6.37, 0.61, 4.3, "#ff3425", "nav"],
    [6.37, 0.61, 4.3, "#39ffa9", "nav"],
    [0, 0.95, -0.1, "#ff4e37", "beacon"],
    [0, 0.6, 9.25, "#ffffff", "tail"],
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
  constructor(readonly model: Group) {
    this.group.name = "F15C_twin_jet_effects";
    model.add(this.group);
    this.visuals = new JetEffects(this.group, f15cLayout);
    this.motion = this.visuals.motion;
    this.mechanisms = new F15CMechanisms(model);
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
    this.mechanisms.powerplant.dispose();
    this.visuals.dispose();
    this.group.removeFromParent();
  }
  update(dt: number, input: JetInput) {
    this.visuals.update(dt, input);
    if (dt > 0) {
      const target = input.gunFiring ? 100 / 6 * Math.PI * 2 : 0;
      const rate = input.gunFiring ? 22 : 9;
      const decay = Math.exp(-rate * dt);
      this.motion.gunAngle += target * dt + (this.motion.gunSpeed - target) * (1 - decay) / rate;
      this.motion.gunSpeed = target + (this.motion.gunSpeed - target) * decay;
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
      power: s.rpm, burner: s.burner, gunAngle: s.gunAngle,
    });
    this.visuals.setExhaustScale((.57 + nozzleAperture(s.rpm, s.burner).exit) / .57);
    for (const side of ["Nose", "Left", "Right"]) {
      const wheel = this.mechanisms.parts.get(`Wheel_${side}`);
      if (wheel)
        wheel.rotation.x = -s.wheelDistance / (side === "Nose" ? 0.27 : 0.38);
    }
  }
}
