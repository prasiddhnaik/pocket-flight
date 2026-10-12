import { validateAircraft } from "./validation";
self.onmessage = () => {
  for (const id of ["finch", "peregrine", "aurelia", "stormbird"] as const) {
    try {
      self.postMessage({ result: validateAircraft(id) });
    } catch (error) {
      self.postMessage({
        id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  self.postMessage({ done: true });
};
