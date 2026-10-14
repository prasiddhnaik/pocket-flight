import { describe, expect, test } from "bun:test";
import { createChannel, isSettled, needleSpring, stepSpring } from "../src/hud/spring";
import { prefersReducedMotion } from "../src/hud/useSpring";

function run(target: number, seconds: number, dt = 1 / 60) {
  let s = { value: 0, velocity: 0 }, peak = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    s = stepSpring(s, target, dt, needleSpring);
    peak = Math.max(peak, s.value);
  }
  return { s, peak };
}

describe("hud springs", () => {
  test("needle spring settles on its target within a second", () => {
    const { s } = run(100, 1);
    expect(s.value).toBeCloseTo(100, 0);
    expect(isSettled(s, 100, 0.5)).toBe(true);
  });
  test("needle spring overshoots slightly, like a real instrument", () => {
    const { peak } = run(100, 1);
    expect(peak).toBeGreaterThan(100.2);
    expect(peak).toBeLessThan(106);
  });
  test("a huge frame gap cannot explode the spring", () => {
    const s = stepSpring({ value: 0, velocity: 0 }, 100, 5);
    expect(Number.isFinite(s.value)).toBe(true);
    expect(Math.abs(s.value)).toBeLessThan(200);
  });
  test("zero dt changes nothing", () => {
    expect(stepSpring({ value: 3, velocity: 1 }, 10, 0)).toEqual({ value: 3, velocity: 1 });
  });
  test("frame gaps are capped at 0.1 seconds", () => {
    const state = { value: 3, velocity: 1 };
    expect(stepSpring(state, 100, 5)).toEqual(stepSpring(state, 100, 0.1));
    expect(state).toEqual({ value: 3, velocity: 1 });
  });
  test("substeps give the same result at 30, 60, and 120 Hz", () => {
    const reference = run(100, 0.5, 1 / 30).s;
    for (const dt of [1 / 60, 1 / 120]) {
      let state = { value: 0, velocity: 0 };
      for (let i = 0; i < Math.round(0.5 / dt); i++) state = stepSpring(state, 100, dt);
      expect(state.value).toBeCloseTo(reference.value, 8);
      expect(state.velocity).toBeCloseTo(reference.velocity, 8);
    }
  });
  test("settling requires both position and velocity within epsilon", () => {
    expect(isSettled({ value: 10, velocity: 1 }, 10)).toBe(false);
    expect(isSettled({ value: 9, velocity: 0 }, 10)).toBe(false);
    expect(isSettled({ value: 10.001, velocity: 0.001 }, 10)).toBe(true);
  });
  test("custom spring configuration controls integration", () => {
    expect(stepSpring({ value: 3, velocity: 0 }, 100, 0.1, { stiffness: 0, damping: 0 }))
      .toEqual({ value: 3, velocity: 0 });
  });
});

function withFrames(check: (driver: {
  create: typeof createChannel;
  advance: (now: number) => void;
  pending: () => number;
}) => void) {
  const raf = Object.getOwnPropertyDescriptor(globalThis, "requestAnimationFrame");
  const cancel = Object.getOwnPropertyDescriptor(globalThis, "cancelAnimationFrame");
  const callbacks = new Map<number, FrameRequestCallback>();
  const channels: ReturnType<typeof createChannel>[] = [];
  let id = 0;
  Object.defineProperty(globalThis, "requestAnimationFrame", {
    configurable: true,
    value: (callback: FrameRequestCallback) => { callbacks.set(++id, callback); return id; },
  });
  Object.defineProperty(globalThis, "cancelAnimationFrame", {
    configurable: true,
    value: (frame: number) => callbacks.delete(frame),
  });
  try {
    check({
      create: (...args) => {
        const channel = createChannel(...args);
        channels.push(channel);
        return channel;
      },
      advance: (now) => {
        const pending = [...callbacks.values()];
        callbacks.clear();
        for (const callback of pending) callback(now);
      },
      pending: () => callbacks.size,
    });
  } finally {
    for (const channel of channels) channel.dispose();
    if (raf) Object.defineProperty(globalThis, "requestAnimationFrame", raf);
    else Reflect.deleteProperty(globalThis, "requestAnimationFrame");
    if (cancel) Object.defineProperty(globalThis, "cancelAnimationFrame", cancel);
    else Reflect.deleteProperty(globalThis, "cancelAnimationFrame");
  }
}

describe("hud spring driver", () => {
  test("recreating a channel with new config preserves its last applied value", () => {
    withFrames(({ create, advance, pending }) => {
      let value = 0;
      const values: number[] = [];
      const apply = (next: number) => { value = next; values.push(next); };
      let channel = create(value, apply);
      channel.set(100);
      advance(0);
      advance(16);
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(100);

      const movingValue = value;
      channel.dispose();
      channel = create(value, apply, { stiffness: 200, damping: 24 });
      expect(values.at(-1)).toBe(movingValue);
      channel.set(100);
      for (let i = 0; i < 180 && pending(); i++) advance(32 + i * 1000 / 60);
      expect(value).toBe(100);
      expect(pending()).toBe(0);

      for (let i = 0; i < 3; i++) {
        channel.dispose();
        channel = create(value, apply, { stiffness: 200, damping: 24 });
        channel.set(100);
        advance(4000 + i * 16);
        expect(value).toBe(100);
        expect(pending()).toBe(0);
      }
    });
  });
  test("channels share one loop, land exactly on target, and sleep until retargeted", () => {
    withFrames(({ create, advance, pending }) => {
      const values: number[] = [];
      const other: number[] = [];
      const channel = create(0, (value) => values.push(value));
      create(10, (value) => other.push(value)).set(-20);
      expect(values).toEqual([0]);
      channel.set(100);
      expect(pending()).toBe(1);
      advance(0);
      advance(1000 / 60);
      expect(values.at(-1)).toBeGreaterThan(0);
      expect(other.at(-1)).toBeLessThan(10);
      for (let i = 2; i < 180 && pending(); i++) advance(i * 1000 / 60);
      expect(values.at(-1)).toBe(100);
      expect(other.at(-1)).toBe(-20);
      expect(pending()).toBe(0);
      channel.set(50);
      expect(pending()).toBe(1);
      advance(10000);
      expect(values.at(-1)).toBe(100);
      advance(10000 + 1000 / 60);
      expect(values.at(-1)).toBeLessThan(100);
    });
  });
  test("snap applies immediately and invalid targets are ignored", () => {
    withFrames(({ create, advance, pending }) => {
      const values: number[] = [];
      const channel = create(3, (value) => values.push(value));
      channel.set(Number.NaN);
      channel.set(Number.POSITIVE_INFINITY, true);
      expect(values).toEqual([3]);
      expect(pending()).toBe(0);
      channel.set(10, true);
      expect(values).toEqual([3, 10]);
      expect(pending()).toBe(0);
      channel.set(100);
      advance(0);
      advance(16);
      channel.set(20, true);
      advance(32);
      expect(values.at(-1)).toBe(20);
      expect(pending()).toBe(0);
    });
  });
  test("disposing a channel stops its writes and cancels the last pending frame", () => {
    withFrames(({ create, advance, pending }) => {
      const values: number[] = [];
      const channel = create(0, (value) => values.push(value));
      const other = create(0, () => {});
      channel.set(100);
      other.set(100);
      channel.dispose();
      advance(0);
      advance(16);
      expect(values).toEqual([0]);
      expect(pending()).toBe(1);
      other.dispose();
      expect(pending()).toBe(0);
      channel.set(20, true);
      expect(values).toEqual([0]);
    });
  });
});

test("reduced motion detection is safe without matchMedia and reads the preference", () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");
  try {
    Reflect.deleteProperty(globalThis, "matchMedia");
    expect(prefersReducedMotion()).toBe(false);
    for (const matches of [true, false]) {
      Object.defineProperty(globalThis, "matchMedia", {
        configurable: true,
        value: (query: string) => {
          expect(query).toBe("(prefers-reduced-motion: reduce)");
          return { matches };
        },
      });
      expect(prefersReducedMotion()).toBe(matches);
    }
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "matchMedia", descriptor);
    else Reflect.deleteProperty(globalThis, "matchMedia");
  }
});
