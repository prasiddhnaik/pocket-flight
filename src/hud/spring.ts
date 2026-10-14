export type SpringConfig = { stiffness: number; damping: number };
export type SpringState = { value: number; velocity: number };

// Damping ratio ≈ 0.84: settles fast with a small, instrument-like overshoot.
export const needleSpring: SpringConfig = { stiffness: 170, damping: 22 };

const STEP = 1 / 240;
const MAX_DT = 0.1;

export function stepSpring(state: SpringState, target: number, dt: number, config: SpringConfig = needleSpring): SpringState {
  let { value, velocity } = state;
  for (let left = Math.min(dt, MAX_DT); left > 1e-9; left -= STEP) {
    const h = Math.min(STEP, left);
    velocity += (config.stiffness * (target - value) - config.damping * velocity) * h;
    value += velocity * h;
  }
  return { value, velocity };
}

export function isSettled(state: SpringState, target: number, epsilon = 0.01): boolean {
  return Math.abs(target - state.value) < epsilon && Math.abs(state.velocity) < epsilon;
}

type Channel = { state: SpringState; target: number; config: SpringConfig; apply: (value: number) => void };

const channels = new Set<Channel>();
let frame = 0;
let last: number | null = null;

// One rAF loop for every HUD spring; it stops itself once everything settles.
function tick(now: number) {
  const dt = last === null ? 0 : (now - last) / 1000;
  last = now;
  let moving = false;
  for (const ch of channels) {
    if (isSettled(ch.state, ch.target)) {
      if (ch.state.value !== ch.target || ch.state.velocity !== 0) {
        ch.state = { value: ch.target, velocity: 0 };
        ch.apply(ch.target);
      }
      continue;
    }
    ch.state = stepSpring(ch.state, ch.target, dt, ch.config);
    ch.apply(ch.state.value);
    moving = true;
  }
  frame = moving ? requestAnimationFrame(tick) : 0;
  if (!moving) last = null;
}

function wake() {
  if (!frame && typeof requestAnimationFrame === "function") frame = requestAnimationFrame(tick);
}

export function createChannel(initial: number, apply: (value: number) => void, config: SpringConfig = needleSpring) {
  const ch: Channel = { state: { value: initial, velocity: 0 }, target: initial, config, apply };
  channels.add(ch);
  apply(initial);
  return {
    set(target: number, snap = false) {
      if (!channels.has(ch) || !Number.isFinite(target)) return;
      ch.target = target;
      if (snap) {
        ch.state = { value: target, velocity: 0 };
        ch.apply(target);
      } else wake();
    },
    dispose() {
      channels.delete(ch);
      if (!channels.size) {
        if (frame && typeof cancelAnimationFrame === "function") cancelAnimationFrame(frame);
        frame = 0;
        last = null;
      }
    },
  };
}
