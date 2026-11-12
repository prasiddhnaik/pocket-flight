export const ids = ["f15c", "peregrine", "stormbird", "aurelia"] as const;
export type FitId = typeof ids[number];
// Metres; shared provisional ergonomic limits, explicit per aircraft for later calibration.
export const limits = {
  f15c: { knee: 70, elbow: 35, miss: 0.05, clip: 0.015, seat: 0.03, grip: 0.035, pedal: 0.04 },
  peregrine: { knee: 70, elbow: 35, miss: 0.05, clip: 0.015, seat: 0.03, grip: 0.035, pedal: 0.04 },
  stormbird: { knee: 70, elbow: 35, miss: 0.05, clip: 0.015, seat: 0.03, grip: 0.035, pedal: 0.04 },
  aurelia: { knee: 85, elbow: 35, miss: 0.05, clip: 0.015, seat: 0.03, grip: 0.035, pedal: 0.04 },
};
export function contactLimit(id: FitId, body: string, part: string) {
  const l = limits[id];
  if (/hand/.test(body) && /stick|yoke|throttle|grip/i.test(part)) return l.grip;
  if (/foot/.test(body) && /pedal/i.test(part)) return l.pedal;
  if (/hips|spine|chest/.test(body) && /seat|cushion|backrest|pan\b/i.test(part)) return l.seat;
  return l.clip;
}
