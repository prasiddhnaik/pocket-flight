import { validateReplay, type SavedReplay } from "./replay-data";
import { validateProject, type StudioProject } from "./studio-model";
import { validateAsset, type StudioAsset } from "./studio-assets";
import { sceneAssetIds } from "./studio-scene";
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
      const r = (factory ?? globalThis.indexedDB).open(name, 2);
      r.onupgradeneeded = () => {
        for (const store of ["replays", "projects", "assets"])
          if (!r.result.objectStoreNames.contains(store))
            r.result.createObjectStore(store, { keyPath: "id" });
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
  async saveAssets(assets: StudioAsset[]) {
    if (!assets.every(validateAsset))
      throw new Error("An imported asset is invalid.");
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction("assets", "readwrite");
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () =>
        reject(tx.error ?? new Error("Asset save interrupted."));
      for (const asset of assets) tx.objectStore("assets").put(asset);
    });
  }
  async getAsset(id: string) {
    const asset = await this.read<unknown>("assets", id);
    if (!asset) return null;
    if (!validateAsset(asset)) throw new Error("This asset could not be read.");
    return asset;
  }
  async listAssets() {
    return (await this.read<unknown[]>("assets"))
      .filter(validateAsset)
      .sort((a, b) => b.createdAt - a.createdAt);
  }
  async saveProject(project: StudioProject, assets?: StudioAsset[]) {
    if (!validateProject(project))
      throw new Error("This project has invalid clips.");
    const needed = sceneAssetIds(project.scene);
    if (!assets && !needed.length) {
      await this.write("projects", project);
      return;
    }
    if (assets && !assets.every(validateAsset))
      throw new Error("A project asset is invalid.");
    const db = await this.db;
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(["assets", "projects"], "readwrite");
      let failure: Error | null = null;
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(failure ?? tx.error);
      tx.onabort = () =>
        reject(
          failure ?? tx.error ?? new Error("Project restore interrupted."),
        );
      const store = tx.objectStore("assets");
      for (const asset of assets ?? []) store.put(asset);
      for (const id of needed) {
        const lookup = store.getKey(id);
        lookup.onsuccess = () => {
          if (lookup.result === undefined) {
            failure = new Error(
              "A project asset is missing. Restore its backup first.",
            );
            tx.abort();
          }
        };
      }
      tx.objectStore("projects").put(project);
    });
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
