import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  neutralExteriorPose,
  poseAureliaExterior,
  type ExteriorPose,
} from "../aircraft/aurelia/exterior-mechanisms";
import "./aurelia-reference.css";
import { aureliaAirframeScale } from "../aircraft/aurelia/exterior-reference";
import {
  aureliaCockpitLayout,
  aureliaPilotEye,
} from "../aircraft/aurelia/cockpit-layout";
import { AureliaAvionics } from "../aircraft/aurelia/avionics";
import { aureliaAvionicsDemo } from "../aircraft/aurelia/avionics-demo";
import { createAureliaRenderLoop } from "./aurelia-render-loop";
import { aureliaCockpitPartition } from "../aircraft/aurelia/cockpit-partition";
import {
  aureliaInspectionSheets,
  exportInspectionSheet,
} from "./aurelia-inspection";

const viewport = document.querySelector<HTMLElement>("#viewport")!;
const status = document.querySelector<HTMLElement>("#status")!;
const scalePercent = Number((aureliaAirframeScale * 100).toFixed(1));
document.querySelector("#airframe-label")!.textContent =
  `Phenom-based · ${scalePercent}% airframe`;
document.querySelector("#airframe-scale-note")!.textContent =
  `Airframe at ${scalePercent}% of the original reference.`;
const renderer = new T.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.toneMapping = T.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = T.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
viewport.append(renderer.domElement);
const scene = new T.Scene();
scene.background = new T.Color("#e7ecec");
const environment = new T.PMREMGenerator(renderer),
  room = new RoomEnvironment();
scene.environment = environment.fromScene(room, 0.04).texture;
environment.dispose();
room.dispose();
scene.environmentIntensity = 0.8;
scene.add(new T.HemisphereLight("#ffffff", "#8193a0", 1));
const light = new T.DirectionalLight("#fff6e9", 2);
light.position.set(-9, 18, -12);
light.castShadow = true;
light.shadow.mapSize.set(2048, 2048);
Object.assign(light.shadow.camera, {
  left: -12,
  right: 12,
  top: 12,
  bottom: -12,
  near: 0.1,
  far: 70,
});
light.shadow.normalBias = 0.015;
scene.add(light);
const floor = new T.Mesh(
  new T.PlaneGeometry(200, 200),
  new T.MeshStandardMaterial({ color: "#cdd7d7", roughness: 0.85 }),
);
floor.rotation.x = -Math.PI / 2;
floor.position.y = -0.012;
floor.receiveShadow = true;
scene.add(floor);
const camera = new T.PerspectiveCamera(36, 1, 0.02, 250),
  orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.minDistance = 1;
orbit.maxDistance = 65;
const flightDeck = aureliaCockpitLayout(aureliaAirframeScale);
const pilotEye = aureliaPilotEye(aureliaAirframeScale, -1);
const copilotEye = aureliaPilotEye(aureliaAirframeScale, 1);
const views = {
  beauty: [
    [15, 8, -18],
    [0, 2, 0],
  ],
  side: [
    [-24, 3, 0],
    [0, 2.4, 0],
  ],
  front: [
    [0, 3, -27],
    [0, 2.3, 0],
  ],
  nose: [
    [0, 3.6, -9],
    [0, 2.15, -6.1],
  ],
  top: [
    [0, 29, 0.01],
    [0, 0, 0],
  ],
  rear: [
    [14, 6, 20],
    [0, 2.5, 2],
  ],
  belly: [
    [-6, -3, 6],
    [0, 1.1, 0.82],
  ],
  entry: [
    [-4, 2.2, -4.3],
    [-0.7, 2.05, -3.82],
  ],
  cabin: [
    [-8, 6, -8],
    [0, 1.9, -0.8],
  ],
  cockpit: [
    [0, pilotEye[1] + 0.08, flightDeck.seatZ + 0.34],
    [0, 2.02, flightDeck.panelZ],
  ],
  partition: [
    [0, 2.15, -3.42],
    [0, 2.1, aureliaCockpitPartition.z],
  ],
  pilot: [pilotEye, [pilotEye[0], pilotEye[1] - 0.12, pilotEye[2] - 1]],
  copilot: [
    copilotEye,
    [copilotEye[0], copilotEye[1] - 0.12, copilotEye[2] - 1],
  ],
} satisfies Record<string, number[][]>;
type View = keyof typeof views;
let currentView: View = "beauty";
function projection() {
  camera.aspect = viewport.clientWidth / viewport.clientHeight;
  const cockpitFit = Math.max(1, 1.5 / camera.aspect);
  camera.fov = ["cockpit", "pilot", "copilot", "partition"].includes(
    currentView,
  )
    ? T.MathUtils.radToDeg(
        2 * Math.atan(Math.tan(T.MathUtils.degToRad(29)) * cockpitFit),
      )
    : 36;
  camera.updateProjectionMatrix();
}
function view(name: View) {
  currentView = name;
  orbit.minDistance = ["cockpit", "pilot", "copilot", "partition"].includes(
    name,
  )
    ? 0.12
    : 1;
  projection();
  camera.position
    .fromArray(views[name][0])
    .multiplyScalar(aureliaAirframeScale);
  orbit.target.fromArray(views[name][1]).multiplyScalar(aureliaAirframeScale);
  if (
    model &&
    ["beauty", "side", "front", "top", "rear", "cabin"].includes(name)
  ) {
    const subject =
      name === "cabin" ? model.getObjectByName("Interior")! : model;
    model.updateMatrixWorld(true);
    const back = camera.position.clone().sub(orbit.target).normalize();
    const right = new T.Vector3().crossVectors(camera.up, back).normalize();
    const up = new T.Vector3().crossVectors(back, right);
    const tangent = Math.tan(T.MathUtils.degToRad(camera.fov / 2));
    const aspect = viewport.clientWidth / viewport.clientHeight;
    let distance = camera.position.distanceTo(orbit.target);
    const offset = new T.Vector3();
    subject.traverse((object) => {
      if (!(object instanceof T.Mesh)) return;
      const positions = object.geometry.getAttribute("position");
      for (let i = 0; i < positions.count; i++) {
        offset
          .fromBufferAttribute(positions, i)
          .applyMatrix4(object.matrixWorld)
          .sub(orbit.target);
        distance = Math.max(
          distance,
          1.06 *
            (Math.max(
              Math.abs(offset.dot(right)) / (tangent * aspect),
              Math.abs(offset.dot(up)) / tangent,
            ) +
              offset.dot(back)),
        );
      }
    });
    camera.position.copy(orbit.target).addScaledVector(back, distance);
  } else if (
    viewport.clientWidth < 600 &&
    name !== "cabin" &&
    name !== "cockpit"
  ) {
    camera.position.sub(orbit.target).multiplyScalar(1.45).add(orbit.target);
  }
  floor.visible = name !== "belly";
  orbit.update();
  renderLoop.invalidate();
  document
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === name)),
    );
}
document
  .querySelectorAll<HTMLButtonElement>("[data-view]")
  .forEach((b) => (b.onclick = () => view(b.dataset.view as View)));
let model: T.Group | undefined,
  cycling = false,
  fans = false,
  cutaway = false,
  elapsed = 0;
let avionics: AureliaAvionics | undefined;
let previous = performance.now(),
  poseDirty = true;
const renderStats = { poseUpdates: 0, shadowUpdates: 0 };
const renderLoop = createAureliaRenderLoop(render);
orbit.addEventListener("change", renderLoop.invalidate);
function changedPose() {
  poseDirty = true;
  renderLoop.invalidate();
}
const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
let avionicsRunning = !reducedMotion.matches,
  avionicsTime = 0;
const avionicsButton = document.querySelector<HTMLButtonElement>("#avionics")!;
function avionicsControl() {
  avionicsButton.textContent = avionicsRunning
    ? "Pause displays"
    : "Animate displays";
  avionicsButton.setAttribute("aria-pressed", String(avionicsRunning));
  document.querySelector("#avionics-state")!.textContent =
    `Avionics demo · ${avionicsRunning ? "animated" : "paused"} · sample flight data`;
}
avionicsButton.onclick = () => {
  avionicsRunning = !avionicsRunning;
  previous = performance.now();
  avionicsControl();
  renderLoop.invalidate();
};
reducedMotion.addEventListener("change", () => {
  if (reducedMotion.matches) {
    avionicsRunning = false;
    avionicsControl();
    renderLoop.invalidate();
  }
});
avionicsControl();
let pose = neutralExteriorPose();
const inputs = [
  "gear",
  "flaps",
  "roll",
  "pitch",
  "yaw",
  "steering",
  "entry",
  "cockpitDoor",
] as const;
function sync() {
  for (const key of inputs) {
    const input = document.querySelector<HTMLInputElement>(`#${key}`)!;
    input.value = String(Math.round(pose[key] * 100));
    document.querySelector<HTMLOutputElement>(`output[for=${key}]`)!.value =
      `${input.value}%`;
  }
}
for (const key of inputs)
  document.querySelector<HTMLInputElement>(`#${key}`)!.oninput = (e) => {
    pose[key] = Number((e.target as HTMLInputElement).value) / 100;
    if (key === "gear") {
      cycling = false;
      document.querySelector("#cycle")!.setAttribute("aria-pressed", "false");
    }
    sync();
    changedPose();
  };
function toggle(id: string, value: boolean) {
  document.querySelector(`#${id}`)!.setAttribute("aria-pressed", String(value));
}
document.querySelector<HTMLButtonElement>("#cycle")!.onclick = () => {
  cycling = !cycling;
  elapsed = 0;
  avionicsTime = 0;
  avionicsRunning = !reducedMotion.matches;
  avionicsControl();
  avionics?.update(aureliaAvionicsDemo(avionicsTime, pose), true);
  toggle("cycle", cycling);
  previous = performance.now();
  renderLoop.invalidate();
};
document.querySelector<HTMLButtonElement>("#fans")!.onclick = () => {
  fans = !fans;
  toggle("fans", fans);
  previous = performance.now();
  renderLoop.invalidate();
};
function shellVisibility() {
  if (!model) return;
  model.getObjectByName("Cabin_liner_Left")!.visible = !cutaway;
  model.getObjectByName("Passenger_entry_hinge")!.visible = !cutaway;
  model.traverse((o) => {
    if (
      o instanceof T.Mesh &&
      /Pressure_shell|window|Windshield|surround|seal|Paint_sweep|hatch|Passenger_entry|Radome/i.test(
        o.name,
      )
    )
      o.visible = !cutaway;
  });
  renderer.shadowMap.needsUpdate = true;
  renderLoop.invalidate();
}
document.querySelector<HTMLButtonElement>("#cutaway")!.onclick = () => {
  cutaway = !cutaway;
  toggle("cutaway", cutaway);
  shellVisibility();
};
document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => {
  pose = neutralExteriorPose();
  cycling = fans = cutaway = false;
  elapsed = 0;
  for (const id of ["cycle", "fans", "cutaway"]) toggle(id, false);
  sync();
  shellVisibility();
  view("beauty");
  changedPose();
};
document.querySelector<HTMLButtonElement>("#save-view")!.onclick = () => {
  render(performance.now());
  renderer.domElement.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download = `aurelia-phenom-${currentView}.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
};
// Repeatable visual coverage, using the exact asset already loaded in this tab.
const inspection = document.createElement("details");
const summary = document.createElement("summary");
summary.textContent = "Verification sheets";
inspection.append(summary);
const sheetButtons: HTMLButtonElement[] = [];
for (const sheet of aureliaInspectionSheets) {
  const button = document.createElement("button");
  button.textContent = sheet.title;
  button.onclick = async () => {
    if (!model) return;
    const savedPose = { ...pose },
      savedCutaway = cutaway,
      savedFloor = floor.visible;
    cycling = fans = false;
    toggle("cycle", false);
    toggle("fans", false);
    renderLoop.suspend();
    sheetButtons.forEach((b) => (b.disabled = true));
    status.textContent = `Rendering ${sheet.shots.length} inspection shots…`;
    floor.visible = false;
    try {
      await exportInspectionSheet(
        sheet,
        renderer,
        scene,
        model,
        (value) => {
          cutaway = value;
          shellVisibility();
        },
        (shotPose) =>
          avionics?.update(aureliaAvionicsDemo(avionicsTime, shotPose), true),
      );
      status.textContent = `Saved ${sheet.shots.length} shots · ${sheet.title}`;
    } catch (error) {
      status.textContent = "Inspection export failed";
      console.error(error);
    } finally {
      pose = savedPose;
      cutaway = savedCutaway;
      floor.visible = savedFloor;
      shellVisibility();
      poseAureliaExterior(model, pose);
      poseDirty = false;
      renderer.shadowMap.needsUpdate = true;
      avionics?.update(aureliaAvionicsDemo(avionicsTime, pose), true);
      sync();
      sheetButtons.forEach((b) => (b.disabled = false));
      previous = performance.now();
      renderLoop.resume();
    }
  };
  sheetButtons.push(button);
  inspection.append(button);
}
document.querySelector("aside")!.append(inspection);
const resizeObserver = new ResizeObserver(() => {
  renderer.setSize(viewport.clientWidth, viewport.clientHeight);
  projection();
  renderLoop.invalidate();
});
resizeObserver.observe(viewport);
view("beauty");
new GLTFLoader().load(
  "/assets/aurelia-phenom300e.glb",
  (gltf) => {
    model = gltf.scene;
    scene.add(model);
    model.traverse((o) => {
      if (!(o instanceof T.Mesh)) return;
      o.castShadow = o.receiveShadow = true;
      for (const material of Array.isArray(o.material)
        ? o.material
        : [o.material])
        if (material.transparent) {
          material.depthWrite = false;
          o.castShadow = false;
          o.renderOrder = 3;
        }
    });
    poseAureliaExterior(model, pose);
    poseDirty = false;
    renderer.shadowMap.needsUpdate = true;
    avionics = new AureliaAvionics(
      model,
      aureliaAvionicsDemo(avionicsTime, pose),
    );
    const dimensions = new T.Box3()
      .setFromObject(model)
      .getSize(new T.Vector3());
    document.querySelector("#airframe-dimensions")!.textContent =
      `${dimensions.z.toFixed(2)} m length · ${dimensions.x.toFixed(2)} m span · ${dimensions.y.toFixed(2)} m height`;
    view(currentView);
    status.textContent = "Ready · drag to orbit";
  },
  undefined,
  (error) => {
    status.textContent = "Aircraft failed to load";
    console.error(error);
  },
);
function render(now: number) {
  const dt = Math.max(0, Math.min((now - previous) / 1000, 1));
  previous = now;
  if (cycling) {
    elapsed += dt;
    pose.gear = (1 + Math.cos((elapsed * Math.PI) / 6)) / 2;
    sync();
    poseDirty = true;
  }
  if (fans) {
    pose.fan = (pose.fan + dt * 24) % (Math.PI * 2);
    poseDirty = true;
  }
  if (avionicsRunning) avionicsTime += dt;
  const focused = ["cockpit", "pilot", "copilot", "cabin"].includes(
    currentView,
  );
  if (avionicsRunning || poseDirty)
    avionics?.update(aureliaAvionicsDemo(avionicsTime, pose), false, focused);
  if (model && poseDirty) {
    poseAureliaExterior(model, pose);
    renderStats.poseUpdates++;
    renderer.shadowMap.needsUpdate = true;
    poseDirty = false;
  }
  orbit.update();
  if (renderer.shadowMap.needsUpdate) renderStats.shadowUpdates++;
  renderer.render(scene, camera);
  const cadence =
    cycling || fans ? 1000 / 30 : avionicsRunning ? (focused ? 50 : 500) : null;
  return cadence === null
    ? null
    : Math.max(0, cadence - (performance.now() - now));
}
renderLoop.setVisible(!document.hidden);
document.addEventListener("visibilitychange", () => {
  previous = performance.now();
  renderLoop.setVisible(!document.hidden);
});
window.addEventListener("pageshow", () => {
  previous = performance.now();
  renderLoop.setVisible(!document.hidden);
});
window.addEventListener("pagehide", (event) => {
  if (event.persisted) {
    renderLoop.setVisible(false);
    return;
  }
  renderLoop.dispose();
  resizeObserver.disconnect();
  orbit.dispose();
  avionics?.dispose();
  const geometries = new Set<T.BufferGeometry>(),
    materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  scene.traverse((object) => {
    if (!(object instanceof T.Mesh)) return;
    geometries.add(object.geometry);
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      materials.add(material);
      for (const value of Object.values(material))
        if (value instanceof T.Texture) textures.add(value);
    }
  });
  geometries.forEach((item) => item.dispose());
  materials.forEach((item) => item.dispose());
  textures.forEach((item) => item.dispose());
  scene.environment?.dispose();
  light.shadow.dispose();
  scene.clear();
  model = undefined;
  renderer.dispose();
  renderer.forceContextLoss();
});
// A read-only development snapshot supports reproducible visual/mechanism checks.
if (import.meta.env.DEV)
  Object.assign(window, {
    aureliaReview: {
      snapshot: () => ({
        loaded: Boolean(model),
        view: currentView,
        pose: { ...pose } as ExteriorPose,
        cutaway,
        rendering: {
          frames: renderer.info.render.frame,
          drawCalls: renderer.info.render.calls,
          triangles: renderer.info.render.triangles,
          ...renderer.info.memory,
          ...renderStats,
        },
        cockpitLayout: flightDeck,
        camera: {
          position: camera.position.toArray(),
          target: orbit.target.toArray(),
        },
        avionics: {
          running: avionicsRunning,
          time: avionicsTime,
          ...avionics?.snapshot(),
        },
        dimensions: model
          ? new T.Box3().setFromObject(model).getSize(new T.Vector3()).toArray()
          : null,
      }),
    },
  });
