# Holo Glass HUD Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Pocket Flight's in-flight HUD with animated Holo Glass analog instruments, a compass rose, strobing warnings and a Betty-style voice warning system.

**Architecture:** Pure TypeScript modules (geometry, springs, instrument data, warnings, callout scheduling) carry all logic and are unit-tested with `bun test`. Thin React + SVG components render the instruments; a single HUD-local `requestAnimationFrame` spring driver animates needles by writing transforms through refs, so the 10 Hz snapshot never re-renders per frame. Betty plays real cockpit warning recordings, cut once from public web videos, through the existing `FlightAudio` AudioContext.

**Tech Stack:** React 19, TypeScript (strict), Vite 7, SVG, CSS, Web Audio, bun test, Playwright (verification), yt-dlp + ffmpeg (one-off clip fetch).

**Spec:** `docs/superpowers/specs/2026-10-13-holo-glass-hud-design.html`

## Global Constraints

- Work in a git worktree on branch `feat/holo-glass-hud` created from `HEAD` of `pocket-flight-site` (the main checkout has unrelated uncommitted Codex work — never touch it).
- Package manager: bun. Never npm or yarn. No new runtime dependencies.
- TypeScript strict; no `any`.
- Do not modify `src/physics.ts`, `src/aerodynamics.ts`, `src/aircraft-design.ts` or `src/flight-envelope.ts` (they are being changed in the main checkout).
- Font: Oxanium (Google Fonts) for HUD dials/readouts, tabular numerals; everything else stays DM Sans.
- Colours: cyan `#5ff0ff`, soft cyan `#8feaff`, text `#e8fbff`, green `#4dffa6`, amber `#ffd34d`, red `#ff4d63`, glass `rgba(6,18,28,.55)`, rim `rgba(120,230,255,.42)`.
- Warning strobe period 0.35 s (≈2.9 flashes/s) — never faster than 3 flashes per second.
- `prefers-reduced-motion: reduce` → no springs (snap), no boot-up, no strobe, no shake; warnings solid red.
- Altitude is not displayed anywhere.
- Betty clips live in `public/audio/betty/` as mp3; the game never fetches audio from the web at runtime; missing clips must leave Betty silent, never throw.
- Preview server for verification: `bunx vite --port 5199 --strictPort` inside the worktree (user approved this one server).

## Review Focus

1. **Heading through north** (359° → 1°): the compass ring must turn 2°, not spin 358°. Pinned in Task 1 (`unwrapHeading`) tests.
2. **Pause, replay, menu and result screens**: no warnings, no voice, voice stops immediately on pause. Pinned in Task 4 (`mode !== "playing"`) and Task 5 (`planCallout` stop) tests.
3. **Sound off / voice warnings off / clips missing**: Betty silent with no exceptions. Pinned in Task 5 tests (`enabled=false` → stop, no callout) and the `loadVoice` 404 path.
4. **Fuel or health hovering around a threshold** (e.g. fuel 19.9% ↔ 20.1%): one-shot callouts must not chatter. Pinned in Task 4 hysteresis tests.
5. **Values outside a dial's range** (jet airspeed above dial max, climb > 2000 ft/min, negative AOA): needles clamp at the scale ends, no NaN. Pinned in Task 1 (`valueAngle` clamp) and Task 3 (AOA fraction clamp) tests.

---

### Task 0: Worktree and preview server

**Files:** none (environment only)

- [ ] **Step 1: Create the worktree**

```bash
cd "/Users/prasiddhnaik/Documents/blender skills/pocket-flight-site"
git worktree add -b feat/holo-glass-hud ../pocket-flight-hud HEAD
cd ../pocket-flight-hud
bun install
```

- [ ] **Step 2: Copy the approved spec into the worktree** (it is uncommitted in the main checkout)

```bash
mkdir -p docs/superpowers/specs/assets docs/superpowers/plans
cp ../pocket-flight-site/docs/superpowers/specs/2026-10-13-holo-glass-hud-design.html docs/superpowers/specs/
cp ../pocket-flight-site/docs/superpowers/specs/assets/holo-hud-*.png docs/superpowers/specs/assets/
cp ../pocket-flight-site/docs/superpowers/plans/2026-10-13-holo-glass-hud.html docs/superpowers/plans/
printf '\n.superpowers/\n' >> .gitignore
git add docs .gitignore && git commit -m "docs: add Holo Glass HUD spec and plan"
```

- [ ] **Step 3: Baseline checks** — Run: `bun test tests/flight-ui.test.ts && bunx tsc -b`. Expected: tests pass, tsc exits 0. If tsc already fails at HEAD, record the existing errors in the task notes and treat only *new* errors as failures.

---

### Task 1: HUD geometry and per-aircraft airspeed scale

**Files:**
- Create: `src/hud/geometry.ts`
- Test: `tests/hud-geometry.test.ts`

**Interfaces:**
- Produces: `polar(cx, cy, r, degrees): [number, number]`, `arcPath(cx, cy, r, from, to): string`, `type Scale = { min; max; start; sweep }`, `valueAngle(scale, value): number`, `ticks(min, max, step): number[]`, `unwrapHeading(previous, heading): number`, `type Band = { from; to; tone: "green" | "amber" }`, `activeBand(bands, value): number`, `type AirspeedScale = { max; majorStep; minorStep; bands: Band[]; redline }`, `airspeedScale(id: AircraftId): AirspeedScale`, `clamp01(v): number`, `KNOTS_PER_MPS`, `KNOTS_PER_MACH`. Angles are SVG degrees: 0 = east, clockwise positive.

- [ ] **Step 1: Write the failing tests** — `tests/hud-geometry.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import {
  activeBand, airspeedScale, arcPath, clamp01, polar, ticks, unwrapHeading, valueAngle,
} from "../src/hud/geometry";

describe("hud geometry", () => {
  test("polar uses SVG angles: 0° east, 90° south", () => {
    const [x, y] = polar(100, 100, 10, 90);
    expect(x).toBeCloseTo(100);
    expect(y).toBeCloseTo(110);
  });
  test("valueAngle maps linearly and clamps outside the scale", () => {
    const s = { min: 0, max: 200, start: 135, sweep: 270 };
    expect(valueAngle(s, 100)).toBe(270);
    expect(valueAngle(s, -50)).toBe(135);
    expect(valueAngle(s, 900)).toBe(405);
    expect(Number.isNaN(valueAngle(s, Number.NaN))).toBe(false);
  });
  test("arcPath sets the large-arc flag only past 180°", () => {
    expect(arcPath(100, 100, 50, 0, 90)).toContain(" 0 0 1 ");
    expect(arcPath(100, 100, 50, 0, 270)).toContain(" 0 1 1 ");
  });
  test("ticks include both ends without float drift", () => {
    expect(ticks(-2000, 2000, 1000)).toEqual([-2000, -1000, 0, 1000, 2000]);
    expect(ticks(0, 1, 0.25)).toEqual([0, 0.25, 0.5, 0.75, 1]);
  });
  test("unwrapHeading takes the short way through north", () => {
    expect(unwrapHeading(359, 1)).toBe(361);
    expect(unwrapHeading(1, 359)).toBe(-1);
    expect(unwrapHeading(720 + 10, 20)).toBe(740);
    expect(unwrapHeading(90, 90)).toBe(90);
  });
  test("airspeed scale orders stall < warning < redline <= dial max for every aircraft", () => {
    for (const id of ["finch", "peregrine", "aurelia", "stormbird"] as const) {
      const s = airspeedScale(id);
      const [green, amber] = s.bands;
      expect(green.from).toBeGreaterThan(0);
      expect(green.from).toBeLessThan(green.to);
      expect(green.to).toBe(amber.from);
      expect(amber.to).toBe(s.redline);
      expect(s.redline).toBeLessThanOrEqual(s.max);
    }
    expect(airspeedScale("finch").max).toBe(180);
    expect(airspeedScale("finch").redline).toBeCloseTo(165.37, 1);
    expect(airspeedScale("aurelia").max).toBe(450);
    expect(airspeedScale("stormbird").max).toBe(500);
  });
  test("activeBand finds the band containing the value", () => {
    const bands = [{ from: 50, to: 150, tone: "green" as const }, { from: 150, to: 165, tone: "amber" as const }];
    expect(activeBand(bands, 100)).toBe(0);
    expect(activeBand(bands, 160)).toBe(1);
    expect(activeBand(bands, 20)).toBe(-1);
  });
  test("clamp01 handles NaN as 0", () => {
    expect(clamp01(Number.NaN)).toBe(0);
    expect(clamp01(1.4)).toBe(1);
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `bun test tests/hud-geometry.test.ts`. Expected: FAIL, cannot find module `../src/hud/geometry`.

- [ ] **Step 3: Implement** — `src/hud/geometry.ts`

```ts
import type { AircraftId } from "../aircraft";
import { flightProfiles } from "../flight-profiles";
import { islandEnvelope } from "../flight-envelope";

export const KNOTS_PER_MPS = 1.943844;
// ISA sea level; the island ceiling is 1,800 m so the error is small.
export const KNOTS_PER_MACH = 661.47;
const RAD = Math.PI / 180;

export const clamp01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

// SVG angles: 0° points east and positive angles turn clockwise.
export function polar(cx: number, cy: number, r: number, degrees: number): [number, number] {
  return [cx + r * Math.cos(degrees * RAD), cy + r * Math.sin(degrees * RAD)];
}

export function arcPath(cx: number, cy: number, r: number, from: number, to: number) {
  const [x0, y0] = polar(cx, cy, r, from);
  const [x1, y1] = polar(cx, cy, r, to);
  const large = Math.abs(to - from) > 180 ? 1 : 0;
  const sweep = to > from ? 1 : 0;
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r} ${r} 0 ${large} ${sweep} ${x1.toFixed(2)} ${y1.toFixed(2)}`;
}

export type Scale = { min: number; max: number; start: number; sweep: number };

export function valueAngle(s: Scale, value: number) {
  return s.start + clamp01((value - s.min) / (s.max - s.min)) * s.sweep;
}

export function ticks(min: number, max: number, step: number) {
  const count = Math.round((max - min) / step);
  return Array.from({ length: count + 1 }, (_, i) => Math.round((min + i * step) * 1000) / 1000);
}

// Equivalent heading nearest to `previous`, so a ring rotating through north takes the short way.
export function unwrapHeading(previous: number, heading: number) {
  const delta = ((((heading - previous) % 360) + 540) % 360) - 180;
  return previous + delta;
}

export type Band = { from: number; to: number; tone: "green" | "amber" };
export type AirspeedScale = { max: number; majorStep: number; minorStep: number; bands: Band[]; redline: number };

const airspeedDialMax: Record<AircraftId, number> = { finch: 180, aurelia: 450, peregrine: 500, stormbird: 500 };

export function airspeedScale(id: AircraftId): AirspeedScale {
  const max = airspeedDialMax[id];
  const limitMach = islandEnvelope[id].maximumMach;
  const stall = flightProfiles[id].stallSpeed * KNOTS_PER_MPS;
  // Speed protection reports active from 0.035 Mach below the limit.
  const warn = (limitMach - 0.035) * KNOTS_PER_MACH;
  const redline = limitMach * KNOTS_PER_MACH;
  const small = max <= 200;
  return {
    max,
    majorStep: small ? 40 : 100,
    minorStep: small ? 10 : 25,
    bands: [
      { from: stall, to: warn, tone: "green" },
      { from: warn, to: redline, tone: "amber" },
    ],
    redline,
  };
}

export function activeBand(bands: Band[], value: number) {
  return bands.findIndex((b) => value >= b.from && value <= b.to);
}
```

- [ ] **Step 4: Run to verify pass** — Run: `bun test tests/hud-geometry.test.ts`. Expected: PASS (8 tests). If the finch redline assertion fails, print `airspeedScale("finch")` and confirm `0.25 × 661.47 = 165.37`.

- [ ] **Step 5: Commit**

```bash
git add src/hud/geometry.ts tests/hud-geometry.test.ts
git commit -m "feat(hud): add dial geometry and per-aircraft airspeed scale"
```

---

### Task 2: Spring physics, driver and `useSpring` hook

**Files:**
- Create: `src/hud/spring.ts`, `src/hud/useSpring.ts`
- Test: `tests/hud-spring.test.ts`

**Interfaces:**
- Produces: `type SpringConfig = { stiffness: number; damping: number }`, `needleSpring`, `type SpringState = { value: number; velocity: number }`, `stepSpring(state, target, dt, config?): SpringState`, `isSettled(state, target, epsilon?): boolean`, `createChannel(initial, apply, config?): { set(target: number, snap?: boolean): void; dispose(): void }`, `prefersReducedMotion(): boolean`, `useSpring<T extends Element>(target: number, apply: (el: T, value: number) => void, config?): RefObject<T | null>`.

- [ ] **Step 1: Write the failing tests** — `tests/hud-spring.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { isSettled, needleSpring, stepSpring } from "../src/hud/spring";

function run(target: number, seconds: number, dt = 1 / 60) {
  let s = { value: 0, velocity: 0 }, peak = 0;
  for (let t = 0; t < seconds; t += dt) {
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
});
```

- [ ] **Step 2: Run to verify failure** — Run: `bun test tests/hud-spring.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `src/hud/spring.ts`

```ts
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

export function isSettled(state: SpringState, target: number, epsilon = 0.01) {
  return Math.abs(target - state.value) < epsilon && Math.abs(state.velocity) < epsilon;
}

type Channel = { state: SpringState; target: number; config: SpringConfig; apply: (value: number) => void };

const channels = new Set<Channel>();
let frame = 0;
let last = 0;

// One rAF loop for every HUD spring; it stops itself once everything settles.
function tick(now: number) {
  const dt = last ? (now - last) / 1000 : 0;
  last = now;
  let moving = false;
  for (const ch of channels) {
    if (isSettled(ch.state, ch.target)) {
      if (ch.state.value !== ch.target) {
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
  if (!moving) last = 0;
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
      if (!Number.isFinite(target)) return;
      ch.target = target;
      if (snap) {
        ch.state = { value: target, velocity: 0 };
        ch.apply(target);
      } else wake();
    },
    dispose() {
      channels.delete(ch);
    },
  };
}
```

`src/hud/useSpring.ts`

```ts
import { useEffect, useRef } from "react";
import { createChannel, needleSpring, type SpringConfig } from "./spring";

export function prefersReducedMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// Animates `target` with a spring and writes each frame straight to the element, bypassing React renders.
export function useSpring<T extends Element>(
  target: number,
  apply: (el: T, value: number) => void,
  config: SpringConfig = needleSpring,
) {
  const ref = useRef<T>(null);
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const channel = useRef<ReturnType<typeof createChannel> | null>(null);
  const initial = useRef(target);
  useEffect(() => {
    const ch = createChannel(initial.current, (v) => ref.current && applyRef.current(ref.current, v), config);
    channel.current = ch;
    return () => ch.dispose();
  }, [config]);
  useEffect(() => {
    channel.current?.set(target, prefersReducedMotion());
  }, [target]);
  return ref;
}
```

- [ ] **Step 4: Run to verify pass** — Run: `bun test tests/hud-spring.test.ts`. Expected: PASS (4 tests). Then `bunx tsc -b` → no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/hud/spring.ts src/hud/useSpring.ts tests/hud-spring.test.ts
git commit -m "feat(hud): add spring driver for needle animation"
```

---

### Task 3: Instrument data in the snapshot

**Files:**
- Create: `src/hud/instrument-data.ts`
- Modify: `src/game.ts` (Snapshot type near line 26; `emit()` near line 1356)
- Test: `tests/hud-instrument-data.test.ts`

**Interfaces:**
- Consumes: `FlightPhysics` (`jet`, `enginePower`, `fuelKg`, `design.massBudget`, `design.geometry.incidence`, `aerodynamics.alpha`, `aerodynamics.positiveStall`).
- Produces: `type EngineReadout = { kind: "propeller"; rpm: number } | { kind: "jet"; percent: number }`, `type InstrumentData = { engine: EngineReadout; fuelFraction: number; aoaDegrees: number; stallAoaDegrees: number }`, `fuelCapacityKg(p): number`, `instrumentData(p, propellerRpm): InstrumentData`, and `Snapshot.instruments: InstrumentData`.

- [ ] **Step 1: Write the failing tests** — `tests/hud-instrument-data.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { FlightPhysics } from "../src/physics";
import { fuelCapacityKg, instrumentData } from "../src/hud/instrument-data";
import type { AircraftId } from "../src/aircraft";

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0.6, brake: false };
function plane(id: AircraftId, airStart = false) {
  const p = new FlightPhysics();
  p.aircraftId = id;
  p.reset(airStart);
  return p;
}

describe("instrument data", () => {
  test("the Finch reports propeller RPM, jets report thrust percent", () => {
    expect(instrumentData(plane("finch"), 2276).engine).toEqual({ kind: "propeller", rpm: 2276 });
    const jet = plane("aurelia");
    jet.enginePower = 0.42;
    const engine = instrumentData(jet, 0).engine;
    expect(engine.kind).toBe("jet");
    if (engine.kind === "jet") expect(engine.percent).toBeCloseTo(42);
  });
  test("fuel fraction is remaining over capacity and clamped", () => {
    const p = plane("peregrine");
    const capacity = fuelCapacityKg(p);
    expect(capacity).toBeGreaterThan(0);
    p.fuelKg = capacity / 2;
    expect(instrumentData(p, 0).fuelFraction).toBeCloseTo(0.5);
    p.fuelKg = capacity * 3;
    expect(instrumentData(p, 0).fuelFraction).toBe(1);
    p.fuelKg = -5;
    expect(instrumentData(p, 0).fuelFraction).toBe(0);
  });
  test("AOA and stall AOA come from the live aerodynamics in degrees", () => {
    const p = plane("finch", true);
    p.step(1 / 120, neutral);
    const d = instrumentData(p, 0);
    expect(d.stallAoaDegrees).toBeGreaterThan(5);
    expect(d.stallAoaDegrees).toBeLessThan(30);
    expect(d.aoaDegrees).toBeGreaterThan(-10);
    expect(d.aoaDegrees).toBeLessThan(d.stallAoaDegrees);
  });
  test("before the first physics step AOA falls back safely", () => {
    const d = instrumentData(plane("stormbird"), 0);
    expect(d.aoaDegrees).toBe(0);
    expect(d.stallAoaDegrees).toBe(15);
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `bun test tests/hud-instrument-data.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `src/hud/instrument-data.ts`

```ts
import type { FlightPhysics } from "../physics";

export type EngineReadout = { kind: "propeller"; rpm: number } | { kind: "jet"; percent: number };
export type InstrumentData = {
  engine: EngineReadout;
  fuelFraction: number;
  aoaDegrees: number;
  stallAoaDegrees: number;
};

const DEG = 180 / Math.PI;
const FALLBACK_STALL_DEGREES = 15;

export function fuelCapacityKg(p: FlightPhysics) {
  return p.design.massBudget.filter((part) => part.category === "fuel").reduce((sum, part) => sum + part.mass, 0);
}

export function instrumentData(p: FlightPhysics, propellerRpm: number): InstrumentData {
  const capacity = fuelCapacityKg(p);
  const aero = p.aerodynamics;
  return {
    engine: p.jet ? { kind: "jet", percent: p.enginePower * 100 } : { kind: "propeller", rpm: propellerRpm },
    fuelFraction: capacity > 0 ? Math.min(1, Math.max(0, p.fuelKg / capacity)) : 0,
    // Same wing-referenced alpha the stall model uses (flow alpha + incidence).
    aoaDegrees: aero ? (aero.alpha + p.design.geometry.incidence) * DEG : 0,
    stallAoaDegrees: aero ? aero.positiveStall * DEG : FALLBACK_STALL_DEGREES,
  };
}
```

Modify `src/game.ts`:

```ts
// with the other imports
import { instrumentData, type InstrumentData } from "./hud/instrument-data";

// in `export type Snapshot = {`, after `replayExport: ExportState;`
  instruments: InstrumentData;

// in emit(), inside this.onSnapshot({ ... }), after `replayExport: this.replayVideo.state,`
      instruments: instrumentData(p, this.aircraft.propellerMotion.snapshot().rpm),
```

- [ ] **Step 4: Run to verify pass** — Run: `bun test tests/hud-instrument-data.test.ts && bunx tsc -b`. Expected: PASS (4 tests), no new tsc errors. If the AOA test fails because `reset(true)` trims at an angle outside the bounds, print `d` and adjust only the bounds (not the implementation) to the printed trimmed values ± 3°.

- [ ] **Step 5: Commit**

```bash
git add src/hud/instrument-data.ts src/game.ts tests/hud-instrument-data.test.ts
git commit -m "feat(hud): expose engine, fuel and AOA instrument data in snapshots"
```

---

### Task 4: Warning evaluation

**Files:**
- Create: `src/hud/warnings.ts`
- Test: `tests/hud-warnings.test.ts`

**Interfaces:**
- Consumes: `Snapshot` fields `mode, grounded, stall, speedProtection, agl (ft), verticalSpeed (m/s), roll (rad), gearPosition, speed (kn), health`.
- Produces: `warningOrder` (readonly tuple, priority order), `type WarningId`, `warningText: Record<WarningId, string>`, `ONE_SHOT_BANNER_SECONDS = 4`, `type WarningInput`, `type WarningLatch`, `freshLatch(): WarningLatch`, `secondsToImpact(aglFeet, verticalSpeed): number`, `evaluateWarnings(input, latch, now): { active: WarningId[]; latch: WarningLatch }`.

- [ ] **Step 1: Write the failing tests** — `tests/hud-warnings.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { evaluateWarnings, freshLatch, secondsToImpact, type WarningInput } from "../src/hud/warnings";

const base: WarningInput = {
  mode: "playing", grounded: false, stall: false, speedProtection: false, agl: 2000, verticalSpeed: 0,
  roll: 0, gearPosition: 1, speed: 120, health: 100, fuelFraction: 0.8, jet: false, approachKnots: 70,
};
const run = (patch: Partial<WarningInput>, latch = freshLatch(), now = 0) => evaluateWarnings({ ...base, ...patch }, latch, now);

describe("warnings", () => {
  test("nothing is raised outside active play", () => {
    for (const mode of ["menu", "paused", "result", "replay"] as const)
      expect(run({ mode, stall: true }).active).toEqual([]);
  });
  test("time to impact divides height above ground by sink rate", () => {
    expect(secondsToImpact(328.084, -10)).toBeCloseTo(10);
    expect(secondsToImpact(300, 2)).toBe(Infinity);
  });
  test("pull up needs low height and under six seconds to impact", () => {
    expect(run({ agl: 300, verticalSpeed: -20 }).active).toEqual(["pullUp"]);
    expect(run({ agl: 300, verticalSpeed: -5 }).active).toEqual([]);
    expect(run({ agl: 900, verticalSpeed: -60 }).active).toEqual([]);
    expect(run({ agl: 300, verticalSpeed: -20, grounded: true }).active).toEqual([]);
  });
  test("active warnings are sorted by priority", () => {
    const r = run({ agl: 200, verticalSpeed: -15, stall: true, roll: 1.2, speedProtection: true });
    expect(r.active).toEqual(["pullUp", "stall", "overspeed", "bankAngle"]);
  });
  test("bank angle triggers past 60 degrees either way", () => {
    expect(run({ roll: (61 * Math.PI) / 180 }).active).toEqual(["bankAngle"]);
    expect(run({ roll: (-61 * Math.PI) / 180 }).active).toEqual(["bankAngle"]);
    expect(run({ roll: (59 * Math.PI) / 180 }).active).toEqual([]);
  });
  test("landing gear warning is for jets low, slow, descending with gear up", () => {
    const approach = { agl: 400, verticalSpeed: -2, speed: 80, gearPosition: 0, approachKnots: 70 };
    expect(run({ ...approach, jet: true }).active).toEqual(["landingGear"]);
    expect(run({ ...approach, jet: false }).active).toEqual([]);
    expect(run({ ...approach, jet: true, gearPosition: 1 }).active).toEqual([]);
    expect(run({ ...approach, jet: true, speed: 120 }).active).toEqual([]);
  });
  test("fuel low fires once, hides after four seconds, and re-arms with hysteresis", () => {
    let r = run({ fuelFraction: 0.19 }, freshLatch(), 10);
    expect(r.active).toEqual(["fuelLow"]);
    r = run({ fuelFraction: 0.185 }, r.latch, 15);
    expect(r.active).toEqual([]);
    r = run({ fuelFraction: 0.201 }, r.latch, 16);
    r = run({ fuelFraction: 0.199 }, r.latch, 17);
    expect(r.active).toEqual([]);
    r = run({ fuelFraction: 0.23 }, r.latch, 20);
    r = run({ fuelFraction: 0.19 }, r.latch, 30);
    expect(r.active).toEqual(["fuelLow"]);
  });
  test("bingo fuel outranks fuel low", () => {
    const r = run({ fuelFraction: 0.08 }, freshLatch(), 1);
    expect(r.active).toEqual(["bingoFuel"]);
  });
  test("damage fires below 70 and again only after another 5 point drop", () => {
    let r = run({ health: 69 }, freshLatch(), 0);
    expect(r.active).toEqual(["damage"]);
    r = run({ health: 66 }, r.latch, 5);
    expect(r.active).toEqual([]);
    r = run({ health: 63 }, r.latch, 6);
    expect(r.active).toEqual(["damage"]);
    r = run({ health: 100 }, r.latch, 20);
    r = run({ health: 69 }, r.latch, 21);
    expect(r.active).toEqual(["damage"]);
  });
  test("a banner stamped late in a previous flight never shows after the clock restarts", () => {
    const r = run({ fuelFraction: 0.19 }, freshLatch(), 300);
    expect(run({ fuelFraction: 0.19 }, r.latch, 0.2).active).toEqual([]);
  });
  test("the input latch is not mutated", () => {
    const latch = freshLatch();
    run({ fuelFraction: 0.05, health: 50 }, latch, 0);
    expect(latch).toEqual(freshLatch());
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `bun test tests/hud-warnings.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `src/hud/warnings.ts`

```ts
import type { Snapshot } from "../game";

export const warningOrder = [
  "pullUp", "stall", "overspeed", "landingGear", "bankAngle", "bingoFuel", "damage", "fuelLow",
] as const;
export type WarningId = (typeof warningOrder)[number];

export const warningText: Record<WarningId, string> = {
  pullUp: "PULL UP", stall: "STALL", overspeed: "OVERSPEED", landingGear: "LANDING GEAR",
  bankAngle: "BANK ANGLE", bingoFuel: "BINGO FUEL", damage: "DAMAGE", fuelLow: "FUEL LOW",
};

export const ONE_SHOT_BANNER_SECONDS = 4;
const FEET_PER_METRE = 3.28084;
const ONE_SHOT: WarningId[] = ["bingoFuel", "damage", "fuelLow"];

export type WarningInput = Pick<
  Snapshot,
  "mode" | "grounded" | "stall" | "speedProtection" | "agl" | "verticalSpeed" | "roll" | "gearPosition" | "speed" | "health"
> & { fuelFraction: number; jet: boolean; approachKnots: number };

export type WarningLatch = {
  fuelLowArmed: boolean;
  bingoArmed: boolean;
  damageHealth: number;
  firedAt: Partial<Record<WarningId, number>>;
};

export const freshLatch = (): WarningLatch => ({ fuelLowArmed: true, bingoArmed: true, damageHealth: 100, firedAt: {} });

export function secondsToImpact(aglFeet: number, verticalSpeed: number) {
  return verticalSpeed < -0.5 ? aglFeet / FEET_PER_METRE / -verticalSpeed : Infinity;
}

export function evaluateWarnings(s: WarningInput, latch: WarningLatch, now: number) {
  const next: WarningLatch = { ...latch, firedAt: { ...latch.firedAt } };
  if (s.mode !== "playing") return { active: [] as WarningId[], latch: next };
  const airborne = !s.grounded;
  const on = new Set<WarningId>();
  if (airborne && s.agl < 500 && secondsToImpact(s.agl, s.verticalSpeed) < 6) on.add("pullUp");
  if (s.stall) on.add("stall");
  if (s.speedProtection) on.add("overspeed");
  if (s.jet && airborne && s.gearPosition < 0.5 && s.agl < 500 && s.verticalSpeed < 0 && s.speed < s.approachKnots * 1.2)
    on.add("landingGear");
  if (airborne && Math.abs(s.roll) > Math.PI / 3) on.add("bankAngle");

  // One-shot warnings fire on crossing a threshold and re-arm only past a hysteresis margin.
  if (s.fuelFraction <= 0.1) {
    if (next.bingoArmed) (next.bingoArmed = false), (next.firedAt.bingoFuel = now);
  } else if (s.fuelFraction > 0.12) next.bingoArmed = true;
  if (s.fuelFraction <= 0.2 && s.fuelFraction > 0.1) {
    if (next.fuelLowArmed) (next.fuelLowArmed = false), (next.firedAt.fuelLow = now);
  } else if (s.fuelFraction > 0.22) next.fuelLowArmed = true;
  if (s.health >= 97) next.damageHealth = 100;
  else if (s.health < 70 && s.health <= next.damageHealth - 5) (next.damageHealth = s.health), (next.firedAt.damage = now);

  for (const id of ONE_SHOT) {
    const at = next.firedAt[id];
    // `now >= at` ignores stamps from a previous flight whose clock has since restarted.
    if (at !== undefined && now >= at && now - at < ONE_SHOT_BANNER_SECONDS) on.add(id);
  }
  return { active: warningOrder.filter((id) => on.has(id)), latch: next };
}
```

- [ ] **Step 4: Run to verify pass** — Run: `bun test tests/hud-warnings.test.ts`. Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/hud/warnings.ts tests/hud-warnings.test.ts
git commit -m "feat(hud): evaluate flight warnings with priority and hysteresis"
```

---

### Task 5: Betty callout scheduler and voice playback

**Files:**
- Create: `src/betty.ts`
- Modify: `src/audio.ts` (add voice methods to `FlightAudio`)
- Test: `tests/betty.test.ts`

**Interfaces:**
- Consumes: `WarningId`, `warningOrder` (Task 4); `FlightAudio`.
- Produces: `repeatSeconds`, `bettyFiles`, `CHIME_SECONDS = 0.4`, `type CalloutState`, `idleCallouts()`, `planCallout(state, active, now, durationOf): { callout: { id: WarningId; chime: boolean } | null; stop: boolean; state: CalloutState }`, `class Betty { enabled: boolean; constructor(audio: FlightAudio, base?: string); update(active: WarningId[], now: number): void; silence(): void }`. `FlightAudio.loadVoice(url): Promise<AudioBuffer | null>`, `FlightAudio.playVoice(buffers: AudioBuffer[]): void`, `FlightAudio.stopVoice(): void`.

- [ ] **Step 1: Write the failing tests** — `tests/betty.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { CHIME_SECONDS, idleCallouts, planCallout } from "../src/betty";

const len = () => 1.2;

describe("betty scheduling", () => {
  test("a new warning plays with the master-caution chime", () => {
    const r = planCallout(idleCallouts(), ["stall"], 0, len);
    expect(r.callout).toEqual({ id: "stall", chime: true });
    expect(r.state.busyUntil).toBeCloseTo(1.2 + CHIME_SECONDS);
  });
  test("repeating warnings wait for their interval and skip the chime", () => {
    let r = planCallout(idleCallouts(), ["stall"], 0, len);
    r = planCallout(r.state, ["stall"], 1.0, len);
    expect(r.callout).toBeNull();
    r = planCallout(r.state, ["stall"], 2.0, len);
    expect(r.callout).toEqual({ id: "stall", chime: false });
  });
  test("one-shot warnings play once while they stay active", () => {
    let r = planCallout(idleCallouts(), ["fuelLow"], 0, len);
    expect(r.callout?.id).toBe("fuelLow");
    r = planCallout(r.state, ["fuelLow"], 10, len);
    expect(r.callout).toBeNull();
  });
  test("a higher-priority warning interrupts a lower one", () => {
    let r = planCallout(idleCallouts(), ["bankAngle"], 0, len);
    r = planCallout(r.state, ["pullUp", "bankAngle"], 0.3, len);
    expect(r.stop).toBe(true);
    expect(r.callout).toEqual({ id: "pullUp", chime: true });
  });
  test("a lower-priority warning never interrupts", () => {
    let r = planCallout(idleCallouts(), ["pullUp"], 0, len);
    r = planCallout(r.state, ["pullUp", "fuelLow"], 0.5, len);
    expect(r.callout).toBeNull();
    expect(r.stop).toBe(false);
  });
  test("clearing all warnings stops the voice and forgets announcements", () => {
    let r = planCallout(idleCallouts(), ["stall"], 0, len);
    r = planCallout(r.state, [], 0.5, len);
    expect(r.stop).toBe(true);
    expect(r.state.announced).toEqual([]);
    r = planCallout(r.state, ["stall"], 0.6, len);
    expect(r.callout).toEqual({ id: "stall", chime: true });
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `bun test tests/betty.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement** — `src/betty.ts`

```ts
import type { FlightAudio } from "./audio";
import { warningOrder, type WarningId } from "./hud/warnings";

export const repeatSeconds: Record<WarningId, number | null> = {
  pullUp: 2, stall: 2, overspeed: 3, landingGear: 3, bankAngle: 3, bingoFuel: null, damage: null, fuelLow: null,
};
export const bettyFiles: Record<WarningId | "chime", string> = {
  pullUp: "pull-up", stall: "stall", overspeed: "overspeed", landingGear: "landing-gear",
  bankAngle: "bank-angle", bingoFuel: "bingo-fuel", damage: "damage", fuelLow: "fuel-low", chime: "chime",
};
export const CHIME_SECONDS = 0.4;

export type CalloutState = {
  playing: WarningId | null;
  busyUntil: number;
  lastStarted: Partial<Record<WarningId, number>>;
  announced: WarningId[];
};
export const idleCallouts = (): CalloutState => ({ playing: null, busyUntil: 0, lastStarted: {}, announced: [] });

const rank = (id: WarningId) => warningOrder.indexOf(id);

export function planCallout(state: CalloutState, active: WarningId[], now: number, durationOf: (id: WarningId) => number) {
  const next: CalloutState = {
    ...state,
    lastStarted: { ...state.lastStarted },
    announced: state.announced.filter((id) => active.includes(id)),
  };
  const busy = next.playing !== null && now < next.busyUntil;
  const top = active[0];
  if (!top) {
    next.playing = null;
    return { callout: null, stop: busy, state: next };
  }
  if (busy && rank(next.playing!) <= rank(top)) return { callout: null, stop: false, state: next };
  const repeat = repeatSeconds[top];
  const fresh = !next.announced.includes(top);
  const due = fresh || (repeat !== null && now - (next.lastStarted[top] ?? -Infinity) >= repeat);
  if (!due) return { callout: null, stop: false, state: next };
  next.playing = top;
  next.busyUntil = now + durationOf(top) + (fresh ? CHIME_SECONDS : 0);
  next.lastStarted[top] = now;
  if (fresh) next.announced.push(top);
  return { callout: { id: top, chime: fresh }, stop: busy, state: next };
}

export class Betty {
  enabled = true;
  private state = idleCallouts();
  private buffers = new Map<WarningId | "chime", AudioBuffer>();
  private loading = false;
  constructor(private audio: FlightAudio, private base = "/audio/betty/") {}

  private preload() {
    if (this.loading) return;
    this.loading = true;
    for (const [id, file] of Object.entries(bettyFiles) as [WarningId | "chime", string][])
      void this.audio.loadVoice(`${this.base}${file}.mp3`).then((b) => b && this.buffers.set(id, b));
  }

  update(active: WarningId[], now: number) {
    this.preload();
    const audible = this.enabled && this.audio.enabled ? active : [];
    const r = planCallout(this.state, audible, now, (id) => this.buffers.get(id)?.duration ?? 1.4);
    this.state = r.state;
    if (r.stop) this.audio.stopVoice();
    if (!r.callout) return;
    const voice = this.buffers.get(r.callout.id);
    const chime = r.callout.chime ? this.buffers.get("chime") : undefined;
    const clips = [chime, voice].filter((b): b is AudioBuffer => !!b);
    if (clips.length) this.audio.playVoice(clips);
  }

  silence() {
    this.state = idleCallouts();
    this.audio.stopVoice();
  }
}
```

Modify `src/audio.ts` — add these members to `FlightAudio` (after `jet = false;`) and methods (after `toggle()`):

```ts
  private voiceGain: GainNode | null = null;
  private voiceSources: AudioBufferSourceNode[] = [];
  private voiceCache = new Map<string, Promise<AudioBuffer | null>>();
```

```ts
  // Voice clips are optional; a missing or undecodable file resolves to null.
  loadVoice(url: string) {
    const ctx = this.context;
    if (!ctx) return Promise.resolve(null);
    let clip = this.voiceCache.get(url);
    if (!clip) {
      clip = fetch(url)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status}`))))
        .then((data) => ctx.decodeAudioData(data))
        .catch(() => null);
      this.voiceCache.set(url, clip);
    }
    return clip;
  }
  playVoice(buffers: AudioBuffer[]) {
    const ctx = this.context;
    if (!ctx || !this.master) return;
    this.stopVoice();
    if (!this.voiceGain) {
      this.voiceGain = ctx.createGain();
      this.voiceGain.gain.value = 0.9;
      this.voiceGain.connect(this.master);
    }
    let at = ctx.currentTime + 0.02;
    this.voiceSources = buffers.map((buffer) => {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.voiceGain!);
      source.start(at);
      at += buffer.duration;
      return source;
    });
  }
  stopVoice() {
    for (const source of this.voiceSources) {
      try {
        source.stop();
      } catch {
        /* Already stopped. */
      }
    }
    this.voiceSources = [];
  }
```

Note: `Betty.preload()` only succeeds once the AudioContext exists. If `loadVoice` returns null because the context is not started yet, the cache is not populated (the early return happens before caching), so set `this.loading = false` again when every result is null. Implement that by replacing the preload loop with:

```ts
    const files = Object.entries(bettyFiles) as [WarningId | "chime", string][];
    void Promise.all(files.map(([id, file]) => this.audio.loadVoice(`${this.base}${file}.mp3`).then((b) => b && this.buffers.set(id, b))))
      .then(() => { if (!this.buffers.size) this.loading = false; });
```

- [ ] **Step 4: Run to verify pass** — Run: `bun test tests/betty.test.ts && bunx tsc -b`. Expected: PASS (6 tests), no new tsc errors.

- [ ] **Step 5: Commit**

```bash
git add src/betty.ts src/audio.ts tests/betty.test.ts
git commit -m "feat(audio): add Betty voice warning scheduler and voice playback"
```

---

### Task 6: Fetch Betty clips from the web

Ruling R4 (user decision, 2026-10-14): Betty uses real cockpit warning recordings cut from public YouTube videos, not AI TTS. The F/A-18 Hornet "Betty" covers pull up, bingo, fuel low and damage ("Flight controls"). Clips the Hornet lacks come from airliner voices: stall from Airbus, bank angle from the Boeing 757 GPWS, landing gear from the Boeing 717 voice, and overspeed from the real 737NG overspeed clacker. The controller has already verified every timestamp below by transcription.

**Files:**
- Create: `scripts/fetch-betty.ts`, `public/audio/betty/*.mp3`
- Modify: `package.json` (add script `"betty:fetch": "bun scripts/fetch-betty.ts"`)
- Test: `tests/betty-assets.test.ts`

**Interfaces:**
- Consumes: `bettyFiles`, `WarningId`.

- [ ] **Step 1: Write the asset test** — `tests/betty-assets.test.ts`

```ts
import { describe, expect, test } from "bun:test";
import { existsSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { bettyFiles } from "../src/betty";

const dir = fileURLToPath(new URL("../public/audio/betty/", import.meta.url));
const files = Object.values(bettyFiles).map((f) => `${dir}${f}.mp3`);

describe("betty clips", () => {
  test("every clip exists, is non-trivial, and the set stays under 150 KB", () => {
    let total = 0;
    for (const f of files) {
      expect(existsSync(f)).toBe(true);
      const size = statSync(f).size;
      expect(size).toBeGreaterThan(1000);
      total += size;
    }
    expect(total).toBeLessThan(150_000);
  });
});
```

- [ ] **Step 2: Run to verify failure** — Run: `bun test tests/betty-assets.test.ts`. Expected: FAIL (files missing).

- [ ] **Step 3: Write the fetch script** — `scripts/fetch-betty.ts`

```ts
// One-off fetch of the Betty voice clips from public cockpit-warning videos.
// The game only ever loads the committed mp3 files. Needs yt-dlp and ffmpeg on PATH.
// Usage: bun run betty:fetch
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { bettyFiles } from "../src/betty";
import type { WarningId } from "../src/hud/warnings";

type Cut = { video: string; from: number; to: number; says: string };
// YouTube video id and the seconds holding each callout.
const cuts: Record<WarningId | "chime", Cut> = {
  pullUp: { video: "Jqt2kg7IUt8", from: 3.22, to: 4.33, says: "Pull up, pull up (F/A-18)" },
  stall: { video: "RwNKP_vVKJw", from: 2.85, to: 4.3, says: "Stall, stall (Airbus)" },
  overspeed: { video: "8kafXP3s1jo", from: 0.48, to: 2.48, says: "overspeed clacker (737NG)" },
  landingGear: { video: "r0AK4yxBGnM", from: 28.68, to: 29.72, says: "Landing gear (717)" },
  bankAngle: { video: "tp5qNbYyxZ4", from: 17.85, to: 20.3, says: "Bank angle, bank angle (757)" },
  bingoFuel: { video: "Jqt2kg7IUt8", from: 16.85, to: 19.25, says: "Bingo, bingo (F/A-18)" },
  damage: { video: "Jqt2kg7IUt8", from: 11.68, to: 14.22, says: "Flight controls, flight controls (F/A-18)" },
  fuelLow: { video: "Jqt2kg7IUt8", from: 14.79, to: 15.9, says: "Fuel low (F/A-18)" },
  chime: { video: "Jqt2kg7IUt8", from: 28.33, to: 28.73, says: "caution tone (F/A-18)" },
};
// Trim rumble and hiss, even out loudness, limit peaks clear of 0 dBFS, and fade edges so cuts never click.
const FILTER = "highpass=f=200,lowpass=f=6000,loudnorm=I=-16:TP=-1.5:LRA=7,aresample=22050,alimiter=limit=0.6:level=false,afade=t=in:d=0.01,areverse,afade=t=in:d=0.04,areverse";

const out = fileURLToPath(new URL("../public/audio/betty/", import.meta.url));
const cache = `${tmpdir()}/betty-src/`;
await mkdir(out, { recursive: true });
await mkdir(cache, { recursive: true });

async function run(cmd: string[]) {
  const child = Bun.spawn(cmd, { stdout: "ignore", stderr: "inherit" });
  if (await child.exited) throw new Error(`failed: ${cmd.join(" ")}`);
}

for (const video of new Set(Object.values(cuts).map((c) => c.video))) {
  if (await Bun.file(`${cache}${video}.wav`).exists()) continue;
  await run(["yt-dlp", "-q", "--no-update", "-x", "--audio-format", "wav", "-o", `${cache}%(id)s.%(ext)s`, `https://www.youtube.com/watch?v=${video}`]);
}
for (const [id, c] of Object.entries(cuts) as [WarningId | "chime", Cut][]) {
  await run([
    "ffmpeg", "-y", "-loglevel", "error", "-ss", String(c.from), "-to", String(c.to), "-i", `${cache}${c.video}.wav`,
    "-ac", "1", "-ar", "22050", "-af", FILTER, "-b:a", "48k", `${out}${bettyFiles[id]}.mp3`,
  ]);
  console.log(`wrote ${bettyFiles[id]}.mp3: ${c.says}`);
}
```

Add to `package.json` scripts: `"betty:fetch": "bun scripts/fetch-betty.ts",`

- [ ] **Step 4: Fetch** — Run: `bun run betty:fetch`. Expected: `wrote …mp3` for 9 files. If `/tmp/betty-src/` already holds the source wavs, they are reused.

- [ ] **Step 5: Verify** — Run: `bun test tests/betty-assets.test.ts` (Expected: PASS) and `for f in public/audio/betty/*.mp3; do ffprobe -v error -show_entries format=duration -of csv=p=0 "$f"; done` (Expected: chime ≈0.4 s, the others 1.0–2.6 s).

- [ ] **Step 6: Commit**

```bash
git add scripts/fetch-betty.ts package.json public/audio/betty tests/betty-assets.test.ts
git commit -m "feat(audio): add Betty voice clips cut from real cockpit recordings"
```

---


### Task 7: Instrument components and Holo Glass styles

**Files:**
- Create: `src/hud/RollingDigits.tsx`, `src/hud/Dial.tsx`, `src/hud/CompassRose.tsx`, `src/hud/BarGauge.tsx`, `src/hud/SlotGauge.tsx`, `src/hud/hud.css`
- Test: `bunx tsc -b` (components are verified visually in Task 9)

**Interfaces:**
- Consumes: Task 1 geometry, Task 2 `useSpring`, `headingReadout` from `src/flight-ui.ts`.
- Produces:
  - `RollingDigits({ value: string })`
  - `Dial({ label, min, max, value, start?, sweep?, majorStep, minorStep, tickLabel?, bands?, redline?, readout, unit?, size: "large" | "small", className? })`
  - `CompassRose({ heading: number })`
  - `BarGauge({ label, fraction, readout, tone?: "cyan" | "green" | "amber" | "red", segments?, pulse?, onDrag?: (fraction: number) => void, className? })`
  - `SlotGauge({ label, position: number, readout })` — `position` 0 = top, 1 = bottom.

- [ ] **Step 1: RollingDigits** — `src/hud/RollingDigits.tsx`

```tsx
// Odometer readout: each digit is a 0–9 strip that rolls; other glyphs (−, comma, °) render as-is.
export function RollingDigits({ value }: { value: string }) {
  const chars = [...value];
  return (
    <span className="hud-digits" aria-hidden="true">
      {chars.map((ch, i) => {
        const key = chars.length - i; // right-aligned keys keep columns stable as numbers grow
        return /\d/.test(ch) ? (
          <span key={key} className="hud-digit">
            <span style={{ transform: `translateY(calc(${-Number(ch)} * var(--digit-h)))` }}>
              {"0123456789".split("").map((d) => (
                <i key={d}>{d}</i>
              ))}
            </span>
          </span>
        ) : (
          <span key={`${key}${ch}`} className="hud-glyph">
            {ch}
          </span>
        );
      })}
    </span>
  );
}
```

- [ ] **Step 2: Dial** — `src/hud/Dial.tsx`

```tsx
import { activeBand, arcPath, polar, ticks, valueAngle, type Band, type Scale } from "./geometry";
import { RollingDigits } from "./RollingDigits";
import { useSpring } from "./useSpring";

const C = 100;
const R = 86;

export type DialProps = {
  label: string;
  min: number;
  max: number;
  value: number;
  start?: number;
  sweep?: number;
  majorStep: number;
  minorStep: number;
  tickLabel?: (value: number) => string;
  bands?: Band[];
  redline?: number;
  readout: string;
  unit?: string;
  size: "large" | "small";
  className?: string;
};

export function Dial({
  label, min, max, value, start = 135, sweep = 270, majorStep, minorStep,
  tickLabel = String, bands = [], redline, readout, unit, size, className = "",
}: DialProps) {
  const scale: Scale = { min, max, start, sweep };
  const needle = useSpring<SVGGElement>(valueAngle(scale, value), (el, angle) =>
    el.setAttribute("transform", `rotate(${angle.toFixed(2)} ${C} ${C})`),
  );
  const lit = activeBand(bands, value);
  const major = new Set(ticks(min, max, majorStep));
  const line = (v: number, inner: number, outer: number) => {
    const a = valueAngle(scale, v);
    const [x1, y1] = polar(C, C, inner, a);
    const [x2, y2] = polar(C, C, outer, a);
    return { x1, y1, x2, y2 };
  };
  return (
    <div className={`hud-dial hud-dial-${size} ${className}`} role="img" aria-label={`${label} ${readout}${unit ? ` ${unit}` : ""}`}>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="hud-rim" cx={C} cy={C} r={96} pathLength={1} />
        <circle className="hud-rim-inner" cx={C} cy={C} r={R + 3} />
        {bands.map((b, i) => (
          <path
            key={i}
            className={`hud-band hud-band-${b.tone} ${i === lit ? "lit" : ""}`}
            d={arcPath(C, C, R - 4, valueAngle(scale, b.from), valueAngle(scale, b.to))}
          />
        ))}
        {ticks(min, max, minorStep).map((v) => {
          const big = major.has(v);
          const mid = !big && (v - min) % (minorStep * 2) === 0;
          return <line key={v} className={`hud-tick ${big ? "major" : mid ? "mid" : ""}`} {...line(v, R - (big ? 15 : mid ? 10 : 7), R)} />;
        })}
        {[...major].map((v) => {
          const [x, y] = polar(C, C, R - 30, valueAngle(scale, v));
          return <text key={v} className="hud-tick-label" x={x} y={y}>{tickLabel(v)}</text>;
        })}
        {redline !== undefined && <line className="hud-redline" {...line(redline, R - 15, R + 4)} />}
        <g ref={needle} className="hud-needle">
          <path d={`M${C - 16} ${C - 2.2} L${C + R - 10} ${C - 0.8} L${C + R - 4} ${C} L${C + R - 10} ${C + 0.8} L${C - 16} ${C + 2.2} Z`} />
        </g>
        <circle className="hud-hub" cx={C} cy={C} r={7} />
        <circle className="hud-hub-cap" cx={C} cy={C} r={3} />
      </svg>
      <div className="hud-readout">
        <RollingDigits value={readout} />
        {unit && <small>{unit}</small>}
      </div>
      <span className="hud-label">{label}</span>
    </div>
  );
}
```

- [ ] **Step 3: CompassRose** — `src/hud/CompassRose.tsx`

```tsx
import { useRef } from "react";
import { headingReadout } from "../flight-ui";
import { polar, unwrapHeading } from "./geometry";
import { RollingDigits } from "./RollingDigits";
import { useSpring } from "./useSpring";

const C = 100;
const R = 86;
const cardinals: Record<number, string> = { 0: "N", 90: "E", 180: "S", 270: "W" };
const marks = Array.from({ length: 72 }, (_, i) => i * 5);

export function CompassRose({ heading }: { heading: number }) {
  const unwrapped = useRef(heading);
  unwrapped.current = unwrapHeading(unwrapped.current, heading);
  const ring = useSpring<SVGGElement>(-unwrapped.current, (el, a) => el.setAttribute("transform", `rotate(${a.toFixed(2)} ${C} ${C})`));
  const { degrees, cardinal } = headingReadout(heading);
  return (
    <div className="hud-compass" role="img" aria-label={`Heading ${degrees} degrees ${cardinal}`}>
      <div className="hud-heading-box">
        <RollingDigits value={degrees} />°
      </div>
      <svg viewBox="0 0 200 200" aria-hidden="true">
        <circle className="hud-rim" cx={C} cy={C} r={96} pathLength={1} />
        <g ref={ring}>
          {marks.map((d) => {
            const big = d % 30 === 0;
            const mid = d % 10 === 0;
            const [x1, y1] = polar(C, C, R - (big ? 14 : mid ? 9 : 5), d - 90);
            const [x2, y2] = polar(C, C, R, d - 90);
            return <line key={d} className={`hud-tick ${big ? "major" : mid ? "mid" : ""}`} x1={x1} y1={y1} x2={x2} y2={y2} />;
          })}
          {marks.filter((d) => d % 30 === 0).map((d) => {
            const [x, y] = polar(C, C, R - 29, d - 90);
            const label = cardinals[d] ?? String(d / 10);
            return (
              <text key={d} x={x} y={y} transform={`rotate(${d} ${x} ${y})`} className={`hud-compass-label ${cardinals[d] ? "cardinal" : ""} ${d === 0 ? "north" : ""}`}>
                {label}
              </text>
            );
          })}
        </g>
        <path className="hud-lubber" d={`M${C - 7} 1 L${C + 7} 1 L${C} 13 Z`} />
        <path className="hud-aircraft" transform={`translate(${C} ${C}) scale(1.7)`} d="M0 -13 L2.6 -2 L14 4 L14 6.5 L2.6 3.5 L2 10 L5.5 12.5 L5.5 14 L0 12.8 L-5.5 14 L-5.5 12.5 L-2 10 L-2.6 3.5 L-14 6.5 L-14 4 L-2.6 -2 Z" />
      </svg>
    </div>
  );
}
```

- [ ] **Step 4: BarGauge and SlotGauge** — `src/hud/BarGauge.tsx`

```tsx
import type { KeyboardEvent, PointerEvent } from "react";
import { clamp01 } from "./geometry";
import { useSpring } from "./useSpring";

type BarGaugeProps = {
  label: string;
  fraction: number;
  readout: string;
  tone?: "cyan" | "green" | "amber" | "red";
  segments?: number;
  pulse?: boolean;
  onDrag?: (fraction: number) => void;
  className?: string;
};

export function BarGauge({ label, fraction, readout, tone = "green", segments, pulse = false, onDrag, className = "" }: BarGaugeProps) {
  const value = clamp01(fraction);
  const fill = useSpring<HTMLDivElement>(value, (el, v) => {
    el.style.transform = `scaleY(${clamp01(v)})`;
  });
  const setFromPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onDrag?.(clamp01((r.bottom - e.clientY) / r.height));
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === "ArrowUp" || e.key === "ArrowRight" ? 0.05 : e.key === "ArrowDown" || e.key === "ArrowLeft" ? -0.05 : 0;
    if (!step) return;
    e.preventDefault();
    onDrag?.(clamp01(value + step));
  };
  const lit = segments ? Math.round(value * segments) : 0;
  return (
    <div className={`hud-bar tone-${tone} ${pulse ? "pulse" : ""} ${onDrag ? "draggable" : ""} ${className}`}>
      <div
        className="hud-bar-track"
        aria-label={label}
        {...(onDrag
          ? {
              role: "slider",
              tabIndex: 0,
              "aria-valuemin": 0,
              "aria-valuemax": 100,
              "aria-valuenow": Math.round(value * 100),
              onKeyDown: onKey,
              onPointerDown: (e: PointerEvent<HTMLDivElement>) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                setFromPointer(e);
              },
              onPointerMove: (e: PointerEvent<HTMLDivElement>) => {
                if (e.currentTarget.hasPointerCapture(e.pointerId)) setFromPointer(e);
              },
            }
          : { role: "img" })}
      >
        {segments ? (
          Array.from({ length: segments }, (_, i) => <i key={i} className={i < lit ? "on" : ""} />)
        ) : (
          <div ref={fill} className="hud-bar-fill" />
        )}
      </div>
      <span className="hud-label">{label}</span>
      <b className="hud-value">{readout}</b>
    </div>
  );
}
```

`src/hud/SlotGauge.tsx`

```tsx
import { clamp01 } from "./geometry";
import { useSpring } from "./useSpring";

export function SlotGauge({ label, position, readout }: { label: string; position: number; readout: string }) {
  const marker = useSpring<HTMLDivElement>(clamp01(position), (el, v) => {
    el.style.top = `${clamp01(v) * 100}%`;
  });
  return (
    <div className="hud-slot" role="img" aria-label={`${label} ${readout}`}>
      <div className="hud-slot-track">
        <div ref={marker} className="hud-slot-marker" />
      </div>
      <span className="hud-label">{label}</span>
      <b className="hud-value">{readout}</b>
    </div>
  );
}
```

- [ ] **Step 5: Holo Glass styles (instruments)** — `src/hud/hud.css` (layout rules are appended in Task 8)

```css
@import url("https://fonts.googleapis.com/css2?family=Oxanium:wght@400;500;600;700;800&display=swap");

.holo-hud {
  --hud-cyan: #5ff0ff;
  --hud-cyan-soft: #8feaff;
  --hud-text: #e8fbff;
  --hud-green: #4dffa6;
  --hud-amber: #ffd34d;
  --hud-red: #ff4d63;
  --hud-glass: rgba(6, 18, 28, 0.55);
  --hud-rim: rgba(120, 230, 255, 0.42);
  --dial-lg: clamp(150px, 15.5vw, 228px);
  --dial-sm: clamp(78px, 7.4vw, 106px);
  --compass: clamp(112px, 11vw, 156px);
  --bar-h: calc(var(--dial-lg) * 0.46);
  position: absolute;
  inset: 0;
  z-index: 2;
  pointer-events: none;
  color: var(--hud-text);
  font-family: "Oxanium", "DM Sans", sans-serif;
  font-variant-numeric: tabular-nums;
}
.holo-hud button,
.holo-hud [role="slider"],
.holo-hud .touch-controls,
.holo-hud .touch-controls * {
  pointer-events: auto;
}

.hud-glass {
  background: var(--hud-glass);
  border: 1px solid var(--hud-rim);
  border-radius: 10px;
  backdrop-filter: blur(10px) saturate(1.25);
  -webkit-backdrop-filter: blur(10px) saturate(1.25);
  box-shadow: inset 0 1px 0 rgba(200, 250, 255, 0.18), inset 0 0 18px rgba(95, 240, 255, 0.06), 0 8px 24px rgba(0, 10, 20, 0.25);
}
.hud-label {
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.22em;
  color: var(--hud-cyan-soft);
  white-space: nowrap;
}
.hud-value {
  font-size: 13px;
  font-weight: 600;
  text-shadow: 0 0 8px rgba(95, 240, 255, 0.45);
}

/* Dials */
.hud-dial,
.hud-compass {
  position: relative;
  flex: none;
  aspect-ratio: 1;
}
.hud-dial { width: var(--dial-lg); }
.hud-dial-small { width: var(--dial-sm); margin-bottom: 38px; }
.hud-compass { width: var(--compass); }
.hud-dial::before,
.hud-compass::before {
  content: "";
  position: absolute;
  inset: 2%;
  border-radius: 50%;
  background: radial-gradient(circle at 50% 28%, rgba(34, 78, 98, 0.5), rgba(4, 12, 20, 0.74) 72%);
  backdrop-filter: blur(8px) saturate(1.2);
  -webkit-backdrop-filter: blur(8px) saturate(1.2);
  box-shadow: inset 0 2px 0 rgba(200, 250, 255, 0.22), inset 0 -8px 20px rgba(0, 0, 0, 0.38), 0 10px 30px rgba(0, 10, 20, 0.32);
}
.hud-dial svg,
.hud-compass svg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  overflow: visible;
}
.hud-rim { fill: none; stroke: var(--hud-rim); stroke-width: 1.8; }
.hud-rim-inner { fill: none; stroke: rgba(120, 230, 255, 0.12); stroke-width: 1; }
.hud-tick { stroke: var(--hud-cyan-soft); stroke-width: 1.1; opacity: 0.45; }
.hud-tick.mid { stroke-width: 1.5; opacity: 0.7; }
.hud-tick.major { stroke-width: 2.6; opacity: 1; stroke: var(--hud-text); }
.hud-tick-label,
.hud-compass-label {
  fill: var(--hud-text);
  font: 600 15px "Oxanium", sans-serif;
  text-anchor: middle;
  dominant-baseline: central;
}
.hud-dial-small .hud-tick-label { font-size: 20px; }
.hud-compass-label { fill: var(--hud-cyan-soft); font-size: 14px; }
.hud-compass-label.cardinal { fill: var(--hud-text); font-size: 20px; font-weight: 700; }
.hud-compass-label.north { fill: var(--hud-red); }
.hud-band { fill: none; stroke-width: 6; opacity: 0.5; transition: opacity 0.3s, filter 0.3s; }
.hud-band-green { stroke: var(--hud-green); }
.hud-band-amber { stroke: var(--hud-amber); }
.hud-band-green.lit { opacity: 1; filter: drop-shadow(0 0 4px rgba(77, 255, 166, 0.9)); }
.hud-band-amber.lit { opacity: 1; filter: drop-shadow(0 0 4px rgba(255, 211, 77, 0.9)); }
.hud-redline { stroke: var(--hud-red); stroke-width: 4; stroke-linecap: round; }
.hud-needle path { fill: var(--hud-cyan); filter: drop-shadow(0 0 3px rgba(95, 240, 255, 0.95)); }
.hud-hub { fill: #0b2230; stroke: var(--hud-cyan); stroke-width: 2; }
.hud-hub-cap { fill: var(--hud-cyan); }
.hud-lubber { fill: var(--hud-cyan); filter: drop-shadow(0 0 3px rgba(95, 240, 255, 0.9)); }
.hud-aircraft { fill: var(--hud-cyan); filter: drop-shadow(0 0 4px rgba(95, 240, 255, 0.9)); }

.hud-readout {
  position: absolute;
  left: 50%;
  top: 68%;
  transform: translate(-50%, -50%);
  display: flex;
  align-items: baseline;
  gap: 0.28em;
  padding: 0.08em 0.45em;
  border: 1px solid rgba(95, 240, 255, 0.5);
  border-radius: 4px;
  background: rgba(95, 240, 255, 0.1);
  font-size: calc(var(--dial-lg) * 0.115);
  font-weight: 600;
  line-height: 1.1;
  white-space: nowrap;
  text-shadow: 0 0 8px rgba(95, 240, 255, 0.6);
}
.hud-readout small { font-size: 0.42em; letter-spacing: 0.16em; color: var(--hud-cyan-soft); }
.hud-dial > .hud-label { position: absolute; left: 50%; top: 82%; transform: translateX(-50%); }
.hud-dial-small .hud-readout {
  top: auto;
  bottom: -36px;
  transform: translateX(-50%);
  border: 0;
  background: none;
  padding: 0;
  font-size: 14px;
}
.hud-dial-small > .hud-label { top: auto; bottom: -18px; }

.hud-digits { display: inline-flex; --digit-h: 1.1em; }
.hud-digit { display: inline-block; height: var(--digit-h); overflow: hidden; line-height: var(--digit-h); }
.hud-digit > span { display: flex; flex-direction: column; transition: transform 0.24s cubic-bezier(0.3, 1.35, 0.5, 1); }
.hud-digit i { font-style: normal; height: var(--digit-h); }

.hud-heading-box {
  position: absolute;
  left: 50%;
  top: -16px;
  z-index: 1;
  transform: translateX(-50%);
  display: flex;
  padding: 2px 9px;
  border: 1px solid rgba(95, 240, 255, 0.6);
  border-radius: 4px;
  background: rgba(6, 18, 28, 0.8);
  font-size: 15px;
  font-weight: 600;
  text-shadow: 0 0 8px rgba(95, 240, 255, 0.6);
}

/* Bars and slots */
.hud-bar,
.hud-slot { display: flex; flex-direction: column; align-items: center; gap: 4px; }
.hud-bar { --tone: var(--hud-green); --tone-glow: rgba(77, 255, 166, 0.7); }
.hud-bar.tone-cyan { --tone: var(--hud-cyan); --tone-glow: rgba(95, 240, 255, 0.7); }
.hud-bar.tone-amber { --tone: var(--hud-amber); --tone-glow: rgba(255, 211, 77, 0.7); }
.hud-bar.tone-red { --tone: var(--hud-red); --tone-glow: rgba(255, 77, 99, 0.8); }
.hud-bar-track {
  position: relative;
  box-sizing: border-box;
  width: 18px;
  height: var(--bar-h);
  padding: 3px;
  display: flex;
  flex-direction: column-reverse;
  gap: 3px;
  border: 1px solid var(--hud-rim);
  border-radius: 4px;
  background: var(--hud-glass);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.hud-bar-fill {
  position: absolute;
  inset: 3px;
  border-radius: 2px;
  transform-origin: bottom;
  background: linear-gradient(to top, var(--tone), color-mix(in srgb, var(--tone) 70%, white));
  box-shadow: 0 0 8px var(--tone-glow);
}
.hud-bar-track i { flex: 1; border-radius: 1px; background: rgba(120, 230, 255, 0.12); transition: background 0.2s; }
.hud-bar-track i.on { background: var(--hud-green); box-shadow: 0 0 6px rgba(77, 255, 166, 0.7); }
.hud-bar-track i.on:nth-child(n + 7) { background: var(--hud-amber); box-shadow: 0 0 6px rgba(255, 211, 77, 0.8); }
.hud-bar.pulse .hud-bar-track { animation: hud-pulse 0.6s ease-in-out infinite alternate; }
.hud-bar.draggable .hud-bar-track { cursor: ns-resize; touch-action: none; }
.hud-bar.draggable .hud-bar-track:focus-visible { outline: 2px solid var(--hud-cyan); outline-offset: 3px; }
.hud-slot-track {
  position: relative;
  width: 8px;
  height: var(--bar-h);
  border: 1px solid var(--hud-rim);
  border-radius: 4px;
  background: var(--hud-glass);
}
.hud-slot-marker {
  position: absolute;
  left: 50%;
  width: 26px;
  height: 8px;
  border-radius: 2px;
  transform: translate(-50%, -50%);
  background: var(--hud-cyan);
  box-shadow: 0 0 10px rgba(95, 240, 255, 0.8);
}

@keyframes hud-pulse { from { box-shadow: 0 0 0 rgba(255, 211, 77, 0); } to { box-shadow: 0 0 14px rgba(255, 211, 77, 0.9); } }
@keyframes hud-blink { 0%, 49.9% { opacity: 1; } 50%, 100% { opacity: 0.25; } }
```

- [ ] **Step 6: Type check** — Run: `bunx tsc -b`. Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/hud/RollingDigits.tsx src/hud/Dial.tsx src/hud/CompassRose.tsx src/hud/BarGauge.tsx src/hud/SlotGauge.tsx src/hud/hud.css
git commit -m "feat(hud): add Holo Glass dial, compass, bar and slot components"
```

---

### Task 8: FlightHud layout, warnings banner, Betty wiring and App integration

**Files:**
- Create: `src/hud/FlightHud.tsx`, `src/hud/WarningBanner.tsx`, `src/hud/TouchControls.tsx`
- Modify: `src/hud/hud.css` (append layout, warning, boot, compact, touch, restyle rules), `src/flight-ui.ts` (add `formatClock`), `src/App.tsx` (replace the in-flight HUD block, add the voice-warnings setting)
- Test: `tests/flight-ui.test.ts` (add `formatClock` case)

**Interfaces:**
- Consumes: everything above; `Snapshot`, `Mission`, `PocketFlight`, `aircraftNames`, `climbReadout`, `flightProfiles`.
- Produces: `FlightHud(props: FlightHudProps)` where `FlightHudProps = { game: PocketFlight | null; snapshot: Snapshot; mission: Mission; aircraftId: AircraftId; beginnerAssist: boolean; automaticConfiguration: boolean; sound: boolean; voiceWarnings: boolean; map: ReactNode; onToggleSound: () => void; onOpenControls: () => void }`; `formatClock(seconds: number): string`.

- [ ] **Step 1: Failing test for `formatClock`** — append to `tests/flight-ui.test.ts` (and add `formatClock` to its import list):

```ts
  test("clock formats minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(252.9)).toBe("04:12");
  });
```

Run: `bun test tests/flight-ui.test.ts`. Expected: FAIL (`formatClock` not exported).

- [ ] **Step 2: Add `formatClock`** — append to `src/flight-ui.ts`:

```ts
export function formatClock(seconds: number) {
  const s = Math.max(0, Math.floor(seconds));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
```

Run: `bun test tests/flight-ui.test.ts`. Expected: PASS.

- [ ] **Step 3: WarningBanner** — `src/hud/WarningBanner.tsx`

```tsx
import { warningText, type WarningId } from "./warnings";

export function WarningBanner({ warning }: { warning: WarningId | null }) {
  if (!warning) return null;
  return (
    <>
      <div className="hud-warning-edge" aria-hidden="true" />
      <div key={warning} className={`hud-warning hud-warning-${warning}`} role="alert">
        {warningText[warning]}
      </div>
    </>
  );
}
```

- [ ] **Step 4: TouchControls** — `src/hud/TouchControls.tsx`. Move the existing `{mode === "playing" && (<div className="touch-controls"> … </div>)}` block out of `src/App.tsx` (currently App.tsx lines ~1015–1089) verbatim, replacing `game.current?.` with `game?.` and `if (game.current)` with `if (game)`:

```tsx
import type { PointerEvent } from "react";
import type { AircraftId } from "../aircraft";
import type { PocketFlight } from "../game";

const clampAxis = (v: number) => Math.max(-1, Math.min(1, v));

export function TouchControls({ game, aircraftId, automaticConfiguration, beginnerAssist }: {
  game: PocketFlight | null;
  aircraftId: AircraftId;
  automaticConfiguration: boolean;
  beginnerAssist: boolean;
}) {
  const steer = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (game)
      game.touch = {
        roll: clampAxis((e.clientX - rect.x - rect.width / 2) / (rect.width / 2)),
        pitch: clampAxis((e.clientY - rect.y - rect.height / 2) / (rect.height / 2)),
        yaw: 0,
      };
  };
  const release = () => {
    if (game) game.touch = { pitch: 0, roll: 0, yaw: 0 };
  };
  return (
    <div className="touch-controls">
      <div
        className="touch-stick"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          steer(e);
        }}
        onPointerMove={(e) => {
          if (e.currentTarget.hasPointerCapture(e.pointerId)) steer(e);
        }}
        onPointerUp={release}
        onPointerCancel={release}
      >
        <span>+</span>
        <small>FLY</small>
      </div>
      <button
        className="touch-brake"
        onPointerDown={() => game?.keys.add("KeyB")}
        onPointerUp={() => game?.keys.delete("KeyB")}
        onPointerLeave={() => game?.keys.delete("KeyB")}
        onPointerCancel={() => game?.keys.delete("KeyB")}
      >
        BRAKE
      </button>
      {aircraftId !== "finch" && !automaticConfiguration && (
        <div className="touch-configuration">
          <button onClick={() => game?.toggleGear()} aria-label="Toggle landing gear">GEAR</button>
          <button onClick={() => game?.cycleFlaps()} aria-label="Cycle flaps">FLAPS</button>
        </div>
      )}
      {!beginnerAssist && (
        <div className="touch-configuration">
          <button onClick={() => game?.adjustTrim(-0.02)} aria-label="Decrease elevator trim">TRIM −</button>
          <button onClick={() => game?.adjustTrim(0.02)} aria-label="Increase elevator trim">TRIM +</button>
        </div>
      )}
    </div>
  );
}
```

(The original clamps only in `onPointerMove`; clamping on press too is intentional and harmless.)

- [ ] **Step 5: FlightHud** — `src/hud/FlightHud.tsx`

```tsx
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Camera, CircleHelp, Navigation, Pause, Volume2, VolumeX, Wind } from "lucide-react";
import type { AircraftId } from "../aircraft";
import type { PocketFlight, Snapshot } from "../game";
import type { Mission } from "../missions";
import { Betty } from "../betty";
import { flightProfiles } from "../flight-profiles";
import { aircraftNames, climbReadout, formatClock } from "../flight-ui";
import { BarGauge } from "./BarGauge";
import { CompassRose } from "./CompassRose";
import { Dial } from "./Dial";
import { airspeedScale, clamp01 } from "./geometry";
import { SlotGauge } from "./SlotGauge";
import { TouchControls } from "./TouchControls";
import { prefersReducedMotion } from "./useSpring";
import { WarningBanner } from "./WarningBanner";
import { evaluateWarnings, freshLatch, type WarningId } from "./warnings";
import "./hud.css";

export type FlightHudProps = {
  game: PocketFlight | null;
  snapshot: Snapshot;
  mission: Mission;
  aircraftId: AircraftId;
  beginnerAssist: boolean;
  automaticConfiguration: boolean;
  sound: boolean;
  voiceWarnings: boolean;
  map: ReactNode;
  onToggleSound: () => void;
  onOpenControls: () => void;
};

type BootPhase = "off" | "sweep" | "return";

function useBoot(mode: Snapshot["mode"]) {
  const [phase, setPhase] = useState<BootPhase>("off");
  const previous = useRef<Snapshot["mode"]>("menu");
  useEffect(() => {
    const was = previous.current;
    previous.current = mode;
    if (mode !== "playing" || was === "playing" || was === "paused" || prefersReducedMotion()) return;
    setPhase("sweep");
    const back = setTimeout(() => setPhase("return"), 550);
    const done = setTimeout(() => setPhase("off"), 1200);
    return () => {
      clearTimeout(back);
      clearTimeout(done);
    };
  }, [mode]);
  return phase;
}

export function FlightHud({
  game, snapshot: s, mission, aircraftId, beginnerAssist, automaticConfiguration,
  sound, voiceWarnings, map, onToggleSound, onOpenControls,
}: FlightHudProps) {
  const boot = useBoot(s.mode);
  const sweeping = boot === "sweep";
  const latch = useRef(freshLatch());
  const betty = useRef<Betty | null>(null);
  const [warnings, setWarnings] = useState<WarningId[]>([]);
  const profile = flightProfiles[aircraftId];
  const jet = aircraftId !== "finch";

  useEffect(() => {
    if (game && !betty.current) betty.current = new Betty(game.audio);
    // A fresh flight (clock restarted, full health) starts with clean one-shot warnings.
    if (s.time < 1 && s.health >= 99.9) latch.current = freshLatch();
    const r = evaluateWarnings(
      { ...s, fuelFraction: s.instruments.fuelFraction, jet, approachKnots: profile.approachKnots },
      latch.current,
      s.time,
    );
    latch.current = r.latch;
    setWarnings(r.active);
    if (betty.current) {
      betty.current.enabled = voiceWarnings;
      betty.current.update(r.active, performance.now() / 1000);
    }
  }, [s, game, jet, profile.approachKnots, voiceWarnings]);

  useEffect(() => () => betty.current?.silence(), []);

  const speed = airspeedScale(aircraftId);
  const engine = s.instruments.engine;
  const fuel = s.instruments.fuelFraction;
  const aoa = clamp01(s.instruments.aoaDegrees / Math.max(1, s.instruments.stallAoaDegrees));
  const climbFpm = s.verticalSpeed * 196.8504;
  const damaged = Object.entries(s.damage).filter(([, d]) => d > 0.1);
  const gearState = s.gearPosition > 0.995 ? "down" : s.gearPosition < 0.005 ? "up" : "moving";
  const flightWarning = s.stall || s.hint.startsWith("Engine out");

  return (
    <div className={`holo-hud ${boot !== "off" ? "booting" : ""}`}>
      <WarningBanner warning={warnings[0] ?? null} />

      <CompassRose heading={s.heading} />

      <header className="hud-objective hud-glass">
        <span className="hud-label">{mission.name}</span>
        <h3>{s.objective}</h3>
        <div className="hud-progress">
          {Array.from({ length: s.totalRings }, (_, i) => (
            <i key={i} className={i < s.ring ? "done" : i === s.ring ? "next" : ""} />
          ))}
          <span>
            {s.totalRings > 0 ? `${s.ring}/${s.totalRings}` : mission.id === "free" ? "FREE FLIGHT" : "LANDING MISSION"}
          </span>
        </div>
      </header>

      <div className="hud-tools">
        <span className="hud-wind hud-glass" title="Wind">
          <Wind size={16} />
          {s.wind.toFixed(0)} <small>KT</small>
        </span>
        <button className="hud-glass" title="Cycle camera (C)" aria-label="Cycle camera" onClick={() => game?.cycleCamera()}>
          <Camera size={18} />
        </button>
        <button className="hud-glass" aria-label="Toggle flight audio" onClick={onToggleSound}>
          {sound ? <Volume2 size={18} /> : <VolumeX size={18} />}
        </button>
        <button className="hud-glass hud-help" title="Flight controls" aria-label="Flight controls" onClick={onOpenControls}>
          <CircleHelp size={18} />
        </button>
        <button className="hud-glass" aria-label="Pause flight" onClick={() => game?.pause()}>
          <Pause size={18} />
        </button>
      </div>

      <div className="hud-map">
        {map}
        <div className="hud-clock hud-glass">
          <b>{formatClock(mission.id === "race" ? mission.par * 1.5 - s.time : s.time)}</b>
          <span className="hud-label">{mission.id === "race" ? "REMAINING" : "FLIGHT TIME"}</span>
        </div>
      </div>

      {s.mode === "playing" && s.target && (
        <div
          className={`target-label ${s.target.visible ? "" : "offscreen"}`}
          style={{ left: `${(s.target.x * 0.5 + 0.5) * 100}%`, top: `${(-s.target.y * 0.5 + 0.5) * 100}%` }}
        >
          <span className="target-diamond">{s.target.visible ? "" : <Navigation size={17} />}</span>
          <span>
            {s.ring < s.totalRings ? String(s.ring + 1).padStart(2, "0") : mission.land}{" "}
            <b>{s.target.distance > 1000 ? `${(s.target.distance / 1000).toFixed(1)} km` : `${Math.round(s.target.distance)} m`}</b>
          </span>
        </div>
      )}
      {s.mode === "playing" && (
        <div className="center-reticle">
          <span />
          <i />
          <span />
        </div>
      )}

      <section className="hud-cluster hud-left" aria-label="Flight instruments">
        <div className="hud-status">
          {aircraftNames[aircraftId].toUpperCase()} <b className={s.grounded ? "ground" : ""}>· {s.grounded ? "ON RUNWAY" : "AIRBORNE"}</b>
        </div>
        {s.health < 97 && (
          <div className="hud-damage hud-glass">
            HULL {Math.round(s.health)}%
            {damaged.map(([part, d]) => ` · ${part.toUpperCase()} ${Math.round((1 - d) * 100)}%`).join("")}
          </div>
        )}
        <div className="hud-row">
          <Dial
            label="KNOTS" size="large" min={0} max={speed.max} value={sweeping ? speed.max : s.speed}
            majorStep={speed.majorStep} minorStep={speed.minorStep} bands={speed.bands} redline={speed.redline}
            readout={String(Math.round(s.speed))}
          />
          {engine.kind === "propeller" ? (
            <Dial
              className="hud-engine" label="RPM" size="small" min={0} max={3000} value={sweeping ? 3000 : engine.rpm}
              majorStep={500} minorStep={100} tickLabel={(v) => String(v / 100)}
              bands={[{ from: 2000, to: 2500, tone: "green" }]} redline={2500}
              readout={Math.round(engine.rpm).toLocaleString("en-US")}
            />
          ) : (
            <Dial
              className="hud-engine" label="THRUST" size="small" min={0} max={100} value={sweeping ? 100 : engine.percent}
              majorStep={20} minorStep={5}
              bands={profile.afterburner > 0 ? [{ from: 88, to: 100, tone: "amber" }] : []}
              readout={String(Math.round(engine.percent))} unit="%"
            />
          )}
          <div className="hud-bars">
            <BarGauge
              label="THR" tone="cyan" fraction={sweeping ? 1 : s.throttle / 100} readout={`${Math.round(s.throttle)}%`}
              onDrag={(f) => {
                if (game) game.physics.throttle = f;
              }}
            />
            <BarGauge
              label="FUEL" tone={fuel <= 0.1 ? "red" : fuel <= 0.2 ? "amber" : "green"}
              fraction={sweeping ? 1 : fuel} readout={`${Math.round(fuel * 100)}%`}
            />
            <BarGauge
              label="AOA" segments={8} fraction={sweeping ? 1 : aoa} pulse={aoa >= 0.85}
              readout={`${Math.round(s.instruments.aoaDegrees)}°`}
            />
          </div>
        </div>
      </section>

      <section className="hud-cluster hud-right" aria-label="Configuration and vertical speed">
        {jet && (
          <div className={`hud-gear hud-glass ${gearState}`} role="img" aria-label={`Landing gear ${gearState}`}>
            <i />
            <i />
            <i />
            <span className="hud-label">GEAR</span>
            <b>{s.automaticConfiguration ? "AUTO" : "MAN"}</b>
          </div>
        )}
        <div className="hud-row">
          <div className="hud-slots">
            {jet && <SlotGauge label="FLAPS" position={s.flapPosition} readout={`${Math.round(s.flapPosition * 100)}%`} />}
            {!beginnerAssist && (
              <SlotGauge label="TRIM" position={0.5 - s.elevatorTrim / 2} readout={`${s.elevatorTrim > 0 ? "+" : ""}${Math.round(s.elevatorTrim * 100)}`} />
            )}
          </div>
          <Dial
            label="V.SPEED" size="small" min={-2000} max={2000} start={15} sweep={330}
            value={sweeping ? 2000 : climbFpm} majorStep={1000} minorStep={250}
            tickLabel={(v) => String(Math.abs(v / 1000))} readout={climbReadout(s.verticalSpeed)}
          />
        </div>
      </section>

      {(flightWarning || (s.grounded && s.time < 18)) && (
        <div className="flight-center-bottom">
          <div className={`flight-hint ${flightWarning ? "warning" : ""}`}>
            {s.grounded && !flightWarning
              ? `Shift: power up · ↓ / S: raise nose at ${profile.rotationKnots} kn · B: brake`
              : s.hint}
          </div>
        </div>
      )}

      {s.mode === "playing" && (
        <TouchControls game={game} aircraftId={aircraftId} automaticConfiguration={automaticConfiguration} beginnerAssist={beginnerAssist} />
      )}
    </div>
  );
}
```

Check before writing: `Mission` has `name`, `id`, `par`, `land` (used in App today: `current.name`, `current.id === "race"`, `current.par`, `current.land`). `game.cycleCamera()`, `game.pause()`, `game.touch`, `game.keys`, `game.toggleGear()`, `game.cycleFlaps()`, `game.adjustTrim()`, `game.audio`, `game.physics.throttle` are used by App today. Flaps are hidden for the Finch (`jet` check) because the Finch's flaps are fixed.

- [ ] **Step 6: Layout styles** — append to `src/hud/hud.css`:

```css
/* Layout */
.holo-hud .hud-compass { position: absolute; top: 26px; left: 24px; }
.hud-objective {
  position: absolute;
  top: 18px;
  left: 50%;
  transform: translateX(-50%);
  width: min(430px, 40vw);
  padding: 9px 16px 10px;
  text-align: center;
}
.hud-objective h3 { margin: 3px 0 7px; font-size: 15px; font-weight: 600; letter-spacing: 0.02em; }
.hud-progress { display: flex; justify-content: center; align-items: center; gap: 4px; }
.hud-progress i { width: 12px; height: 4px; border-radius: 1px; background: rgba(120, 230, 255, 0.25); }
.hud-progress i.done { background: var(--hud-cyan); box-shadow: 0 0 6px rgba(95, 240, 255, 0.8); }
.hud-progress i.next { background: var(--hud-amber); animation: hud-blink 1s steps(1) infinite; }
.hud-progress span { margin-left: 8px; font-size: 11px; letter-spacing: 0.12em; color: var(--hud-cyan-soft); }
.hud-tools { position: absolute; top: 18px; right: 18px; display: flex; gap: 8px; }
.hud-tools button,
.hud-wind {
  height: 40px;
  min-width: 40px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 0 10px;
  color: var(--hud-text);
  font: 600 13px "Oxanium", sans-serif;
  cursor: pointer;
  transition: border-color 0.15s, box-shadow 0.15s;
}
.hud-wind { cursor: default; }
.hud-wind small { font-size: 10px; color: var(--hud-cyan-soft); }
.hud-tools button:hover { border-color: var(--hud-cyan); box-shadow: 0 0 14px rgba(95, 240, 255, 0.35); }
.hud-tools button:focus-visible { outline: 2px solid var(--hud-cyan); outline-offset: 2px; }
.hud-map { position: absolute; top: 72px; right: 18px; width: 164px; display: grid; gap: 8px; }
.holo-hud .minimap {
  width: 100%;
  padding: 8px;
  box-sizing: border-box;
  background: var(--hud-glass);
  border: 1px solid var(--hud-rim);
  border-radius: 10px;
  color: var(--hud-cyan-soft);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  box-shadow: inset 0 1px 0 rgba(200, 250, 255, 0.18), 0 8px 24px rgba(0, 10, 20, 0.25);
}
.holo-hud .minimap .map-top,
.holo-hud .minimap .map-bottom { font: 500 10px "Oxanium", sans-serif; letter-spacing: 0.15em; color: var(--hud-cyan-soft); }
.holo-hud .minimap canvas { width: 100%; height: auto; border-radius: 6px; }
.hud-clock { display: flex; align-items: baseline; justify-content: space-between; padding: 7px 12px; }
.hud-clock b { font-size: 15px; }

.hud-cluster { position: absolute; bottom: 20px; z-index: 1; display: flex; flex-direction: column; gap: 10px; }
.hud-left { left: 22px; align-items: flex-start; }
.hud-right { right: 22px; align-items: flex-end; }
.hud-row { display: flex; align-items: flex-end; gap: 14px; }
.hud-bars,
.hud-slots { display: flex; align-items: flex-end; gap: 12px; margin-bottom: 4px; }
.hud-status { font-size: 12px; font-weight: 600; letter-spacing: 0.16em; text-shadow: 0 1px 6px rgba(0, 10, 20, 0.6); }
.hud-status b { font-weight: 500; color: var(--hud-green); }
.hud-status b.ground { color: var(--hud-amber); }
.hud-damage { padding: 5px 12px; border-color: var(--hud-amber); border-radius: 999px; color: var(--hud-amber); font-size: 12px; font-weight: 600; letter-spacing: 0.06em; }
.hud-gear { display: flex; align-items: center; gap: 9px; padding: 6px 14px; border-radius: 999px; font-size: 11px; }
.hud-gear i { width: 10px; height: 10px; border-radius: 50%; background: rgba(120, 230, 255, 0.15); transition: background 0.2s; }
.hud-gear.down i { background: var(--hud-green); box-shadow: 0 0 8px var(--hud-green); }
.hud-gear.moving i { background: var(--hud-amber); box-shadow: 0 0 8px var(--hud-amber); animation: hud-blink 0.5s steps(1) infinite; }
.hud-gear b { margin-left: 6px; font-size: 11px; }

/* Restyled world markers, hints and reticle */
.holo-hud .target-label { font-family: "Oxanium", sans-serif; color: var(--hud-text); }
.holo-hud .target-label > span:last-child {
  background: var(--hud-glass);
  border: 1px solid var(--hud-rim);
  border-radius: 4px;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
}
.holo-hud .target-label b { color: var(--hud-cyan); }
.holo-hud .target-diamond { border-color: var(--hud-cyan); box-shadow: 0 0 10px rgba(95, 240, 255, 0.7); }
.holo-hud .center-reticle span,
.holo-hud .center-reticle i { background: var(--hud-cyan); box-shadow: 0 0 6px rgba(95, 240, 255, 0.8); }
.holo-hud .flight-center-bottom { position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%); }
.holo-hud .flight-hint {
  background: var(--hud-glass);
  border: 1px solid var(--hud-rim);
  color: var(--hud-text);
  font-family: "Oxanium", sans-serif;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.holo-hud .flight-hint.warning { border-color: var(--hud-red); color: #ffd6db; }
.in-flight .toast {
  background: rgba(6, 18, 28, 0.7);
  border: 1px solid var(--hud-rim, rgba(120, 230, 255, 0.42));
  color: #e8fbff;
  font-family: "Oxanium", sans-serif;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}
.in-flight .replay-bar {
  background: rgba(6, 18, 28, 0.7);
  border: 1px solid rgba(120, 230, 255, 0.42);
  color: #e8fbff;
  font-family: "Oxanium", sans-serif;
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
}

/* Warnings: 0.35 s period keeps the strobe under 3 flashes per second. */
.hud-warning-edge {
  position: absolute;
  inset: 0;
  z-index: 0;
  background: radial-gradient(ellipse at center, transparent 58%, rgba(255, 30, 50, 0.55) 100%);
  animation: hud-edge 0.35s steps(1) infinite;
}
.hud-warning {
  position: absolute;
  left: 50%;
  top: 36%;
  z-index: 3;
  padding: 10px 30px;
  border: 2px solid var(--hud-red);
  border-radius: 999px;
  font-size: clamp(18px, 2vw, 26px);
  font-weight: 800;
  letter-spacing: 0.3em;
  white-space: nowrap;
  transform: translate(-50%, -50%);
  animation: hud-strobe 0.35s steps(1) infinite, hud-shake 0.12s linear infinite;
}
@keyframes hud-strobe {
  0%, 49.9% { background: rgba(255, 40, 60, 0.9); color: #fff; box-shadow: 0 0 30px rgba(255, 40, 60, 0.75); }
  50%, 100% { background: rgba(6, 18, 28, 0.65); color: var(--hud-red); box-shadow: none; }
}
@keyframes hud-edge { 0%, 49.9% { opacity: 1; } 50%, 100% { opacity: 0.12; } }
@keyframes hud-shake {
  0%, 100% { transform: translate(-50%, -50%); }
  25% { transform: translate(calc(-50% - 3px), calc(-50% + 1px)); }
  50% { transform: translate(calc(-50% + 3px), calc(-50% - 1px)); }
  75% { transform: translate(calc(-50% - 2px), calc(-50% - 1px)); }
}

/* Boot-up: rims draw in and readouts flicker on while needles sweep (driven by FlightHud). */
.holo-hud.booting .hud-rim { stroke-dasharray: 1; animation: hud-draw 0.9s ease-out both; }
.holo-hud.booting .hud-readout,
.holo-hud.booting .hud-value,
.holo-hud.booting .hud-heading-box { animation: hud-flicker 0.9s steps(1) both; }
@keyframes hud-draw { from { stroke-dashoffset: 1; } to { stroke-dashoffset: 0; } }
@keyframes hud-flicker {
  0% { opacity: 0; } 20% { opacity: 1; } 28% { opacity: 0.25; } 40% { opacity: 1; } 52% { opacity: 0.45; } 64%, 100% { opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  .holo-hud *,
  .holo-hud *::before { animation: none !important; transition: none !important; }
  .hud-warning { background: rgba(255, 40, 60, 0.9); color: #fff; }
  .hud-warning-edge { opacity: 0.7; }
}

/* Touch: keep the stick and brake clear of the instrument clusters. */
@media (pointer: coarse) {
  .holo-hud .touch-stick { left: 22px; bottom: calc(var(--dial-lg) + 96px); }
  .holo-hud .touch-brake { right: 22px; bottom: calc(var(--dial-sm) + 150px); }
  .holo-hud .flight-center-bottom { bottom: calc(var(--dial-lg) + 40px); }
}

/* Phones: compact instrument set. */
@media (max-width: 540px) {
  .holo-hud { --dial-lg: 118px; --dial-sm: 70px; --compass: 88px; }
  .holo-hud .hud-engine,
  .holo-hud .hud-bars,
  .holo-hud .hud-slots,
  .holo-hud .hud-gear,
  .holo-hud .hud-help,
  .holo-hud .hud-wind,
  .holo-hud .hud-objective .hud-label { display: none; }
  .hud-objective { top: 10px; left: 10px; right: 10px; width: auto; transform: none; padding: 7px 10px 8px; }
  .hud-objective h3 { font-size: 12px; margin-bottom: 5px; }
  .holo-hud .hud-compass { top: 100px; left: 12px; }
  .hud-tools { top: 92px; right: 10px; gap: 6px; }
  .hud-tools button { height: 36px; min-width: 36px; padding: 0 8px; }
  .hud-map { top: 136px; right: 10px; width: 92px; }
  .holo-hud .minimap .map-top,
  .holo-hud .minimap .map-bottom { display: none; }
  .hud-cluster { bottom: 12px; }
  .hud-left { left: 10px; }
  .hud-right { right: 10px; }
  .hud-status { font-size: 10px; }
  .hud-readout { font-size: 15px; }
}
```

- [ ] **Step 7: Integrate in App** — edit `src/App.tsx`:

1. Imports: add `import { FlightHud } from "./hud/FlightHud";` and add `Siren` to the lucide import list.
2. State: add after `automaticConfiguration`:

```tsx
    [voiceWarnings, setVoiceWarnings] = useState(() => read("pocket-flight-voice-warnings", true)),
```

and next to `toggleSound`:

```tsx
  const toggleVoiceWarnings = () => {
    setVoiceWarnings((on) => {
      save("pocket-flight-voice-warnings", !on);
      return !on;
    });
  };
```

3. Replace everything inside `{mode !== "menu" && snapshot && (<> … </>)}` from `<header className="flight-header">` up to (not including) `{mode === "replay" && (` with:

```tsx
          <FlightHud
            game={game.current}
            snapshot={snapshot}
            mission={current}
            aircraftId={aircraftId}
            beginnerAssist={beginnerAssist}
            automaticConfiguration={automaticConfiguration}
            sound={sound}
            voiceWarnings={voiceWarnings}
            map={<MiniMap snapshot={snapshot} mission={current} />}
            onToggleSound={toggleSound}
            onOpenControls={() => openPanel("controls")}
          />
```

4. Remove what the HUD no longer uses: `instrumentsExpanded` state, `heading`, `climb`, `flightWarning` constants, and the `climbReadout`/`headingReadout` imports if nothing else uses them (check with `grep -n "heading\b\|climb\b\|flightWarning\|instrumentsExpanded" src/App.tsx`). Remove now-unused lucide icons only if `grep` shows no other use.
5. Settings panel: insert after the "All audio" `setting-row`:

```tsx
                <div className="setting-row">
                  <span>
                    <Siren size={21} />
                    <b>Voice warnings</b>
                  </span>
                  <button className="setting-toggle" aria-pressed={voiceWarnings} onClick={toggleVoiceWarnings}>
                    {voiceWarnings ? "Betty on" : "Betty off"}
                    {voiceWarnings ? <Volume2 size={17} /> : <VolumeX size={17} />}
                  </button>
                </div>
                <p className="music-status">Voice warnings: real cockpit recordings.</p>
```

- [ ] **Step 8: Verify** — Run: `bun test && bunx tsc -b`. Expected: all tests pass (new HUD tests plus the existing suite), no new tsc errors.

- [ ] **Step 9: Commit**

```bash
git add src/hud src/App.tsx src/flight-ui.ts tests/flight-ui.test.ts
git commit -m "feat(hud): replace flight HUD with Holo Glass instruments and Betty warnings"
```

---

### Task 9: Browser verification

**Files:**
- Create: `scripts/check-hud-browser.ts`
- Output: `output/hud/*.png`, `output/hud/boot.webm`, `output/hud/evidence.json`

**Interfaces:**
- Consumes: the running preview server at `http://127.0.0.1:5199/`; `window.pocketFlight` (exposed by App); the "Choose aircraft" select and "Start flight" button.

- [ ] **Step 1: Start the preview server** (background, inside the worktree): `bunx vite --port 5199 --strictPort`. Expected: `Local: http://localhost:5199/`.

- [ ] **Step 2: Write the check** — `scripts/check-hud-browser.ts`

```ts
// Visual check for the Holo Glass HUD. Usage: CHROMIUM_PATH=… bun scripts/check-hud-browser.ts
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "playwright";

const url = process.env.HUD_CHECK_URL ?? "http://127.0.0.1:5199/";
const out = fileURLToPath(new URL("../output/hud/", import.meta.url));
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const errors: string[] = [];
const evidence: Record<string, unknown>[] = [];

async function fly(page: Page, aircraft: string) {
  await page.goto(url);
  await page.waitForFunction(() => "pocketFlight" in window);
  await page.evaluate(async () => {
    await (window as unknown as { pocketFlight: { aircraft: { ready: Promise<unknown> } } }).pocketFlight.aircraft.ready;
  });
  await page.getByLabel("Choose aircraft").selectOption(aircraft);
  await page.getByRole("button", { name: "Start flight", exact: true }).click();
  await page.waitForSelector(".holo-hud");
}

for (const [name, viewport, mobile] of [
  ["desktop", { width: 1280, height: 720 }, false],
  ["phone", { width: 390, height: 844 }, true],
] as const) {
  const context = await browser.newContext({
    viewport,
    isMobile: mobile,
    hasTouch: mobile,
    recordVideo: name === "desktop" ? { dir: out, size: viewport } : undefined,
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  for (const aircraft of ["finch", "peregrine", "aurelia", "stormbird"]) {
    await fly(page, aircraft);
    await page.waitForTimeout(1600); // boot-up finished
    await page.screenshot({ path: `${out}${name}-${aircraft}.png` });
    evidence.push(await page.evaluate((a) => ({
      aircraft: a,
      dials: document.querySelectorAll(".holo-hud .hud-dial").length,
      compass: !!document.querySelector(".holo-hud .hud-compass"),
      altitudeShown: /\bFT AGL\b|ALTITUDE/i.test(document.querySelector(".holo-hud")?.textContent ?? ""),
    }), aircraft));
  }
  // Force a stall warning by wrapping the snapshot callback.
  await page.evaluate(() => {
    const pf = (window as unknown as { pocketFlight: { onSnapshot: (s: { stall: boolean }) => void } }).pocketFlight;
    const original = pf.onSnapshot;
    pf.onSnapshot = (s) => original({ ...s, stall: true });
  });
  await page.waitForSelector(".hud-warning");
  await page.screenshot({ path: `${out}${name}-warning.png` });
  await context.close();
}
await browser.close();
await Bun.write(`${out}evidence.json`, JSON.stringify({ evidence, errors }, null, 2));
console.log(JSON.stringify({ checked: evidence.length, errors }, null, 2));
if (errors.length) process.exit(1);
```

- [ ] **Step 3: Run** — Run: `CHROMIUM_PATH="$HOME/Library/Caches/ms-playwright/chromium-1234/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing" bun scripts/check-hud-browser.ts`. Expected: `checked: 8`, `errors: []`; every evidence row has `compass: true`, `altitudeShown: false`, desktop `dials: 3`.

- [ ] **Step 4: Review the images** — Open each `output/hud/*.png` and compare with `docs/superpowers/specs/assets/holo-hud-layout.png`:
  - desktop: compass top-left, objective top-centre, buttons + minimap + clock top-right, left cluster (airspeed, engine, THR/FUEL/AOA), right cluster (gear pill on jets, flaps on jets, V.SPEED); no overlaps; text crisp in Oxanium.
  - phone: compact set (airspeed + V.SPEED + compass), touch stick and brake clear of dials.
  - warning: strobing STALL banner visible with red edges behind the instruments.
  - Watch `output/hud/*.webm` for the boot-up: rims draw, needles sweep to max and back in ≈1.2 s, digits roll.
  Fix any defect in the owning component/CSS, re-run Step 3, and repeat until clean.

- [ ] **Step 5: Audio spot check** — In the desktop session, enable sound, force the stall wrapper from Step 2 in the devtools console, and confirm the chime + "Stall, stall" every 2 s; toggle Settings → Voice warnings off and confirm silence; pause and confirm the voice stops.

- [ ] **Step 6: Commit**

```bash
git add scripts/check-hud-browser.ts
git commit -m "test(hud): add browser check for Holo Glass HUD"
```

(`output/` artifacts stay uncommitted unless the repo already tracks that folder.)
