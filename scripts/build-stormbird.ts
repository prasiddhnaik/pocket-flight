import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const bundled = resolve(root, "../.venv-cad312/bin/python");
const python =
  process.env.STORMBIRD_PYTHON ?? (existsSync(bundled) ? bundled : "python3");
// Refresh occurrence bindings, then embed them in the current CAD sidecar.
const scripts = ["stormbird.py", "export_transfer.py", "stormbird.py"];
if (process.argv.includes("--details"))
  scripts.push("detail_views.py", "gear_details.py");
for (const script of scripts) {
  const result = Bun.spawnSync([python, `assets/stormbird/src/${script}`], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode) process.exit(result.exitCode);
}
const geometry = Bun.spawnSync(
  [python, "assets/stormbird/checks/design_geometry.py"],
  {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  },
);
if (geometry.exitCode) process.exit(geometry.exitCode);
const result = Bun.spawnSync(
  [process.execPath, "scripts/prepare-stormbird.ts"],
  { cwd: root, stdout: "inherit", stderr: "inherit" },
);
process.exit(result.exitCode);
