import { validateLoading } from "./loading-validation";
self.onmessage = () => {
  for (const id of ["finch", "peregrine", "aurelia", "stormbird"] as const) {
    try {
      self.postMessage({ result: validateLoading(id) });
    } catch (error) {
      self.postMessage({ error: `${id}: ${String(error)}` });
    }
  }
  self.postMessage({ done: true });
};
