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
  const busy =
    preparingExport ||
    exportState.phase === "recording" ||
    exportState.phase === "finishing";
  function stop() {
    ++playGeneration.current;
    running.current = false;
    setPlaying(false);
    preview.current?.audio.update(0, 0, false);
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
    preview.current?.audio.start();
    const token = ++playGeneration.current;
    const point = locateClip(
      projectRef.current,
      head.current >= projectDuration(projectRef.current) ? 0 : head.current,
    );
    if (!point) return;
    try {
      await preview.current?.load(point.source);
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
    preview.current.audio.start();
    preparing.current = true;
    setPreparingExport(true);
    setError("");
    try {
      const p = projectRef.current;
      await Promise.all(
        p.clips.map((c) => preview.current!.load(p.sources[c.replayId])),
      );
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
      );
      head.current = 0;
      setTime(0);
      if (
        exporter.current.start(
          p.name,
          preview.current.audio.captureTrack(),
          preview.current.canvas,
          projectDuration(p),
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
    ])
      .then(([r, p, s]) => {
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
    let frame = 0,
      last = performance.now(),
      lastUI = 0,
      failed = "";
    try {
      preview.current = new ReplayPreview(host.current!);
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
          if (running.current)
            head.current = Math.min(head.current + dt, projectDuration(p));
          const current = locateClip(p, head.current)!;
          if (view.isReady(current.source.aircraft)) {
            view.render(
              current.source,
              current.sourceTime,
              current.clip.camera,
              running.current,
              current.clip.volume,
            );
            if (exporting.current)
              exporter.current.draw(view.canvas, current.clip.title);
          }
          if (running.current && head.current >= projectDuration(p)) {
            stop();
            if (exporting.current) {
              exporting.current = false;
              exporter.current.finish();
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
      if (file.size > 120 * 1024 * 1024)
        throw new Error("This backup is too large (maximum 120 MB).");
      const data: unknown = JSON.parse(await file.text());
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
  void history;
  return (
    <section
      className="replay-studio"
      role="dialog"
      aria-modal="true"
      aria-label="Replay studio"
      ref={dialog}
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
          else close();
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
            <b>Replay studio</b>
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
              <p>Fly for at least one second, then pause to save a replay.</p>
            </div>
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
              <button
                onClick={() =>
                  downloadData(project, `${slug(project.name)}.project.json`)
                }
              >
                <Download size={14} />
                Backup
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
          <div className="studio-preview" ref={host}>
            {!project.clips.length && (
              <div className="studio-empty-preview">
                <Film size={36} />
                <h2>Make something worth replaying.</h2>
                <p>Add a saved flight to your timeline.</p>
              </div>
            )}
            {loading && (
              <div className="studio-loading" role="status">
                Loading aircraft…
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
              disabled={busy || loading || !project.clips.length}
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
          {(busy ||
            exportState.phase === "ready" ||
            exportState.phase === "error") && (
            <div className="studio-export-status" role="status">
              {busy ? (
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
                  <span>Video exported · 1280 × 720</span>
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
          </div>
        </div>
        <aside className="studio-inspector">
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
                    onChange={(e) => edit({ camera: e.target.value as Shot })}
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
                    const list = project.clips.filter((c) => c.id !== clip.id);
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
        </aside>
      </div>
      <footer className="studio-footer">
        <span>Space to play / pause · ⌘Z to undo</span>
        <span>Flight replays only · 720p video export</span>
      </footer>
    </section>
  );
}
