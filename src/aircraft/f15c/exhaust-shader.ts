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

// A cosmetic F100 plume: a bright nozzle core, compression cells, soft edges
// and fast, small turbulence. This is emission rendering, not a flow solution.
export const f100FlameFragment = `precision highp float;
#include <logdepthbuf_pars_fragment>
varying vec3 p; uniform vec3 eye; uniform float time,strength,phase,gain;
void main(){
#include <logdepthbuf_fragment>
${exhaustSlabs}
float stepSize=(leave-entry)/32.; vec3 emission=vec3(0); float density=0.;
for(int j=0;j<32;j++){
 vec3 q=eye+ray*(entry+(float(j)+.5)*stepSize); float z=clamp(q.z,0.,1.);
 float wave=sin(z*34.-time*62.+phase)*sin(q.x*29.+q.y*23.+time*37.);
 float cellPhase=z*(4.2+strength*.8)*6.28318;
 float compression=.5+.5*cos(cellPhase);
 float radius=(.92-.34*z)*(1.-.13*compression)+wave*.018*z;
 float r=length(q.xy)/radius;
 float edge=1.-smoothstep(.55,1.,r);
 float fade=(1.-smoothstep(.52,1.,z))*smoothstep(0.,.014,z);
 float core=exp(-r*r*12.)*exp(-z*7.);
 float cell=abs(fract(z*(4.2+strength*.8))-.5)*2.;
 float diamondShell=exp(-pow((r-(.12+.48*cell))*13.,2.));
 float diamonds=(pow(compression,5.)*exp(-r*r*5.)+diamondShell*.45)*(1.-z);
 float d=edge*fade*(.13+core*1.5+diamonds*2.4+wave*.035)*stepSize;
 vec3 color=mix(vec3(.20,.17,.9),vec3(1.2,.31,.09),smoothstep(.08,.72,z));
 color=mix(color,vec3(2.5,1.75,1.0),clamp(core*.7+diamonds*.9,0.,.95));
 emission+=color*d; density+=d;
}
float alpha=1.-exp(-density*3.5*strength);
gl_FragColor=vec4(emission/max(density,.0001)*gain,alpha);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`;
