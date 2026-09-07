import * as T from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import "./jet.css";
import { JetEffects, initialJetInput, sequenceInput } from "./jet-effects";
import type { JetInput, JetMode } from "./jet-effects";
import { JetHeat } from "./jet-heat";
import { JetAudio } from "./jet-audio";
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
    position: [48, 8, 1],
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
  document.body.classList.toggle("detail-view", view === "cockpit");
  const v = views[view];
  goal.fromArray(v.position);
  target.fromArray(v.target);
  if (innerWidth < 650 && view !== "cockpit")
    goal
      .sub(target)
      .multiplyScalar(view === "rear" ? 2.4 : 1.85)
      .add(target);
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
let effects: JetEffects | null = null;
const heat = new JetHeat(),
  sound = new JetAudio();
const reduced = matchMedia("(prefers-reduced-motion: reduce)");
let paused = reduced.matches,
  mode: JetMode = "manual",
  sequenceTime = 0,
  input = initialJetInput(),
  touchdownTriggered = false;
const $ = (id: string) => document.querySelector<HTMLInputElement>("#" + id)!;
const panel = document.querySelector<HTMLDetailsElement>(".fx-panel")!;
panel.open = innerWidth > 800;
function framePanel() {
  camera.setViewOffset(
    innerWidth,
    innerHeight,
    innerWidth > 1000 && panel.open ? 125 : 0,
    0,
    innerWidth,
    innerHeight,
  );
}
panel.addEventListener("toggle", framePanel);
framePanel();
const gear = document.querySelector<HTMLInputElement>("#gear")!,
  canopy = document.querySelector<HTMLInputElement>("#canopy")!,
  surfaces = document.querySelector<HTMLInputElement>("#surfaces")!;
function pose() {
  if (!model) return;
  input.gear = gear.checked;
  input.roll = Number(surfaces.value) / 100;
  input.pitch = input.roll * 0.5;
  input.yaw = input.roll * 0.4;
  for (const name of ["Canopy", "Windscreen"])
    model.getObjectByName(name)?.traverse((o) => {
      if (o instanceof T.Mesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        if (mats.some((m) => m.name.startsWith("Glass")))
          o.visible = canopy.checked;
      }
    });
}
for (const input of [gear, canopy, surfaces])
  input.addEventListener("input", () => {
    mode = "manual";
    pose();
  });
document.querySelector("#reset")!.addEventListener("click", () => {
  gear.checked = canopy.checked = true;
  surfaces.value = "0";
  mode = "manual";
  input = initialJetInput();
  syncControls();
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
            m.opacity = 0.20;
            m.envMapIntensity = 1.15;
            m.depthWrite = false;
            m.side = T.FrontSide;
            o.castShadow = false;
            o.renderOrder = 3;
            if (m instanceof T.MeshPhysicalMaterial) m.transmission = 0;
          }
        }
    });
    scene.add(model);
    effects = new JetEffects(model);
    effects.setReducedMotion(reduced.matches);
    effects.update(0, input);
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
        effects,
        get state() {
          return { paused, mode, sequenceTime, input };
        },
      };
  },
  undefined,
  (error) => {
    document.querySelector("#loading")!.textContent =
      "The aircraft could not load. Please refresh to try again.";
    console.error(error);
  },
);
function manualControl() {
  mode = "manual";
  document
    .querySelectorAll<HTMLElement>("[data-sequence]")
    .forEach((b) => b.setAttribute("aria-pressed", "false"));
}
for (const id of ["power", "burner", "open-canopy", "gear", "surfaces"])
  $(id).addEventListener("pointerdown", manualControl);
function syncControls() {
  $("power").value = String(Math.round(input.throttle * 100));
  $("burner").checked = input.burner;
  gear.checked = input.gear;
  $("open-canopy").checked = input.canopy;
  $("power-value").textContent = Math.round(input.throttle * 100) + "%";
}
function setPause(value: boolean) {
  paused = value;
  $("pause").textContent = paused ? "▶ Play" : "Ⅱ Pause";
  $("pause").setAttribute("aria-pressed", String(paused));
}
setPause(paused);
reduced.addEventListener("change", () => {
  effects?.setReducedMotion(reduced.matches);
  if (reduced.matches) setPause(true);
});
function startSequence(next: JetMode) {
  if (effects) {
    effects.reset();
    if (["cruise", "afterburner", "emergency"].includes(next)) {
      effects.motion.gear = 0;
      effects.motion.rpm =
        next === "afterburner" ? 0.65 : sequenceInput(next, 0).throttle;
      effects.motion.speed = sequenceInput(next, 0).speed;
    }
    if (next === "landing") {
      effects.motion.speed = 95;
      effects.motion.rpm = 0.25;
    }
  }
  mode = next;
  sequenceTime = 0;
  touchdownTriggered = false;
  if (!reduced.matches) setPause(false);
  showView(
    next === "startup" ? "cockpit" : next === "landing" ? "side" : "rear",
  );
  document
    .querySelectorAll<HTMLElement>("[data-sequence]")
    .forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.sequence === next)),
    );
}
document
  .querySelectorAll<HTMLElement>("[data-sequence]")
  .forEach((b) =>
    b.addEventListener("click", () =>
      startSequence(b.dataset.sequence as JetMode),
    ),
  );
for (const id of ["power", "burner", "open-canopy", "lights"])
  $(id).addEventListener("input", () => {
    manualControl();
    input.throttle = Number($("power").value) / 100;
    input.burner = $("burner").checked;
    input.canopy = $("open-canopy").checked;
    input.lights = $("lights").checked;
    syncControls();
  });
$("pause").onclick = () => setPause(!paused);
$("restart").onclick = () => {
  if (mode !== "manual") startSequence(mode);
  else {
    input = initialJetInput();
    effects?.reset();
    syncControls();
  }
};
$("sound").onclick = async () => {
  const enabled = await sound.toggle();
  $("sound").textContent = enabled ? "Sound on" : "Sound off";
  $("sound").setAttribute("aria-pressed", String(enabled));
};
function lighting() {
  const dusk = $("dusk").checked;
  document.body.classList.toggle("dusk", dusk);
  scene.background = new T.Color(dusk ? "#142832" : "#e4e7e4");
  (scene.fog as T.Fog).color.copy(scene.background);
  (floor.material as T.MeshStandardMaterial).color.set(
    dusk ? "#1c3039" : "#cdd3cd",
  );
  scene.environmentIntensity = dusk ? 0.38 : 1;
  key.intensity = dusk ? 1.8 : 2.5;
}
$("dusk").oninput = lighting;
lighting();
let last = 0,
  readoutTime = 0;
function render(now: number) {
  const dt = Math.min(0.05, (now - last) / 1000 || 0);
  last = now;
  const step =
    paused || document.hidden ? 0 : dt * ($("slow").checked ? 0.25 : 1);
  if (effects && model) {
    if (mode !== "manual") {
      sequenceTime += step;
      const lights = input.lights;
      input = sequenceInput(mode, sequenceTime);
      input.lights = lights;
      if (mode === "landing" && sequenceTime >= 8 && !touchdownTriggered) {
        effects.touchdown();
        touchdownTriggered = true;
      }
      syncControls();
    }
    effects.update(step, input);
    const s = effects.motion;
    sound.update(s.rpm, s.burner, paused || document.hidden);
    readoutTime += dt;
    if (readoutTime > 0.12) {
      readoutTime = 0;
      $("rpm").textContent = "N1 " + Math.round(s.rpm * 100) + "%";
      $("sequence-name").textContent =
        mode === "manual"
          ? "Manual control"
          : mode.charAt(0).toUpperCase() +
            mode.slice(1) +
            " · " +
            sequenceTime.toFixed(1) +
            "s";
      $("fx-status").textContent =
        s.damage > 0.1
          ? "Left engine failure · asymmetric exhaust and smoke"
          : s.canopy > 0.05
            ? "Canopy open · engine start closes the canopy"
            : s.burner > 0.1
              ? "Afterburner lit · twin plumes and shock diamonds"
              : input.burner && s.rpm < 0.9
                ? "Spooling up · afterburner waiting for high power"
                : s.rpm > 0.1
                  ? "Engines running · exhaust heat and turbine rotation"
                  : "Engines stopped · ready for startup";
    }
  }
  if (transition) {
    const blend = 1 - Math.exp(-dt * 5);
    camera.position.lerp(goal, blend);
    orbit.target.lerp(target, blend);
    if (camera.position.distanceTo(goal) < 0.025) transition = false;
  }
  orbit.update();
  if (effects && model && $("heat").checked && !reduced.matches)
    heat.render(
      renderer,
      scene,
      camera,
      model,
      effects.motion.time,
      effects.motion.rpm * 0.55 + effects.motion.burner * 0.45,
    );
  else renderer.render(scene, camera);
  requestAnimationFrame(render);
}
requestAnimationFrame(render);
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  framePanel();
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  showView(selected, true);
});
