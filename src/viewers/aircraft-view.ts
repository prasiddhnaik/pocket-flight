import * as T from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { makeAircraft, paints } from "../aircraft/aircraft";
import { aircraftSky } from "../aircraft/aircraft-finish";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { GTAOPass } from "three/addons/postprocessing/GTAOPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { aircraftBackdrop } from "./aircraft-backdrop";
import type { AircraftId, AircraftModel } from "../aircraft/aircraft";
import { aircraftDesign } from "../aircraft/aircraft-design";
import { displayDemo } from "../aircraft/cockpit-displays";
import { type AircraftChoice, aircraftNames, aircraftViewerUrl, choiceName, parseAircraftChoice, resolveAircraftChoice } from "../app/flight-ui";
import { finchAttackPaints } from "../aircraft/finch/attack";
import {
  previewCapabilities,
  updateAircraftPreview,
} from "./aircraft-preview";
import { mountAircraftSystems } from "./aircraft-systems";
import "./aircraft-view.css";

const params = new URLSearchParams(location.search);
let selectedChoice: AircraftChoice = parseAircraftChoice(params.get("aircraft")) ?? "finch";
let selectedId = resolveAircraftChoice(selectedChoice).id;
const paintCount = (choice: AircraftChoice) => (choice === "finch-attack" ? finchAttackPaints : paints).length;
const requestedPaint = Number(params.get("paint"));
let paint =
  Number.isInteger(requestedPaint) &&
  requestedPaint >= 0 &&
  requestedPaint < paintCount(selectedChoice)
    ? requestedPaint
    : 0;
const $ = <E extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as E;
$("app").innerHTML = `
  <main class="aircraft-viewer">
    <header><a id="back" href="/">← Pocket Flight</a><span>THE AIRCRAFT HANGAR</span></header>
    <section class="viewer-stage" aria-label="Aircraft inspection">
      <div class="viewer-heading"><p class="eyebrow">EXPLORE THE FLEET</p><h1 id="aircraft-name"></h1><p id="aircraft-description"></p></div>
      <div id="viewport" aria-label="Interactive aircraft model"></div>
      <nav class="camera-views" aria-label="Camera views">
        ${["Overview", "Front", "Side", "Top", "Rear"].map((label) => `<button type="button" data-view="${label.toLowerCase()}">${label}</button>`).join("")}
        <button type="button" data-view="nozzles" data-capability="cannon">Nozzles</button>
        <button type="button" data-view="gun" data-capability="cannon">Cannon</button>
        <button type="button" data-view="fuel" data-capability="fuelSystem">Wing fuel</button>
      </nav>
      <p class="orbit-help">Drag to orbit · Scroll or pinch to zoom · Right-drag to pan</p>
    </section>
    <aside aria-label="Aircraft controls">
      <label class="eyebrow" for="aircraft-picker">CHOOSE YOUR AIRCRAFT</label>
      <select id="aircraft-picker">${Object.keys(aircraftNames)
        .flatMap((id) => (id === "finch" ? ["finch", "finch-attack"] : [id]))
        .map((id) => `<option value="${id}">${choiceName(parseAircraftChoice(id) ?? "finch")}</option>`)
        .join("")}</select>
      <p id="status" role="status" aria-live="polite">Loading aircraft…</p><button id="retry" type="button" hidden>Retry loading</button>
      <dl><div><dt>WINGSPAN</dt><dd id="span">—</dd></div><div><dt>LENGTH</dt><dd id="length">—</dd></div></dl>
      <fieldset id="systems" disabled><legend>Aircraft systems</legend></fieldset>
      <a id="fly" class="fly-link" href="/">Fly this aircraft →</a>
      <p class="viewer-note">The same aircraft models and mechanisms used in flight. Cockpit displays show demonstration data.</p>
    </aside>
  </main>`;

async function startViewer() {
  const host = $("viewport");
  const renderer = new T.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  // The fuel cutaway clips its liquid at the fuel surface.
  renderer.localClippingEnabled = true;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = T.PCFShadowMap;
  renderer.toneMapping = T.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.88;
  renderer.domElement.setAttribute("aria-label", "Drag to rotate the aircraft");
  host.append(renderer.domElement);
  const scene = new T.Scene();
  // Daylight sky shared with the aircraft reflections, over a fading apron.
  const sky = aircraftSky();
  const backdrop = aircraftBackdrop();
  scene.background = backdrop;
  scene.environment = sky;
  scene.add(new T.HemisphereLight("#bcd4ec", "#3b4146", 0.35));
  const sun = new T.DirectionalLight("#fff1dc", 2.5);
  sun.position.set(18, 26, -14);
  sun.castShadow = true;
  // Fitted to each aircraft on load so close-ups get millimetre shadow texels.
  const sunDirection = new T.Vector3(18, 26, -14).normalize();
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.radius = 2.5;
  sun.shadow.normalBias = 0.012;
  sun.shadow.bias = -0.0002;
  scene.add(sun, sun.target);
  const fill = new T.DirectionalLight("#cfe2ff", 0.35);
  fill.position.set(-12, 8, 15);
  scene.add(fill);
  const camera = new T.PerspectiveCamera(38, 1, 0.015, 500);
  // Flyby grade: soft bloom on speculars, then a cool, slightly desaturated look.
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  // Contact shadowing in panel joins, under the intakes and around stores.
  const occlusion = new GTAOPass(scene, camera);
  occlusion.updateGtaoMaterial({ radius: 0.55, thickness: 1, scale: 1.25, distanceExponent: 1.5 });
  occlusion.blendIntensity = 0.9;
  // Sprites, glass and effect volumes write no visible surface; keep them out
  // of the depth/normal prepass or they cast phantom occlusion.
  const occlude = occlusion.render.bind(occlusion);
  occlusion.render = (...args) => {
    const hidden: T.Object3D[] = [];
    scene.traverseVisible((o) => {
      const material = (o as T.Mesh).material as T.Material | undefined;
      if (o instanceof T.Sprite || o instanceof T.Points || (material && !Array.isArray(material) && material.transparent && !material.depthWrite))
        hidden.push(o);
    });
    hidden.forEach((o) => (o.visible = false));
    occlude(...args);
    hidden.forEach((o) => (o.visible = true));
  };
  composer.addPass(occlusion);
  composer.addPass(new UnrealBloomPass(new T.Vector2(512, 512), 0.28, 0.55, 0.92));
  composer.addPass(new OutputPass());
  composer.addPass(
    new ShaderPass({
      uniforms: { tDiffuse: { value: null } },
      vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
      fragmentShader: `uniform sampler2D tDiffuse; varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          float l = dot(c.rgb, vec3(0.299, 0.587, 0.114));
          c.rgb = mix(vec3(l), c.rgb, 0.82) * vec3(0.97, 1.0, 1.04);
          c.rgb = (c.rgb - 0.5) * 1.1 + 0.5;
          float v = smoothstep(1.25, 0.35, length(vUv - 0.5) * 1.6);
          gl_FragColor = vec4(c.rgb * mix(0.82, 1.0, v), c.a);
        }`,
    }),
  );
  const orbit = new OrbitControls(camera, renderer.domElement);
  orbit.enableDamping = true;
  orbit.maxPolarAngle = Math.PI * 0.5;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const listeners = new AbortController();
  const on = { signal: listeners.signal };
  let aircraft: AircraftModel | undefined,
    ready = false,
    disposed = false;
  const systems = mountAircraftSystems($<HTMLFieldSetElement>("systems"), {
    paint,
    onPaint(value) {
      paint = value;
      aircraft?.setPaint(value);
      updateLinks();
    },
    onReset() {
      aircraft?.effects?.reset();
      aircraft?.propellerMotion.reset();
      aircraft?.surfaces.reset();
    },
  });
  let lastReadout = 0;
  let radius = 10,
    center = new T.Vector3(),
    activeView = "overview",
    last = performance.now();

  function showView(view = activeView) {
    activeView = view;
    const directions: Record<string, T.Vector3> = {
      overview: new T.Vector3(1, 0.48, -1.25),
      front: new T.Vector3(0, 0.08, -1),
      side: new T.Vector3(1, 0.08, 0),
      top: new T.Vector3(0, 1, 0.001),
      rear: new T.Vector3(0.7, 0.3, 1),
    };
    const vertical = T.MathUtils.degToRad(camera.fov);
    const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect);
    const distance =
      (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.08;
    orbit.target.copy(center);
    camera.position
      .copy(directions[view] ?? directions.overview)
      .normalize()
      .multiplyScalar(distance)
      .add(center);
    if (selectedId === "f15c" && view === "nozzles") {
      camera.position.set(3.2, 1, 11.5);
      orbit.target.set(0, -0.24, 7.5);
    } else if (selectedId === "f15c" && view === "fuel") {
      camera.position.set(0, 13, -4);
      orbit.target.set(0, 0, 2.2);
    } else if (selectedId === "f15c" && view === "gun") {
      camera.position.set(2.1, 0.2, -3.6);
      orbit.target.set(1.8, 0.02, -2.7);
    }
    document
      .querySelectorAll<HTMLButtonElement>("[data-view]")
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.view === view),
        ),
      );
    orbit.update();
  }
  function updateLinks() {
    const url = `/?aircraft=${selectedChoice}&paint=${paint}`;
    $("fly").setAttribute("href", url);
    $("back").setAttribute("href", url);
    history.replaceState(null, "", aircraftViewerUrl(selectedChoice, paint));
  }
  async function loadAircraft(choice: AircraftChoice) {
    const { id, variant } = resolveAircraftChoice(choice);
    ready = false;
    selectedChoice = choice;
    selectedId = id;
    if (paint >= paintCount(choice)) paint = 0;
    systems.releaseGun();
    aircraft?.group.removeFromParent();
    aircraft?.dispose();
    const next = makeAircraft(paint, id, variant);
    aircraft = next;
    scene.add(next.group);
    systems.configure(id, variant, paint);
    $<HTMLSelectElement>("aircraft-picker").value = choice;
    $<HTMLFieldSetElement>("systems").disabled = true;
    $("retry").hidden = true;
    $("status").textContent = "Loading aircraft…";
    $("aircraft-name").textContent = choiceName(choice);
    document.title = `${choiceName(choice)} · Pocket Flight aircraft viewer`;
    const capabilities = previewCapabilities(id);
    document
      .querySelectorAll<HTMLElement>("[data-capability]")
      .forEach((element) => {
        element.hidden =
          !capabilities[
            element.dataset.capability as keyof typeof capabilities
          ];
      });
    $("aircraft-description").textContent = variant === "attack"
      ? "Light attack. Four hardpoints, same trusted airframe."
      : capabilities.propeller
      ? "Island flying, up close."
      : id === "f15c"
        ? "Twin engines. Working nozzles. Every control, up close."
        : "Explore the airframe and its moving systems.";
    const { geometry } = aircraftDesign(id);
    $("span").textContent = `${geometry.span.toFixed(2)} m`;
    $("length").textContent = `${geometry.length.toFixed(2)} m`;
    updateLinks();
    try {
      await next.ready;
      if (disposed || aircraft !== next) return;
      next.group.updateMatrixWorld(true);
      const bounds = new T.Box3();
      // Procedural exhaust volumes and propeller blur are outside the airframe.
      next.group.traverse((node) => {
        if (
          !(node instanceof T.Mesh) ||
          node.geometry.type !== "BufferGeometry"
        )
          return;
        node.geometry.computeBoundingBox();
        bounds.union(
          node.geometry.boundingBox!.clone().applyMatrix4(node.matrixWorld),
        );
      });
      const sphere = bounds.getBoundingSphere(new T.Sphere());
      center = sphere.center;
      radius = sphere.radius;
      sun.target.position.copy(center);
      sun.position.copy(center).addScaledVector(sunDirection, radius * 3);
      Object.assign(sun.shadow.camera, { left: -radius, right: radius, top: radius, bottom: -radius, near: radius, far: radius * 5 });
      sun.shadow.camera.updateProjectionMatrix();
      orbit.minDistance = 0.25;
      orbit.maxDistance = radius * 12;
      ready = true;
      $<HTMLFieldSetElement>("systems").disabled = false;
      $("status").textContent = "Aircraft ready · Flight model loaded";
      showView("overview");
    } catch (error) {
      if (disposed || aircraft !== next) return;
      $("status").textContent =
        "Aircraft could not load. Retry to load the model again.";
      $("retry").hidden = false;
      console.error(error);
    }
  }
  $<HTMLSelectElement>("aircraft-picker").addEventListener(
    "change",
    (event) =>
      void loadAircraft(
        parseAircraftChoice((event.target as HTMLSelectElement).value) ?? "finch",
      ),
    on,
  );
  $("retry").addEventListener("click", () => void loadAircraft(selectedChoice), on);
  document
    .querySelectorAll<HTMLButtonElement>("[data-view]")
    .forEach((button) =>
      button.addEventListener("click", () => showView(button.dataset.view), on),
    );
  document.addEventListener(
    "visibilitychange",
    () => {
      last = performance.now();
      systems.releaseGun();
    },
    on,
  );
  const observer = new ResizeObserver(() => {
    const { width, height } = host.getBoundingClientRect();
    if (!width || !height) return;
    renderer.setSize(width, height);
    composer.setSize(width, height);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (ready) showView();
  });
  observer.observe(host);
  renderer.setAnimationLoop((now: number) => {
    const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
    last = now;
    if (document.hidden) return;
    if (ready && aircraft) {
      const state = systems.state;
      updateAircraftPreview(aircraft, state, dt, reduced.matches);
      if (now - lastReadout > 100) {
        systems.updatePositions(aircraft);
        lastReadout = now;
      }
      aircraft.displays?.update(
        {
          ...displayDemo(reduced.matches ? 0 : now / 1000, 0),
          speed: 0,
          power: state.power,
          engineOut: state.power === 0,
        },
        true,
      );
    }
    orbit.update();
    composer.render();
  });
  window.addEventListener(
    "pagehide",
    (event) => {
      systems.releaseGun();
      if (event.persisted) return;
      disposed = true;
      renderer.setAnimationLoop(null);
      listeners.abort();
      observer.disconnect();
      orbit.dispose();
      systems.dispose();
      aircraft?.dispose();
      backdrop.dispose();
      composer.dispose();
      sun.shadow.map?.dispose();
      renderer.dispose();
    },
    on,
  );
  await loadAircraft(selectedChoice);
}

void startViewer().catch((error) => {
  $("status").textContent =
    "The 3D viewer could not start. Check WebGL and hardware acceleration, then reload this page.";
  console.error(error);
});
