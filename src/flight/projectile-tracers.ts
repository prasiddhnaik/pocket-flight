import * as T from "three";
import { F15C_CANNON, type Projectile } from "./cannon";

const capacity = Math.ceil(F15C_CANNON.maximumProjectiles / 5);
const vertex = `
#include <common>
#include <logdepthbuf_pars_vertex>
attribute vec3 head,tail;attribute float age;
uniform vec2 viewport;varying vec2 vUv;varying float vFade;
void main(){
 vUv=uv;vec4 hView=modelViewMatrix*vec4(head,1.),tView=modelViewMatrix*vec4(tail,1.);
 vec4 h=projectionMatrix*hView,t=projectionMatrix*tView;
 if(hView.z>-.01||tView.z>-.01){gl_Position=vec4(2,2,2,1);vFade=0.;}
 else{
  vec2 span=(h.xy/h.w-t.xy/t.w)*viewport*.5;
  float pixels=length(span);vec2 axis=pixels>.001?span/pixels:vec2(1,0);
  // A subpixel tracer still has a small luminous head when viewed end-on.
  t.xy-=axis*max(0.,3.-pixels)*2./viewport*t.w;
  gl_Position=mix(t,h,uv.y);
  vec2 normal=vec2(-axis.y,axis.x);
  float width=3.6*(.45+.55*uv.y);
  gl_Position.xy+=normal*position.x*width*2./viewport*gl_Position.w;
  vFade=(1.-smoothstep(1.8,2.6,age))*(1.-smoothstep(1400.,2800.,-hView.z));
 }
#include <logdepthbuf_vertex>
}`;
const fragment = `
precision highp float;
#include <logdepthbuf_pars_fragment>
uniform vec3 coreColor,haloColor;
varying vec2 vUv;varying float vFade;
void main(){
#include <logdepthbuf_fragment>
float across=abs(vUv.x-.5)*2.;
float core=exp(-across*across*8.);
float envelope=smoothstep(0.,.12,vUv.y)*pow(vUv.y,.45);
float halo=exp(-across*across*4.5);
vec3 color=mix(haloColor,coreColor,core);
gl_FragColor=vec4(color,(halo*.3+core*.7)*envelope*vFade);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;

/** Optical glow around every fifth simulated round; not an ammunition spec. */
export class ProjectileTracers {
  readonly geometry = new T.InstancedBufferGeometry();
  readonly material = new T.ShaderMaterial({ vertexShader: vertex, fragmentShader: fragment,
    uniforms: { viewport: { value: new T.Vector2(1280, 720) },
      coreColor: { value: new T.Color("#ff7806") }, haloColor: { value: new T.Color("#ff3d00") } },
    // Keep the orange glow saturated against a bright sky. HDR additive light
    // plus scene exposure pushed the old pale core toward white.
    transparent: true, depthWrite: false, toneMapped: false, blending: T.NormalBlending, side: T.DoubleSide,
  });
  readonly mesh = new T.Mesh(this.geometry, this.material);
  private heads = new T.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(T.DynamicDrawUsage);
  private tails = new T.InstancedBufferAttribute(new Float32Array(capacity * 3), 3).setUsage(T.DynamicDrawUsage);
  private ages = new T.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(T.DynamicDrawUsage);
  private tail = new T.Vector3();
  constructor() {
    const quad = new T.PlaneGeometry(1, 1);
    this.geometry.setIndex(quad.index);
    this.geometry.setAttribute("position", quad.attributes.position).setAttribute("uv", quad.attributes.uv);
    quad.dispose();
    this.mesh.name = "Cannon_tracer_rounds";
    this.mesh.frustumCulled = false;
    this.geometry.setAttribute("head", this.heads).setAttribute("tail", this.tails).setAttribute("age", this.ages);
    this.geometry.instanceCount = 0;
    // Use CSS pixels so the tracer keeps its width on high-DPI displays.
    this.mesh.onBeforeRender = renderer => renderer.getSize(this.material.uniforms.viewport.value);
  }
  update(projectiles: readonly Projectile[]) {
    let index = 0;
    for (const round of projectiles) {
      if (round.id % 5 || index === capacity) continue;
      this.heads.setXYZ(index, round.position.x, round.position.y, round.position.z);
      // Four milliseconds of luminous exposure follows the real velocity.
      // The head stays on the physical projectile, so the cue never leads it.
      this.tail.copy(round.position).addScaledVector(round.velocity, -Math.min(.004, round.age));
      this.tails.setXYZ(index, this.tail.x, this.tail.y, this.tail.z);
      this.ages.setX(index, round.age); index++;
    }
    this.geometry.instanceCount = index;
    this.heads.needsUpdate = this.tails.needsUpdate = this.ages.needsUpdate = true;
  }
  dispose() { this.geometry.dispose(); this.material.dispose(); }
}
