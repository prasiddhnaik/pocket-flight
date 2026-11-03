import * as T from "three";
import type { PocketFlight } from "../src/flight/game";
export const variants = [
  "baseline",
  "shadow1024",
  "render85",
  "terrainLOD",
  "lightInstances",
  "noShadows",
] as const;
export const engineVariants = ["baseline", "spatialIndex"] as const;
export type Variant =
  (typeof variants)[number] | (typeof engineVariants)[number];

// Experiments live only in the benchmark entry, never in the game entry point.
export function makeExperiments(game: PocketFlight) {
  const { scene, renderer, world } = game;
  const baseDpr = renderer.getPixelRatio();
  let terrain: T.MeshStandardMaterial | undefined;
  const groups = new Map<T.Object3D, T.Mesh[]>();
  scene.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    if (
      object.material instanceof T.MeshStandardMaterial &&
      object.material.customProgramCacheKey() === "coastal-terrain-v1"
    )
      terrain = object.material;
    if (
      object.geometry instanceof T.SphereGeometry &&
      object.material instanceof T.MeshBasicMaterial &&
      object.material.color.getHexString() === "fff1bb" &&
      object.parent &&
      object.position.y === 0.25 &&
      object.scale.x === 0.35
    ) {
      const bulbs = groups.get(object.parent) ?? [];
      bulbs.push(object);
      groups.set(object.parent, bulbs);
    }
  });
  if (!terrain) throw new Error("Terrain shader was not found");
  const material = terrain;
  const originalCompile = material.onBeforeCompile;
  const originalKey = material.customProgramCacheKey;
  const detailCompile: typeof originalCompile = (shader, renderer) => {
    originalCompile.call(material, shader, renderer);
    if (
      !shader.fragmentShader.includes("float grit = groundNoise(gp * 1.8);") ||
      !shader.fragmentShader.includes(
        "float grainHeight = groundNoise(vGroundPosition * 0.65);",
      )
    )
      throw new Error("Terrain shader no longer matches this experiment");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "float grit = groundNoise(gp * 1.8);",
        `
      float groundFootprint = max(length(dFdx(gp)), length(dFdy(gp)));
      float grit = 0.5;
      if (groundFootprint < 2.0) grit = mix(0.5, groundNoise(gp * 1.8), 1.0 - smoothstep(0.4, 2.0, groundFootprint));
    `,
      )
      .replace(
        "float grainHeight = groundNoise(vGroundPosition * 0.65);",
        `
      float grainFootprint = max(length(dFdx(vGroundPosition)), length(dFdy(vGroundPosition)));
      float grainHeight = 0.5;
      if (grainFootprint < 2.0) grainHeight = groundNoise(vGroundPosition * 0.65);
    `,
      );
  };
  const batches: { batch: T.InstancedMesh; bulbs: T.Mesh[] }[] = [];
  for (const [parent, bulbs] of groups) {
    const batch = new T.InstancedMesh(
      bulbs[0].geometry,
      bulbs[0].material,
      bulbs.length,
    );
    batch.name = "Benchmark runway light instances";
    batch.castShadow = bulbs[0].castShadow;
    batch.receiveShadow = bulbs[0].receiveShadow;
    bulbs.forEach((bulb, i) => {
      bulb.updateMatrix();
      batch.setMatrixAt(i, bulb.matrix);
    });
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    batch.visible = false;
    parent.add(batch);
    batches.push({ batch, bulbs });
  }
  // The game now instances its edge lights; the experiment then equals baseline.
  const builtIn = scene.getObjectsByProperty("name", "Runway edge lights").length === 2;
  if (
    !(builtIn && !batches.length) &&
    (batches.length !== 2 ||
      batches.reduce((n, b) => n + b.bulbs.length, 0) !== 52)
  )
    throw new Error("Unexpected runway light layout");
  let current: Variant = "baseline";
  return {
    baseDpr,
    apply(name: Variant, width: number, height: number) {
      renderer.setPixelRatio(baseDpr * (name === "render85" ? 0.85 : 1));
      renderer.setSize(width, height);
      game.camera.aspect = width / height;
      game.camera.updateProjectionMatrix();
      renderer.shadowMap.enabled = name !== "noShadows";
      const size = name === "shadow1024" ? 1024 : 2048;
      if (world.sun.shadow.mapSize.x !== size) {
        world.sun.shadow.map?.dispose();
        world.sun.shadow.map = null;
        world.sun.shadow.mapSize.set(size, size);
      }
      if ((name === "terrainLOD") !== (current === "terrainLOD")) {
        material.onBeforeCompile =
          name === "terrainLOD" ? detailCompile : originalCompile;
        material.customProgramCacheKey =
          name === "terrainLOD"
            ? () => "coastal-terrain-lod-experiment-v1"
            : originalKey;
        material.needsUpdate = true;
      }
      for (const { batch, bulbs } of batches) {
        batch.visible = name === "lightInstances";
        for (const bulb of bulbs) bulb.visible = name !== "lightInstances";
      }
      current = name;
    },
  };
}
