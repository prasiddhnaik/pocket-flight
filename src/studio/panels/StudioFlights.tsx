import { Film, Download, Plus } from "lucide-react";
import type { SavedReplay } from "../../replay/replay-data";
import { downloadData } from "../../replay/replay-data";
import { replayAircraftName } from "../../flight/combat/tape";
import { clock, slug } from "../studio-format";

export function StudioFlights({
  replays,
  busy,
  initialized,
  renameReplay,
  add,
}: {
  replays: SavedReplay[];
  busy: boolean;
  initialized: boolean;
  renameReplay: (replay: SavedReplay, name: string) => Promise<void>;
  add: (replay: SavedReplay) => void;
}) {
  return (
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
                {replayAircraftName(r)} · {clock(r.duration)}
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
                onClick={() => downloadData(r, `${slug(r.name)}.replay.json`)}
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
    </>
  );
}
