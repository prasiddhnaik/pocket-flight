import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { makeAircraft } from "../aircraft/aircraft";
import { displayDemo } from "../aircraft/cockpit-displays";
import { initialJetInput } from "../aircraft/jet-effects";
import { STORMBIRD_CENTER } from "../aircraft/stormbird/stormbird-config";
import "./stormbird-view.css";

const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
document.querySelector("#stormbird-view")!.appendChild(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#e6e9e6");
const pmrem = new T.PMREMGenerator(renderer),
  room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room, 0.04).texture;
pmrem.dispose();
room.dispose();
scene.add(new T.HemisphereLight("#eef7ff", "#7e8984", 1.15));
const light = new T.DirectionalLight("#fff3df", 2.1);
light.position.set(15, 24, -12);
light.castShadow = true;
Object.assign(light.shadow.camera, {
  left: -14,
  right: 14,
  top: 14,
  bottom: -14,
  near: 0.5,
  far: 70,
});
light.shadow.mapSize.set(2048, 2048);
light.shadow.normalBias = 0.04;
scene.add(light);
const fill = new T.DirectionalLight("#d6eaff", 1.2);
fill.position.set(-15, 10, 20);
scene.add(fill);
const floor = new T.Mesh(
  new T.PlaneGeometry(200, 200),
  new T.MeshStandardMaterial({ color: "#cfd6d1", roughness: 0.95 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.015;
floor.receiveShadow = true;
scene.add(floor);
const camera = new T.PerspectiveCamera(37, innerWidth / innerHeight, 0.05, 250);
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.minDistance = 2;
orbit.maxDistance = 60;
orbit.maxPolarAngle = Math.PI * 0.51;
const aircraft = makeAircraft(0, "stormbird");
aircraft.group.position.y = STORMBIRD_CENTER;
scene.add(aircraft.group);
const views = {
  hero: [
    [17, 10, -21],
    [0, 2.1, 0],
  ],
  front: [
    [0, 7, -30],
    [0, 2.4, 0],
  ],
  side: [
    [31, 6, 0],
    [0, 2.3, 0],
  ],
  rear: [
    [17, 9, 25],
    [0, 2.3, 3],
  ],
  top: [
    [0, 34, 0.01],
    [0, 0, 0],
  ],
  cockpit: [
    [2.1, 4.4, -2.9],
    [0, 2.9, -4.9],
  ],
} satisfies Record<string, number[][]>;
type View = keyof typeof views;
function showView(view: View) {
  const [position, target] = views[view];
  camera.position.fromArray(position);
  orbit.target.fromArray(target);
  if (innerWidth < 700 && view !== "cockpit")
    camera.position.sub(orbit.target).multiplyScalar(1.45).add(orbit.target);
  document
    .querySelectorAll<HTMLElement>("[data-view]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === view)),
    );
  orbit.update();
}
showView("hero");
document
  .querySelectorAll<HTMLElement>("[data-view]")
  .forEach((b) => (b.onclick = () => showView(b.dataset.view as View)));
const $ = (id: string) => document.querySelector<HTMLInputElement>("#" + id)!;
const input = initialJetInput();
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
function controls() {
  input.throttle = Number($("power").value) / 100;
  input.burner = $("burner").checked;
  input.gear = $("gear").checked;
  input.canopy = $("canopy").checked;
  input.roll = Number($("surfaces").value) / 100;
  input.pitch = input.roll * 0.6;
  input.yaw = input.roll * 0.4;
  input.flaps = input.gear ? 0.15 : 0;
  input.speed = input.gear ? 0 : input.throttle * 220;
  if (reduced.matches)
    aircraft.displays?.update(
      { ...displayDemo(0, input.speed), power: input.throttle },
      true,
      true,
    );
  $("power-value").textContent = `${Math.round(input.throttle * 100)}%`;
}
for (const id of ["power", "burner", "gear", "canopy", "surfaces"])
  $(id).addEventListener("input", controls);
await aircraft.ready;
$("status").textContent = "Drag to orbit · Scroll to zoom";
if (import.meta.env.DEV)
  (window as unknown as { stormbird: unknown }).stormbird = {
    aircraft,
    scene,
    camera,
    renderer,
    orbit,
    showView,
    input,
  };
let previous = performance.now();
function frame(now: number) {
  const dt = Math.min(0.05, (now - previous) / 1000);
  previous = now;
  aircraft.effects?.setReducedMotion(reduced.matches);
  aircraft.effects?.update(dt, input);
  if (!document.hidden)
    aircraft.displays?.update(
      {
        ...displayDemo(reduced.matches ? 0 : now / 1000, input.speed),
        power: input.throttle,
      },
      camera.position.distanceTo(aircraft.group.position) < 30,
    );
  orbit.update();
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
