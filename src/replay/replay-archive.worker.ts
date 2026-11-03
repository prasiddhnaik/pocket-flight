import type { ArchiveReply, ArchiveRequest } from "./replay-archive";
import { decodeFrames } from "./replay-data";
import { ReplayLibrary } from "./replay-library";

const library = new ReplayLibrary();
self.onmessage = async ({ data }: MessageEvent<ArchiveRequest>) => {
  let reply: ArchiveReply = { id: data.id };
  try {
    await library.saveReplay({
      ...data.replay,
      frames: decodeFrames(data.json, data.origin),
    });
  } catch (error) {
    reply = {
      id: data.id,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  self.postMessage(reply);
};
