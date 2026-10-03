import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  random,
  terrainHeight,
  terrainSurfaceHeight,
  runways,
  runwayLocal,
} from "./terrain";
import type { Obstacle } from "./world";

type Placement = { matrix: T.Matrix4; tint?: T.Color };
export type VillageSite = {
  placeholder: T.Group;
  width: number;
  depth: number;
};
export type HangarSite = { placeholder: T.Object3D[]; matrix: T.Matrix4 };

// Instancing keeps a detailed cottage at seven submissions for the entire village.
function instances(asset: T.Group, placements: Placement[], name: string) {
  const group = new T.Group();
  group.name = name;
  asset.updateMatrixWorld(true);
  asset.traverse((part) => {
    if (!(part instanceof T.Mesh)) return;
    const batch = new T.InstancedMesh(
      part.geometry,
      part.material,
      placements.length,
    );
    batch.name = `${name}: ${part.name}`;
    batch.castShadow = batch.receiveShadow = true;
    placements.forEach(({ matrix, tint }, i) => {
      batch.setMatrixAt(i, matrix.clone().multiply(part.matrixWorld));
      if (tint) batch.setColorAt(i, tint);
    });
    batch.computeBoundingBox();
    batch.computeBoundingSphere();
    group.add(batch);
  });
  return group;
}

function placement(
  x: number,
  y: number,
  z: number,
  angle: number,
  scale: number | T.Vector3,
): Placement {
  return {
    matrix: new T.Matrix4().compose(
      new T.Vector3(x, y, z),
      new T.Quaternion().setFromAxisAngle(new T.Vector3(0, 1, 0), angle),
      typeof scale === "number" ? new T.Vector3(scale, scale, scale) : scale,
    ),
  };
}

export function clearScenery(group: T.Object3D) {
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  group.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    geometries.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      materials.add(m);
      for (const value of Object.values(m))
        if (value instanceof T.Texture) textures.add(value);
    }
    if (o instanceof T.InstancedMesh) o.dispose();
  });
  geometries.forEach((g) => g.dispose());
  materials.forEach((m) => m.dispose());
  textures.forEach((t) => t.dispose());
}

function configure(asset: T.Group, impostor = false) {
  asset.traverse((o) => {
    if (!(o instanceof T.Mesh)) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    o.material = materials.map((m) => {
      const p = m as T.MeshStandardMaterial;
      if (p.transparent) {
        p.transparent = false;
        p.alphaTest = 0.45;
        p.side = T.DoubleSide;
      }
      if (impostor) {
        const flat = new T.MeshBasicMaterial({
          map: p.map,
          alphaTest: 0.4,
          side: T.DoubleSide,
          color: "#c8d1bd",
        });
        p.dispose();
        return flat;
      }
      return p;
    });
    if (!Array.isArray(o.material) || o.material.length === 1)
      o.material =
        materials.length === 1 ? (o.material as T.Material[])[0] : o.material;
  });
  return asset;
}

function grove(
  near: T.Group,
  far: T.Group,
  placements: Placement[],
  name: string,
  switchDistance: number,
) {
  const root = new T.Group();
  root.name = name;
  const cells = new Map<string, Placement[]>();
  for (const p of placements) {
    const e = p.matrix.elements;
    const key = `${Math.floor(e[12] / 50)},${Math.floor(e[14] / 50)}`;
    const list = cells.get(key) ?? [];
    list.push(p);
    cells.set(key, list);
  }
  const distantSites: Placement[] = [],
    distantCenters: number[] = [];
  const isForest = name === "Coastal forest";
  for (const [key, list] of cells) {
    const lod = new T.LOD();
    lod.name = `${name} ${key}`;
    const center = new T.Vector3();
    list.forEach((p) =>
      center.add(new T.Vector3().setFromMatrixPosition(p.matrix)),
    );
    center.divideScalar(list.length);
    lod.position.copy(center);
    const local = list.map((p) => ({
      ...p,
      matrix: new T.Matrix4()
        .makeTranslation(-center.x, -center.y, -center.z)
        .multiply(p.matrix),
    }));
    const close = instances(near, local, "near");
    const distant = isForest ? new T.Group() : instances(far, local, "far");
    if (isForest) {
      distantSites.push(...list);
      list.forEach(() => distantCenters.push(center.x, center.y, center.z));
    }
    distant.traverse((o) => {
      if (o instanceof T.Mesh) o.castShadow = false;
    });
    lod.addLevel(close, 0);
    lod.addLevel(distant, switchDistance, isForest ? 0 : 0.15);
    root.add(lod);
  }
  if (isForest) {
    const distant = instances(far, distantSites, "Batched distant canopies");
    distant.traverse((part) => {
      if (!(part instanceof T.InstancedMesh)) return;
      part.castShadow = false;
      part.geometry = part.geometry.clone();
      part.geometry.setAttribute(
        "treeCell",
        new T.InstancedBufferAttribute(new Float32Array(distantCenters), 3),
      );
      const material = (part.material as T.MeshBasicMaterial).clone();
      material.onBeforeCompile = (shader) => {
        shader.vertexShader =
          "attribute vec3 treeCell;\n" +
          shader.vertexShader.replace(
            "#include <project_vertex>",
            `#include <project_vertex>
          if (distance(cameraPosition, treeCell) < ${switchDistance.toFixed(1)}) gl_Position = vec4(1e6, 1e6, 1e6, 1.0);`,
          );
      };
      material.customProgramCacheKey = () => "coastal-canopy-lod-v1";
      const daylight = material.color.clone();
      part.onBeforeRender = (_renderer, scene) => {
        const light = scene.children.find(
          (o) => o instanceof T.DirectionalLight,
        ) as T.DirectionalLight;
        material.color
          .copy(daylight)
          .multiplyScalar(0.18 + 0.82 * Math.min(1, light.intensity / 2.7));
      };
      part.material = material;
    });
    root.add(distant);
  }
  return root;
}

export function addEnvironmentAssets(
  scene: T.Scene,
  village: VillageSite[],
  hangars: HangarSite[],
  obstacles: Obstacle[],
  land: T.Mesh,
) {
  const root = new T.Group();
  root.name = "Blender coastal scenery";
  scene.add(root);
  let disposed = false;
  const models: T.Group[] = [];
  const loader = new GLTFLoader();
  const load = async (name: string, impostor = false) => {
    const { scene: model } = await loader.loadAsync(
      `/assets/scenery/${name}.glb`,
    );
    configure(model, impostor);
    if (disposed) {
      clearScenery(model);
      throw new Error("Scenery load cancelled");
    }
    models.push(model);
    return model;
  };
  const ready = Promise.allSettled([
    new T.TextureLoader()
      .loadAsync("/assets/scenery/cumulus.png")
      .then((texture) => {
        texture.colorSpace = T.SRGBColorSpace;
        if (disposed) {
          texture.dispose();
          return;
        }
        const clouds = scene.children.filter(
          (o) => o.name === "Cloud formation",
        );
        const material = new T.SpriteMaterial({
          map: texture,
          transparent: true,
          opacity: 0.9,
          depthWrite: false,
          fog: true,
        });
        clouds.forEach((cloud, i) => {
          cloud.children.forEach((o) => {
            o.visible = false;
          });
          if (i % 2) return; // Clearer sky, with varied isolated cloud banks.
          const sprite = new T.Sprite(material);
          sprite.scale.set(260 + (i % 5) * 30, 135 + (i % 3) * 15, 1);
          sprite.onBeforeRender = () => {
            const light = scene.children.find(
              (o) => o instanceof T.DirectionalLight,
            ) as T.DirectionalLight;
            material.color.setScalar(
              0.24 + 0.76 * Math.min(1, light.intensity / 2.7),
            );
          };
          cloud.add(sprite);
        });
        // These sprites belong to world groups so their existing deterministic drift is retained.
        root.userData.cloudMaterial = material;
      }),
    load("palm-bay-terrain").then((model) => {
      if (disposed) return;
      model.updateMatrixWorld(true);
      model.traverse((part) => {
        if (!(part instanceof T.Mesh)) return;
        const geometry = part.geometry.clone().applyMatrix4(part.matrixWorld);
        land.geometry.dispose();
        land.geometry = geometry;
      });
    }),
    load("plantation-cottage").then((model) => {
      if (disposed) return;
      model.rotation.y = Math.PI;
      const sites = village.map(({ placeholder, width, depth }, i) => {
        const p = placeholder.position;
        const angle = placeholder.rotation.y;
        const scale = new T.Vector3(width / 8, 1, depth / 10);
        // Extend piers below the surface while keeping the stairs grounded at their outer end.
        const x = p.x + Math.sin(angle) * 8.02 * scale.z;
        const z = p.z + Math.cos(angle) * 8.02 * scale.z;
        const y =
          Math.max(terrainSurfaceHeight(p.x, p.z), terrainSurfaceHeight(x, z)) +
          -0.06;
        const site = placement(p.x, y, p.z, angle, scale);
        site.tint = new T.Color(["#d5d8c3", "#c3d0c6", "#e0d2bc"][i % 3]);
        const obstacle = obstacles.find(
          (o) => o.label === "building" && o.x === p.x && o.z === p.z,
        );
        if (obstacle) obstacle.y = y + 6.1;
        placeholder.visible = false;
        return site;
      });
      root.add(instances(model, sites, "Plantation village"));
    }),
    load("coastal-hangar").then((model) => {
      if (disposed) return;
      root.add(
        instances(
          model,
          hangars.map((h) => ({ matrix: h.matrix })),
          "Coastal hangars",
        ),
      );
      hangars.forEach((h) =>
        h.placeholder.forEach((o) => {
          o.visible = false;
        }),
      );
    }),
    Promise.all([
      load("coastal-tree-near"),
      load("coastal-tree-far", true),
    ]).then(([near, far]) => {
      if (disposed) return;
      const rng = random(817),
        sites: Placement[] = [];
      for (let i = obstacles.length - 1; i >= 0; i--)
        if (obstacles[i].label === "tree") obstacles.splice(i, 1);
      for (
        let attempt = 0;
        attempt < 120000 && sites.length < 6500;
        attempt++
      ) {
        const x = (rng() - 0.5) * 1740,
          z = (rng() - 0.5) * 1700,
          h = terrainSurfaceHeight(x, z);
        const gradient =
          Math.hypot(terrainHeight(x + 5, z) - h, terrainHeight(x, z + 5) - h) /
          5;
        const density =
          0.5 +
          0.35 *
            Math.sin(x * 0.017 + Math.sin(z * 0.007) * 3) *
            Math.cos(z * 0.012);
        if (
          h < 12 ||
          h > 205 ||
          gradient > 0.9 ||
          rng() > density ||
          isClearanceArea(x, z)
        )
          continue;
        const scale = 1.4 + rng() * 1.9;
        const site = placement(x, h - 0.05, z, rng() * Math.PI * 2, scale);
        site.tint = new T.Color().setHSL(
          0.2 + rng() * 0.08,
          0.12 + rng() * 0.16,
          0.72 + rng() * 0.18,
        );
        sites.push(site);
        obstacles.push({
          x,
          z,
          y: h + 3.4 * scale,
          radius: 1.3,
          label: "tree",
        });
      }
      const forest = grove(near, far, sites, "Coastal forest", 45);
      root.add(forest);
      // Only hide the old crowns after the replacement has arrived.
      scene.children
        .filter((o) => o.name === "Forest crowns")
        .forEach((o) => {
          o.visible = false;
        });
    }),
    Promise.all([
      load("coastal-rock-near"),
      load("coastal-rock-far"),
      load("basalt-outcrop"),
    ]).then(([near, far, basalt]) => {
      if (disposed) return;
      const rng = random(163),
        limestone: Placement[] = [],
        dark: Placement[] = [];
      for (
        let attempt = 0;
        attempt < 16000 && limestone.length < 100;
        attempt++
      ) {
        const x = (rng() - 0.5) * 2200,
          z = (rng() - 0.5) * 2200,
          h = terrainSurfaceHeight(x, z);
        if (h < 0.3 || h > 6 || isClearanceArea(x, z)) continue;
        const scale = 1.8 + rng() * 3.4;
        const base = footingHeight(x, z, 1.5 * scale) - 0.16;
        limestone.push(placement(x, base, z, rng() * Math.PI * 2, scale));
        obstacles.push({
          x,
          z,
          y: base + scale,
          radius: scale * 1.3,
          label: "coastal rock",
        });
      }
      for (let attempt = 0; attempt < 12000 && dark.length < 210; attempt++) {
        const x = (rng() - 0.5) * 1720,
          z = (rng() - 0.5) * 1750,
          h = terrainSurfaceHeight(x, z);
        const gradient =
          Math.hypot(terrainHeight(x + 8, z) - h, terrainHeight(x, z + 8) - h) /
          8;
        if (h < 9 || h > 240 || gradient < 0.25 || isClearanceArea(x, z))
          continue;
        const scale = 0.8 + rng() * 2.2;
        const base = footingHeight(x, z, 3.4 * scale) - 0.25 * scale;
        dark.push(placement(x, base, z, rng() * Math.PI * 2, scale));
        obstacles.push({
          x,
          z,
          y: base + 4.4 * scale,
          radius: 3 * scale,
          label: "basalt outcrop",
        });
      }
      root.add(
        grove(near, far, limestone, "Limestone coves", 170),
        instances(basalt, dark, "Basalt cliffs and talus"),
      );
    }),
  ]).then((results) => {
    const failures = results.filter((r) => r.status === "rejected");
    if (!disposed && failures.length)
      console.warn(
        "Some coastal scenery could not load; original scenery remains available.",
        failures,
      );
  });
  return {
    ready,
    dispose() {
      disposed = true;
      root.removeFromParent();
      clearScenery(root);
      models.forEach(clearScenery);
      const cloudMaterial = root.userData.cloudMaterial as
        T.SpriteMaterial | undefined;
      cloudMaterial?.map?.dispose();
      cloudMaterial?.dispose();
    },
  };
}

function isClearanceArea(x: number, z: number) {
  if (x > -465 && x < -240 && z > 465 && z < 630) return true;
  // Road from the apron to the village; leave a generous strip for clear sightlines.
  if (x > -215 && x < -148 && z > 275 && z < 455) return true;
  return runways.some((r) => {
    const p = runwayLocal(x, z, r);
    return (
      (Math.abs(p.x) < 100 && Math.abs(p.z) < r.length / 2 + 55) ||
      (Math.abs(p.x - 65) < 45 && Math.abs(p.z - 50) < 100)
    );
  });
}

function footingHeight(x: number, z: number, radius: number) {
  let height = terrainSurfaceHeight(x, z);
  for (let i = 0; i < 8; i++) {
    const angle = (i * Math.PI) / 4;
    height = Math.min(
      height,
      terrainSurfaceHeight(
        x + Math.cos(angle) * radius,
        z + Math.sin(angle) * radius,
      ),
    );
  }
  return height;
}
