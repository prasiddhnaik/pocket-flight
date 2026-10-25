import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const bundled = resolve(root, "assets/heron/.venv/bin/python");
const python =
  process.env.HERON_PYTHON ?? (existsSync(bundled) ? bundled : "python3");
for (const file of ["src/heron.py", "src/export_game.py", "checks/motion.py", "src/heron_wing_cells.py"]) {
  const result = Bun.spawnSync([python, `assets/heron/${file}`], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode) process.exit(result.exitCode);
}
for (const script of ["prepare-heron.ts", "measure-heron.ts", "measure-heron-fuel.ts", "calibrate-heron-aero.ts"]) {
  const result = Bun.spawnSync([process.execPath, `scripts/${script}`], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.exitCode) process.exit(result.exitCode);
}
