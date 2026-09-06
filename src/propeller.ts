import * as T from "three";

export type PropellerPose = { angle: number; rpm: number };
export type PropellerInput = {
  throttle: number;
  airspeed: number;
  damage: number;
  engineOut: boolean;
  crashed: boolean;
};

export function advancePropeller(
  pose: PropellerPose,
  input: PropellerInput,
  dt: number,
): PropellerPose {
  const health = 1 - T.MathUtils.clamp(input.damage, 0, 1);
  const target = input.crashed
    ? 0
    : health *
      (input.engineOut
        ? Math.min(650, Math.max(0, input.airspeed - 5) * 12)
        : 800 + T.MathUtils.clamp(input.throttle, 0, 1) * 1700);
  const response = target > pose.rpm ? 2.4 : 1.5;
  const decay = Math.exp(-response * dt);
  // Integrate the eased RPM exactly so frame rate cannot change spin-up or phase.
  const revolutions =
    (target * dt + ((pose.rpm - target) * (1 - decay)) / response) / 60;
  return {
    angle: pose.angle + revolutions * Math.PI * 2,
    rpm: target + (pose.rpm - target) * decay,
  };
}

export function propellerAnimation() {
  let pose: PropellerPose = { angle: 0, rpm: 0 };
  let root: T.Object3D | null = null;
  let blur: T.Mesh<T.CircleGeometry, T.ShaderMaterial> | null = null;
  const blades: { mesh: T.Mesh; materials: T.Material[] }[] = [];

  function apply(next: PropellerPose) {
    pose = { ...next };
    if (!root || !blur) return;
    root.rotation.z = pose.angle;
    const blend = T.MathUtils.smoothstep(pose.rpm, 150, 650);
    for (const blade of blades) {
      blade.mesh.visible = blend < 0.999;
      blade.mesh.castShadow = blend < 0.25;
      for (const material of blade.materials) {
        material.opacity = 1 - blend;
        material.depthWrite = blend < 0.01;
      }
    }
    blur.visible = blend > 0.001;
    blur.material.uniforms.blend.value = blend;
  }

  return {
    snapshot: (): PropellerPose => ({ ...pose }),
    apply,
    reset: () => apply({ angle: 0, rpm: 0 }),
    update(input: PropellerInput, dt: number) {
      apply(advancePropeller(pose, input, dt));
    },
    bind(propeller: T.Object3D) {
      root = propeller;
      // Only clone blade materials; the spinner and aircraft paint stay opaque.
      for (const child of root.children) {
        if (!child.name.startsWith("Propeller_Blade_")) continue;
        child.traverse((object) => {
          if (!(object instanceof T.Mesh)) return;
          const materials = (
            Array.isArray(object.material) ? object.material : [object.material]
          ).map((material) => {
            const clone = material.clone();
            clone.transparent = true;
            return clone;
          });
          object.material = Array.isArray(object.material)
            ? materials
            : materials[0];
          blades.push({ mesh: object, materials });
        });
      }
      blur = new T.Mesh(
        new T.CircleGeometry(1.09, 96),
        new T.ShaderMaterial({
          transparent: true,
          depthWrite: false,
          side: T.DoubleSide,
          uniforms: { blend: { value: 0 } },
          vertexShader: `
          #include <common>
          #include <logdepthbuf_pars_vertex>
          varying vec2 discUV;
          void main() {
            discUV = uv * 2.0 - 1.0;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            #include <logdepthbuf_vertex>
          }`,
          fragmentShader: `
          #include <logdepthbuf_pars_fragment>
          uniform float blend;
          varying vec2 discUV;
          void main() {
            float radius = length(discUV);
            float feather = smoothstep(0.20, 0.38, radius) * (1.0 - smoothstep(0.94, 1.0, radius));
            float sweep = pow(0.5 + 0.5 * cos(3.0 * atan(discUV.y, discUV.x) + radius * 1.4), 3.0);
            float tips = smoothstep(0.87, 0.93, radius) * (1.0 - smoothstep(0.95, 1.0, radius));
            float alpha = blend * (feather * (0.085 + (1.0 - blend) * sweep * 0.16) + tips * 0.055);
            gl_FragColor = vec4(mix(vec3(0.07, 0.09, 0.08), vec3(0.72, 0.75, 0.68), tips * 0.65), alpha);
            #include <logdepthbuf_fragment>
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
        }),
      );
      blur.name = "Propeller_motion_blur";
      blur.position.z = -0.015;
      root.add(blur);
      apply(pose);
    },
  };
}
