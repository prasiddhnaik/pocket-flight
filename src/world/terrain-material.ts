import * as T from "three";

// World-space detail stays fixed to the ground in both flight and replay cameras.
export function makeTerrainMaterial() {
  const material = new T.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
  });
  material.customProgramCacheKey = () => "coastal-terrain-v1";
  material.onBeforeCompile = (shader) => {
    const varyings = `
      varying vec3 vGroundPosition;
      varying vec3 vGroundNormal;
    `;
    shader.vertexShader =
      varyings +
      shader.vertexShader.replace(
        "#include <worldpos_vertex>",
        `#include <worldpos_vertex>
      vGroundPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
      vGroundNormal = normalize(mat3(modelMatrix) * objectNormal);`,
      );
    shader.fragmentShader =
      varyings +
      `
      float groundHash(vec3 p) {
        p = fract(p * 0.1031);
        p += dot(p, p.yzx + 33.33);
        return fract((p.x + p.y) * p.z);
      }
      float groundNoise(vec3 p) {
        vec3 i = floor(p), f = fract(p);
        f = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(mix(groundHash(i), groundHash(i + vec3(1,0,0)), f.x),
              mix(groundHash(i + vec3(0,1,0)), groundHash(i + vec3(1,1,0)), f.x), f.y),
          mix(mix(groundHash(i + vec3(0,0,1)), groundHash(i + vec3(1,0,1)), f.x),
              mix(groundHash(i + vec3(0,1,1)), groundHash(i + vec3(1,1,1)), f.x), f.y), f.z);
      }
    ` +
      shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <color_fragment>",
      `#include <color_fragment>
      vec3 gp = vGroundPosition;
      float broad = groundNoise(gp * 0.018);
      float groundPatch = groundNoise(gp * 0.12);
      float grit = groundNoise(gp * 1.8);
      float meadow = groundNoise(gp * 0.0085 + 7.0);
      float clump = groundNoise(gp * 0.052 + 3.0);
      float steep = 1.0 - abs(normalize(vGroundNormal).y);
      float beach = 1.0 - smoothstep(4.0, 14.0, gp.y);
      float villageArea = (1.0 - smoothstep(78.0, 95.0, abs(gp.x + 355.0)))
        * (1.0 - smoothstep(75.0, 88.0, abs(gp.z - 558.0)));
      float row = abs(fract((gp.z - 502.0) / 29.0 + 0.5) - 0.5) * 29.0;
      float street = 1.0 - smoothstep(1.6, 2.1, row);
      street = max(street, 1.0 - smoothstep(1.8, 2.4, abs(gp.x + 446.0)));
      // The sand comes from the baked colours; everything above it is painted here, so the
      // baked rock on any steep slope cannot mark the airfield's cut banks as bare earth.
      float sand = (1.0 - smoothstep(3.2, 7.0, gp.y + (groundPatch - 0.5) * 2.4)) * (1.0 - villageArea);
      vec3 green = mix(vec3(0.028, 0.092, 0.03), vec3(0.052, 0.13, 0.034), smoothstep(0.28, 0.62, meadow));
      green = mix(green, vec3(0.115, 0.158, 0.042), smoothstep(0.56, 0.84, clump * 0.55 + meadow * 0.45) * 0.8);
      // Darker where the forest stands, using the same pattern that places its trees.
      float canopy = 0.5 + 0.35 * sin(gp.x * 0.017 + sin(gp.z * 0.007) * 3.0) * cos(gp.z * 0.012);
      float wooded = smoothstep(0.52, 0.8, canopy) * smoothstep(10.0, 18.0, gp.y) * (1.0 - villageArea);
      green = mix(green, vec3(0.022, 0.07, 0.03), wooded * 0.82);
      // Jungle climbs the mountains, as on the wet side of a volcanic island.
      green = mix(green, vec3(0.024, 0.08, 0.03), smoothstep(30.0, 120.0, gp.y) * 0.72);
      float strata = sin(gp.y * 0.8 + groundNoise(gp * 0.07) * 4.0) * 0.05;
      vec3 rockColor = mix(vec3(0.06, 0.056, 0.048), vec3(0.17, 0.15, 0.112), broad) * (0.9 + groundPatch * 0.2 + strata);
      float rock = smoothstep(0.3, 0.52, steep + (groundPatch - 0.5) * 0.18) * smoothstep(16.0, 40.0, gp.y);
      rock = max(rock, smoothstep(190.0, 232.0, gp.y + (broad - 0.5) * 44.0) * 0.7);
      diffuseColor.rgb = mix(mix(green, rockColor, rock), diffuseColor.rgb, sand);
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.16, 0.105), street * villageArea * 0.85);
      float tuft = groundNoise(gp * 0.42);
      diffuseColor.rgb *= 0.85 + broad * 0.18 + groundPatch * 0.13 + (tuft - 0.5) * 0.3 * (1.0 - sand) + (grit - 0.5) * mix(0.2, 0.12, beach);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.70, 0.78, 0.75),
        (1.0 - smoothstep(0.5, 2.8, gp.y)) * 0.55);`,
    );
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <normal_fragment_maps>",
      `#include <normal_fragment_maps>
      // Derivative bump fades with distance to avoid sparkling in an aerial view.
      float grainHeight = groundNoise(vGroundPosition * 0.65);
      float footprint = max(length(dFdx(vGroundPosition)), length(dFdy(vGroundPosition)));
      float bumpStrength = (1.0 - smoothstep(0.4, 2.0, footprint)) * 0.06;
      vec3 gx = dFdx(vViewPosition), gy = dFdy(vViewPosition);
      vec3 rx = cross(gy, normal), ry = cross(normal, gx);
      float determinant = dot(gx, rx);
      if (abs(determinant) > 0.000001) {
        vec3 gradient = sign(determinant) * (dFdx(grainHeight) * rx + dFdy(grainHeight) * ry);
        normal = normalize(abs(determinant) * normal - bumpStrength * gradient);
      }`,
    );
  };
  return material;
}
