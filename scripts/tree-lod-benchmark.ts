import * as T from "three";
import { makeWorld } from "../src/world/world";
import { terrainSurfaceHeight } from "../src/world/terrain";

type Variant = "baseline" | "optimized";
type View = "forest" | "treetops" | "overhead" | "approach";
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
const variants: Variant[] = ["baseline", "optimized"];
const views: View[] = ["forest", "treetops", "overhead", "approach"];
const scenes = new Map<
  Variant,
  {
    scene: T.Scene;
    world: ReturnType<typeof makeWorld>;
    clouds: { object: T.Object3D; x: number }[];
  }
>();
const baselinePath = "/output/tree-lod/environment-assets-before.ts";
const baseline = await import(/* @vite-ignore */ baselinePath);
for (const name of variants) {
  const scene = new T.Scene();
  const world = makeWorld(
    scene,
    name === "baseline" ? baseline.addEnvironmentAssets : undefined,
  );
  await world.ready;
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
const results: unknown[] = [];
const orderedObstacles = (name: Variant) =>
  scenes
    .get(name)!
    .world.obstacles.map((obstacle) => JSON.stringify(obstacle))
    .sort();
const collisionIdentical =
  JSON.stringify(orderedObstacles("baseline")) ===
  JSON.stringify(orderedObstacles("optimized"));
const debugRenderer = gl.getExtension("WEBGL_debug_renderer_info");
function updateWorld(name: Variant) {
  const { world, clouds } = scenes.get(name)!;
  // world.update advances clouds per call; reset them so both variants draw
  // exactly the same sky regardless of warmup/measurement order.
  for (const { object, x } of clouds) object.position.x = x;
  world.update(12, false);
}
function pose(name: View, progress = 0) {
  const h = terrainSurfaceHeight(-514, -75);
  if (name === "forest") {
    camera.position.set(-514, h + 15, -34);
    camera.lookAt(-496, h + 7, -75);
  } else if (name === "treetops") {
    camera.position.set(-514, h + 42, 12);
    camera.lookAt(-470, h + 10, -90);
  } else if (name === "overhead") {
    camera.position.set(-320, 590, 350);
    camera.lookAt(-320, 70, -150);
  } else {
    const x = -600 + progress * 160;
    const ground = terrainSurfaceHeight(x, -35);
    camera.position.set(x, ground + 20, -35);
    camera.lookAt(x + 28, ground + 8, -90);
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
  const { scene } = scenes.get(name)!;
  const progress = active
    ? Math.max(0, active.frames - active.warm) / 180
    : 0.5;
  pose(nameView, progress);
  const begin = performance.now();
  updateWorld(name);
  renderer.info.reset();
  let query: WebGLQuery | null = null;
  const measuring =
    active && active.frames >= active.warm && active.frames < active.warm + 180;
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
    if (active.frames >= active.warm + 210) {
      const completed = active;
      active = undefined;
      const result = {
        variant: completed.name,
        view: completed.view,
        samples: completed.samples.length,
        cpuMs: stats(completed.samples.map((s) => s.cpu)),
        frameIntervalMs: stats(completed.samples.map((s) => s.interval)),
        gpuMs: stats(completed.gpu),
        gpuSamples: completed.gpu.length,
        drawCalls: stats(completed.samples.map((s) => s.calls)),
        triangles: stats(completed.samples.map((s) => s.triangles)),
      };
      results.push(result);
      output.textContent = JSON.stringify(
        {
          environment: {
            userAgent: navigator.userAgent,
            drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
            gpuTimer: Boolean(timer),
            renderer: gl.getParameter(gl.RENDERER),
            gpu: debugRenderer
              ? gl.getParameter(debugRenderer.UNMASKED_RENDERER_WEBGL)
              : null,
          },
          collisionIdentical,
          results,
          errors,
        },
        null,
        2,
      );
      completed.done(result);
    }
  }
  last = now;
});
async function measure(name: Variant, cameraView: View) {
  variant.value = name;
  view.value = cameraView;
  status.textContent = `Measuring ${name}: ${cameraView}…`;
  return new Promise((done) => {
    active = {
      name,
      view: cameraView,
      warm: 90,
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
      const order = round % 2 ? [...variants].reverse() : variants;
      for (const name of order) await measure(name, cameraView);
    }
  run.disabled = pair.disabled = false;
  status.textContent = "Comparison complete: three alternating rounds.";
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
    "tree-lod-benchmark.json",
    new Blob([output.textContent ?? ""], { type: "application/json" }),
  );
});
document.querySelector("#capture")!.addEventListener("click", () => {
  if (active) return;
  pose(view.value as View, 0.5);
  const { scene } = scenes.get(variant.value as Variant)!;
  updateWorld(variant.value as Variant);
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => {
    if (blob) download(`tree-lod-${variant.value}-${view.value}.png`, blob);
  });
});
