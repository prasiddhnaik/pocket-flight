import { expect, test } from "bun:test";
import { Quaternion, Vector3 } from "three";
import { IDBFactory } from "fake-indexeddb";
import type { ReplayFrame } from "../src/flight/game";
import { ReplayArchive } from "../src/replay/replay-archive";
import {
  decodeFrames,
  encodeFrame,
  saveFrames,
  validateReplay,
  type SavedReplay,
} from "../src/replay/replay-data";
import { ReplayLibrary } from "../src/replay/replay-library";

const frame = (t: number, jet = false): ReplayFrame => ({
  p: new Vector3(t * 3.1, 20 + t / 7, -t),
  q: new Quaternion(0.01 * t, 0.2, 0, 1).normalize(),
  t,
  simulationTick: Math.round(t * 60),
  suspensionResolved: true,
  elevatorTrim: -0.12,
  gearPosition: 1,
  flapPosition: 0.3,
  automaticConfiguration: true,
  worldTime: t + 0.123456789,
  jet: jet ? { gear: 1, canopy: 0, nozzle: 0.42 } : undefined,
  throttle: 0.7,
  speed: 41.33333,
  suspension: 0.02,
  gearDamage: 0,
  propAngle: t * 1.7,
  propRpm: 2100,
  surfaces: { pitch: 0.1, roll: -0.2, yaw: 0 },
  propVisible: true,
  gearVisible: true,
  wings: [true, false],
  engineOut: false,
  night: false,
  ring: 1,
  debris: [
    { p: new Vector3(1, 2, 3), q: new Quaternion(), visible: true },
  ],
}) as ReplayFrame;
const details: Omit<SavedReplay, "frames"> = {
  schemaVersion: 1,
  id: "archived",
  name: "Autosave",
  aircraft: "finch",
  paint: 0,
  mission: "free",
  createdAt: 1,
  updatedAt: 2,
  duration: 0,
  trimmed: true,
};

test("encoded autosave frames decode to the saveFrames record", () => {
  // A trimmed recording starts after zero, so times must be rebased.
  const frames = [12.4, 12.5, 13.9].map((t, i) => frame(t, i === 1));
  const decoded = decodeFrames(
    `[${frames.map(encodeFrame).join(",")}]`,
    frames[0].t,
  );
  // JSON omits keys whose value is undefined; the stored data is otherwise identical.
  expect(decoded).toEqual(JSON.parse(JSON.stringify(saveFrames(frames))));
  expect(decoded.map((f) => f.t)).toEqual(saveFrames(frames).map((f) => f.t));
});

test("archive stores a valid replay without a worker", async () => {
  const library = new ReplayLibrary(new IDBFactory(), crypto.randomUUID());
  const archive = new ReplayArchive(() => library, false);
  const frames = Array.from({ length: 31 }, (_, i) => frame(5 + i / 15));
  const duration = frames.at(-1)!.t - frames[0].t;
  await archive.save({ ...details, duration }, frames);
  // A later save reuses cached frame text and adds the newest frame.
  frames.push(frame(5 + 31 / 15));
  await archive.save(
    { ...details, duration: frames.at(-1)!.t - frames[0].t },
    frames,
  );
  const stored = await library.getReplay("archived");
  expect(stored && validateReplay(stored)).toBe(true);
  expect(stored!.frames).toHaveLength(32);
  expect(stored!.frames[0].t).toBe(0);
  expect(stored!.frames).toEqual(
    JSON.parse(JSON.stringify(saveFrames(frames))),
  );
});
