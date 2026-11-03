import { existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { backupSkinScene, skinBuildCommand } from "./f15c-skin-step";

const root = resolve(import.meta.dir, "..");
const cad = resolve(root, "assets/f15c");
const python = process.env.F15C_PYTHON ?? resolve(cad, ".venv/bin/python");
const logs = process.env.F15C_LOG_DIR ?? "/private/tmp/f15c-build-logs";
const parallel = Number(process.env.F15C_JOBS ?? 3);

type Step = { args: string[]; cwd?: string };
type Stage = { id: string; model: string; report: string; build: Step[]; verify: Step[] };
const py = (script: string, cwd?: string, ...rest: string[]): Step => ({ args: [python, script, ...rest], cwd });
const bun = (script: string): Step => ({ args: [process.execPath, script], cwd: root });
const intakes = resolve(cad, "parts/intakes"), wings = resolve(cad, "parts/wings");
const tails = resolve(cad, "parts/tails"), gear = resolve(cad, "parts/gear");
const assembly = (model: string, report: string) => py("checks/assembly.py", undefined, `STEP/${model}.step`, `checks/${report}-results.json`);

// Each stage's model build composes the previous stage, so builds run strictly in
// order. Previews and checks only read saved artifacts and never feed a later
// build, so each stage's verification runs in the background beside the next
// builds. Nothing is published or exported until every verification has passed.
const stages: Stage[] = [
  { id: "fuselage", model: "fuselage", report: "fuselage", build: [py("src/fuselage.py")], verify: [py("checks/fuselage.py")] },
  {
    id: "intakes", model: "airframe_intakes", report: "intakes",
    build: [py("src/airframe_intakes.py")],
    verify: [py("src/intakes_preview.py", intakes), py("checks/intakes.py", intakes), assembly("airframe_intakes", "intakes")],
  },
  {
    id: "wings", model: "airframe_wings", report: "wings",
    build: [py("checks/build_and_check.py", wings), bun("scripts/measure-f15c-wing.ts"), py("src/airframe_wings.py")],
    verify: [py("parts/wings/checks/check_root_blend.py"), assembly("airframe_wings", "wings")],
  },
  {
    id: "tails", model: "airframe_tails", report: "tails",
    build: [py("src/tails.py", tails), py("src/airframe_tails.py")],
    verify: [py("checks/tails.py", tails), py("checks/wing_tail_clearance.py"), assembly("airframe_tails", "tails")],
  },
  {
    id: "exhausts", model: "airframe_exhausts", report: "exhausts-assembly",
    build: [py("src/airframe_exhausts.py")],
    verify: [py("src/exhausts_preview.py"), py("checks/exhausts_contact.py"), py("checks/exhausts-functional.py"), assembly("airframe_exhausts", "exhausts-assembly")],
  },
  {
    id: "cockpit", model: "airframe_cockpit", report: "cockpit-assembly",
    build: [py("src/airframe_cockpit.py")],
    verify: [
      py("src/cockpit_preview.py"), py("checks/cockpit_contact.py"), py("checks/cockpit-functional.py"),
      py("checks/cockpit_refinement_check.py"), assembly("airframe_cockpit", "cockpit-assembly"),
    ],
  },
  {
    id: "gear", model: "airframe_gear", report: "gear",
    build: [py("src/landing_gear.py", gear), py("src/airframe_gear.py")],
    verify: [
      py("checks/check_gear.py", gear),
      py("parts/intakes/checks/photo_gear_intakes.py", undefined, "--integrated", "--artifact", "STEP/airframe_gear.step", "--report", "checks/gear-intake-travel-results.json"),
      py("parts/intakes/checks/photo_integration_geometry.py", undefined, "--artifact", "STEP/airframe_gear.step", "--report", "checks/gear-intake-geometry-results.json"),
      assembly("airframe_gear", "gear"),
    ],
  },
  {
    id: "complete", model: "f15c", report: "complete",
    build: [py("src/gun.py"), py("src/details.py"), py("src/f15c.py")],
    verify: [
      py("src/gun_preview.py"), py("checks/gun.py"), py("src/details_preview.py"),
      py("checks/details_contact.py"), py("checks/details_functional.py"), py("checks/complete.py"),
    ],
  },
];

// `all`, one stage id, or `<id>+` for that stage and every later one.
const selected = process.argv[2] ?? "all";
const from = selected.endsWith("+") ? selected.slice(0, -1) : selected;
const first = selected === "all" ? 0 : stages.findIndex(stage => stage.id === from);
if (first < 0) throw new Error(`Unknown stage: ${selected}. Choose ${stages.map(stage => stage.id).join(", ")}, <stage>+, or all.`);
const chosen = selected === "all" || selected.endsWith("+") ? stages.slice(first) : [stages[first]];
if (!existsSync(python)) throw new Error("Create assets/f15c/.venv and install assets/f15c/requirements.txt first.");
mkdirSync(logs, { recursive: true });
const env = { ...process.env, CADGEN_CACHE_DIR: process.env.F15C_CAD_CACHE ?? "/private/tmp/f15c-cadgen-cache" };

function command(step: Step) {
  // The dynamically added part search paths are not fully tracked by the CAD
  // freshness gate. Rebuild authoring scripts so changed imported parts always
  // reach each cumulative saved model; ordinary verification scripts stay pure.
  return step.args[0] === python && /^src\//.test(step.args[1]) ? [...step.args, "--force"] : step.args;
}
function runNow(step: Step) {
  const result = Bun.spawnSync(command(step), { cwd: step.cwd ?? cad, env, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode) process.exit(result.exitCode);
}

let slots = parallel;
const waiting: (() => void)[] = [];
async function verify(stage: Stage) {
  if (slots > 0) slots--;
  else await new Promise<void>(go => waiting.push(go));
  const log = resolve(logs, `${stage.id}.log`);
  const started = performance.now();
  let transcript = "";
  try {
    for (const step of stage.verify) {
      const child = Bun.spawn(command(step), { cwd: step.cwd ?? cad, env, stdout: "pipe", stderr: "pipe" });
      const [out, err, code] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
      transcript += `$ ${step.args.slice(1).join(" ")}\n${out}${err}`;
      await Bun.write(log, transcript);
      if (code !== 0) {
        console.error(`✗ ${stage.id} verification failed: ${step.args[1]} (log: ${log})\n${(out + err).split("\n").slice(-25).join("\n")}`);
        return false;
      }
    }
    console.log(`✓ ${stage.id} verified in ${((performance.now() - started) / 60000).toFixed(1)} min (log: ${log})`);
    return true;
  } finally {
    const next = waiting.shift();
    if (next) next();
    else slots++;
  }
}

const checks: Promise<boolean>[] = [];
const began = performance.now();
for (const stage of chosen) {
  const started = performance.now();
  for (const step of stage.build) runNow(step);
  console.log(`· ${stage.id} built in ${((performance.now() - started) / 60000).toFixed(1)} min; verifying in background`);
  checks.push(verify(stage));
}
const results = await Promise.all(checks);
if (results.includes(false)) {
  console.error("F-15C verification failed; nothing was published or exported.");
  process.exit(1);
}
// A stage is copied into the lab only after its saved model passes its checks.
const last = chosen[chosen.length - 1];
if (last.id === "complete") {
  runNow(py("src/export_game.py"));
  // The CAD model holds the mechanical parts; Blender merges them with the outer skin.
  runNow(bun("scripts/prepare-f15c.ts"));
  const blender = process.env.BLENDER ?? "/Applications/Blender.app/Contents/MacOS/Blender";
  const kept = backupSkinScene(resolve(root, "assets/f15c-skin.blend"), resolve(root, "assets/f15c/skin-backups"), Date.now());
  if (kept) console.log(`Previous skin scene, with any hand sculpting, kept at ${kept}`);
  runNow({ args: skinBuildCommand(blender, resolve(root, "scripts/build-f15c-skin.py")), cwd: root });
  runNow({ args: skinBuildCommand(blender, resolve(root, "scripts/check-f15c-skin.py")), cwd: root });
  runNow(bun("scripts/measure-f15c.ts"));
  runNow(bun("scripts/publish-f15c-stages.ts"));
} else runNow({ args: [process.execPath, "scripts/publish-f15c-stages.ts", last.id], cwd: root });
console.log(`F-15C build finished in ${((performance.now() - began) / 60000).toFixed(1)} min.`);
