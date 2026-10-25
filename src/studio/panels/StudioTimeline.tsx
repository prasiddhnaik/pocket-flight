import { Undo2, Redo2, Scissors } from "lucide-react";
import {
  clipDuration,
  shots,
  type StudioProject,
  type locateClip,
} from "../studio-model";
import type { StudioScene } from "../studio-scene";
import { SceneKeyTimeline } from "./SceneKeyTimeline";
import { clock } from "../studio-format";

export function StudioTimeline({
  project,
  duration,
  busy,
  canUndo,
  canRedo,
  historyStep,
  active,
  split,
  selected,
  selectClip,
  scene,
  sceneSelected,
  selectObject,
  seek,
}: {
  project: StudioProject;
  duration: number;
  busy: boolean;
  canUndo: boolean;
  canRedo: boolean;
  historyStep: (back: boolean) => void;
  active: ReturnType<typeof locateClip>;
  split: () => void;
  selected: string;
  selectClip: (index: number) => void;
  scene: StudioScene;
  sceneSelected: string | null;
  selectObject: (id: string | null) => void;
  seek: (time: number) => void;
}) {
  return (
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
            disabled={busy || !canUndo}
            onClick={() => historyStep(true)}
          >
            <Undo2 size={16} />
          </button>
          <button
            aria-label="Redo edit"
            title="Redo · ⇧⌘Z"
            disabled={busy || !canRedo}
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
  );
}
