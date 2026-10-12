import * as T from "three";
import { CockpitDisplays, displayDemo } from "../src/cockpit-displays";
import { refineAircraftMaterials } from "../src/aircraft-materials";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { batchStaticMeshes } from "./render-batching";
import {
  AircraftMechanics,
  mechanismPose,
  type MechanismProgramme,
} from "./mechanics";
import { aircraftCatalog, type LabAircraftId } from "./aircraft";
import { fleetMeasurements } from "./catalog";
import { wingSection, type Solution } from "./solver";
import {
  AirframeEnvelope,
  traceAirflow,
  samplePath,
  type AirflowPath,
  type AirflowResult,
} from "./airflow";

export type Layers = {
  chamber: boolean;
  flow: boolean;
  lattice: boolean;
  wingOnly: boolean;
  forces: boolean;
};
export const initialLayers: Layers = {
  chamber: true,
  flow: true,
  lattice: false,
  wingOnly: false,
  forces: true,
};
const pivot = new T.Vector3(0, 5.25, 0);
const wakeColor = [0.35, 0.68, 1],
  bodyColor = [0.48, 0.96, 0.88];

function disposeObject(root: T.Object3D) {
  const materials = new Set<T.Material>(),
    textures = new Set<T.Texture>();
  root.traverse((o) => {
    if (o instanceof T.Mesh || o instanceof T.Line || o instanceof T.Points) {
      o.geometry.dispose();
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        materials.add(m);
    }
  });
  for (const m of materials) {
    for (const value of Object.values(m))
      if (value instanceof T.Texture) textures.add(value);
    m.dispose();
  }
  textures.forEach((t) => t.dispose());
}

export class TunnelScene {
  private renderer = new T.WebGLRenderer({ antialias: true, alpha: false });
  private scene = new T.Scene();
  private camera = new T.PerspectiveCamera(38, 1, 0.1, 200);
  private orbit: OrbitControls;
  private room: T.Group | null = null;
  private chamberCutaways: T.Object3D[] = [];
  private aircraft: T.Group | null = null;
  private mechanicalSource: {
    model: T.Group;
    clips: T.AnimationClip[];
    id: LabAircraftId;
  } | null = null;
  private mechanicalAircraft: T.Group | null = null;
  private mechanics: AircraftMechanics | null = null;
  private mechanicalEnabled = false;
  private mechanicalProgramme: MechanismProgramme = "all";
  private mechanicalTime = 0;
  private displayTime = 0;
  private displays: CockpitDisplays | null = null;
  private revealMechanisms = false;
  private ghostShells = new Map<
    T.Mesh,
    { solid: T.Material; ghost: T.Material }
  >();
  private flow = new T.Group();
  private lattice = new T.Group();
  private forces = new T.Group();
  private particles = new T.Points(
    new T.BufferGeometry(),
    new T.PointsMaterial({
      color: "#b4ffef",
      size: 0.1,
      blending: T.AdditiveBlending,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    }),
  );
  private paths: AirflowPath[] = [];
  private streaks = new T.LineSegments(
    new T.BufferGeometry(),
    new T.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: T.AdditiveBlending,
      depthWrite: false,
    }),
  );
  private envelope: AirframeEnvelope | null = null;
  private aircraftId: LabAircraftId | null = null;
  private airflow: Omit<AirflowResult, "paths"> | null = null;
  private emitters: { path: AirflowPath; phase: number }[] = [];
  private fan: T.Object3D | undefined;
  private pitchRig: T.Object3D | undefined;
  private solution: Solution | null = null;
  private aircraftSize = 11;
  private currentView:
    "test" | "top" | "rear" | "chamber" | "side" | "displays" | "internal" | "cabin" = "test";
  private layers = initialLayers;
  private frame = 0;
  private ticket = 0;
  private dead = false;
  private paused = false;
  private phase = 0;
  private flowBuilds = 0;
  private visualKey = "";
  private tracer = new Worker(new URL("./airflow-worker.ts", import.meta.url), {
    type: "module",
  });
  private tracing = false;
  private queuedTrace: {
    key: string;
    solution: Solution;
    envelope: ReturnType<AirframeEnvelope["toData"]>;
  } | null = null;
  private lastTraceMs = 0;
  private lastFlowInstallMs = 0;
  private traceVersion = 0;
  private airflowCache = new Map<string, AirflowResult>();
  private dirty = true;
  private renderedFrames = 0;
  private point: [number, number, number] = [0, 0, 0];
  private lastSolutionMs = 0;
  private lastAirflowMs = 0;
  private last = 0;
  private resizeObserver: ResizeObserver;
  private materials = new Map<
    T.Material,
    { opacity: number; transparent: boolean; depthWrite: boolean }
  >();

  constructor(
    private host: HTMLDivElement,
    private status: (state: string, error?: boolean) => void,
  ) {
    this.tracer.onmessage = (event) => {
      this.tracing = false;
      const { key, result, elapsedMs, error } = event.data;
      if (key === this.visualKey && this.solution) {
        if (error) this.status(`Airflow failed: ${error}`, true);
        else {
          this.lastTraceMs = elapsedMs;
          if (this.airflowCache.size >= 8)
            this.airflowCache.delete(this.airflowCache.keys().next().value!);
          this.airflowCache.set(key, result);
          this.installFlow(this.solution, result);
          this.dirty = true;
          this.status(`${aircraftCatalog[this.aircraftId!].name} ready`);
        }
      }
      const next = this.queuedTrace;
      this.queuedTrace = null;
      if (next && next.key !== key) this.requestTrace(next);
    };
    this.tracer.onerror = () =>
      this.status("Airflow worker failed. Reload the tester.", true);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Private 3D aerodynamic test chamber",
    );
    host.appendChild(this.renderer.domElement);
    this.scene.background = new T.Color("#18262e");
    const pmrem = new T.PMREMGenerator(this.renderer),
      environment = new RoomEnvironment();
    this.scene.environment = pmrem.fromScene(environment, 0.03).texture;
    environment.dispose();
    pmrem.dispose();
    this.scene.add(new T.HemisphereLight("#d5e4e8", "#273239", 0.65));
    const key = new T.DirectionalLight("#ecf5ff", 2.1);
    key.position.set(4, 18, -8);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    Object.assign(key.shadow.camera, {
      left: -15,
      right: 15,
      top: 18,
      bottom: -18,
      near: 0.5,
      far: 70,
    });
    key.shadow.normalBias = 0.025;
    const rim = new T.DirectionalLight("#ffcc94", 1.1);
    rim.position.set(-12, 10, 15);
    const fill = new T.DirectionalLight("#a7deed", 0.65);
    fill.position.set(15, 8, -15);
    this.scene.add(key, rim, fill, this.flow, this.lattice, this.forces);
    this.flow.position.copy(pivot);
    this.lattice.position.copy(pivot);
    this.flow.add(this.particles, this.streaks);
    this.particles.frustumCulled = false;
    this.streaks.frustumCulled = false;
    const sprite = document.createElement("canvas");
    sprite.width = sprite.height = 32;
    const context = sprite.getContext("2d")!;
    const glow = context.createRadialGradient(16, 16, 0, 16, 16, 16);
    glow.addColorStop(0, "white");
    glow.addColorStop(0.2, "rgba(255,255,255,.95)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, 32, 32);
    this.particles.material.map = new T.CanvasTexture(sprite);
    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.enableDamping = true;
    this.orbit.addEventListener("change", () => {
      this.dirty = true;
    });
    this.orbit.dampingFactor = 0.08;
    this.orbit.minDistance = 1.2;
    this.orbit.maxDistance = 140;
    this.orbit.maxPolarAngle = Math.PI * 0.85;
    this.view("test");
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(host);
    this.resize();
    new GLTFLoader()
      .loadAsync("/tunnel.glb")
      .then((gltf) => {
        if (this.dead) {
          disposeObject(gltf.scene);
          return;
        }
        this.room = gltf.scene;
        this.room.traverse((o) => {
          if (!(o instanceof T.Mesh)) return;
          o.castShadow = !o.userData.cockpitDisplay;
          o.receiveShadow = true;
          for (const m of Array.isArray(o.material)
            ? o.material
            : [o.material]) {
            if (m instanceof T.MeshStandardMaterial) {
              m.envMapIntensity =
                m.name.startsWith("Deck") || m.name.startsWith("Housing")
                  ? 0.28
                  : 0.6;
            }
            if (m.name === "Observation glass") {
              m.transparent = true;
              m.opacity = 0.085;
              m.depthWrite = false;
              o.castShadow = false;
              if (m instanceof T.MeshStandardMaterial) m.envMapIntensity = 1;
              if (m instanceof T.MeshPhysicalMaterial) {
                m.transmission = 0;
                m.clearcoat = 0.65;
                m.roughness = 0.1;
              }
            }
          }
        });
        this.chamberCutaways = ["Cutaway_NearWall", "Cutaway_Roof"]
          .map((name) => this.room!.getObjectByName(name))
          .filter((o): o is T.Object3D => !!o);
        // Batch each optional enclosure section independently so full-room views
        // remain inexpensive and inspection visibility does not split batches.
        for (const section of this.chamberCutaways) {
          batchStaticMeshes(section);
          section.visible = false;
        }
        this.fan = this.room.getObjectByName("Fan_Rotor");
        this.fan?.traverse((o) => {
          if (o instanceof T.Mesh) o.castShadow = false;
        });
        this.pitchRig = this.room.getObjectByName("Pitch_Rig");
        batchStaticMeshes(this.room);
        this.scene.add(this.room);
        this.invalidateShadows();
        this.applyLayers();
        this.applyChamberView();
        if (this.currentView === "chamber") this.view("chamber");
        if (this.solution && this.pitchRig)
          this.pitchRig.rotation.x =
            (this.solution.conditions.alpha * Math.PI) / 180;
      })
      .catch((error) =>
        this.status(`Chamber load failed: ${String(error)}`, true),
      );
    this.frame = requestAnimationFrame(this.tick);
  }

  private resize() {
    const width = Math.max(1, this.host.clientWidth),
      height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.view(this.currentView);
  }

  async loadAircraft(id: LabAircraftId) {
    const ticket = ++this.ticket;
    this.traceVersion++;
    this.queuedTrace = null;
    this.airflowCache.clear();
    this.envelope = null;
    this.aircraftId = null;
    this.clearVisuals();
    this.status(`Loading ${aircraftCatalog[id].name}…`);
    const config = aircraftCatalog[id];
    try {
      const gltf = await new GLTFLoader().loadAsync(
        `/aircraft/${config.asset}`,
      );
      if (ticket !== this.ticket || this.dead) {
        disposeObject(gltf.scene);
        return;
      }
      this.displays?.dispose();
      this.displays = null;
      if (this.aircraft) {
        this.scene.remove(this.aircraft);
        disposeObject(this.aircraft);
      }
      if (this.mechanicalAircraft) {
        this.scene.remove(this.mechanicalAircraft);
        disposeObject(this.mechanicalAircraft);
      }
      for (const { ghost } of this.ghostShells.values()) ghost.dispose();
      this.ghostShells.clear();
      if (this.mechanicalSource) disposeObject(this.mechanicalSource.model);
      this.mechanicalAircraft = null;
      this.mechanics = null;
      this.mechanicalTime = 0;
      this.materials.clear();
      const model = new T.Group();
      gltf.scene.scale.setScalar(config.scale);
      gltf.scene.position.y = config.offsetY;
      // Keep the authoring hierarchy for a lazily built mechanical showcase.
      // The analytical representation retains the existing aggressively batched path.
      this.mechanicalSource = { model: gltf.scene, clips: gltf.animations, id };
      refineAircraftMaterials(gltf.scene);
      this.displays = new CockpitDisplays(gltf.scene, id);
      this.displayTime = 0;
      model.add(gltf.scene.clone(true));
      model.position.copy(pivot);
      refineAircraftMaterials(model);
      batchStaticMeshes(model);
      model.traverse((o) => {
        if (!(o instanceof T.Mesh)) return;
        o.castShadow = true;
        o.receiveShadow = true;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          this.materials.set(m, {
            opacity: m.opacity,
            transparent: m.transparent,
            depthWrite: m.depthWrite,
          });
        }
      });
      this.aircraft = model;
      this.envelope = new AirframeEnvelope(model);
      this.aircraftId = id;
      this.scene.add(model);
      this.invalidateShadows();
      this.aircraftSize = Math.max(
        ...fleetMeasurements.find((m) => m.id === id)!.dimensions,
      );
      this.view("test");
      if (this.solution)
        model.rotation.x = (this.solution.conditions.alpha * Math.PI) / 180;
      if (this.solution) this.setSolution(this.solution);
      if (this.mechanicalEnabled) this.ensureMechanics();
      this.applyLayers();
      if (this.paths.length) this.status(`${config.name} ready`);
    } catch (error) {
      if (!this.dead && ticket === this.ticket)
        this.status(`Aircraft load failed: ${String(error)}`, true);
    }
  }

  setSolution(solution: Solution | null) {
    const started = performance.now();
    this.solution = solution;
    const key = solution
      ? JSON.stringify([
          this.aircraftId,
          solution.geometry.stations,
          solution.conditions.alpha,
          solution.panels.length,
          this.traceVersion,
        ])
      : "";
    if (key && key === this.visualKey && this.paths.length) {
      this.clearGroup(this.forces);
      this.buildForces(solution!);
      this.dirty = true;
      this.lastSolutionMs = performance.now() - started;
      return;
    }
    this.clearVisuals();
    if (!solution) {
      this.queuedTrace = null;
      this.dirty = true;
      if (this.aircraftId)
        this.status(`${aircraftCatalog[this.aircraftId].name} ready`);
      return;
    }
    const alpha = (solution.conditions.alpha * Math.PI) / 180;
    if (this.aircraft) this.aircraft.rotation.x = alpha;
    if (this.pitchRig) this.pitchRig.rotation.x = alpha;
    this.flow.rotation.x = alpha;
    this.lattice.rotation.x = alpha;
    this.buildLattice(solution);
    this.visualKey = key;
    this.buildFlow(solution, key);
    this.buildForces(solution);
    this.applyLayers();
    this.invalidateShadows();
    this.lastSolutionMs = performance.now() - started;
  }

  private invalidateShadows() {
    this.renderer.shadowMap.needsUpdate = true;
    this.dirty = true;
  }
  private clearGroup(root: T.Group) {
    for (const child of [...root.children]) {
      root.remove(child);
      disposeObject(child);
    }
  }

  private clearVisuals() {
    this.visualKey = "";
    for (const root of [this.lattice, this.forces]) {
      for (const child of [...root.children]) {
        root.remove(child);
        disposeObject(child);
      }
    }
    for (const child of [...this.flow.children])
      if (child !== this.particles && child !== this.streaks) {
        this.flow.remove(child);
        disposeObject(child);
      }
    this.paths = [];
    this.emitters = [];
    this.airflow = null;
    this.streaks.geometry.dispose();
    this.streaks.geometry = new T.BufferGeometry();
    this.particles.geometry.dispose();
    this.particles.geometry = new T.BufferGeometry();
  }

  private buildLattice(solution: Solution) {
    const vertices: number[] = [],
      colors: number[] = [],
      edges: T.Vector3[] = [];
    const maximum = Math.max(
      1e-9,
      ...solution.panels.map((p) => Math.abs(p.liftPerSpan)),
    );
    for (const panel of solution.panels) {
      const a = wingSection(solution.geometry, panel.a[0]),
        b = wingSection(solution.geometry, panel.b[0]);
      const p = [
        new T.Vector3(a.x, a.y + 0.015, a.leading),
        new T.Vector3(b.x, b.y + 0.015, b.leading),
        new T.Vector3(b.x, b.y + 0.015, b.leading + b.chord),
        new T.Vector3(a.x, a.y + 0.015, a.leading + a.chord),
      ];
      const color = new T.Color().setHSL(
        0.54 - (0.42 * Math.abs(panel.liftPerSpan)) / maximum,
        0.7,
        0.55,
      );
      for (const i of [0, 1, 2, 0, 2, 3]) {
        vertices.push(...p[i].toArray());
        colors.push(color.r, color.g, color.b);
      }
      edges.push(
        p[0],
        p[3],
        new T.Vector3(...panel.a),
        new T.Vector3(...panel.b),
      );
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(vertices, 3),
    );
    geometry.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    this.lattice.add(
      new T.Mesh(
        geometry,
        new T.MeshBasicMaterial({
          vertexColors: true,
          transparent: true,
          opacity: 0.63,
          side: T.DoubleSide,
          depthWrite: false,
        }),
      ),
    );
    this.lattice.add(
      new T.LineSegments(
        new T.BufferGeometry().setFromPoints(edges),
        new T.LineBasicMaterial({
          color: "#f8df95",
          transparent: true,
          opacity: 0.7,
          depthTest: false,
        }),
      ),
    );
  }

  private buildFlow(solution: Solution, key: string) {
    if (
      !this.envelope ||
      !this.aircraftId ||
      !solution.geometry.name.startsWith(aircraftCatalog[this.aircraftId].name)
    )
      return;
    const result = this.airflowCache.get(key);
    if (result) {
      this.queuedTrace = null;
      this.installFlow(solution, result);
      this.status(`${aircraftCatalog[this.aircraftId].name} ready`);
    } else {
      this.status(`Tracing ${aircraftCatalog[this.aircraftId].name} airflow…`);
      const request = { key, solution, envelope: this.envelope.toData() };
      if (this.tracing) this.queuedTrace = request;
      else this.requestTrace(request);
    }
  }

  private requestTrace(request: NonNullable<TunnelScene["queuedTrace"]>) {
    this.tracing = true;
    this.flowBuilds++;
    this.tracer.postMessage(request);
  }
  private installFlow(solution: Solution, result: AirflowResult) {
    if (!this.envelope) return;
    const started = performance.now();
    const { paths, ...diagnostics } = result;
    this.paths = paths;
    this.airflow = diagnostics;
    const central = (path: AirflowPath) =>
      !path.wake && Math.abs(path.points[0][0]) < 0.35;
    const edges = new Float32Array(result.checkedSegments * 6);
    const bodyEdges = new Float32Array(
      paths.reduce(
        (n, path) => n + (central(path) ? (path.points.length - 1) * 6 : 0),
        0,
      ),
    );
    let edgeOffset = 0,
      bodyOffset = 0;
    for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
      const path = paths[pathIndex];
      for (let i = 1; i < path.points.length; i++) {
        edges.set(path.points[i - 1], edgeOffset);
        edges.set(path.points[i], edgeOffset + 3);
        edgeOffset += 6;
        if (central(path)) {
          bodyEdges.set(path.points[i - 1], bodyOffset);
          bodyEdges.set(path.points[i], bodyOffset + 3);
          bodyOffset += 6;
        }
      }
      const count = Math.max(2, Math.round(path.length / 6.5));
      for (let i = 0; i < count; i++)
        this.emitters.push({
          path,
          phase: i / count + pathIndex * 0.127,
        });
    }
    const guides = new T.LineSegments(
      new T.BufferGeometry().setAttribute(
        "position",
        new T.BufferAttribute(edges, 3),
      ),
      new T.LineBasicMaterial({
        color: "#76c6d2",
        transparent: true,
        opacity: 0.13,
        depthWrite: false,
      }),
    );
    guides.name = "airflow-guides";
    guides.visible = this.currentView !== "side";
    const bodyGuides = new T.LineSegments(
      new T.BufferGeometry().setAttribute(
        "position",
        new T.BufferAttribute(bodyEdges, 3),
      ),
      new T.LineBasicMaterial({
        color: "#94e6d9",
        transparent: true,
        opacity: 0.3,
        depthWrite: false,
      }),
    );
    bodyGuides.name = "airflow-body-guides";
    bodyGuides.visible = this.currentView === "side";
    this.flow.add(guides, bodyGuides);
    const incoming = new T.ArrowHelper(
      new T.Vector3(...solution.freestream).normalize(),
      new T.Vector3(
        0,
        this.envelope.bounds.max.y + 0.75,
        this.envelope.bounds.min.z - 2.6,
      ),
      1.9,
      "#8ce6d6",
      0.3,
      0.13,
    );
    incoming.name = "incoming-flow-direction";
    this.flow.add(incoming);
    this.particles.geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(
        new Float32Array(this.emitters.length * 3),
        3,
      ),
    );
    this.particles.geometry.setAttribute(
      "color",
      new T.Float32BufferAttribute(
        new Float32Array(this.emitters.length * 3),
        3,
      ),
    );
    this.streaks.geometry.setAttribute(
      "position",
      new T.Float32BufferAttribute(
        new Float32Array(this.emitters.length * 5 * 2 * 3),
        3,
      ),
    );
    this.streaks.geometry.setAttribute(
      "color",
      new T.Float32BufferAttribute(
        new Float32Array(this.emitters.length * 5 * 2 * 3),
        3,
      ),
    );
    this.animateAirflow();
    this.lastFlowInstallMs = performance.now() - started;
  }

  getAirflowDiagnostics() {
    const positions = this.particles.geometry.getAttribute("position");
    return this.airflow
      ? {
          ...this.airflow,
          pathCount: this.paths.length,
          alpha: this.solution?.conditions.alpha,
          emitterCount: this.emitters.length,
          visualTravel: this.phase,
          motionScale: 0.18,
          firstHead: positions?.count
            ? [positions.getX(0), positions.getY(0), positions.getZ(0)]
            : null,
        }
      : null;
  }

  getPerformanceDiagnostics() {
    return {
      cockpitDisplays: this.displays?.diagnostics(),
      drawCalls: this.renderer.info.render.calls,
      triangles: this.renderer.info.render.triangles,
      geometries: this.renderer.info.memory.geometries,
      textures: this.renderer.info.memory.textures,
      flowBuilds: this.flowBuilds,
      solutionUpdateMs: this.lastSolutionMs,
      airflowUpdateMs: this.lastAirflowMs,
      renderedFrames: this.renderedFrames,
      cachedFlowConditions: this.airflowCache.size,
      traceWorkerMs: this.lastTraceMs,
      flowInstallMs: this.lastFlowInstallMs,
      tracing: this.tracing,
      mechanics:
        this.mechanicalEnabled && this.mechanics
          ? {
              ...this.mechanics.diagnostics(),
              shellReveal: this.revealMechanisms,
              overlaysVisible:
                this.flow.visible ||
                this.lattice.visible ||
                this.forces.visible,
            }
          : null,
      chamber: {
        ready: !!this.room,
        view: this.currentView,
        cutawaySections: this.chamberCutaways.map((section) => ({
          name: section.name,
          visible: section.visible,
        })),
      },
    };
  }

  private animateAirflow() {
    const started = performance.now();
    const heads = this.particles.geometry.getAttribute("position"),
      headColors = this.particles.geometry.getAttribute("color");
    const streaks = this.streaks.geometry.getAttribute("position"),
      streakColors = this.streaks.geometry.getAttribute("color");
    if (!heads || !streaks) return;
    for (let i = 0; i < this.emitters.length; i++) {
      const { path, phase } = this.emitters[i];
      const distance =
        (((this.phase + phase * path.length) % path.length) + path.length) %
        path.length;
      const visible =
        this.currentView !== "side" ||
        path.wake ||
        Math.abs(path.points[0][0]) < 0.35;
      const fade =
        (visible ? 1 : 0) *
        Math.min(1, distance / 0.8, (path.length - distance) / 0.8);
      const color = path.wake ? wakeColor : bodyColor;
      const head = samplePath(path, distance, this.point);
      heads.setXYZ(i, head[0], head[1], head[2]);
      headColors.setXYZ(i, color[0] * fade, color[1] * fade, color[2] * fade);
      for (let segment = 0; segment <= 5; segment++) {
        const offset = segment * 0.11,
          point = samplePath(path, Math.max(0, distance - offset), this.point);
        const brightness = fade * (1 - offset / 0.6) ** 2;
        const first = i * 10 + segment * 2 - 1;
        // Adjacent segments share this sample, so interpolate only six times.
        for (
          let index = Math.max(i * 10, first);
          index <= Math.min(i * 10 + 9, first + 1);
          index++
        ) {
          streaks.setXYZ(index, point[0], point[1], point[2]);
          streakColors.setXYZ(
            index,
            color[0] * brightness,
            color[1] * brightness,
            color[2] * brightness,
          );
        }
      }
    }
    heads.needsUpdate = true;
    headColors.needsUpdate = true;
    streaks.needsUpdate = true;
    streakColors.needsUpdate = true;
    this.lastAirflowMs = performance.now() - started;
  }

  private buildForces(solution: Solution) {
    const root = solution.geometry.stations[0];
    const origin = new T.Vector3(0, root.y + 0.5, root.leading + root.chord / 4)
      .applyAxisAngle(
        new T.Vector3(1, 0, 0),
        (solution.conditions.alpha * Math.PI) / 180,
      )
      .add(pivot);
    const sign = Math.sign(solution.lift) || 1;
    const length = Math.min(3.1, 0.5 + Math.abs(solution.lift) / 8000);
    this.forces.add(
      new T.ArrowHelper(
        new T.Vector3(0, sign, 0),
        origin,
        length,
        "#c2f28d",
        0.28,
        0.13,
      ),
    );
    this.forces.add(
      new T.ArrowHelper(
        new T.Vector3(0, 0, 1),
        origin,
        Math.min(2.5, 0.4 + solution.inducedDrag / 250),
        "#e9b363",
        0.22,
        0.11,
      ),
    );
  }

  setLayers(layers: Layers) {
    this.layers = layers;
    this.applyLayers();
    this.invalidateShadows();
    if (layers.flow) this.animateAirflow();
  }
  private applyLayers() {
    if (this.room) this.room.visible = this.layers.chamber;
    this.flow.visible = this.layers.flow && !this.mechanicalEnabled;
    this.lattice.visible = this.layers.lattice && !this.mechanicalEnabled;
    this.forces.visible = this.layers.forces && !this.mechanicalEnabled;
    if (this.aircraft) this.aircraft.visible = !this.mechanicalEnabled;
    if (this.mechanicalAircraft)
      this.mechanicalAircraft.visible = this.mechanicalEnabled;
    this.aircraft?.traverse((node) => {
      if (!(node instanceof T.Mesh)) return;
      let parent: T.Object3D | null = node,
        isWing = !!node.userData.mainWing;
      while (parent && parent !== this.aircraft) {
        if (/^Wing_(Left|Right)$/.test(parent.name)) isWing = true;
        parent = parent.parent;
      }
      node.visible = !this.layers.wingOnly || isWing;
      for (const m of Array.isArray(node.material)
        ? node.material
        : [node.material]) {
        const rest = this.materials.get(m);
        if (rest) {
          m.opacity = this.layers.lattice
            ? Math.min(rest.opacity, 0.28)
            : rest.opacity;
          const transparent = this.layers.lattice || rest.transparent;
          if (m.transparent !== transparent) {
            m.transparent = transparent;
            m.needsUpdate = true;
          }
          m.depthWrite = this.layers.lattice ? false : rest.depthWrite;
        }
      }
    });
  }

  private applyChamberView() {
    for (const section of this.chamberCutaways)
      section.visible = this.currentView === "chamber";
    this.invalidateShadows();
  }

  view(view: "test" | "top" | "rear" | "chamber" | "side" | "displays" | "internal" | "cabin") {
    if (view === "displays") {
      this.displayView();
      return;
    }
    if (view === "internal") {
      this.internalSystemsView();
      return;
    }
    if (view === "cabin") {
      this.rearCabinView();
      return;
    }
    this.camera.fov = 38;
    this.camera.near = 0.1;
    this.orbit.minDistance = 1.2;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
    this.currentView = view;
    this.applyChamberView();
    const guides = this.flow.getObjectByName("airflow-guides"),
      bodyGuides = this.flow.getObjectByName("airflow-body-guides");
    if (guides) guides.visible = view !== "side";
    if (bodyGuides) bodyGuides.visible = view === "side";
    this.animateAirflow();
    const fit = (this.aircraftSize * 1.65) / Math.min(1, this.camera.aspect);
    const positions = {
      test: [17, 10.7, -17],
      side: [20, 5.7, 0],
      top: [0.1, 26, 0],
      rear: [15, 10, 19],
      chamber: [36, 23, -48],
    } as const;
    if (view === "test")
      this.camera.position.copy(
        new T.Vector3(1, 0.32, -1).normalize().multiplyScalar(fit).add(pivot),
      );
    else if (view === "side")
      this.camera.position.set(fit * 0.87, pivot.y + 0.5, 0);
    else if (view === "top") this.camera.position.set(0.1, pivot.y + fit, 0);
    else this.camera.position.fromArray(positions[view]);
    this.orbit.target.copy(pivot);
    if (view === "chamber" && this.room) {
      const bounds = new T.Box3().setFromObject(this.room),
        target = bounds.getCenter(new T.Vector3());
      const direction = new T.Vector3(1, 0.48, -1.15).normalize();
      const right = new T.Vector3()
        .crossVectors(new T.Vector3(0, 1, 0), direction)
        .normalize();
      const up = new T.Vector3().crossVectors(direction, right).normalize();
      const vertical = Math.tan(T.MathUtils.degToRad(this.camera.fov / 2));
      let distance = 0;
      for (const x of [bounds.min.x, bounds.max.x])
        for (const y of [bounds.min.y, bounds.max.y])
          for (const z of [bounds.min.z, bounds.max.z]) {
            const corner = new T.Vector3(x, y, z).sub(target);
            distance = Math.max(
              distance,
              corner.dot(direction) +
                Math.max(
                  Math.abs(corner.dot(right)) / (vertical * this.camera.aspect),
                  Math.abs(corner.dot(up)) / vertical,
                ),
            );
          }
      this.camera.position.copy(
        direction.multiplyScalar(distance * 1.1).add(target),
      );
      this.orbit.target.copy(target);
    }
    this.orbit.update();
  }
  setPaused(paused: boolean) {
    this.paused = paused;
    this.dirty = true;
  }

  private ensureMechanics() {
    if (this.mechanics || !this.mechanicalSource) return;
    const { model, clips, id } = this.mechanicalSource;
    const group = new T.Group();
    group.position.copy(pivot);
    group.add(model);
    this.scene.add(group);
    this.mechanicalAircraft = group;
    this.mechanics = new AircraftMechanics(model, id, clips);
    for (const root of this.mechanics.getMovingRoots()) batchStaticMeshes(root);
    batchStaticMeshes(model);
    const ghosts = new Map<T.Material, T.Material>();
    model.traverse((node) => {
      if (
        !(node instanceof T.Mesh) ||
        node instanceof T.InstancedMesh ||
        Array.isArray(node.material)
      )
        return;
      for (
        let parent: T.Object3D | null = node;
        parent && parent !== model;
        parent = parent.parent
      ) {
        if (
          parent.userData.mechanical &&
          !/door|canopy|window/i.test(parent.name)
        )
          return;
      }
      const solid: T.Material = node.material;
      const ghost = ghosts.get(solid) ?? solid.clone();
      if (!ghosts.has(solid)) {
        ghost.transparent = true;
        ghost.opacity = 0.11;
        ghost.depthWrite = false;
        ghosts.set(solid, ghost);
      }
      this.ghostShells.set(node, { solid, ghost });
    });
    // Keep moving aircraft hardware out of the fixed shadow map. Chamber and
    // support shadows remain cached rather than refreshing for every tiny hinge.
    model.traverse((node) => {
      if (node instanceof T.Mesh) {
        node.castShadow = false;
        node.receiveShadow = true;
      }
    });
    this.mechanics.apply(
      mechanismPose(this.mechanicalTime, this.mechanicalProgramme),
      this.mechanicalTime,
    );
    this.setRevealMechanisms(this.revealMechanisms);
  }
  setMechanics(enabled: boolean, programme: MechanismProgramme) {
    const switched = enabled !== this.mechanicalEnabled;
    this.mechanicalEnabled = enabled;
    if (programme !== this.mechanicalProgramme) this.mechanicalTime = 0;
    this.mechanicalProgramme = programme;
    if (enabled) this.ensureMechanics();
    else this.mechanics?.reset();
    if (switched) {
      // Dispose only inactive GPU buffers; CPU geometry and articulation stay
      // available for an inexpensive re-upload on the next mode switch.
      const hidden = enabled ? this.aircraft : this.mechanicalAircraft;
      const geometry = new Set<T.BufferGeometry>();
      hidden?.traverse((node) => {
        if (node instanceof T.Mesh) geometry.add(node.geometry);
      });
      geometry.forEach((g) => g.dispose());
    }
    if (this.pitchRig)
      this.pitchRig.rotation.x = enabled
        ? 0
        : T.MathUtils.degToRad(this.solution?.conditions.alpha ?? 0);
    this.applyLayers();
    this.invalidateShadows();
    this.dirty = true;
  }
  setRevealMechanisms(reveal: boolean) {
    this.revealMechanisms = reveal;
    for (const [mesh, { solid, ghost }] of this.ghostShells)
      mesh.material = reveal ? ghost : solid;
    this.dirty = true;
  }
  seekMechanics(time: number) {
    this.mechanicalTime = T.MathUtils.clamp(time, 0, 36);
    this.mechanics?.apply(
      mechanismPose(this.mechanicalTime, this.mechanicalProgramme),
      this.mechanicalTime,
    );
    this.dirty = true;
  }
  getMechanismTime() {
    return this.mechanicalTime;
  }
  focusMechanism(focus: "gear" | "controls" | "power" | "cockpit") {
    if (!this.mechanics) return;
    this.currentView = "test";
    this.camera.fov = 38;
    this.camera.near = 0.1;
    this.orbit.minDistance = 1.2;
    this.camera.updateProjectionMatrix();
    const cabin = this.mechanicalAircraft?.getObjectByName("Cockpit");
    const bounds =
      focus === "cockpit" && cabin?.userData.inspection_bounds_glTF;
    const box = bounds
      ? new T.Box3(
          new T.Vector3().fromArray(bounds[0]),
          new T.Vector3().fromArray(bounds[1]),
        ).applyMatrix4(cabin!.matrixWorld)
      : new T.Box3().setFromObject(this.mechanics.focus(focus));
    if (bounds && this.mechanics.diagnostics().pose.canopy > 0.2) {
      const canopy = cabin?.getObjectByName("Canopy");
      if (canopy) box.union(new T.Box3().setFromObject(canopy));
    }
    const target = box.getCenter(new T.Vector3()),
      size = box.getSize(new T.Vector3());
    const distance = Math.max(
      1.8,
      (size.length() / Math.min(1, this.camera.aspect)) * 1.65,
    );
    this.camera.position.copy(
      new T.Vector3(
        1,
        focus === "gear" ? -0.15 : focus === "cockpit" ? 0.45 : 0.25,
        focus === "power" &&
          (this.aircraftId === "peregrine" || this.aircraftId === "stormbird")
          ? 0.9
          : focus === "cockpit"
            ? 0.7
            : -0.65,
      )
        .normalize()
        .multiplyScalar(distance)
        .add(target),
    );
    this.orbit.target.copy(target);
    this.orbit.update();
    this.dirty = true;
  }
  displayView() {
    const root = (
      this.mechanicalEnabled ? this.mechanicalAircraft : this.aircraft
    )?.getObjectByName("Cockpit_live_displays")?.parent;
    if (!root || !this.displays) return;
    this.currentView = "displays";
    this.applyChamberView();
    const target = this.displays.viewTarget(root);
    this.camera.fov =
      this.aircraftId === "finch"
        ? 55
        : this.aircraftId === "peregrine"
          ? 106
          : 92;
    this.camera.near = 0.025;
    this.camera.updateProjectionMatrix();
    this.orbit.minDistance = 0.1;
    const distance =
      (target.width /
        (2 *
          Math.tan(T.MathUtils.degToRad(this.camera.fov / 2)) *
          Math.min(1, this.camera.aspect))) *
      1.08;
    this.camera.position
      .copy(target.center)
      .addScaledVector(target.forward, distance)
      .addScaledVector(target.up, target.width * 0.08);
    this.orbit.target.copy(target.center);
    this.orbit.update();
    this.dirty = true;
  }
  pilotView() {
    const eye = this.mechanicalAircraft?.getObjectByName("PilotEye_Left");
    if (!eye) return;
    this.camera.fov = 62;
    this.camera.updateProjectionMatrix();
    eye.getWorldPosition(this.camera.position);
    this.orbit.target
      .copy(this.camera.position)
      .add(new T.Vector3(0, -0.8, -3));
    this.orbit.update();
    this.dirty = true;
  }

  internalSystemsView() {
    const bay = this.mechanicalAircraft?.getObjectByName("InternalSystems");
    if (!bay) return;
    this.currentView = "internal";
    this.applyChamberView();
    this.camera.fov = 42;
    this.camera.near = 0.025;
    this.camera.updateProjectionMatrix();
    this.orbit.minDistance = 0.1;
    const box = new T.Box3().setFromObject(bay);
    const target = box.getCenter(new T.Vector3());
    const distance = box.getSize(new T.Vector3()).length() /
      (2 * Math.tan(T.MathUtils.degToRad(this.camera.fov / 2)) * Math.min(1, this.camera.aspect)) * 1.1;
    this.camera.position.copy(target).addScaledVector(new T.Vector3(1, -0.22, 0.85).normalize(), distance);
    this.orbit.target.copy(target);
    this.orbit.update();
    this.dirty = true;
  }

  rearCabinView() {
    const cabin = this.mechanicalAircraft?.getObjectByName("Cockpit");
    if (!cabin) return;
    this.currentView = "cabin";
    this.applyChamberView();
    this.camera.fov = 82;
    this.camera.near = 0.01;
    this.camera.updateProjectionMatrix();
    this.orbit.minDistance = 0.05;
    this.camera.position.copy(cabin.localToWorld(new T.Vector3(0, 0.23, 0.40)));
    this.orbit.target.copy(cabin.localToWorld(new T.Vector3(0, 0.12, 0.94)));
    this.orbit.update();
    this.dirty = true;
  }

  private tick = (time: number) => {
    if (this.dead) return;
    const dt = this.last ? Math.min(0.05, (time - this.last) / 1000) : 0;
    this.last = time;
    const animated = !document.hidden && !this.paused;
    if (animated) {
      this.displayTime += dt;
      // Metres of visual travel: scaled real airspeed, with arc-length sampling
      // and tapered tails so the nose-to-tail direction is unambiguous.
      this.phase += dt * (this.solution?.conditions.speed ?? 30) * 0.18;
      if (this.fan && this.layers.chamber) this.fan.rotation.z += dt * 0.9;
      if (this.layers.flow && !this.mechanicalEnabled) this.animateAirflow();
      if (this.mechanicalEnabled && this.mechanics) {
        this.mechanicalTime += dt;
        this.mechanics.apply(
          mechanismPose(this.mechanicalTime, this.mechanicalProgramme),
          this.mechanicalTime,
        );
      }
    }
    this.orbit.update();
    if (!document.hidden && this.displays && (animated || this.dirty)) {
      const speed = this.solution?.conditions.speed ?? 0;
      const state = this.mechanicalEnabled
        ? displayDemo(this.mechanicalTime, speed)
        : {
            time: this.displayTime,
            mode: "tunnel" as const,
            speed,
            altitude: 0,
            pitch: T.MathUtils.degToRad(this.solution?.conditions.alpha ?? 0),
            roll: 0,
            heading: 0,
            verticalSpeed: 0,
            power: 0,
            fuel: null,
            x: 0,
            z: 0,
            engineOut: false,
            stall: false,
          };
      if (
        this.displays.update(
          state,
          this.camera.position.distanceTo(pivot) < 30,
          this.paused && this.dirty,
        )
      )
        this.dirty = true;
    }
    if (
      !document.hidden &&
      (this.dirty ||
        (animated &&
          (this.layers.flow || this.layers.chamber || this.mechanicalEnabled)))
    ) {
      this.renderer.render(this.scene, this.camera);
      this.renderedFrames++;
      this.dirty = false;
    }
    this.frame = requestAnimationFrame(this.tick);
  };

  dispose() {
    this.dead = true;
    this.ticket++;
    this.tracer.terminate();
    this.queuedTrace = null;
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    this.orbit.dispose();
    this.displays?.dispose();
    if (this.mechanicalSource && !this.mechanicalAircraft)
      disposeObject(this.mechanicalSource.model);
    disposeObject(this.scene);
    for (const { ghost } of this.ghostShells.values()) ghost.dispose();
    this.scene.environment?.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
