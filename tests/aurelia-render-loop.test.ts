import { expect, test } from "bun:test";
import { createAureliaRenderLoop } from "../src/viewers/aurelia-render-loop";

function harness(draw: (now: number) => number | null) {
  let id = 0;
  const frames = new Map<number, (now: number) => void>(),
    timers = new Map<number, () => void>();
  const waits: number[] = [];
  const loop = createAureliaRenderLoop(draw, {
    frame(callback) {
      frames.set(++id, callback);
      return id;
    },
    cancelFrame(key) {
      frames.delete(key);
    },
    delay(callback, ms) {
      timers.set(++id, callback);
      waits.push(ms);
      return id;
    },
    cancelDelay(key) {
      timers.delete(key);
    },
  });
  function frame(now = 0) {
    const [key, fn] = [...frames][0];
    frames.delete(key);
    fn(now);
  }
  return { loop, frames, timers, waits, frame };
}

test("a still aircraft draws once and schedules no more frames or timers", () => {
  let draws = 0;
  const h = harness(() => {
    draws++;
    return null;
  });
  h.loop.invalidate();
  h.loop.invalidate();
  h.frame();
  expect(draws).toBe(1);
  expect(h.frames.size + h.timers.size).toBe(0);
});
test("input interrupts the slower display cadence without duplicate callbacks", () => {
  const h = harness(() => 500);
  h.loop.invalidate();
  h.frame();
  expect(h.waits).toEqual([500]);
  expect(h.timers.size).toBe(1);
  h.loop.invalidate();
  h.loop.invalidate();
  expect(h.timers.size).toBe(0);
  expect(h.frames.size).toBe(1);
});
test("hidden tabs and sheet exports cancel work and resume only when both permit it", () => {
  const h = harness(() => 50);
  h.loop.invalidate();
  h.frame();
  h.loop.setVisible(false);
  expect(h.frames.size + h.timers.size).toBe(0);
  h.loop.suspend();
  h.loop.setVisible(true);
  expect(h.frames.size + h.timers.size).toBe(0);
  h.loop.resume();
  expect(h.frames.size).toBe(1);
  h.loop.dispose();
  h.loop.invalidate();
  h.loop.resume();
  expect(h.frames.size + h.timers.size).toBe(0);
});
test("orbit damping can request another frame without being replaced by an animation timer", () => {
  const h = harness(() => {
    h.loop.invalidate();
    return 500;
  });
  h.loop.invalidate();
  h.frame();
  expect(h.frames.size).toBe(1);
  expect(h.timers.size).toBe(0);
});
