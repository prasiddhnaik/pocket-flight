import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { makeAircraft } from "../aircraft/aircraft";
import { aircraftDesign } from "../aircraft/aircraft-design";
import "./heron-view.css";

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <main><header><a href="/">← Pocket Flight</a><span>AIRCRAFT No. 05</span></header>
  <section class="heron-title"><p>THE ISLAND UTILITY AIRCRAFT</p><h1>Heron <span>UT–9</span></h1>
    <p>High wings. Hard-working gear. Room for the next island.</p></section>
  <div id="viewport" aria-label="Interactive Heron aircraft model"></div>
  <aside><p class="heron-status" role="status">Loading CAD airframe…</p>
    <dl><div><dt>WINGSPAN</dt><dd>15.87 <small>m</small></dd></div><div><dt>LENGTH</dt><dd>12.67 <small>m</small></dd></div>
    <div><dt>POWER</dt><dd>867 <small>shp class</small></dd></div><div><dt>LANDING GEAR</dt><dd>Fixed tricycle</dd></div></dl>
    <p>Original parametric CAD, guided by the Grand Caravan profile. Recessed door seals and cowling panels, cooling slots, wing fuel caps, a pitot probe, treaded tires and fitted brake assemblies add detail to the rounded cabin and braced high wings.</p>
    <label>Propeller power <input id="power" aria-label="Propeller power" type="range" min="0" max="1" step="0.01" value="0"></label>
    <label>Flaps <input id="flaps" aria-label="Flaps" type="range" min="0" max="1" step="0.01" value="0"></label>
    <div class="heron-views"><button data-view="iso">Perspective</button><button data-view="side">Side</button><button data-view="front">Front</button><button data-view="top">Top</button><button data-view="body">Body detail</button><button data-view="gear">Gear detail</button></div>
    <a class="heron-fly" href="/?aircraft=heron">Fly the Heron →</a>
    <small>Drag to orbit · Scroll to zoom. Game flight coefficients and component masses are estimates.</small></aside>
  <footer><span>PARAMETRIC AIRFRAME / METRE SCALE</span><a href="/assets/heron-ut9.cad.json">CAD connection measurements ↗</a></footer></main>`;
const host = document.querySelector<HTMLDivElement>("#viewport")!;
const scene = new T.Scene();
scene.background = new T.Color("#e7e6df");
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
host.append(renderer.domElement);
const camera = new T.PerspectiveCamera(38, 1, 0.1, 160);
camera.position.set(12, 5.5, -15);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.1, 0.6);
controls.enableDamping = true;
controls.minDistance = 1.3;
controls.maxDistance = 46;
controls.maxPolarAngle = Math.PI * 0.49;
const pmrem = new T.PMREMGenerator(renderer),
  room = new RoomEnvironment();
const environment = pmrem.fromScene(room, 0.04);
scene.environment = environment.texture;
room.dispose();
pmrem.dispose();
scene.add(new T.HemisphereLight(0xffffff, 0x767f77, 0.7));
const sun = new T.DirectionalLight(0xfff8ed, 2);
sun.position.set(-9, 15, -7);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, {
  left: -13,
  right: 13,
  top: 13,
  bottom: -13,
  near: 0.1,
  far: 55,
});
sun.shadow.normalBias = 0.03;
scene.add(sun);
const ground = new T.Mesh(
  new T.PlaneGeometry(180, 180),
  new T.MeshStandardMaterial({ color: 0xa3afa6, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -2.05;
ground.receiveShadow = true;
scene.add(ground);
const aircraft = makeAircraft(0, "heron");
scene.add(aircraft.group);
let ready = false;
aircraft.ready
  .then(() => {
    ready = true;
    document.querySelector(".heron-status")!.textContent =
      "CAD airframe ready · all parts attached";
  })
  .catch((error: unknown) => {
    document.querySelector(".heron-status")!.textContent = String(error);
  });
const power = document.querySelector<HTMLInputElement>("#power")!,
  flaps = document.querySelector<HTMLInputElement>("#flaps")!;
const views: Record<string, { position: T.Vector3; target?: T.Vector3 }> = {
  iso: { position: new T.Vector3(12, 5.5, -15) },
  side: { position: new T.Vector3(24, 0.1, 0.6) },
  front: { position: new T.Vector3(0, 3, -26) },
  top: { position: new T.Vector3(0, 29, 0.601) },
  body: {
    position: new T.Vector3(5.2, 0.6, -4.7),
    target: new T.Vector3(0.4, 0.25, -2.1),
  },
  gear: {
    position: new T.Vector3(3.1, -0.9, -0.8),
    target: new T.Vector3(1.45, -1.38, 0.75),
  },
};
document.querySelectorAll<HTMLButtonElement>("[data-view]").forEach((button) =>
  button.addEventListener("click", () => {
    const view = views[button.dataset.view!];
    camera.position.copy(view.position);
    controls.target.copy(view.target ?? new T.Vector3(0, 0.1, 0.6));
    controls.update();
  }),
);
function resize() {
  const { width, height } = host.getBoundingClientRect();
  renderer.setSize(width, height);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(host);
resize();
const clock = new T.Clock();
renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (ready) {
    aircraft.setConfiguration(Number(flaps.value));
    const throttle = Number(power.value);
    aircraft.propellerMotion.update(
      {
        throttle,
        airspeed: 0,
        damage: 0,
        engineOut: throttle === 0,
        crashed: false,
      },
      dt,
    );
    aircraft.displays?.update(
      {
        time: clock.elapsedTime,
        mode: "demo",
        speed: aircraftDesign("heron").trimSpeed,
        altitude: 450,
        pitch: 0,
        roll: 0,
        heading: 0,
        verticalSpeed: 0,
        power: throttle,
        fuel: 0.65,
        x: 0,
        z: 0,
        engineOut: throttle === 0,
        stall: false,
      },
      true,
    );
  }
  controls.update();
  renderer.render(scene, camera);
});
window.addEventListener(
  "pagehide",
  () => {
    renderer.setAnimationLoop(null);
    aircraft.dispose();
    controls.dispose();
    environment.dispose();
    renderer.dispose();
  },
  { once: true },
);
