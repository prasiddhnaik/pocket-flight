import { ChevronLeft, ChevronRight, Copy, Trash2 } from "lucide-react";
import {
  shots,
  trimClip,
  type Shot,
  type StudioClip,
  type StudioProject,
} from "../studio-model";
import type { SavedReplay } from "../../replay/replay-data";
import { replayAircraftName } from "../../flight/combat/tape";
import { clock } from "../studio-format";

export function StudioClipInspector({
  project,
  clip,
  source,
  busy,
  edit,
  move,
  onDuplicate,
  onRemove,
}: {
  project: StudioProject;
  clip: StudioClip | undefined;
  source: SavedReplay | null;
  busy: boolean;
  edit: (values: Partial<StudioClip>) => void;
  move: (delta: number) => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  return (
    <>
      {" "}
      <h2>Clip settings</h2>
      {clip && source ? (
        <>
          <div className="studio-selected-title">
            <b>{source.name}</b>
            <small>
              {replayAircraftName(source)} · source {clock(source.duration)}
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
                      trimClip(clip, clip.in, +e.target.value, source.duration),
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
              Engine & wind audio <span>{Math.round(clip.volume * 100)}%</span>
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
              <button onClick={onDuplicate}>
                <Copy size={14} />
                Duplicate
              </button>
            </div>
            <button className="studio-remove" onClick={onRemove}>
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
  );
}
