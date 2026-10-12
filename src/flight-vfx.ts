import * as T from "three";
import type { AircraftId } from "./aircraft";
import { groundAt } from "./terrain";
import {
  finchWheels,
  peregrineWheels,
  aureliaWheels,
  stormbirdWheels,
} from "./landing-gear";

type Particle = {
  origin: T.Vector3;
  velocity: T.Vector3;
  acceleration: number;
  born: number;
  life: number;
  size: number;
  growth: number;
  opacity: number;
  color: T.Color;
  seed: number;
  stretch: T.Vector3;
};
export type VfxInput = {
  id: AircraftId;
  time: number;
  position: T.Vector3;
  rotation: T.Quaternion;
  velocity: T.Vector3;
  wind: T.Vector3;
  damage: number;
  speed: number;
  grounded: boolean;
  load: number;
  suspension: number;
};
const wheels = {
  finch: finchWheels,
  peregrine: peregrineWheels,
  aurelia: aureliaWheels,
  stormbird: stormbirdWheels,
};
// Emission datums use the same metre scale and body offset as the flight models.
const datums = {
  finch: { exhaust: [0.42, -0.25, -1.55], wing: [5.49, 0.18, 0.55] },
  peregrine: { exhaust: [0.637, 0.406, 9.604], wing: [6.916, 1.246, 3.64] },
  aurelia: { exhaust: [1.793, 1.073, 6.82], wing: [7.315, 0.963, 2.937] },
  stormbird: { exhaust: [1.28, -0.1, 7.93], wing: [6.58, 0.11, 3.01] },
};
const vertex = `#include <common>
#include <logdepthbuf_pars_vertex>
#include <fog_pars_vertex>
attribute float size, alpha, seed; attribute vec3 tint, stretch;
uniform float viewportHeight,viewportAspect; varying float a,s,width; varying vec3 c; varying vec2 axis;
void main(){a=alpha;s=seed;c=tint;
vec4 mvPosition=modelViewMatrix*vec4(position,1.);
gl_Position=projectionMatrix*mvPosition;
float diameter=size*viewportHeight*projectionMatrix[1][1]/max(1.,-mvPosition.z);
vec4 tip=projectionMatrix*(mvPosition+modelViewMatrix*vec4(stretch*.5,0.));
vec2 delta=(tip.xy/max(.01,tip.w)-gl_Position.xy/max(.01,gl_Position.w))*vec2(viewportAspect,1.)*viewportHeight*.5;
float span=length(delta)*2.;axis=span>.001?normalize(delta):vec2(0.,1.);axis.y=-axis.y;
gl_PointSize=min(256.,diameter+span);width=max(.015,diameter/max(1.,diameter+span));
#include <logdepthbuf_vertex>
#include <fog_vertex>
}`;
const fragment = `#include <common>
#include <logdepthbuf_pars_fragment>
#include <fog_pars_fragment>
varying float a,s,width;varying vec3 c;varying vec2 axis;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float noise(vec2 p){p+=vec2(s,s*.71);vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);
return mix(mix(hash(i),hash(i+vec2(1,0)),f.x),mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x),f.y);}
void main(){
#include <logdepthbuf_fragment>
vec2 xy=(gl_PointCoord-.5)*2.;
vec2 uv=vec2(dot(xy,vec2(-axis.y,axis.x))/width,dot(xy,axis));float d=length(uv);
#ifdef SPARK
uv.x*=5.;d=length(uv);float density=exp(-d*d*3.);
#else
float density=exp(-d*d*2.8)*(1.-smoothstep(.55,1.,d));
density*=.5+.5*noise(uv*3.);
#endif
float opacity=density*a;if(opacity<.003)discard;
gl_FragColor=vec4(c*(.8+.2*noise(uv*3.)),opacity);
#include <tonemapping_fragment>
#include <colorspace_fragment>
#include <fog_fragment>
}`;

/** Bounded birth history supports seeking the current flight without snapshotting particles. */
class ParticleBatch {
  readonly geometry = new T.BufferGeometry();
  readonly points: T.Points<T.BufferGeometry, T.ShaderMaterial>;
  readonly history: Particle[] = [];
  private cursor = 0;
  private total = 0;
  constructor(
    readonly capacity: number,
    readonly budget: number,
    spark = false,
  ) {
    for (const [name, width] of Object.entries({
      position: 3,
      tint: 3,
      stretch: 3,
      size: 1,
      alpha: 1,
      seed: 1,
    }))
      this.geometry.setAttribute(
        name,
        new T.BufferAttribute(new Float32Array(budget * width), width).setUsage(
          T.DynamicDrawUsage,
        ),
      );
    this.geometry.setDrawRange(0, 0);
    this.points = new T.Points(
      this.geometry,
      new T.ShaderMaterial({
        vertexShader: vertex,
        fragmentShader: fragment,
        defines: spark ? { SPARK: 1 } : {},
        uniforms: T.UniformsUtils.merge([
          T.UniformsLib.fog,
          { viewportHeight: { value: 900 }, viewportAspect: { value: 1 } },
        ]),
        transparent: true,
        depthWrite: false,
        fog: true,
        blending: spark ? T.AdditiveBlending : T.NormalBlending,
      }),
    );
    this.points.name = spark
      ? "Impact ember streaks"
      : "World-space smoke, tire dust and condensation";
    this.points.frustumCulled = false;
    this.points.visible = false;
  }
  emit(p: Particle) {
    // Own the birth pose; moving the aircraft must never drag its wake along.
    p.origin = p.origin.clone();
    p.velocity = p.velocity.clone();
    p.stretch = p.stretch.clone();
    this.history[this.cursor] = p;
    this.cursor = (this.cursor + 1) % this.capacity;
    this.total++;
  }
  render(time: number, height: number, aspect: number, reduced: boolean) {
    let count = 0;
    const position = this.geometry.getAttribute("position"),
      tint = this.geometry.getAttribute("tint"),
      stretch = this.geometry.getAttribute("stretch"),
      size = this.geometry.getAttribute("size"),
      alpha = this.geometry.getAttribute("alpha"),
      seed = this.geometry.getAttribute("seed");
    // Newest first: overload drops older wisps rather than the fresh contact puff.
    for (let j = 0; j < this.history.length && count < this.budget; j++) {
      const p =
        this.history[
          (this.cursor - 1 - j + this.history.length) % this.history.length
        ];
      const age = time - p.born;
      if (age < 0 || age >= p.life || (reduced && j % 3)) continue;
      const f = age / p.life;
      position.setXYZ(
        count,
        p.origin.x + p.velocity.x * age,
        p.origin.y + p.velocity.y * age + 0.5 * p.acceleration * age * age,
        p.origin.z + p.velocity.z * age,
      );
      tint.setXYZ(count, p.color.r, p.color.g, p.color.b);
      size.setX(count, p.size + age * p.growth);
      alpha.setX(count, p.opacity * Math.min(1, age * 18) * (1 - f) ** 1.6);
      seed.setX(count, p.seed + age * 0.18);
      stretch.setXYZ(count, p.stretch.x, p.stretch.y, p.stretch.z);
      count++;
    }
    for (const attribute of Object.values(this.geometry.attributes))
      attribute.needsUpdate = true;
    this.geometry.setDrawRange(0, count);
    this.points.visible = count > 0;
    this.points.material.uniforms.viewportHeight.value = height;
    this.points.material.uniforms.viewportAspect.value = aspect;
  }
  reset() {
    this.history.length = this.cursor = this.total = 0;
    this.geometry.setDrawRange(0, 0);
    this.points.visible = false;
  }
  get stats() {
    return {
      retained: this.history.length,
      emitted: this.total,
      active: this.geometry.drawRange.count,
      budget: this.budget,
    };
  }
  dispose() {
    this.geometry.dispose();
    this.points.material.dispose();
  }
}

export function tireContactPoints(input: VfxInput) {
  return wheels[input.id].map((wheel) => {
    const point = wheel.center.clone();
    if (input.id === "finch" || input.id === "stormbird")
      point.y += Math.min(0.16, input.suspension);
    point.applyQuaternion(input.rotation).add(input.position);
    point.y = groundAt(point.x, point.z).height + 0.055;
    return point;
  });
}

export class FlightVfx {
  readonly group = new T.Group();
  private clouds = new ParticleBatch(8192, 512);
  private sparks = new ParticleBatch(512, 96, true);
  private nextEmission = NaN;
  private point = new T.Vector3();
  private drift = new T.Vector3();
  private streak = new T.Vector3();
  private colors = new Map<string, T.Color>();
  private randomState = 42;
  constructor() {
    this.group.name = "Flight atmosphere VFX";
    this.group.add(this.clouds.points, this.sparks.points);
  }
  private random() {
    this.randomState = (1664525 * this.randomState + 1013904223) >>> 0;
    return this.randomState / 4294967296;
  }
  private puff(
    time: number,
    origin: T.Vector3,
    velocity: T.Vector3,
    color: string,
    size: number,
    growth: number,
    opacity: number,
    life: number,
    acceleration = 0.15,
    spark = false,
    stretch = new T.Vector3(),
  ) {
    if (!this.colors.has(color)) this.colors.set(color, new T.Color(color));
    (spark ? this.sparks : this.clouds).emit({
      born: time,
      origin,
      velocity,
      color: this.colors.get(color)!,
      stretch,
      size,
      growth,
      opacity,
      life,
      acceleration,
      seed: this.random() * 100,
    });
  }
  reset() {
    this.clouds.reset();
    this.sparks.reset();
    this.nextEmission = NaN;
    this.randomState = 42;
  }
  step(dt: number, input: VfxInput) {
    if (dt <= 0) return;
    if (
      !Number.isFinite(this.nextEmission) ||
      input.time - this.nextEmission > 0.2
    )
      this.nextEmission = input.time - dt;
    while (this.nextEmission < input.time - 1e-6) {
      this.emitWake(this.nextEmission, input);
      this.nextEmission += 1 / 30;
    }
  }
  private emitWake(time: number, i: VfxInput) {
    const datum = datums[i.id];
    if (i.damage > 0.25) {
      for (const side of i.id === "finch" ? [1] : [-1, 1]) {
        this.point.fromArray(datum.exhaust);
        this.point.x *= side;
        this.point.applyQuaternion(i.rotation).add(i.position);
        this.drift.copy(i.wind).addScaledVector(i.velocity, 0.08);
        this.drift.y += 0.9 + this.random() * 0.6;
        this.drift.x += (this.random() - 0.5) * 0.9;
        this.puff(
          time,
          this.point,
          this.drift,
          "#3f484c",
          0.38 + i.damage * 0.35,
          0.8,
          0.4 + i.damage * 0.3,
          5,
          0.15,
          false,
          this.streak.copy(i.velocity).multiplyScalar(-0.02),
        );
      }
    }
    // Brief wingtip condensation during loaded turns; high-altitude exhaust trails.
    const vortex =
      !i.grounded && i.speed > 65 ? T.MathUtils.smoothstep(i.load, 1.5, 3) : 0;
    const contrail =
      i.id !== "finch" && !i.grounded
        ? T.MathUtils.smoothstep(i.position.y, 1700, 2400)
        : 0;
    for (const [strength, source, life] of [
      [vortex, datum.wing, 2.2],
      [contrail, datum.exhaust, 8],
    ] as const)
      if (strength > 0.02)
        for (const side of [-1, 1]) {
          this.point.fromArray(source);
          this.point.x *= side;
          this.point.applyQuaternion(i.rotation).add(i.position);
          this.streak.copy(i.velocity).multiplyScalar(-1 / 30);
          this.point.addScaledVector(this.streak, 0.5);
          this.drift.copy(i.wind);
          this.drift.y -= 0.12;
          this.puff(
            time,
            this.point,
            this.drift,
            "#dcebf0",
            source === datum.wing ? 0.08 : 0.3,
            0.13,
            strength * 0.26,
            life,
            0,
            false,
            this.streak,
          );
        }
  }
  touchdown(i: VfxInput, sink: number) {
    const speed = Math.hypot(i.velocity.x, i.velocity.z);
    if (speed < 8) return;
    for (const point of tireContactPoints(i)) {
      const surface = groundAt(point.x, point.z);
      if (surface.water) continue;
      // All tires get small spin-up puffs; a soft landing never throws fragments.
      const pavement = !!surface.runway;
      const strength = T.MathUtils.clamp(sink / 6, 0.2, 1);
      for (let j = 0; j < 7; j++) {
        this.drift
          .copy(i.wind)
          .multiplyScalar(0.5)
          .addScaledVector(i.velocity, 0.06);
        this.drift.x += (this.random() - 0.5) * 1.6;
        this.drift.y = 0.25 + this.random() * 0.55;
        this.drift.z += (this.random() - 0.5) * 1.6;
        this.puff(
          i.time,
          point,
          this.drift,
          pavement ? "#ced8d9" : "#c3b799",
          0.12 + this.random() * 0.17,
          0.5,
          pavement ? 0.22 + strength * 0.08 : 0.28 + strength * 0.1,
          1.4 + this.random() * 0.8,
        );
      }
    }
  }
  impact(i: VfxInput, severity: number) {
    const surface = groundAt(i.position.x, i.position.z);
    this.point.copy(i.position);
    this.point.y = Math.max(surface.height + 0.15, i.position.y - 0.7);
    for (let j = 0; j < 14 + Math.floor(Math.min(1, severity) * 18); j++) {
      this.drift
        .set(
          (this.random() - 0.5) * 7,
          0.7 + this.random() * 3,
          (this.random() - 0.5) * 7,
        )
        .addScaledVector(i.wind, 0.5);
      this.puff(
        i.time,
        this.point,
        this.drift,
        surface.water ? "#e0f1ee" : surface.runway ? "#939d9b" : "#b7a987",
        0.25 + this.random() * 0.5,
        0.65,
        0.35,
        2.5,
        0.05,
      );
    }
    if (surface.runway && severity > 0.2)
      for (let j = 0; j < 20; j++) {
        this.drift
          .set(
            (this.random() - 0.5) * 12,
            1 + this.random() * 5,
            (this.random() - 0.5) * 12,
          )
          .addScaledVector(i.velocity, 0.1);
        this.puff(
          i.time,
          this.point,
          this.drift,
          "#ffb35c",
          0.08 + this.random() * 0.07,
          -0.02,
          0.85,
          0.35 + this.random() * 0.3,
          -9.81,
          true,
          this.streak.copy(this.drift).multiplyScalar(0.028),
        );
      }
  }
  render(time: number, height: number, reduced = false, aspect = 1) {
    this.clouds.render(time, height, aspect, reduced);
    this.sparks.render(time, height, aspect, reduced);
  }
  get stats() {
    return {
      clouds: this.clouds.stats,
      sparks: this.sparks.stats,
      drawCalls:
        Number(this.clouds.points.visible) + Number(this.sparks.points.visible),
    };
  }
  dispose() {
    this.clouds.dispose();
    this.sparks.dispose();
    this.group.removeFromParent();
  }
}
