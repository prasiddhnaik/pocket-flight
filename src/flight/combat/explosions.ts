import * as T from "three";

// Pooled soft particles for blasts and exhaust smoke: two draw calls however
// much is burning. Scorch marks stay on the ground until the flight ends.
const FIRE = 192;
const SMOKE = 512;
const SCORCH = 48;

type Particle = {
  position: T.Vector3;
  velocity: T.Vector3;
  life: number;
  duration: number;
  from: number;
  to: number;
  colour: T.Color;
  fade: number;
};

class ParticleLayer {
  readonly points: T.Points;
  private readonly geometry = new T.BufferGeometry();
  private readonly material: T.ShaderMaterial;
  private readonly positions: Float32Array;
  private readonly colours: Float32Array;
  private readonly sizes: Float32Array;
  private readonly particles: Particle[];
  private cursor = 0;
  constructor(
    count: number,
    additive: boolean,
    private readonly lift: number,
  ) {
    this.positions = new Float32Array(count * 3);
    this.colours = new Float32Array(count * 4);
    this.sizes = new Float32Array(count);
    this.particles = Array.from({ length: count }, () => ({
      position: new T.Vector3(),
      velocity: new T.Vector3(),
      life: 0,
      duration: 1,
      from: 1,
      to: 1,
      colour: new T.Color(),
      fade: 1,
    }));
    this.geometry.setAttribute("position", new T.BufferAttribute(this.positions, 3).setUsage(T.DynamicDrawUsage));
    this.geometry.setAttribute("colour", new T.BufferAttribute(this.colours, 4).setUsage(T.DynamicDrawUsage));
    this.geometry.setAttribute("size", new T.BufferAttribute(this.sizes, 1).setUsage(T.DynamicDrawUsage));
    this.material = new T.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: additive ? T.AdditiveBlending : T.NormalBlending,
      uniforms: { scale: { value: 600 } },
      vertexShader: `
        #include <common>
        #include <logdepthbuf_pars_vertex>
        attribute vec4 colour; attribute float size; uniform float scale; varying vec4 vColour;
        void main(){
          vColour=colour;
          vec4 view=modelViewMatrix*vec4(position,1.);
          gl_Position=projectionMatrix*view;
          gl_PointSize=size*scale/max(1.,-view.z);
          #include <logdepthbuf_vertex>
        }`,
      fragmentShader: `
        #include <common>
        #include <logdepthbuf_pars_fragment>
        varying vec4 vColour;
        void main(){
          float d=length(gl_PointCoord-.5)*2.;
          if(d>1.)discard;
          #include <logdepthbuf_fragment>
          gl_FragColor=vec4(vColour.rgb,vColour.a*(1.-d*d));
          #include <colorspace_fragment>
        }`,
    });
    this.points = new T.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
  }
  emit(position: T.Vector3, velocity: T.Vector3, duration: number, from: number, to: number, colour: T.ColorRepresentation, fade = 1) {
    const particle = this.particles[this.cursor];
    this.cursor = (this.cursor + 1) % this.particles.length;
    particle.position.copy(position);
    particle.velocity.copy(velocity);
    particle.life = particle.duration = duration;
    particle.from = from;
    particle.to = to;
    particle.colour.set(colour);
    particle.fade = fade;
  }
  update(dt: number, viewScale: number) {
    this.material.uniforms.scale.value = viewScale;
    this.particles.forEach((particle, i) => {
      if (particle.life <= 0) {
        this.colours[i * 4 + 3] = 0;
        this.sizes[i] = 0;
        return;
      }
      particle.life = Math.max(0, particle.life - dt);
      particle.velocity.multiplyScalar(Math.exp(-1.6 * dt));
      particle.velocity.y += this.lift * dt;
      particle.position.addScaledVector(particle.velocity, dt);
      const age = 1 - particle.life / particle.duration;
      particle.position.toArray(this.positions, i * 3);
      particle.colour.toArray(this.colours, i * 4);
      this.colours[i * 4 + 3] = particle.fade * (1 - age) ** 1.5;
      this.sizes[i] = particle.from + (particle.to - particle.from) * Math.sqrt(age);
    });
    for (const name of ["position", "colour", "size"])
      this.geometry.getAttribute(name).needsUpdate = true;
  }
  clear() {
    for (const particle of this.particles) particle.life = 0;
  }
  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}

const spread = (scale: number, rise = 0.6) =>
  new T.Vector3(Math.random() - 0.5, Math.random() * rise, Math.random() - 0.5).multiplyScalar(scale);

export type BlastSurface = "ground" | "water" | "air";

export class Explosions {
  readonly group = new T.Group();
  private fire = new ParticleLayer(FIRE, true, 2);
  private smoke = new ParticleLayer(SMOKE, false, 3.5);
  private scorchGeometry = new T.CircleGeometry(1, 20).rotateX(-Math.PI / 2);
  private scorchPaint = new T.MeshBasicMaterial({
    color: "#090705",
    transparent: true,
    opacity: 0.62,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  private scorches = new T.InstancedMesh(this.scorchGeometry, this.scorchPaint, SCORCH);
  private scorchIndex = 0;
  private matrix = new T.Matrix4();
  constructor() {
    this.scorches.count = 0;
    this.scorches.frustumCulled = false;
    // Fire reads through its own smoke.
    this.fire.points.renderOrder = 2;
    this.smoke.points.renderOrder = 1;
    this.group.add(this.fire.points, this.smoke.points, this.scorches);
  }
  blast(point: T.Vector3, surface: BlastSurface, size: number) {
    if (surface === "water") {
      // A rocket on water throws up a white column instead of a fireball.
      for (let i = 0; i < 26; i++)
        this.smoke.emit(point, spread(26 * size, 0).setY(16 + Math.random() * 42 * size), 1.1 + Math.random() * 0.9, 2 * size, 9 * size, i % 3 ? "#e8f1f0" : "#9cc4c6", 0.85);
      for (let i = 0; i < 8; i++)
        this.fire.emit(point, spread(40 * size, 0.3), 0.14, 2, 9 * size, "#ffffff", 0.5);
      return;
    }
    for (let i = 0; i < 18; i++)
      this.fire.emit(point, spread(70 * size), 0.4 + Math.random() * 0.4, 5 * size, 24 * size, i % 3 ? "#ff8a2a" : "#ffd27a", 0.95);
    this.fire.emit(point, new T.Vector3(), 0.16, 40 * size, 64 * size, "#fff2cc", 1);
    const dirt = surface === "ground";
    for (let i = 0; i < 20; i++)
      this.smoke.emit(point, spread(dirt ? 34 * size : 26 * size, 1.3), 2.4 + Math.random() * 2.8, 6 * size, 26 * size, i % 2 ? "#24211d" : dirt ? "#6b5a42" : "#3a3836", 0.82);
    if (!dirt) return;
    // Thrown earth falls out of the top of the blast.
    for (let i = 0; i < 14; i++)
      this.smoke.emit(point, spread(62 * size, 1.5), 0.8 + Math.random() * 0.5, 0.9, 2.4, "#4c3d2a", 1);
    this.scorch(point, size);
  }
  /** The burnt patch a ground blast leaves behind. */
  scorch(point: T.Vector3, size: number) {
    this.matrix.compose(
      new T.Vector3(point.x, point.y + 0.3, point.z),
      new T.Quaternion(),
      new T.Vector3(1, 1, 1).multiplyScalar(5 + 4 * size + Math.random() * 2),
    );
    this.scorches.setMatrixAt(this.scorchIndex, this.matrix);
    this.scorchIndex = (this.scorchIndex + 1) % SCORCH;
    this.scorches.count = Math.min(SCORCH, this.scorches.count + 1);
    this.scorches.instanceMatrix.needsUpdate = true;
  }
  /** Motor exhaust behind a round in flight. */
  trail(point: T.Vector3, missile: boolean) {
    this.smoke.emit(point, spread(2.5, 0.2), missile ? 2.2 : 1, 0.7, missile ? 4.5 : 2.6, "#d6d3cb", missile ? 0.55 : 0.34);
    this.fire.emit(point, new T.Vector3(), 0.07, 1.1, 0.5, "#ffb15a", 0.9);
  }
  /** Black smoke rising off a wreck. */
  burn(point: T.Vector3) {
    this.smoke.emit(point, spread(2.2, 0.4).setY(5 + Math.random() * 3), 5, 2.5, 12, "#191715", 0.5);
    if (Math.random() < 0.4)
      this.fire.emit(point, spread(1.5, 0.5), 0.45, 1.4, 3.4, "#ff7a20", 0.7);
  }
  update(dt: number, viewScale: number) {
    this.fire.update(dt, viewScale);
    this.smoke.update(dt, viewScale);
  }
  clear() {
    this.fire.clear();
    this.smoke.clear();
    this.scorches.count = 0;
  }
  dispose() {
    this.group.removeFromParent();
    this.fire.dispose();
    this.smoke.dispose();
    this.scorches.dispose();
    this.scorchGeometry.dispose();
    this.scorchPaint.dispose();
  }
}
