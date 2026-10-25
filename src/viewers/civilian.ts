import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import "./civilian.css";
import { Actuator, controlCheck } from "../aircraft/aurelia/aurelia-motion";
const renderer = new T.WebGLRenderer({
  antialias: true,
  preserveDrawingBuffer: true,
});
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
document.querySelector("#aircraft-view")!.appendChild(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#e8ece8");
scene.fog = new T.Fog("#e8ece8", 100, 250);
const pmrem = new T.PMREMGenerator(renderer),
  room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
pmrem.dispose();
room.dispose();
scene.environmentIntensity = 0.65;
scene.add(new T.HemisphereLight("#f3f7f3", "#9faea6", 1));
for (const [p, intensity, color] of [
  [[18, 30, -18], 2.6, "#fff3e1"],
  [[-22, 15, 0], 1.7, "#d9ecf2"],
  [[5, 24, 24], 3, "#fff9ed"],
] as const) {
  const l = new T.DirectionalLight(color, intensity);
  l.position.fromArray(p);
  scene.add(l);
  if (p[0] === 18) {
    l.castShadow = true;
    l.shadow.mapSize.set(2048, 2048);
    Object.assign(l.shadow.camera, {
      left: -25,
      right: 25,
      top: 25,
      bottom: -25,
      near: 0.5,
      far: 95,
    });
    l.shadow.normalBias = 0.035;
    l.shadow.bias = -0.0001;
  }
}
const floor = new T.Mesh(
  new T.PlaneGeometry(500, 500),
  new T.MeshStandardMaterial({ color: "#c3ceca", roughness: 0.85 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.025;
floor.receiveShadow = true;
scene.add(floor);
const camera = new T.PerspectiveCamera(36, innerWidth / innerHeight, 0.05, 400);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.09;
orbit.minDistance = 2;
orbit.maxDistance = 160;
orbit.maxPolarAngle = Math.PI * 0.515;
orbit.autoRotateSpeed = 0.6;
const views = {
  beauty: { p: [36, 23, -44], t: [0, 3.8, 0] },
  front: { p: [0, 8, -58], t: [0, 4, 0] },
  back: { p: [0, 8, 58], t: [0, 4, 0] },
  left: { p: [-58, 8, 0], t: [0, 4, 0] },
  right: { p: [58, 8, 0], t: [0, 4, 0] },
  top: { p: [0, 67, 0.1], t: [0, 0, 0] },
  cockpit: { p: [9, 9, -19], t: [0, 4.6, -10.6] },
  engine: { p: [12, 8, -3], t: [3.26, 4.25, 6.0] },
};
type View = keyof typeof views;
let current: View = "beauty",
  model: T.Group | undefined;
let cameraMove: { position: T.Vector3; target: T.Vector3 } | undefined;
let initialized = false;
function showView(view: View) {
  current = view;
  const v = views[view],
    target = new T.Vector3().fromArray(v.t),
    pos = new T.Vector3().fromArray(v.p);
  const detail = view === "cockpit" || view === "engine";
  if (innerWidth < 700 && !detail)
    pos.sub(target).multiplyScalar(2.0).add(target);
  if (!initialized || matchMedia("(prefers-reduced-motion: reduce)").matches) {
    camera.position.copy(pos); orbit.target.copy(target); orbit.update(); initialized = true;
  } else cameraMove = { position: pos, target };
  document.body.classList.toggle("detail", detail);
  document
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === view)),
    );
}
document
  .querySelectorAll<HTMLButtonElement>("[data-view]")
  .forEach((b) => (b.onclick = () => showView(b.dataset.view as View)));
document.querySelector<HTMLButtonElement>("#orbit")!.onclick = () => {
  orbit.autoRotate = !orbit.autoRotate;
  document
    .querySelector("#orbit")!
    .setAttribute("aria-pressed", String(orbit.autoRotate));
};
const actuator = new Actuator(), flapActuator = new Actuator(), engine = new Actuator();
let controlTarget = 0, demo = false, demoTime = 0, engineOn = false;
const surfaceInput = document.querySelector<HTMLInputElement>("#surfaces")!;
surfaceInput.oninput = () => {
  demo = false; updateDemoButton(); controlTarget = Number(surfaceInput.value) / 100;
};
function updateDemoButton() {
  document.querySelector("#motion-demo")!.setAttribute("aria-pressed", String(demo));
  document.querySelector("#motion-demo")!.textContent = demo ? "Pause control check" : "▶ Smooth control check";
}
document.querySelector<HTMLButtonElement>("#motion-demo")!.onclick = () => {
  demo = !demo; updateDemoButton();
};
document.querySelector<HTMLButtonElement>("#engine-demo")!.onclick = () => {
  engineOn = !engineOn;
  document.querySelector("#engine-demo")!.setAttribute("aria-pressed", String(engineOn));
  document.querySelector("#engine-demo")!.textContent = engineOn ? "Stop fans" : "Start fans";
};
orbit.addEventListener("start", () => { cameraMove = undefined; });
document.querySelector<HTMLButtonElement>("#photo")!.onclick = () => {
  renderer.render(scene, camera);
  const a = document.createElement("a");
  a.href = renderer.domElement.toDataURL("image/png");
  a.download = `Aurelia-S32-${current}.png`;
  a.click();
};
new GLTFLoader()
  .loadAsync("/assets/aurelia-s32.glb")
  .then((gltf) => {
    model = gltf.scene;
    model.traverse((o) => {
      if (o instanceof T.Mesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (
            m instanceof T.MeshStandardMaterial &&
            m.name.startsWith("Glass")
          ) {
            m.transparent = true;
            m.opacity = 0.48;
            m.depthWrite = false;
            m.side = T.DoubleSide;
            o.castShadow = false;
            o.renderOrder = 3;
            if (m instanceof T.MeshPhysicalMaterial) m.transmission = 0;
          }
        }
      }
    });
    scene.add(model);
    document.querySelector("#loading")!.remove();
    document.body.classList.add("loaded");
    if (import.meta.env.DEV)
      Object.assign(window, {
        aurelia: { model, scene, camera, orbit, renderer, showView },
      });
  })
  .catch((e) => {
    document.querySelector("#loading")!.textContent =
      "Unable to load aircraft. Please reload.";
    console.error(e);
  });
showView("beauty");
addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  showView(current);
});
document.addEventListener("visibilitychange", () => { last = performance.now(); });
let last = performance.now();
function tick(now: number) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (now - last) / 1000);
  if (demo) { demoTime += dt; controlTarget = controlCheck(demoTime); surfaceInput.value = String(controlTarget * 100); }
  const deflection = actuator.step(controlTarget, dt);
  const flap = flapActuator.step(Math.max(0, controlTarget), dt, 3);
  for (const [name, axis, value] of [
    ["Aileron_Left", "x", deflection * .35], ["Aileron_Right", "x", -deflection * .35],
    ["Elevator_Left", "x", -deflection * .35], ["Elevator_Right", "x", -deflection * .35],
    ["Rudder", "y", deflection * .35],
    ["Flap_Left", "x", -flap * .5], ["Flap_Right", "x", -flap * .5],
  ] as const) {
    const part = model?.getObjectByName(name);
    if (part) part.rotation[axis] = value;
  }
  const fanSpeed = engine.step(engineOn ? 15 : 0, dt, 1.2);
  for (const name of ["Fan_Left", "Fan_Right"]) {
    const fan = model?.getObjectByName(name);
    if (fan) fan.rotation.z = (fan.rotation.z + fanSpeed * dt) % (Math.PI * 2);
  }
  if (cameraMove) {
    const blend = 1 - Math.exp(-5 * dt);
    camera.position.lerp(cameraMove.position, blend);
    orbit.target.lerp(cameraMove.target, blend);
    if (camera.position.distanceTo(cameraMove.position) < .005) cameraMove = undefined;
  }
  orbit.update(dt);
  last = now;
  renderer.render(scene, camera);
}
requestAnimationFrame(tick);
