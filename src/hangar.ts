import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { prepareAircraftMaterials, AIRCRAFT_URL } from "./aircraft";
import "./hangar.css";
const container = document.querySelector<HTMLDivElement>("#hangar")!;
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.92;
container.appendChild(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#eaece5");
scene.fog = new T.Fog("#eaece5", 35, 95);
const pmrem = new T.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
room.dispose();
pmrem.dispose();
const camera = new T.PerspectiveCamera(
  38,
  innerWidth / innerHeight,
  0.025,
  200,
);
camera.position.set(10, 4.7, -11.7);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0.05, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;
controls.minDistance = 0.7;
controls.maxDistance = 30;
controls.maxPolarAngle = Math.PI * 0.55;
scene.add(new T.HemisphereLight("#f4f8f2", "#a8ac9b", 0.9));
function light(p: number[], color: string, power: number) {
  const l = new T.DirectionalLight(color, power);
  l.position.fromArray(p);
  scene.add(l);
  return l;
}
const key = light([5, 9, -7], "#fff0d8", 1.7);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, {
  left: -9,
  right: 9,
  top: 9,
  bottom: -9,
  near: 0.1,
  far: 30,
});
key.shadow.normalBias = 0.018;
key.shadow.bias = -0.0001;
light([-8, 5, -1], "#cee3ec", 0.8);
light([1, 4, 9], "#fff8e4", 1.1);
const floor = new T.Mesh(
  new T.PlaneGeometry(200, 200),
  new T.MeshStandardMaterial({ color: "#c7cdbf", roughness: 0.86 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -1.382;
floor.receiveShadow = true;
scene.add(floor);
const views = {
  overview: {
    pos: [10, 4.7, -11.7],
    target: [0, 0.1, 0],
    caption:
      "A hollow CAD airframe, fitted transparent glazing, true airfoils, and independently rigged mechanical components.",
  },
  cockpit: {
    pos: [-1.6, 1.85, 2.55],
    target: [0, 0.57, -0.55],
    caption:
      "Two contoured seats, four-point harnesses, dual yokes and pedals, six analog gauges, a navigation display and throttle quadrant.",
  },
  wing: {
    pos: [7, 2.55, -2.5],
    target: [2.1, 0.04, 0.25],
    caption:
      "A rounded leading edge, tapered airfoil, thin trailing edge, individual flaps and ailerons, hinges, fuel caps and navigation lights.",
  },
  gear: {
    pos: [3.8, -0.1, -4.2],
    target: [0.55, -0.78, -0.4],
    caption:
      "Fixed tricycle gear with machined hubs, rubber tires, brake discs and calipers, torque links, hoses and independently rigged struts.",
  },
  rear: {
    pos: [-5.5, 2.9, 7.8],
    target: [0, 0.61, 2.7],
    caption:
      "A tapered tail cone and swept fin with independent rudder and elevator pivots, service seams, strobe and original registration.",
  },
};
type View = keyof typeof views;
let targetPosition = new T.Vector3().fromArray(views.overview.pos),
  targetLook = new T.Vector3().fromArray(views.overview.target),
  transition = false,
  spin = false,
  model: T.Object3D | null = null;
const originalPositions = new Map<string, T.Vector3>();
function showView(key: View) {
  document
    .querySelectorAll("[data-view]")
    .forEach((b) =>
      b.classList.toggle("selected", (b as HTMLElement).dataset.view === key),
    );
  targetPosition.fromArray(views[key].pos);
  targetLook.fromArray(views[key].target);
  if (innerWidth < 650 && key === "overview") {
    targetPosition.set(20, 11, -24);
    targetLook.set(0, 0.4, 0);
  }
  transition = true;
  document.querySelector("#caption")!.textContent = views[key].caption;
}
controls.addEventListener("start", () => (transition = false));
document
  .querySelectorAll<HTMLElement>("[data-view]")
  .forEach((button) =>
    button.addEventListener("click", () =>
      showView(button.dataset.view as View),
    ),
  );
function part(name: string) {
  return model?.getObjectByName(name);
}
function pose() {
  const t =
    Number((document.querySelector("#surfaces") as HTMLInputElement).value) /
    100;
  for (const name of ["Flap_Left", "Flap_Right"]) {
    const p = part(name);
    if (p) p.rotation.x = -t * 0.5;
  }
  const l = part("Aileron_Left"),
    r = part("Aileron_Right"),
    e = part("Elevator"),
    rud = part("Rudder");
  if (l) l.rotation.x = t * 0.32;
  if (r) r.rotation.x = -t * 0.32;
  if (e) e.rotation.x = t * 0.3;
  if (rud) rud.rotation.y = t * 0.35;
  for (const name of ["Yoke_Left", "Yoke_Right"]) {
    const p = part(name),
      base = originalPositions.get(name);
    if (p && base) {
      p.rotation.z = t * 0.35;
      p.position.copy(base);
      p.position.z += t * 0.04;
    }
  }
  const compression =
    Number((document.querySelector("#suspension") as HTMLInputElement).value) /
    100;
  for (const name of [
    "Suspension_Main_Left",
    "Suspension_Main_Right",
    "Suspension_Nose",
  ]) {
    const p = part(name),
      base = originalPositions.get(name);
    if (p && base) {
      p.position.copy(base);
      p.position.y += compression * 0.16;
      if (name !== "Suspension_Nose")
        p.position.x += (name.endsWith("Left") ? 1 : -1) * compression * 0.104;
    }
  }
  const steering = part("Front_Wheel_Steering");
  if (steering)
    steering.rotation.y = T.MathUtils.degToRad(
      Number((document.querySelector("#steering") as HTMLInputElement).value),
    );
}
document
  .querySelectorAll("input")
  .forEach((input) => input.addEventListener("input", pose));
document.querySelector("#propeller")!.addEventListener("click", () => {
  spin = !spin;
  const b = document.querySelector("#propeller")!;
  b.classList.toggle("active", spin);
  b.textContent = spin ? "Ⅱ Stop propeller" : "▷ Spin propeller";
});
document.querySelector("#reset")!.addEventListener("click", () => {
  document.querySelectorAll("input").forEach((i) => (i.value = "0"));
  pose();
  spin = false;
  document.querySelector("#propeller")!.textContent = "▷ Spin propeller";
  document.querySelector("#propeller")!.classList.remove("active");
  showView("overview");
});
const gltf = await new GLTFLoader().loadAsync(AIRCRAFT_URL).catch((error) => {
  document.querySelector("#loading p")!.textContent =
    `Unable to load aircraft: ${error.message}`;
  throw error;
});
model = gltf.scene;
prepareAircraftMaterials(model);
scene.add(model);
model.updateMatrixWorld(true);
for (const name of [
  "Yoke_Left",
  "Yoke_Right",
  "Suspension_Main_Left",
  "Suspension_Main_Right",
  "Suspension_Nose",
]) {
  const p = part(name);
  if (p) originalPositions.set(name, p.position.clone());
}
let triangles = 0,
  meshes = 0;
model.traverse((o) => {
  if (o instanceof T.Mesh) {
    meshes++;
    triangles +=
      (o.geometry.index?.count ?? o.geometry.attributes.position.count) / 3;
  }
});
document.querySelector("#stats")!.textContent =
  `${Math.round(triangles / 1000)}K TRIANGLES · ${meshes} MESHES · METRE SCALE`;
document.querySelector("#loading")!.remove();
if (innerWidth < 650) showView("overview");
let last = performance.now();
function frame(now: number) {
  requestAnimationFrame(frame);
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;
  if (transition) {
    camera.position.lerp(targetPosition, 1 - Math.exp(-dt * 5));
    controls.target.lerp(targetLook, 1 - Math.exp(-dt * 5));
    if (camera.position.distanceTo(targetPosition) < 0.005) transition = false;
  }
  if (spin) {
    const p = part("Propeller");
    if (p) p.rotation.z += dt * 8;
  }
  controls.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
window.addEventListener("resize", () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});
if (import.meta.env.DEV)
  (window as unknown as { finchStudy: unknown }).finchStudy = {
    model,
    camera,
    controls,
    renderer,
    triangles,
    meshes,
    showView,
    pose,
  };
