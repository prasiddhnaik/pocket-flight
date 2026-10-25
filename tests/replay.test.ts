import { describe, expect, it } from "bun:test";
import { ReplayTimeline } from "../src/replay/replay";
import { replayFilename, replayMimeType } from "../src/replay/replay-export";

describe("flight replay history", () => {
  it("keeps a complete eight-minute mission including its first and final poses", () => {
    const history = new ReplayTimeline<{ t: number; x: number }>();
    for (let i = 0; i <= 480 * 15; i++) history.push({ t: i / 15, x: i });
    expect(history.duration).toBe(480);
    expect(history.sample(0)?.a.x).toBe(0);
    expect(history.sample(480)?.b.x).toBe(7200);
    expect(history.trimmed).toBe(false);
  });
  it("interpolates by timestamps, including irregular frames and exact endpoints", () => {
    const history = new ReplayTimeline<{ t: number }>();
    [4, 4.1, 4.4, 5].forEach((t) => history.push({ t }));
    const sample = history.sample(0.25)!;
    expect(sample.a.t).toBe(4.1);
    expect(sample.b.t).toBe(4.4);
    expect(sample.mix).toBeCloseTo(0.5);
    expect(history.sample(-1)?.mix).toBe(0);
    expect(history.sample(100)?.mix).toBe(1);
  });
  it("wraps bounded free-flight history and resets without retaining the previous flight", () => {
    const history = new ReplayTimeline<{ t: number }>(4);
    for (let t = 0; t < 10; t++) history.push({ t });
    expect(history.length).toBe(4);
    expect(history.at(0).t).toBe(6);
    expect(history.sample(1.5)?.a.t).toBe(7);
    expect(history.trimmed).toBe(true);
    history.clear();
    history.push({ t: 0 });
    expect(history.duration).toBe(0);
    expect(history.sample(1)).toBeNull();
    expect(history.trimmed).toBe(false);
  });
  it("limits elapsed history even when a slow device records fewer frames", () => {
    const history = new ReplayTimeline<{ t: number }>(100, 5);
    [0, 2, 4, 6, 8, 10].forEach(t => history.push({ t }));
    expect(history.at(0).t).toBe(6);
    expect(history.duration).toBe(4);
    expect(history.trimmed).toBe(true);
  });
  it("replaces a repeated final sample without producing zero-duration interpolation", () => {
    const history = new ReplayTimeline<{ t: number; damage: number }>();
    history.push({ t: 0, damage: 0 });
    history.push({ t: 1, damage: 0 });
    history.push({ t: 1, damage: 1 });
    expect(history.length).toBe(2);
    expect(history.sample(1)?.b.damage).toBe(1);
    expect(() => history.push({ t: 0.5, damage: 0 })).toThrow();
    expect(() => history.push({ t: NaN, damage: 0 })).toThrow();
  });
});
describe("video download compatibility", () => {
  it("selects MP4 when available and WebM as fallback, with matching filenames", () => {
    const mp4 = replayMimeType((m) => m === "video/mp4")!;
    const webm = replayMimeType((m) => m.startsWith("video/webm"))!;
    expect(mp4).toBe("video/mp4");
    expect(webm).toContain("webm");
    expect(replayMimeType(() => false)).toBeUndefined();
    const date = new Date("2026-09-06T12:00:00Z");
    expect(replayFilename("First light!", mp4, date)).toBe(
      "pocket-flight-first-light-2026-09-06T12-00-00-000Z.mp4",
    );
    expect(replayFilename("../", webm, date)).toEndWith(".webm");
    expect(replayFilename("../", webm, date)).not.toContain("/");
  });
});
