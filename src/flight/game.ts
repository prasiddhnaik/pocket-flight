import * as T from "three";
import { displayDemo } from "../aircraft/cockpit-displays";
import { makeWorld } from "../world/world";
import type { AircraftId, AircraftModel } from "../aircraft/aircraft";
import type { FinchVariant } from "../aircraft/finch/attack";
import { initialJetInput } from "../aircraft/jet-effects";
import { makeAircraft } from "../aircraft/aircraft";
import { FlightPhysics } from "./physics";
import { instrumentData } from "../hud/instrument-data";
import type { Controls } from "./physics";
import { ISLAND_FLIGHT_MODEL } from "./flight-envelope";
import { missions, scoreFlight } from "./missions";
import type { Mission, FlightResult } from "./missions";
import { engineVoice, FlightAudio } from "../audio/audio";
import { terrainHeight, groundHeight, onPavement, rangeRunway, runways } from "../world/terrain";
import { FlightVfx, type VfxInput } from "./flight-vfx";
import { CannonEffects } from "./cannon-effects";
import { CombatRange } from "./combat/combat";
import { supportsCombat } from "../aircraft/weapons/combat-loadouts";
import { F15CFlightInspection } from "./f15c-inspection";
import { ReplayTimeline } from "../replay/replay";
import { ReplayVideoExport } from "../replay/replay-export";
import { ReplayLibrary } from "../replay/replay-library";
import { saveFrames, type SavedReplay } from "../replay/replay-data";
import { ReplayArchive } from "../replay/replay-archive";
import type { CockpitState } from "../aircraft/cockpit-state";
import { GUN_FULL_SPEED } from "../aircraft/f15c/gun-spool";
import type { CameraMode, GameMode, ReplayFrame } from "./game-types";
import { GameInput, readControls } from "./game-input";
import { poseFlightCamera, poseMenuCamera } from "./game-camera";
import { MissionRings, passedRing } from "./mission-rings";
import { DebrisField } from "./debris";
import { applyReplayVisuals, captureReplayFrame, poseReplay } from "./game-replay";
import { diagnostics, flightHint, objectiveText, routeTarget, screenTarget } from "./game-snapshot";
import type { Snapshot } from "./game-types";

export type { CameraMode, GameMode, ReplayFrame, Snapshot } from "./game-types";

const STEP = 1 / 60;

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
  /** Camera orbit offset from right- or Alt-drag; browser checks set it directly. */
  orbit = { x: 0, y: 0 };
  onSnapshot: (s: Snapshot) => void = () => {};
  onResult: (r: FlightResult) => void = () => {};
  onToast: (text: string) => void = () => {};
  private crashDelay = 0;
  private rings = new MissionRings();
  private debris: DebrisField;
  private input: GameInput;
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
  private recordingVariant: FinchVariant = "trainer";
  private paintIndex = 0;
  private savedStamp = "";
  private nextArchive = 10;
  private suspended = false;
  private archive = new ReplayArchive(() => this.replayLibrary);
  readonly replayVideo = new ReplayVideoExport();
  private replayLive: ReplayFrame | null = null;
  private replaySample: ReplayFrame | null = null;
  private replayEnded = false;
  private replayReturnCamera: CameraMode = "chase";
  private replayClock = 0;
  private landingSink = 0;
  private landingAccuracy = 0;
  private landedAt = "";
  private airborne = false;
  readonly vfx = new FlightVfx();
  readonly cannon: CannonEffects;
  readonly combat: CombatRange;
  private inspection?: F15CFlightInspection;
  private vfxVelocity = new T.Vector3();
  private vfxUp = new T.Vector3();
  private vfxLoad = 1;
  private vfxViewport = new T.Vector2();
  private result: FlightResult | null = null;
  private disposed = false;
  private reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

  get replayLibrary() {
    return (this.library ??= new ReplayLibrary());
  }

  constructor(
    private container: HTMLElement,
    aircraftId: AircraftId = "finch",
    variant: FinchVariant = "trainer",
  ) {
    this.aircraft = makeAircraft(0, aircraftId, variant);
    this.physics.aircraftId = aircraftId;
    this.audio.voice = engineVoice(aircraftId);
    this.renderer = new T.WebGLRenderer({
      antialias: true,
      logarithmicDepthBuffer: true,
      powerPreference: "high-performance",
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;
    // Scenery images are freed after upload, so a restored context needs a fresh load.
    this.renderer.domElement.addEventListener("webglcontextrestored", () => location.reload());
    container.appendChild(this.renderer.domElement);
    this.renderer.domElement.setAttribute("aria-label", "Pocket Flight 3D island and aircraft");
    this.world = makeWorld(this.scene);
    this.debris = new DebrisField(this.scene);
    this.cannon = new CannonEffects(container, (x, z) => Math.max(0, groundHeight(x, z)));
    if (import.meta.env.DEV && new URLSearchParams(location.search).get("inspect") === "f15c")
      this.inspection = new F15CFlightInspection(container);
    this.combat = new CombatRange(
      container,
      (x, z) => Math.max(0, groundHeight(x, z)),
      (x, z) => terrainHeight(x, z) < 0.25,
      this.audio,
      () => {
        // The ramp crew reloads the gun and tops the tanks along with the stores.
        this.cannon.simulation.reset();
        this.physics.refuel();
        this.onToast("Rearmed and refuelled.");
      },
    );
    this.scene.add(this.cannon.group, this.combat.group, this.combat.replayGroup);
    this.scene.add(this.aircraft.group, this.rings.group, this.camera);
    this.scene.add(this.vfx.group);
    this.physics.reset();
    this.resize();
    window.addEventListener("resize", this.resize);
    this.input = this.bindInput();
    this.camera.position.set(-740, 480, 1100);
    this.camera.lookAt(-20, 50, -120);
    this.frame = requestAnimationFrame(this.tick);
    void Promise.all([this.aircraft.ready, this.world.ready]).then(
      () => this.warmShaders(),
      () => {},
    );
  }

  private bindInput() {
    const game = this;
    return new GameInput(this.renderer.domElement, {
      get keys() { return game.keys; },
      get orbit() { return game.orbit; },
      get replayBusy() { return game.replayVideo.busy; },
      get mode() { return game.mode; },
      pause: () => this.pause(),
      resume: () => this.resume(),
      stopReplay: () => this.stopReplay(),
      cycleCamera: () => this.cycleCamera(),
      restart: () => {
        if (this.restartLocked()) this.onToast("Land and stop on a runway to rearm.");
        else this.start(this.mission);
      },
      toggleAudio: () => this.audio.toggle(),
      toggleGear: () => this.toggleGear(),
      cycleFlaps: () => this.cycleFlaps(),
      adjustTrim: (change) => this.adjustTrim(change),
      blur: () => this.blur(),
      visibility: (hidden) => {
        this.audio.setVisible(!hidden && !this.suspended);
        if (!hidden) return;
        this.blur();
        if (this.mode !== "replay") return;
        if (this.replayVideo.busy)
          this.replayVideo.cancel(
            "Video export stopped because the tab was hidden. Keep this tab visible while downloading; your replay is still available.",
          );
        this.stopReplay();
      },
    });
  }

  private resize = () => {
    const w = this.container.clientWidth,
      h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  private blur() {
    this.keys.clear();
    this.cannon.suspend();
    this.combat.suspend();
    if (this.mode === "playing") this.pause();
  }

  setSuspended(value: boolean) {
    this.suspended = value;
    this.audio.setVisible(!value && !document.hidden);
    if (value) this.audio.update(0, 0, false);
    this.keys.clear();
    if (value) { this.cannon.suspend(); this.combat.suspend(); }
    this.last = performance.now();
  }

  // ---- Replay storage -------------------------------------------------------

  captureSavedReplay(): SavedReplay | null {
    const details = this.savedReplayDetails();
    return details && { ...details, frames: saveFrames(this.replay.toArray()) };
  }
  private savedReplayDetails(): Omit<SavedReplay, "frames"> | null {
    if (this.replay.duration < 1) return null;
    return {
      schemaVersion: 1,
      flightModel: ISLAND_FLIGHT_MODEL,
      id: this.recordingId,
      name: this.mission.name,
      aircraft: this.recordingAircraft,
      ...(this.recordingVariant === "attack" ? { variant: this.recordingVariant } : {}),
      paint: this.recordingPaint,
      mission: this.mission.id,
      createdAt: this.recordingDate,
      updatedAt: Date.now(),
      duration: this.replay.duration,
      trimmed: this.replay.trimmed,
    };
  }
  async archiveReplay() {
    const stamp = `${this.recordingId}:${this.replay.duration}:${this.replay.length}`;
    if (stamp === this.savedStamp) return this.recordingId;
    const replay = this.savedReplayDetails();
    if (!replay) return null;
    await this.archive.save(replay, this.replay.toArray());
    if (replay.id === this.recordingId) this.savedStamp = stamp;
    return replay.id;
  }
  private archiveQuietly() {
    void this.archiveReplay().catch(() =>
      this.onToast("Replay could not save to browser storage. Your current replay is still available."),
    );
  }

  // ---- Pilot commands -------------------------------------------------------

  toggleGear() {
    if (this.mode !== "playing") return;
    if (!this.physics.jet) {
      this.onToast(`${this.aircraft.id === "heron" ? "Heron" : "Finch"} has fixed landing gear.`);
      return;
    }
    if (this.physics.automaticConfiguration) {
      this.onToast("For manual gear, turn off Automatic gear and flaps in Settings → Controls.");
      return;
    }
    if (!this.physics.toggleGear()) this.onToast("Gear stays down while weight is on the wheels.");
    else this.onToast(this.physics.gearCommand ? "Gear commanded down." : "Gear commanded up.");
  }
  cycleFlaps() {
    if (this.mode !== "playing") return;
    if (!this.physics.hasFlaps) {
      this.onToast("Finch has no movable flaps.");
      return;
    }
    if (!this.physics.cycleFlaps())
      this.onToast("For manual flaps, turn off Automatic gear and flaps in Settings → Controls.");
    else this.onToast(`Flaps commanded ${Math.round(this.physics.flapCommand * 100)}%.`);
  }
  adjustTrim(change: number) {
    if (this.mode !== "playing") return;
    if (this.physics.beginnerAssist) {
      this.onToast("Flight assist handles trim. For manual trim, turn it off in Settings → Controls.");
      return;
    }
    this.physics.elevatorTrim = T.MathUtils.clamp(this.physics.elevatorTrim + change, -1, 1);
    this.onToast(`Elevator trim ${Math.round(this.physics.elevatorTrim * 100)}%.`);
  }
  private controls(): Controls {
    return readControls(this.keys, this.touch);
  }

  // ---- Aircraft -------------------------------------------------------------

  async selectAircraft(id: AircraftId, variant: FinchVariant = "trainer") {
    if (this.mode !== "menu" || (id === this.aircraft.id && variant === this.aircraft.variant)) return;
    const next = makeAircraft(0, id, variant);
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
    this.audio.voice = engineVoice(id);
    this.warmShaders();
  }
  // Programs otherwise compile on first draw: takeoff dust, flames, rings and
  // dusk would each stall a frame. Compile hidden objects and night lighting
  // up front, in parallel where the browser supports it.
  private warmShaders() {
    if (this.disposed) return;
    const hidden: T.Object3D[] = [];
    this.scene.traverse((object) => {
      if (!object.visible && !(object instanceof T.Light)) {
        hidden.push(object);
        object.visible = true;
      }
    });
    // Async readiness polling outlives materials removed by aircraft and mission switches.
    // Compile ahead of the first draw without retaining those materials in a poller.
    this.renderer.compile(this.scene, this.camera);
    hidden.forEach((object) => (object.visible = false));
  }
  private updateJet(dt: number) {
    this.aircraft.setConfiguration(this.mode === "menu" ? 0 : this.physics.flapPosition, this.physics.gearSteering);
    const effects = this.aircraft.effects;
    if (!effects) return;
    const p = this.physics,
      menu = this.mode === "menu";
    const input = {
      ...initialJetInput(),
      ...this.aircraft.surfaces.snapshot(),
      throttle: menu ? 0.45 : p.engineOut || p.crashed ? 0 : p.enginePower,
      speed: menu ? 50 : p.airspeed,
      gunFiring: !menu && this.aircraft.id === "f15c" && this.cannon.firing,
      grounded: !menu && p.grounded,
      speedBrake: this.aircraft.id === "f15c" && !menu && this.controls().brake ? 1 : 0,
      controlsResolved: !menu,
      powerResolved: !menu && this.aircraft.id === "f15c",
      groundSpeed: p.velocity.dot(new T.Vector3(0, 0, -1).applyQuaternion(p.quaternion)),
      ...(!menu ? { gearPosition: p.gearPosition, gearSteering: p.gearSteering } : {}),
      gear: !menu && p.gearPosition > 0.5,
      damage: menu ? 0 : p.damage.engine,
    };
    input.burner = input.throttle > (this.aircraft.id === "f15c" ? .88 : .9);
    input.flaps = menu ? 0 : p.flapPosition;
    if ("setAtmosphericEffects" in effects) effects.setAtmosphericEffects(false);
    effects.setReducedMotion(this.reducedMotion);
    effects.update(menu && this.reducedMotion ? 0 : dt, input);
  }
  setPaint(index: number) {
    this.paintIndex = index;
    this.aircraft.setPaint(index);
  }

  // ---- Game flow ------------------------------------------------------------

  /** In the sandbox, R cannot stand in for a landing. */
  restartLocked() {
    return this.mission.id === "combat" && this.mode === "playing";
  }
  start(mission: Mission) {
    const combatId = this.aircraft.id === "finch" && this.aircraft.variant === "attack" ? "finch-attack" : this.aircraft.id;
    if (mission.id === "combat" && !supportsCombat(combatId)) {
      this.onToast("Choose a combat aircraft to enter the range."); return;
    }
    this.combat.stop();
    this.archiveQuietly();
    this.recordingId = crypto.randomUUID();
    this.recordingDate = Date.now();
    this.recordingAircraft = this.aircraft.id;
    this.recordingPaint = this.paintIndex;
    this.recordingVariant = this.aircraft.variant;
    this.nextArchive = 10;
    this.savedStamp = "";
    this.replayVideo.reset();
    this.replayLive = this.replaySample = null;
    this.mission = mission;
    this.crashDelay = 0;
    const p = this.physics;
    p.strongWind = mission.id === "crosswind";
    p.reset(mission.airStart, mission.short, mission.id === "combat" ? rangeRunway : undefined);
    this.aircraft.surfaces.reset();
    this.aircraft.propellerMotion.reset();
    this.aircraft.effects?.reset();
    p.engineOut = mission.id === "emergency";
    if (p.engineOut) {
      p.throttle = 0;
      p.damage.engine = 0.9;
      p.position.y += 34;
    }
    if (mission.id === "canyon") {
      p.position.set(95, 110, 470);
      p.initializeAirStart(p.jet ? Math.max(48, p.stallSpeed * 1.4) : 34);
    }
    if (mission.id === "free") {
      p.position.y += 100;
      p.yaw = Math.PI;
      p.initializeAirStart(Math.max(p.design.trimSpeed, p.stallSpeed * 1.4));
    }
    this.aircraft.group.scale.setScalar(1);
    this.aircraft.group.position.copy(p.position);
    this.aircraft.group.quaternion.copy(p.quaternion);
    if (mission.id === "combat" && !this.combat.start(combatId, this.aircraft.group, p)) {
      this.onToast("Combat hardpoints are not ready. Finish loading the aircraft first.");
      this.menu(); return;
    }
    this.showWholeAircraft();
    this.keys.clear();
    this.touch = { pitch: 0, roll: 0, yaw: 0 };
    this.ringIndex = 0;
    this.airborne = mission.airStart;
    this.landedAt = "";
    this.landingSink = 0;
    this.landingAccuracy = 0;
    this.result = null;
    this.accumulator = 0;
    this.previousPosition.copy(p.position);
    this.previousQuaternion.copy(p.quaternion);
    this.mode = "playing";
    this.vfx.group.visible = true;
    this.replay.clear();
    this.replayClock = 0;
    this.vfx.reset();
    this.vfxVelocity.copy(p.velocity);
    this.cameraMode = "chase";
    this.orbit = { x: 0, y: 0 };
    this.rings.build(mission.rings, p.position);
    this.warmShaders();
    this.cannon.reset(p, mission.id !== "combat");
    this.debris.clear();
    this.camera.position
      .copy(p.position)
      .add(
        new T.Vector3(0, 8, 25)
          .multiplyScalar(this.aircraft.cameraScale)
          .applyAxisAngle(new T.Vector3(0, 1, 0), p.yaw),
      );
    this.camera.lookAt(p.position);
    this.audio.start();
    this.recordReplay(true);
    this.onToast(this.briefing(mission));
    this.emit();
  }
  private briefing(mission: Mission) {
    const p = this.physics;
    const rotate = `Pull back with ↓ at ${p.profile.rotationKnots} knots.`;
    const opening = mission.airStart
      ? "You have the controls. Enjoy the view."
      : !p.jet
        ? `Hold Shift to add throttle. ${rotate}`
        : this.aircraft.id === "stormbird"
          ? `Hold Shift for thrust. ${rotate} Stormbird accelerates quickly; plan a longer approach.`
          : this.aircraft.id === "aurelia"
            ? `Hold Shift for thrust. ${rotate} ${p.automaticConfiguration ? "Gear and flaps operate automatically." : "G toggles gear; F cycles flaps."}`
            : `Hold Shift for thrust. ${rotate} Full power lights the afterburners.`;
    const departure =
      !mission.airStart && !mission.short && mission.id !== "combat"
        ? " Depart toward open water; climb before turning toward the ridge."
        : "";
    const weapons =
      mission.id === "combat"
        ? ` K: rocket. L: missile once the seeker locks a drone.${this.combat.hasGun ? " J: gun." : ""} Land and stop on a runway to rearm.`
        : this.aircraft.id === "f15c"
          ? " Hold J or FIRE to use the cannon; aim at the orange practice targets."
          : "";
    return opening + departure + weapons;
  }
  private showWholeAircraft() {
    this.aircraft.group.visible = true;
    this.aircraft.gear.visible = true;
    for (const w of this.aircraft.wings) w.visible = true;
    this.aircraft.propeller.visible = true;
  }
  pause() {
    if (this.mode !== "playing") return;
    this.recordReplay(true);
    this.archiveQuietly();
    this.mode = "paused";
    this.cannon.suspend();
    this.combat.suspend();
    this.keys.clear();
    this.touch = { pitch: 0, roll: 0, yaw: 0 };
    this.emit();
  }
  resume() {
    if (this.mode !== "paused") return;
    this.replayVideo.reset();
    this.mode = "playing";
    this.keys.clear();
    this.emit();
  }
  menu() {
    this.archiveQuietly();
    if (this.mode === "replay") this.stopReplay();
    if (this.replayVideo.busy) this.replayVideo.cancel();
    this.mode = "menu";
    this.combat.stop();
    this.cannon.suspend();
    this.combat.suspend();
    this.cannon.render(false, this.camera, this.aircraft.group);
    this.vfx.group.visible = false;
    this.aircraft.surfaces.reset();
    this.rings.group.visible = false;
    this.keys.clear();
    this.showWholeAircraft();
    this.emit();
  }
  cycleCamera() {
    const modes: CameraMode[] = ["chase", "cockpit", "landing", "cinematic"];
    this.cameraMode = modes[(modes.indexOf(this.cameraMode) + 1) % modes.length];
    this.orbit = { x: 0, y: 0 };
    this.onToast(`${this.cameraMode[0].toUpperCase() + this.cameraMode.slice(1)} camera`);
    this.emit();
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
  private updateMission(previous: T.Vector3) {
    const p = this.physics;
    if (p.crashed && this.crashDelay > 0) {
      this.crashDelay -= STEP;
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
        this.debris.spawn(p, this.aircraft, e.severity, e.part, e.point);
        this.onToast("Hard impact. Check your aircraft and find a runway.");
        this.audio.chime(false);
      }
      if (e.type === "crash") {
        this.vfx.impact(this.vfxInput(), e.severity);
        this.debris.spawn(p, this.aircraft, e.severity, e.part, e.point);
        this.crashDelay = 2.5;
        this.onToast("Heavy impact. Your flight recorder is still running.");
        return;
      }
      if (e.type === "landing") this.vfx.touchdown(this.vfxInput(), e.sink ?? 0);
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
    if (target && passedRing(previous, p.position, target)) {
      this.rings.rings[this.ringIndex].visible = false;
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
    if (this.mission.id === "free" || this.mission.id === "combat") return;
    if (this.ringIndex === this.mission.rings.length) {
      if (!this.mission.land) this.finish(true);
      else if (this.airborne && p.grounded && this.landedAt === this.mission.land && p.velocity.length() < 4)
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

  // ---- Replay playback ------------------------------------------------------

  private captureReplayFrame(): ReplayFrame {
    return captureReplayFrame({
      physics: this.physics,
      aircraft: this.aircraft,
      worldTime: this.time,
      night: this.night,
      ring: this.ringIndex,
      debris: this.debris,
      combat: this.mission.id === "combat" ? this.combat.capture() : undefined,
    });
  }
  private recordReplay(force = false) {
    const last = this.replay.length ? this.replay.at(this.replay.length - 1) : null;
    if (force || !last || this.physics.flightTime - last.t >= 1 / 15 - 1e-6)
      this.replay.push(this.captureReplayFrame());
  }
  private poseReplay(snapCamera = false) {
    const sample = this.replay.sample(this.replayClock);
    if (!sample) return;
    this.replaySample = poseReplay(
      {
        aircraft: this.aircraft,
        rings: this.rings,
        debris: this.debris,
        combat: this.combat,
        camera: this.camera,
        world: this.world,
        vfx: this.vfx,
        vfxHeight: this.renderer.getDrawingBufferSize(this.vfxViewport).y,
        reducedMotion: this.reducedMotion,
        clock: this.replayClock,
        snapCamera,
      },
      sample.a,
      sample.b,
      sample.mix,
    );
  }
  get canReplay() {
    return this.replay.length > 1;
  }
  playReplay() {
    if (!this.canReplay || this.replayVideo.busy) return;
    this.combat.suspend();
    this.cannon.suspend();
    this.vfx.group.visible = true;
    if (this.mode !== "replay") {
      this.replayLive = this.captureReplayFrame();
      this.replayReturnCamera = this.cameraMode;
    }
    if (this.mission.id === "combat") this.combat.beginReplay(this.replay.toArray());
    this.mode = "replay";
    this.replayClock = 0;
    this.replayEnded = false;
    this.aircraft.group.visible = true;
    this.poseReplay(true);
    this.last = performance.now();
    this.emit();
  }
  downloadReplay() {
    if (!this.canReplay || this.replay.duration < 1 || this.replayVideo.busy) return;
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
    this.combat.endReplay();
    this.mode = this.result ? "result" : "paused";
    this.cameraMode = this.replayReturnCamera;
    if (this.replayLive)
      applyReplayVisuals({ aircraft: this.aircraft, rings: this.rings, debris: this.debris }, this.replayLive);
    this.world.update(this.time, this.night);
    this.renderVfx(this.physics.flightTime);
    this.aircraft.group.position.copy(this.physics.position);
    this.aircraft.group.quaternion.copy(this.physics.quaternion);
    this.replaySample = this.replayLive = null;
    this.replayEnded = false;
    this.emit();
  }

  // ---- Frame loop -----------------------------------------------------------

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
      power: p.engineOut ? 0 : p.enginePower,
      burner: this.aircraft.effects?.motion.burner ?? 0,
    };
  }
  private renderVfx(time: number) {
    this.vfx.render(
      time,
      this.renderer.getDrawingBufferSize(this.vfxViewport).y,
      this.reducedMotion,
      this.camera.aspect,
    );
  }
  private cockpitState(fuel: number | null): CockpitState {
    const p = this.physics;
    const input = this.controls();
    const aero = p.aerodynamics;
    const ring = this.mission.rings[this.ringIndex];
    const field = this.mission.land ? runways.find((r) => r.name === this.mission.land) : undefined;
    const magazine = this.mission.id === "combat" ? this.combat.magazine() : null;
    return {
      time: p.flightTime,
      mode: "flight",
      speed: p.airspeed,
      altitude: p.position.y,
      pitch: p.pitch,
      roll: p.roll,
      heading: -p.yaw,
      verticalSpeed: p.velocity.y,
      power: p.enginePower,
      fuel,
      x: p.position.x,
      z: p.position.z,
      engineOut: p.engineOut || p.crashed || p.fuelKg <= 0,
      stall: p.stall,
      aoa: aero && !p.grounded ? T.MathUtils.radToDeg(aero.alpha + p.design.geometry.incidence) : 0,
      gLoad: aero && !p.grounded ? aero.lift / (p.loadedMass * 9.81) : 1,
      gear: p.gearPosition,
      flaps: p.flapPosition,
      stick: {
        pitch: T.MathUtils.clamp(input.pitch, -1, 1),
        roll: T.MathUtils.clamp(input.roll, -1, 1),
        yaw: T.MathUtils.clamp(input.yaw, -1, 1),
      },
      speedBrake: p.airbrakePosition,
      night: this.night,
      grounded: p.grounded,
      slowingToLand: p.slowingToLand,
      approachKnots: p.profile.approachKnots,
      target: ring ? { x: ring.x, z: ring.z } : field ? { x: field.x, z: field.z } : null,
      contacts: this.combat.targets().map((target) => ({
        x: target.position.x,
        z: target.position.z,
        y: target.position.y,
        air: target.kind === "air",
      })),
      stores: magazine && { ...magazine, gun: this.cannon.simulation.ammunition },
      groundSpeed: Math.hypot(p.velocity.x, p.velocity.z),
      wind: { x: p.wind.x, z: p.wind.z },
    };
  }
  private cameraUpdate(dt: number) {
    const p = this.physics,
      model = this.aircraft.group;
    const live = this.mode !== "menu" && this.mode !== "replay";
    this.aircraft.interior?.setActive(this.cameraMode === "cockpit" && live);
    this.aircraft.pilot?.setFirstPerson(this.cameraMode === "cockpit" && this.mode !== "menu");
    if (this.mode === "menu") {
      poseMenuCamera(this.camera, this.aircraft, this.time, dt);
    } else if (this.mode === "replay") {
      this.replayClock = Math.min(this.replayClock + dt, this.replay.duration);
      this.poseReplay();
      this.replayEnded = this.replayClock >= this.replay.duration;
    } else {
      // Physics advances at 60 Hz; interpolate its poses for smooth rendering at any refresh rate.
      const alpha = this.mode === "playing" ? this.accumulator * 60 : 1;
      const position = this.renderPosition.lerpVectors(this.previousPosition, p.position, alpha);
      const quaternion = this.renderQuaternion.slerpQuaternions(this.previousQuaternion, p.quaternion, alpha);
      model.scale.setScalar(1);
      model.position.copy(position);
      model.position.add(
        new T.Vector3(0, -this.aircraft.bodyCompression(p.suspension, true), 0).applyQuaternion(quaternion),
      );
      this.aircraft.setSuspension(p.suspension);
      model.quaternion.copy(quaternion);
      model.visible = true;
      poseFlightCamera({
        camera: this.camera,
        aircraft: this.aircraft,
        physics: p,
        mode: this.cameraMode,
        playing: this.mode === "playing",
        position,
        quaternion,
        orbit: this.orbit,
        dragging: this.input.dragging,
        zoom: this.keys.has("KeyZ"),
        time: this.time,
        dt,
      });
    }
    this.camera.near = this.cameraMode === "cockpit" && this.mode !== "replay" ? 0.025 : 0.2;
    this.camera.updateProjectionMatrix();
  }
  /** One fixed 60 Hz simulation step: physics, weapons, effects and mission rules. */
  private simulate() {
    const p = this.physics;
    this.previousPosition.copy(p.position);
    this.previousQuaternion.copy(p.quaternion);
    this.vfxVelocity.copy(p.velocity);
    p.step(STEP, this.controls(), this.world.collisionObstacles);
    const combat = this.mission.id === "combat";
    if (this.aircraft.id === "f15c" || combat) {
      const allowed = !p.crashed && !document.querySelector('[role="dialog"]');
      const trigger = this.keys.has("KeyJ") || (combat && this.combat.gunPressed());
      const result = this.cannon.step(STEP, p,
        trigger && allowed && (!combat || this.combat.hasGun),
        combat ? this.combat.targets() : undefined, combat ? this.combat.gun : undefined);
      if (result.fired) this.audio.cannonBurst();
      if (combat) this.combat.step(STEP, p, this.keys, allowed, result.hits, p.grounded && !p.crashed, onPavement(p.position.x, p.position.z));
    }
    if (!p.crashed) this.aircraft.surfaces.apply(p.surfaces);
    // Felt load factor along the aircraft's up axis drives wing vapour and shake.
    this.vfxUp.set(0, 1, 0).applyQuaternion(p.quaternion);
    this.vfxVelocity.subVectors(p.velocity, this.vfxVelocity).multiplyScalar(60);
    this.vfxVelocity.y += 9.81;
    this.vfxLoad = p.grounded ? 1 : Math.abs(this.vfxVelocity.dot(this.vfxUp) / 9.81);
    this.vfx.step(STEP, this.vfxInput());
    this.updateMission(this.previousPosition);
  }
  /** Propeller, jet effects, cockpit screens and pilot pose for menu and live flight. */
  private animateAircraft(dt: number) {
    const p = this.physics;
    const menu = this.mode === "menu";
    if (menu && this.reducedMotion) this.aircraft.propellerMotion.reset();
    else
      this.aircraft.propellerMotion.update(
        {
          throttle: menu ? 0.45 : p.enginePower,
          airspeed: p.airspeed,
          damage: menu ? 0 : p.damage.propeller,
          engineOut: !menu && p.engineOut,
          crashed: !menu && p.crashed,
        },
        dt,
      );
    this.updateJet(dt);
    const fuelCapacity = p.design.massBudget
      .filter((part) => part.category === "fuel")
      .reduce((sum, part) => sum + part.mass, 0);
    const fuel = fuelCapacity ? p.fuelKg / fuelCapacity : null;
    const distance = this.camera.position.distanceTo(this.aircraft.group.position);
    this.aircraft.displays?.update(
      menu
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
            fuel,
            x: p.position.x,
            z: p.position.z,
            engineOut: p.engineOut || p.crashed || p.fuelKg <= 0,
            stall: p.stall,
          },
      // Chase view sits behind the pilot; redraw quickly only when screens are readable.
      menu
        ? distance < 30
        : (this.cameraMode === "cockpit" && !this.aircraft.interior?.active) || distance < 10,
    );
    if (this.aircraft.interior?.active) this.aircraft.interior.update(this.cockpitState(fuel), dt);
    if (this.aircraft.pilot && !menu) {
      const input = this.controls();
      this.aircraft.pilot.update({ pitch: input.pitch, roll: input.roll, yaw: input.yaw, power: p.enginePower });
    }
  }
  private updateAudio() {
    const sound = this.replaySample;
    const p = this.physics;
    const motion = this.aircraft.effects?.motion;
    this.audio.update(
      sound ? (sound.engineOut ? 0 : sound.throttle) : p.engineOut ? 0 : p.enginePower,
      sound?.speed ?? p.airspeed,
      this.mode === "playing" || this.mode === "replay",
      1,
      {
        burner: motion?.burner ?? 0,
        gunSpool: (motion?.gunSpeed ?? 0) / GUN_FULL_SPEED,
        inferGun: this.mode === "replay",
      },
    );
    this.audio.updateMusic({
      mode: this.mode,
      speed: sound?.speed ?? p.airspeed,
      grounded: sound ? sound.p.y < terrainHeight(sound.p.x, sound.p.z) + 3 : p.grounded,
      night: sound?.night ?? this.night,
      warning: this.mode === "playing" && (p.stall || p.crashed || p.engineOut),
      visible: !document.hidden && !this.suspended,
    });
  }
  private tick = (now: number) => {
    if (this.disposed) return;
    this.frame = requestAnimationFrame(this.tick);
    if (this.suspended) {
      this.last = now;
      return;
    }
    const elapsed = (now - (this.last || now)) / 1000;
    const dt = Math.min(elapsed, 0.05);
    this.last = now;
    this.fps = T.MathUtils.damp(this.fps, 1 / Math.max(0.001, elapsed), 2, dt);
    const active = this.mode === "playing" || this.mode === "menu" || this.mode === "replay";
    if (active && this.mode !== "replay" && !(this.mode === "menu" && this.reducedMotion)) this.time += dt;
    if (this.mode === "playing") {
      this.accumulator += dt;
      while (this.accumulator >= STEP) {
        this.simulate();
        this.accumulator -= STEP;
        if (this.mode !== "playing") {
          this.accumulator = 0;
          break;
        }
      }
    } else this.accumulator = 0;
    if (this.mode === "playing" || this.mode === "menu") {
      this.world.update(this.time, this.night);
      this.animateAircraft(dt);
      if (this.mode === "playing") {
        this.recordReplay();
        if (this.physics.flightTime >= this.nextArchive) {
          this.nextArchive = this.physics.flightTime + 10;
          this.archiveQuietly();
        }
      }
    }
    this.aircraft.gear.rotation.z = 0;
    this.rings.show(this.ringIndex);
    if (active && this.mode !== "replay") this.debris.step(dt);
    if (this.mode !== "replay") this.renderVfx(this.physics.flightTime);
    this.cameraUpdate(this.mode === "replay" ? elapsed : dt);
    this.inspection?.update(this.aircraft, this.camera, this.physics, this.mode, this.cannon.simulation.ammunition, this.cannon.firing);
    const combat = this.mission.id === "combat";
    this.cannon.render((this.aircraft.id === "f15c" || (combat && this.combat.hasGun)) && this.mode === "playing", this.camera, this.aircraft.group, true, !combat);
    this.combat.render(combat && this.mode === "playing", this.cannon.simulation.ammunition, this.camera, this.physics, combat && this.mode !== "menu" && this.mode !== "replay", this.renderer.domElement.height);
    this.updateAudio();
    this.world.focusSun(this.aircraft.group.position);
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

  // ---- HUD and diagnostics --------------------------------------------------

  private emit() {
    const p = this.physics;
    const replay = this.replaySample;
    const motion = this.aircraft.effects?.motion;
    this.onSnapshot({
      speed: p.airspeed * 1.94384,
      altitude: p.position.y * 3.28084,
      agl: (p.position.y - Math.max(0, terrainHeight(p.position.x, p.position.z))) * 3.28084,
      throttle: p.throttle * 100,
      health: p.health,
      heading: ((((-p.yaw * 180) / Math.PI) % 360) + 360) % 360,
      verticalSpeed: p.verticalSpeed,
      wind: p.wind.length() * 1.94384,
      time: p.flightTime,
      ring: this.ringIndex,
      totalRings: this.mission.rings.length,
      objective: objectiveText({
        mode: this.mode,
        mission: this.mission,
        ringIndex: this.ringIndex,
        airborne: this.airborne,
        physics: p,
        hasGun: this.combat.hasGun,
      }),
      hint: flightHint(p, this.aircraft.id),
      stall: p.stall,
      crashed: p.crashed,
      grounded: p.grounded,
      gearPosition: replay ? (motion?.gear ?? replay.gearPosition ?? 1) : p.gearPosition,
      flapPosition: replay ? (motion?.flaps ?? replay.flapPosition ?? 0) : p.flapPosition,
      automaticConfiguration: replay?.automaticConfiguration ?? p.automaticConfiguration,
      slowingToLand: !replay && p.slowingToLand,
      speedBrake: replay ? 0 : p.airbrakePosition,
      speedProtection: p.speedProtectionActive,
      elevatorTrim: replay?.elevatorTrim ?? p.elevatorTrim,
      damage: { ...p.damage },
      x: p.position.x,
      z: p.position.z,
      pitch: p.pitch,
      roll: p.roll,
      target: screenTarget(routeTarget(this.mission, this.ringIndex), this.camera, p.position),
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
  getState() {
    return diagnostics({
      mode: this.mode,
      aircraft: this.aircraft,
      audio: this.audio,
      physics: this.physics,
      ringIndex: this.ringIndex,
      mission: this.mission,
      fps: this.fps,
      renderer: this.renderer,
      vfx: this.vfx,
    });
  }
  dispose() {
    this.disposed = true;
    this.replayVideo.reset();
    cancelAnimationFrame(this.frame);
    window.removeEventListener("resize", this.resize);
    this.input.dispose();
    this.aircraft.dispose();
    this.vfx.dispose();
    this.cannon.dispose();
    this.combat.dispose();
    this.archive.dispose();
    this.inspection?.dispose();
    this.world.dispose();
    this.renderer.dispose();
    this.audio.dispose();
    this.library?.close();
    this.renderer.domElement.remove();
  }
}
