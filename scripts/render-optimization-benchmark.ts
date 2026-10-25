import * as T from "three";
import { makeWorld } from "../src/world/world";
import { terrainSurfaceHeight } from "../src/world/terrain";

type Variant = "baseline" | "shadow1024" | "render85" | "terrainLOD" | "noShadows" | "lightInstances";
type View = "forest" | "airfield" | "overhead" | "water";
type Sample = {
  cpu: number;
  interval: number;
  calls: number;
  triangles: number;
};
const status = document.querySelector<HTMLElement>("#status")!;
const output = document.querySelector<HTMLElement>("#results")!;
const variant = document.querySelector<HTMLSelectElement>("#variant")!;
const view = document.querySelector<HTMLSelectElement>("#view")!;
const run = document.querySelector<HTMLButtonElement>("#run")!;
const pair = document.querySelector<HTMLButtonElement>("#pair")!;
const variants: Variant[] = ["baseline", "shadow1024", "render85", "terrainLOD", "noShadows", "lightInstances"];
const views: View[] = ["forest", "airfield", "overhead", "water"];
const scenes = new Map<
  Variant,
  {
    scene: T.Scene;
    world: ReturnType<typeof makeWorld>;
    clouds: { object: T.Object3D; x: number }[];
  }
>();
let terrainMaterialsPatched = 0;
let instancedLightCount = 0;
let instancedLightBatches = 0;
// Both worlds include the current middle tree LOD and spatial batches.
for (const name of ["baseline", "terrainLOD", "lightInstances"] as const) {
  const scene = new T.Scene();
  const world = makeWorld(scene);
  await world.ready;
  if (name === "terrainLOD") {
    scene.traverse((object) => {
      if (!(object instanceof T.Mesh) || !(object.material instanceof T.MeshStandardMaterial)) return;
      const material = object.material;
      if (material.customProgramCacheKey() !== "coastal-terrain-v1") return;
      terrainMaterialsPatched++;
      const compile = material.onBeforeCompile;
      material.customProgramCacheKey = () => "coastal-terrain-lod-experiment-v1";
      material.onBeforeCompile = (shader, renderer) => {
        compile.call(material, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace(
          "float grit = groundNoise(gp * 1.8);",
          `float groundFootprint = max(length(dFdx(gp)), length(dFdy(gp)));
           float grit = 0.5;
           if (groundFootprint < 2.0) {
             grit = mix(0.5, groundNoise(gp * 1.8), 1.0 - smoothstep(0.4, 2.0, groundFootprint));
           }`,
        ).replace(
          "float grainHeight = groundNoise(vGroundPosition * 0.65);",
          `float grainFootprint = max(length(dFdx(vGroundPosition)), length(dFdy(vGroundPosition)));
           float grainHeight = 0.5;
           if (grainFootprint < 2.0) grainHeight = groundNoise(vGroundPosition * 0.65);`,
        );
      };
    });
  }
  if (name === "lightInstances") {
    // Only the runway bulbs match this material, sphere and transform signature.
    const groups = new Map<T.Object3D, T.Mesh[]>();
    scene.traverse(object => {
      if (!(object instanceof T.Mesh) || !(object.geometry instanceof T.SphereGeometry)
        || !(object.material instanceof T.MeshBasicMaterial)
        || object.material.color.getHexString() !== "fff1bb" || !object.parent
        || object.position.y !== 0.25 || object.scale.x !== 0.35) return;
      const bulbs = groups.get(object.parent) ?? [];
      bulbs.push(object);
      groups.set(object.parent, bulbs);
    });
    for (const [parent, bulbs] of groups) {
      const batch = new T.InstancedMesh(bulbs[0].geometry, bulbs[0].material, bulbs.length);
      batch.castShadow = bulbs[0].castShadow;
      batch.receiveShadow = bulbs[0].receiveShadow;
      bulbs.forEach((bulb, index) => {
        bulb.updateMatrix();
        batch.setMatrixAt(index, bulb.matrix);
        parent.remove(bulb);
      });
      batch.computeBoundingBox();
      batch.computeBoundingSphere();
      parent.add(batch);
      instancedLightCount += bulbs.length;
      instancedLightBatches++;
    }
  }
  const clouds = scene.children
    .filter((object) => object.name === "Cloud formation")
    .map((object) => ({ object, x: object.position.x }));
  scenes.set(name, { scene, world, clouds });
}
const renderer = new T.WebGLRenderer({
  antialias: true,
  logarithmicDepthBuffer: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(1);
renderer.setSize(1280, 720);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.14;
renderer.info.autoReset = false;
document.querySelector("#viewport")!.append(renderer.domElement);
const camera = new T.PerspectiveCamera(48, 1280 / 720, 0.2, 11000);
const gl = renderer.getContext() as WebGL2RenderingContext;
const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
const pending: { query: WebGLQuery; values: number[] }[] = [];
const errors: string[] = [];
addEventListener("error", (event) => errors.push(event.message));
addEventListener("unhandledrejection", (event) =>
  errors.push(String(event.reason)),
);
let active:
  | {
      name: Variant;
      view: View;
      warm: number;
      frames: number;
      samples: Sample[];
      gpu: number[];
      done: (value: unknown) => void;
    }
  | undefined;
const results: {raw: {frames: Sample[]; gpuMs: number[]}; [key: string]: unknown}[] = [];
const orderedObstacles = (name: Variant) =>
  scenes
    .get(name)!
    .world.obstacles.map((obstacle) => JSON.stringify(obstacle))
    .sort();
const collisionIdentical =
  JSON.stringify(orderedObstacles("baseline")) ===
  JSON.stringify(orderedObstacles("terrainLOD")) &&
  JSON.stringify(orderedObstacles("baseline")) === JSON.stringify(orderedObstacles("lightInstances"));
let evidence: Record<string, unknown>;
const debugRenderer = gl.getExtension("WEBGL_debug_renderer_info");
function updateWorld(name: Variant) {
  const { world, clouds } = scenes.get(name === "terrainLOD" || name === "lightInstances" ? name : "baseline")!;
  // world.update advances clouds per call; reset them so both variants draw
  // exactly the same sky regardless of warmup/measurement order.
  for (const { object, x } of clouds) object.position.x = x;
  world.update(12, false);
}
function pose(name: View, _progress = 0) {
  const h = terrainSurfaceHeight(-514, -75);
  if (name === "forest") {
    camera.position.set(-514, h + 15, -34);
    camera.lookAt(-496, h + 7, -75);
  } else if (name === "airfield") {
    camera.position.set(-230, 35, 430);
    camera.lookAt(-260, 9, 240);
  } else if (name === "overhead") {
    camera.position.set(-320, 590, 350);
    camera.lookAt(-320, 70, -150);
  } else {
    camera.position.set(-900, 100, 800);
    camera.lookAt(-600, 10, 380);
  }
  camera.updateMatrixWorld();
}
function stats(values: number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const quantile = (fraction: number) =>
    sorted[Math.floor((sorted.length - 1) * fraction)];
  return {
    median: quantile(0.5),
    p95: quantile(0.95),
    mean: values.reduce((a, b) => a + b, 0) / values.length,
  };
}
function collectQueries() {
  for (let i = pending.length - 1; i >= 0; i--) {
    const { query, values } = pending[i];
    if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
    if (!gl.getParameter(timer.GPU_DISJOINT_EXT))
      values.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
    gl.deleteQuery(query);
    pending.splice(i, 1);
  }
}
let last = 0;
renderer.setAnimationLoop((now) => {
  if (timer) collectQueries();
  const name = active?.name ?? (variant.value as Variant);
  const nameView = active?.view ?? (view.value as View);
  const { scene } = scenes.get(name === "terrainLOD" || name === "lightInstances" ? name : "baseline")!;
  const progress = active
    ? Math.max(0, active.frames - active.warm) / 120
    : 0.5;
  pose(nameView, progress);
  const begin = performance.now();
  updateWorld(name);
  renderer.info.reset();
  let query: WebGLQuery | null = null;
  const measuring =
    active && active.frames >= active.warm && active.frames < active.warm + 120;
  if (timer && measuring) {
    query = gl.createQuery();
    gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
  }
  renderer.render(scene, camera);
  if (query && active) {
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    pending.push({ query, values: active.gpu });
  }
  const cpu = performance.now() - begin;
  if (active) {
    if (measuring)
      active.samples.push({
        cpu,
        interval: now - last,
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
      });
    active.frames++;
    if (active.frames >= active.warm + 140) {
      const completed = active;
      active = undefined;
      const result = {
        variant: completed.name,
        raw: { frames: completed.samples, gpuMs: completed.gpu },
        view: completed.view,
        samples: completed.samples.length,
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        cpuMs: stats(completed.samples.map((s) => s.cpu)),
        frameIntervalMs: stats(completed.samples.map((s) => s.interval)),
        gpuMs: stats(completed.gpu),
        gpuSamples: completed.gpu.length,
        drawCalls: stats(completed.samples.map((s) => s.calls)),
        triangles: stats(completed.samples.map((s) => s.triangles)),
      };
      results.push(result);
      evidence = {
        environment: {
          terrainMaterialsPatched, instancedLightCount, instancedLightBatches,
          measuredAt: new Date().toISOString(),
          settings: { warmupFrames: 60, sampleFrames: 120, drainFrames: 20, shadows: "PCFSoft", baselineShadowMap: 2048, renderScale: 0.85, time: 12, night: false },
          userAgent: navigator.userAgent,
          baselineBuffer: [1280, 720], gpuTimer: Boolean(timer),
          renderer: gl.getParameter(gl.RENDERER),
          gpu: debugRenderer ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL) : null,
        },
        collisionIdentical, results, errors,
      };
      // Keep thousands of raw samples out of the live accessibility tree.
      // The evidence download retains them for independent analysis.
      output.textContent = JSON.stringify({
        ...evidence,
        results: results.map(({raw, ...summary}) => summary),
      }, null, 2);
      completed.done(result);
    }
  }
  last = now;
});
function applyVariant(name: Variant) {
  renderer.setPixelRatio(name === "render85" ? 0.85 : 1);
  renderer.setSize(1280, 720);
  renderer.shadowMap.enabled = name !== "noShadows";
  for (const { world } of scenes.values()) {
    const size = name === "shadow1024" ? 1024 : 2048;
    if (world.sun.shadow.mapSize.x !== size) {
      world.sun.shadow.map?.dispose();
      world.sun.shadow.map = null;
      world.sun.shadow.mapSize.set(size, size);
    }
  }
}
variant.addEventListener("change", () => applyVariant(variant.value as Variant));
async function measure(name: Variant, cameraView: View) {
  applyVariant(name);
  variant.value = name;
  view.value = cameraView;
  status.textContent = `Measuring ${name}: ${cameraView}…`;
  return new Promise((done) => {
    active = {
      name,
      view: cameraView,
      warm: 60,
      frames: 0,
      samples: [],
      gpu: [],
      done,
    };
  });
}
run.disabled = pair.disabled = false;
status.textContent = `Ready. GPU timer ${timer ? "available" : "unavailable"}.`;
run.addEventListener("click", async () => {
  run.disabled = pair.disabled = true;
  await measure(variant.value as Variant, view.value as View);
  run.disabled = pair.disabled = false;
  status.textContent = "Measurement complete.";
});
pair.addEventListener("click", async () => {
  run.disabled = pair.disabled = true;
  results.length = 0;
  for (let round = 0; round < 3; round++)
    for (const cameraView of views) {
      const rotated = [...variants.slice(round), ...variants.slice(0, round)];
      const order = round % 2 ? rotated.reverse() : rotated;
      for (const name of order) await measure(name, cameraView);
    }
  run.disabled = pair.disabled = false;
  status.textContent = "Comparison complete: three balanced rounds.";
});
function download(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
document.querySelector("#save")!.addEventListener("click", () => {
  download(
    "render-optimization-benchmark.json",
    new Blob([JSON.stringify(evidence, null, 2)], { type: "application/json" }),
  );
});
document.querySelector("#capture")!.addEventListener("click", () => {
  if (active) return;
  pose(view.value as View, 0.5);
  const { scene } = scenes.get(variant.value === "terrainLOD" || variant.value === "lightInstances" ? variant.value as Variant : "baseline")!;
  updateWorld(variant.value as Variant);
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => {
    if (blob) download(`render-optimization-${variant.value}-${view.value}.png`, blob);
  });
});
