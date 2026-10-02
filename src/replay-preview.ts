import * as T from "three";
import { makeWorld } from "./world";
import { makeAircraft, type AircraftId, type AircraftModel } from "./aircraft";
import { FlightAudio } from "./audio";
import { initialJetInput } from "./jet-effects";
import { sampleFrames, type SavedReplay } from "./replay-data";
import type { Shot } from "./studio-model";
import { terrainHeight } from "./terrain";
export class ReplayPreview {
  readonly renderer = new T.WebGLRenderer({
    antialias: true,
    powerPreference: "high-performance",
  });
  readonly scene = new T.Scene();
  readonly camera = new T.PerspectiveCamera(48, 16 / 9, 0.2, 11000);
  readonly audio = new FlightAudio();
  private world = makeWorld(this.scene);
  private models = new Map<AircraftId, AircraftModel>();
  private ready = new Set<AircraftId>();
  private loads = new Map<AircraftId, Promise<void>>();
  private disposed = false;
  constructor(host: HTMLElement) {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(1280, 720, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.append(this.renderer.domElement);
  }
  get canvas() {
    return this.renderer.domElement;
  }
  isReady(id: AircraftId) {
    return this.ready.has(id);
  }
  load(replay: SavedReplay): Promise<void> {
    const id = replay.aircraft,
      existing = this.loads.get(id);
    if (existing) return existing;
    const model = makeAircraft(replay.paint, id);
    this.models.set(id, model);
    this.scene.add(model.group);
    model.group.visible = false;
    const promise = model.ready.then(() => {
      if (this.disposed) {
        model.dispose();
        return;
      }
      this.ready.add(id);
    });
    this.loads.set(id, promise);
    return promise;
  }
  render(
    replay: SavedReplay,
    time: number,
    shot: Shot,
    playing = false,
    volume = 1,
  ) {
    const model = this.models.get(replay.aircraft);
    if (!model || !this.ready.has(replay.aircraft)) return;
    for (const [id, m] of this.models) m.group.visible = id === replay.aircraft;
    model.setPaint(replay.paint);
    this.audio.jet = replay.aircraft !== "finch";
    const { a, b, mix } = sampleFrames(replay.frames, time),
      visual = mix === 1 ? b : a;
    model.group.position.lerpVectors(
      new T.Vector3().fromArray(a.p),
      new T.Vector3().fromArray(b.p),
      mix,
    );
    model.group.quaternion.slerpQuaternions(
      new T.Quaternion().fromArray(a.q).normalize(),
      new T.Quaternion().fromArray(b.q).normalize(),
      mix,
    );
    if (replay.aircraft !== "stormbird")
      model.group.position.add(
        new T.Vector3(
          0,
          -Math.min(0.16, T.MathUtils.lerp(a.suspension, b.suspension, mix)),
          0,
        ).applyQuaternion(model.group.quaternion),
      );
    model.gear.visible = visual.gearVisible;
    model.gear.rotation.z = visual.gearDamage * 0.35;
    model.propeller.visible = visual.propVisible;
    model.wings.forEach((wing, i) => (wing.visible = visual.wings[i]));
    model.setSuspension(T.MathUtils.lerp(a.suspension, b.suspension, mix));
    model.surfaces.apply({
      pitch: T.MathUtils.lerp(a.surfaces.pitch, b.surfaces.pitch, mix),
      roll: T.MathUtils.lerp(a.surfaces.roll, b.surfaces.roll, mix),
      yaw: T.MathUtils.lerp(a.surfaces.yaw, b.surfaces.yaw, mix),
    });
    model.propellerMotion.apply({
      angle: T.MathUtils.lerp(a.propAngle, b.propAngle, mix),
      rpm: T.MathUtils.lerp(a.propRpm, b.propRpm, mix),
    });
    if (model.effects && a.jet && b.jet) {
      for (const key of Object.keys(a.jet) as (keyof typeof a.jet)[])
        model.effects.motion[key] = T.MathUtils.lerp(
          a.jet[key],
          b.jet[key],
          mix,
        );
      model.effects.update(0, { ...initialJetInput(), lights: true });
    }
    const yaw = new T.Euler().setFromQuaternion(
      model.group.quaternion,
      "YXZ",
    ).y;
    const offset =
      shot === "orbit"
        ? new T.Vector3(Math.sin(time * 0.1) * 28, 8, Math.cos(time * 0.1) * 28)
        : shot === "side"
          ? new T.Vector3(28, 7, 3)
          : shot === "front"
            ? new T.Vector3(0, 6, -26)
            : shot === "wide"
              ? new T.Vector3(52, 32, 62)
              : new T.Vector3(0, 7, 24);
    offset
      .multiplyScalar(model.cameraScale)
      .applyAxisAngle(new T.Vector3(0, 1, 0), yaw);
    this.camera.position.copy(model.group.position).add(offset);
    this.camera.position.y = Math.max(
      this.camera.position.y,
      terrainHeight(this.camera.position.x, this.camera.position.z) + 3,
    );
    this.camera.lookAt(model.group.position);
    this.camera.updateProjectionMatrix();
    this.world.update(
      T.MathUtils.lerp(a.worldTime, b.worldTime, mix),
      visual.night,
    );
    this.audio.update(
      visual.engineOut ? 0 : T.MathUtils.lerp(a.throttle, b.throttle, mix),
      T.MathUtils.lerp(a.speed, b.speed, mix),
      playing,
      volume,
    );
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    this.disposed = true;
    this.models.forEach((model) => model.dispose());
    this.world.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
