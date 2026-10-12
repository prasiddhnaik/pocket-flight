import * as T from "three";
import { makeWorld } from "./world";
import { makeAircraft, type AircraftId, type AircraftModel } from "./aircraft";
import { FlightAudio } from "./audio";
import { initialJetInput } from "./jet-effects";
import { sampleFrames, type SavedReplay } from "./replay-data";
import type { Shot, StudioProject, StudioClip } from "./studio-model";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  TransformControls,
  type TransformControlsMode,
} from "three/examples/jsm/controls/TransformControls.js";
import { StudioSceneRenderer } from "./studio-scene-renderer";
import { StudioSoundtrack } from "./studio-soundtrack";
import { sampleCamera, type CameraKey, type Transform } from "./studio-scene";
import type { StudioAsset } from "./studio-assets";
export type SceneEditorOptions = {
  editing: boolean;
  selected: string | null;
  tool: TransformControlsMode;
  snap: boolean;
};
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
  readonly assets = new StudioSceneRenderer(this.scene);
  readonly soundtrack = new StudioSoundtrack();
  readonly orbit: OrbitControls;
  readonly transforms: TransformControls;
  private grid = new T.GridHelper(120, 24, 0x5b777d, 0x385159);
  private bounds = new T.BoxHelper(new T.Object3D(), 0xe8ce88);
  private subject = new T.Object3D();
  private origin = new T.Vector3();
  private editing = false;
  private options: SceneEditorOptions = {
    editing: false,
    selected: null,
    tool: "translate",
    snap: false,
  };
  private resizeObserver: ResizeObserver;
  onSceneSelect: (id: string | null) => void = () => {};
  onSceneTransform: (id: string, transform: Transform) => void = () => {};
  private pointerStart = [0, 0];

  constructor(host: HTMLElement) {
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(1280, 720, false);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    this.renderer.toneMapping = T.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    host.append(this.renderer.domElement);
    this.canvas.tabIndex = 0;
    this.canvas.setAttribute("aria-label", "3D scene viewport");
    this.orbit = new OrbitControls(this.camera, this.canvas);
    this.orbit.enabled = false;
    this.orbit.enableDamping = false;
    this.orbit.minDistance = 1;
    this.orbit.maxDistance = 4000;
    this.transforms = new TransformControls(this.camera, this.canvas);
    this.transforms.setSize(0.85);
    this.scene.add(this.transforms.getHelper(), this.grid, this.bounds);
    this.grid.visible = this.bounds.visible = false;
    this.transforms.enabled = false;
    this.transforms.addEventListener("dragging-changed", (event) => {
      this.orbit.enabled = this.editing && !event.value;
    });
    this.transforms.addEventListener("mouseUp", () => {
      const id = this.options.selected;
      if (id) {
        const pose = this.assets.transform(id);
        if (pose) {
          pose.scale = pose.scale.map((n) => Math.max(0.001, n)) as [
            number,
            number,
            number,
          ];
          this.onSceneTransform(id, pose);
        }
      }
    });
    this.canvas.addEventListener("pointerdown", this.pointerDown);
    this.canvas.addEventListener("pointerup", this.pointerUp);
    this.resizeObserver = new ResizeObserver(() => {
      const rect = host.getBoundingClientRect(),
        width = Math.min(rect.width, (rect.height * 16) / 9);
      this.canvas.style.width = `${width}px`;
      this.canvas.style.height = `${(width * 9) / 16}px`;
    });
    this.resizeObserver.observe(host);
  }

  private pointerDown = (e: PointerEvent) => {
    this.pointerStart = [e.clientX, e.clientY];
  };
  private pointerUp = (e: PointerEvent) => {
    if (
      !this.editing ||
      e.button !== 0 ||
      this.transforms.axis ||
      Math.hypot(
        e.clientX - this.pointerStart[0],
        e.clientY - this.pointerStart[1],
      ) > 5
    )
      return;
    const rect = this.canvas.getBoundingClientRect();
    const ray = new T.Raycaster();
    ray.setFromCamera(
      new T.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        (-(e.clientY - rect.top) / rect.height) * 2 + 1,
      ),
      this.camera,
    );
    this.onSceneSelect(this.assets.pick(ray) ?? null);
  };
  startAudio() {
    this.audio.start();
    this.soundtrack.start(() => this.audio.captureTrack());
  }
  pauseAudio() {
    this.audio.update(0, 0, false);
    this.soundtrack.pause();
  }
  async prepareScene(project: StudioProject, assets: Map<string, StudioAsset>) {
    await Promise.all([
      this.world.ready,
      this.assets.prepare(project.scene, assets),
      this.soundtrack.prepare(project.scene, assets),
    ]);
  }
  captureCamera(anchor: "world" | "aircraft", t: number): CameraKey {
    const origin = anchor === "world" ? this.origin : this.subject.position;
    return {
      t,
      position: this.camera.position.clone().sub(origin).toArray() as [
        number,
        number,
        number,
      ],
      target: (this.editing ? this.orbit.target : this.subject.position)
        .clone()
        .sub(origin)
        .toArray() as [number, number, number],
      fov: this.camera.fov,
      ease: "smooth",
    };
  }
  frameObject(id: string | null) {
    const root = id ? this.assets.getObject(id) : null;
    const box = root ? new T.Box3().setFromObject(root) : null;
    const center =
      box && !box.isEmpty()
        ? box.getCenter(new T.Vector3())
        : this.subject.position.clone();
    const distance = box
      ? Math.max(10, box.getSize(new T.Vector3()).length() * 1.7)
      : 26;
    this.orbit.target.copy(center);
    this.camera.position
      .copy(center)
      .add(new T.Vector3(distance, 0.6 * distance, distance));
    this.orbit.update();
  }
  setView(axis: "front" | "side" | "top") {
    const distance = this.camera.position.distanceTo(this.orbit.target) || 26;
    const offset =
      axis === "top"
        ? new T.Vector3(0, distance, 0.01)
        : axis === "side"
          ? new T.Vector3(distance, 0, 0)
          : new T.Vector3(0, 0, -distance);
    this.camera.position.copy(this.orbit.target).add(offset);
    this.camera.lookAt(this.orbit.target);
    this.orbit.update();
  }
  setSize(size: "720p" | "1080p") {
    this.renderer.setSize(
      size === "1080p" ? 1920 : 1280,
      size === "1080p" ? 1080 : 720,
      false,
    );
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
    project?: StudioProject,
    filmTime = 0,
    editor?: SceneEditorOptions,
    clip?: StudioClip,
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
    model.group.position.add(
      new T.Vector3(
        0,
        -model.bodyCompression(
          T.MathUtils.lerp(a.suspension, b.suspension, mix),
        ),
        0,
      ).applyQuaternion(model.group.quaternion),
    );
    model.gear.visible = visual.gearVisible;
    model.gear.rotation.z = 0;
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
    this.subject = model.group;
    const first = project?.clips[0],
      origin = first ? project!.sources[first.replayId].frames[0].p : [0, 0, 0];
    this.origin.fromArray(origin);
    this.options = editor ?? {
      editing: false,
      selected: null,
      tool: "translate",
      snap: false,
    };
    const editing = !!editor?.editing && !playing;
    if (editing && !this.editing) this.orbit.target.copy(model.group.position);
    this.editing = editing;
    this.orbit.enabled = editing && !this.transforms.dragging;
    if (!editing) {
      const custom =
        clip?.camera === "custom"
          ? sampleCamera(clip.cameraKeys ?? [], time)
          : null;
      if (custom) {
        const anchor =
          clip?.cameraAnchor === "world" ? this.origin : model.group.position;
        this.camera.position.fromArray(custom.position).add(anchor);
        this.camera.lookAt(
          new T.Vector3().fromArray(custom.target).add(anchor),
        );
        this.camera.fov = custom.fov;
      } else {
        this.camera.fov = 48;
        this.camera.position.copy(model.group.position).add(offset);
        this.camera.position.y = Math.max(
          this.camera.position.y,
          terrainHeight(this.camera.position.x, this.camera.position.z) + 3,
        );
        this.camera.lookAt(model.group.position);
      }
    } else this.orbit.update();
    this.camera.updateProjectionMatrix();
    const night =
      project?.scene?.lighting === "night"
        ? true
        : project?.scene?.lighting === "day"
          ? false
          : visual.night;
    this.world.update(T.MathUtils.lerp(a.worldTime, b.worldTime, mix), night);
    this.renderer.toneMappingExposure = project?.scene?.exposure ?? 1.05;
    this.assets.update(
      project?.scene,
      filmTime,
      project
        ? project.clips.reduce((n, c) => n + (c.out - c.in) / c.speed, 0)
        : replay.duration,
      this.origin,
      model.group,
      editing,
      this.transforms.dragging ? (editor?.selected ?? null) : null,
    );
    this.scene.updateMatrixWorld(true);
    const object = project?.scene?.objects.find(
        (o) => o.id === editor?.selected,
      ),
      selected = object ? this.assets.getObject(object.id) : null;
    const visible = editing && !!selected && !!selected.parent?.visible;
    this.transforms.enabled = visible && !object?.locked;
    if (visible && !object?.locked) {
      if (this.transforms.object !== selected)
        this.transforms.attach(selected!);
      this.transforms.setMode(editor!.tool);
      this.transforms.setTranslationSnap(editor?.snap ? 1 : null);
      this.transforms.setRotationSnap(editor?.snap ? Math.PI / 12 : null);
      this.transforms.setScaleSnap(editor?.snap ? 0.1 : null);
    } else this.transforms.detach();
    this.transforms.getHelper().visible = visible && !object?.locked;
    this.grid.position.copy(this.origin);
    this.grid.visible = editing;
    this.bounds.visible = visible;
    if (visible) this.bounds.setFromObject(selected!);
    this.soundtrack.update(
      project?.scene,
      filmTime,
      project
        ? project.clips.reduce((n, c) => n + (c.out - c.in) / c.speed, 0)
        : replay.duration,
      playing,
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
    this.resizeObserver.disconnect();
    this.canvas.removeEventListener("pointerdown", this.pointerDown);
    this.canvas.removeEventListener("pointerup", this.pointerUp);
    this.orbit.dispose();
    this.transforms.dispose();
    this.grid.geometry.dispose();
    (this.grid.material as T.Material).dispose();
    this.bounds.geometry.dispose();
    (this.bounds.material as T.Material).dispose();
    this.assets.dispose();
    this.soundtrack.dispose();
    this.models.forEach((model) => model.dispose());
    this.world.dispose();
    this.audio.dispose();
    this.renderer.dispose();
    this.canvas.remove();
  }
}
