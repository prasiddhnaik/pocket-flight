import * as T from "three";

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
  time = 0;
  rpm = 0;
  burner = 0;
  gear = 1;
  canopy = 0;
  roll = 0;
  pitch = 0;
  yaw = 0;
  flaps = 0;
  speed = 0;
  damage = 0;
  update(dt: number, i: JetInput) {
    if (dt <= 0) return;
    this.time += dt;
    const approach = (value: number, target: number, rate: number) =>
      T.MathUtils.damp(value, target, rate, dt);
    this.rpm = approach(
      this.rpm,
      clamp(i.throttle, 0, 1),
      i.throttle > this.rpm ? 0.85 : 0.55,
    );
    this.burner = approach(
      this.burner,
      i.burner ? smooth(0.75, 0.95, this.rpm) : 0,
      3,
    );
    this.gear = approach(this.gear, i.gear ? 1 : 0, 1.35);
    this.canopy = approach(
      this.canopy,
      i.canopy && this.rpm < 0.12 && this.speed < 2 ? 1 : 0,
      1.8,
    );
    for (const key of ["roll", "pitch", "yaw"] as const)
      this[key] = approach(this[key], clamp(i[key], -1, 1), 7);
    this.flaps = approach(this.flaps, clamp(i.flaps, 0, 1), 2);
    this.speed = approach(this.speed, Math.max(0, i.speed), 1.3);
    this.damage = approach(this.damage, clamp(i.damage, 0, 1), 2);
  }
}

const flameVertex = `varying vec3 p; void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
// Crossed soft ribbons have no cone silhouette; colour and density vary along the jet.
const flameFragment = `precision highp float; varying vec3 p; uniform float time; uniform float strength; uniform float phase;
void main(){float x=abs(p.x); float z=clamp(p.z,0.,.99999); float taper=(.9-.35*z)*(1.-smoothstep(.67,1.,z));
float wave=sin(z*39.-time*19.+phase)*.035+sin(z*71.+time*13.)*.02;
float r=x/max(.03,taper+wave);float edge=exp(-r*r*2.2)*(1.-smoothstep(.65,1.8,r));float fade=pow(1.-z,.7)*smoothstep(0.,.025,z);
float diamonds=pow(max(0.,cos(z*34.)),5.)*exp(-r*r*7.);
float core=exp(-r*r*9.);vec3 blue=vec3(.3,.24,1.);vec3 orange=vec3(1.,.33,.065);
vec3 color=mix(blue,orange,smoothstep(.08,.5,z));color=mix(color,vec3(.8,.62,.42),core*.25);color+=diamonds*vec3(.28,.19,.13);
float turbulence=.88+.12*sin(z*63.-time*17.+r*4.);float alpha=edge*fade*strength*.23*turbulence;gl_FragColor=vec4(color,alpha);}`;
function flameGeometry() {
  const positions: number[] = [],
    indices: number[] = [];
  for (let j = 0; j <= 48; j++)
    for (const x of [-1, 1]) positions.push(x, 0, j / 48);
  for (let j = 0; j < 48; j++) {
    const a = j * 2;
    indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new T.BufferGeometry();
  g.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  g.setIndex(indices);
  g.computeVertexNormals();
  return g;
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
const particleVertex = `attribute float alpha;attribute float size;varying float a;uniform float pixelRatio;void main(){a=alpha;vec4 mv=modelViewMatrix*vec4(position,1.);gl_PointSize=min(160.,size*pixelRatio*650./max(1.,-mv.z));gl_Position=projectionMatrix*mv;}`;
const particleFragment = `varying float a;uniform vec3 color;void main(){float d=length(gl_PointCoord-.5)*2.;float soft=exp(-d*d*2.5)*(1.-smoothstep(.6,1.,d));gl_FragColor=vec4(color,soft*a);}`;

export class JetEffects {
  readonly motion = new JetMotion();
  readonly group = new T.Group();
  private flames: T.Group[] = [];
  private flameMaterials: T.ShaderMaterial[] = [];
  private engineGlows: T.Sprite[] = [];
  private engineLights: T.PointLight[] = [];
  private lamps: { sprite: T.Sprite; kind: string }[] = [];
  private canopyPivot: T.Group;
  private legs: { pivot: T.Group; side: number; nose: boolean }[] = [];
  private wheels: T.Object3D[] = [];
  private smoke: T.Points;
  private trail: T.Points;
  private touchdownAge = 10;
  private wheelAngle = 0;
  private rotorAngle = 0;
  private spriteMap = glowTexture();
  private reduced = false;
  constructor(readonly model: T.Group) {
    this.group.name = "Peregrine effects";
    model.add(this.group);
    const geometry = flameGeometry();
    for (const [index, x] of [-0.91, 0.91].entries()) {
      const plume = new T.Group();
      plume.position.set(x, 2.88, 13.72);
      this.group.add(plume);
      this.flames.push(plume);
      for (let layer = 0; layer < 5; layer++) {
        const material = new T.ShaderMaterial({
          vertexShader: flameVertex,
          fragmentShader: flameFragment,
          uniforms: {
            time: { value: 0 },
            strength: { value: 0 },
            phase: { value: index * 2.3 + layer * 0.6 },
          },
          transparent: true,
          depthWrite: false,
          side: T.DoubleSide,
          blending: T.AdditiveBlending,
        });
        const mesh = new T.Mesh(geometry, material);
        mesh.rotation.z = (layer * Math.PI) / 5;
        mesh.renderOrder = 4;
        plume.add(mesh);
        this.flameMaterials.push(material);
      }
      const glow = new T.Sprite(
        new T.SpriteMaterial({
          map: this.spriteMap,
          color: "#a27cff",
          transparent: true,
          depthWrite: false,
          blending: T.AdditiveBlending,
        }),
      );
      glow.position.set(x, 2.88, 13.64);
      this.group.add(glow);
      this.engineGlows.push(glow);
      const light = new T.PointLight("#ff792f", 0, 9, 2);
      light.position.set(x, 2.88, 14.4);
      this.group.add(light);
      this.engineLights.push(light);
    }
    for (const [x, y, z, color, kind] of [
      [-9.9, 4.08, 5.2, "#ff3425", "nav"],
      [9.9, 4.08, 5.2, "#39ffa9", "nav"],
      [0, 7.87, 12.5, "#ff4e37", "beacon"],
      [0, 2.65, 12.85, "#ffffff", "tail"],
      [-9.88, 4.1, 5.3, "#ffffff", "strobe"],
      [9.88, 4.1, 5.3, "#ffffff", "strobe"],
      [0, 1.6, -7.08, "#fff1d5", "landing"],
    ] as const) {
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
    const canopyHinge = model.getObjectByName("Canopy")?.userData.hinge_glTF;
    this.canopyPivot = pivot(
      "Canopy",
      new T.Vector3().fromArray(
        Array.isArray(canopyHinge) ? canopyHinge : [0, 4.47, -6.1],
      ),
    );
    this.legs.push({
      pivot: pivot("Nose_steering", new T.Vector3(0, 1.72, -7.05)),
      side: 0,
      nose: true,
    });
    for (const side of [-1, 1])
      this.legs.push({
        pivot: pivot(
          "Main_gear_" + (side < 0 ? "Left" : "Right"),
          new T.Vector3(side * 1.25, 2.16, 2.15),
        ),
        side,
        nose: false,
      });
    model.traverse((o) => {
      if (
        /^(Nose_wheel_|Main_wheel_)/.test(o.name) &&
        !o.name.includes(" | ") &&
        !(o instanceof T.Mesh)
      )
        this.wheels.push(o);
    });
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
  reset() {
    Object.assign(this.motion, new JetMotion());
    this.touchdownAge = 10;
    this.wheelAngle = 0;
    this.rotorAngle = 0;
  }
  touchdown() {
    this.touchdownAge = 0;
  }
  setReducedMotion(value: boolean) {
    this.reduced = value;
  }
  update(dt: number, input: JetInput) {
    this.motion.update(dt, input);
    const s = this.motion,
      t = s.time;
    this.touchdownAge += dt;
    this.rotorAngle = (this.rotorAngle + dt * s.rpm * 48) % (Math.PI * 2);
    this.wheelAngle = (this.wheelAngle + dt * s.speed * 0.08) % (Math.PI * 2);
    for (const name of ["Compressor_-1", "Compressor_1"]) {
      const o = this.model.getObjectByName(name);
      if (o) o.rotation.z = this.rotorAngle;
    }
    for (const w of this.wheels) w.rotation.x = this.wheelAngle;
    const set = (name: string, axis: "x" | "y", v: number) => {
      const o = this.model.getObjectByName(name);
      if (o) o.rotation[axis] = v;
    };
    set("Aileron_Left", "x", s.roll * 0.38);
    set("Aileron_Right", "x", -s.roll * 0.38);
    set("Rudder", "y", s.yaw * 0.42);
    for (const side of ["Left", "Right"]) {
      set("Elevator_" + side, "x", -s.pitch * 0.4);
      set("Flap_" + side, "x", s.flaps * 0.5);
    }
    this.canopyPivot.rotation.x = s.canopy * 0.65;
    for (const part of ["Nose", "Main"])
      for (const side of ["Left", "Right"]) {
        const door = this.model.getObjectByName(part + "_door_" + side);
        if (door)
          door.rotation.z =
            ((side === "Left" ? 1 : -1) *
              (1 - smooth(0.03, 0.35, s.gear)) *
              Math.PI) /
            2;
      }
    const compression =
      this.touchdownAge < 2
        ? Math.exp(-this.touchdownAge * 3) *
          Math.sin(this.touchdownAge * 8) *
          0.14
        : 0;
    this.legs.forEach(({ pivot, side, nose }) => {
      const fold = 1 - smooth(0.03, 0.98, s.gear);
      pivot.rotation[nose ? "x" : "z"] = nose
        ? -fold * 1.48
        : -side * fold * 1.2;
      pivot.position.y = (nose ? 1.72 : 2.16) + fold * 0.25 + compression;
      pivot.visible = s.gear > 0.015;
    });
    const steering = this.model.getObjectByName("Nose_steering");
    if (steering) steering.rotation.y = s.yaw * 0.35 * s.gear;
    for (let index = 0; index < 2; index++) {
      const health = index === 0 ? 1 - s.damage : 1;
      const power = s.burner * health;
      const hot = s.rpm * health;
      this.flames[index].visible = power > 0.01;
      this.flames[index].scale.set(0.72, 0.72, 2.5 + power * 4.4);
      for (let layer = 0; layer < 5; layer++) {
        const u = this.flameMaterials[index * 5 + layer].uniforms;
        u.time.value = this.reduced ? 0 : t;
        u.strength.value = power;
      }
      const glow = this.engineGlows[index];
      glow.material.opacity = hot * 0.25 + power * 0.55;
      glow.scale.setScalar(0.8 + power * 0.9);
      this.engineLights[index].intensity = hot * 1.5 + power * 18;
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
    this.particles(this.smoke, 100, (j) => {
      const f = (j * 0.61803398875) % 1;
      const age = (t * 0.23 + f) % 1;
      const touchdown = this.touchdownAge < 2.8;
      const damage = s.damage > 0.02;
      const side = j % 2 ? 1 : -1;
      if (damage)
        return [
          -0.91 + Math.sin(j * 3 + age * 8) * age * 1.8,
          2.88 + age * 3.5,
          13.8 + age * 20,
          Math.sin(age * Math.PI) * s.damage * 0.12,
          1.5 + age * 6,
        ];
      if (touchdown) {
        const age = this.touchdownAge / 2.8;
        return [
          side * 2.05 + Math.sin(j * 2) * age * 2,
          0.2 + age * f * 2,
          2.45 + age * (1 + f) * 5,
          (1 - age) * 0.15,
          0.3 + age * 1.6,
        ];
      }
      return [0, 0, 0, 0, 0];
    });
    (this.smoke.material as T.ShaderMaterial).uniforms.color.value.set(
      s.damage > 0.02 ? "#343d44" : "#b6c1c7",
    );
    const condensation = smooth(160, 240, s.speed),
      vortex = condensation * Math.min(1, Math.abs(s.roll) * 3 + 0.1);
    this.particles(this.trail, 480, (j) => {
      const side = j % 2 ? 1 : -1;
      const f = (((j % 240) >> 1) / 120 + t * 0.18) % 1;
      const wing = j < 240;
      return [
        side * (wing ? 9.88 : 0.91) + Math.sin(f * 12 + t) * f * 0.12,
        (wing ? 4.08 : 2.88) - f * 0.5,
        (wing ? 5.2 : 14) + f * (wing ? 18 : 38),
        Math.sin(f * Math.PI) * (wing ? vortex * 0.16 : condensation * 0.1),
        wing ? 0.3 + f * 1 : 0.65 + f * 2.4,
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
