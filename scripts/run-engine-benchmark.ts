import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const renderMode = process.argv.includes("--render");
const uncapped = process.argv.includes("--uncapped");
const confirmVariant = process.argv
  .find((arg) => arg.startsWith("--confirm="))
  ?.slice(10);
if (confirmVariant && !renderMode)
  throw new Error("Confirmation requires --render");
if (
  confirmVariant &&
  ![
    "shadow1024",
    "render85",
    "terrainLOD",
    "lightInstances",
    "noShadows",
  ].includes(confirmVariant)
)
  throw new Error("Invalid confirmation variant");
const runId =
  process.argv.find((arg) => arg.startsWith("--run-id="))?.slice(9) ??
  new Date().toISOString().replace(/[:.]/g, "-");
if (!/^[a-zA-Z0-9_-]+$/.test(runId))
  throw new Error("Invalid benchmark run id");
const outputName = uncapped
  ? `full-game-uncapped/${runId}/${confirmVariant ? `confirmation-${confirmVariant}` : renderMode ? "render" : "collision"}`
  : renderMode
    ? "full-game-optimization"
    : "engine-speed";
const output = `${root}output/${outputName}`;
const expectedTrials = confirmVariant ? 12 : renderMode ? 36 : 12;
const origin = process.env.FLIGHT_BENCH_URL ?? "http://127.0.0.1:5280";
const entryUrl = new URL("/scripts/full-game-benchmark.html", origin);
if (!renderMode) entryUrl.searchParams.set("engine", "1");
if (confirmVariant) entryUrl.searchParams.set("confirm", confirmVariant);
const session = `${uncapped ? "uncapped" : "engine"}-${renderMode ? "render" : "collision"}`;
type ValidatedTrial = {
  variant: string;
  scenario: string;
  round: number;
  collisionIndexQueries: number;
  frames: number;
  invalidFrames: number;
  hiddenFrames: number;
  hudVisible: boolean;
  aircraftVisible: boolean;
  mode: string;
  crashed: boolean;
  physicsTicks: number;
  snapshotUpdates: number;
};
await mkdir(output, { recursive: true });
if (uncapped && (await Bun.file(`${output}/source-manifest.json`).exists()))
  throw new Error(
    "Run already exists; choose a new --run-id to preserve its evidence",
  );
const browserConfig = await Bun.file(
  `${root}.playwright/cli.config.json`,
).json();
if (uncapped) {
  browserConfig.browser.launchOptions.headless = false;
  browserConfig.browser.launchOptions.args = [
    ...new Set([
      ...browserConfig.browser.launchOptions.args,
      "--disable-frame-rate-limit",
    ]),
  ];
}
await Bun.write(
  `${output}/browser-config.json`,
  JSON.stringify(browserConfig, null, 2),
);
const controlCode = (
  await Bun.file(
    new URL("./check-benchmark-browser.js", import.meta.url),
  ).text()
)
  .trim()
  .replace(/;$/, "");

async function command(args: string[]) {
  const child = Bun.spawn(
    ["bun", "node_modules/.bin/playwright-cli", `-s=${session}`, ...args],
    { cwd: root, stdout: "pipe", stderr: "pipe" },
  );
  const [out, err, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code || out.includes("### Error")) throw new Error(out + err);
  return out;
}
function result(out: string) {
  const match = out.match(/### Result\n([\s\S]*?)\n### (?:Ran|Page)/);
  if (!match) throw new Error(`No browser result: ${out}`);
  return JSON.parse(match[1]);
}
if (!(await fetch(origin)).ok)
  throw new Error(
    `Start the game first: bun run dev --host 127.0.0.1 --port 5280`,
  );
const files = [
  ...(await Array.fromAsync(
    new Bun.Glob("src/**/*.{ts,tsx,css,json}").scan({ cwd: root }),
  )),
  "scripts/run-engine-benchmark.ts",
  "scripts/check-benchmark-browser.js",
  "scripts/full-game-benchmark.html",
  "scripts/full-game-benchmark.tsx",
  "scripts/full-game-variants.ts",
].sort();
const manifest = await Promise.all(
  files.map(async (path) => ({
    path,
    sha256: createHash("sha256")
      .update(new Uint8Array(await Bun.file(`${root}${path}`).arrayBuffer()))
      .digest("hex"),
  })),
);
await Bun.write(
  `${output}/source-manifest.json`,
  JSON.stringify(manifest, null, 2),
);
try {
  await command([
    "open",
    "about:blank",
    "--headed",
    "--config",
    `${output}/browser-config.json`,
  ]);
  const preControl = result(await command(["run-code", controlCode]));
  await Bun.write(
    `${output}/control-before.json`,
    JSON.stringify(preControl, null, 2),
  );
  function controlPasses(control: typeof preControl) {
    return (
      control.hardware &&
      control.webglError === 0 &&
      control.blankMedianFps > 45 &&
      control.animatedDom.fps > 90 &&
      control.webgl.fps > 90 &&
      [...control.blank, control.animatedDom, control.webgl].every(
        (s) => !s.hiddenFrames,
      )
    );
  }
  if (uncapped && !controlPasses(preControl))
    throw new Error(
      "Uncapped control failed; full-game trials were not started",
    );
  console.log(
    `Controls: blank ${preControl.blankMedianFps.toFixed(1)}, DOM ${preControl.animatedDom.fps.toFixed(1)}, WebGL ${preControl.webgl.fps.toFixed(1)} FPS`,
  );
  await command([
    "run-code",
    `async page => {
    await page.addInitScript(() => {
      window.benchmarkBrowserErrors = [];
      for (const level of ["error", "warn"]) {
        const original = console[level].bind(console);
        console[level] = (...args) => { window.benchmarkBrowserErrors.push(level + ": " + args.map(String).join(" ")); original(...args); };
      }
      addEventListener("error", event => window.benchmarkBrowserErrors.push(event.message));
      addEventListener("unhandledrejection", event => window.benchmarkBrowserErrors.push(String(event.reason)));
    });
    await page.setViewportSize({width:1920,height:1200});
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDeviceMetricsOverride", {width:1920,height:1200,deviceScaleFactor:2,mobile:false});
    await page.goto(${JSON.stringify(entryUrl.href)});
    await page.waitForFunction(() => !!window.fullGameBenchmark && !document.querySelector("#compare").disabled);
    await page.locator("#compare").click();
    return "started";
  }`,
  ]);
  const deadline = Date.now() + (renderMode ? 480_000 : 240_000);
  while (true) {
    await Bun.sleep(10_000);
    const state = result(
      await command([
        "eval",
        `({status:document.querySelector("#status").textContent,done:!document.querySelector("#compare").disabled})`,
      ]),
    );
    console.log(state.status);
    if (state.done) break;
    if (Date.now() > deadline) throw new Error("Benchmark timed out");
  }
  // Download the full payload: CLI text output truncates larger 36-trial runs.
  await command([
    "run-code",
    `async page => {
    const pending = page.waitForEvent("download");
    await page.locator("#save").click();
    const download = await pending;
    await download.saveAs(${JSON.stringify(`${output}/full-game.json`)});
    return {saved:true};
  }`,
  ]);
  const evidence = await Bun.file(`${output}/full-game.json`).json();
  evidence.browserErrors = result(
    await command(["eval", "window.benchmarkBrowserErrors"]),
  );
  evidence.browserControl = {
    ...preControl,
    page: "about:blank",
    fps: preControl.blankMedianFps,
  };
  evidence.uncapped = uncapped;
  evidence.runId = runId;
  evidence.browserConfig = browserConfig;
  const changedSources: string[] = [];
  for (const file of manifest) {
    const hash = createHash("sha256")
      .update(
        new Uint8Array(await Bun.file(`${root}${file.path}`).arrayBuffer()),
      )
      .digest("hex");
    if (hash !== file.sha256) changedSources.push(file.path);
  }
  evidence.changedSources = changedSources;
  await Bun.write(
    `${output}/full-game.json`,
    JSON.stringify(evidence, null, 2),
  );
  const valid =
    evidence.results.length === expectedTrials &&
    new Set(
      evidence.results.map(
        (trial: ValidatedTrial) =>
          `${trial.scenario}:${trial.round}:${trial.variant}`,
      ),
    ).size === expectedTrials &&
    evidence.results.every(
      (trial: ValidatedTrial) =>
        (!renderMode && trial.variant === "baseline"
          ? trial.collisionIndexQueries === 0
          : trial.collisionIndexQueries > 100) &&
        trial.frames > 30 &&
        !trial.invalidFrames &&
        !trial.hiddenFrames &&
        trial.hudVisible &&
        trial.aircraftVisible &&
        trial.mode === "playing" &&
        !trial.crashed &&
        trial.physicsTicks > 600 &&
        trial.snapshotUpdates > 30,
    );
  if (
    !valid ||
    changedSources.length ||
    evidence.errors.length ||
    evidence.browserErrors.length
  )
    throw new Error(
      `Invalid trials or browser errors; inspect output/${outputName}/full-game.json`,
    );
  for (const scenario of ["airfield", "forest"]) {
    await command([
      "run-code",
      `async page => {
      await page.locator("#scenario").selectOption("${scenario}");
      await page.locator("#variant").selectOption("${renderMode ? "baseline" : "spatialIndex"}");
      await page.locator("#preview").click(); await page.waitForTimeout(2200);
      await page.screenshot({path:"output/${outputName}/${scenario}.png",scale:"css"});
      await page.evaluate(() => window.pocketFlight.pause());
    }`,
    ]);
  }
  const postControl = result(await command(["run-code", controlCode]));
  await Bun.write(
    `${output}/control-after.json`,
    JSON.stringify(postControl, null, 2),
  );
  evidence.browserControlAfter = postControl;
  const fastest = Math.max(
    ...evidence.results.map((trial: { fps: number }) => trial.fps),
  );
  evidence.controlHeadroom =
    Math.min(preControl.webgl.fps, postControl.webgl.fps) / fastest;
  await Bun.write(
    `${output}/full-game.json`,
    JSON.stringify(evidence, null, 2),
  );
  if (
    uncapped &&
    (!controlPasses(postControl) || evidence.controlHeadroom < 1.5)
  )
    throw new Error(
      "Post-run control or rendering headroom failed; FPS ranking is inconclusive",
    );
  console.log(
    `${expectedTrials} valid trials saved; aircraft and HUD visible; zero browser errors/warnings.`,
  );
} finally {
  await command(["close"]);
}
