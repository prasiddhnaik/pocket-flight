import { Vector3 } from "three";

// The same bounded volume used by both exhaust shaders. Parallel components
// must leave an unconstrained interval when the eye is inside that slab.
export function exhaustRayInterval(eye: Vector3, ray: Vector3) {
  let entry = 0, leave = Infinity;
  for (const [axis, low, high] of [["x", -1, 1], ["y", -1, 1], ["z", 0, 1]] as const) {
    if (Math.abs(ray[axis]) < 1e-5) {
      if (eye[axis] < low || eye[axis] > high) return null;
    } else {
      const a = (low - eye[axis]) / ray[axis], b = (high - eye[axis]) / ray[axis];
      entry = Math.max(entry, Math.min(a, b)); leave = Math.min(leave, Math.max(a, b));
    }
  }
  return leave > entry ? [entry, leave] : null;
}
export const exhaustSlabs = `
vec3 ray=normalize(p-eye);
bvec3 parallel=lessThan(abs(ray),vec3(.00001));
if((parallel.x&&(eye.x < -1.||eye.x > 1.)) || (parallel.y&&(eye.y < -1.||eye.y > 1.)) || (parallel.z&&(eye.z < 0.||eye.z > 1.))) discard;
vec3 inv=1./mix(vec3(.00001),ray,step(vec3(.00001),abs(ray)));
vec3 lo=(vec3(-1,-1,0)-eye)*inv,hi=(vec3(1,1,1)-eye)*inv;
vec3 near=min(lo,hi),far=max(lo,hi);
if(parallel.x){near.x=-1.e20;far.x=1.e20;}
if(parallel.y){near.y=-1.e20;far.y=1.e20;}
if(parallel.z){near.z=-1.e20;far.z=1.e20;}
float entry=max(0.,max(near.x,max(near.y,near.z))),leave=min(far.x,min(far.y,far.z));
if(leave<=entry)discard;`;

// A cosmetic afterburner plume, tinted per aircraft: a hot core, tight diamonds on the axis, a blue sheath at
// the nozzle and turbulence that tears the tail apart. This is emission rendering,
// not a flow solution. It skips tone mapping, which would wash these colours out.
export const afterburnerFlameFragment = `precision highp float;
#include <logdepthbuf_pars_fragment>
varying vec3 p; uniform vec3 eye,tint; uniform float time,strength,phase,gain;
float hash(vec3 q){return fract(sin(dot(q,vec3(127.1,311.7,74.7)))*43758.5453);}
float noise(vec3 q){vec3 i=floor(q),f=fract(q);f=f*f*(3.-2.*f);
return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z);}
void main(){
#include <logdepthbuf_fragment>
${exhaustSlabs}
float stepSize=(leave-entry)/22.; vec3 emission=vec3(0); float density=0.;
for(int j=0;j<22;j++){
 vec3 q=eye+ray*(entry+(float(j)+.5)*stepSize); float z=clamp(q.z,0.,1.);
 float swirl=noise(vec3(q.xy*3.2+phase,z*6.-time*9.))*.8-.4+.1*sin(z*41.-time*30.+q.x*17.+q.y*13.+phase);
 float radius=mix(.88,.16,pow(z,.8))*(1.+swirl*z*1.2);
 float r=length(q.xy)/radius;
 float edge=1.-smoothstep(.42,1.,r);
 float fade=(1.-smoothstep(.5+swirl*.4,1.,z))*smoothstep(0.,.012,z);
 float core=exp(-r*r*8.)*exp(-z*3.);
 float diamonds=pow(.5+.5*cos(z*(5.2+strength)*6.28318),3.)*exp(-r*r*17.)*(1.-smoothstep(.1,.6,z));
 float axis=exp(-r*r*5.)*(1.-smoothstep(.1,.72,z));
 float torn=1.+swirl*1.9*smoothstep(.08,.6,z);
 float d=edge*fade*max(0.,torn)*(.24+.3*(1.-z)+core*1.1+diamonds*2.4)*stepSize;
 vec3 color=min(vec3(1.),mix(vec3(1.,.27,.025),vec3(.8,.06,.005),smoothstep(.12,.8,z))*tint);
 color=mix(color,vec3(.05,.11,1.),smoothstep(.34,.86,r)*(1.-smoothstep(.0,.3,z)));
 color=mix(color,vec3(1.,.52,.07),axis);
 color=mix(color,vec3(1.,.72,.28),clamp(core*.9,0.,1.));
 color=mix(color,vec3(1.,.82,.42),clamp(diamonds*1.3,0.,1.));
 emission+=color*d; density+=d;
}
float alpha=1.-exp(-density*5.*strength);
gl_FragColor=vec4(emission/max(density,.0001)*gain,alpha);
#include <colorspace_fragment>
}`;
