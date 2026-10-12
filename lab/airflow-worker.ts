import { AirframeEnvelope, traceAirflow, type EnvelopeData } from "./airflow";
import type { Solution } from "./solver";

let envelope: AirframeEnvelope | null = null;
self.onmessage = (
  event: MessageEvent<{
    key: string;
    solution: Solution;
    envelope?: EnvelopeData;
  }>,
) => {
  const { key, solution, envelope: data } = event.data;
  try {
    if (data) envelope = new AirframeEnvelope(data);
    if (!envelope) throw new Error("Missing aircraft clearance envelope.");
    const started = performance.now(),
      result = traceAirflow(solution, envelope);
    self.postMessage({ key, result, elapsedMs: performance.now() - started });
  } catch (error) {
    self.postMessage({ key, error: String(error) });
  }
};
