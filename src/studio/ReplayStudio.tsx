import { StudioSceneToolbar } from "./panels/StudioSceneToolbar";
import { message } from "./studio-format";
import { StudioFlights } from "./panels/StudioFlights";
import { StudioProjects } from "./panels/StudioProjects";
import { StudioClipInspector } from "./panels/StudioClipInspector";
import { StudioTimeline } from "./panels/StudioTimeline";
import { StudioTransport } from "./panels/StudioTransport";
import { StudioExportStatus } from "./panels/StudioExportStatus";
import {
  editClip,
  moveClip,
  splitClip,
  duplicateClip,
  removeClip,
  changeSceneObject,
  sceneSpawnPosition,
  duplicateSceneObject,
  cameraFilmTime,
} from "./studio-editing";
import { useEffect, useRef, useState } from "react";
import { Film, X, Download } from "lucide-react";
import { ReplayLibrary, libraryStorage } from "../replay/replay-library";
import { validateReplay, type SavedReplay } from "../replay/replay-data";
import {
  newProject,
  addReplayClip,
  clipDuration,
  projectDuration,
  locateClip,
  shots,
  validateProject,
  type StudioProject,
  type StudioClip,
} from "./studio-model";
import { ReplayPreview } from "./replay-preview";
import { ReplayVideoExport, type ExportState } from "../replay/replay-export";

import "./studio.css";
import {
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
import { SceneAssetBrowser } from "./panels/SceneAssetBrowser";
import { SceneOutliner } from "./panels/SceneOutliner";
import { SceneObjectInspector } from "./panels/SceneObjectInspector";
import { SceneCameraInspector } from "./panels/SceneCameraInspector";
import { SceneProjectInspector } from "./panels/SceneProjectInspector";

import type { SceneEditorOptions } from "./replay-preview";
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
    if (clip) commit(editClip(project, clip, values));
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
    const next = moveClip(project, clip, delta);
    if (!next) return;
    commit(next.project);
    selectClip(next.index, next.project);
  }
  function split() {
    const next = splitClip(project, head.current);
    if (!next) return;
    commit(next.project);
    setSelected(next.selected);
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
    updateScene(
      changeSceneObject(projectRef.current, id, values, head.current),
    );
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
    return sceneSpawnPosition(projectRef.current, head.current);
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
    const next = duplicateSceneObject(object);
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
    if (clip) seek(cameraFilmTime(project, clip, sourceTime));
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
            <StudioFlights
              replays={replays}
              busy={busy}
              initialized={initialized}
              renameReplay={renameReplay}
              add={add}
            />
          )}
          <StudioProjects
            projects={projects}
            project={project}
            busy={busy}
            initialized={initialized}
            switchProject={switchProject}
            backupProject={backupProject}
            copyProjectBackup={copyProjectBackup}
            storage={storage}
            setStorage={setStorage}
            setError={setError}
            importBackup={importBackup}
          />
        </aside>
        <div className="studio-center">
          <StudioSceneToolbar
            editingMode={editingMode}
            busy={busy}
            tool={tool}
            snap={snap}
            autoKey={autoKey}
            setEditingMode={setEditingMode}
            stop={stop}
            setTool={setTool}
            frameObject={() => preview.current?.frameObject(sceneSelected)}
            setSnap={setSnap}
            setAutoKey={setAutoKey}
            setView={(view) => preview.current?.setView(view)}
            captureCamera={captureCamera}
          />

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
          <StudioTransport
            busy={busy}
            playing={playing}
            loading={loading}
            sceneLoading={sceneLoading}
            hasClips={!!project.clips.length}
            time={time}
            duration={duration}
            seek={seek}
            play={play}
          />
          <StudioExportStatus
            exportBusy={exportBusy}
            preparingExport={preparingExport}
            exportState={exportState}
            time={time}
            duration={duration}
            scene={scene}
            cancelExport={cancelExport}
          />
          {!exporter.current.supported && (
            <p className="studio-hint">
              Video export is unavailable in this browser. Editing and project
              backups still work.
            </p>
          )}
          <StudioTimeline
            project={project}
            duration={duration}
            busy={busy}
            canUndo={!!undo.current.length}
            canRedo={!!redo.current.length}
            historyStep={historyStep}
            active={active}
            split={split}
            selected={selected}
            selectClip={selectClip}
            scene={scene}
            sceneSelected={sceneSelected}
            selectObject={selectObject}
            seek={seek}
          />
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
            <StudioClipInspector
              project={project}
              clip={clip}
              source={source}
              busy={busy}
              edit={edit}
              move={move}
              onDuplicate={() => {
                if (clip) commit(duplicateClip(project, clip));
              }}
              onRemove={() => {
                if (!clip) return;
                const next = removeClip(project, clip);
                commit(next);
                setSelected(next.clips[0]?.id ?? "");
              }}
            />
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
