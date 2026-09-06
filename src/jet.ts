import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import "./jet.css";
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.querySelector("#jet-view")!.appendChild(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#e4e7e4");
scene.fog = new T.Fog("#e4e7e4", 90, 200);
const pmrem = new T.PMREMGenerator(renderer),
  room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
pmrem.dispose();
room.dispose();
const camera = new T.PerspectiveCamera(36, innerWidth / innerHeight, 0.08, 300);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.085;
orbit.minDistance = 2;
orbit.maxDistance = 90;
orbit.maxPolarAngle = Math.PI * 0.51;
scene.add(new T.HemisphereLight("#e9f4f5", "#a6afa1", 1.4));
function light(pos: number[], color: string, intensity: number) {
  const light = new T.DirectionalLight(color, intensity);
  light.position.fromArray(pos);
  scene.add(light);
  return light;
}
const key = light([15, 30, -15], "#fff2db", 2.5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, {
  left: -20,
  right: 20,
  top: 20,
  bottom: -20,
  near: 0.5,
  far: 90,
});
key.shadow.normalBias = 0.035;
key.shadow.bias = -0.0001;
light([-20, 12, -5], "#d4eaf5", 1.3);
light([5, 20, 25], "#ffffff", 2);
const floor = new T.Mesh(
  new T.PlaneGeometry(400, 400),
  new T.MeshStandardMaterial({ color: "#cdd3cd", roughness: 0.92 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.018;
floor.receiveShadow = true;
scene.add(floor);
const views = {
  beauty: {
    position: [28, 20, -37],
    target: [0, 3.1, 0],
    caption:
      "A sharp forward profile meets a full-bodied airframe. Built around speed, volume, and mechanical presence.",
  },
  side: {
    position: [43, 8, 1],
    target: [0, 3, 0],
    caption:
      "The pointed radome and raised canopy flow into a deep, broad fuselage with transport-inspired structural mass.",
  },
  front: {
    position: [0, 8, -43],
    target: [0, 3.4, 0],
    caption:
      "An integrated chin intake, wide shoulders, and a swept wing carry the fighter-inspired nose into the heavier airframe.",
  },
  rear: {
    position: [25, 15, 37],
    target: [0, 3.4, 4],
    caption:
      "Integrated twin engines, deep exhaust liners, metallic nozzle petals, and a substantial swept tail.",
  },
  top: {
    position: [0, 53, 0.1],
    target: [0, 0, 0],
    caption:
      "Long leading-edge extensions blend the broad centre body into swept airfoil wings with separate trailing-edge controls.",
  },
  cockpit: {
    position: [6, 8, -16],
    target: [0, 4.7, -8.6],
    caption:
      "Two tandem seats, restraint harnesses, flight controls, side consoles, multi-function displays, and a transparent canopy.",
  },
};
type View = keyof typeof views;
let selected: View = "beauty",
  transition = false,
  model: T.Group | null = null;
const goal = new T.Vector3(),
  target = new T.Vector3();
function showView(view: View, immediate = false) {
  selected = view;
  const v = views[view];
  goal.fromArray(v.position);
  target.fromArray(v.target);
  if (innerWidth < 650 && view !== "cockpit")
    goal.sub(target).multiplyScalar(1.85).add(target);
  immediate ||= matchMedia("(prefers-reduced-motion: reduce)").matches;
  transition = !immediate;
  if (immediate) {
    camera.position.copy(goal);
    orbit.target.copy(target);
  }
  document.querySelector("#view-caption")!.textContent = v.caption;
  document
    .querySelectorAll<HTMLElement>("[data-view]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === view)),
    );
}
showView("beauty", true);
orbit.update();
orbit.addEventListener("start", () => (transition = false));
document
  .querySelectorAll<HTMLElement>("[data-view]")
  .forEach((b) =>
    b.addEventListener("click", () => showView(b.dataset.view as View)),
  );
const gear = document.querySelector<HTMLInputElement>("#gear")!,
  canopy = document.querySelector<HTMLInputElement>("#canopy")!,
  surfaces = document.querySelector<HTMLInputElement>("#surfaces")!;
function pose() {
  if (!model) return;
  const t = Number(surfaces.value) / 100;
  const set = (name: string, axis: "x" | "y", angle: number) => {
    const o = model!.getObjectByName(name);
    if (o) o.rotation[axis] = angle;
  };
  set("Aileron_Left", "x", t * 0.38);
  set("Aileron_Right", "x", -t * 0.38);
  for (const side of ["Left", "Right"]) {
    set("Elevator_" + side, "x", -t * 0.4);
    set("Flap_" + side, "x", Math.abs(t) * 0.45);
  }
  set("Rudder", "y", t * 0.42);
  const landing = model.getObjectByName("LandingGear");
  if (landing) landing.visible = gear.checked;
  model.getObjectByName("Canopy")?.traverse((o) => {
    if (o instanceof T.Mesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      if (mats.some((m) => m.name.startsWith("Glass")))
        o.visible = canopy.checked;
    }
  });
}
for (const input of [gear, canopy, surfaces])
  input.addEventListener("input", pose);
document.querySelector("#reset")!.addEventListener("click", () => {
  gear.checked = canopy.checked = true;
  surfaces.value = "0";
  pose();
  showView("beauty");
});
new GLTFLoader().load(
  "/assets/peregrine-hx27.glb",
  (gltf) => {
    model = gltf.scene;
    model.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      o.castShadow = o.receiveShadow = true;
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        if (m instanceof T.MeshStandardMaterial) {
          m.envMapIntensity = 0.8;
          if (m.name.startsWith("Glass")) {
            m.transparent = true;
            m.opacity = 0.22;
            m.depthWrite = false;
            m.side = T.DoubleSide;
            o.castShadow = false;
            o.renderOrder = 3;
            if (m instanceof T.MeshPhysicalMaterial) m.transmission = 0;
          }
        }
    });
    scene.add(model);
    document.body.classList.add("loaded");
    pose();
    if (import.meta.env.DEV)
      (window as unknown as { jet: unknown }).jet = {
        scene,
        model,
        renderer,
        camera,
        orbit,
        showView,
      };
  },
  undefined,
  (error) => {
    document.querySelector("#loading")!.textContent =
      "The aircraft could not load. Please refresh to try again.";
    console.error(error);
  },
);
let last = 0;
function render(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  if (transition) {
    const blend = 1 - Math.exp(-dt * 5);
    camera.position.lerp(goal, blend);
    orbit.target.lerp(target, blend);
    if (camera.position.distanceTo(goal) < 0.025) transition = false;
  }
  orbit.update();
  renderer.render(scene, camera);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  showView(selected, true);
});
