import { describe, expect, test } from "bun:test";
import { Vector3, Quaternion } from "three";
import { IDBFactory } from "fake-indexeddb";
import { ReplayLibrary } from "../src/replay/replay-library";
import {
  clipDuration,
  locateClip,
  newProject,
  addReplayClip,
  trimClip,
  validateProject,
} from "../src/studio/studio-model";
import {
  saveFrames,
  sampleFrames,
  validateReplay,
  type SavedReplay,
} from "../src/replay/replay-data";
const replay: SavedReplay = {
  schemaVersion: 1,
  id: "flight",
  name: "Coastal flight",
  aircraft: "finch",
  paint: 0,
  mission: "free",
  createdAt: 1,
  updatedAt: 1,
  duration: 10,
  trimmed: false,
  frames: [0, 10].map((t) => ({
    t,
    p: [0, 20, -t],
    q: [0, 0, 0, 1],
    worldTime: t,
    throttle: 0.5,
    speed: 30,
    suspension: 0,
    gearDamage: 0,
    propAngle: t,
    propRpm: 1200,
    surfaces: { pitch: 0, roll: 0, yaw: 0 },
    propVisible: true,
    gearVisible: true,
    wings: [true, true],
    engineOut: false,
    night: false,
    ring: 0,
    debris: [],
  })),
};
describe("saved replay studio", () => {
  test("recordings and projects survive a fresh database connection", async () => {
    const factory = new IDBFactory(),
      name = crypto.randomUUID();
    const library = new ReplayLibrary(factory, name);
    await library.saveReplay(replay);
    const project = addReplayClip(newProject(), replay);
    await library.saveProject(project);
    library.close();
    const reopened = new ReplayLibrary(factory, name);
    expect((await reopened.listReplays())[0].name).toBe("Coastal flight");
    expect((await reopened.getProject(project.id))?.clips).toEqual(
      project.clips,
    );
    expect(
      (await reopened.getProject(project.id))?.sources[
        project.clips[0].replayId
      ].frames[1].p,
    ).toEqual([0, 20, -10]);
    reopened.close();
  });
  test("project sources remain immutable when the library recording changes", async () => {
    const library = new ReplayLibrary(new IDBFactory(), crypto.randomUUID());
    const project = addReplayClip(newProject(), replay);
    await library.saveProject(project);
    await library.saveReplay({ ...replay, name: "Changed", updatedAt: 2 });
    expect(
      (await library.getProject(project.id))?.sources[project.clips[0].replayId]
        .name,
    ).toBe("Coastal flight");
    library.close();
  });
  test("cut boundaries and playback speed map to the right source time", () => {
    let project = addReplayClip(addReplayClip(newProject(), replay), replay);
    project = {
      ...project,
      clips: [
        { ...project.clips[0], in: 2, out: 6, speed: 0.5 },
        { ...project.clips[1], in: 6, out: 10, speed: 2 },
      ],
    };
    expect(clipDuration(project.clips[0])).toBe(8);
    expect(locateClip(project, 4)?.sourceTime).toBe(4);
    expect(locateClip(project, 8)?.index).toBe(1);
    expect(locateClip(project, 9)?.sourceTime).toBe(8);
    expect(locateClip(project, 100)?.sourceTime).toBe(10);
  });
  test("trims clamp to the source and preserve a usable interval", () => {
    const p = addReplayClip(newProject(), replay),
      c = p.clips[0];
    expect(trimClip(c, 20, -5, 10)).toMatchObject({ in: 9.9, out: 10 });
    expect(trimClip(c, -1, 100, 10)).toMatchObject({ in: 0, out: 10 });
  });
  test("invalid replay poses and unsorted timestamps are rejected", () => {
    expect(validateReplay(replay)).toBe(true);
    expect(
      validateReplay({
        ...replay,
        frames: [replay.frames[1], replay.frames[0]],
      }),
    ).toBe(false);
    expect(
      validateReplay({
        ...replay,
        frames: [{ ...replay.frames[0], p: [NaN, 0, 0] }, replay.frames[1]],
      }),
    ).toBe(false);
  });
});

test("corrupt backups fail validation without throwing", () => {
  expect(validateReplay({ ...replay, frames: [null, null] })).toBe(false);
  expect(
    validateReplay({
      ...replay,
      frames: [{ ...replay.frames[0], debris: [null] }, replay.frames[1]],
    }),
  ).toBe(false);
  const p = addReplayClip(newProject(), replay);
  expect(validateProject({ ...p, clips: [null] })).toBe(false);
  expect(
    validateProject({ ...p, clips: [{ ...p.clips[0], camera: "toString" }] }),
  ).toBe(false);
  expect(
    validateProject({ ...p, sources: { [p.clips[0].replayId]: {} } }),
  ).toBe(false);
});
test("unavailable browser storage rejects saves and leaves source data usable", async () => {
  const unavailable = {
    open() {
      throw new DOMException("Storage denied", "SecurityError");
    },
  } as unknown as IDBFactory;
  const library = new ReplayLibrary(unavailable);
  await expect(library.saveReplay(replay)).rejects.toThrow("Storage denied");
  expect(sampleFrames(replay.frames, 5).mix).toBe(0.5);
  expect(replay.frames[1].p).toEqual([0, 20, -10]);
  library.close();
});
test("rejected save does not replace a previous valid recording", async () => {
  const library = new ReplayLibrary(new IDBFactory(), crypto.randomUUID());
  await library.saveReplay(replay);
  await expect(library.saveReplay({ ...replay, frames: [] })).rejects.toThrow();
  expect((await library.getReplay(replay.id))?.frames).toEqual(replay.frames);
  library.close();
});

test("saved frames normalize time and detach from live aircraft poses", () => {
  const frames = replay.frames.map(({ p, q, debris, ...frame }) => ({
    ...frame,
    t: frame.t + 100,
    surfaces: { ...frame.surfaces },
    p: new Vector3().fromArray(p),
    q: new Quaternion().fromArray(q),
    debris: [],
  }));
  const saved = saveFrames(frames);
  frames[0].p.x = 99;
  frames[0].surfaces.pitch = 0.8;
  expect(saved[0].t).toBe(0);
  expect(saved[1].t).toBe(10);
  expect(saved[0].p).toEqual(replay.frames[0].p);
  expect(saved[0].surfaces.pitch).toBe(0);
  expect(validateReplay({ ...replay, frames: saved })).toBe(true);
});
