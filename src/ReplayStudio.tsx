import { useEffect, useRef, useState } from "react";
import {
  Film,
  X,
  Play,
  Pause,
  Download,
  Plus,
  Undo2,
  Redo2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Scissors,
  Trash2,
  RotateCcw,
  HardDrive,
  Move3D,
  Rotate3D,
  Scaling,
  Focus,
  Magnet,
  Diamond,
  Box,
  Camera,
} from "lucide-react";
import { ReplayLibrary, libraryStorage } from "./replay-library";
import { downloadData, validateReplay, type SavedReplay } from "./replay-data";
import {
  newProject,
  addReplayClip,
  clipDuration,
  projectDuration,
  locateClip,
  shots,
  trimClip,
  validateProject,
  type StudioProject,
  type StudioClip,
  type Shot,
} from "./studio-model";
import { ReplayPreview } from "./replay-preview";
import { ReplayVideoExport, type ExportState } from "./replay-export";
import { aircraftNames } from "./flight-ui";
import "./studio.css";
import {
  convertAnchor,
  newScene,
  newObject,
  sampleTransform,
  setTransformKey,
  setCameraKey,
  type StudioScene,
  type SceneObject,
  type Transform,
  type ObjectKind,
  type Ease,
  type Vec3,
} from "./studio-scene";
import {
  readAssets,
  packProject,
  unpackProject,
  downloadProject,
  type StudioAsset,
} from "./studio-assets";
import {
  SceneAssetBrowser,
  SceneOutliner,
  SceneObjectInspector,
  SceneCameraInspector,
  SceneProjectInspector,
  SceneKeyTimeline,
} from "./StudioScenePanels";
import type { SceneEditorOptions } from "./replay-preview";
import { sampleFrames } from "./replay-data";
const clock = (n: number) =>
  `${Math.floor(n / 60)
    .toString()
    .padStart(2, "0")}:${(n % 60).toFixed(1).padStart(4, "0")}`;
const message = (e: unknown) =>
  e instanceof Error ? e.message : "Browser storage is unavailable.";
const slug = (name: string) =>
  name.replace(/[^\w-]+/g, "-").slice(0, 70) || "replay";
export default function ReplayStudio({
  library,
  initialReplay,
  onClose,
}: {
  library: ReplayLibrary;
  initialReplay: SavedReplay | null;
  onClose: () => void;
}) {
  const [project, setProject] = useState<StudioProject>(() =>
    initialReplay ? addReplayClip(newProject(), initialReplay) : newProject(),
  );
  const projectRef = useRef(project);
  const [assetBank, setAssetBank] = useState<StudioAsset[]>([]),
    assetMap = useRef(new Map<string, StudioAsset>());
  const [libraryTab, setLibraryTab] = useState<"flights" | "assets" | "scene">(
    "flights",
  );
  const [inspectorTab, setInspectorTab] = useState<
    "clip" | "object" | "camera" | "project"
  >("clip");
  const [sceneSelected, setSceneSelected] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState(false),
    [tool, setTool] = useState<SceneEditorOptions["tool"]>("translate"),
    [snap, setSnap] = useState(false),
    [autoKey, setAutoKey] = useState(false);
  const [importing, setImporting] = useState(false),
    [sceneLoading, setSceneLoading] = useState(false);
  const sceneReady = useRef(true),
    sceneGeneration = useRef(0);
  const editorState = useRef<SceneEditorOptions>({
    editing: false,
    selected: null,
    tool: "translate",
    snap: false,
  });
  editorState.current = {
    editing: editingMode,
    selected: sceneSelected,
    tool,
    snap,
  };
  const sceneCallbacks = useRef({
    select: (_: string | null) => {},
    transform: (_: string, _pose: Transform) => {},
  });

  const [replays, setReplays] = useState<SavedReplay[]>(
    initialReplay ? [initialReplay] : [],
  );
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [selected, setSelected] = useState(project.clips[0]?.id ?? "");
  const [time, setTime] = useState(0),
    head = useRef(0);
  const [playing, setPlaying] = useState(false),
    running = useRef(false);
  const [status, setStatus] = useState("Loading library…"),
    [error, setError] = useState("");
  const [loading, setLoading] = useState(false),
    [initialized, setInitialized] = useState(false);
  const [storage, setStorage] = useState({
    used: 0,
    quota: 0,
    persistent: false,
  });
  const [exportState, setExportState] = useState<ExportState>({
    phase: "idle",
  });
  const exporter = useRef(new ReplayVideoExport()),
    exporting = useRef(false),
    preparing = useRef(false);
  const [preparingExport, setPreparingExport] = useState(false);
  const exportGeneration = useRef(0),
    playGeneration = useRef(0);
  const preview = useRef<ReplayPreview | null>(null),
    host = useRef<HTMLDivElement>(null),
    dialog = useRef<HTMLElement>(null);
  const saveQueue = useRef(Promise.resolve()),
    alive = useRef(true);
  const undo = useRef<StudioProject[]>([]),
    redo = useRef<StudioProject[]>([]),
    [history, setHistory] = useState(0);
  const duration = projectDuration(project),
    clip = project.clips.find((c) => c.id === selected),
    source = clip ? project.sources[clip.replayId] : null;
  const active = locateClip(project, time);
  const scene = project.scene ?? newScene();
  const object = scene.objects.find((o) => o.id === sceneSelected);
  sceneCallbacks.current = {
    select: selectObject,
    transform: changeObjectPose,
  };
  const exportBusy =
    preparingExport ||
    exportState.phase === "recording" ||
    exportState.phase === "finishing";
  const busy = importing || exportBusy;
  function stop() {
    ++playGeneration.current;
    running.current = false;
    setPlaying(false);
    preview.current?.pauseAudio();
  }
  function seek(value: number) {
    stop();
    head.current = Math.max(
      0,
      Math.min(value, projectDuration(projectRef.current)),
    );
    setTime(head.current);
  }
  function commit(next: StudioProject, track = true) {
    if (exporting.current || preparing.current) return;
    stop();
    if (track) {
      undo.current.push(projectRef.current);
      if (undo.current.length > 40) undo.current.shift();
      redo.current = [];
      setHistory((n) => n + 1);
    }
    next = { ...next, updatedAt: Date.now() };
    projectRef.current = next;
    setProject(next);
    head.current = Math.min(head.current, projectDuration(next));
    setTime(head.current);
    setStatus("Saving…");
  }
  function edit(values: Partial<StudioClip>) {
    if (
      clip &&
      values.cameraAnchor &&
      values.cameraAnchor !== (clip.cameraAnchor ?? "aircraft")
    ) {
      const from = clip.cameraAnchor ?? "aircraft",
        to = values.cameraAnchor;
      const origin = project.sources[project.clips[0].replayId].frames[0].p;
      const frames = project.sources[clip.replayId].frames;
      values = {
        ...values,
        cameraKeys: (clip.cameraKeys ?? []).map((key) => {
          const pose = sampleFrames(frames, key.t);
          const subject = pose.a.p.map(
            (n, i) => n + (pose.b.p[i] - n) * pose.mix,
          );
          const convert = (position: Vec3) =>
            convertAnchor(
              { position, rotation: [0, 0, 0], scale: [1, 1, 1] },
              from,
              to,
              origin,
              subject,
              [0, 0, 0, 1],
            ).position;
          return {
            ...key,
            position: convert(key.position),
            target: convert(key.target),
          };
        }),
      };
    }
    if (clip)
      commit({
        ...project,
        clips: project.clips.map((c) =>
          c.id === clip.id ? { ...c, ...values } : c,
        ),
      });
  }
  function add(replay: SavedReplay) {
    const next = addReplayClip(projectRef.current, replay);
    commit(next);
    selectClip(next.clips.length - 1, next);
  }
  function selectClip(index: number, p = projectRef.current) {
    const c = p.clips[index];
    if (!c) return;
    setSelected(c.id);
    seek(p.clips.slice(0, index).reduce((t, c) => t + clipDuration(c), 0));
  }
  function historyStep(back: boolean) {
    const from = back ? undo.current : redo.current,
      to = back ? redo.current : undo.current,
      next = from.pop();
    if (next) {
      to.push(projectRef.current);
      commit(next, false);
      setSelected(next.clips[0]?.id ?? "");
      setHistory((n) => n + 1);
    }
  }
  function move(delta: number) {
    if (!clip) return;
    const list = [...project.clips],
      i = list.indexOf(clip),
      target = i + delta;
    if (target < 0 || target >= list.length) return;
    [list[i], list[target]] = [list[target], list[i]];
    commit({ ...project, clips: list });
    selectClip(target, { ...project, clips: list });
  }
  function split() {
    const point = locateClip(project, head.current);
    if (
      !point ||
      point.sourceTime - point.clip.in < 0.1 ||
      point.clip.out - point.sourceTime < 0.1
    )
      return;
    const list = [...project.clips];
    list.splice(
      point.index,
      1,
      { ...point.clip, out: point.sourceTime },
      { ...point.clip, id: crypto.randomUUID(), in: point.sourceTime },
    );
    commit({ ...project, clips: list });
    setSelected(list[point.index + 1].id);
  }
  async function persist(p: StudioProject) {
    const job = saveQueue.current
      .catch(() => {})
      .then(() => library.saveProject(p));
    saveQueue.current = job;
    try {
      await job;
      if (alive.current) {
        setProjects((prev) => [p, ...prev.filter((v) => v.id !== p.id)]);
        if (projectRef.current.updatedAt === p.updatedAt)
          setStatus("Saved in this browser");
        setStorage(await libraryStorage());
      }
    } catch (e) {
      if (alive.current) {
        setStatus("Not saved");
        setError(
          `${message(e)} Your edit is still open. Download a project backup to keep it.`,
        );
      }
    }
  }
  function switchProject(p: StudioProject) {
    void persist(projectRef.current);
    commit(p, false);
    undo.current = [];
    redo.current = [];
    setHistory((n) => n + 1);
    setSelected(p.clips[0]?.id ?? "");
    seek(0);
  }
  function close() {
    ++exportGeneration.current;
    exporter.current.reset();
    exporting.current = false;
    preparing.current = false;
    stop();
    void persist(projectRef.current);
    onClose();
  }
  async function play() {
    if (running.current) {
      stop();
      return;
    }
    if (!projectRef.current.clips.length || preparing.current) return;
    preview.current?.startAudio();
    const token = ++playGeneration.current;
    const point = locateClip(
      projectRef.current,
      head.current >= projectDuration(projectRef.current) ? 0 : head.current,
    );
    if (!point) return;
    try {
      await Promise.all([
        preview.current?.load(point.source),
        preview.current?.prepareScene(projectRef.current, assetMap.current),
      ]);
      if (!alive.current || token !== playGeneration.current) return;
      if (head.current >= projectDuration(projectRef.current)) head.current = 0;
      running.current = true;
      setPlaying(true);
    } catch (e) {
      setError(message(e));
    }
  }
  async function exportVideo() {
    if (!projectRef.current.clips.length || !preview.current) return;
    stop();
    const token = ++exportGeneration.current;
    preview.current.startAudio();
    preparing.current = true;
    setPreparingExport(true);
    setError("");
    try {
      const p = projectRef.current;
      await Promise.all([
        preview.current.prepareScene(p, assetMap.current),
        ...p.clips.map((c) => preview.current!.load(p.sources[c.replayId])),
      ]);
      const render = p.scene?.render ?? newScene().render;
      preview.current.setSize(render.size);
      if (
        !alive.current ||
        !preparing.current ||
        token !== exportGeneration.current
      )
        return;
      const point = locateClip(p, 0)!;
      preview.current.render(
        point.source,
        point.sourceTime,
        point.clip.camera,
        false,
        point.clip.volume,
        p,
        0,
        { ...editorState.current, editing: false },
        point.clip,
      );
      head.current = 0;
      setTime(0);
      if (
        exporter.current.start(
          p.name,
          preview.current.soundtrack.captureTrack(),
          preview.current.canvas,
          projectDuration(p),
          {
            width: render.size === "1080p" ? 1920 : 1280,
            height: render.size === "1080p" ? 1080 : 720,
            fps: render.fps,
          },
        )
      ) {
        exporter.current.draw(preview.current.canvas, point.clip.title);
        exporting.current = true;
        running.current = true;
        setPlaying(true);
      }
      setExportState({ ...exporter.current.state });
    } catch (e) {
      setError(message(e));
    } finally {
      if (token === exportGeneration.current) {
        preparing.current = false;
        if (alive.current) setPreparingExport(false);
      }
    }
  }
  function cancelExport(reason?: string) {
    ++exportGeneration.current;
    preparing.current = false;
    setPreparingExport(false);
    exporting.current = false;
    exporter.current.cancel(reason);
    preview.current?.setSize("720p");
    setExportState({ ...exporter.current.state });
    stop();
  }
  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    void Promise.all([
      library.listReplays(),
      library.listProjects(),
      libraryStorage(),
      library.listAssets(),
    ])
      .then(([r, p, s, assets]) => {
        if (cancelled) return;
        setAssetBank(assets);
        assetMap.current = new Map(assets.map((a) => [a.id, a]));
        if (cancelled) return;
        setReplays(
          initialReplay
            ? [initialReplay, ...r.filter((v) => v.id !== initialReplay.id)]
            : r,
        );
        setProjects(p);
        setStorage(s);
        setStatus("Saved in this browser");
        if (!initialReplay && p[0]) {
          projectRef.current = p[0];
          setProject(p[0]);
          setSelected(p[0].clips[0]?.id ?? "");
        }
      })
      .catch((e) => {
        if (!cancelled) {
          setStatus("Not saved");
          setError(message(e));
        }
      })
      .finally(() => {
        if (!cancelled) setInitialized(true);
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [library, initialReplay]);
  useEffect(() => {
    if (initialized && !dialog.current?.contains(document.activeElement))
      dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [initialized]);
  useEffect(() => {
    if (!initialized) return;
    const timer = setTimeout(() => void persist(project), 500);
    return () => clearTimeout(timer);
  }, [project, initialized]);

  useEffect(() => {
    const view = preview.current;
    if (!view) return;
    const generation = ++sceneGeneration.current;
    sceneReady.current = false;
    setSceneLoading(true);
    void view
      .prepareScene(project, assetMap.current)
      .then(() => {
        if (alive.current && generation === sceneGeneration.current) {
          sceneReady.current = true;
          setSceneLoading(false);
        }
      })
      .catch((e) => {
        if (alive.current && generation === sceneGeneration.current) {
          stop();
          setSceneLoading(false);
          setError(message(e));
        }
      });
  }, [project.scene, assetBank, initialized]);
  useEffect(() => {
    let frame = 0,
      last = performance.now(),
      lastUI = 0,
      failed = "";
    try {
      preview.current = new ReplayPreview(host.current!);
      preview.current.onSceneSelect = (id) => sceneCallbacks.current.select(id);
      preview.current.onSceneTransform = (id, pose) =>
        sceneCallbacks.current.transform(id, pose);
    } catch (e) {
      setError(`Preview could not start: ${message(e)}`);
      return;
    }
    const render = (now: number) => {
      const view = preview.current;
      if (!view) return;
      const dt = (now - last) / 1000;
      last = now;
      const p = projectRef.current,
        point = locateClip(p, head.current);
      if (point) {
        if (!view.isReady(point.source.aircraft)) {
          if (failed !== point.source.aircraft) {
            setLoading(true);
            void view
              .load(point.source)
              .then(() => {
                if (alive.current) setLoading(false);
              })
              .catch((e) => {
                failed = point.source.aircraft;
                stop();
                setLoading(false);
                setError(message(e));
              });
          }
        } else {
          if (running.current && sceneReady.current)
            head.current = Math.min(head.current + dt, projectDuration(p));
          const current = locateClip(p, head.current)!;
          if (view.isReady(current.source.aircraft)) {
            view.render(
              current.source,
              current.sourceTime,
              current.clip.camera,
              running.current,
              current.clip.volume,
              p,
              head.current,
              editorState.current,
              current.clip,
            );
            if (exporting.current)
              exporter.current.draw(view.canvas, current.clip.title);
          }
          if (running.current && head.current >= projectDuration(p)) {
            stop();
            if (exporting.current) {
              exporting.current = false;
              exporter.current.finish();
              view.setSize("720p");
            }
          }
        }
      }
      if (now - lastUI > 100) {
        lastUI = now;
        setTime(head.current);
        setExportState((old) =>
          old.phase === exporter.current.state.phase
            ? old
            : { ...exporter.current.state },
        );
      }
      frame = requestAnimationFrame(render);
    };
    frame = requestAnimationFrame(render);
    const visibility = () => {
      if (document.hidden) {
        if (exporter.current.busy || preparing.current)
          cancelExport(
            "Export stopped because the tab was hidden. Keep the tab visible and try again.",
          );
        else stop();
      }
    };
    document.addEventListener("visibilitychange", visibility);
    const previous = document.activeElement as HTMLElement;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("visibilitychange", visibility);
      exporter.current.reset();
      preview.current?.dispose();
      preview.current = null;
      previous?.focus();
    };
  }, []);
  async function renameReplay(replay: SavedReplay, name: string) {
    name = name.trim() || replay.name;
    if (name === replay.name) return;
    const next = { ...replay, name, updatedAt: Date.now() };
    try {
      await library.saveReplay(next);
      setReplays((prev) => prev.map((r) => (r.id === next.id ? next : r)));
    } catch (e) {
      setError(message(e));
    }
  }
  async function importBackup(file: File) {
    try {
      if (file.size > 512 * 1024 * 1024)
        throw new Error("This backup is too large (maximum 512 MB).");
      const text = await file.text();
      const data: unknown = JSON.parse(text);
      if ((data as { type?: string })?.type === "pocket-flight-studio-bundle") {
        const bundle = unpackProject(text);
        await library.saveProject(bundle.project, bundle.assets);
        const merged = new Map(assetMap.current);
        for (const asset of bundle.assets) merged.set(asset.id, asset);
        assetMap.current = merged;
        setAssetBank([...merged.values()]);
        switchProject(bundle.project);
        setError("");
        return;
      }
      if (validateReplay(data)) {
        await library.saveReplay(data);
        setReplays((prev) => [data, ...prev.filter((r) => r.id !== data.id)]);
        setError("");
      } else if (validateProject(data)) {
        await library.saveProject(data);
        switchProject(data);
        setError("");
      } else
        throw new Error(
          "This is not a valid Pocket Flight replay or project backup.",
        );
    } catch (e) {
      setError(message(e));
    }
  }

  function updateScene(next: StudioScene) {
    commit({ ...projectRef.current, scene: next });
  }
  function selectObject(id: string | null) {
    setSceneSelected(id);
    if (id) {
      setInspectorTab("object");
      setLibraryTab("scene");
      setEditingMode(true);
    }
  }
  function changeObject(id: string, values: Partial<SceneObject>) {
    const p = projectRef.current,
      scene = p.scene ?? newScene();
    if (
      values.anchor &&
      values.anchor !== scene.objects.find((o) => o.id === id)?.anchor
    ) {
      const object = scene.objects.find((o) => o.id === id),
        first = p.clips[0];
      if (object && first) {
        const convert = (transform: Transform, t: number) => {
          const point = locateClip(p, t);
          if (!point) return transform;
          const frame = sampleFrames(point.source.frames, point.sourceTime);
          const position = frame.a.p.map(
            (n, i) => n + (frame.b.p[i] - n) * frame.mix,
          );
          return convertAnchor(
            transform,
            object.anchor,
            values.anchor!,
            p.sources[first.replayId].frames[0].p,
            position,
            frame.a.q,
          );
        };
        values = {
          ...values,
          transform: convert(object.transform, head.current),
          keys: object.keys.map((k) => ({
            ...k,
            transform: convert(k.transform, k.t),
          })),
        };
      }
    }
    updateScene({
      ...scene,
      objects: scene.objects.map((o) =>
        o.id === id ? { ...o, ...values } : o,
      ),
    });
  }
  function changeObjectPose(id: string, pose: Transform) {
    const p = projectRef.current,
      object = p.scene?.objects.find((o) => o.id === id);
    if (!object || object.locked) return;
    const next =
      autoKey || object.keys.length
        ? setTransformKey(object, head.current, pose, "smooth")
        : { ...object, transform: pose };
    changeObject(id, next);
  }
  function keyObject(id: string, ease: Ease = "smooth") {
    const o = projectRef.current.scene?.objects.find((o) => o.id === id);
    if (o)
      changeObject(
        id,
        setTransformKey(
          o,
          head.current,
          sampleTransform(o, head.current),
          ease,
        ),
      );
  }
  function spawnPosition(): Vec3 {
    const p = projectRef.current,
      point = locateClip(p, head.current),
      first = p.clips[0];
    if (!point || !first) return [8, 3, 0];
    const origin = p.sources[first.replayId].frames[0].p,
      pose = sampleFrames(point.source.frames, point.sourceTime);
    return pose.a.p.map(
      (n, i) =>
        n +
        (pose.b.p[i] - n) * pose.mix -
        origin[i] +
        (i === 0 ? 8 : i === 1 ? 2 : 0),
    ) as Vec3;
  }
  function addPrimitive(kind: ObjectKind) {
    const scene = projectRef.current.scene ?? newScene(),
      o = newObject(kind, spawnPosition());
    updateScene({ ...scene, objects: [...scene.objects, o] });
    selectObject(o.id);
  }
  function addAsset(asset: StudioAsset) {
    const scene = projectRef.current.scene ?? newScene();
    if (asset.kind === "audio") {
      updateScene({
        ...scene,
        sounds: [
          ...scene.sounds,
          {
            id: crypto.randomUUID(),
            assetId: asset.id,
            name: asset.name,
            start: 0,
            end: null,
            offset: 0,
            volume: 0.65,
            fadeIn: 0,
            fadeOut: 0,
            loop: false,
          },
        ],
      });
      setInspectorTab("project");
      return;
    }
    const o = {
      ...newObject(asset.kind === "image" ? "image" : "asset", spawnPosition()),
      assetId: asset.id,
      name: asset.name,
      color: "#ffffff",
      animation: asset.animations.length ? 0 : -1,
    };
    updateScene({ ...scene, objects: [...scene.objects, o] });
    selectObject(o.id);
  }
  function duplicateObject(id: string) {
    const scene = projectRef.current.scene ?? newScene(),
      object = scene.objects.find((o) => o.id === id);
    if (!object) return;
    const next = {
      ...structuredClone(object),
      keys: object.keys.map((k) => ({
        ...structuredClone(k),
        transform: {
          ...structuredClone(k.transform),
          position: [
            k.transform.position[0] + 4,
            k.transform.position[1],
            k.transform.position[2],
          ] as Vec3,
        },
      })),
      id: crypto.randomUUID(),
      name: `${object.name} copy`,
      transform: {
        ...object.transform,
        position: [
          object.transform.position[0] + 4,
          ...object.transform.position.slice(1),
        ] as Vec3,
      },
    };
    updateScene({ ...scene, objects: [...scene.objects, next] });
    selectObject(next.id);
  }
  function removeObject(id: string) {
    const scene = projectRef.current.scene ?? newScene();
    updateScene({
      ...scene,
      objects: scene.objects.filter((o) => o.id !== id),
    });
    if (sceneSelected === id) setSceneSelected(null);
  }
  async function importAssets(files: File[]) {
    if (!files.length || busy) return;
    stop();
    setImporting(true);
    setError("");
    try {
      const imported = await readAssets(files);
      const map = new Map(assetMap.current);
      for (const a of imported) map.set(a.id, a);
      for (const asset of imported) {
        if (asset.kind === "audio") {
          await preview.current?.soundtrack.prepare(
            {
              ...newScene(),
              sounds: [
                {
                  id: "import",
                  assetId: asset.id,
                  name: asset.name,
                  start: 0,
                  end: null,
                  offset: 0,
                  volume: 0,
                  fadeIn: 0,
                  fadeOut: 0,
                  loop: false,
                },
              ],
            },
            map,
          );
        } else {
          const model = await preview.current?.assets.loadAsset(asset);
          asset.animations = model?.animations.map((a) => a.name) ?? [];
        }
      }
      await library.saveAssets(imported);
      if (!alive.current) return;
      assetMap.current = map;
      setAssetBank([...map.values()]);
      setLibraryTab("assets");
      for (const a of imported) addAsset(a);
    } catch (e) {
      setError(message(e));
    } finally {
      if (alive.current) setImporting(false);
    }
  }
  async function copyProjectBackup() {
    try {
      const text = await packProject(projectRef.current, [
        ...assetMap.current.values(),
      ]);
      if (text.length > 16 * 1024 * 1024)
        throw new Error(
          "This project is too large for the clipboard. Download its backup instead.",
        );
      await navigator.clipboard.writeText(text);
      setStatus("Project backup copied");
    } catch (e) {
      setError(message(e));
    }
  }
  async function backupProject() {
    try {
      downloadProject(
        await packProject(projectRef.current, [...assetMap.current.values()]),
        projectRef.current.name,
      );
    } catch (e) {
      setError(message(e));
    }
  }
  function captureCamera() {
    const point = locateClip(projectRef.current, head.current);
    if (!point || !preview.current) return;
    const key = preview.current.captureCamera(
      point.clip.cameraAnchor ?? "aircraft",
      point.sourceTime,
    );
    commit({
      ...projectRef.current,
      clips: projectRef.current.clips.map((c) =>
        c.id === point.clip.id
          ? {
              ...c,
              camera: "custom",
              cameraKeys: setCameraKey(c.cameraKeys ?? [], key),
            }
          : c,
      ),
    });
    setSelected(point.clip.id);
    setInspectorTab("camera");
  }
  function seekCamera(sourceTime: number) {
    if (!clip) return;
    const start = project.clips
      .slice(0, project.clips.indexOf(clip))
      .reduce((t, c) => t + clipDuration(c), 0);
    seek(
      start +
        (Math.max(clip.in, Math.min(sourceTime, clip.out)) - clip.in) /
          clip.speed,
    );
  }
  void history;
  return (
    <section
      className="replay-studio"
      role="dialog"
      aria-modal="true"
      aria-label="Replay studio"
      ref={dialog}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) e.preventDefault();
      }}
      onDrop={(e) => {
        if (e.dataTransfer.files.length) {
          e.preventDefault();
          void importAssets(Array.from(e.dataTransfer.files));
        }
      }}
      onKeyDown={(e) => {
        if (e.key === "Tab") {
          const nodes = Array.from(
            dialog.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href]",
            ),
          );
          const first = nodes[0],
            last = nodes.at(-1);
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last?.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first?.focus();
          }
        }
        if ((e.target as HTMLElement).closest("input,select,textarea")) return;
        if (e.key === "Escape") {
          e.preventDefault();
          if (busy) cancelExport();
          else if (editingMode) {
            setEditingMode(false);
            preview.current?.transforms.reset();
          } else close();
        }

        if (!busy && !e.metaKey && !e.ctrlKey) {
          if (["KeyG", "KeyR", "KeyS"].includes(e.code)) {
            e.preventDefault();
            setEditingMode(true);
            setTool(
              e.code === "KeyG"
                ? "translate"
                : e.code === "KeyR"
                  ? "rotate"
                  : "scale",
            );
          }
          if (e.code === "KeyF") {
            e.preventDefault();
            setEditingMode(true);
            preview.current?.frameObject(sceneSelected);
          }
          if (e.code === "KeyI" && sceneSelected) {
            e.preventDefault();
            keyObject(sceneSelected);
          }
          if (e.code === "KeyD" && e.shiftKey && sceneSelected) {
            e.preventDefault();
            duplicateObject(sceneSelected);
          }
          if (
            (e.code === "Delete" || e.code === "Backspace") &&
            sceneSelected &&
            editingMode
          ) {
            e.preventDefault();
            removeObject(sceneSelected);
          }
        }
        if (e.code === "Space" && !busy) {
          e.preventDefault();
          void play();
        }
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z" && !busy) {
          e.preventDefault();
          historyStep(!e.shiftKey);
        }
      }}
    >
      <header className="studio-header">
        <div className="studio-brand">
          <Film size={22} />
          <div>
            <b>Scene Studio</b>
            <small>POCKET FLIGHT</small>
          </div>
        </div>
        <input
          aria-label="Project name"
          className="studio-name"
          value={project.name}
          maxLength={80}
          disabled={busy || !initialized}
          onChange={(e) => commit({ ...project, name: e.target.value })}
        />
        <span className="studio-save" role="status">
          {status}
        </span>
        <button
          className="studio-primary"
          disabled={
            busy ||
            sceneLoading ||
            !project.clips.length ||
            !initialized ||
            !exporter.current.supported
          }
          onClick={() => void exportVideo()}
        >
          <Download size={16} />
          Export video
        </button>
        <button aria-label="Close replay studio" onClick={close}>
          <X size={20} />
        </button>
      </header>
      {error && (
        <div className="studio-error" role="alert">
          <span>{error}</span>
          <button aria-label="Dismiss error" onClick={() => setError("")}>
            <X size={16} />
          </button>
        </div>
      )}
      <div className="studio-workspace">
        <aside className="studio-library">
          <div className="scene-tabs">
            {(["flights", "assets", "scene"] as const).map((tab) => (
              <button
                key={tab}
                aria-pressed={libraryTab === tab}
                onClick={() => setLibraryTab(tab)}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          {libraryTab === "assets" ? (
            <SceneAssetBrowser
              assets={assetBank}
              disabled={busy || !initialized}
              onImport={(files) => void importAssets(files)}
              onAdd={addAsset}
              onPrimitive={addPrimitive}
            />
          ) : libraryTab === "scene" ? (
            <SceneOutliner
              scene={scene}
              selected={sceneSelected}
              disabled={busy}
              onSelect={selectObject}
              onUpdate={changeObject}
              onDuplicate={duplicateObject}
              onRemove={removeObject}
            />
          ) : (
            <>
              {" "}
              <div className="studio-section-heading">
                <h2>Saved flights</h2>
                <span>{replays.length}</span>
              </div>
              <p className="studio-hint">
                Flights save automatically when paused or finished, and every 10
                seconds.
              </p>
              <div className="studio-flight-list">
                {replays.map((r) => (
                  <article className="studio-flight" key={r.id}>
                    <span className="studio-flight-icon">
                      <Film size={18} />
                    </span>
                    <div>
                      <input
                        className="studio-recording-name"
                        aria-label={`Recording name: ${r.name}`}
                        defaultValue={r.name}
                        maxLength={80}
                        disabled={busy}
                        onBlur={(e) => void renameReplay(r, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                      />
                      <small>
                        {aircraftNames[r.aircraft]} · {clock(r.duration)}
                      </small>
                      <small>
                        {new Date(r.createdAt).toLocaleDateString()}
                        {r.trimmed ? " · latest 30 min" : ""}
                      </small>
                    </div>
                    <div className="studio-flight-actions">
                      <button
                        aria-label={`Add ${r.name} to timeline`}
                        title="Add to timeline"
                        disabled={busy || !initialized}
                        onClick={() => add(r)}
                      >
                        <Plus size={17} />
                      </button>
                      <button
                        aria-label={`Back up ${r.name}`}
                        title="Download replay backup"
                        onClick={() =>
                          downloadData(r, `${slug(r.name)}.replay.json`)
                        }
                      >
                        <Download size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {!replays.length && (
                <div className="studio-empty-library">
                  <Film size={26} />
                  <b>Your flights belong here.</b>
                  <p>
                    Fly for at least one second, then pause to save a replay.
                  </p>
                </div>
              )}
            </>
          )}
          <div className="studio-projects">
            <h2>Projects</h2>
            <select
              aria-label="Open saved project"
              value={
                projects.some((p) => p.id === project.id) ? project.id : ""
              }
              disabled={busy || !initialized}
              onChange={(e) => {
                const p = projects.find((p) => p.id === e.target.value);
                if (p) switchProject(p);
              }}
            >
              <option value="" disabled>
                Choose a project
              </option>
              {projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name || "Untitled film"}
                </option>
              ))}
            </select>
            <div className="studio-button-row">
              <button
                disabled={busy || !initialized}
                onClick={() => switchProject(newProject())}
              >
                <Plus size={14} />
                New film
              </button>
              <button onClick={() => void backupProject()}>
                <Download size={14} />
                Backup
              </button>
              <button
                aria-label="Copy project backup"
                title="Copy portable project JSON"
                onClick={() => void copyProjectBackup()}
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
          <div className="studio-storage">
            <HardDrive size={15} />
            <span>
              {(storage.used / 1024 / 1024).toFixed(1)} MB used
              {storage.quota
                ? ` of ${(storage.quota / 1024 / 1024 / 1024).toFixed(1)} GB`
                : ""}
            </span>
            <small>
              {storage.persistent
                ? "Persistent storage granted"
                : "Saved on this browser and site address. Clearing site data removes saves; keep backups."}
            </small>
            {!storage.persistent && (
              <button
                onClick={() => {
                  void navigator.storage
                    ?.persist?.()
                    .then(async (granted) => {
                      setStorage(await libraryStorage());
                      if (!granted)
                        setError(
                          "The browser did not grant persistent storage. Saves still work; keep a backup.",
                        );
                    })
                    .catch((e) => setError(message(e)));
                }}
              >
                Keep recordings
              </button>
            )}
            <label className="studio-import">
              Restore a replay / project backup
              <input
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importBackup(f);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </aside>
        <div className="studio-center">
          <div className="scene-toolbar">
            <div className="scene-tabs">
              <button
                aria-pressed={!editingMode}
                disabled={busy}
                onClick={() => setEditingMode(false)}
              >
                Rendered preview
              </button>
              <button
                aria-pressed={editingMode}
                disabled={busy}
                onClick={() => {
                  stop();
                  setEditingMode(true);
                }}
              >
                Scene mode
              </button>
            </div>
            <div className="studio-button-row">
              {(
                [
                  { value: "translate", icon: Move3D, label: "Move (G)" },
                  { value: "rotate", icon: Rotate3D, label: "Rotate (R)" },
                  { value: "scale", icon: Scaling, label: "Scale (S)" },
                ] as const
              ).map(({ value, icon: Icon, label }) => (
                <button
                  key={value}
                  aria-label={label}
                  aria-pressed={tool === value && editingMode}
                  disabled={busy}
                  onClick={() => {
                    setTool(value);
                    setEditingMode(true);
                  }}
                >
                  <Icon size={15} />
                </button>
              ))}
              <button
                aria-label="Frame selected object (F)"
                disabled={busy}
                onClick={() => {
                  setEditingMode(true);
                  preview.current?.frameObject(sceneSelected);
                }}
              >
                <Focus size={16} />
              </button>
              <button
                aria-label="Toggle transform snapping"
                aria-pressed={snap}
                disabled={busy}
                onClick={() => setSnap(!snap)}
              >
                <Magnet size={15} />
              </button>
              <button
                aria-label="Toggle auto keyframes"
                aria-pressed={autoKey}
                disabled={busy}
                onClick={() => setAutoKey(!autoKey)}
              >
                <Diamond size={14} />
              </button>
            </div>
          </div>
          {editingMode && (
            <div className="scene-view-tools">
              <span>Orbit: drag · Pan: right-drag · Zoom: wheel</span>
              <button
                disabled={busy}
                onClick={() => preview.current?.setView("front")}
              >
                Front
              </button>
              <button
                disabled={busy}
                onClick={() => preview.current?.setView("side")}
              >
                Side
              </button>
              <button
                disabled={busy}
                onClick={() => preview.current?.setView("top")}
              >
                Top
              </button>
              <button disabled={busy} onClick={captureCamera}>
                <Camera size={13} />
                Camera key
              </button>
            </div>
          )}

          <div className="studio-preview" ref={host}>
            {!project.clips.length && (
              <div className="studio-empty-preview">
                <Film size={36} />
                <h2>Make something worth replaying.</h2>
                <p>Add a saved flight to your timeline.</p>
              </div>
            )}
            {(loading || sceneLoading || importing) && (
              <div className="studio-loading" role="status">
                {importing
                  ? "Importing assets…"
                  : sceneLoading
                    ? "Preparing scene…"
                    : "Loading aircraft…"}
              </div>
            )}
            {active?.clip.title && (
              <div className="studio-caption">{active.clip.title}</div>
            )}
            {!!active && (
              <span className="studio-shot-label">
                {shots[active.clip.camera]} · {active.clip.speed}×
              </span>
            )}
          </div>
          <div className="studio-transport">
            <button
              aria-label="Back to start"
              disabled={busy}
              onClick={() => seek(0)}
            >
              <RotateCcw size={17} />
            </button>
            <button
              className="studio-play"
              aria-label={playing ? "Pause preview" : "Play preview"}
              disabled={
                busy || loading || sceneLoading || !project.clips.length
              }
              onClick={() => void play()}
            >
              {playing ? <Pause size={20} /> : <Play size={20} />}
            </button>
            <span>
              {clock(time)} <small>/ {clock(duration)}</small>
            </span>
            <input
              aria-label="Replay playhead"
              type="range"
              min={0}
              max={Math.max(0.1, duration)}
              step={0.01}
              value={time}
              disabled={busy || !project.clips.length}
              onChange={(e) => seek(+e.target.value)}
            />
          </div>
          {(exportBusy ||
            exportState.phase === "ready" ||
            exportState.phase === "error") && (
            <div className="studio-export-status" role="status">
              {exportBusy ? (
                <>
                  <span>
                    {preparingExport
                      ? "Preparing aircraft…"
                      : exportState.phase === "finishing"
                        ? "Finishing video…"
                        : `Exporting ${Math.round((time / Math.max(0.1, duration)) * 100)}% · keep this tab visible`}
                  </span>
                  <button onClick={() => cancelExport()}>Cancel export</button>
                </>
              ) : exportState.phase === "ready" ? (
                <>
                  <span>
                    Video exported · {scene.render.size} · {scene.render.fps}{" "}
                    fps
                  </span>
                  <details className="studio-render-review">
                    <summary>Watch export</summary>
                    <video
                      controls
                      preload="metadata"
                      src={exportState.url}
                      aria-label="Exported film preview"
                    />
                  </details>
                  <a href={exportState.url} download={exportState.filename}>
                    <Download size={15} />
                    Save video again
                  </a>
                </>
              ) : (
                <span>{exportState.message}</span>
              )}
            </div>
          )}
          {!exporter.current.supported && (
            <p className="studio-hint">
              Video export is unavailable in this browser. Editing and project
              backups still work.
            </p>
          )}
          <div className="studio-timeline">
            <div className="studio-section-heading">
              <h2>
                Timeline{" "}
                <small>
                  {project.clips.length} clips · {clock(duration)}
                </small>
              </h2>
              <div className="studio-button-row">
                <button
                  aria-label="Undo edit"
                  title="Undo · ⌘Z"
                  disabled={busy || !undo.current.length}
                  onClick={() => historyStep(true)}
                >
                  <Undo2 size={16} />
                </button>
                <button
                  aria-label="Redo edit"
                  title="Redo · ⇧⌘Z"
                  disabled={busy || !redo.current.length}
                  onClick={() => historyStep(false)}
                >
                  <Redo2 size={16} />
                </button>
                <button
                  disabled={
                    busy ||
                    !active ||
                    active.sourceTime - active.clip.in < 0.1 ||
                    active.clip.out - active.sourceTime < 0.1
                  }
                  onClick={split}
                >
                  <Scissors size={15} />
                  Split at playhead
                </button>
              </div>
            </div>
            <div className="studio-clips">
              {project.clips.map((c, i) => (
                <button
                  className={`studio-clip ${c.id === selected ? "selected" : ""} ${active?.clip.id === c.id ? "current" : ""}`}
                  key={c.id}
                  disabled={busy}
                  onClick={() => selectClip(i)}
                  style={{
                    flexGrow: Math.min(6, Math.max(1, clipDuration(c) / 8)),
                  }}
                  aria-pressed={c.id === selected}
                >
                  <span className="studio-clip-number">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <b>{project.sources[c.replayId].name}</b>
                  <small>
                    {shots[c.camera]} · {c.speed}×
                  </small>
                  <span>{clock(clipDuration(c))}</span>
                </button>
              ))}
              {!project.clips.length && (
                <p className="studio-hint">
                  Add flights from the library to build your film.
                </p>
              )}
            </div>
            {!!(scene.objects.length || scene.sounds.length) && (
              <SceneKeyTimeline
                scene={scene}
                duration={duration}
                selected={sceneSelected}
                onSelect={selectObject}
                onSeek={seek}
              />
            )}
          </div>
        </div>
        <aside className="studio-inspector">
          <div className="scene-tabs inspector-tabs">
            {(["clip", "object", "camera", "project"] as const).map((tab) => (
              <button
                key={tab}
                aria-pressed={inspectorTab === tab}
                onClick={() => setInspectorTab(tab)}
              >
                {tab[0].toUpperCase() + tab.slice(1)}
              </button>
            ))}
          </div>
          {inspectorTab === "object" ? (
            object ? (
              <SceneObjectInspector
                object={object}
                asset={
                  object.assetId
                    ? assetMap.current.get(object.assetId)
                    : undefined
                }
                time={time}
                disabled={busy}
                onUpdate={(v) => changeObject(object.id, v)}
                onPose={(pose) => changeObjectPose(object.id, pose)}
                onKey={(ease) => keyObject(object.id, ease)}
                onRemoveKey={(t) =>
                  changeObject(object.id, {
                    keys: object.keys.filter((k) => k.t !== t),
                  })
                }
                onSeek={seek}
              />
            ) : (
              <p className="studio-hint">
                Select an object in the scene or outliner.
              </p>
            )
          ) : inspectorTab === "camera" ? (
            clip && preview.current ? (
              <SceneCameraInspector
                clip={clip}
                sourceTime={
                  active?.clip.id === clip.id ? active.sourceTime : clip.in
                }
                disabled={busy || active?.clip.id !== clip.id}
                current={preview.current.captureCamera(
                  clip.cameraAnchor ?? "aircraft",
                  active?.sourceTime ?? clip.in,
                )}
                onCapture={captureCamera}
                onChange={edit}
                onSeek={seekCamera}
              />
            ) : (
              <p className="studio-hint">
                Add a flight clip to direct a camera.
              </p>
            )
          ) : inspectorTab === "project" ? (
            <SceneProjectInspector
              scene={scene}
              assets={assetBank}
              disabled={busy}
              onChange={updateScene}
            />
          ) : (
            <>
              {" "}
              <h2>Clip settings</h2>
              {clip && source ? (
                <>
                  <div className="studio-selected-title">
                    <b>{source.name}</b>
                    <small>
                      {aircraftNames[source.aircraft]} · source{" "}
                      {clock(source.duration)}
                    </small>
                  </div>
                  <fieldset disabled={busy}>
                    <legend>Trim · seconds</legend>
                    <div className="studio-trim">
                      <label>
                        In
                        <input
                          aria-label="Trim in seconds"
                          type="number"
                          min={0}
                          max={source.duration - 0.1}
                          step={0.1}
                          value={+clip.in.toFixed(2)}
                          onChange={(e) =>
                            edit(
                              trimClip(
                                clip,
                                +e.target.value,
                                clip.out,
                                source.duration,
                              ),
                            )
                          }
                        />
                      </label>
                      <label>
                        Out
                        <input
                          aria-label="Trim out seconds"
                          type="number"
                          min={clip.in + 0.1}
                          max={source.duration}
                          step={0.1}
                          value={+clip.out.toFixed(2)}
                          onChange={(e) =>
                            edit(
                              trimClip(
                                clip,
                                clip.in,
                                +e.target.value,
                                source.duration,
                              ),
                            )
                          }
                        />
                      </label>
                    </div>
                    <label>
                      Camera shot
                      <select
                        aria-label="Camera shot"
                        value={clip.camera}
                        onChange={(e) =>
                          edit({ camera: e.target.value as Shot })
                        }
                      >
                        {Object.entries(shots).map(([key, label]) => (
                          <option value={key} key={key}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Playback speed
                      <select
                        aria-label="Clip playback speed"
                        value={clip.speed}
                        onChange={(e) => edit({ speed: +e.target.value })}
                      >
                        {[0.25, 0.5, 1, 1.5, 2].map((n) => (
                          <option key={n} value={n}>
                            {n}×{n === 1 ? " · Normal" : ""}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Title overlay
                      <input
                        aria-label="Title overlay"
                        placeholder="A title for this shot"
                        maxLength={100}
                        value={clip.title}
                        onChange={(e) => edit({ title: e.target.value })}
                      />
                    </label>
                    <label>
                      Engine & wind audio{" "}
                      <span>{Math.round(clip.volume * 100)}%</span>
                      <input
                        aria-label="Clip audio volume"
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={clip.volume}
                        onChange={(e) => edit({ volume: +e.target.value })}
                      />
                    </label>
                    <div className="studio-button-row">
                      <button
                        aria-label="Move clip earlier"
                        disabled={project.clips[0] === clip}
                        onClick={() => move(-1)}
                      >
                        <ChevronLeft size={16} />
                      </button>
                      <button
                        aria-label="Move clip later"
                        disabled={project.clips.at(-1) === clip}
                        onClick={() => move(1)}
                      >
                        <ChevronRight size={16} />
                      </button>
                      <button
                        onClick={() => {
                          const list = [...project.clips],
                            i = list.indexOf(clip);
                          list.splice(i + 1, 0, {
                            ...clip,
                            id: crypto.randomUUID(),
                          });
                          commit({ ...project, clips: list });
                        }}
                      >
                        <Copy size={14} />
                        Duplicate
                      </button>
                    </div>
                    <button
                      className="studio-remove"
                      onClick={() => {
                        const list = project.clips.filter(
                          (c) => c.id !== clip.id,
                        );
                        const keys = new Set(list.map((c) => c.replayId));
                        commit({
                          ...project,
                          clips: list,
                          sources: Object.fromEntries(
                            Object.entries(project.sources).filter(([key]) =>
                              keys.has(key),
                            ),
                          ),
                        });
                        setSelected(list[0]?.id ?? "");
                      }}
                    >
                      <Trash2 size={14} />
                      Remove from timeline
                    </button>
                  </fieldset>
                  <p className="studio-hint">
                    Your original flight stays intact. Edits apply to this film.
                  </p>
                </>
              ) : (
                <p className="studio-hint">
                  Select a clip to trim it, choose a camera, or add a title.
                </p>
              )}
            </>
          )}
        </aside>
      </div>
      <footer className="studio-footer">
        <span>
          G move · R rotate · S scale · F frame · I key · Space play · ⌘Z undo
        </span>
        <a
          className="studio-guide-link"
          href="/scene-studio-guide.html"
          target="_blank"
          rel="noreferrer"
        >
          Video guide ↗
        </a>
        <span>
          Scene Studio · {scene.render.size} / {scene.render.fps} fps
        </span>
      </footer>
    </section>
  );
}
