import * as T from "three";
import { JetMotion, type JetInput } from "./jet-effects";

/** Uses the exported Blender gear curves; flight input drives the other rig nodes. */
export class AureliaEffects {
  readonly motion = Object.assign(new JetMotion(), { fanPhase: 0 });
  private mixer: T.AnimationMixer;
  private lights: T.Mesh[] = [];
  private heat: T.Mesh[] = [];
  private clock = { value: 0 };
  private reduced = false;
  constructor(
    private root: T.Object3D,
    clips: T.AnimationClip[],
  ) {
    this.mixer = new T.AnimationMixer(root);
    const tracks = clips
      .flatMap((c) => c.tracks)
      .filter((t) => /retraction_hinge|door_hinge/.test(t.name));
    if (!tracks.length)
      throw new Error("Aurelia Blender gear animation is missing");
    const unique = [...new Map(tracks.map((t) => [t.name, t])).values()];
    this.mixer
      .clipAction(new T.AnimationClip("Blender gear cycle", -1, unique))
      .play();
    for (const [x, y, z, color] of [
      [-13.3, 4.05, 5.34, 0xff2415],
      [13.3, 4.05, 5.34, 0x19ff70],
      [-13.3, 4.15, 5.5, 0xffffff],
      [13.3, 4.15, 5.5, 0xffffff],
      [0, 6.05, 2, 0xff2010],
    ]) {
      const light = new T.Mesh(
        new T.SphereGeometry(0.065, 8, 6),
        new T.MeshBasicMaterial({ color, toneMapped: false }),
      );
      light.position.set(x, y, z);
      root.add(light);
      this.lights.push(light);
    }
    for (const side of [-1, 1]) {
      const m = new T.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0,
        metalness: 0,
        transmission: 1,
        thickness: 0.01,
        ior: 1.008,
        depthWrite: false,
      });
      m.onBeforeCompile = (shader) => {
        shader.uniforms.exhaustTime = this.clock;
        shader.fragmentShader =
          "uniform float exhaustTime;\n" + shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace(
          "#include <normal_fragment_begin>",
          `#include <normal_fragment_begin>
          normal = normalize(normal + vec3(sin(vViewPosition.y*31.0+exhaustTime*9.0),cos(vViewPosition.x*27.0-exhaustTime*7.0),0.0)*0.12);`,
        );
      };
      const heat = new T.Mesh(new T.SphereGeometry(1, 20, 12), m);
      heat.position.set(side * 3.26, 4.25, 12.4);
      heat.scale.set(0.48, 0.48, 2.5);
      heat.frustumCulled = false;
      root.add(heat);
      this.heat.push(heat);
    }
  }
  setReducedMotion(value: boolean) {
    this.reduced = value;
  }
  reset() {
    Object.assign(this.motion, new JetMotion(), { fanPhase: 0 });
  }
  setSuspension(_value: number) {
    // No separate lower oleo carriers in this rig: translating LandingGear
    // separates its hinges and door mounts from the fuselage.
  }
  update(dt: number, input: JetInput) {
    this.motion.update(dt, { ...input, burner: false });
    const s = this.motion;
    s.fanPhase = (s.fanPhase + s.rpm * 18 * dt) % (Math.PI * 2);
    this.mixer.setTime(((1 - s.gear) * 123) / 24);
    const rotate = (name: string, axis: "x" | "y" | "z", angle: number) => {
      const o = this.root.getObjectByName(name);
      if (o) o.rotation[axis] = angle;
    };
    rotate("Aileron_Left", "x", s.roll * 0.26);
    rotate("Aileron_Right", "x", -s.roll * 0.26);
    rotate("Elevator_Left", "x", -s.pitch * 0.2);
    rotate("Elevator_Right", "x", -s.pitch * 0.2);
    rotate("Rudder", "y", s.yaw * 0.24);
    rotate("Flap_Left", "x", s.flaps * 0.38);
    rotate("Flap_Right", "x", s.flaps * 0.38);
    // Deterministic phase keeps saved replays and paused frames stable.
    rotate("Fan_Left", "z", s.fanPhase);
    rotate("Fan_Right", "z", s.fanPhase);
    const phase = s.time % 1.25;
    this.lights.forEach(
      (o, i) =>
        (o.visible =
          input.lights &&
          (i < 2 ||
            (!this.reduced &&
              (i === 4
                ? (s.time + 0.5) % 1.25 < 0.09
                : phase < 0.08 || (phase > 0.2 && phase < 0.28))))),
    );
    this.clock.value = s.time;
    this.heat.forEach((o) => {
      o.visible = s.rpm > 0.12 && !this.reduced;
      (o.material as T.MeshPhysicalMaterial).ior = 1 + 0.008 * s.rpm;
    });
  }
}
