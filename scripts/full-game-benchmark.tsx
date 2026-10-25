import React from "react";
import { createRoot } from "react-dom/client";
import * as T from "three";
import App from "../src/app/App";
import "../src/app/style.css";
import type { PocketFlight } from "../src/flight/game";
import { ObstacleIndex } from "../src/flight/obstacle-index";
import { missions } from "../src/flight/missions";
import { terrainSurfaceHeight } from "../src/world/terrain";
import {
  engineVariants,
  makeExperiments,
  variants,
  type Variant,
} from "./full-game-variants";

type Scenario = "airfield" | "forest";
const params = new URLSearchParams(location.search);
const engineMode = params.has("engine");
const confirmation = params.get("confirm") as Variant | null;
if (
  confirmation &&
  (!variants.includes(confirmation as (typeof variants)[number]) ||
    confirmation === "baseline")
)
  throw new Error("Invalid confirmation variant");
const trialVariants: readonly Variant[] = confirmation
  ? ["baseline", confirmation]
  : engineMode
    ? engineVariants
    : variants;
const warmupMs = 2000,
  measurementMs = confirmation ? 10000 : 6000,
  drainMs = 500;
const measurementEnd = warmupMs + measurementMs;
const totalTrials = trialVariants.length * 2 * 3;
const dimensions = { airfield: [1280, 720], forest: [1920, 1080] } as const;
const root = document.querySelector<HTMLElement>("#root")!;
const style = document.createElement("style");
style.textContent =
  "html,body{overflow:auto!important}#root{width:1280px;height:720px}.app{height:100%!important;min-height:0!important}#bench-panel button,#bench-panel select{font:inherit;margin:4px;padding:6px 10px}";
document.head.append(style);
// One live instance: StrictMode's development remount can expose a disposed
// instance through window.pocketFlight while its replacement is loading.
createRoot(root).render(<App />);
const status = document.querySelector<HTMLElement>("#status")!;
const output = document.querySelector<HTMLElement>("#results")!;
const run = document.querySelector<HTMLButtonElement>("#compare")!;
const preview = document.querySelector<HTMLButtonElement>("#preview")!;
const variantSelect = document.querySelector<HTMLSelectElement>("#variant")!;
const scenarioSelect = document.querySelector<HTMLSelectElement>("#scenario")!;
if (engineMode) {
  variantSelect.replaceChildren(
    ...engineVariants.map(
      (value) =>
        new Option(
          value === "baseline"
            ? "Exhaustive collisions"
            : "Spatial collision grid",
          value,
        ),
    ),
  );
  document.querySelector("#bench-panel h1")!.textContent =
    "Pocket Flight: engine collision comparison";
  document.querySelector("#bench-panel p")!.textContent =
    "Real App, Finch, physics, HUD and VFX. Identical graphics; exhaustive scenery scan versus spatial grid. Three alternating rounds; 2 s warmup + 6 s measurement per trial.";
}
if (confirmation) {
  variantSelect.replaceChildren(
    new Option("Baseline", "baseline"),
    new Option(confirmation, confirmation),
  );
  document.querySelector("#bench-panel h1")!.textContent =
    `Confirmation: baseline versus ${confirmation}`;
  document.querySelector("#bench-panel p")!.textContent =
    "Real game, three alternating pairs in each view; 2 s warmup + 10 s measurement.";
}
const game = await new Promise<PocketFlight>((resolve) => {
  const interval = setInterval(() => {
    const instance = (window as unknown as { pocketFlight?: PocketFlight })
      .pocketFlight;
    if (instance) {
      clearInterval(interval);
      resolve(instance);
    }
  }, 50);
});
await Promise.all([game.world.ready, game.aircraft.ready]);
if (game.aircraft.id !== "finch") await game.selectAircraft("finch");
game.audio.enabled = false;
const experiments = makeExperiments(game);
let indexQueries = 0;
const collisionIndex = game.world.collisionObstacles;
if (!(collisionIndex instanceof ObstacleIndex))
  throw new Error("Collision grid is not ready");
const queryObstacles = collisionIndex.query.bind(collisionIndex);
collisionIndex.query = (...args) => {
  indexQueries++;
  return queryObstacles(...args);
};
const renderer = game.renderer;
const gl = renderer.getContext() as WebGL2RenderingContext;
const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
const debug = gl.getExtension("WEBGL_debug_renderer_info");
renderer.info.autoReset = false;
const errors: string[] = [];
addEventListener("error", (e) => errors.push(e.message));
addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
let snapshots = 0;
const onSnapshot = game.onSnapshot;
game.onSnapshot = (state) => {
  snapshots++;
  onSnapshot(state);
};
const clouds = game.scene.children
  .filter((o) => o.name === "Cloud formation")
  .map((object) => ({ object, x: object.position.x }));
const updateWorld = game.world.update.bind(game.world);
let flightStart = performance.now();
game.world.update = (_time, night) => {
  const time = (performance.now() - flightStart) / 1000;
  for (const { object, x } of clouds) object.position.x = x + time * 0.72;
  updateWorld(12 + time, night);
};
const stats = (values: number[]) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.floor((sorted.length - 1) * f)];
  return {
    mean: values.reduce((a, b) => a + b, 0) / values.length,
    median: q(0.5),
    p95: q(0.95),
    p99: q(0.99),
    min: sorted[0],
    max: sorted.at(-1)!,
  };
};
type RenderSample = { cpu: number; calls: number; triangles: number };
type Active = {
  variant: Variant;
  scenario: Scenario;
  round: number;
  start: number;
  intervals: number[];
  render: RenderSample[];
  physics: number[];
  gpu: number[];
  lastSnapshots: number;
  tickStart: number;
  queryStart: number;
  positionStart: number[];
  hiddenFrames: number;
  invalidFrames: number;
  done: (value: unknown) => void;
};
let active: Active | undefined;
const measuring = () =>
  active &&
  performance.now() >= active.start + warmupMs &&
  performance.now() < active.start + measurementEnd;
const pending: { query: WebGLQuery; values: number[] }[] = [];
const render = renderer.render.bind(renderer);
renderer.render = (scene, camera) => {
  const trial = measuring() ? active : undefined;
  renderer.info.reset();
  const query = trial && timer ? gl.createQuery() : null;
  if (query) gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
  const begin = performance.now();
  render(scene, camera);
  const cpu = performance.now() - begin;
  if (query && trial) {
    gl.endQuery(timer.TIME_ELAPSED_EXT);
    pending.push({ query, values: trial.gpu });
  }
  if (trial)
    trial.render.push({
      cpu,
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
    });
};
const step = game.physics.step.bind(game.physics);
game.physics.step = (...args) => {
  const begin = performance.now();
  const obstacles =
    engineMode && variantSelect.value === "baseline"
      ? game.world.obstacles
      : args[2];
  const result = step(args[0], args[1], obstacles);
  if (measuring()) active!.physics.push(performance.now() - begin);
  return result;
};
const results: unknown[] = [];
function environment() {
  return {
    measuredAt: new Date().toISOString(),
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    gameDpr: experiments.baseDpr,
    gpu: debug
      ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
      : gl.getParameter(gl.RENDERER),
    gpuTimer: Boolean(timer),
    aircraft: game.aircraft.id,
    warmupMs,
    measurementMs,
    drainMs,
    confirmation,
    scenarios: dimensions,
    audioMuted: !game.audio.enabled,
    engineMode,
    obstacleCount: game.world.obstacles.length,
    variants: trialVariants,
  };
}
Object.assign(window, {
  fullGameBenchmark: {
    evidence: () => ({ environment: environment(), results, errors }),
  },
});
function save(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function beginFlight(name: Variant, scenario: Scenario) {
  const [width, height] = dimensions[scenario];
  root.style.width = `${width}px`;
  root.style.height = `${height}px`;
  experiments.apply(name, width, height);
  game.night = false;
  game.start(
    scenario === "airfield"
      ? missions[0]
      : missions.find((m) => m.id === "free")!,
  );
  if (game.audio.enabled) game.audio.toggle();
  game.physics.beginnerAssist = true;
  if (scenario === "forest") {
    // Fly a real trimmed path across the same forest section on every trial.
    const x = -650,
      z = -35;
    let maximum = 0;
    for (let i = 0; i <= 30; i++)
      maximum = Math.max(maximum, terrainSurfaceHeight(x + i * 10, z));
    game.physics.position.set(x, maximum + 38, z);
    game.physics.yaw = -Math.PI / 2;
    game.physics.initializeAirStart(30);
  }
  window.scrollTo(0, 0);
  flightStart = performance.now();
}
let last = 0;
function observe(now: number) {
  if (timer)
    for (let i = pending.length - 1; i >= 0; i--) {
      const { query, values } = pending[i];
      if (!gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) continue;
      if (!gl.getParameter(timer.GPU_DISJOINT_EXT))
        values.push(gl.getQueryParameter(query, gl.QUERY_RESULT) / 1e6);
      gl.deleteQuery(query);
      pending.splice(i, 1);
    }
  const trial = active;
  if (trial) {
    const elapsed = performance.now() - trial.start;
    if (elapsed >= warmupMs && elapsed < measurementEnd) {
      trial.intervals.push(now - last);
      if (document.hidden) trial.hiddenFrames++;
      if (game.mode !== "playing" || game.physics.crashed)
        trial.invalidFrames++;
    }
    if (elapsed >= measurementEnd + drainMs) {
      const frame = stats(trial.intervals)!;
      const result = {
        variant: trial.variant,
        scenario: trial.scenario,
        round: trial.round,
        frames: trial.intervals.length,
        fps: 1000 / frame.mean,
        onePercentLowFps: 1000 / frame.p99,
        frameMs: frame,
        over20ms: trial.intervals.filter((v) => v > 20).length,
        over33ms: trial.intervals.filter((v) => v > 33.4).length,
        renderCpuMs: stats(trial.render.map((r) => r.cpu)),
        physicsStepMs: stats(trial.physics),
        gpuMs: stats(trial.gpu),
        gpuSamples: trial.gpu.length,
        calls: stats(trial.render.map((r) => r.calls)),
        triangles: stats(trial.render.map((r) => r.triangles)),
        drawingBuffer: [gl.drawingBufferWidth, gl.drawingBufferHeight],
        snapshotUpdates: snapshots - trial.lastSnapshots,
        physicsTicks: game.physics.simulationTick - trial.tickStart,
        collisionIndexQueries: indexQueries - trial.queryStart,
        hudVisible: (() => {
          const r = document
            .querySelector('.holo-hud [aria-label="Flight instruments"]')
            ?.getBoundingClientRect();
          return !!r && r.width > 0 && r.top >= 0 && r.bottom <= innerHeight;
        })(),
        aircraftVisible: game.aircraft.group.visible,
        hiddenFrames: trial.hiddenFrames,
        invalidFrames: trial.invalidFrames,
        mode: game.mode,
        crashed: game.physics.crashed,
        positionStart: trial.positionStart,
        positionEnd: game.physics.position.toArray(),
        raw: {
          intervals: trial.intervals,
          render: trial.render,
          physics: trial.physics,
          gpu: trial.gpu,
        },
      };
      active = undefined;
      results.push(result);
      output.textContent = JSON.stringify(
        {
          environment: environment(),
          results: results.map((value) => {
            const { raw, ...summary } = value as typeof result;
            return summary;
          }),
          errors,
        },
        null,
        2,
      );
      trial.done(result);
    }
  }
  last = now;
  requestAnimationFrame(observe);
}
requestAnimationFrame(observe);
async function measure(name: Variant, scenario: Scenario, round: number) {
  beginFlight(name, scenario);
  variantSelect.value = name;
  scenarioSelect.value = scenario;
  status.textContent = `Round ${round + 1}/3 · ${scenario} · ${name} · ${results.length}/${totalTrials} trials complete`;
  return new Promise((done) => {
    active = {
      variant: name,
      scenario,
      round,
      start: performance.now(),
      intervals: [],
      render: [],
      physics: [],
      gpu: [],
      lastSnapshots: snapshots,
      tickStart: game.physics.simulationTick,
      queryStart: indexQueries,
      positionStart: game.physics.position.toArray(),
      hiddenFrames: 0,
      invalidFrames: 0,
      done,
    };
  });
}
run.disabled = preview.disabled = false;
status.textContent = "Ready. Start the full-game comparison.";
run.addEventListener("click", async () => {
  run.disabled =
    preview.disabled =
    variantSelect.disabled =
    scenarioSelect.disabled =
      true;
  results.length = 0;
  for (let round = 0; round < 3; round++)
    for (const scenario of ["airfield", "forest"] as const) {
      const offset = round % trialVariants.length;
      const rotated = [
        ...trialVariants.slice(offset),
        ...trialVariants.slice(0, offset),
      ];
      const order =
        engineMode || confirmation
          ? round % 2
            ? [...trialVariants].reverse()
            : trialVariants
          : round % 2
            ? rotated.reverse()
            : rotated;
      for (const name of order) await measure(name, scenario, round);
    }
  game.pause();
  run.disabled =
    preview.disabled =
    variantSelect.disabled =
    scenarioSelect.disabled =
      false;
  status.textContent = `Full-game comparison complete: ${totalTrials} trials. Game paused.`;
});
preview.addEventListener("click", () => {
  beginFlight(variantSelect.value as Variant, scenarioSelect.value as Scenario);
  status.textContent = "Preview flight running with plane and HUD.";
});
document
  .querySelector("#save")!
  .addEventListener("click", () =>
    save(
      "full-game-benchmark.json",
      new Blob(
        [
          JSON.stringify(
            { environment: environment(), results, errors },
            null,
            2,
          ),
        ],
        { type: "application/json" },
      ),
    ),
  );
