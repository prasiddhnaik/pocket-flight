import { validateReplay, type SavedReplay } from "./replay-data";
import { validateProject, type StudioProject } from "./studio-model";
const request = <T>(r: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
export class ReplayLibrary {
  private db: Promise<IDBDatabase>;
  constructor(factory?: IDBFactory, name = "pocket-flight-studio") {
    let blocked = false;
    this.db = new Promise((resolve, reject) => {
      const r = (factory ?? globalThis.indexedDB).open(name, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("replays", { keyPath: "id" });
        r.result.createObjectStore("projects", { keyPath: "id" });
      };
      r.onsuccess = () => {
        if (blocked) {
          r.result.close();
          return;
        }
        r.result.onversionchange = () => r.result.close();
        resolve(r.result);
      };
      r.onerror = () => reject(r.error);
      r.onblocked = () => {
        blocked = true;
        reject(
          new Error(
            "Close other Pocket Flight tabs to update the replay library.",
          ),
        );
      };
    });
    void this.db.catch(() => {});
  }
  private async read<T>(store: string, id?: string): Promise<T> {
    const db = await this.db,
      object = db.transaction(store, "readonly").objectStore(store);
    return request(id ? object.get(id) : object.getAll());
  }
  private async write(store: string, value: unknown) {
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(store, "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error ?? new Error("Save interrupted."));
      tx.objectStore(store).put(value);
    });
  }
  async saveReplay(replay: SavedReplay) {
    if (!validateReplay(replay))
      throw new Error("This replay has invalid flight data.");
    await this.write("replays", replay);
  }
  async getReplay(id: string) {
    const r = await this.read<unknown>("replays", id);
    if (!r) return null;
    if (!validateReplay(r)) throw new Error("This replay could not be read.");
    return r;
  }
  async listReplays() {
    return (await this.read<unknown[]>("replays"))
      .filter(validateReplay)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  async saveProject(project: StudioProject) {
    if (!validateProject(project))
      throw new Error("This project has invalid clips.");
    await this.write("projects", project);
  }
  async getProject(id: string) {
    const p = await this.read<unknown>("projects", id);
    if (!p) return null;
    if (!validateProject(p))
      throw new Error("This editing project could not be read.");
    return p;
  }
  async listProjects() {
    return (await this.read<unknown[]>("projects"))
      .filter(validateProject)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }
  close() {
    void this.db.then((db) => db.close()).catch(() => {});
  }
}
export async function libraryStorage() {
  const [estimate, persistent] = await Promise.allSettled([
    navigator.storage?.estimate?.(),
    navigator.storage?.persisted?.(),
  ]);
  const size = estimate.status === "fulfilled" ? estimate.value : null;
  return {
    used: size?.usage ?? 0,
    quota: size?.quota ?? 0,
    persistent: persistent.status === "fulfilled" && !!persistent.value,
  };
}
