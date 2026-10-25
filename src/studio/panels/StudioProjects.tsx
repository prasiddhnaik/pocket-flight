import { Download, Plus, Copy, HardDrive } from "lucide-react";
import { newProject, type StudioProject } from "../studio-model";
import { libraryStorage } from "../../replay/replay-library";
import { message } from "../studio-format";

export function StudioProjects({
  projects,
  project,
  busy,
  initialized,
  switchProject,
  backupProject,
  copyProjectBackup,
  storage,
  setStorage,
  setError,
  importBackup,
}: {
  projects: StudioProject[];
  project: StudioProject;
  busy: boolean;
  initialized: boolean;
  switchProject: (project: StudioProject) => void;
  backupProject: () => Promise<void>;
  copyProjectBackup: () => Promise<void>;
  storage: Awaited<ReturnType<typeof libraryStorage>>;
  setStorage: (storage: Awaited<ReturnType<typeof libraryStorage>>) => void;
  setError: (error: string) => void;
  importBackup: (file: File) => Promise<void>;
}) {
  return (
    <>
      <div className="studio-projects">
        <h2>Projects</h2>
        <select
          aria-label="Open saved project"
          value={projects.some((p) => p.id === project.id) ? project.id : ""}
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
    </>
  );
}
