// Startup and flight check for every aircraft, against a served production build:
//   bun run build && bunx vite preview --port 4173 &  then  bun run e2e [--base <url>] [--only <choice>]
// Opens each aircraft in headless Chromium (software WebGL), starts a free flight, takes screenshots,
// then flies 20 s of simulated time with full power and a gentle climb. Observes only.
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright";

const choices = ["finch", "finch-attack", "peregrine", "aurelia", "stormbird", "heron", "f15c"] as const;
type Choice = typeof choices[number];
type Sample = { t: number; y: number; speed: number; stall: number; roll: number; mode: string; finite: boolean };
type Result = { choice: Choice; ok: boolean; failures: string[]; errors: string[]; seconds: number; frames: number; samples: number; phases: Record<string, number> };

const FLIGHT_SECONDS = 20, POWER_SECONDS = 3, WALL_LIMIT_MS = 600_000, MIN_FRAMES = 200;
const ALTITUDE_LOSS = 50, MIN_SPEED_OF_STALL = 0.9, MAX_ROLL = 1.2;
const out = "output/e2e";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const base = (arg("--base") ?? "http://127.0.0.1:4173").replace(/\/$/, "");
const only = arg("--only");
if (only && !choices.includes(only as Choice)) throw new Error(`--only must be one of ${choices.join(", ")}`);

// Runs in the page. window.pocketFlight is the Game, exposed by App.tsx in production only with ?e2e=1.
type Game = {
  mode: string; time: number; cameraMode: string;
  aircraft: { ready: Promise<unknown>; pilot?: { ready: Promise<unknown> }; interior?: { loaded: Promise<unknown> } };
  world: { ready: Promise<unknown> };
  physics: { position: { x: number; y: number; z: number }; velocity: { x: number; y: number; z: number; length(): number }; quaternion: { x: number; y: number; z: number; w: number }; stallSpeed: number; roll: number };
  getState(): { drawCalls: number };
};
declare global { interface Window { pocketFlight?: Game; e2eFrames?: number } }

const sample = (page: Page) => page.evaluate((): Sample => {
  const g = window.pocketFlight!, p = g.physics, v = p.velocity, q = p.quaternion;
  const values = [p.position.x, p.position.y, p.position.z, v.x, v.y, v.z, q.x, q.y, q.z, q.w, p.roll];
  return { t: g.time, y: p.position.y, speed: v.length(), stall: p.stallSpeed, roll: p.roll, mode: g.mode, finite: values.every(Number.isFinite) };
});

async function check(page: Page, choice: Choice): Promise<Omit<Result, "choice" | "errors" | "seconds">> {
  const failures: string[] = [], phases: Record<string, number> = {};
  let mark = Date.now();
  const phase = (name: string) => { phases[name] = (Date.now() - mark) / 1000; mark = Date.now(); };
  await page.goto(`${base}/?e2e=1&aircraft=${choice}`);
  await page.waitForFunction(() => !!window.pocketFlight, null, { timeout: 180_000 });
  await page.evaluate(async () => {
    const g = window.pocketFlight!;
    await Promise.all([g.aircraft.ready, g.world.ready]);
    window.e2eFrames = 0;
    const count = () => { window.e2eFrames!++; requestAnimationFrame(count); };
    requestAnimationFrame(count);
  });
  phase("load");
  // The menu enables its launch buttons once React has seen the aircraft ready; slow runners take a while.
  const launch = page.getByRole("button", { name: "Free flight" }).first();
  await launch.waitFor({ state: "visible", timeout: 180_000 });
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some((b) => b.textContent?.includes("Free flight") && !b.disabled), null, { timeout: 180_000 })
    .catch(() => { throw new Error("the Free flight button never became enabled"); });
  await launch.click({ timeout: 60_000 });
  await page.waitForFunction(() => window.pocketFlight!.mode === "playing", null, { timeout: 60_000 });
  await page.evaluate(async () => {
    const g = window.pocketFlight!;
    await g.aircraft.pilot?.ready;
    await g.aircraft.interior?.loaded;
  });
  phase("start flight");
  // Startup: the scene draws and the HUD is up.
  const firstFrame = await page.evaluate(() => window.e2eFrames!);
  await page.waitForFunction((from) => window.e2eFrames! >= from + 30, firstFrame, { timeout: 120_000 });
  if (!(await page.evaluate(() => window.pocketFlight!.getState().drawCalls)) ) failures.push("the 3D view drew nothing");
  if (!(await page.locator(".hud-compass").first().isVisible())) failures.push("the HUD is not showing");
  await page.screenshot({ path: `${out}/${choice}-chase.png` });
  await page.evaluate(() => { window.pocketFlight!.cameraMode = "cockpit"; });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${out}/${choice}-cockpit.png` });
  await page.evaluate(() => { window.pocketFlight!.cameraMode = "chase"; });

  phase("startup checks");
  // Flight: 20 s of the game's own clock (fixed 1/60 s physics steps), judged at every sample.
  const start = await sample(page), frames0 = await page.evaluate(() => window.e2eFrames!), wall0 = Date.now();
  let samples = 0, climbing = false, now = start;
  await page.keyboard.down("ShiftLeft");
  while (now.t - start.t < FLIGHT_SECONDS && Date.now() - wall0 < WALL_LIMIT_MS) {
    await page.waitForTimeout(250);
    now = await sample(page);
    samples++;
    const flown = now.t - start.t;
    // A gentle climb after the power comes up: hold the nose-up key for 0.3 s of every second.
    const pull = flown > POWER_SECONDS && flown % 1 < 0.3;
    if (pull !== climbing) { await (pull ? page.keyboard.down("ArrowDown") : page.keyboard.up("ArrowDown")); climbing = pull; }
    const at = `${flown.toFixed(1)} s`;
    if (!now.finite) failures.push(`${at}: flight values are not numbers`);
    if (now.mode !== "playing") failures.push(`${at}: flight ended (${now.mode})`);
    if (now.y < start.y - ALTITUDE_LOSS) failures.push(`${at}: lost ${(start.y - now.y).toFixed(0)} m of altitude`);
    if (now.speed < MIN_SPEED_OF_STALL * now.stall) failures.push(`${at}: ${now.speed.toFixed(1)} m/s is below ${MIN_SPEED_OF_STALL} × stall speed ${now.stall.toFixed(1)} m/s`);
    if (Math.abs(now.roll) > MAX_ROLL) failures.push(`${at}: rolled to ${now.roll.toFixed(2)} rad`);
    if (failures.length) break;
  }
  await page.keyboard.up("ShiftLeft");
  if (climbing) await page.keyboard.up("ArrowDown");
  const frames = (await page.evaluate(() => window.e2eFrames!)) - frames0;
  if (!failures.length && now.t - start.t < FLIGHT_SECONDS) failures.push(`only ${(now.t - start.t).toFixed(1)} s flown in ${WALL_LIMIT_MS / 1000} s: too slow to judge`);
  if (!failures.length && frames < MIN_FRAMES) failures.push(`only ${frames} frames rendered: too slow to judge`);
  phase("flight");
  await page.screenshot({ path: `${out}/${choice}-flight.png` });
  return { ok: !failures.length, failures, frames, samples, phases };
}

mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ headless: true, args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const results: Result[] = [];
try {
  for (const choice of choices.filter((c) => !only || c === only)) {
    const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
    const errors: string[] = [], started = Date.now();
    page.on("pageerror", (error) => errors.push(String(error)));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    let result: Omit<Result, "choice" | "errors" | "seconds">;
    try { result = await check(page, choice); }
    catch (error) { result = { ok: false, failures: [String(error).split("\n")[0]], frames: 0, samples: 0, phases: {} }; }
    if (errors.length) result = { ...result, ok: false, failures: [...result.failures, `${errors.length} browser error(s)`] };
    results.push({ choice, ...result, errors, seconds: (Date.now() - started) / 1000 });
    const r = results.at(-1)!;
    console.log(`${r.ok ? "PASS" : "FAIL"} ${choice} (${r.seconds.toFixed(0)} s: ${Object.entries(r.phases).map(([k, v]) => `${k} ${v.toFixed(0)}`).join(", ")}; ${r.frames} frames)${r.ok ? "" : `: ${[...r.failures, ...r.errors].slice(0, 3).join("; ")}`}`);
    await page.close();
  }
} finally {
  await browser.close();
  writeFileSync(`${out}/summary.json`, JSON.stringify(results, null, 2));
}
if (results.some((r) => !r.ok)) process.exitCode = 1;
