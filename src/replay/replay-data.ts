import type { AircraftId } from "../aircraft/aircraft";
import type { ReplayFrame } from "../flight/game";
import type { FinchVariant } from "../aircraft/finch/attack";
import type { CombatFrame } from "../flight/combat/tape";
export type SavedFrame = Omit<ReplayFrame, "p" | "q" | "debris"> & {
  p: number[];
  q: number[];
  debris: { p: number[]; q: number[]; visible: boolean }[];
};
export type SavedReplay = {
  schemaVersion: 1;
  flightModel?: string;
  id: string;
  name: string;
  aircraft: AircraftId;
  /** Only stored when the Finch flew as the A-2. */
  variant?: FinchVariant;
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
const combatFrame = (c: CombatFrame) =>
  !!c &&
  Number.isFinite(c.clock) &&
  Array.isArray(c.down) &&
  c.down.every((id) => typeof id === "string") &&
  Array.isArray(c.stores) &&
  c.stores.every(Number.isFinite) &&
  Array.isArray(c.rounds) &&
  c.rounds.every((round) => vector(round, 8)) &&
  Array.isArray(c.blasts) &&
  c.blasts.every((blast) => vector(blast, 5));
export function validateReplay(value: unknown): value is SavedReplay {
  if (!value || typeof value !== "object") return false;
  const r = value as SavedReplay;
  return (
    r.schemaVersion === 1 &&
    (r.flightModel === undefined || typeof r.flightModel === "string") &&
    typeof r.id === "string" &&
    r.id.length > 0 &&
    typeof r.name === "string" &&
    typeof r.mission === "string" &&
    (r.variant === undefined || r.variant === "trainer" || r.variant === "attack") &&
    ["finch", "peregrine", "aurelia", "stormbird", "heron", "f15c"].includes(r.aircraft) &&
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
        (f.gearPosition === undefined || (Number.isFinite(f.gearPosition) && f.gearPosition >= 0 && f.gearPosition <= 1)) &&
        (f.flapPosition === undefined || (Number.isFinite(f.flapPosition) && f.flapPosition >= 0 && f.flapPosition <= 1)) &&
        (f.automaticConfiguration === undefined || typeof f.automaticConfiguration === "boolean") &&
        (f.suspensionResolved === undefined || typeof f.suspensionResolved === "boolean") &&
        (f.elevatorTrim === undefined || (Number.isFinite(f.elevatorTrim) && Math.abs(f.elevatorTrim) <= 1)) &&
        (f.simulationTick === undefined || (Number.isInteger(f.simulationTick) && f.simulationTick >= 0)) &&
        (f.combat === undefined || combatFrame(f.combat)) &&
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
// Frames hold only plain data; a direct copy is far cheaper than structuredClone.
function copyPlain<T>(value: T): T {
  if (Array.isArray(value)) return value.map(copyPlain) as T;
  if (!value || typeof value !== "object") return value;
  const copy: Record<string, unknown> = {};
  for (const key in value) copy[key] = copyPlain(value[key]);
  return copy as T;
}
function saveFrame(f: ReplayFrame, origin: number): SavedFrame {
  const { p, q, debris, ...rest } = f;
  return {
    ...copyPlain(rest),
    t: f.t - origin,
    p: p.toArray(),
    q: q.toArray(),
    debris: debris.map((d) => ({
      p: d.p.toArray(),
      q: d.q.toArray(),
      visible: d.visible,
    })),
  };
}
export function saveFrames(frames: ReplayFrame[]): SavedFrame[] {
  const origin = frames[0]?.t ?? 0;
  return frames.map((f) => saveFrame(f, origin));
}
/** JSON for one saved frame, keeping its absolute time until it is decoded. */
export function encodeFrame(f: ReplayFrame) {
  return JSON.stringify(saveFrame(f, 0));
}
/** Parse `[encodeFrame, …]` text and make times relative to `origin`. */
export function decodeFrames(json: string, origin: number): SavedFrame[] {
  const frames = JSON.parse(json) as SavedFrame[];
  for (const f of frames) f.t -= origin;
  return frames;
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
