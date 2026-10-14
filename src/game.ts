import * as T from "three";
import { displayDemo } from "./cockpit-displays";
import { makeWorld } from "./world";
import type { AircraftId, AircraftModel } from "./aircraft";
import { initialJetInput } from "./jet-effects";
import type { JetMotion } from "./jet-effects";
import { makeAircraft, disposeAircraft } from "./aircraft";
import { FlightPhysics } from "./physics";
import { instrumentData, type InstrumentData } from "./hud/instrument-data";
import type { Controls } from "./physics";
import type { ContactPart } from "./airframe-contact";
import { ISLAND_FLIGHT_MODEL } from "./flight-envelope";
import { missions, scoreFlight } from "./missions";
import type { Mission, FlightResult } from "./missions";
import { FlightAudio } from "./audio";
import { terrainHeight, runways } from "./terrain";
import { FlightVfx, type VfxInput } from "./flight-vfx";
import { ReplayTimeline } from "./replay";
import { ReplayVideoExport } from "./replay-export";
import { ReplayLibrary } from "./replay-library";
import { saveFrames, type SavedReplay } from "./replay-data";
import { STORMBIRD_PILOT_EYE } from "./stormbird-config";
import type { ExportState } from "./replay-export";
import type { SurfacePose } from "./control-surfaces";
export type CameraMode = "chase" | "cockpit" | "landing" | "cinematic";
export type GameMode = "menu" | "playing" | "paused" | "result" | "replay";
export type Snapshot = {
  speed: number;
  altitude: number;
  agl: number;
  throttle: number;
  health: number;
  heading: number;
  verticalSpeed: number;
  wind: number;
  time: number;
  ring: number;
  totalRings: number;
  objective: string;
  hint: string;
  stall: boolean;
  grounded: boolean;
  gearPosition: number;
  flapPosition: number;
  automaticConfiguration: boolean;
  speedProtection: boolean;
  elevatorTrim: number;
  damage: FlightPhysics["damage"];
  x: number;
  z: number;
  pitch: number;
  roll: number;
  target: { x: number; y: number; distance: number; visible: boolean } | null;
  camera: CameraMode;
  mode: GameMode;
  fps: number;
  replayDuration: number;
  replayElapsed: number;
  replayTrimmed: boolean;
  exportSupported: boolean;
  replayExport: ExportState;
  instruments: InstrumentData;
};
export type ReplayFrame = {
  gearPosition?: number;
  flapPosition?: number;
  automaticConfiguration?: boolean;
  simulationTick?: number;
  suspensionResolved?: boolean;
  elevatorTrim?: number;
  p: T.Vector3;
  q: T.Quaternion;
  t: number;
  worldTime: number;
  jet?: Omit<JetMotion, "update">;
  throttle: number;
  speed: number;
  suspension: number;
  gearDamage: number;
  propAngle: number;
  propRpm: number;
  surfaces: SurfacePose;
  propVisible: boolean;
  gearVisible: boolean;
  wings: boolean[];
  engineOut: boolean;
  night: boolean;
  ring: number;
  debris: { p: T.Vector3; q: T.Quaternion; visible: boolean }[];
};
export class PocketFlight {
  readonly renderer: T.WebGLRenderer;
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(48, 1, 0.2, 11000);
  readonly physics = new FlightPhysics();
  aircraft: AircraftModel;
  readonly world: ReturnType<typeof makeWorld>;
  readonly audio = new FlightAudio();
  mode: GameMode = "menu";
  cameraMode: CameraMode = "chase";
  mission: Mission = missions[0];
  night = false;
  ringIndex = 0;
  keys = new Set<string>();
  touch = { pitch: 0, roll: 0, yaw: 0 };
  onSnapshot: (s: Snapshot) => void = () => {};
  onResult: (r: FlightResult) => void = () => {};
  onToast: (text: string) => void = () => {};
  private cockpit = new T.Group();
  private crashDelay = 0;
  private ringGroup = new T.Group();
  private rings: T.Group[] = [];
  private frame = 0;
  private time = 0;
  private last = 0;
  private accumulator = 0;
  private previousPosition = new T.Vector3();
  private previousQuaternion = new T.Quaternion();
  private renderPosition = new T.Vector3();
  private renderQuaternion = new T.Quaternion();
  private emitTime = 0;
  private fps = 60;
  private replay = new ReplayTimeline<ReplayFrame>();
  private library: ReplayLibrary | null = null;
  private recordingId = crypto.randomUUID();
  private recordingDate = Date.now();
  private recordingAircraft: AircraftId = "finch";
  private recordingPaint = 0;
  private paintIndex = 0;
  private savedStamp = "";
  private nextArchive = 10;
  private suspended = false;
  get replayLibrary() {
    return (this.library ??= new ReplayLibrary());
  }
  setSuspended(value: boolean) {
    this.suspended = value;
    this.audio.setVisible(!value && !document.hidden);
    if (value) this.audio.update(0, 0, false);
    this.keys.clear();
    this.last = performance.now();
  }
  captureSavedReplay(): SavedReplay | null {
    if (this.replay.duration < 1) return null;
    return {
      schemaVersion: 1,
      flightModel: ISLAND_FLIGHT_MODEL,
      id: this.recordingId,
      name: this.mission.name,
      aircraft: this.recordingAircraft,
      paint: this.recordingPaint,
      mission: this.mission.id,
      createdAt: this.recordingDate,
      updatedAt: Date.now(),
      duration: this.replay.duration,
      trimmed: this.replay.trimmed,
      frames: saveFrames(this.replay.toArray()),
    };
  }
  async archiveReplay() {
    const stamp = `${this.recordingId}:${this.replay.duration}:${this.replay.length}`;
    if (stamp === this.savedStamp) return this.recordingId;
    const replay = this.captureSavedReplay();
    if (!replay) return null;
    await this.replayLibrary.saveReplay(replay);
    if (replay.id === this.recordingId) this.savedStamp = stamp;
    return replay.id;
  }
  private archiveQuietly() {
    void this.archiveReplay().catch(() =>
      this.onToast(
        "Replay could not save to browser storage. Your current replay is still available.",
      ),
    );
  }
  readonly replayVideo = new ReplayVideoExport();
  private replayLive: ReplayFrame | null = null;
  private replaySample: ReplayFrame | null = null;
  private replayEnded = false;
  private replayReturnCamera: CameraMode = "chase";
  private replayClock = 0;
  private orbit = { x: 0, y: 0 };
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private landingSink = 0;
  private landingAccuracy = 0;
  private landedAt = "";
  private airborne = false;
  private debris: {
    mesh: T.Object3D;
    v: T.Vector3;
    spin: T.Vector3;
    life: number;
  }[] = [];
  readonly vfx = new FlightVfx();
  private vfxVelocity = new T.Vector3();
  private vfxUp = new T.Vector3();
  private vfxLoad = 1;
  private vfxViewport = new T.Vector2();
  private result: FlightResult | null = null;
  private disposed = false;
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)")
    .matches;
  constructor(
    private container: HTMLElement,
    aircraftId: AircraftId = "finch",
  ) {
    this.aircraft = makeAircraft(0, aircraftId);
    this.physics.aircraftId = aircraftId;
    this.audio.jet = aircraftId !== "finch";
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Pocket Flight 3D island and aircraft",
    );
    this.world = makeWorld(this.scene);
    this.scene.add(this.aircraft.group, this.ringGroup, this.camera);
    this.scene.add(this.vfx.group);
    this.physics.reset();
    this.resize();
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.keydown);
    window.addEventListener("keyup", this.keyup);
    window.addEventListener("blur", this.blur);
    document.addEventListener("visibilitychange", this.visibility);
    this.renderer.domElement.addEventListener("pointerdown", this.pointerdown);
    window.addEventListener("pointermove", this.pointermove);
    window.addEventListener("pointerup", this.pointerup);
    this.renderer.domElement.addEventListener("contextmenu", this.contextmenu);
    this.camera.position.set(-740, 480, 1100);
    this.camera.lookAt(-20, 50, -120);
    this.frame = requestAnimationFrame(this.tick);
  }
  private resize = () => {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };
  private keydown = (e: KeyboardEvent) => {
    if (
      document.querySelector('[role="dialog"]') ||
      (e.target as HTMLElement)?.closest("input,textarea,select")
    )
      return;
    if (
      [
        "ArrowUp",
        "ArrowDown",
        "ArrowLeft",
        "ArrowRight",
        "Space",
        "ShiftLeft",
        "ShiftRight",
        "ControlLeft",
        "ControlRight",
        "Tab",
      ].includes(e.code)
    )
      e.preventDefault();
    if (this.replayVideo.busy) {
      if (e.code === "Escape" || e.code === "KeyP") this.stopReplay();
      return;
    }
    if (e.code === "BracketLeft") this.adjustTrim(-0.02);
    if (e.code === "BracketRight") this.adjustTrim(0.02);
    if (e.repeat) {
      this.keys.add(e.code);
      return;
    }
    this.keys.add(e.code);
    if (e.code === "Escape" || e.code === "KeyP") {
      if (this.mode === "playing") this.pause();
      else if (this.mode === "paused") this.resume();
      else if (this.mode === "replay") this.stopReplay();
    }
    if (e.code === "KeyC") this.cycleCamera();
    if (e.code === "KeyR" && this.mode !== "menu") this.start(this.mission);
    if (e.code === "KeyM") this.audio.toggle();
    if (e.code === "KeyG") this.toggleGear();
    if (e.code === "KeyF") this.cycleFlaps();
  };
  toggleGear() {
    if (this.mode !== "playing") return;
    if (!this.physics.jet) { this.onToast("Finch has fixed landing gear."); return; }
    if (this.physics.automaticConfiguration) { this.onToast("For manual gear, turn off Automatic gear and flaps in Settings → Controls."); return; }
    if (!this.physics.toggleGear()) this.onToast("Gear stays down while weight is on the wheels.");
    else this.onToast(this.physics.gearCommand ? "Gear commanded down." : "Gear commanded up.");
  }
  cycleFlaps() {
    if (this.mode !== "playing") return;
    if (!this.physics.jet) { this.onToast("Finch has no movable flaps."); return; }
    if (!this.physics.cycleFlaps()) this.onToast("For manual flaps, turn off Automatic gear and flaps in Settings → Controls.");
    else this.onToast(`Flaps commanded ${Math.round(this.physics.flapCommand * 100)}%.`);
  }
  adjustTrim(change: number) {
    if (this.mode !== "playing") return;
    if (this.physics.beginnerAssist) { this.onToast("Flight assist handles trim. For manual trim, turn it off in Settings → Controls."); return; }
    this.physics.elevatorTrim = T.MathUtils.clamp(this.physics.elevatorTrim + change, -1, 1);
    this.onToast(`Elevator trim ${Math.round(this.physics.elevatorTrim * 100)}%.`);
  }
  private keyup = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };
  private blur = () => {
    this.keys.clear();
    if (this.mode === "playing") this.pause();
  };
  private visibility = () => {
    this.audio.setVisible(!document.hidden && !this.suspended);
    if (document.hidden) {
      this.blur();
      if (this.mode === "replay") {
        if (this.replayVideo.busy)
          this.replayVideo.cancel(
            "Video export stopped because the tab was hidden. Keep this tab visible while downloading; your replay is still available.",
          );
        this.stopReplay();
      }
    }
  };
  private contextmenu = (e: Event) => e.preventDefault();
  private pointerdown = (e: PointerEvent) => {
    if (e.button === 2 || e.altKey) {
      this.dragging = true;
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }
  };
  private pointermove = (e: PointerEvent) => {
    if (this.dragging) {
      this.orbit.x -= (e.clientX - this.lastPointer.x) * 0.005;
      this.orbit.y = T.MathUtils.clamp(
        this.orbit.y + (e.clientY - this.lastPointer.y) * 0.005,
        -0.8,
        1.1,
      );
      this.lastPointer = { x: e.clientX, y: e.clientY };
    }
  };
  private pointerup = () => {
    this.dragging = false;
  };
  private controls(): Controls {
    const k = (...codes: string[]) =>
      codes.some((c) => this.keys.has(c)) ? 1 : 0;
    return {
      pitch: k("ArrowDown", "KeyS") - k("ArrowUp", "KeyW") + this.touch.pitch,
      roll: k("ArrowRight", "KeyD") - k("ArrowLeft", "KeyA") + this.touch.roll,
      yaw: k("KeyE") - k("KeyQ") + this.touch.yaw,
      throttle:
        k("ShiftLeft", "ShiftRight", "Equal") -
        k("ControlLeft", "ControlRight", "Minus"),
      brake: !!k("KeyB", "Space"),
    };
  }
  async selectAircraft(id: AircraftId) {
    if (this.mode !== "menu" || id === this.aircraft.id) return;
    const next = makeAircraft(0, id);
    try {
      await next.ready;
    } catch (error) {
      next.dispose();
      throw error;
    }
    if (this.disposed || this.mode !== "menu") {
      next.dispose();
      return;
    }
    this.scene.remove(this.aircraft.group);
    this.aircraft.dispose();
    this.aircraft = next;
    this.scene.add(next.group);
    this.physics.aircraftId = id;
    this.audio.jet = id !== "finch";
  }
  private updateJet(dt: number) {
    const effects = this.aircraft.effects;
    if (!effects) return;
    const p = this.physics,
      menu = this.mode === "menu";
    const input = {
      ...initialJetInput(),
      ...this.aircraft.surfaces.snapshot(),
      throttle: menu ? 0.45 : p.engineOut || p.crashed ? 0 : p.enginePower,
      speed: menu ? 50 : p.airspeed,
      grounded: !menu && p.grounded,
      controlsResolved: !menu,
      groundSpeed: p.velocity.dot(
        new T.Vector3(0, 0, -1).applyQuaternion(p.quaternion),
      ),
      ...(!menu
        ? {
            gearPosition: p.gearPosition,
            gearSteering: p.gearSteering,
          }
        : {}),
      gear: !menu && p.gearPosition > 0.5,
      damage: menu ? 0 : p.damage.engine,
    };
    input.burner = input.throttle > 0.9;
    input.flaps = menu ? 0 : p.flapPosition;
    if ("setAtmosphericEffects" in effects)
      effects.setAtmosphericEffects(false);
    effects.setReducedMotion(this.reducedMotion);
    effects.update(menu && this.reducedMotion ? 0 : dt, input);
  }
  start(mission: Mission) {
    this.archiveQuietly();
    this.recordingId = crypto.randomUUID();
    this.recordingDate = Date.now();
    this.recordingAircraft = this.aircraft.id;
    this.recordingPaint = this.paintIndex;
    this.nextArchive = 10;
    this.savedStamp = "";
    this.replayVideo.reset();
    this.replayLive = this.replaySample = null;
    this.mission = mission;
    this.crashDelay = 0;
    this.physics.strongWind = mission.id === "crosswind";
    this.physics.reset(mission.airStart, mission.short);
    this.aircraft.surfaces.reset();
    this.aircraft.propellerMotion.reset();
    this.aircraft.effects?.reset();
    this.physics.engineOut = mission.id === "emergency";
    if (this.physics.engineOut) {
      this.physics.throttle = 0;
      this.physics.damage.engine = 0.9;
      this.physics.position.y += 34;
    }
    if (mission.id === "canyon") {
      this.physics.position.set(95, 110, 470);
      this.physics.initializeAirStart(this.physics.jet ? Math.max(48, this.physics.stallSpeed * 1.4) : 34);
    }
    if (mission.id === "free") {
      this.physics.position.y += 100;
      this.physics.yaw = Math.PI;
      this.physics.initializeAirStart(Math.max(this.physics.design.trimSpeed, this.physics.stallSpeed * 1.4));
    }
    this.aircraft.group.scale.setScalar(1);
    this.aircraft.group.visible = true;
    this.aircraft.gear.visible = true;
    for (const w of this.aircraft.wings) w.visible = true;
    this.aircraft.propeller.visible = true;
    this.keys.clear();
    this.touch = { pitch: 0, roll: 0, yaw: 0 };
    this.ringIndex = 0;
    this.airborne = mission.airStart;
    this.landedAt = "";
    this.landingSink = 0;
    this.landingAccuracy = 0;
    this.result = null;
    this.accumulator = 0;
    this.previousPosition.copy(this.physics.position);
    this.previousQuaternion.copy(this.physics.quaternion);
    this.mode = "playing";
    this.vfx.group.visible = true;
    this.replay.clear();
    this.replayClock = 0;
    this.vfx.reset();
    this.vfxVelocity.copy(this.physics.velocity);
    this.cameraMode = "chase";
    this.orbit = { x: 0, y: 0 };
    this.buildRings();
    this.debris.forEach((d) => {
      this.scene.remove(d.mesh);
      disposeAircraft(d.mesh, false);
    });
    this.debris = [];
    this.camera.position
      .copy(this.physics.position)
      .add(
        new T.Vector3(0, 8, 25)
          .multiplyScalar(this.aircraft.cameraScale)
          .applyAxisAngle(new T.Vector3(0, 1, 0), this.physics.yaw),
      );
    this.camera.lookAt(this.physics.position);
    this.audio.start();
    this.recordReplay(true);
    this.onToast(
      mission.airStart
        ? "You have the controls. Enjoy the view."
        : this.physics.jet
          ? this.aircraft.id === "stormbird"
            ? `Hold Shift for thrust. Pull back with ↓ at ${this.physics.profile.rotationKnots} knots. Stormbird accelerates quickly; plan a longer approach.`
            : this.aircraft.id === "aurelia"
              ? `Hold Shift for thrust. Pull back with ↓ at ${this.physics.profile.rotationKnots} knots. ${this.physics.automaticConfiguration ? "Gear and flaps operate automatically." : "G toggles gear; F cycles flaps."}`
              : `Hold Shift for thrust. Pull back with ↓ at ${this.physics.profile.rotationKnots} knots. Full power lights the afterburners.`
          : `Hold Shift to add throttle. Pull back with ↓ at ${this.physics.profile.rotationKnots} knots.`,
    );
    this.emit();
  }
  pause() {
    if (this.mode === "playing") {
      this.recordReplay(true);
      this.archiveQuietly();
      this.mode = "paused";
      this.keys.clear();
      this.touch = { pitch: 0, roll: 0, yaw: 0 };
      this.emit();
    }
  }
  resume() {
    if (this.mode === "paused") {
      this.replayVideo.reset();
      this.mode = "playing";
      this.keys.clear();
      this.emit();
    }
  }
  menu() {
    this.archiveQuietly();
    if (this.mode === "replay") this.stopReplay();
    if (this.replayVideo.busy) this.replayVideo.cancel();
    this.mode = "menu";
    this.vfx.group.visible = false;
    this.aircraft.surfaces.reset();
    this.ringGroup.visible = false;
    this.keys.clear();
    this.aircraft.group.visible = true;
    this.aircraft.gear.visible = true;
    this.aircraft.wings.forEach((w) => (w.visible = true));
    this.aircraft.propeller.visible = true;
    this.emit();
  }
  cycleCamera() {
    const modes: CameraMode[] = ["chase", "cockpit", "landing", "cinematic"];
    this.cameraMode =
      modes[(modes.indexOf(this.cameraMode) + 1) % modes.length];
    this.orbit = { x: 0, y: 0 };
    this.onToast(
      `${this.cameraMode[0].toUpperCase() + this.cameraMode.slice(1)} camera`,
    );
    this.emit();
  }
  setPaint(index: number) {
    this.paintIndex = index;
    this.aircraft.setPaint(index);
  }
  private buildRings() {
    for (const o of this.rings) {
      o.traverse((c) => {
        if (c instanceof T.Mesh) {
          c.geometry.dispose();
          (c.material as T.Material).dispose();
        }
      });
    }
    this.ringGroup.clear();
    this.rings = [];
    this.ringGroup.visible = true;
    this.mission.rings.forEach((p, i) => {
      const ring = new T.Group();
      ring.position.copy(p);
      const previous = i ? this.mission.rings[i - 1] : this.physics.position;
      const direction = p.clone().sub(previous).normalize();
      ring.quaternion.setFromUnitVectors(new T.Vector3(0, 0, 1), direction);
      const torus = new T.Mesh(
        new T.TorusGeometry(19, 0.55, 10, 72),
        new T.MeshStandardMaterial({
          color: "#ffdb83",
          emissive: "#ecab41",
          emissiveIntensity: 0.5,
          transparent: true,
          opacity: 1,
        }),
      );
      ring.add(torus);
      const inner = new T.Mesh(
        new T.TorusGeometry(18.1, 0.1, 6, 64),
        new T.MeshBasicMaterial({
          color: "#fff4c2",
          transparent: true,
          opacity: 0.6,
        }),
      );
      ring.add(inner);
      for (let a = 0; a < 4; a++) {
        const tick = new T.Mesh(
          new T.BoxGeometry(2, 0.7, 0.7),
          new T.MeshBasicMaterial({ color: "#fff3c8" }),
        );
        tick.position.set(
          Math.cos((a * Math.PI) / 2) * 19,
          Math.sin((a * Math.PI) / 2) * 19,
          0,
        );
        tick.rotation.z = (a * Math.PI) / 2;
        ring.add(tick);
      }
      this.rings.push(ring);
      this.ringGroup.add(ring);
    });
  }
  private makeDebris(severity: number, struckPart?: ContactPart, point?: number[]) {
    const p = this.physics;
    const count = severity > 0.8 ? 14 : 5;
    for (let i = 0; i < count; i++) {
      const m = new T.Mesh(
        new T.BoxGeometry(
          0.15 + Math.random() * 1.5,
          0.12,
          0.4 + Math.random(),
        ),
        new T.MeshStandardMaterial({
          color: i % 2 ? "#e9b751" : "#65716d",
          metalness: 0.2,
          roughness: 0.5,
        }),
      );
      m.position
        .copy(point ? new T.Vector3().fromArray(point) : p.position)
        .add(
          new T.Vector3(
            (Math.random() - 0.5) * 4,
            0,
            (Math.random() - 0.5) * 3,
          ),
        );
      this.scene.add(m);
      this.debris.push({
        mesh: m,
        v: p.velocity
          .clone()
          .multiplyScalar(0.5)
          .add(
            new T.Vector3(
              (Math.random() - 0.5) * 14,
              3 + Math.random() * 7,
              (Math.random() - 0.5) * 14,
            ),
          ),
        spin: new T.Vector3(
          Math.random() * 5,
          Math.random() * 5,
          Math.random() * 5,
        ),
        life: 20,
      });
    }
    if (severity > 0.8 && (struckPart === "leftWing" || struckPart === "rightWing")) {
      const wing = this.aircraft.wings[struckPart === "leftWing" ? 0 : 1];
      if (!wing.visible) return;
      const part = wing.clone(true);
      part.traverse((object) => {
        if (object instanceof T.Mesh) {
          object.geometry = object.geometry.clone();
          object.material = Array.isArray(object.material)
            ? object.material.map((material) => material.clone())
            : object.material.clone();
        }
      });
      part.position.copy(p.position);
      part.quaternion.copy(p.quaternion);
      this.scene.add(part);
      this.debris.push({
        mesh: part,
        v: p.velocity
          .clone()
          .multiplyScalar(0.65)
          .add(new T.Vector3(7, 8, 0)),
        spin: new T.Vector3(1, 2, 1),
        life: 30,
      });
      wing.visible = false;
    }
    if (p.damage.propeller > 0.8) this.aircraft.propeller.visible = false;
  }
  private finish(success: boolean) {
    if (this.mode !== "playing") return;
    const p = this.physics;
    const score = scoreFlight(
      p.flightTime,
      this.mission.par,
      p.health,
      this.landingSink,
      this.mission.land ? this.landingAccuracy : 1,
      this.ringIndex,
    );
    this.result = {
      success,
      title: success ? "A flight to remember." : "Every pilot has a story.",
      medal: success ? score.medal : null,
      score: success ? score.score : 0,
      time: p.flightTime,
      smoothness: score.smoothness,
      accuracy: this.landingAccuracy * 100,
      health: p.health,
      mission: this.mission.name,
    };
    this.recordReplay(true);
    this.mode = "result";
    this.archiveQuietly();
    this.audio.chime(success);
    this.onResult(this.result);
    this.emit();
  }
  private captureReplayFrame(): ReplayFrame {
    const p = this.physics;
    return {
      p: p.position.clone(),
      q: p.quaternion.clone(),
      t: p.flightTime,
      simulationTick: p.simulationTick,
      suspensionResolved: true,
      elevatorTrim: p.elevatorTrim,
      gearPosition: p.gearPosition,
      flapPosition: p.flapPosition,
      automaticConfiguration: p.automaticConfiguration,
      worldTime: this.time,
      jet: this.aircraft.effects
        ? { ...this.aircraft.effects.motion }
        : undefined,
      throttle: p.throttle,
      speed: p.airspeed,
      suspension: p.suspension,
      gearDamage: p.damage.gear,
      propAngle: this.aircraft.propeller.rotation.z,
      propRpm: this.aircraft.propellerMotion.snapshot().rpm,
      surfaces: this.aircraft.surfaces.snapshot(),
      propVisible: this.aircraft.propeller.visible,
      gearVisible: this.aircraft.gear.visible,
      wings: this.aircraft.wings.map((w) => w.visible),
      engineOut: p.engineOut,
      night: this.night,
      ring: this.ringIndex,
      debris: this.debris.map((d) => ({
        p: d.mesh.position.clone(),
        q: d.mesh.quaternion.clone(),
        visible: d.mesh.visible,
      })),
    };
  }
  private recordReplay(force = false) {
    const last = this.replay.length
      ? this.replay.at(this.replay.length - 1)
      : null;
    if (force || !last || this.physics.flightTime - last.t >= 1 / 15 - 1e-6)
      this.replay.push(this.captureReplayFrame());
  }
  private applyReplayVisuals(frame: ReplayFrame) {
    const a = this.aircraft;
    if (a.effects && frame.jet) {
      Object.assign(a.effects.motion, frame.jet);
      a.effects.update(0, { ...initialJetInput(), lights: true });
    }
    a.gear.visible = frame.gearVisible;
    a.gear.rotation.z = 0;
    a.propeller.visible = frame.propVisible;
    a.propellerMotion.apply({ angle: frame.propAngle, rpm: frame.propRpm });
    a.wings.forEach((w, i) => (w.visible = frame.wings[i]));
    a.setSuspension(frame.suspension);
    a.surfaces.apply(frame.surfaces);
    this.rings.forEach((r, i) => (r.visible = i >= frame.ring));
    this.debris.forEach((d, i) => {
      const pose = frame.debris[i];
      d.mesh.visible = !!pose?.visible;
      if (pose) {
        d.mesh.position.copy(pose.p);
        d.mesh.quaternion.copy(pose.q);
      }
    });
  }
  private poseReplay(snapCamera = false) {
    const sample = this.replay.sample(this.replayClock);
    if (!sample) return;
    const { a, b, mix } = sample;
    const visual = mix === 1 ? b : a;
    this.replaySample = visual;
    const model = this.aircraft.group;
    model.scale.setScalar(1);
    model.position.lerpVectors(a.p, b.p, mix);
    model.quaternion.slerpQuaternions(a.q, b.q, mix);
    model.position.add(
      new T.Vector3(
        0,
        -this.aircraft.bodyCompression(
          T.MathUtils.lerp(a.suspension, b.suspension, mix),
          a.suspensionResolved === true,
        ),
        0,
      ).applyQuaternion(model.quaternion),
    );
    this.applyReplayVisuals(visual);
    if (a.jet && b.jet && this.aircraft.effects) {
      const motion = this.aircraft.effects.motion;
      for (const key of Object.keys(a.jet) as (keyof typeof a.jet)[]) {
        // Continuous, unwrapped phases prevent 15 Hz stepping and backwards fan jumps.
        motion[key] = T.MathUtils.lerp(a.jet[key], b.jet[key], mix);
      }
      this.aircraft.effects.update(0, { ...initialJetInput(), lights: true });
    }
    this.aircraft.setSuspension(
      T.MathUtils.lerp(a.suspension, b.suspension, mix),
    );
    this.aircraft.surfaces.apply({
      roll: T.MathUtils.lerp(a.surfaces.roll, b.surfaces.roll, mix),
      pitch: T.MathUtils.lerp(a.surfaces.pitch, b.surfaces.pitch, mix),
      yaw: T.MathUtils.lerp(a.surfaces.yaw, b.surfaces.yaw, mix),
    });
    this.aircraft.propellerMotion.apply({
      angle: T.MathUtils.lerp(a.propAngle, b.propAngle, mix),
      rpm: T.MathUtils.lerp(a.propRpm, b.propRpm, mix),
    });
    const attitude = new T.Euler().setFromQuaternion(model.quaternion, "YXZ");
    this.aircraft.displays?.update(
      {
        time: T.MathUtils.lerp(a.t, b.t, mix),
        mode: "replay",
        speed: T.MathUtils.lerp(a.speed, b.speed, mix),
        altitude: T.MathUtils.lerp(a.p.y, b.p.y, mix),
        pitch: attitude.x,
        roll: attitude.z,
        heading: -attitude.y,
        verticalSpeed: b.t > a.t ? (b.p.y - a.p.y) / (b.t - a.t) : 0,
        power: T.MathUtils.lerp(a.throttle, b.throttle, mix),
        fuel: null,
        x: model.position.x,
        z: model.position.z,
        engineOut: visual.engineOut,
        stall: false,
      },
      this.camera.position.distanceTo(model.position) < 30,
      snapCamera,
    );
    this.world.update(
      T.MathUtils.lerp(a.worldTime, b.worldTime, mix),
      visual.night,
    );
    this.vfx.render(
      T.MathUtils.lerp(a.t, b.t, mix),
      this.renderer.getDrawingBufferSize(this.vfxViewport).y,
      this.reducedMotion,
      this.camera.aspect,
    );
    const angle = this.replayClock * 0.1;
    const heading = new T.Euler().setFromQuaternion(model.quaternion, "YXZ").y;
    const offset = new T.Vector3(
      Math.sin(angle) * 26 + 17,
      8,
      Math.cos(angle) * 29,
    ).applyAxisAngle(new T.Vector3(0, 1, 0), heading);
    offset.multiplyScalar(this.aircraft.cameraScale);
    const goal = model.position.clone().add(offset);
    goal.y = Math.max(goal.y, terrainHeight(goal.x, goal.z) + 3);
    if (snapCamera) this.camera.position.copy(goal);
    else this.camera.position.lerp(goal, 0.12);
    this.camera.fov = 50;
    this.camera.lookAt(model.position);
  }
  playReplay() {
    if (!this.canReplay || this.replayVideo.busy) return;
    this.vfx.group.visible = true;
    if (this.mode !== "replay") {
      this.replayLive = this.captureReplayFrame();
      this.replayReturnCamera = this.cameraMode;
    }
    this.mode = "replay";
    this.replayClock = 0;
    this.replayEnded = false;
    this.aircraft.group.visible = true;
    this.poseReplay(true);
    this.last = performance.now();
    this.emit();
  }
  downloadReplay() {
    if (!this.canReplay || this.replay.duration < 1 || this.replayVideo.busy)
      return;
    this.playReplay();
    this.camera.updateProjectionMatrix();
    this.renderer.render(this.scene, this.camera);
    if (
      !this.replayVideo.start(
        this.mission.name,
        this.audio.captureTrack(),
        this.renderer.domElement,
        this.replay.duration,
      )
    )
      this.stopReplay();
    this.last = performance.now();
    this.emit();
  }
  stopReplay() {
    if (this.replayVideo.state.phase === "recording") this.replayVideo.cancel();
    this.mode = this.result ? "result" : "paused";
    this.cameraMode = this.replayReturnCamera;
    if (this.replayLive) this.applyReplayVisuals(this.replayLive);
    this.world.update(this.time, this.night);
    this.vfx.render(
      this.physics.flightTime,
      this.renderer.getDrawingBufferSize(this.vfxViewport).y,
      this.reducedMotion,
      this.camera.aspect,
    );
    this.aircraft.group.position.copy(this.physics.position);
    this.aircraft.group.quaternion.copy(this.physics.quaternion);
    this.replaySample = this.replayLive = null;
    this.replayEnded = false;
    this.emit();
  }
  private vfxInput(): VfxInput {
    const p = this.physics;
    return {
      id: this.aircraft.id,
      time: p.flightTime,
      position: p.position,
      rotation: p.quaternion,
      velocity: p.velocity,
      wind: p.wind,
      damage: p.damage.engine,
      speed: p.airspeed,
      grounded: p.grounded,
      load: this.vfxLoad,
      suspension: p.suspension,
    };
  }
  private updateMission(previous: T.Vector3) {
    const p = this.physics;
    if (p.crashed && this.crashDelay > 0) {
      this.crashDelay -= 1 / 60;
      if (this.crashDelay <= 0) this.finish(false);
      return;
    }
    for (const e of p.events) {
      if (e.type === "takeoff") {
        this.airborne = true;
        this.onToast("Beautiful. You’re flying.");
      }
      if (e.type === "impact") {
        this.vfx.impact(this.vfxInput(), e.severity);
        this.makeDebris(e.severity, e.part, e.point);
        this.onToast("Hard impact. Check your aircraft and find a runway.");
        this.audio.chime(false);
      }
      if (e.type === "crash") {
        this.vfx.impact(this.vfxInput(), e.severity);
        this.makeDebris(e.severity, e.part, e.point);
        this.crashDelay = 2.5;
        this.onToast("Heavy impact. Your flight recorder is still running.");
        return;
      }
      if (e.type === "landing")
        this.vfx.touchdown(this.vfxInput(), e.sink ?? 0);
      if (e.type === "landing" && e.runway) {
        this.landedAt = e.runway;
        this.landingSink = e.sink ?? 0;
        this.landingAccuracy = e.accuracy ?? 0;
        this.onToast(
          `${e.part && e.part !== "gear" ? "Airframe touchdown. Assess the damage." : e.sink! < 2 ? "Butter-smooth touchdown." : "Touchdown."} Hold B to brake.`,
        );
      }
    }
    const target = this.mission.rings[this.ringIndex];
    if (target) {
      const segment = p.position.clone().sub(previous);
      const t = T.MathUtils.clamp(
        target.clone().sub(previous).dot(segment) /
          Math.max(0.0001, segment.lengthSq()),
        0,
        1,
      );
      if (
        previous.clone().addScaledVector(segment, t).distanceTo(target) < 18.8
      ) {
        this.rings[this.ringIndex].visible = false;
        this.ringIndex++;
        this.audio.chime();
        this.onToast(
          this.ringIndex === this.mission.rings.length
            ? this.mission.land
              ? "Route complete. Bring it home to Palm Bay."
              : "Route complete. A beautiful flight."
            : `Checkpoint ${this.ringIndex} of ${this.mission.rings.length}`,
        );
      }
    }
    if (this.mission.id === "free") return;
    if (this.ringIndex === this.mission.rings.length) {
      if (!this.mission.land) this.finish(true);
      else if (
        this.airborne &&
        p.grounded &&
        this.landedAt === this.mission.land &&
        p.velocity.length() < 4
      )
        this.finish(true);
    }
    if (this.mission.id === "race" && p.flightTime > this.mission.par * 1.5) {
      this.onToast("The mail missed its connection. Give it another go.");
      this.finish(false);
    }
    if (Math.hypot(p.position.x, p.position.z) > 4000) {
      p.yaw = Math.atan2(p.position.x, p.position.z);
      p.pitch = 0.05;
      this.onToast("Heading back toward the islands.");
    }
  }
  private cameraUpdate(dt: number) {
    const p = this.physics,
      model = this.aircraft.group;
    this.cockpit.visible =
      this.aircraft.id === "finch" &&
      this.cameraMode === "cockpit" &&
      this.mode !== "menu" &&
      this.mode !== "replay";
    if (this.mode === "menu") {
      this.camera.fov = T.MathUtils.damp(this.camera.fov, 48, 2, dt);
      const pos = new T.Vector3(
        -740 + Math.sin(this.time * 0.023) * 75,
        480,
        1100,
      );
      this.camera.position.lerp(pos, 1 - Math.exp(-dt * 2));
      this.camera.lookAt(-20, 50, -120);
      const forward = new T.Vector3();
      this.camera.getWorldDirection(forward);
      const right = new T.Vector3(1, 0, 0).applyQuaternion(
          this.camera.quaternion,
        ),
        up = new T.Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      model.position
        .copy(this.camera.position)
        .addScaledVector(forward, 82)
        .addScaledVector(right, this.camera.aspect < 1 ? 4 : 21)
        .addScaledVector(up, this.camera.aspect < 1 ? -11 : 1);
      model.scale.setScalar(
        (this.camera.aspect < 1 ? 1.65 : 3.8) / this.aircraft.cameraScale,
      );
      model.rotation.set(
        0.065 + Math.sin(this.time * 0.6) * 0.015,
        -0.32,
        -0.12 + Math.sin(this.time * 0.45) * 0.035,
      );
      model.visible = true;
    } else if (this.mode === "replay") {
      this.replayClock = Math.min(this.replayClock + dt, this.replay.duration);
      this.poseReplay();
      this.replayEnded = this.replayClock >= this.replay.duration;
    } else {
      // Physics advances at 60 Hz; interpolate its poses for smooth rendering at any refresh rate.
      const alpha = this.mode === "playing" ? this.accumulator * 60 : 1;
      const position = this.renderPosition.lerpVectors(
        this.previousPosition,
        p.position,
        alpha,
      );
      const quaternion = this.renderQuaternion.slerpQuaternions(
        this.previousQuaternion,
        p.quaternion,
        alpha,
      );
      model.scale.setScalar(1);
      model.position.copy(position);
      model.position.add(
        new T.Vector3(
          0,
          -this.aircraft.bodyCompression(p.suspension, true),
          0,
        ).applyQuaternion(quaternion),
      );
      this.aircraft.setSuspension(p.suspension);
      model.quaternion.copy(quaternion);
      model.visible = true;
      if (this.cameraMode === "cockpit") {
        this.camera.position
          .copy(position)
          .add(
            (this.aircraft.id === "stormbird"
              ? new T.Vector3().fromArray(STORMBIRD_PILOT_EYE)
              : this.aircraft.id === "aurelia"
                ? new T.Vector3(0, 1.265, -5.83)
                : this.physics.jet
                  ? new T.Vector3(0, 1.855, -6.68)
                  : new T.Vector3(-0.3, 1.01, 0.1)
            ).applyQuaternion(quaternion),
          );
        this.camera.quaternion.copy(quaternion);
        this.camera.rotateY(this.orbit.x);
        this.camera.rotateX(-this.orbit.y);
        this.camera.fov = 68;
      } else {
        let offset = new T.Vector3(
          0,
          4.5,
          22 + Math.min(6, p.airspeed * 0.075),
        );
        if (this.cameraMode === "landing") offset.set(17, 5, 20);
        if (this.cameraMode === "cinematic")
          offset.set(
            Math.sin(this.time * 0.14) * 23,
            9,
            Math.cos(this.time * 0.14) * 25,
          );
        offset
          .multiplyScalar(this.aircraft.cameraScale)
          .applyAxisAngle(new T.Vector3(1, 0, 0), this.orbit.y)
          .applyAxisAngle(new T.Vector3(0, 1, 0), p.yaw + this.orbit.x);
        const goal = position.clone().add(offset);
        goal.y = Math.max(
          goal.y,
          Math.max(0, terrainHeight(goal.x, goal.z)) + 3,
        );
        this.camera.position.lerp(
          goal,
          1 -
            Math.exp(
              -dt * (this.mode === "playing" ? (this.physics.jet ? 9 : 4) : 2),
            ),
        );
        // Follow position smoothly, but keep the aircraft centred while banking
        // or catching up after a turn. Looking ahead made it drift off-screen.
        this.camera.lookAt(model.position);
        this.camera.fov = T.MathUtils.damp(
          this.camera.fov,
          50 + Math.min(8, p.airspeed * 0.065),
          2,
          dt,
        );
        if (!this.dragging) {
          this.orbit.x = T.MathUtils.damp(this.orbit.x, 0, 2, dt);
          this.orbit.y = T.MathUtils.damp(this.orbit.y, 0, 2, dt);
        }
        this.camera.rotateZ(Math.sin(this.time * 12) * p.lastImpact * 0.008);
      }
    }
    this.camera.near =
      this.cameraMode === "cockpit" && this.mode !== "replay" ? 0.025 : 0.2;
    this.camera.updateProjectionMatrix();
  }
  private tick = (now: number) => {
    if (this.disposed) return;
    if (this.suspended) {
      this.last = now;
      this.frame = requestAnimationFrame(this.tick);
      return;
    }
    this.frame = requestAnimationFrame(this.tick);
    const elapsed = (now - (this.last || now)) / 1000;
    const dt = Math.min(elapsed, 0.05);
    this.last = now;
    this.fps = T.MathUtils.damp(this.fps, 1 / Math.max(0.001, elapsed), 2, dt);
    const active =
      this.mode === "playing" || this.mode === "menu" || this.mode === "replay";
    if (
      active &&
      this.mode !== "replay" &&
      !(this.mode === "menu" && this.reducedMotion)
    )
      this.time += dt;
    if (this.mode === "playing") {
      this.accumulator += dt;
      while (this.accumulator >= 1 / 60) {
        this.previousPosition.copy(this.physics.position);
        this.previousQuaternion.copy(this.physics.quaternion);
        const input = this.controls();
        this.vfxVelocity.copy(this.physics.velocity);
        this.physics.step(1 / 60, input, this.world.obstacles);
        if (!this.physics.crashed)
          this.aircraft.surfaces.apply(this.physics.surfaces);
        this.vfxUp.set(0, 1, 0).applyQuaternion(this.physics.quaternion);
        this.vfxVelocity
          .subVectors(this.physics.velocity, this.vfxVelocity)
          .multiplyScalar(60);
        this.vfxVelocity.y += 9.81;
        this.vfxLoad = this.physics.grounded
          ? 1
          : Math.abs(this.vfxVelocity.dot(this.vfxUp) / 9.81);
        this.vfx.step(1 / 60, this.vfxInput());
        this.updateMission(this.previousPosition);
        this.accumulator -= 1 / 60;
        if (this.mode !== "playing") {
          this.accumulator = 0;
          break;
        }
      }
    } else this.accumulator = 0;
    if (this.mode === "playing" || this.mode === "menu") {
      this.world.update(this.time, this.night);
      if (this.mode === "menu" && this.reducedMotion)
        this.aircraft.propellerMotion.reset();
      else
        this.aircraft.propellerMotion.update(
          {
            throttle: this.mode === "menu" ? 0.45 : this.physics.enginePower,
            airspeed: this.physics.airspeed,
            damage: this.mode === "menu" ? 0 : this.physics.damage.propeller,
            engineOut: this.mode !== "menu" && this.physics.engineOut,
            crashed: this.mode !== "menu" && this.physics.crashed,
          },
          dt,
        );
      this.updateJet(dt);
      const p = this.physics;
      const fuelCapacity = p.design.massBudget
        .filter((part) => part.category === "fuel")
        .reduce((sum, part) => sum + part.mass, 0);
      this.aircraft.displays?.update(
        this.mode === "menu"
          ? displayDemo(this.time)
          : {
              time: p.flightTime,
              mode: "flight",
              speed: p.airspeed,
              altitude: p.position.y,
              pitch: p.pitch,
              roll: p.roll,
              heading: -p.yaw,
              verticalSpeed: p.velocity.y,
              power: p.enginePower,
              fuel: fuelCapacity ? p.fuelKg / fuelCapacity : null,
              x: p.position.x,
              z: p.position.z,
              engineOut: p.engineOut || p.crashed || p.fuelKg <= 0,
              stall: p.stall,
            },
        this.camera.position.distanceTo(this.aircraft.group.position) < 30,
      );
      if (this.mode === "playing") {
        this.recordReplay();
        if (this.physics.flightTime >= this.nextArchive) {
          this.nextArchive = this.physics.flightTime + 10;
          this.archiveQuietly();
        }
      }
    }
    this.aircraft.gear.rotation.z = 0;
    for (let i = 0; i < this.rings.length; i++) {
      const ring = this.rings[i];
      ring.visible = i >= this.ringIndex;
      ring.children.forEach((o) => {
        if (o instanceof T.Mesh) {
          const m = o.material as T.MeshStandardMaterial;
          m.opacity = i === this.ringIndex ? 1 : 0.3;
        }
      });
    }
    if (active && this.mode !== "replay") {
      for (const d of this.debris) {
        d.life -= dt;
        d.v.y -= 9.81 * dt;
        d.mesh.position.addScaledVector(d.v, dt);
        d.mesh.rotation.x += d.spin.x * dt;
        d.mesh.rotation.y += d.spin.y * dt;
        d.mesh.rotation.z += d.spin.z * dt;
        const floor =
          Math.max(0, terrainHeight(d.mesh.position.x, d.mesh.position.z)) +
          0.2;
        if (d.mesh.position.y < floor) {
          d.mesh.position.y = floor;
          d.v.y = Math.abs(d.v.y) * 0.25;
          d.v.multiplyScalar(0.8);
          d.spin.multiplyScalar(0.8);
        }
      }
    }
    if (this.mode !== "replay")
      this.vfx.render(
        this.physics.flightTime,
        this.renderer.getDrawingBufferSize(this.vfxViewport).y,
        this.reducedMotion,
        this.camera.aspect,
      );
    this.cameraUpdate(this.mode === "replay" ? elapsed : dt);
    const sound = this.replaySample;
    this.audio.update(
      sound
        ? sound.engineOut
          ? 0
          : sound.throttle
        : this.physics.engineOut
          ? 0
          : this.physics.enginePower,
      sound?.speed ?? this.physics.airspeed,
      this.mode === "playing" || this.mode === "replay",
    );
    this.audio.updateMusic({
      mode: this.mode,
      speed: sound?.speed ?? this.physics.airspeed,
      grounded: sound
        ? sound.p.y < terrainHeight(sound.p.x, sound.p.z) + 3
        : this.physics.grounded,
      night: sound?.night ?? this.night,
      warning:
        this.mode === "playing" &&
        (this.physics.stall || this.physics.crashed || this.physics.engineOut),
      visible: !document.hidden && !this.suspended,
    });
    this.renderer.render(this.scene, this.camera);
    this.replayVideo.draw(this.renderer.domElement);
    if (this.mode === "replay" && this.replayEnded) {
      this.replayVideo.finish();
      this.stopReplay();
    }
    this.emitTime += dt;
    if (this.emitTime > 0.1) {
      this.emitTime = 0;
      this.emit();
    }
  };
  private objective() {
    if (this.mode === "menu") return "A little escape awaits.";
    if (this.mission.id === "free") return "The islands are yours. Go explore.";
    if (!this.airborne)
      return this.physics.airspeed * 1.943844 <
        this.physics.profile.rotationKnots
        ? `Throttle up. Pull back at ${this.physics.profile.rotationKnots} knots.`
        : "Gently pull back to lift off.";
    if (this.ringIndex < this.mission.rings.length)
      return `Fly through checkpoint ${this.ringIndex + 1} of ${this.mission.rings.length}`;
    if (this.mission.land)
      return this.physics.grounded
        ? "Hold B to brake to a stop."
        : `Land at ${this.mission.land}`;
    return "Route complete";
  }
  private emit() {
    const p = this.physics;
    let target: Snapshot["target"] = null;
    const point =
      this.mission.rings[this.ringIndex] ??
      (this.mission.land
        ? new T.Vector3(
            ...(() => {
              const r = runways.find((r) => r.name === this.mission.land)!;
              return [r.x, r.y + 4, r.z + r.length * 0.3] as [
                number,
                number,
                number,
              ];
            })(),
          )
        : null);
    if (point) {
      const screen = point.clone().project(this.camera);
      const front =
        point
          .clone()
          .sub(this.camera.position)
          .dot(this.camera.getWorldDirection(new T.Vector3())) > 0;
      target = {
        x: T.MathUtils.clamp(screen.x, -0.86, 0.86),
        y: T.MathUtils.clamp(screen.y, -0.63, 0.63),
        distance: p.position.distanceTo(point),
        visible: front && Math.abs(screen.x) < 0.94 && Math.abs(screen.y) < 0.8,
      };
    }
    this.onSnapshot({
      speed: p.airspeed * 1.94384,
      altitude: p.position.y * 3.28084,
      agl:
        (p.position.y -
          Math.max(0, terrainHeight(p.position.x, p.position.z))) *
        3.28084,
      throttle: p.throttle * 100,
      health: p.health,
      heading: ((((-p.yaw * 180) / Math.PI) % 360) + 360) % 360,
      verticalSpeed: p.verticalSpeed,
      wind: p.wind.length() * 1.94384,
      time: p.flightTime,
      ring: this.ringIndex,
      totalRings: this.mission.rings.length,
      objective: this.objective(),
      hint: p.engineOut
        ? p.jet
          ? "Engine out · maintain 75–90 knots"
          : "Engine out · maintain 55–65 knots"
        : p.stall
          ? "STALL · Lower the nose and add power"
          : p.grounded
            ? "SHIFT throttle · ↓ pull back · B brake"
            : "Arrow keys to fly · Shift / Ctrl throttle",
      stall: p.stall,
      grounded: p.grounded,
      gearPosition: this.replaySample ? this.aircraft.effects?.motion.gear ?? this.replaySample.gearPosition ?? 1 : p.gearPosition,
      flapPosition: this.replaySample ? this.aircraft.effects?.motion.flaps ?? this.replaySample.flapPosition ?? 0 : p.flapPosition,
      automaticConfiguration: this.replaySample?.automaticConfiguration ?? p.automaticConfiguration,
      speedProtection: p.speedProtectionActive,
      elevatorTrim: this.replaySample?.elevatorTrim ?? p.elevatorTrim,
      damage: { ...p.damage },
      x: p.position.x,
      z: p.position.z,
      pitch: p.pitch,
      roll: p.roll,
      target,
      camera: this.cameraMode,
      mode: this.mode,
      fps: this.fps,
      replayDuration: this.replay.duration,
      replayElapsed: this.replayClock,
      replayTrimmed: this.replay.trimmed,
      exportSupported: this.replayVideo.supported,
      replayExport: this.replayVideo.state,
      instruments: instrumentData(p, this.aircraft.propellerMotion.snapshot().rpm),
    });
  }
  get canReplay() {
    return this.replay.length > 1;
  }
  getState() {
    const p = this.physics;
    return {
      mode: this.mode,
      aircraft: this.aircraft.id,
      cockpitDisplays: this.aircraft.displays?.diagnostics(),
      music: this.audio.music?.getState() ?? null,
      position: p.position.toArray(),
      velocity: p.velocity.toArray(),
      speed: p.airspeed,
      grounded: p.grounded,
      crashed: p.crashed,
      health: p.health,
      ring: this.ringIndex,
      mission: this.mission.id,
      throttle: p.throttle,
      pitch: p.pitch,
      roll: p.roll,
      fps: Math.round(this.fps),
      drawCalls: this.renderer.info.render.calls,
      vfx: this.vfx.stats,
      triangles: this.renderer.info.render.triangles,
      enginePower: p.enginePower,
      beginnerAssist: p.beginnerAssist,
      elevatorTrim: p.elevatorTrim,
      flightModel: ISLAND_FLIGHT_MODEL,
      automaticConfiguration: p.automaticConfiguration,
      gearPosition: p.gearPosition,
      gearTarget: p.gearTarget,
      flapPosition: p.flapPosition,
      flapTarget: p.flapCommand,
      wingDamage: { ...p.wingDamage },
      detachedWings: { ...p.detachedWings },
      simulationTick: p.simulationTick,
      speedProtection: p.speedProtectionActive,
      wheelContacts: p.wheelContacts.map((c) => ({ index: c.index, loadNewtons: c.load, compression: c.compression, closingSpeed: c.closingSpeed, locked: c.locked, runway: c.runway })),
      aerodynamics: p.aerodynamics
        ? {
            alpha: p.aerodynamics.alpha,
            beta: p.aerodynamics.beta,
            density: p.aerodynamics.density,
            dynamicPressure: p.aerodynamics.dynamicPressure,
            liftNewtons: p.aerodynamics.lift,
            dragNewtons: p.aerodynamics.drag,
            massKg: p.loadedMass,
            cgMetres: p.massProperties.cg.toArray(),
            inertiaKgM2: p.massProperties.inertia.toArray(),
            angularVelocity: p.angularVelocity.toArray(),
            momentsNewtonMetres: p.aerodynamics.moment.toArray(),
            staticMargin: p.aerodynamics.staticMargin,
            mach: p.aerodynamics.mach,
            stallSpeedMetresPerSecond: p.stallSpeed,
            fuelKg: p.fuelKg,
            stalled: p.stall,
          }
        : null,
    };
  }
  dispose() {
    this.disposed = true;
    this.replayVideo.reset();
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.keydown);
    window.removeEventListener("keyup", this.keyup);
    window.removeEventListener("blur", this.blur);
    document.removeEventListener("visibilitychange", this.visibility);
    window.removeEventListener("pointermove", this.pointermove);
    window.removeEventListener("pointerup", this.pointerup);
    this.renderer.domElement.removeEventListener(
      "pointerdown",
      this.pointerdown,
    );
    this.renderer.domElement.removeEventListener(
      "contextmenu",
      this.contextmenu,
    );
    this.aircraft.dispose();
    this.vfx.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.audio.dispose();
    this.library?.close();
    this.renderer.domElement.remove();
  }
}
