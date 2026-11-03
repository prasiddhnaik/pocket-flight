import type { ReplayFrame } from "../flight/game";
import { decodeFrames, encodeFrame, type SavedReplay } from "./replay-data";
import type { ReplayLibrary } from "./replay-library";

export type ArchiveRequest = {
  id: number;
  replay: Omit<SavedReplay, "frames">;
  json: string;
  origin: number;
};
export type ArchiveReply = { id: number; error?: string };

/**
 * Autosaves long flights without stalling the game. Each frame is encoded once,
 * when it is first saved; a worker parses, validates and stores the replay.
 * The stored record is identical to `ReplayLibrary.saveReplay` output.
 */
export class ReplayArchive {
  private encoded = new WeakMap<ReplayFrame, string>();
  private worker: Worker | null | undefined;
  private pending = new Map<
    number,
    { resolve: () => void; reject: (error: Error) => void }
  >();
  private nextId = 0;
  constructor(
    private library: () => ReplayLibrary,
    useWorker = true,
  ) {
    if (!useWorker) this.worker = null;
  }

  save(replay: Omit<SavedReplay, "frames">, frames: ReplayFrame[]) {
    const json = `[${frames.map((f) => this.encode(f)).join(",")}]`;
    const origin = frames[0]?.t ?? 0;
    const worker = this.closing ? null : this.start();
    if (!worker)
      return this.library().saveReplay({
        ...replay,
        frames: decodeFrames(json, origin),
      });
    const id = this.nextId++;
    return new Promise<void>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ id, replay, json, origin } satisfies ArchiveRequest);
    });
  }
  /** Stop the worker once any save already in progress has finished. */
  dispose() {
    this.closing = true;
    if (!this.pending.size) this.stop();
  }
  private closing = false;
  private stop() {
    this.worker?.terminate();
    this.worker = null;
  }
  private encode(frame: ReplayFrame) {
    let text = this.encoded.get(frame);
    if (text === undefined) {
      text = encodeFrame(frame);
      this.encoded.set(frame, text);
    }
    return text;
  }
  // Workers are unavailable in tests and some embedded browsers; save inline there.
  private start() {
    if (this.worker !== undefined) return this.worker;
    if (typeof Worker === "undefined") return (this.worker = null);
    try {
      const worker = new Worker(
        new URL("./replay-archive.worker.ts", import.meta.url),
        { type: "module" },
      );
      worker.onmessage = ({ data }: MessageEvent<ArchiveReply>) => {
        const job = this.pending.get(data.id);
        this.pending.delete(data.id);
        if (data.error) job?.reject(new Error(data.error));
        else job?.resolve();
        if (this.closing && !this.pending.size) this.stop();
      };
      worker.onerror = (event) => {
        event.preventDefault();
        worker.terminate();
        this.worker = null;
        this.fail(new Error("Replay archive worker failed."));
      };
      return (this.worker = worker);
    } catch {
      return (this.worker = null);
    }
  }
  private fail(error: Error) {
    for (const job of this.pending.values()) job.reject(error);
    this.pending.clear();
  }
}
