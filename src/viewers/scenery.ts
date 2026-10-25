import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makeWorld } from "../world/world";
import { terrainSurfaceHeight } from "../world/terrain";
const scene = new T.Scene(),
  world = makeWorld(scene);
const renderer = new T.WebGLRenderer({
  antialias: true,
  logarithmicDepthBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.info.autoReset = false;
document.body.prepend(renderer.domElement);
renderer.domElement.setAttribute(
  "aria-label",
  "Interactive Palm Bay island scenery",
);
const camera = new T.PerspectiveCamera(48, 1, 0.1, 10000);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.minDistance = 2;
orbit.maxDistance = 4000;
orbit.maxPolarAngle = Math.PI * 0.48;
const viewpoints: Record<string, { position: number[]; target: number[] }> = {
  overview: { position: [-1300, 820, 1500], target: [-70, 70, 0] },
  village: {
    position: [-390, 28, 546],
    target: [-401, terrainSurfaceHeight(-401, 519) + 3, 519],
  },
  airfield: { position: [-244, 27, 329], target: [-191, 14, 317] },
  coast: { position: [-840, 34, 493], target: [-760, 3, 451] },
  forest: {
    position: [-514, terrainSurfaceHeight(-514, -75) + 15, -34],
    target: [-496, terrainSurfaceHeight(-496, -75) + 7, -75],
  },
};
function view(name: string) {
  const v = viewpoints[name];
  if (!v) return;
  camera.position.fromArray(v.position);
  orbit.target.fromArray(v.target);
  orbit.update();
  document
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === name)),
    );
}
document
  .querySelectorAll<HTMLButtonElement>("[data-view]")
  .forEach((b) => b.addEventListener("click", () => view(b.dataset.view!)));
let night = false;
document
  .querySelector<HTMLButtonElement>("#night")!
  .addEventListener("click", (e) => {
    night = !night;
    (e.currentTarget as HTMLButtonElement).setAttribute(
      "aria-pressed",
      String(night),
    );
    (e.currentTarget as HTMLButtonElement).textContent = night
      ? "Daylight"
      : "Evening";
  });
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize);
resize();
view("overview");
await world.ready;
// Frame a real shoreline scan, rather than guessing where randomized scenery landed.
scene.updateMatrixWorld(true);
let shore: T.Vector3 | undefined;
scene.getObjectByName("Limestone coves")?.traverse((part) => {
  if (shore || !(part instanceof T.InstancedMesh) || !part.count) return;
  const matrix = new T.Matrix4();
  part.getMatrixAt(0, matrix);
  matrix.premultiply(part.matrixWorld);
  shore = new T.Vector3().setFromMatrixPosition(matrix);
});
if (shore) {
  const p = shore as T.Vector3;
  const eye = p.clone().add(new T.Vector3(20, 16, 22));
  eye.y = Math.max(eye.y, terrainSurfaceHeight(eye.x, eye.z) + 8);
  viewpoints.coast = {
    position: eye.toArray(),
    target: p
      .clone()
      .add(new T.Vector3(0, 1, 0))
      .toArray(),
  };
}
orbit.addEventListener("end", () => {
  world.sun.shadow.needsUpdate = true;
});
world.sun.shadow.autoUpdate = false;
world.sun.shadow.needsUpdate = true;
document.querySelector<HTMLElement>("#loading")!.hidden = true;
let last = performance.now(),
  start = last,
  frames = 0,
  fps = 0;
const began = last;
renderer.setAnimationLoop((now) => {
  world.update((now - began) / 1000, night);
  orbit.update();
  renderer.info.reset();
  renderer.render(scene, camera);
  frames++;
  if (now - start > 1000) {
    fps = (1000 * frames) / (now - start);
    start = now;
    frames = 0;
    document.querySelector("#status")!.textContent =
      `${Math.round(fps)} fps · ${renderer.info.render.calls} draws · ${(renderer.info.render.triangles / 1e6).toFixed(2)}M triangles`;
  }
});
addEventListener(
  "pagehide",
  () => {
    renderer.setAnimationLoop(null);
    orbit.dispose();
    world.dispose();
    renderer.dispose();
  },
  { once: true },
);
