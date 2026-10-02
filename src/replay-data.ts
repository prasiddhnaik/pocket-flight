import type { AircraftId } from "./aircraft";
import type { ReplayFrame } from "./game";
export type SavedFrame = Omit<ReplayFrame, "p" | "q" | "debris"> & {
  p: number[];
  q: number[];
  debris: { p: number[]; q: number[]; visible: boolean }[];
};
export type SavedReplay = {
  schemaVersion: 1;
  id: string;
  name: string;
  aircraft: AircraftId;
  paint: number;
  mission: string;
  createdAt: number;
  updatedAt: number;
  duration: number;
  trimmed: boolean;
  frames: SavedFrame[];
};
const vector = (value: unknown, length: number): value is number[] =>
  Array.isArray(value) &&
  value.length === length &&
  value.every(Number.isFinite);
export function validateReplay(value: unknown): value is SavedReplay {
  if (!value || typeof value !== "object") return false;
  const r = value as SavedReplay;
  return (
    r.schemaVersion === 1 &&
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.name === "string" &&
    typeof r.mission === "string" &&
    ["finch", "peregrine", "aurelia", "stormbird"].includes(r.aircraft) &&
    Number.isInteger(r.paint) &&
    r.paint >= 0 &&
    Number.isFinite(r.createdAt) &&
    Number.isFinite(r.updatedAt) &&
    typeof r.trimmed === "boolean" &&
    Number.isFinite(r.duration) &&
    r.duration >= 0.1 &&
    Array.isArray(r.frames) &&
    r.frames.length >= 2 &&
    r.frames.every(
      (f, i) =>
        f &&
        typeof f === "object" &&
        Number.isFinite(f.t) &&
        Number.isFinite(f.worldTime) &&
        vector(f.p, 3) &&
        vector(f.q, 4) &&
        f.q.some((n) => n !== 0) &&
        f.surfaces &&
        [
          f.surfaces.pitch,
          f.surfaces.roll,
          f.surfaces.yaw,
          f.throttle,
          f.speed,
          f.propAngle,
          f.propRpm,
          f.suspension,
          f.gearDamage,
          f.ring,
        ].every(Number.isFinite) &&
        [f.gearVisible, f.propVisible, f.engineOut, f.night].every(
          (v) => typeof v === "boolean",
        ) &&
        Array.isArray(f.wings) &&
        f.wings.every((v) => typeof v === "boolean") &&
        (!f.jet || Object.values(f.jet).every(Number.isFinite)) &&
        Array.isArray(f.debris) &&
        f.debris.every(
          (d) =>
            d &&
            vector(d.p, 3) &&
            vector(d.q, 4) &&
            typeof d.visible === "boolean",
        ) &&
        (i === 0 ? f.t === 0 : f.t > r.frames[i - 1].t),
    ) &&
    Math.abs(r.frames.at(-1)!.t - r.duration) < 0.01
  );
}
export function saveFrames(frames: ReplayFrame[]): SavedFrame[] {
  const origin = frames[0]?.t ?? 0;
  return frames.map((f) => ({
    ...structuredClone({ ...f, p: undefined, q: undefined, debris: undefined }),
    t: f.t - origin,
    p: f.p.toArray(),
    q: f.q.toArray(),
    debris: f.debris.map((d) => ({
      p: d.p.toArray(),
      q: d.q.toArray(),
      visible: d.visible,
    })),
  }));
}
export function sampleFrames(frames: SavedFrame[], time: number) {
  let lo = 1,
    hi = frames.length - 1;
  const t = Math.max(frames[0].t, Math.min(time, frames[hi].t));
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (frames[mid].t < t) lo = mid + 1;
    else hi = mid;
  }
  const a = frames[lo - 1],
    b = frames[lo];
  return { a, b, mix: (t - a.t) / (b.t - a.t) };
}
export function downloadData(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
