import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const cad = resolve(root, "assets/f15c");
const python = process.env.F15C_PYTHON ?? resolve(cad, ".venv/bin/python");
const stages = [
  { id: "fuselage", model: "fuselage", report: "fuselage" },
  { id: "intakes", model: "airframe_intakes", report: "intakes" },
  { id: "wings", model: "airframe_wings", report: "wings" },
  { id: "tails", model: "airframe_tails", report: "tails" },
  { id: "exhausts", model: "airframe_exhausts", report: "exhausts-assembly" },
  { id: "cockpit", model: "airframe_cockpit", report: "cockpit-assembly" },
  { id: "gear", model: "airframe_gear", report: "gear" },
  { id: "complete", model: "f15c", report: "complete" },
];
const selected = process.argv[2] ?? "all";
if (selected !== "all" && !stages.some(stage => stage.id === selected)) {
  throw new Error(`Unknown stage: ${selected}. Choose ${stages.map(stage => stage.id).join(", ")}, or all.`);
}
if (!existsSync(python)) throw new Error("Create assets/f15c/.venv and install assets/f15c/requirements.txt first.");
function run(command: string[], cwd = cad) {
  // The dynamically added part search paths are not fully tracked by the CAD
  // freshness gate. Rebuild authoring scripts so changed imported parts always
  // reach each cumulative saved model; ordinary verification scripts stay pure.
  if (command[0] === python && command[1]?.startsWith("src/")) command.push("--force");
  const result = Bun.spawnSync(command, {
    cwd, env: { ...process.env, CADGEN_CACHE_DIR: process.env.F15C_CAD_CACHE ?? "/private/tmp/f15c-cadgen-cache" },
    stdout: "inherit", stderr: "inherit",
  });
  if (result.exitCode) process.exit(result.exitCode);
}
for (const stage of stages) {
  if (selected !== "all" && stage.id !== selected) continue;
  if (stage.id === "intakes") {
    run([python, "src/intakes_preview.py"], resolve(cad, "parts/intakes"));
    run([python, "checks/intakes.py"], resolve(cad, "parts/intakes"));
  } else if (stage.id === "wings") {
    run([python, "checks/build_and_check.py"], resolve(cad, "parts/wings"));
    run([process.execPath, "scripts/measure-f15c-wing.ts"], root);
  } else if (stage.id === "tails") {
    run([python, "src/tails.py"], resolve(cad, "parts/tails"));
    run([python, "checks/tails.py"], resolve(cad, "parts/tails"));
  } else if (stage.id === "exhausts") {
    run([python, "src/exhausts_preview.py"]);
    run([python, "checks/exhausts_contact.py"]);
    run([python, "checks/exhausts-functional.py"]);
  } else if (stage.id === "cockpit") {
    run([python, "src/cockpit_preview.py"]);
    run([python, "checks/cockpit_contact.py"]);
    run([python, "checks/cockpit-functional.py"]);
    run([python, "checks/cockpit_refinement_check.py"]);
  } else if (stage.id === "gear") {
    run([python, "src/landing_gear.py"], resolve(cad, "parts/gear"));
    run([python, "checks/check_gear.py"], resolve(cad, "parts/gear"));
  } else if (stage.id === "complete") {
    run([python, "src/gun.py"]);
    run([python, "src/gun_preview.py"]);
    run([python, "checks/gun.py"]);
    run([python, "src/details.py"]);
    run([python, "src/details_preview.py"]);
    run([python, "checks/details_contact.py"]);
    run([python, "checks/details_functional.py"]);
  }
  run([python, `src/${stage.model}.py`]);
  if (stage.id === "gear") {
    for (const [checker, report] of [
      ["photo_gear_intakes.py", "gear-intake-travel"],
      ["photo_integration_geometry.py", "gear-intake-geometry"],
    ]) {
      run([python, `parts/intakes/checks/${checker}`,
        ...(checker === "photo_gear_intakes.py" ? ["--integrated"] : []),
        "--artifact", "STEP/airframe_gear.step", "--report", `checks/${report}-results.json`]);
    }
  }
  if (stage.id === "wings") run([python, "parts/wings/checks/check_root_blend.py"]);
  if (stage.id === "tails") run([python, "checks/wing_tail_clearance.py"]);
  if (stage.id === "fuselage") run([python, "checks/fuselage.py"]);
  else if (stage.id === "complete") run([python, "checks/complete.py"]);
  else run([python, "checks/assembly.py", `STEP/${stage.model}.step`, `checks/${stage.report}-results.json`]);
  // A stage is copied into the lab only after the saved model passes its checks.
  run([process.execPath, "scripts/publish-f15c-stages.ts", stage.id], root);
  if (stage.id === "complete") {
    run([python, "src/export_game.py"]);
    run([process.execPath, "scripts/prepare-f15c.ts"], root);
    run([process.execPath, "scripts/measure-f15c.ts"], root);
    run([process.execPath, "scripts/publish-f15c-stages.ts"], root);
  }
}
