import { peregrineLayout } from "./peregrine/layout";
import * as T from "three";
import { exhaustSlabs, f100FlameFragment } from "./f15c/exhaust-shader";
import { StormbirdMechanisms } from "./stormbird/stormbird-mechanisms";
import stormbirdGeometry from "./stormbird/stormbird-geometry.json";
import { STORMBIRD_GEAR_SECONDS } from "./stormbird/stormbird-kinematics";

export type JetMode =
  | "manual"
  | "startup"
  | "takeoff"
  | "cruise"
  | "afterburner"
  | "landing"
  | "emergency";
export type JetInput = {
  throttle: number;
  burner: boolean;
  gear: boolean;
  canopy: boolean;
  lights: boolean;
  roll: number;
  pitch: number;
  yaw: number;
  flaps: number;
  speed: number;
  damage: number;
  contrails: boolean;
  gearPosition?: number;
  gearSteering?: number;
  groundSpeed?: number;
  grounded?: boolean;
  controlsResolved?: boolean;
  powerResolved?: boolean;
  speedBrake?: number;
  gunFiring?: boolean;
};
type Point = [number, number, number];
export type JetLayout = {
  exhaust: Point;
  wingtip: Point;
  noseGear: Point;
  mainGear: Point;
  canopy: Point;
  flameRadius: number;
  flameLength: number;
  flameEmission?: number;
  flameLight?: number;
  flameBlending?: "normal";
  flameStyle?: "f100";
  afterburnerBand?: [number, number];
  gearDoorsOpen?: boolean;
  lamps?: [number, number, number, string, string][];
};
export const initialJetInput = (): JetInput => ({
  throttle: 0,
  burner: false,
  gear: true,
  canopy: false,
  lights: true,
  roll: 0,
  pitch: 0,
  yaw: 0,
  flaps: 0,
  speed: 0,
  damage: 0,
  contrails: false,
});
const clamp = T.MathUtils.clamp;
const smooth = (a: number, b: number, t: number) =>
  T.MathUtils.smoothstep(t, a, b);
export function sequenceInput(mode: JetMode, t: number): JetInput {
  const i = initialJetInput();
  if (mode === "startup") {
    i.throttle = 0.26 * smooth(1, 6, t);
    i.canopy = t < 2;
  }
  if (mode === "takeoff") {
    i.throttle = 0.25 + 0.75 * smooth(0, 6, t);
    i.burner = t > 4;
    i.gear = t < 10;
    i.speed = 180 * smooth(3, 16, t);
    i.flaps = t < 12 ? 0.3 : 0;
    i.pitch = 0.25 * smooth(6, 10, t);
  }
  if (mode === "cruise") {
    i.throttle = 0.65;
    i.gear = false;
    i.speed = 230;
    i.contrails = true;
    i.roll = 0.15 * Math.sin(t * 0.4);
  }
  if (mode === "afterburner") {
    i.throttle = 1;
    i.burner = true;
    i.gear = false;
    i.speed = 330;
  }
  if (mode === "landing") {
    i.throttle = 0.25 * (1 - smooth(9, 14, t));
    i.speed = 95 * (1 - smooth(8, 17, t));
    i.gear = true;
    i.flaps = 0.85;
    i.pitch = 0.15 * (1 - smooth(8, 10, t));
  }
  if (mode === "emergency") {
    i.throttle = 0.48;
    i.gear = false;
    i.speed = 150;
    i.damage = smooth(1, 3, t);
    i.yaw = 0.15;
  }
  return i;
}
export class JetMotion {
  #mechanical: boolean;
  #afterburnerBand: [number, number];
  constructor(mechanical = false, afterburnerBand: [number, number] = [.75, .95]) {
    this.#mechanical = mechanical;
    this.#afterburnerBand = afterburnerBand;
  }
  time = 0;
  rpm = 0;
  burner = 0;
  gear = 1;
  speedBrake = 0;
  canopy = 0;
  roll = 0;
  pitch = 0;
  yaw = 0;
  flaps = 0;
  speed = 0;
  damage = 0;
  rotorAngle = 0;
  wheelAngle = 0;
  wheelDistance = 0;
  gearSteering = 0;
  fanPhase = 0;
  gunAngle = 0;
  gunSpeed = 0;
  touchdownAge = 10;
  update(dt: number, i: JetInput) {
    if (dt <= 0) return;
    this.time += dt;
    this.touchdownAge += dt;
    const previousRpm = this.rpm,
      previousSpeed = this.speed;
    const approach = (value: number, target: number, rate: number) =>
      T.MathUtils.damp(value, target, rate, dt);
    this.rpm = i.powerResolved ? clamp(i.throttle, 0, 1) : approach(
      this.rpm,
      clamp(i.throttle, 0, 1),
      i.throttle > this.rpm ? 0.85 : 0.55,
    );
    this.burner = approach(
      this.burner,
      i.burner ? smooth(...this.#afterburnerBand, this.rpm) : 0,
      i.powerResolved ? 12 : 3,
    );
    const advance = (value: number, target: number, seconds: number) =>
      value + clamp(target - value, -dt / seconds, dt / seconds);
    this.gear = i.gearPosition === undefined
      ? this.#mechanical
        ? advance(this.gear, i.gear ? 1 : 0, STORMBIRD_GEAR_SECONDS)
        : approach(this.gear, i.gear ? 1 : 0, 1.35)
      : clamp(i.gearPosition, 0, 1);
    const canopyTarget = i.canopy && this.rpm < 0.12 && this.speed < 2 ? 1 : 0;
    this.canopy = this.#mechanical
      ? advance(this.canopy, canopyTarget, 3.2)
      : approach(this.canopy, canopyTarget, 1.8);
    for (const key of ["roll", "pitch", "yaw"] as const)
      this[key] = i.controlsResolved ? clamp(i[key], -1, 1) : approach(this[key], clamp(i[key], -1, 1), 7);
    this.gearSteering = i.gearSteering ?? this.yaw;
    this.flaps = i.controlsResolved ? clamp(i.flaps, 0, 1) : approach(this.flaps, clamp(i.flaps, 0, 1), 2);
    this.speed = approach(this.speed, Math.max(0, i.speed), 1.3);
    this.damage = approach(this.damage, clamp(i.damage, 0, 1), 2);
    const rate = i.throttle > previousRpm ? 0.85 : 0.55;
    const target = clamp(i.throttle, 0, 1);
    const revolutions =
      target * dt +
      ((previousRpm - target) * (1 - Math.exp(-rate * dt))) / rate;
    this.rotorAngle += revolutions * 48;
    this.fanPhase += revolutions * 18;
    const speedTarget = Math.max(0, i.speed);
    this.wheelAngle +=
      (speedTarget * dt +
        ((previousSpeed - speedTarget) * (1 - Math.exp(-1.3 * dt))) / 1.3) *
      0.08;
    if (this.#mechanical && i.grounded)
      this.wheelDistance += (i.groundSpeed ?? 0) * dt;
  }
}

const flameVertex = `#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 p; void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
#include <logdepthbuf_vertex>
}`;
// Integrate emission through a bounded volume so the exhaust reads consistently from every angle.
const flameFragment = `precision highp float;
#include <logdepthbuf_pars_fragment>
varying vec3 p; uniform vec3 eye; uniform float time,strength,phase,gain;
float hash(vec3 q){return fract(sin(dot(q,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise(vec3 q){vec3 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);
return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){

#include <logdepthbuf_fragment>
${exhaustSlabs}
float stepSize=(leave-entry)/40.;vec3 emission=vec3(0);float density=0.;
for(int j=0;j<40;j++){
vec3 q=eye+ray*(entry+(float(j)+.5)*stepSize);float z=clamp(q.z,0.,1.);
float n=noise(vec3(q.xy*6.,z*19.-time*5.+phase));
float radius=mix(.84,.20,z)*(1.+.035*sin(z*37.));
float r=length(q.xy)/radius;
float envelope=exp(-r*r*3.2)*(1.-smoothstep(.64,1.,z))*smoothstep(0.,.018,z);
float cell=abs(fract(z*4.5+.08)-.5)*2.;
float shock=exp(-pow((r-cell*.52)*9.,2.))*(1.-z)*.27;
float core=exp(-r*r*12.);
vec3 color=mix(vec3(.22,.32,.65),vec3(1.,.37,.09),smoothstep(.04,.36,z));
color=mix(color,vec3(1.,.78,.47),core*.7);
float d=envelope*(.87+.18*n+shock)*stepSize;
emission+=color*d;density+=d;
}
float alpha=1.-exp(-density*2.8*strength);
gl_FragColor=vec4(emission/max(density,.0001)*gain,alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
function flameGeometry() {
  return new T.BoxGeometry(2, 2, 1).translate(0, 0, 0.5);
}
function glowTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d")!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.15, "rgba(255,255,255,.8)");
  gradient.addColorStop(0.45, "rgba(255,255,255,.2)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new T.CanvasTexture(c);
}
const particleVertex = `#include <common>
#include <logdepthbuf_pars_vertex>
attribute float alpha;attribute float size;varying float a;uniform float pixelRatio;void main(){a=alpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=min(160.,size*pixelRatio*650./max(1.,-mv.z));gl_Position=projectionMatrix*mv;
#include <logdepthbuf_vertex>
}`;
const particleFragment = `#include <logdepthbuf_pars_fragment>
varying float a;uniform vec3 color;void main(){
#include <logdepthbuf_fragment>
float d=length(gl_PointCoord-.5)*2.;float soft=exp(-d*d*2.5)*(1.-smoothstep(.6,1.,d));gl_FragColor=vec4(color,soft*a);}`;

export class JetEffects {
  readonly motion: JetMotion;
  readonly group = new T.Group();
  private flames: T.Group[] = [];
  private exhaustScale = 1;
  setExhaustScale(value: number) {
    const ratio = value / this.exhaustScale;
    this.exhaustScale = value;
    for (const flame of this.flames) { flame.scale.x *= ratio; flame.scale.y *= ratio; }
  }
  private flameMaterials: T.ShaderMaterial[] = [];
  private engineGlows: T.Sprite[] = [];
  private engineLights: T.PointLight[] = [];
  private lamps: { sprite: T.Sprite; kind: string }[] = [];
  private canopyPivot: T.Group;
  private mechanisms?: StormbirdMechanisms;
  private legs: { pivot: T.Group; side: number; nose: boolean }[] = [];
  private wheels: T.Object3D[] = [];
  private smoke: T.Points;
  private trail: T.Points;
  private spriteMap = glowTexture();
  private reduced = false;
  private atmosphericEffects = true;
  private nodes = new Map<string, T.Object3D>();
  constructor(
    readonly model: T.Group,
    private readonly layout = peregrineLayout,
  ) {
    const mechanical =
      model.getObjectByName("Stormbird_HX40")?.userData.mechanisms;
    this.motion = new JetMotion(!!mechanical, layout.afterburnerBand);
    this.group.name = "Peregrine effects";
    model.add(this.group);
    const geometry = flameGeometry();
    const [ex, ey, ez] = layout.exhaust;
    for (const [index, x] of [-ex, ex].entries()) {
      const plume = new T.Group();
      plume.position.set(x, ey, ez);
      this.group.add(plume);
      this.flames.push(plume);
      {
        const material = new T.ShaderMaterial({
          vertexShader: flameVertex,
          fragmentShader: layout.flameStyle === "f100" ? f100FlameFragment : flameFragment,
          uniforms: {
            time: { value: 0 },
            strength: { value: 0 },
            phase: { value: index * 2.3 },
            gain: { value: layout.flameEmission ?? 1.7 },
            eye: { value: new T.Vector3() },
          },
          transparent: true,
          depthWrite: false,
          side: T.BackSide,
          blending:
            layout.flameBlending === "normal"
              ? T.NormalBlending
              : T.AdditiveBlending,
        });
        const mesh = new T.Mesh(geometry, material);
        mesh.onBeforeRender = (_renderer, _scene, camera) => {
          mesh.worldToLocal(
            camera.getWorldPosition(material.uniforms.eye.value),
          );
        };
        mesh.renderOrder = 4;
        plume.add(mesh);
        this.flameMaterials.push(material);
      }
      const glow = new T.Sprite(
        new T.SpriteMaterial({
          map: this.spriteMap,
          color: "#ffd0a0",
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending,
        }),
      );
      glow.position.set(x, ey, ez - 0.08);
      this.group.add(glow);
      this.engineGlows.push(glow);
      const light = new T.PointLight("#ff792f", 0, 9, 2);
      light.position.set(x, ey, ez + 0.68);
      this.group.add(light);
      this.engineLights.push(light);
    }
    for (const [x, y, z, color, kind] of layout.lamps ?? [
      [-9.9, 4.08, 5.2, "#ff3425", "nav"],
      [9.9, 4.08, 5.2, "#39ffa9", "nav"],
      [0, 7.87, 12.5, "#ff4e37", "beacon"],
      [0, 2.65, 12.85, "#ffffff", "tail"],
      [-9.88, 4.1, 5.3, "#ffffff", "strobe"],
      [9.88, 4.1, 5.3, "#ffffff", "strobe"],
      [0, 1.6, -7.08, "#fff1d5", "landing"],
    ]) {
      const sprite = new T.Sprite(
        new T.SpriteMaterial({
          map: this.spriteMap,
          color,
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending,
        }),
      );
      sprite.position.set(x, y, z);
      sprite.scale.setScalar(kind === "landing" ? 0.7 : 0.4);
      this.group.add(sprite);
      this.lamps.push({ sprite, kind });
    }
    const pivot = (name: string, pos: T.Vector3) => {
      const g = new T.Group();
      g.position.copy(pos);
      model.add(g);
      model.updateMatrixWorld(true);
      const object = model.getObjectByName(name);
      if (object) g.attach(object);
      return g;
    };
    if (mechanical) this.mechanisms = new StormbirdMechanisms(model);
    const canopyHinge = model.getObjectByName("Canopy")?.userData.hinge_glTF;
    this.canopyPivot = mechanical
      ? new T.Group()
      : pivot(
          "Canopy",
          new T.Vector3().fromArray(
            Array.isArray(canopyHinge) ? canopyHinge : layout.canopy,
          ),
        );
    if (!mechanical) {
      this.legs.push({
        pivot: pivot("Nose_steering", new T.Vector3(...layout.noseGear)),
        side: 0,
        nose: true,
      });
      for (const side of [-1, 1])
        this.legs.push({
          pivot: pivot(
            "Main_gear_" + (side < 0 ? "Left" : "Right"),
            new T.Vector3(
              side * layout.mainGear[0],
              layout.mainGear[1],
              layout.mainGear[2],
            ),
          ),
          side,
          nose: false,
        });
    }
    model.traverse((o) => {
      if (!this.nodes.has(o.name)) this.nodes.set(o.name, o);
      if (
        /^(Nose_wheel_|Main_wheel_|Nose_steering_wheel_|Nose_gear_wheel_|Main_gear_(Left|Right)_wheel_)/.test(
          o.name,
        ) &&
        !o.name.includes(" | ") &&
        !(o instanceof T.Mesh)
      )
        this.wheels.push(o);
    });
    if (layout.gearDoorsOpen) {
      const noseLeg = this.nodes.get(
        mechanical ? "Nose_gear" : "Nose_steering",
      );
      model.updateMatrixWorld(true);
      if (noseLeg)
        for (const { sprite, kind } of this.lamps)
          if (kind === "landing") noseLeg.attach(sprite);
    }
    const particles = (name: string, count: number, color: string) => {
      const geo = new T.BufferGeometry();
      geo.setAttribute(
        "position",
        new T.BufferAttribute(new Float32Array(count * 3), 3),
      );
      geo.setAttribute(
        "alpha",
        new T.BufferAttribute(new Float32Array(count), 1),
      );
      geo.setAttribute(
        "size",
        new T.BufferAttribute(new Float32Array(count), 1),
      );
      const m = new T.ShaderMaterial({
        vertexShader: particleVertex,
        fragmentShader: particleFragment,
        uniforms: {
          color: { value: new T.Color(color) },
          pixelRatio: { value: Math.min(devicePixelRatio, 1.75) },
        },
        transparent: true,
        depthWrite: false,
      });
      const p = new T.Points(geo, m);
      p.name = name;
      p.frustumCulled = false;
      this.group.add(p);
      return p;
    };
    this.smoke = particles("Engine smoke and touchdown dust", 100, "#879096");
    this.trail = particles("Condensation and wingtip vortices", 480, "#dceaf0");
  }
  setAtmosphericEffects(value: boolean) {
    this.atmosphericEffects = value;
    if (!value) this.smoke.visible = this.trail.visible = false;
  }
  reset() {
    Object.assign(this.motion, new JetMotion(!!this.mechanisms, this.layout.afterburnerBand));
    this.mechanisms?.reset();
  }
  dispose() {
    const geometries = new Set<T.BufferGeometry>(), materials = new Set<T.Material>();
    this.group.traverse(node => {
      if (node instanceof T.Mesh || node instanceof T.Points) geometries.add(node.geometry);
      if (node instanceof T.Mesh || node instanceof T.Points || node instanceof T.Sprite)
        (Array.isArray(node.material) ? node.material : [node.material]).forEach(material => materials.add(material));
    });
    geometries.forEach(geometry => geometry.dispose());
    materials.forEach(material => material.dispose());
    this.spriteMap.dispose();
    this.group.removeFromParent();
  }
  touchdown() {
    this.motion.touchdownAge = 0;
  }
  setSuspension(value: number) {
    this.mechanisms?.setSuspension(value);
  }
  setReducedMotion(value: boolean) {
    this.reduced = value;
  }
  update(dt: number, input: JetInput) {
    this.motion.update(dt, input);
    const s = this.motion,
      t = s.time;
    for (const name of ["Compressor_-1", "Compressor_1"]) {
      const o = this.nodes.get(name);
      if (o) o.rotation.z = this.motion.rotorAngle;
    }
    for (const w of this.wheels) {
      const tire =
        this.mechanisms &&
        stormbirdGeometry.wheels.find((t) => t.name === w.name);
      w.rotation.x = tire
        ? -this.motion.wheelDistance / tire.radius
        : this.motion.wheelAngle;
    }
    const set = (name: string, axis: "x" | "y", v: number) => {
      const o = this.nodes.get(name);
      if (!o) return;
      const datum = o.userData.hinge_axis;
      if (Array.isArray(datum))
        o.quaternion.setFromAxisAngle(
          new T.Vector3().fromArray(datum).normalize(),
          v,
        );
      else o.rotation[axis] = v;
    };
    set("Aileron_Left", "x", s.roll * 0.38);
    set("Aileron_Right", "x", -s.roll * 0.38);
    set("Rudder", "y", s.yaw * 0.42);
    for (const side of ["Left", "Right"]) {
      set("Rudder_" + side, "y", s.yaw * 0.42);
      set("Canard_" + side, "x", s.pitch * 0.28);
      set("Elevator_" + side, "x", -s.pitch * 0.4);
      set("Flap_" + side, "x", s.flaps * 0.5);
    }
    if (this.mechanisms) {
      this.mechanisms.apply(s.gear, s.canopy, s.gearSteering);
    } else {
      this.canopyPivot.rotation.x = s.canopy * 0.65;
      for (const part of ["Nose", "Main"])
        for (const side of ["Left", "Right"]) {
          const door = this.nodes.get(part + "_door_" + side);
          if (door)
            door.rotation.z = this.layout.gearDoorsOpen
              ? ((side === "Left" ? -1 : 1) *
                  (1 - smooth(0.03, 0.35, s.gear)) *
                  82 *
                  Math.PI) /
                180
              : ((side === "Left" ? 1 : -1) *
                  (1 - smooth(0.03, 0.35, s.gear)) *
                  Math.PI) /
                2;
          for (const leg of ["Left", "Right"]) {
            const door = this.nodes.get(`${part}_door_${leg}_${side}`);
            if (door)
              door.rotation.z = this.layout.gearDoorsOpen
                ? ((side === "Left" ? -1 : 1) *
                    (1 - smooth(0.03, 0.35, s.gear)) *
                    82 *
                    Math.PI) /
                  180
                : ((side === "Left" ? 1 : -1) *
                    (1 - smooth(0.03, 0.35, s.gear)) *
                    Math.PI) /
                  2;
          }
        }
      this.legs.forEach(({ pivot, side, nose }) => {
        const fold = 1 - smooth(0.03, 0.98, s.gear);
        pivot.rotation[nose ? "x" : "z"] = nose
          ? -fold * 1.48
          : -side * fold * 1.2;
        pivot.position.y =
          (nose ? this.layout.noseGear[1] : this.layout.mainGear[1]) +
          fold * 0.25;
        pivot.visible = s.gear > 0.015;
      });
      const steering = this.nodes.get("Nose_steering");
      if (steering) steering.rotation.y = s.yaw * 0.35 * s.gear;
    }
    for (let index = 0; index < 2; index++) {
      const health = index === 0 ? 1 - s.damage : 1;
      const power = s.burner * health;
      const hot = s.rpm * health;
      const f100 = this.layout.flameStyle === "f100";
      const flicker = f100 && !this.reduced ? 1 + .018 * Math.sin(t * 47 + index * 1.7) + .008 * Math.sin(t * 83) : 1;
      this.flames[index].visible = power > 0.01;
      this.flames[index].scale.set(
        this.layout.flameRadius * this.exhaustScale * flicker,
        this.layout.flameRadius * this.exhaustScale * flicker,
        this.layout.flameLength * (f100 ? .28 + power * .72 : .48 + power * .52) * flicker,
      );
      const u = this.flameMaterials[index].uniforms;
      u.time.value = this.reduced ? 0 : t;
      u.strength.value = power;
      const glow = this.engineGlows[index];
      glow.material.color.set(f100 ? "#b9acff" : "#ffd0a0");
      glow.material.opacity = hot * 0.08 + power * (f100 ? .12 : .24);
      glow.scale.setScalar((f100 ? .9 : .7) + power * .3);
      this.engineLights[index].intensity =
        (hot * 0.4 + power * 5) * (this.layout.flameLight ?? 1);
    }
    for (const { sprite, kind } of this.lamps) {
      let a = input.lights ? 1 : 0;
      if (kind === "beacon")
        a *= this.reduced
          ? 0.35
          : Math.pow(Math.max(0, Math.sin(t * Math.PI)), 12);
      if (kind === "strobe") {
        const phase = t % 2.2;
        a *= this.reduced
          ? 0.2
          : phase < 0.06 || (phase > 0.17 && phase < 0.23)
            ? 1
            : 0;
      }
      if (kind === "landing") a *= s.gear * smooth(0, 0.15, s.rpm);
      sprite.material.opacity = a;
    }
    if (!this.atmosphericEffects) return;
    this.smoke.visible = s.damage > 0.02 || this.motion.touchdownAge < 2.8;
    if (this.smoke.visible)
      this.particles(this.smoke, 100, (j) => {
        const f = (j * 0.61803398875) % 1;
        const age = (t * 0.23 + f) % 1;
        const touchdown = this.motion.touchdownAge < 2.8;
        const damage = s.damage > 0.02;
        const side = j % 2 ? 1 : -1;
        if (damage)
          return [
            -this.layout.exhaust[0] + Math.sin(j * 3 + age * 8) * age * 1.8,
            this.layout.exhaust[1] + age * 3.5,
            this.layout.exhaust[2] + 0.08 + age * 20,
            Math.sin(age * Math.PI) * s.damage * 0.12,
            1.5 + age * 6,
          ];
        if (touchdown) {
          const age = this.motion.touchdownAge / 2.8;
          return [
            side * (this.layout.mainGear[0] + 0.8) + Math.sin(j * 2) * age * 2,
            0.2 + age * f * 2,
            this.layout.mainGear[2] + 0.3 + age * (1 + f) * 5,
            (1 - age) * 0.15,
            0.3 + age * 1.6,
          ];
        }
        return [0, 0, 0, 0, 0];
      });
    (this.smoke.material as T.ShaderMaterial).uniforms.color.value.set(
      s.damage > 0.02 ? "#343d44" : "#b6c1c7",
    );
    const condensation = input.contrails ? smooth(160, 240, s.speed) : 0,
      vortex = smooth(120, 200, s.speed) * smooth(0.25, 0.7, Math.abs(s.roll));
    this.trail.visible = condensation > 0 || vortex > 0;
    if (this.trail.visible)
      this.particles(this.trail, 480, (j) => {
        const side = j % 2 ? 1 : -1;
        const f = (((j % 240) >> 1) / 120 + t * 0.18) % 1;
        const wing = j < 240;
        return [
          side * (wing ? this.layout.wingtip[0] : this.layout.exhaust[0]) +
            Math.sin(f * 12 + t) * f * 0.12,
          (wing ? this.layout.wingtip[1] : this.layout.exhaust[1]) - f * 0.5,
          (wing ? this.layout.wingtip[2] : this.layout.exhaust[2] + 3.28) +
            f * (wing ? 9 : 38),
          Math.sin(f * Math.PI) * (wing ? vortex * 0.16 : condensation * 0.1),
          wing ? 0.18 + f * 0.7 : 0.5 + f * 2.8,
        ];
      });
  }
  private particles(
    points: T.Points,
    count: number,
    at: (j: number) => number[],
  ) {
    const g = points.geometry;
    const p = g.getAttribute("position") as T.BufferAttribute,
      a = g.getAttribute("alpha") as T.BufferAttribute,
      size = g.getAttribute("size") as T.BufferAttribute;
    for (let j = 0; j < count; j++) {
      const [x, y, z, alpha, r] = at(j);
      p.setXYZ(j, x, y, z);
      a.setX(j, alpha);
      size.setX(j, r);
    }
    p.needsUpdate = a.needsUpdate = size.needsUpdate = true;
  }
}
