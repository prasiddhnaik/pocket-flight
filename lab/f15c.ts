import "./f15c.css";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { F15CEffects } from "../src/aircraft/f15c/effects";
import { nozzleAperture } from "../src/aircraft/f15c/powerplant-rig";
import { initialJetInput } from "../src/aircraft/jet-effects";
import { CannonEffects } from "../src/flight/cannon-effects";
import { projectileGeometry } from "../src/flight/projectile-visuals";

// Main development server serves this page under /lab; the lab build copies
// its public directory beside f15c.html.
const publishedRoot = new URL(location.pathname.includes("/lab/") ? "./public/f15c/" : "./f15c/", location.href).href;
type Stage = { id: string; label: string; asset: string; checks: string; mechanisms?: boolean };
type Check = { name: string; pass: boolean; gapMm?: number; toleranceMm?: number; relativeError?: number };
type Report = { sha256: string; passed: number; failed: number; dimensionsM: number[]; checks: Check[] };
const stageSelect = document.querySelector<HTMLSelectElement>("#stage")!;
const wingLink = document.querySelector<HTMLAnchorElement>("#wing-lab")!;
wingLink.href = `${publishedRoot}wing-lab.json`;
const host = document.querySelector<HTMLDivElement>("#viewport")!;
const status = document.querySelector<HTMLParagraphElement>("#load-status")!;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#edf1f3");
const camera = new THREE.PerspectiveCamera(35, 1, .01, 1000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
host.append(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
let renderNeeded = true;
controls.addEventListener("change", () => { renderNeeded = true; });
scene.add(new THREE.HemisphereLight("#eef7ff", "#66737c", 1.1));
for (const [x, y, z, intensity] of [[8, 15, -6, 2], [-10, 6, 12, .8], [0, -12, 2, .65]]) {
  const light = new THREE.DirectionalLight(0xffffff, intensity);
  light.position.set(x, y, z);
  scene.add(light);
}
const grid = new THREE.GridHelper(30, 30, "#c1ccd3", "#dbe2e6");
grid.position.y = -.1;
scene.add(grid);
const target = new THREE.Vector3();
const directions: Record<string, THREE.Vector3> = {
  iso: new THREE.Vector3(1, .65, -1), side: new THREE.Vector3(1, 0, 0), left: new THREE.Vector3(-1, 0, 0),
  top: new THREE.Vector3(0, 1, .001), front: new THREE.Vector3(0, .05, -1),
  rear: new THREE.Vector3(0, .05, 1), bottom: new THREE.Vector3(0, -1, .001),
};
let radius = 12;
let modelBounds = new THREE.Box3();
let activeView = "iso";
const specimen = new THREE.Mesh(projectileGeometry(), new THREE.MeshStandardMaterial({ color: "#a58e68", metalness: .75, roughness: .32 }));
specimen.visible = false;
scene.add(specimen);
function view(name: string) {
  activeView = name;
  specimen.visible = name === "projectile";
  if (model) model.visible = !specimen.visible;
  grid.visible = !specimen.visible && name !== "bottom";
  if (specimen.visible) {
    camera.position.set(.09, .035, .12); camera.up.set(0, 1, 0);
    controls.target.set(0, 0, 0); controls.update(); renderNeeded = true;
    return;
  }
  if (name === "exhaust") {
    camera.position.set(4.6, 1.3, 15.4); camera.up.set(0, 1, 0);
    controls.target.set(0, -.125, 10.4); controls.update(); renderNeeded = true;
    return;
  }
  if (name === "nozzle") {
    camera.position.set(2.7, .75, 11.15); camera.up.set(0, 1, 0);
    controls.target.set(1.025, -.125, 8.95); controls.update(); renderNeeded = true;
    return;
  }
  if (name === "gun") {
    const port = model?.getObjectByName("Gun_port_fairing");
    if (!port) return;
    const bounds = new THREE.Box3().setFromObject(port);
    const liner = model?.getObjectByName("Gun_recess_liner") ?? port;
    const center = new THREE.Box3().setFromObject(liner).getCenter(new THREE.Vector3());
    center.z = bounds.min.z;
    camera.position.copy(center).add(new THREE.Vector3(.45, .18, -.85));
    camera.up.set(0, 1, 0);
    controls.target.copy(center);
    controls.update();
    return;
  }
  const direction = directions[name] ?? directions.iso;
  const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
  const axis = direction.clone().normalize(), right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), axis).normalize();
  const up = new THREE.Vector3().crossVectors(axis, right);
  let distance = radius;
  for (const x of [modelBounds.min.x, modelBounds.max.x]) for (const y of [modelBounds.min.y, modelBounds.max.y]) for (const z of [modelBounds.min.z, modelBounds.max.z]) {
    const corner = new THREE.Vector3(x, y, z).sub(target);
    distance = Math.max(distance, corner.dot(axis) + Math.abs(corner.dot(up)) / Math.tan(halfFov), corner.dot(axis) + Math.abs(corner.dot(right)) / (Math.tan(halfFov) * camera.aspect));
  }
  camera.position.copy(target).addScaledVector(axis, distance * 1.12);
  camera.up.set(0, 1, 0);
  controls.target.copy(target);
  controls.update();
}
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
  button.addEventListener("click", () => view(button.dataset.view!));
}
const resize = new ResizeObserver(() => {
  camera.aspect = host.clientWidth / host.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(host.clientWidth, host.clientHeight);
  renderNeeded = true;
});
resize.observe(host);
let model: THREE.Group | undefined;
let loadVersion = 0;
let effects: F15CEffects | undefined;
let firing = false;
let burstRemaining = 0;
const burstButton = document.querySelector<HTMLButtonElement>("#test-burst")!;
function stopFiring() { firing = false; burstRemaining = 0; burstButton.textContent = "Fire 2 s test burst"; }
burstButton.addEventListener("click", () => {
  if (paused || burstRemaining > 0) stopFiring();
  else { burstRemaining = 2; burstButton.textContent = "End test burst"; }
});
let slowMotion = false, paused = false;
for (const [id, set] of [["slow-motion", (active: boolean) => { slowMotion = active; }], ["pause-motion", (active: boolean) => { paused = active; }]] as const) {
  const button = document.querySelector<HTMLButtonElement>(`#${id}`)!;
  button.addEventListener("click", () => {
    const active = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(active)); set(active);
    stopFiring(); cannon.suspend();
  });
}
const enginePower = document.querySelector<HTMLInputElement>("#engine-power")!;
const engineStatus = document.querySelector<HTMLOutputElement>("#engine-status")!;
const cannon = new CannonEffects(host, () => grid.position.y);
scene.add(cannon.group);
const cannonState = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), velocity: new THREE.Vector3(), angularVelocity: new THREE.Vector3(), wind: new THREE.Vector3() };
const motionPose = { gear: 1, flaps: 0, roll: 0, pitch: 0, yaw: 0, canopy: 0, speedBrake: 0 };
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-motion]")) {
  button.addEventListener("click", () => {
    const key = button.dataset.motion!;
    const active = button.getAttribute("aria-pressed") !== "true";
    button.setAttribute("aria-pressed", String(active));
    if (key === "gear") motionPose.gear = active ? 0 : 1;
    if (key === "flaps") motionPose.flaps = active ? 1 : 0;
    if (key === "controls") motionPose.roll = motionPose.pitch = motionPose.yaw = active ? .7 : 0;
    if (key === "canopy") motionPose.canopy = active ? 1 : 0;
    if (key === "speedBrake") motionPose.speedBrake = active ? 1 : 0;
    if (key === "canopy" && active) enginePower.value = "0";
    if (key === "gear" && active) motionPose.canopy = 0;
    document.querySelector('[data-motion="canopy"]')!.setAttribute("aria-pressed", String(motionPose.canopy > .5));
    renderNeeded = true;
  });
}
enginePower.addEventListener("input", () => {
  if (Number(enginePower.value) > 0) {
    motionPose.canopy = 0;
    document.querySelector('[data-motion="canopy"]')!.setAttribute("aria-pressed", "false");
  }
});
const fireButton = document.querySelector<HTMLButtonElement>("#test-fire")!;
fireButton.addEventListener("pointerdown", event => { fireButton.setPointerCapture(event.pointerId); firing = true; });
for (const type of ["pointerup", "pointercancel", "lostpointercapture", "blur"]) fireButton.addEventListener(type, () => { firing = false; });
fireButton.addEventListener("keydown", event => { if (event.code === "Space" || event.code === "Enter") { event.preventDefault(); firing = true; } });
fireButton.addEventListener("keyup", event => { if (event.code === "Space" || event.code === "Enter") firing = false; });
window.addEventListener("blur", () => { stopFiring(); cannon.suspend(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) { stopFiring(); cannon.suspend(); } });
document.querySelector("#reload-cannon")!.addEventListener("click", () => { stopFiring(); cannon.reset(cannonState, false); });
function disposeModel(group: THREE.Group) {
  group.traverse(object => {
    if (!(object instanceof THREE.Mesh)) return;
    object.geometry.dispose();
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.dispose();
  });
}
async function loadStage(stage: Stage, index: number) {
  const version = ++loadVersion;
  const modelUrl = `${publishedRoot}${stage.asset}`, checksUrl = `${publishedRoot}${stage.checks}`;
  status.textContent = "Loading saved model…";
  document.querySelector("#stage-title")!.textContent = `Stage ${index + 1} · ${stage.label}`;
  const modelLink = document.querySelector<HTMLAnchorElement>("#model-download")!;
  modelLink.href = modelUrl; modelLink.download = `f15c-${stage.id}.glb`;
  const checksLink = document.querySelector<HTMLAnchorElement>("#checks-download")!;
  checksLink.href = checksUrl; checksLink.download = `f15c-${stage.id}-checks.json`;
  document.querySelector("#checks")!.replaceChildren();
  try {
    const [gltf, response] = await Promise.all([new GLTFLoader().loadAsync(modelUrl), fetch(checksUrl)]);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const report: Report = await response.json();
    if (version !== loadVersion) { disposeModel(gltf.scene); return; }
    effects?.dispose();
    if (model) { scene.remove(model); disposeModel(model); }
    model = gltf.scene;
    document.querySelector<HTMLButtonElement>('[data-view="gun"]')!.hidden = !model.getObjectByName("Gun_port_fairing");
    document.querySelector<HTMLDivElement>("#motion-tests")!.hidden = !stage.mechanisms;
    Object.assign(motionPose, { gear: 1, flaps: 0, roll: 0, pitch: 0, yaw: 0, canopy: 0, speedBrake: 0 });
    document.querySelectorAll("[data-motion]").forEach(button => button.setAttribute("aria-pressed", "false"));
    enginePower.value = "0";
    stopFiring();
    document.querySelector("#pose-note")!.textContent = stage.id === "gear" ? "CAD reference pose. The complete aircraft adds interactive gear, canopy, airbrake and control-surface poses." : "";
    const bounds = new THREE.Box3().setFromObject(model);
    const size = bounds.getSize(new THREE.Vector3());
    model.scale.multiplyScalar(Math.max(size.x, size.y, size.z) > 100 ? .001 : 1);
    bounds.setFromObject(model); bounds.getCenter(target);
    modelBounds.copy(bounds);
    radius = bounds.getSize(new THREE.Vector3()).length() / 2;
    grid.position.set(0, bounds.min.y - .05, target.z);
    effects = stage.mechanisms ? new F15CEffects(model) : undefined;
    effects?.update(0, initialJetInput());
    cannon.reset(cannonState, false);
    scene.add(model); view("iso");
    renderNeeded = true;
    status.textContent = "Saved CAD model loaded";
    document.querySelector("#dimensions")!.textContent = `Saved envelope: ${report.dimensionsM.map(n => n.toFixed(2)).join(" × ")} m (width × length × height).`;
    document.querySelector("#check-summary")!.textContent = `${report.passed} passed · ${report.failed} failed · STEP SHA-256 ${report.sha256.slice(0, 16)}…`;
    for (const check of report.checks) {
      const row = document.createElement("tr");
      const values = [check.name, check.pass ? "Pass" : "Fail", check.gapMm !== undefined
        ? `${check.gapMm.toFixed(3)} mm${check.toleranceMm === undefined ? "" : `; limit ${check.toleranceMm} mm`}`
        : check.relativeError !== undefined ? `${(check.relativeError * 100).toFixed(5)}% volume difference` : ""];
      values.forEach((value, i) => {
        const cell = document.createElement("td"); cell.textContent = value;
        if (i === 1) cell.className = check.pass ? "pass" : "fail";
        row.append(cell);
      });
      document.querySelector("#checks")!.append(row);
    }
    Object.assign(window, { f15cLab: { stage: stage.id, loaded: true, modelBounds: bounds, view } });
  } catch (error) {
    if (version === loadVersion) status.textContent = `Stage could not load: ${String(error)}`;
  }
}
try {
  const response = await fetch(`${publishedRoot}stages.json`);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const { stages }: { stages: Stage[] } = await response.json();
  for (const [index, stage] of stages.entries()) stageSelect.add(new Option(`${index + 1}. ${stage.label}`, stage.id));
  stageSelect.addEventListener("change", () => {
    const index = stages.findIndex(stage => stage.id === stageSelect.value);
    void loadStage(stages[index], index);
  });
  if (!stages.length) throw new Error("No accepted stages available");
  stageSelect.selectedIndex = stages.length - 1;
  await loadStage(stages.at(-1)!, stages.length - 1);
} catch (error) { status.textContent = `Stages unavailable: ${String(error)}`; }
let previousTime = performance.now();
renderer.setAnimationLoop(time => {
  const dt = Math.min(.05, Math.max(0, (time - previousTime) / 1000)) * (paused ? 0 : slowMotion ? .1 : 1); previousTime = time;
  controls.update();
  if (effects) {
    const throttle = Number(enginePower.value) / 100;
    if (dt > 0) {
      cannon.step(dt, cannonState, (firing || burstRemaining > 0) && activeView !== "projectile");
      if (burstRemaining > 0) {
        burstRemaining = Math.max(0, burstRemaining - dt);
        if (burstRemaining === 0) burstButton.textContent = "Fire 2 s test burst";
      }
    }
    effects.update(dt, { ...initialJetInput(), throttle, gunFiring: cannon.firing, burner: throttle > .88,
      gear: motionPose.gear > .5, canopy: motionPose.canopy > .5,
      flaps: motionPose.flaps, roll: motionPose.roll, pitch: motionPose.pitch, yaw: motionPose.yaw, speedBrake: motionPose.speedBrake });
    cannon.render(activeView !== "projectile", camera, model!, false);
    const exitDiameter = 2 * (.57 + nozzleAperture(effects.motion.rpm, effects.motion.burner).exit);
    const label = `${Math.round(effects.motion.rpm * 100)}% power · ${Math.round(effects.motion.burner * 100)}% afterburner · nozzle ${exitDiameter.toFixed(3)} m · ${cannon.simulation.ammunition} rounds · ${Math.round(effects.motion.gunSpeed * 30 / Math.PI)} gun rpm · rotor ${(effects.motion.gunAngle * 180 / Math.PI % 360).toFixed(1)}° · ${paused ? "paused" : slowMotion ? "0.1×" : "1×"}`;
    if (engineStatus.textContent !== label) engineStatus.textContent = label;
    renderNeeded = true;
  } else { cannon.render(false, camera, model ?? scene); }
  if (renderNeeded) { renderer.render(scene, camera); renderNeeded = false; }
});
window.addEventListener("pagehide", () => { renderer.setAnimationLoop(null); resize.disconnect(); controls.dispose(); effects?.dispose(); cannon.dispose(); specimen.geometry.dispose(); specimen.material.dispose(); if (model) disposeModel(model); renderer.dispose(); });
