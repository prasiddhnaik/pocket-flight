import * as T from "three";

const forward = new T.Vector3(0, 0, 1);
const capacity = 64, smokeLifetime = 1, lingerSeconds = .9;
const vertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec3 p;
void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
#include <logdepthbuf_vertex>
}`;
// Integrate a small, irregular volume rather than showing a solid polygon or
// a camera-facing star. Dimensions are artistic estimates from firing photos.
const fragment = `
precision highp float;
#include <logdepthbuf_pars_fragment>
varying vec3 p;uniform vec3 eye;uniform float phase,brightness;
void main(){
#include <logdepthbuf_fragment>
vec3 ray=normalize(p-eye);
bvec3 parallel=lessThan(abs(ray),vec3(.00001));
if((parallel.x&&abs(eye.x)>1.)||(parallel.y&&abs(eye.y)>1.)||(parallel.z&&(eye.z<0.||eye.z>1.)))discard;
vec3 inv=1./mix(vec3(.00001),ray,step(vec3(.00001),abs(ray)));
vec3 a=(vec3(-1,-1,0)-eye)*inv,b=(vec3(1,1,1)-eye)*inv;
vec3 near=min(a,b),far=max(a,b);
if(parallel.x){near.x=-1.e20;far.x=1.e20;}
if(parallel.y){near.y=-1.e20;far.y=1.e20;}
if(parallel.z){near.z=-1.e20;far.z=1.e20;}
float entry=max(0.,max(near.x,max(near.y,near.z))),leave=min(far.x,min(far.y,far.z));
if(leave<=entry)discard;
float ds=(leave-entry)/24.,density=0.;vec3 emission=vec3(0);
for(int i=0;i<24;i++){
 vec3 q=eye+ray*(entry+(float(i)+.5)*ds);float z=clamp(q.z,0.,1.);
 float angle=atan(q.y,q.x);
 float lobe=sin(angle*5.+phase+z*13.)*.08+sin(z*33.+phase*2.)*.035;
 float radius=(.19+.65*sin(pow(z,.65)*3.14159))*(1.-.32*z)+lobe;
 float r=length(q.xy)/max(.04,radius);
 float edge=1.-smoothstep(.25,1.,r);
 float fade=smoothstep(0.,.035,z)*(1.-smoothstep(.55,1.,z));
 float core=exp(-r*r*6.)*exp(-z*4.5);
 float d=edge*fade*(.55+core*3.)*ds;
 emission+=mix(vec3(1.7,.27,.035),vec3(4.,3.25,1.9),clamp(core*2.,0.,1.))*d;
 density+=d;
}
gl_FragColor=vec4(emission/max(density,.0001),1.-exp(-density*brightness*3.));
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
// The soft bloom around the flash. It is what the eye catches from the chase
// camera, where the flash itself is only a few pixels across.
const glowVertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
varying vec2 vUv;
void main(){vUv=uv;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);
#include <logdepthbuf_vertex>
}`;
const glowFragment = `
precision highp float;
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;uniform float brightness;
void main(){
#include <logdepthbuf_fragment>
float d=length(vUv*2.-1.);
float halo=exp(-d*d*9.)*(1.-smoothstep(.7,1.,d));
float core=exp(-d*d*38.);
gl_FragColor=vec4(mix(vec3(1.,.5,.16),vec3(1.,.9,.68),core)*(halo*.42+core*.55)*brightness,1.);
#include <colorspace_fragment>
}`;
const smokeVertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute float life,seed;varying vec2 vUv;varying float vLife,vSeed;
void main(){vUv=uv;vLife=life;vSeed=seed;gl_Position=projectionMatrix*modelViewMatrix*instanceMatrix*vec4(position,1.);
#include <logdepthbuf_vertex>
}`;
const smokeFragment = `
precision highp float;
#include <logdepthbuf_pars_fragment>
varying vec2 vUv;varying float vLife,vSeed;
void main(){
#include <logdepthbuf_fragment>
vec2 q=vUv*2.-1.;
float swirl=sin(q.x*8.+vSeed+vLife*3.)*sin(q.y*9.-vSeed)*.09;
float edge=1.-smoothstep(.05,1.,length(q)+swirl);
float alpha=edge*edge*pow(1.-vLife,1.5)*.5;
gl_FragColor=vec4(mix(vec3(.5,.5,.48),vec3(.8,.8,.78),vLife),alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

/** Cosmetic discharge only. The cannon simulation remains the source of shots. */
export class CannonFlash {
  readonly group = new T.Group();
  readonly flash = new T.Mesh(new T.BoxGeometry(2, 2, 1).translate(0, 0, .5), new T.ShaderMaterial({
    vertexShader: vertex, fragmentShader: fragment, uniforms: { eye: { value: new T.Vector3() }, phase: { value: 0 }, brightness: { value: 1 } },
    transparent: true, depthWrite: false, side: T.BackSide,
  }));
  readonly smoke = new T.InstancedMesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({
    vertexShader: smokeVertex, fragmentShader: smokeFragment, transparent: true, depthWrite: false,
  }), capacity);
  readonly glow = new T.Mesh(new T.PlaneGeometry(1, 1), new T.ShaderMaterial({
    vertexShader: glowVertex, fragmentShader: glowFragment, uniforms: { brightness: { value: 1 } },
    transparent: true, depthWrite: false, blending: T.AdditiveBlending, toneMapped: false,
  }));
  readonly light = new T.PointLight("#ffbf70", 0, 6, 2);
  private linger = 0;
  private particles = Array.from({ length: capacity }, () => ({ position: new T.Vector3(), velocity: new T.Vector3(), slip: new T.Vector3(), age: smokeLifetime, seed: 0 }));
  private life = new T.InstancedBufferAttribute(new Float32Array(capacity), 1);
  private seeds = new T.InstancedBufferAttribute(new Float32Array(capacity), 1);
  private dummy = new T.Object3D();
  private cameraRotation = new T.Quaternion();
  private cameraInverse = new T.Quaternion();
  private projectedSlip = new T.Vector3();
  private airflow = new T.Vector3();
  private destination = new T.Vector3();
  private flashAge = Infinity;
  private emission = 0;
  private sequence = 0;

  constructor() {
    this.flash.name = "Cannon_muzzle_flash";
    this.smoke.name = "Cannon_gun_smoke";
    this.glow.name = "Cannon_muzzle_glow";
    this.flash.visible = this.glow.visible = false;
    this.glow.renderOrder = 3;
    // Keep the light outside the non-uniformly scaled volume.
    this.group.add(this.flash, this.glow, this.smoke, this.light);
    this.smoke.frustumCulled = false;
    this.smoke.instanceMatrix.setUsage(T.DynamicDrawUsage);
    this.smoke.geometry.setAttribute("life", this.life);
    this.smoke.geometry.setAttribute("seed", this.seeds);
    this.smoke.count = 0;
    this.flash.onBeforeRender = (_renderer, _scene, camera) => {
      camera.getWorldPosition(this.flash.material.uniforms.eye.value);
      this.flash.worldToLocal(this.flash.material.uniforms.eye.value);
    };
  }

  step(dt: number, fired: number, shots: number, origin: T.Vector3, direction: T.Vector3, velocity: T.Vector3, wind: T.Vector3) {
    if (dt <= 0) return;
    this.flashAge = fired ? 0 : this.flashAge + dt;
    this.flash.visible = this.glow.visible = this.flashAge < .018;
    if (fired) {
      const variation = (Math.sin(shots * 78.233) * 43758.5453) % 1;
      const seed = Math.abs(variation);
      this.flash.material.uniforms.phase.value = shots * 2.39996;
      this.flash.material.uniforms.brightness.value = .7 + seed * .6;
      this.flash.scale.set(.17 + seed * .08, .17 + seed * .08, .75 + seed * .6);
      this.glow.material.uniforms.brightness.value = .65 + seed * .5;
      this.glow.scale.setScalar(1.5 + seed * .9);
    }
    this.light.intensity = this.flash.visible ? 1.5 * this.flash.material.uniforms.brightness.value : 0;
    this.destination.copy(wind); this.destination.y += .6;
    for (const particle of this.particles) if (particle.age < smokeLifetime) this.advect(particle, dt);
    // One soft puff represents several discharges. Fixed pool bounds GPU cost.
    this.emission += fired * .55;
    // The hot barrels keep smoking while they wind down after the trigger is released.
    this.linger = fired ? lingerSeconds : Math.max(0, this.linger - dt);
    if (!fired && this.linger > 0) this.emission += dt * 14 * this.linger / lingerSeconds;
    const count = Math.min(capacity, Math.floor(this.emission));
    this.emission -= count;
    for (let i = 0; i < count; i++) {
      const particle = this.particles[this.sequence++ % capacity];
      const lag = dt * (count - i - .5) / count;
      particle.seed = this.sequence * 2.39996;
      particle.position.copy(origin).addScaledVector(velocity, -lag);
      particle.velocity.copy(velocity).addScaledVector(direction, 12);
      particle.slip.copy(particle.velocity).sub(wind);
      particle.age = 0;
      this.advect(particle, lag);
    }
  }

  private advect(particle: typeof this.particles[number], dt: number) {
    const decay = Math.exp(-14 * dt);
    // Exact drag integration keeps the trail consistent across frame rates.
    this.airflow.copy(particle.velocity).sub(this.destination);
    particle.position.addScaledVector(this.destination, dt).addScaledVector(this.airflow, (1 - decay) / 14);
    particle.velocity.copy(this.destination).addScaledVector(this.airflow, decay);
    particle.age += dt;
  }

  render(camera: T.Camera, origin: T.Vector3, direction: T.Vector3) {
    this.flash.position.copy(origin);
    this.flash.quaternion.setFromUnitVectors(forward, direction);
    this.light.position.copy(origin).addScaledVector(direction, .06);
    camera.getWorldQuaternion(this.cameraRotation);
    this.glow.position.copy(origin).addScaledVector(direction, .3);
    this.glow.quaternion.copy(this.cameraRotation);
    this.cameraInverse.copy(this.cameraRotation).invert();
    let index = 0;
    for (const particle of this.particles) {
      if (particle.age >= smokeLifetime) continue;
      const age = particle.age / smokeLifetime, size = .32 + Math.sqrt(age) * 2.2;
      this.dummy.position.copy(particle.position);
      this.dummy.quaternion.copy(this.cameraRotation);
      this.projectedSlip.copy(particle.slip).applyQuaternion(this.cameraInverse);
      this.dummy.rotateZ(Math.atan2(this.projectedSlip.y, this.projectedSlip.x));
      // Each puff stands for a short segment of the continuous smoke stream.
      // Project its airflow into the billboard so high-speed trails join up.
      const stretch = Math.hypot(this.projectedSlip.x, this.projectedSlip.y) * Math.min(.035, particle.age);
      this.dummy.scale.set(size * 1.3 + stretch, size, 1);
      this.dummy.updateMatrix();
      this.smoke.setMatrixAt(index, this.dummy.matrix);
      this.life.setX(index, age); this.seeds.setX(index, particle.seed); index++;
    }
    this.smoke.count = index;
    this.smoke.instanceMatrix.needsUpdate = true;
    this.life.needsUpdate = this.seeds.needsUpdate = true;
  }

  suspend() { this.flashAge = Infinity; this.flash.visible = this.glow.visible = false; this.light.intensity = 0; this.emission = 0; }
  reset() { this.linger = 0;
    this.suspend(); this.sequence = 0;
    this.particles.forEach(particle => { particle.age = smokeLifetime; });
    this.smoke.count = 0;
  }
  dispose() {
    this.flash.geometry.dispose(); this.flash.material.dispose();
    this.glow.geometry.dispose(); this.glow.material.dispose();
    this.smoke.geometry.dispose(); this.smoke.material.dispose(); this.smoke.dispose();
    this.light.dispose(); this.group.clear();
  }
}
